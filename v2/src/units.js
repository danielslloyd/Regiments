// A Company is the basic unit: a block of soldier dots that marches in
// column and deploys into line when halted or fighting.

import { elevationAt, isForestAt } from './terrain.js';
import { corridorHalfWidth } from './pathfinding.js';

// ballR is the unit's ball-fitting radius in grid cells (used by pathfinding
// and corridor-width queries): heavier units fit through fewer gaps.
const TYPE_STATS = {
    infantry:  { men: 30, speed: 28, range: 60,  firepower: 1.0, dotR: 1.6, ballR: 1.6 },
    cavalry:   { men: 16, speed: 55, range: 50,  firepower: 0.9, dotR: 2.1, ballR: 2.4 },
    artillery: { men: 6,  speed: 14, range: 150, firepower: 4.0, dotR: 2.8, ballR: 3.6 }
};

export const SIDE_COLORS = {
    1: { main: '#2b4f8e', light: '#5b7fc0' },
    2: { main: '#9e2b25', light: '#c95f57' }
};

// Seconds of stationary work to fully entrench.
const DIG_IN_TIME = 6;
// Below this range the enemy is at the parapet and earthworks no longer shield.
const HAND_TO_HAND = 22;

let nextId = 1;

export class Company {
    constructor(side, type, x, y) {
        this.id = nextId++;
        this.side = side;            // 1 = blue, 2 = red
        this.type = type;
        this.x = x;
        this.y = y;
        this.facing = side === 1 ? 0 : Math.PI; // blue faces east, red west
        this.stats = TYPE_STATS[type];
        this.ballRadius = this.stats.ballR;
        this.men = this.stats.men;
        // How wide (world units, per side) the unit may deploy while marching;
        // updated from the local reachable corridor each frame it moves.
        this.marchHalfWidth = 30;
        this.morale = 100;
        this.state = 'idle';         // idle | moving | fighting | routing
        this.path = null;
        this.pathIndex = 0;
        this.fireCooldown = 0;
        this.target = null;
        // Defensive works: 0 = in the open, 1 = fully entrenched.
        this.entrenchment = 0;
        this.digInOrdered = false;
        // Hold-line orders: hold a position and face a fixed direction.
        this.holding = false;
        this.holdFacing = null;
        this.holdTarget = null;
        // Recomputed each frame from the tactical situation.
        this.incomingMult = 1;
        this.flanked = false;
        // Set by the AI to remember where it last sent this company.
        this.aiGoal = null;
        // Soldier dots: current positions + formation slot offsets
        this.dots = [];
        for (let i = 0; i < this.men; i++) {
            this.dots.push({ x, y, alive: true });
        }
        this.snapToFormation();
    }

    get alive() { return this.men > 0; }

    setPath(path) {
        if (this.state === 'routing') return;
        this.path = path;
        this.pathIndex = 0;
        this.target = null;
        this.state = path && path.length > 1 ? 'moving' : 'idle';
        // Marching abandons any earthworks and cancels the dig-in effort.
        if (this.state === 'moving') {
            this.entrenchment = 0;
            this.digInOrdered = false;
        }
    }

    // Order the unit to entrench where it stands. It only makes progress while
    // stationary (see update); issuing a move cancels it.
    orderDigIn() {
        if (this.state === 'routing') return;
        this.digInOrdered = true;
    }

    // Halt in place, dropping any move/hold order (keeps entrenchment).
    orderStop() {
        if (this.state === 'routing') return;
        this.path = null;
        this.holding = false;
        this.holdTarget = null;
        if (this.state === 'moving') this.state = 'idle';
    }

    // Effective firing range, extended a little when shooting downhill.
    effectiveRange(map, target) {
        const dz = elevationAt(map, this.x, this.y) - elevationAt(map, target.x, target.y);
        return this.stats.range * (1 + Math.max(0, dz) * 0.04);
    }

