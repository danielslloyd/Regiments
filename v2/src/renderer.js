// Terrain rendering: hillshaded parchment base + water + forest + contour lines.
// The terrain layer is expensive, so it's drawn to an offscreen canvas and
// only rebuilt when the map changes.

import { GRID_W, GRID_H, CELL, WORLD_W, WORLD_H, computeIsolines } from './terrain.js';

export class TerrainRenderer {
    constructor() {
        this.layer = document.createElement('canvas');
        this.layer.width = WORLD_W;
        this.layer.height = WORLD_H;
        this.cellCanvas = document.createElement('canvas');
        this.cellCanvas.width = GRID_W;
        this.cellCanvas.height = GRID_H;
        this.dirty = true;
    }

    invalidate() { this.dirty = true; }

    rebuild(map) {
        const cctx = this.cellCanvas.getContext('2d');
        const img = cctx.createImageData(GRID_W, GRID_H);
        const d = img.data;
        const e = map.elevation;

        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const i = y * GRID_W + x;
                // Flat tint by elevation: pale low ground, darker brown highlands.
                // Water is drawn later as smooth vector shapes, not per-cell.
                const t = e[i] / 10;
                let r = 246 - t * 62;
                let g = 233 - t * 80;
                let b = 198 - t * 100;
                if (map.forest[i]) {
                    r = r * 0.55 + 96 * 0.45;
                    g = g * 0.55 + 138 * 0.45;
                    b = b * 0.55 + 86 * 0.45;
                }
                const p = i * 4;
                d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
            }
        }
        cctx.putImageData(img, 0, 0);

        const ctx = this.layer.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, WORLD_W, WORLD_H);
        ctx.drawImage(this.cellCanvas, 0, 0, WORLD_W, WORLD_H);

        // Contour lines
        const isolines = computeIsolines(map, 1);
        for (const { level, segs } of isolines) {
            ctx.strokeStyle = '#7a6448';
            ctx.lineWidth = level % 5 === 0 ? 1.4 : 0.6;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            for (let s = 0; s < segs.length; s += 4) {
                ctx.moveTo(segs[s] * CELL, segs[s + 1] * CELL);
                ctx.lineTo(segs[s + 2] * CELL, segs[s + 3] * CELL);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Water drawn over the contours as smooth vector shapes. River edge
        // strokes go down first, then lakes, then river fills — so edges and
        // lake outlines never show through where rivers meet lakes.
        const riverPaths = collectRiverPaths(map);
        for (const pts of riverPaths) strokeSmooth(ctx, pts, WATER_EDGE, 2.5);
        drawLakes(ctx, map);
        for (const pts of riverPaths) strokeSmooth(ctx, pts, WATER_FILL, 0);
        this.dirty = false;
    }

    draw(ctx, map) {
        if (this.dirty) this.rebuild(map);
        ctx.drawImage(this.layer, 0, 0);
    }
}

const WATER_FILL = 'rgb(130, 168, 188)';
const WATER_EDGE = 'rgb(88, 126, 150)';

// Rivers: smooth tapered strokes along the recorded flow centerlines.
// Each path is a flat [gx, gy, width] list; we downsample, then stroke
// quadratic curves through the midpoints (Catmull-Rom style) per segment
// so the width can grow downstream.
function collectRiverPaths(map) {
    const out = [];
    if (!map.rivers) return out;
    for (const path of map.rivers) {
        const pts = [];
        const n = path.length / 3;
        for (let i = 0; i < n; i += 4) {
            pts.push([(path[i * 3] + 0.5) * CELL, (path[i * 3 + 1] + 0.5) * CELL, path[i * 3 + 2] * CELL]);
        }
        const last = (n - 1) * 3;
        pts.push([(path[last] + 0.5) * CELL, (path[last + 1] + 0.5) * CELL, path[last + 2] * CELL]);
        if (pts.length >= 2) out.push(pts);
    }
    return out;
}

function strokeSmooth(ctx, pts, color, extraWidth) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[Math.max(0, i - 1)];
        const [x1, y1, w1] = pts[i];
        const [x2, y2, w2] = pts[i + 1];
        const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
        ctx.lineWidth = (w1 + w2) + extraWidth; // width is a radius; stroke uses diameter
        ctx.beginPath();
        ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
        ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
        ctx.quadraticCurveTo(x2, y2, (x2 + x3) / 2, (y2 + y3) / 2);
        ctx.stroke();
    }
}

