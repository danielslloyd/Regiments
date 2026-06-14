// Ball-fitting pathfinding. A unit is modelled as a ball of some radius; it
// can occupy a cell only if that ball touches at most one elevation isoline
// (i.e. it isn't wedged across a steep contour pinch) and isn't in water.
// We bake a per-radius "reachability" grid, then run A* over the passable
// cells, biasing the cost by slope and forest.

import { GRID_W, GRID_H, CELL, computeIsolines } from './terrain.js';

const NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
];

// --- Reachability (ball-fitting) -------------------------------------------

// Build (and cache on the map) the passable mask for a ball of the given grid
// radius. A cell passes if it's dry land and the ball centred there is within
// `radius` of segments from at most one contour level.
export function getReachGrid(map, radius) {
    if (!map._reach) map._reach = {};
    const key = radius.toFixed(2);
    if (map._reach[key]) return map._reach[key];

    const size = GRID_W * GRID_H;
    const touchCount = new Uint8Array(size);
    const rCeil = Math.ceil(radius) + 1;

    for (const { segs } of computeIsolines(map, 1)) {
        const lvTouched = new Uint8Array(size);
        for (let s = 0; s < segs.length; s += 4) {
            const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3];
            const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rCeil));
            const x1 = Math.min(GRID_W - 1, Math.ceil(Math.max(ax, bx) + rCeil));
            const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rCeil));
            const y1 = Math.min(GRID_H - 1, Math.ceil(Math.max(ay, by) + rCeil));
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const idx = y * GRID_W + x;
                    if (!lvTouched[idx] && pointSegDist(x, y, ax, ay, bx, by) <= radius) lvTouched[idx] = 1;
                }
            }
        }
        for (let i = 0; i < size; i++) touchCount[i] += lvTouched[i];
    }

    const grid = new Uint8Array(size);
    for (let i = 0; i < size; i++) grid[i] = (!map.water[i] && touchCount[i] <= 1) ? 1 : 0;
    map._reach[key] = grid;
    return grid;
}

// Half-width (world units) of the passable corridor through (wx, wy),
// measured perpendicular to `facing`. Used so formations march as wide as the
// ground allows. Symmetric: returns the smaller of the two sides.
export function corridorHalfWidth(map, radius, wx, wy, facing, maxWorld = 80) {
    const grid = getReachGrid(map, radius);
    const px = -Math.sin(facing), py = Math.cos(facing);
    const measure = sign => {
        let reached = 0;
        for (let step = CELL; step <= maxWorld; step += CELL) {
            const gx = Math.round((wx + px * sign * step) / CELL);
            const gy = Math.round((wy + py * sign * step) / CELL);
            if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H || !grid[gy * GRID_W + gx]) break;
            reached = step;
        }
        return reached;
    };
    return Math.min(measure(1), measure(-1));
}

function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// --- A* over the reachability grid -----------------------------------------

export function findPath(map, startW, goalW, radius = 2) {
    const grid = getReachGrid(map, radius);
    let sx = clampX(Math.round(startW.x / CELL)), sy = clampY(Math.round(startW.y / CELL));
    let gx = clampX(Math.round(goalW.x / CELL)), gy = clampY(Math.round(goalW.y / CELL));

    // Snap blocked endpoints to the nearest passable cell.
    if (!grid[sy * GRID_W + sx]) {
        const f = nearestPassable(grid, sx, sy);
        if (!f) return null;
        sx = f.x; sy = f.y;
    }
    if (!grid[gy * GRID_W + gx]) {
        const f = nearestPassable(grid, gx, gy);
        if (!f) return null;
        gx = f.x; gy = f.y;
    }

    const size = GRID_W * GRID_H;
    const gScore = new Float32Array(size).fill(Infinity);
    const cameFrom = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const startI = sy * GRID_W + sx, goalI = gy * GRID_W + gx;
    gScore[startI] = 0;

    const heap = [[heuristic(sx, sy, gx, gy), startI]];

    while (heap.length) {
        const [, current] = heapPop(heap);
        if (current === goalI) return reconstruct(cameFrom, current, grid);
        if (closed[current]) continue;
        closed[current] = 1;

        const cx = current % GRID_W, cy = (current / GRID_W) | 0;
        for (const [dx, dy, dist] of NEIGHBORS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
            const ni = ny * GRID_W + nx;
            if (closed[ni] || !grid[ni]) continue;

            const slope = Math.abs(map.elevation[ni] - map.elevation[current]);
            let cost = dist * (1 + slope * 2.5);
            if (map.forest[ni]) cost *= 1.6;

            const tentative = gScore[current] + cost;
            if (tentative < gScore[ni]) {
                gScore[ni] = tentative;
                cameFrom[ni] = current;
                heapPush(heap, [tentative + heuristic(nx, ny, gx, gy), ni]);
            }
        }
    }
    return null;
}

function heuristic(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function nearestPassable(grid, gx, gy) {
    for (let r = 1; r < 50; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = gx + dx, y = gy + dy;
                if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
                if (grid[y * GRID_W + x]) return { x, y };
            }
        }
    }
    return null;
}

function reconstruct(cameFrom, end, grid) {
    const cells = [];
    let i = end;
    while (i !== -1) {
        cells.push(i);
        i = cameFrom[i];
    }
    cells.reverse();
    // Line-of-sight smoothing: skip waypoints we can reach in a straight,
    // fully-passable line. Yields fewer, cleaner turns than raw cell steps.
    const out = [cells[0]];
    let k = 0;
    while (k < cells.length - 1) {
        let farthest = k + 1;
        for (let j = k + 2; j < cells.length; j++) {
            if (losClear(grid, cells[k], cells[j])) farthest = j;
            else break;
        }
        out.push(cells[farthest]);
        k = farthest;
    }
    return out.map(c => ({ x: (c % GRID_W) * CELL + CELL / 2, y: ((c / GRID_W) | 0) * CELL + CELL / 2 }));
}

function losClear(grid, a, b) {
    let x0 = a % GRID_W, y0 = (a / GRID_W) | 0;
    const x1 = b % GRID_W, y1 = (b / GRID_W) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
        if (!grid[y0 * GRID_W + x0]) return false;
        if (x0 === x1 && y0 === y1) return true;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function clampX(v) { return Math.max(0, Math.min(GRID_W - 1, v)); }
function clampY(v) { return Math.max(0, Math.min(GRID_H - 1, v)); }

function heapPush(heap, item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent][0] <= heap[i][0]) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
    }
}

function heapPop(heap) {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
        heap[0] = last;
        let i = 0;
        while (true) {
            const l = i * 2 + 1, r = l + 1;
            let smallest = i;
            if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
            if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
            if (smallest === i) break;
            [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
            i = smallest;
        }
    }
    return top;
}