    // Fire a volley at target, factoring in the high-ground advantage and the
    // offensive edge from being dug in. Defensive modifiers (cover, earthworks,
    // flanking) are applied on the receiving end via incomingMult.
    fireAt(target, map) {
        const dz = elevationAt(map, this.x, this.y) - elevationAt(map, target.x, target.y);
        const highGround = 1 + Math.max(-0.4, Math.min(0.7, dz * 0.13));
        const dugOffense = 1 + this.entrenchment * 0.2;
        const volley = this.men * this.stats.firepower * 0.08 * highGround * dugOffense;
        target.takeCasualties(volley);
    }

    // Formation slot offsets in local space (x = along facing, y = across).
    // Column while moving (narrow front), line when idle/fighting (wide front).
    formationSlots() {
        const alive = this.dots.filter(d => d.alive).length;
        const spacing = this.stats.dotR * 2.6;
        const slots = [];
        if (this.state === 'moving') {
            // March as wide abreast as the reachable corridor allows: fit as
            // many files as span the corridor, then stack the rest in rows
            // behind. Defiles squeeze the column to a single file.
            const maxFiles = this.type === 'artillery' ? 2 : 8;
            const fitFiles = Math.floor((this.marchHalfWidth * 2) / spacing) + 1;
            const filesAcross = Math.max(1, Math.min(maxFiles, alive, fitFiles));
            for (let i = 0; i < alive; i++) {
                const row = Math.floor(i / filesAcross);
                const col = i % filesAcross;
                const rowLen = Math.min(filesAcross, alive - row * filesAcross);
                slots.push({
                    along: -row * spacing,
                    across: (col - (rowLen - 1) / 2) * spacing
                });
            }
        } else {
            const ranks = this.type === 'artillery' ? 1 : 2;
            const perRank = Math.ceil(alive / ranks);
            for (let i = 0; i < alive; i++) {
                const rank = Math.floor(i / perRank);
                const col = i % perRank;
                const rankLen = Math.min(perRank, alive - rank * perRank);
                slots.push({
                    along: -rank * spacing,
                    across: (col - (rankLen - 1) / 2) * spacing
                });
            }
        }
        return slots;
    }

    slotWorldPositions() {
        const cos = Math.cos(this.facing), sin = Math.sin(this.facing);
        return this.formationSlots().map(s => ({
            x: this.x + cos * s.along - sin * s.across,
            y: this.y + sin * s.along + cos * s.across
        }));
    }

    snapToFormation() {
        const targets = this.slotWorldPositions();
        const alive = this.dots.filter(d => d.alive);
        for (let i = 0; i < alive.length; i++) {
            alive[i].x = targets[i].x;
            alive[i].y = targets[i].y;
        }
    }

    terrainSpeedFactor(map) {
        let factor = 1;
        if (isForestAt(map, this.x, this.y)) factor *= 0.55;
        // Penalize the slope along the direction of travel.
        if (this.path && this.pathIndex < this.path.length) {
            const ahead = this.path[this.pathIndex];
            const dist = Math.hypot(ahead.x - this.x, ahead.y - this.y) || 1;
            const here = elevationAt(map, this.x, this.y);
            const there = elevationAt(map, ahead.x, ahead.y);
            const grade = Math.abs(there - here) / (dist / 10);
            factor *= 1 / (1 + grade * 1.2);
        }
        return Math.max(0.2, factor);
    }

