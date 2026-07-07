// Tactical AI for the non-player side. It re-plans on a timer rather than every
// frame, reading the whole battlefield and issuing orders through the same
// primitives the player uses (pathfinding, hold-line facing, dig-in).
//
// Doctrine, in priority order:
//   * Read the balance of force and pick a posture: attack / hold / defend.
//   * Seek high ground for the battle line and, especially, for the guns.
//   * Fight combined-arms: infantry hold the centre, artillery to the rear on
//     the best height, cavalry swing wide onto the enemy's exposed flank (or
//     guard its own flanks when on the defensive).
//   * Entrench the line when standing on the defensive.
//   * Pull shaken units out before they rout, and press hard when the enemy's
//     morale cracks.

import { findPath, getReachGrid } from './pathfinding.js';
import { elevationAt, GRID_W, GRID_H, CELL, WORLD_W, WORLD_H } from './terrain.js';

const FRONT_SPACING = 46;
const ARTY_DEPTH = 60;

const DIFFICULTY = {
    easy:   { interval: 3.0, flank: false, dig: false, groundR: 70,  aggression: 0.9 },
    normal: { interval: 1.8, flank: true,  dig: true,  groundR: 120, aggression: 1.0 },
    hard:   { interval: 1.1, flank: true,  dig: true,  groundR: 170, aggression: 1.15 }
};

const clampW = v => Math.max(8, Math.min(WORLD_W - 8, v));
const clampH = v => Math.max(8, Math.min(WORLD_H - 8, v));

export class AIController {
    constructor(app, side = 2, difficulty = 'normal') {
        this.app = app;
        this.side = side;
        this.difficulty = difficulty;
        this.timer = 0;
    }

    get cfg() { return DIFFICULTY[this.difficulty] || DIFFICULTY.normal; }

    reset() { this.timer = 0; }

    update(dt) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = this.cfg.interval;
        try { this.think(); } catch (e) { console.error('AI error', e); }
    }

    // --- Main decision pass -------------------------------------------------

    think() {
        const map = this.app.map;
        const all = this.app.companies;
        const mine = all.filter(c => c.side === this.side && c.alive);
        const foe = all.filter(c => c.side !== this.side && c.alive);
        if (!mine.length || !foe.length) return;

        const myC = centroid(mine), foeC = centroid(foe);
        const myStr = strength(mine), foeStr = strength(foe);
        const ratio = myStr / (foeStr || 1);
        const foeMorale = avg(foe.map(c => c.morale));

        // Axis of advance: unit vector from my centre toward the enemy centre.
        let ax = foeC.x - myC.x, ay = foeC.y - myC.y;
        const distToFoe = Math.hypot(ax, ay) || 1;
        ax /= distToFoe; ay /= distToFoe;
        const perpX = -ay, perpY = ax;          // along the battle line
        const facing = Math.atan2(ay, ax);

        // Posture from the balance of force (and a chance to exploit a wavering
        // enemy). Aggression from difficulty nudges the thresholds.
        const agg = this.cfg.aggression;
        let posture;
        if (ratio * agg > 1.3 || foeMorale < 42) posture = 'attack';
        else if (ratio * agg < 0.75) posture = 'defend';
        else posture = 'hold';

        const infantry = mine.filter(c => c.type === 'infantry');
        const cavalry = mine.filter(c => c.type === 'cavalry');
        const artillery = mine.filter(c => c.type === 'artillery');
        const ballR = infantry.length ? infantry[0].ballRadius : mine[0].ballRadius;

        // Where the battle line should stand.
        let centre;
        if (posture === 'attack') {
            const adv = Math.min(distToFoe * 0.55, 260);
            centre = bestGround(map, myC.x + ax * adv, myC.y + ay * adv, this.cfg.groundR * 0.7, ballR);
        } else if (posture === 'defend') {
            const adv = Math.min(distToFoe * 0.18, 110);
            centre = bestGround(map, myC.x + ax * adv, myC.y + ay * adv, this.cfg.groundR, ballR);
        } else {
            const adv = Math.min(distToFoe * 0.38, 180);
            centre = bestGround(map, myC.x + ax * adv, myC.y + ay * adv, this.cfg.groundR, ballR);
        }

        // Endpoints of the front line, sized to the infantry.
        const nFront = Math.max(1, infantry.length);
        const halfLen = Math.max(80, (nFront - 1) * FRONT_SPACING / 2 + 40);
        const p0 = { x: centre.x - perpX * halfLen, y: centre.y - perpY * halfLen };
        const p1 = { x: centre.x + perpX * halfLen, y: centre.y + perpY * halfLen };

        // --- Infantry: form and hold the line ---
        infantry.forEach((c, i) => {
            const t = infantry.length === 1 ? 0.5 : i / (infantry.length - 1);
            this.orderTo(c, p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, facing);
        });

        // --- Artillery: behind the centre, on the best nearby height ---
        artillery.forEach((c, i) => {
            const spread = (i - (artillery.length - 1) / 2) * 38;
            const gx = centre.x - ax * ARTY_DEPTH + perpX * spread;
            const gy = centre.y - ay * ARTY_DEPTH + perpY * spread;
            const hp = bestGround(map, gx, gy, 55, c.ballRadius);
            this.orderTo(c, hp.x, hp.y, facing);
        });

        // --- Cavalry: guard own flanks on defence, envelop on attack/hold ---
        if (cavalry.length) {
            if (posture === 'defend') {
                cavalry.forEach((c, i) => {
                    const side = i % 2 === 0 ? -1 : 1;
                    this.orderTo(c,
                        centre.x + perpX * side * (halfLen + 46) - ax * 20,
                        centre.y + perpY * side * (halfLen + 46) - ay * 20, facing);
                });
            } else if (this.cfg.flank) {
                const flank = enemyFlank(foe, foeC, perpX, perpY);
                cavalry.forEach((c, i) => {
                    const depth = flank.span + 130 + i * 40;
                    // Approach from outside the enemy flank, aimed at its rear.
                    const fx = foeC.x + perpX * flank.side * depth + ax * 40;
                    const fy = foeC.y + perpY * flank.side * depth + ay * 40;
                    this.orderTo(c, fx, fy, Math.atan2(-perpY * flank.side, -perpX * flank.side));
                });
            } else {
                // Easy AI just keeps horse on the wings of the line.
                cavalry.forEach((c, i) => {
                    const side = i % 2 === 0 ? -1 : 1;
                    this.orderTo(c,
                        centre.x + perpX * side * (halfLen + 30),
                        centre.y + perpY * side * (halfLen + 30), facing);
                });
            }
        }

        // --- Entrench the line when we mean to stand and receive ---
        if (this.cfg.dig && posture !== 'attack') {
            for (const c of infantry.concat(artillery)) {
                if (c.state !== 'moving' && c.state !== 'routing' && atGoal(c, 46)) c.orderDigIn();
            }
        }

        // --- Withdraw units that are close to breaking ---
        for (const c of mine) {
            if (c.state === 'routing') continue;
            if (c.morale < 32) {
                this.orderTo(c, c.x - ax * 230, c.y - ay * 230, facing, true);
            }
        }
    }

    // Issue a move toward (x, y) with the given hold facing. Avoids thrashing:
    // a unit already fighting is left to fight (unless forced), and a unit
    // already heading to roughly the same spot isn't re-pathed.
    orderTo(c, x, y, facing, force = false) {
        x = clampW(x); y = clampH(y);
        c.holdFacing = facing;

        const goal = c.aiGoal;
        const goalMoved = !goal || Math.hypot(goal.x - x, goal.y - y) > 35;
        c.aiGoal = { x, y };

        // Let engaged units keep fighting unless we're pulling them out.
        if (c.state === 'fighting' && !force) return;
        if (c.state === 'routing') return;

        // Effectively already there.
        if (Math.hypot(c.x - x, c.y - y) < 22) {
            c.holding = true;
            c.holdTarget = { x, y };
            if (c.state === 'moving' && !c.path) c.state = 'idle';
            return;
        }
        // Already marching to essentially this spot.
        if (!goalMoved && !force && (c.state === 'moving' && c.path)) return;

        const path = findPath(this.app.map, { x: c.x, y: c.y }, { x, y }, c.ballRadius);
        if (path) {
            c.setPath(path);
            c.holding = true;
            c.holdFacing = facing;
            c.holdTarget = { x, y };
        }
    }
}

