// Terrain data model: a grid of elevation (0-10), forest flags, and stream
// sources. Water is *derived*: each source flows downhill, pools into lakes
// in depressions, spills, and continues until it leaves the map. Editing the
// elevation re-routes the rivers.

export const GRID_W = 480;
export const GRID_H = 320;
export const CELL = 5;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;

function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = Math.imul(s ^ (s >>> 15), s | 1);
        s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
        return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
}

export function generateMap(seed, style = 'rolling') {
    if (seed == null || Number.isNaN(seed)) seed = Math.floor(Math.random() * 999999);
    const rng = mulberry32(seed);
    const elevation = new Float32Array(GRID_W * GRID_H);
    const water = new Uint8Array(GRID_W * GRID_H);
    const forest = new Uint8Array(GRID_W * GRID_H);

    // Terrain is built with midpoint-displacement (the diamond-square fractal
    // from Dickerson's terrain notes): it fills the whole surface with
    // self-similar detail, so there are no dead-flat expanses.
    const params = TERRAIN_PARAMS[style] || TERRAIN_PARAMS.rolling;
    diamondSquare(elevation, rng, params.roughness);
    // Aggressive box-blur pass to erase the fine wrinkles that would otherwise
    // pit the surface into dozens of tiny lakes; leaves the broad relief.
    smoothField(elevation, 4);
    // Final normalization: rescale to 0..1, then a power curve presses the low
    // ground down into broad flat valleys while keeping ridgelines sharp.
    flattenValleys(elevation, params.valleyFlatten, style === 'flat' ? 4.5 : 10);

    const map = { seed, style, elevation, water, forest, sources: [] };

    // Rivers always enter from the map edge (see pickEdgeSources).
    map.sources = pickEdgeSources(elevation, rng, 2 + Math.floor(rng() * 2));
    computeWater(map);
    addForests(map, rng, 5 + Math.floor(rng() * 6));

    return map;
}

// --- Diamond-square (midpoint displacement) terrain ---

// roughness is the fractal H exponent: the random displacement shrinks by
// 2^-roughness each subdivision, so higher = smoother. valleyFlatten is the
// final power curve (>1 flattens low ground into plains).
const TERRAIN_PARAMS = {
    rolling: { roughness: 0.85, valleyFlatten: 1.8 },
    rugged:  { roughness: 0.55, valleyFlatten: 1.4 },
    flat:    { roughness: 1.05, valleyFlatten: 2.6 }
};

// Square power-of-two-plus-one working grid that covers the whole map.
const DS_SIZE = 513; // 2^9 + 1, ≥ max(GRID_W, GRID_H)

function diamondSquare(out, rng, roughness) {
    const n = DS_SIZE;
    const h = new Float32Array(n * n);
    const rand = () => rng() * 2 - 1;

    // Seed the four corners.
    h[0] = rand();
    h[n - 1] = rand();
    h[(n - 1) * n] = rand();
    h[(n - 1) * n + (n - 1)] = rand();

    let step = n - 1;
    let scale = 1;
    const decay = Math.pow(2, -roughness);

    while (step > 1) {
        const half = step >> 1;

        // Diamond step: centre of each square = mean of its 4 corners + noise.
        for (let y = half; y < n; y += step) {
            for (let x = half; x < n; x += step) {
                const a = h[(y - half) * n + (x - half)];
                const b = h[(y - half) * n + (x + half)];
                const c = h[(y + half) * n + (x - half)];
                const d = h[(y + half) * n + (x + half)];
                h[y * n + x] = (a + b + c + d) / 4 + rand() * scale;
            }
        }

        // Square step: each edge midpoint = mean of its (3-4) neighbours + noise.
        for (let y = 0; y < n; y += half) {
            for (let x = 0; x < n; x += half) {
                if (((x / half) + (y / half)) % 2 === 0) continue; // already set
                let sum = 0, cnt = 0;
                if (x - half >= 0) { sum += h[y * n + (x - half)]; cnt++; }
                if (x + half < n)  { sum += h[y * n + (x + half)]; cnt++; }
                if (y - half >= 0) { sum += h[(y - half) * n + x]; cnt++; }
                if (y + half < n)  { sum += h[(y + half) * n + x]; cnt++; }
                h[y * n + x] = sum / cnt + rand() * scale;
            }
        }

        scale *= decay;
        step = half;
    }

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) out[y * GRID_W + x] = h[y * n + x];
    }
}