    update(dt, map, companies) {
        if (!this.alive) return;
        this.fireCooldown = Math.max(0, this.fireCooldown - dt);

        // --- Survey nearby enemies ---
        let nearest = null, nearestDist = Infinity;
        const threats = [];
        for (const other of companies) {
            if (other.side === this.side || !other.alive) continue;
            const dx = other.x - this.x, dy = other.y - this.y;
            const d = Math.hypot(dx, dy);
            if (d < nearestDist) { nearestDist = d; nearest = other; }
            if (d < this.stats.range * 1.5) threats.push(Math.atan2(dy, dx));
        }

        // --- Flanking: fire arriving from a wide arc is far more demoralizing
        // and deadly than a clean frontal fight. Measure the angular arc the
        // attackers occupy; a spread beyond ~145 deg counts as being flanked.
        this.flanked = false;
        let flankFactor = 0;
        if (threats.length >= 2) {
            threats.sort((a, b) => a - b);
            let maxGap = (threats[0] + Math.PI * 2) - threats[threats.length - 1];
            for (let i = 1; i < threats.length; i++) maxGap = Math.max(maxGap, threats[i] - threats[i - 1]);
            const spread = Math.PI * 2 - maxGap;
            if (spread > Math.PI * 0.8) {
                this.flanked = true;
                flankFactor = Math.min(1, (spread - Math.PI * 0.8) / (Math.PI * 0.9));
            }
        }

        // --- Entrenchment: build while ordered and stationary, lost on the march.
        if (this.digInOrdered && this.state !== 'moving' && this.state !== 'routing') {
            this.entrenchment = Math.min(1, this.entrenchment + dt / DIG_IN_TIME);
        }

        // --- Situational incoming-damage multiplier (used by takeCasualties). ---
        let incoming = 1;
        const closeUp = nearestDist < HAND_TO_HAND;
        if (this.entrenchment > 0 && !closeUp) incoming *= 1 - this.entrenchment * 0.55;
        if (isForestAt(map, this.x, this.y)) incoming *= 0.75;
        if (flankFactor > 0) incoming *= 1 + flankFactor * 0.7;
        this.incomingMult = incoming;

        if (this.state === 'routing') {
            // Flee toward own map edge; recover when far from enemies.
            const fleeDir = this.side === 1 ? Math.PI : 0;
            this.facing = fleeDir;
            this.x += Math.cos(fleeDir) * this.stats.speed * 1.2 * dt;
            this.y += (Math.random() - 0.5) * 10 * dt;
            this.morale += dt * 4;
            if (this.morale >= 50 || nearestDist > 320) {
                this.morale = Math.max(this.morale, 50);
                this.state = 'idle';
            }
        } else if (nearest && nearestDist <= this.effectiveRange(map, nearest)) {
            // --- Fighting: halt, face the enemy, exchange fire ---
            this.state = 'fighting';
            this.path = null;
            this.facing = Math.atan2(nearest.y - this.y, nearest.x - this.x);
            this.target = nearest;
            if (this.fireCooldown <= 0) {
                this.fireCooldown = 1.2;
                this.fireAt(nearest, map);
            }
            // Being enveloped saps nerve even mid-fight.
            if (flankFactor > 0) this.morale = Math.max(0, this.morale - dt * 7 * flankFactor);
        } else {
            if (this.state === 'fighting') this.state = 'idle';
            this.target = null;
            // --- Movement along path ---
            if (this.state === 'moving' && this.path) {
                // Widen/narrow the marching front to the local corridor.
                this.marchHalfWidth = corridorHalfWidth(map, this.ballRadius, this.x, this.y, this.facing);
                const speed = this.stats.speed * this.terrainSpeedFactor(map);
                let remaining = speed * dt;
                while (remaining > 0 && this.pathIndex < this.path.length) {
                    const wp = this.path[this.pathIndex];
                    const dx = wp.x - this.x, dy = wp.y - this.y;
                    const d = Math.hypot(dx, dy);
                    if (d < 1) { this.pathIndex++; continue; }
                    this.facing = Math.atan2(dy, dx);
                    const step = Math.min(remaining, d);
                    this.x += (dx / d) * step;
                    this.y += (dy / d) * step;
                    remaining -= step;
                }
                if (this.pathIndex >= this.path.length) {
                    this.path = null;
                    this.state = 'idle';
                }
            } else if (this.holding && this.holdFacing != null) {
                // Arrived on the hold line: dress the ranks to the ordered facing.
                this.facing = this.holdFacing;
            }
            // Slow morale recovery when out of combat; entrenched troops rally faster.
            this.morale = Math.min(100, this.morale + dt * (2 + this.entrenchment * 2));
        }

        // --- Move dots toward formation slots ---
        const targets = this.slotWorldPositions();
        const alive = this.dots.filter(d => d.alive);
        const catchUp = this.state === 'moving' ? 3.5 : 2.2;
        for (let i = 0; i < alive.length; i++) {
            const t = targets[i];
            alive[i].x += (t.x - alive[i].x) * Math.min(1, catchUp * dt);
            alive[i].y += (t.y - alive[i].y) * Math.min(1, catchUp * dt);
        }
    }

