// Hold-line formation: given a line the player (or AI) drew and a facing toward
// the enemy, deploy a mixed force along it with the historically sensible roles
// — infantry hold the front, artillery sits behind the centre, cavalry guards
// the flanks. Each company is pathfound to its slot and told to hold + face.

import { findPath } from './pathfinding.js';
import { WORLD_W, WORLD_H } from './terrain.js';

// Spacing between infantry files on the line, depth of the gun line behind it,
// and how far past each end the cavalry sits.
const FRONT_SPACING = 46;
const ARTY_DEPTH = 58;
const FLANK_OFFSET = 34;

const clampW = v => Math.max(6, Math.min(WORLD_W - 6, v));
const clampH = v => Math.max(6, Math.min(WORLD_H - 6, v));

// Assign `companies` to hold the line p0->p1, facing `facing` (radians, toward
// the enemy). Mutates each company (issues a path + hold order). p0/p1 in world
// coords. If the drawn line is too short for the infantry, it is widened.
export function assignHoldLine(map, companies, p0, p1, facing) {
    const list = companies.filter(c => c.alive);
    if (!list.length) return;

    let dx = p1.x - p0.x, dy = p1.y - p0.y;
    let len = Math.hypot(dx, dy);
    let ux, uy;
    if (len < 1) {
        // A click rather than a drag: lay the line perpendicular to the facing.
        ux = -Math.sin(facing); uy = Math.cos(facing);
    } else {
        ux = dx / len; uy = dy / len;
    }
    // "Back" points away from the enemy — where the guns belong.
    const backX = -Math.cos(facing), backY = -Math.sin(facing);

    let cavalry = list.filter(c => c.type === 'cavalry');
    let artillery = list.filter(c => c.type === 'artillery');
    let front = list.filter(c => c.type !== 'cavalry' && c.type !== 'artillery');
    // A line has to have somebody standing on it. With no infantry, put the
    // cavalry on the line; failing that, the guns hold it themselves.
    if (!front.length) {
        if (cavalry.length) { front = cavalry; cavalry = []; }
        else { front = artillery; artillery = []; }
    }

    // Widen a too-short line so the front rank isn't bunched on one spot.
    const minSpan = Math.max(0, front.length - 1) * FRONT_SPACING;
    if (len < minSpan) {
        const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
        const half = minSpan / 2;
        p0 = { x: cx - ux * half, y: cy - uy * half };
        p1 = { x: cx + ux * half, y: cy + uy * half };
        len = minSpan;
    }
    const at = t => ({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });

    const orders = [];

    // Front rank: infantry (or whatever's left) spread evenly along the line.
    front.forEach((c, i) => {
        const t = front.length === 1 ? 0.5 : i / (front.length - 1);
        const p = at(t);
        orders.push({ c, x: p.x, y: p.y });
    });

    // Cavalry: alternate to each flank, ranking outward if there are several.
    cavalry.forEach((c, i) => {
        const left = i % 2 === 0;
        const rank = Math.floor(i / 2);
        const end = left ? at(0) : at(1);
        const dir = left ? -1 : 1;
        const reach = FLANK_OFFSET + rank * 28;
        orders.push({ c, x: end.x + ux * dir * reach, y: end.y + uy * dir * reach });
    });

    // Artillery: behind the centre, spread a little so the guns don't stack.
    const centre = at(0.5);
    artillery.forEach((c, i) => {
        const spread = (i - (artillery.length - 1) / 2) * 36;
        orders.push({
            c,
            x: centre.x + backX * ARTY_DEPTH + ux * spread,
            y: centre.y + backY * ARTY_DEPTH + uy * spread
        });
    });

    for (const o of orders) {
        const dest = { x: clampW(o.x), y: clampH(o.y) };
        o.c.holding = true;
        o.c.holdFacing = facing;
        o.c.holdTarget = dest;
        o.c.aiGoal = dest;
        const path = findPath(map, { x: o.c.x, y: o.c.y }, dest, o.c.ballRadius);
        if (path) o.c.setPath(path);
        // setPath clears holdFacing? No — but it does clear entrenchment/dig-in
        // when it starts a march, which is what we want. Re-assert the hold.
        o.c.holding = true;
        o.c.holdFacing = facing;
        o.c.holdTarget = dest;
    }
}