// Rescale to 0..1 then raise to `exponent` (>1) so valleys flatten toward 0
// while peaks stay high, finally scaling to the target elevation range.
function flattenValleys(data, exponent, outScale) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.pow((data[i] - min) / range, exponent) * outScale;
    }
}

// Full 3x3 box blur, repeated `passes` times — aggressive enough to dissolve
// single-cell wrinkles while preserving the large-scale fractal relief.
function smoothField(data, passes) {
    const tmp = new Float32Array(data.length);
    for (let p = 0; p < passes; p++) {
        for (let y = 1; y < GRID_H - 1; y++) {
            for (let x = 1; x < GRID_W - 1; x++) {
                const i = y * GRID_W + x;
                tmp[i] = (
                    data[i - GRID_W - 1] + data[i - GRID_W] + data[i - GRID_W + 1] +
                    data[i - 1]          + data[i]          + data[i + 1] +
                    data[i + GRID_W - 1] + data[i + GRID_W] + data[i + GRID_W + 1]
                ) / 9;
            }
        }
        for (let y = 1; y < GRID_H - 1; y++) {
            for (let x = 1; x < GRID_W - 1; x++) data[y * GRID_W + x] = tmp[y * GRID_W + x];
        }
    }
}

// Rivers enter from the perimeter: sample border cells and keep the highest
// (so water has somewhere to flow), spread apart so inlets don't cluster.
function pickEdgeSources(elevation, rng, count) {
    const cand = [];
    for (let i = 0; i < 240; i++) {
        let gx, gy;
        switch (Math.floor(rng() * 4)) {
            case 0: gx = 0;          gy = 1 + Math.floor(rng() * (GRID_H - 2)); break;
            case 1: gx = GRID_W - 1; gy = 1 + Math.floor(rng() * (GRID_H - 2)); break;
            case 2: gy = 0;          gx = 1 + Math.floor(rng() * (GRID_W - 2)); break;
            default: gy = GRID_H - 1; gx = 1 + Math.floor(rng() * (GRID_W - 2));
        }
        cand.push({ gx, gy, e: elevation[gy * GRID_W + gx] });
    }
    cand.sort((a, b) => b.e - a.e);
    const sources = [];
    for (const c of cand) {
        if (sources.length >= count) break;
        if (sources.every(s => Math.hypot(s.gx - c.gx, s.gy - c.gy) > 60)) {
            sources.push({ gx: c.gx, gy: c.gy, size: 1 + Math.floor(rng() * 2) });
        }
    }
    return sources;
}

function snapToEdge(gx, gy) {
    gx = Math.max(0, Math.min(GRID_W - 1, gx));
    gy = Math.max(0, Math.min(GRID_H - 1, gy));
    const dLeft = gx, dRight = GRID_W - 1 - gx, dTop = gy, dBot = GRID_H - 1 - gy;
    const m = Math.min(dLeft, dRight, dTop, dBot);
    if (m === dLeft) gx = 0;
    else if (m === dRight) gx = GRID_W - 1;
    else if (m === dTop) gy = 0;
    else gy = GRID_H - 1;
    return { gx, gy };
}

// --- Water drainage simulation ---

const FLOW_NEIGHBORS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
];

export function computeWater(map) {
    // Elevation/water changed, so any cached reachability grids are stale.
    map._reach = null;
    map.water.fill(0);
    // Vector geometry for rendering: river centerlines (flat [gx, gy, width]
    // triples in grid units) and lakes (arrays of flooded cell indices).
    map.rivers = [];
    map.lakes = [];
    for (const source of map.sources) runFlow(map, source);
    // Rivers clear any forest they pass through
    for (let i = 0; i < map.water.length; i++) if (map.water[i]) map.forest[i] = 0;
}