// Lakes: contour the flooded cells with marching squares over a blurred
// mask, then draw each loop as a closed smooth curve.
function drawLakes(ctx, map) {
    if (!map.lakes) return;
    ctx.fillStyle = WATER_FILL;
    ctx.strokeStyle = WATER_EDGE;
    ctx.lineWidth = 1.2;
    for (const cells of map.lakes) {
        for (const loop of lakeOutlines(cells)) {
            if (loop.length < 3) continue;
            ctx.beginPath();
            const m = loop.length;
            ctx.moveTo((loop[0][0] + loop[m - 1][0]) / 2, (loop[0][1] + loop[m - 1][1]) / 2);
            for (let i = 0; i < m; i++) {
                const [x1, y1] = loop[i];
                const [x2, y2] = loop[(i + 1) % m];
                ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }
}

function lakeOutlines(cells) {
    // Bounding box with margin
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
        const x = c % GRID_W, y = (c / GRID_W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const pad = 2;
    const w = maxX - minX + 1 + pad * 2, h = maxY - minY + 1 + pad * 2;
    const mask = new Float32Array(w * h);
    for (const c of cells) {
        mask[((c / GRID_W | 0) - minY + pad) * w + (c % GRID_W) - minX + pad] = 1;
    }
    // One 3x3 blur pass softens the staircase before contouring
    const blurred = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++)
                    sum += mask[(y + dy) * w + x + dx];
            blurred[y * w + x] = sum / 9;
        }
    }

    // Marching squares at 0.5, collecting segments in world coordinates
    const segs = [];
    const lvl = 0.5;
    const toWorld = (gx, gy) => [(gx + minX - pad + 0.5) * CELL, (gy + minY - pad + 0.5) * CELL];
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const v0 = blurred[y * w + x], v1 = blurred[y * w + x + 1];
            const v2 = blurred[(y + 1) * w + x + 1], v3 = blurred[(y + 1) * w + x];
            const code = (v0 >= lvl ? 8 : 0) | (v1 >= lvl ? 4 : 0) | (v2 >= lvl ? 2 : 0) | (v3 >= lvl ? 1 : 0);
            if (code === 0 || code === 15) continue;
            const lerp = (a, b, va, vb) => a + ((lvl - va) / (vb - va)) * (b - a);
            const top = toWorld(lerp(x, x + 1, v0, v1), y);
            const right = toWorld(x + 1, lerp(y, y + 1, v1, v2));
            const bottom = toWorld(lerp(x, x + 1, v3, v2), y + 1);
            const left = toWorld(x, lerp(y, y + 1, v0, v3));
            const add = (a, b) => segs.push([a, b]);
            switch (code) {
                case 1: add(left, bottom); break;
                case 2: add(bottom, right); break;
                case 3: add(left, right); break;
                case 4: add(top, right); break;
                case 5: add(left, top); add(bottom, right); break;
                case 6: add(top, bottom); break;
                case 7: add(left, top); break;
                case 8: add(top, left); break;
                case 9: add(top, bottom); break;
                case 10: add(top, right); add(left, bottom); break;
                case 11: add(top, right); break;
                case 12: add(left, right); break;
                case 13: add(bottom, right); break;
                case 14: add(left, bottom); break;
            }
        }
    }

    // Chain segments into closed loops by matching endpoints
    const key = p => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
    const byPoint = new Map();
    for (const seg of segs) {
        for (const p of [seg[0], seg[1]]) {
            const k = key(p);
            if (!byPoint.has(k)) byPoint.set(k, []);
            byPoint.get(k).push(seg);
        }
    }
    const used = new Set();
    const loops = [];
    for (const start of segs) {
        if (used.has(start)) continue;
        used.add(start);
        const loop = [start[0], start[1]];
        let cur = start[1];
        for (let guard = 0; guard < segs.length; guard++) {
            const candidates = byPoint.get(key(cur)) || [];
            const next = candidates.find(s => !used.has(s));
            if (!next) break;
            used.add(next);
            cur = key(next[0]) === key(cur) ? next[1] : next[0];
            if (key(cur) === key(loop[0])) break;
            loop.push(cur);
        }
        loops.push(loop);
    }
    return loops;
}
