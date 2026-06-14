// Play mode: select companies (click / drag box), right-click to issue move
// orders via A* pathfinding; simple ranged combat handled in Company.update.

import { findPath } from './pathfinding.js';

export class Game {
    constructor(app) {
        this.app = app;
        this.selected = new Set();
        this.dragStart = null;      // world coords for selection box
        this.dragEnd = null;
        this.paused = false;
        this.speed = 1;
    }

    reset() {
        this.selected.clear();
        this.dragStart = null;
        this.dragEnd = null;
        this.paused = false;
    }

    onPointerDown(wx, wy, button, shiftKey) {
        if (button === 0) {
            this.dragStart = { x: wx, y: wy };
            this.dragEnd = { x: wx, y: wy };
            if (!shiftKey) this.selected.clear();
        } else if (button === 2) {
            this.issueMoveOrder(wx, wy);
        }
    }

    onPointerMove(wx, wy) {
        if (this.dragStart) this.dragEnd = { x: wx, y: wy };
    }

    onPointerUp(wx, wy, button) {
        if (button !== 0 || !this.dragStart) return;
        const x0 = Math.min(this.dragStart.x, wx), x1 = Math.max(this.dragStart.x, wx);
        const y0 = Math.min(this.dragStart.y, wy), y1 = Math.max(this.dragStart.y, wy);
        const isClick = (x1 - x0) < 5 && (y1 - y0) < 5;

        for (const c of this.app.companies) {
            if (!c.alive || c.side !== 1) continue; // player controls blue
            const inside = isClick
                ? Math.hypot(c.x - wx, c.y - wy) < 14
                : (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1);
            if (inside) {
                this.selected.add(c.id);
                if (isClick) break;
            }
        }
        this.dragStart = null;
        this.dragEnd = null;
    }

    issueMoveOrder(wx, wy) {
        const targets = this.app.companies.filter(c => this.selected.has(c.id) && c.alive);
        if (!targets.length) return;
        // Spread destinations so companies don't stack on one point.
        const n = targets.length;
        targets.forEach((c, i) => {
            const angle = (i / n) * Math.PI * 2;
            const r = n > 1 ? 18 : 0;
            const dest = { x: wx + Math.cos(angle) * r, y: wy + Math.sin(angle) * r };
            const path = findPath(this.app.map, { x: c.x, y: c.y }, dest, c.ballRadius);
            if (path) c.setPath(path);
        });
    }

    update(dt) {
        if (this.paused) return;
        const scaled = dt * this.speed;
        for (const c of this.app.companies) {
            c.update(scaled, this.app.map, this.app.companies);
        }
    }

    draw(ctx) {
        for (const c of this.app.companies) {
            c.draw(ctx, this.selected.has(c.id));
        }
        // Selection box
        if (this.dragStart && this.dragEnd) {
            ctx.strokeStyle = 'rgba(240,201,92,0.9)';
            ctx.fillStyle = 'rgba(240,201,92,0.12)';
            ctx.lineWidth = 1;
            const x = Math.min(this.dragStart.x, this.dragEnd.x);
            const y = Math.min(this.dragStart.y, this.dragEnd.y);
            const w = Math.abs(this.dragEnd.x - this.dragStart.x);
            const h = Math.abs(this.dragEnd.y - this.dragStart.y);
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        }
    }

    statusText() {
        const blue = this.app.companies.filter(c => c.side === 1 && c.alive);
        const red = this.app.companies.filter(c => c.side === 2 && c.alive);
        const blueMen = blue.reduce((s, c) => s + c.men, 0);
        const redMen = red.reduce((s, c) => s + c.men, 0);
        if (!blue.length && red.length) return 'Red side wins!';
        if (!red.length && blue.length) return 'Blue side wins!';
        return `Blue: ${blue.length} companies, ${blueMen} men  |  Red: ${red.length} companies, ${redMen} men`;
    }
}