    takeCasualties(amount) {
        // Cover, earthworks, and flanking modify how much fire actually tells.
        amount *= this.incomingMult;
        // Fractional casualties accumulate
        this._pendingCasualties = (this._pendingCasualties || 0) + amount;
        // Dug-in troops keep their composure under fire; a steady position is
        // worth a good deal of nerve.
        const moraleHit = (100 / this.stats.men) * 1.5 * (1 - this.entrenchment * 0.35);
        while (this._pendingCasualties >= 1 && this.men > 0) {
            this._pendingCasualties -= 1;
            const alive = this.dots.filter(d => d.alive);
            const victim = alive[Math.floor(Math.random() * alive.length)];
            victim.alive = false;
            this.men--;
            this.morale -= moraleHit;
        }
        // Entrenched men hold their ground far longer before breaking.
        const routThreshold = this.entrenchment > 0.3 ? 12 : 25;
        if (this.morale < routThreshold && this.state !== 'routing' && this.alive) {
            this.state = 'routing';
            this.path = null;
            this.holding = false;
            this.digInOrdered = false;
            this.entrenchment = 0;
        }
        this.morale = Math.max(0, this.morale);
    }

    draw(ctx, selected) {
        if (!this.alive) return;
        const colors = SIDE_COLORS[this.side];

        if (selected) {
            ctx.strokeStyle = '#f0c95c';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, 14, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Path preview
        if (this.path && this.state === 'moving') {
            ctx.strokeStyle = colors.light;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            for (let i = this.pathIndex; i < this.path.length; i++) ctx.lineTo(this.path[i].x, this.path[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
        }

        // Earthworks: a berm drawn across the unit's front, darkening and
        // thickening as the entrenchment deepens. A faint pulse shows digging
        // still in progress.
        if (this.entrenchment > 0.02) {
            const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
            const px = -fy, py = fx;
            const off = 11, halfW = 15;
            const cx = this.x + fx * off, cy = this.y + fy * off;
            const digging = this.digInOrdered && this.entrenchment < 1;
            ctx.strokeStyle = `rgba(74,58,38,${0.35 + 0.55 * this.entrenchment})`;
            ctx.lineWidth = 1.2 + 3 * this.entrenchment;
            ctx.setLineDash(digging ? [3, 3] : []);
            ctx.beginPath();
            ctx.moveTo(cx - px * halfW, cy - py * halfW);
            ctx.lineTo(cx + px * halfW, cy + py * halfW);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const flash = this.state === 'fighting' && this.fireCooldown > 1.05;
        ctx.fillStyle = this.state === 'routing' ? colors.light : colors.main;
        for (const dot of this.dots) {
            if (!dot.alive) continue;
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, this.stats.dotR, 0, Math.PI * 2);
            ctx.fill();
        }
        if (flash && this.target) {
            ctx.strokeStyle = '#f5e9a0';
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.target.x, this.target.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Morale bar when damaged
        if (this.men < this.stats.men || this.morale < 100) {
            const w = 18;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(this.x - w / 2, this.y - 16, w, 2.5);
            ctx.fillStyle = this.morale > 50 ? '#6aa84f' : '#cc4125';
            ctx.fillRect(this.x - w / 2, this.y - 16, w * (this.morale / 100), 2.5);
        }
    }
}