function runFlow(map, source) {
    let x = Math.max(1, Math.min(GRID_W - 2, Math.round(source.gx)));
    let y = Math.max(1, Math.min(GRID_H - 2, Math.round(source.gy)));
    // filled: cell -> lake surface level, overriding ground elevation
    const filled = new Map();
    const elev = i => filled.has(i) ? filled.get(i) : map.elevation[i];
    let dist = 0;
    let path = [];
    const endPath = () => {
        if (path.length >= 6) map.rivers.push(path);
        path = [];
    };

    for (let steps = 0; steps < 20000; steps++) {
        // Rivers widen slightly as they travel
        const radius = 0.5 + source.size * 0.55 + Math.min(1.2, dist / 800);
        markDisk(map.water, x, y, radius, 1);
        path.push(x, y, radius);

        if (x <= 0 || x >= GRID_W - 1 || y <= 0 || y >= GRID_H - 1) { endPath(); return; }

        const ci = y * GRID_W + x;
        const here = elev(ci);
        let bestI = -1, bestE = here - 1e-6, bx = 0, by = 0;
        for (const [dx, dy] of FLOW_NEIGHBORS) {
            const ni = (y + dy) * GRID_W + (x + dx);
            const e = elev(ni);
            if (e < bestE) { bestE = e; bestI = ni; bx = x + dx; by = y + dy; }
        }

        if (bestI >= 0) {
            x = bx; y = by; dist++;
            continue;
        }

        // No downhill neighbor: we're in a pit. Flood it into a lake and
        // continue from the spill point.
        endPath();
        const spill = fillLake(map, ci, elev, filled);
        if (!spill) return;
        x = spill.x; y = spill.y;
    }
    endPath();
}

function fillLake(map, startI, elevFn, filled) {
    const heap = [[elevFn(startI), startI]];
    const visited = new Set([startI]);
    const lake = [];
    let level = -Infinity;

    const commit = () => {
        for (const c of lake) {
            map.water[c] = 1;
            filled.set(c, level);
        }
        if (lake.length) map.lakes.push(lake.slice());
    };

    for (let count = 0; heap.length && count < 8000; count++) {
        const [e, i] = heapPop(heap);
        if (e < level) {
            // This cell is below the lake surface and outside it: water spills here.
            commit();
            return { x: i % GRID_W, y: (i / GRID_W) | 0 };
        }
        level = Math.max(level, e);
        lake.push(i);

        const cx = i % GRID_W, cy = (i / GRID_W) | 0;
        if (cx === 0 || cx === GRID_W - 1 || cy === 0 || cy === GRID_H - 1) {
            // Lake reaches the map edge and drains off-map.
            commit();
            return null;
        }
        for (const [dx, dy] of FLOW_NEIGHBORS) {
            const ni = (cy + dy) * GRID_W + (cx + dx);
            if (!visited.has(ni)) {
                visited.add(ni);
                heapPush(heap, [elevFn(ni), ni]);
            }
        }
    }
    commit();
    return null;
}

function heapPush(heap, item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
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

function addForests(map, rng, count) {
    for (let i = 0; i < count; i++) {
        const cx = rng() * GRID_W, cy = rng() * GRID_H;
        const radius = 12 + rng() * 22;
        const blobs = 4 + Math.floor(rng() * 5);
        for (let b = 0; b < blobs; b++) {
            const bx = cx + (rng() - 0.5) * radius * 1.6;
            const by = cy + (rng() - 0.5) * radius * 1.6;
            markDisk(map.forest, bx, by, 4 + rng() * radius * 0.5, 1);
        }
    }
    for (let i = 0; i < map.forest.length; i++) if (map.water[i]) map.forest[i] = 0;
}

function markDisk(arr, cx, cy, radius, value) {
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(GRID_W - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(GRID_H - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) arr[y * GRID_W + x] = value;
        }
    }
}

// --- Sampling helpers (world coordinates) ---

export function cellAt(wx, wy) {
    const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor(wx / CELL)));
    const gy = Math.max(0, Math.min(GRID_H - 1, Math.floor(wy / CELL)));
    return gy * GRID_W + gx;
}

