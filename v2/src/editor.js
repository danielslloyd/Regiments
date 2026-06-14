// Editor mode: terrain brushes, stream sources, and unit placement.

import { generateMap, applyBrush, addSource, moveSource, isWaterAt, CELL } from './terrain.js';
import { Company } from './units.js';

const MIN_UNIT_SPACING = 24;

export class Editor {
    constructor(app) {
        this.app = app;
        this.tool = 'raise';        // raise|lower|smooth|forest|clear|river|unit|erase-unit
        this.brushRadius = 70;
        this.brushStrength = 0.2;
        this.streamSize = 2;
        this.unitSide = 1;
        this.unitType = 'infantry';
        this.painting = false;
        this.draggingSource = null; // river inlet currently being dragged
        this.cursor = null;         // {x, y} world coords for brush preview
    }

    // The river inlet near a world point, if any (for click-to-drag).
    sourceAt(wx, wy) {
        for (const s of this.app.map.sources) {
            if (Math.hypot(s.gx * CELL - wx, s.gy * CELL - wy) < 16) return s;
        }
        return null;
    }

    onPointerDown(wx, wy, button) {
        if (button !== 0) return;
        if (this.tool === 'unit') {
            this.placeUnit(wx, wy);
        } else if (this.tool === 'erase-unit') {
            this.eraseUnitAt(wx, wy);
        } else if (this.tool === 'river') {
            // Grab an existing inlet to move it, otherwise drop a new one.
            const hit = this.sourceAt(wx, wy);
            if (hit) {
                this.draggingSource = hit;
            } else {
                addSource(this.app.map, wx, wy, this.streamSize);
                this.app.terrainRenderer.invalidate();
            }
        } else {
            this.painting = true;
            this.paint(wx, wy);
        }
    }

    onPointerMove(wx, wy) {
        this.cursor = { x: wx, y: wy };
        if (this.draggingSource) {
            moveSource(this.app.map, this.draggingSource, wx, wy);
            this.app.terrainRenderer.invalidate();
        } else if (this.painting) {
            this.paint(wx, wy);
        }
    }

    onPointerUp() { this.painting = false; this.draggingSource = null; }

    paint(wx, wy) {
        applyBrush(this.app.map, this.tool, wx, wy, this.brushRadius, this.brushStrength);
        this.app.terrainRenderer.invalidate();
    }

    placeUnit(wx, wy) {
        if (isWaterAt(this.app.map, wx, wy)) {
            this.app.flashStatus("Can't place units in water.");
            return;
        }
        for (const c of this.app.companies) {
            if (Math.hypot(c.x - wx, c.y - wy) < MIN_UNIT_SPACING) {
                this.app.flashStatus('Too close to another unit.');
                return;
            }
        }
        this.app.companies.push(new Company(this.unitSide, this.unitType, wx, wy));
    }

    eraseUnitAt(wx, wy) {
        const companies = this.app.companies;
        for (let i = companies.length - 1; i >= 0; i--) {
            if (Math.hypot(companies[i].x - wx, companies[i].y - wy) < 16) {
                companies.splice(i, 1);
                return;
            }
        }
    }

    regenerate(seed, style) {
        this.app.map = generateMap(seed, style);
        this.app.companies = [];
        this.app.terrainRenderer.invalidate();
    }

    draw(ctx, zoom) {
        // Stream source markers
        for (const s of this.app.map.sources) {
            ctx.strokeStyle = '#1d5e8a';
            ctx.fillStyle = 'rgba(130,168,188,0.9)';
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.arc(s.gx * CELL, s.gy * CELL, 4 + s.size * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        // Brush cursor preview
        const brushTools = ['raise', 'lower', 'smooth', 'forest', 'clear'];
        if (this.cursor && brushTools.includes(this.tool)) {
            ctx.strokeStyle = 'rgba(60,40,20,0.6)';
            ctx.lineWidth = 1 / zoom;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(this.cursor.x, this.cursor.y, this.brushRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}
