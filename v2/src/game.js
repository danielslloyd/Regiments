// Play mode: select companies (click / drag box), issue orders — move
// (right-click), hold a drawn line (Hold Line command), dig in, or halt. The
// opposing side is run by the tactical AI. Ranged combat is resolved in
// Company.update.

import { findPath } from './pathfinding.js';
import { assignHoldLine } from './formations.js';
import { AIController } from './ai.js';

const PLAYER_SIDE = 1;

export class Game {
    constructor(app) {
        this.app = app;
        this.selected = new Set();
        this.dragStart = null;      // world coords for selection box
        this.dragEnd = null;
        this.paused = false;
        this.speed = 1;
        // 'select' = drag selects units; 'holdline' = drag draws a hold line.
        this.commandMode = 'select';
        this.lineStart = null;
        this.lineEnd = null;
        this.ai = new AIController(app, 2, 'normal');
    }

    reset() {
        this.selected.clear();
        this.dragStart = null;
        this.dragEnd = null;
        this.lineStart = null;
        this.lineEnd = null;
        this.commandMode = 'select';
        this.paused = false;
        this.ai.reset();
        this.updateCommandButtons();
    }

    // --- Command mode -------------------------------------------------------

    setCommandMode(mode) {
        // Hold Line needs a selection to act on.
        if (mode === 'holdline' && !this.selectedCompanies().length) {
            this.app.flashStatus('Select companies first, then draw a hold line.');
            return;
        }
        this.commandMode = this.commandMode === mode ? 'select' : mode;
        this.lineStart = this.lineEnd = null;
        this.updateCommandButtons();
    }

    updateCommandButtons() {
        const btn = document.getElementById('btn-holdline');
        if (btn) btn.classList.toggle('active', this.commandMode === 'holdline');
    }

    selectedCompanies() {
        return this.app.companies.filter(c => this.selected.has(c.id) && c.alive);
    }

    // --- Input --------------------------------------------------------------

    onPointerDown(wx, wy, button, shiftKey) {
        if (button === 0) {
            if (this.commandMode === 'holdline') {
                this.lineStart = { x: wx, y: wy };
                this.lineEnd = { x: wx, y: wy };
                return;
            }
            this.dragStart = { x: wx, y: wy };
            this.dragEnd = { x: wx, y: wy };
            if (!shiftKey) this.selected.clear();
        } else if (button === 2) {
            // Right-click always issues a plain move (and cancels line drawing).
            if (this.commandMode === 'holdline') { this.setCommandMode('select'); return; }
            this.issueMoveOrder(wx, wy);
        }
    }

    onPointerMove(wx, wy) {
        if (this.lineStart) this.lineEnd = { x: wx, y: wy };
        else if (this.dragStart) this.dragEnd = { x: wx, y: wy };
    }

    onPointerUp(wx, wy, button) {
        if (button !== 0) return;
        if (this.lineStart) {
            this.finishHoldLine(this.lineStart, { x: wx, y: wy });
            this.lineStart = this.lineEnd = null;
            this.commandMode = 'select';
            this.updateCommandButtons();
            return;
        }
        if (!this.dragStart) return;
        const x0 = Math.min(this.dragStart.x, wx), x1 = Math.max(this.dragStart.x, wx);
        const y0 = Math.min(this.dragStart.y, wy), y1 = Math.max(this.dragStart.y, wy);
        const isClick = (x1 - x0) < 5 && (y1 - y0) < 5;

        for (const c of this.app.companies) {
            if (!c.alive || c.side !== PLAYER_SIDE) continue; // player controls blue
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

    // --- Orders -------------------------------------------------------------

    issueMoveOrder(wx, wy) {
        const targets = this.selectedCompanies();
        if (!targets.length) return;
        // Spread destinations so companies don't stack on one point.
        const n = targets.length;
        targets.forEach((c, i) => {
            const angle = (i / n) * Math.PI * 2;
            const r = n > 1 ? 18 : 0;
            const dest = { x: wx + Math.cos(angle) * r, y: wy + Math.sin(angle) * r };
            const path = findPath(this.app.map, { x: c.x, y: c.y }, dest, c.ballRadius);
            // A plain move drops any hold/entrench order.
            c.holding = false;
            c.holdTarget = null;
            if (path) c.setPath(path);
        });
    }

    finishHoldLine(p0, p1) {
        const companies = this.selectedCompanies();
        if (!companies.length) return;
        const facing = this.holdLineFacing(p0, p1);
        assignHoldLine(this.app.map, companies, p0, p1, facing);
        this.app.flashStatus(`Holding the line — ${companies.length} companies deploying.`);
    }

    // Pick the line normal that points toward the enemy (so the ranks face the
    // right way). Falls back to facing east for the blue player.
    holdLineFacing(p0, p1) {
        const midx = (p0.x + p1.x) / 2, midy = (p0.y + p1.y) / 2;
        let nx = -(p1.y - p0.y), ny = (p1.x - p0.x);
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const foes = this.app.companies.filter(c => c.side !== PLAYER_SIDE && c.alive);
        let tx = 1, ty = 0;
        if (foes.length) {
            let ex = 0, ey = 0;
            for (const f of foes) { ex += f.x; ey += f.y; }
            tx = ex / foes.length - midx; ty = ey / foes.length - midy;
        }
        if (nx * tx + ny * ty < 0) { nx = -nx; ny = -ny; }
        return Math.atan2(ny, nx);
    }

    orderDigIn() {
        const targets = this.selectedCompanies();
        if (!targets.length) { this.app.flashStatus('Select companies to dig in.'); return; }
        for (const c of targets) c.orderDigIn();
        this.app.flashStatus(`${targets.length} companies digging in.`);
    }

    orderStop() {
        for (const c of this.selectedCompanies()) c.orderStop();
    }

    // --- Loop ---------------------------------------------------------------

    update(dt) {
        if (this.paused) return;
        const scaled = dt * this.speed;
        this.ai.update(scaled);
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

        // Hold-line preview: the drawn line plus little pips at the ends and an
        // arrow showing which way the ranks will face.
        if (this.lineStart && this.lineEnd) {
            const p0 = this.lineStart, p1 = this.lineEnd;
            ctx.strokeStyle = '#f0c95c';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
            ctx.setLineDash([]);
            const facing = this.holdLineFacing(p0, p1);
            const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
            ctx.strokeStyle = 'rgba(240,201,92,0.8)';
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(facing) * 26, my + Math.sin(facing) * 26);
            ctx.stroke();
            for (const p of [p0, p1]) {
                ctx.fillStyle = '#f0c95c';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    statusText() {
        const blue = this.app.companies.filter(c => c.side === 1 && c.alive);
        const red = this.app.companies.filter(c => c.side === 2 && c.alive);
        const blueMen = blue.reduce((s, c) => s + c.men, 0);
        const redMen = red.reduce((s, c) => s + c.men, 0);
        if (!blue.length && red.length) return 'Red side wins!';
        if (!red.length && blue.length) return 'Blue side wins!';
        if (!red.length && !blue.length) return 'Mutual destruction.';
        return `Blue: ${blue.length} companies, ${blueMen} men  |  Red: ${red.length} companies, ${redMen} men`;
    }
}
