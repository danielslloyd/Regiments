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

        // --- Find enemy in range ---
        let nearest = null, nearestDist = Infinity;
        for (const other of companies) {
            if (other.side === this.side || !other.alive) continue;
            const d = Math.hypot(other.x - this.x, other.y - this.y);
            if (d < nearestDist) { nearestDist = d; nearest = other; }
        }

        if (this.state === 'routing') {
            // Flee toward own map edge; recover when far from enemies.
            const fleeDir = this.side === 1 ? Math.PI : 0;
            this.facing = fleeDir;
            this.x += Math.cos(fleeDir) * this.stats.speed * 1.2 * dt;
            this.y += (Math.random() - 0.5) * 10 * dt;
            this.morale += dt * 4;
            if (this.morale >= 50 || nearestDist > 300) {
                this.morale = Math.max(this.morale, 50);
                this.state = 'idle';
            }
        } else if (nearest && nearestDist <= this.stats.range) {
            // --- Fighting: halt, face the enemy, exchange fire ---
            this.state = 'fighting';
            this.path = null;
            this.facing = Math.atan2(nearest.y - this.y, nearest.x - this.x);
            this.target = nearest;
            if (this.fireCooldown <= 0) {
                this.fireCooldown = 1.2;
                const volley = this.men * this.stats.firepower * 0.08;
                nearest.takeCasualties(volley);
            }
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
            }
            // Slow morale recovery when out of combat
            this.morale = Math.min(100, this.morale + dt * 2);
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
        // Fractional casualties accumulate
        this._pendingCasualties = (this._pendingCasualties || 0) + amount;
        while (this._pendingCasualties >= 1 && this.men > 0) {
            this._pendingCasualties -= 1;
            const alive = this.dots.filter(d => d.alive);
            const victim = alive[Math.floor(Math.random() * alive.length)];
            victim.alive = false;
            this.men--;
            this.morale -= 100 / this.stats.men * 1.5;
        }
        if (this.morale < 25 && this.state !== 'routing' && this.alive) {
            this.state = 'routing';
            this.path = null;
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