// --- Battlefield helpers ----------------------------------------------------

function centroid(list) {
    let x = 0, y = 0;
    for (const c of list) { x += c.x; y += c.y; }
    return { x: x / list.length, y: y / list.length };
}

function strength(list) {
    // Men, weighted by firepower and current morale — a fair proxy for combat
    // value that the posture logic compares between the two sides.
    let s = 0;
    for (const c of list) s += c.men * c.stats.firepower * (0.5 + 0.5 * c.morale / 100);
    return s;
}

function avg(nums) {
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function atGoal(c, tol) {
    if (!c.aiGoal) return true;
    return Math.hypot(c.x - c.aiGoal.x, c.y - c.aiGoal.y) < tol;
}

// The enemy's more exposed flank: the side (along the perp axis) whose extreme
// unit is farther from the enemy centre, or the side its guns sit on (go for
// the artillery). Returns { side: -1|1, span }.
function enemyFlank(foe, foeC, perpX, perpY) {
    let maxP = -Infinity, minP = Infinity, gunSide = 0;
    for (const c of foe) {
        const p = (c.x - foeC.x) * perpX + (c.y - foeC.y) * perpY;
        if (p > maxP) maxP = p;
        if (p < minP) minP = p;
        if (c.type === 'artillery') gunSide = p >= 0 ? 1 : -1;
    }
    const span = Math.max(40, (maxP - minP) / 2);
    let side = gunSide || (Math.abs(maxP) >= Math.abs(minP) ? 1 : -1);
    return { side, span };
}

// Search a disk around (cx, cy) for the highest passable ground, lightly
// preferring points nearer the requested centre. Falls back to the centre.
function bestGround(map, cx, cy, searchR, ballR) {
    const grid = getReachGrid(map, ballR);
    let best = { x: clampW(cx), y: clampH(cy) }, bestScore = -Infinity;
    const step = 14;
    for (let y = cy - searchR; y <= cy + searchR; y += step) {
        for (let x = cx - searchR; x <= cx + searchR; x += step) {
            if (x < 10 || y < 10 || x > WORLD_W - 10 || y > WORLD_H - 10) continue;
            const dist = Math.hypot(x - cx, y - cy);
            if (dist > searchR) continue;
            const gx = Math.round(x / CELL), gy = Math.round(y / CELL);
            const gi = gy * GRID_W + gx;
            if (!grid[gi]) continue;
            const score = map.elevation[gi] * 2 - dist / searchR;
            if (score > bestScore) { bestScore = score; best = { x, y }; }
        }
    }
    return best;
}