export function elevationAt(map, wx, wy) {
    const gx = Math.max(0, Math.min(GRID_W - 1.001, wx / CELL));
    const gy = Math.max(0, Math.min(GRID_H - 1.001, wy / CELL));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const e = map.elevation;
    const v00 = e[y0 * GRID_W + x0], v10 = e[y0 * GRID_W + x0 + 1];
    const v01 = e[(y0 + 1) * GRID_W + x0], v11 = e[(y0 + 1) * GRID_W + x0 + 1];
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

export function isWaterAt(map, wx, wy) { return map.water[cellAt(wx, wy)] === 1; }
export function isForestAt(map, wx, wy) { return map.forest[cellAt(wx, wy)] === 1; }

// --- Brush editing (world coordinates) ---

export function applyBrush(map, tool, wx, wy, radiusWorld, strength) {
    const cx = wx / CELL, cy = wy / CELL;
    const radius = radiusWorld / CELL;
    if (tool === 'raise' || tool === 'lower') {
        const sign = tool === 'raise' ? 1 : -1;
        const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(GRID_W - 1, Math.ceil(cx + radius));
        const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(GRID_H - 1, Math.ceil(cy + radius));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x - cx, y - cy);
                if (d > radius) continue;
                // Squared cosine: a softer, more diffuse bell than plain cosine.
                const c = Math.cos((d / radius) * Math.PI * 0.5);
                const falloff = c * c;
                const i = y * GRID_W + x;
                map.elevation[i] = Math.max(0, Math.min(10, map.elevation[i] + sign * strength * falloff));
            }
        }
        computeWater(map);
    } else if (tool === 'smooth') {
        const x0 = Math.max(1, Math.floor(cx - radius)), x1 = Math.min(GRID_W - 2, Math.ceil(cx + radius));
        const y0 = Math.max(1, Math.floor(cy - radius)), y1 = Math.min(GRID_H - 2, Math.ceil(cy + radius));
        const e = map.elevation;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (Math.hypot(x - cx, y - cy) > radius) continue;
                const i = y * GRID_W + x;
                const avg = (e[i - 1] + e[i + 1] + e[i - GRID_W] + e[i + GRID_W]) / 4;
                e[i] += (avg - e[i]) * Math.min(1, strength * 2);
            }
        }
        computeWater(map);
    } else if (tool === 'forest') {
        markDisk(map.forest, cx, cy, radius, 1);
        for (let i = 0; i < map.forest.length; i++) if (map.water[i]) map.forest[i] = 0;
    } else if (tool === 'clear') {
        markDisk(map.forest, cx, cy, radius, 0);
        // Also remove any stream sources under the brush
        const before = map.sources.length;
        map.sources = map.sources.filter(s => Math.hypot(s.gx - cx, s.gy - cy) > radius);
        if (map.sources.length !== before) computeWater(map);
    }
}

export function addSource(map, wx, wy, size) {
    // Rivers enter from the edge, so snap the click to the nearest border.
    const s = snapToEdge(Math.round(wx / CELL), Math.round(wy / CELL));
    map.sources.push({ gx: s.gx, gy: s.gy, size });
    computeWater(map);
}

// Reposition an existing inlet (kept snapped to the border) and re-route water.
export function moveSource(map, source, wx, wy) {
    const s = snapToEdge(Math.round(wx / CELL), Math.round(wy / CELL));
    source.gx = s.gx;
    source.gy = s.gy;
    computeWater(map);
}

// --- Isolines (marching squares; returns flat segment list per level) ---

export function computeIsolines(map, interval = 1) {
    const result = [];
    const e = map.elevation;
    for (let level = interval; level < 10; level += interval) {
        const segs = [];
        for (let y = 0; y < GRID_H - 1; y++) {
            for (let x = 0; x < GRID_W - 1; x++) {
                const v0 = e[y * GRID_W + x], v1 = e[y * GRID_W + x + 1];
                const v2 = e[(y + 1) * GRID_W + x + 1], v3 = e[(y + 1) * GRID_W + x];
                const code = (v0 >= level ? 8 : 0) | (v1 >= level ? 4 : 0) | (v2 >= level ? 2 : 0) | (v3 >= level ? 1 : 0);
                if (code === 0 || code === 15) continue;
                const lerp = (a, b, va, vb) => a + ((level - va) / (vb - va)) * (b - a);
                const top = [lerp(x, x + 1, v0, v1), y];
                const right = [x + 1, lerp(y, y + 1, v1, v2)];
                const bottom = [lerp(x, x + 1, v3, v2), y + 1];
                const left = [x, lerp(y, y + 1, v0, v3)];
                const add = (a, b) => segs.push(a[0], a[1], b[0], b[1]);
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
        if (segs.length) result.push({ level, segs });
    }
    return result;
}

// --- Serialization ---

export function serializeMap(map) {
    return {
        seed: map.seed,
        style: map.style,
        gridW: GRID_W,
        gridH: GRID_H,
        elevation: Array.from(map.elevation, v => Math.round(v * 100) / 100),
        forest: Array.from(map.forest),
        sources: map.sources.map(s => ({ gx: s.gx, gy: s.gy, size: s.size }))
    };
}

export function deserializeMap(obj) {
    if (obj.gridW !== GRID_W || obj.gridH !== GRID_H) {
        throw new Error('Saved level uses an incompatible map size.');
    }
    const map = {
        seed: obj.seed,
        style: obj.style,
        elevation: Float32Array.from(obj.elevation),
        water: new Uint8Array(GRID_W * GRID_H),
        forest: Uint8Array.from(obj.forest),
        sources: obj.sources || []
    };
    computeWater(map);
    return map;
}
