// Civil War RTS - Terrain Generator with Isolines

export class TerrainGenerator {
    constructor(width, height, seed) {
        this.width = width;
        this.height = height;
        this.rng = this._makeRng(seed != null ? seed : Math.floor(Math.random() * 999999));
    }

    // Mulberry32 seeded RNG
    _makeRng(seed) {
        let s = seed >>> 0;
        return function() {
            s = Math.imul(s ^ (s >>> 15), s | 1);
            s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
            return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
        };
    }

    generateRandom(style = 'rolling') {
        const elevationData = this.generateNoiseMap(style);
        const waterways = this.generateWaterways(elevationData);
        const foliage = this.generateFoliage(elevationData);
        const isolines = this.generateIsolines(elevationData);

        return {
            elevationData: elevationData,
            isolines: isolines,
            waterways: waterways,
            foliage: foliage,
            dimensions: { width: this.width, height: this.height }
        };
    }

    generateFromBrushData(brushData) {
        const elevationData = this.brushToElevation(brushData.elevation);
        const waterways = this.brushToWaterways(brushData.water);
        const foliage = this.brushToFoliage(brushData.foliage);
        const isolines = this.generateIsolines(elevationData);

        return {
            elevationData: elevationData,
            isolines: isolines,
            waterways: waterways,
            foliage: foliage,
            dimensions: { width: this.width, height: this.height }
        };
    }

    generateNoiseMap(style = 'rolling') {
        const data = new Float32Array(this.width * this.height);

        // Style presets: adjust octave weights and grid sizes
        let baseGridSize, octaves;
        switch (style) {
            case 'flat':
                baseGridSize = 128;
                octaves = [{ size: 64, amp: 0.2 }, { size: 32, amp: 0.1 }];
                break;
            case 'rugged':
                baseGridSize = 48;
                octaves = [{ size: 24, amp: 0.6 }, { size: 12, amp: 0.4 }];
                break;
            default: // rolling
                baseGridSize = 64;
                octaves = [{ size: 32, amp: 0.5 }, { size: 16, amp: 0.25 }];
        }

        // Base noise layer
        this._addNoiseLayer(data, baseGridSize, 1.0);

        // Additional octaves
        for (const oct of octaves) {
            this._addNoiseLayer(data, oct.size, oct.amp);
        }

        // Normalize to 0-10 range
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < data.length; i++) {
            data[i] = ((data[i] - min) / range) * 10;
        }

        // Flatten edges slightly for 'flat' style
        if (style === 'flat') {
            for (let i = 0; i < data.length; i++) {
                data[i] = data[i] * 0.6 + 2;
            }
            // Re-normalize
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < data.length; i++) {
                if (data[i] < mn) mn = data[i];
                if (data[i] > mx) mx = data[i];
            }
            const rng = mx - mn || 1;
            for (let i = 0; i < data.length; i++) {
                data[i] = ((data[i] - mn) / rng) * 10;
            }
        }

        return data;
    }

    _addNoiseLayer(data, gridSize, amplitude) {
        const gridW = Math.ceil(this.width / gridSize) + 1;
        const gridH = Math.ceil(this.height / gridSize) + 1;
        const grid = [];

        for (let i = 0; i < gridW * gridH; i++) {
            grid.push(this.rng() * amplitude);
        }

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const gx = x / gridSize;
                const gy = y / gridSize;
                const x0 = Math.floor(gx);
                const y0 = Math.floor(gy);
                const x1 = x0 + 1;
                const y1 = y0 + 1;

                const fx = gx - x0;
                const fy = gy - y0;
                const sx = fx * fx * (3 - 2 * fx);
                const sy = fy * fy * (3 - 2 * fy);

                const v00 = grid[y0 * gridW + x0] || 0;
                const v10 = grid[y0 * gridW + x1] || 0;
                const v01 = grid[y1 * gridW + x0] || 0;
                const v11 = grid[y1 * gridW + x1] || 0;

                const top = v00 + sx * (v10 - v00);
                const bottom = v01 + sx * (v11 - v01);
                data[y * this.width + x] += top + sy * (bottom - top);
            }
        }
    }

    // Legacy method kept for brush-based generation compatibility
    addOctave(data, gridSize, amplitude) {
        this._addNoiseLayer(data, gridSize, amplitude);
    }

    brushToElevation(strokes) {
        const data = new Float32Array(this.width * this.height);

        for (const stroke of strokes) {
            for (const point of stroke.points) {
                this.applyBrushPoint(data, point.x, point.y, stroke.size, stroke.density);
            }
        }

        this.smoothData(data);

        let max = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > max) max = data[i];
        }
        if (max > 0) {
            for (let i = 0; i < data.length; i++) {
                data[i] = (data[i] / max) * 10;
            }
        }

        return data;
    }

    applyBrushPoint(data, cx, cy, size, density) {
        const radius = size / 2;
        const startX = Math.max(0, Math.floor(cx - radius));
        const endX = Math.min(this.width - 1, Math.ceil(cx + radius));
        const startY = Math.max(0, Math.floor(cy - radius));
        const endY = Math.min(this.height - 1, Math.ceil(cy + radius));

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const dist = Math.hypot(x - cx, y - cy);
                if (dist <= radius) {
                    const falloff = 1 - (dist / radius);
                    data[y * this.width + x] += density * falloff;
                }
            }
        }
    }

    smoothData(data) {
        const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        const kernelSum = 16;
        const temp = new Float32Array(data.length);

        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                let sum = 0;
                let k = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        sum += data[(y + dy) * this.width + (x + dx)] * kernel[k++];
                    }
                }
                temp[y * this.width + x] = sum / kernelSum;
            }
        }

        for (let i = 0; i < data.length; i++) {
            data[i] = temp[i];
        }
    }

    generateIsolines(elevationData) {
        const isolines = [];
        const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9];

        for (const level of levels) {
            const contour = this.marchingSquares(elevationData, level);
            if (contour.length > 0) {
                isolines.push({
                    elevation: level,
                    points: contour
                });
            }
        }

        return isolines;
    }

    marchingSquares(data, threshold) {
        const segments = [];

        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 0; x < this.width - 1; x++) {
                const v0 = data[y * this.width + x];
                const v1 = data[y * this.width + (x + 1)];
                const v2 = data[(y + 1) * this.width + (x + 1)];
                const v3 = data[(y + 1) * this.width + x];

                const code =
                    (v0 >= threshold ? 8 : 0) |
                    (v1 >= threshold ? 4 : 0) |
                    (v2 >= threshold ? 2 : 0) |
                    (v3 >= threshold ? 1 : 0);

                const cellSegments = this.getCellSegments(x, y, code, v0, v1, v2, v3, threshold);
                segments.push(...cellSegments);
            }
        }

        return this.connectSegments(segments);
    }

    getCellSegments(x, y, code, v0, v1, v2, v3, threshold) {
        const segments = [];

        const lerp = (a, b, va, vb) => {
            const t = (threshold - va) / (vb - va);
            return a + t * (b - a);
        };

        const top = { x: lerp(x, x + 1, v0, v1), y: y };
        const right = { x: x + 1, y: lerp(y, y + 1, v1, v2) };
        const bottom = { x: lerp(x, x + 1, v3, v2), y: y + 1 };
        const left = { x: x, y: lerp(y, y + 1, v0, v3) };

        switch (code) {
            case 1: segments.push([left, bottom]); break;
            case 2: segments.push([bottom, right]); break;
            case 3: segments.push([left, right]); break;
            case 4: segments.push([top, right]); break;
            case 5:
                segments.push([left, top]);
                segments.push([bottom, right]);
                break;
            case 6: segments.push([top, bottom]); break;
            case 7: segments.push([left, top]); break;
            case 8: segments.push([top, left]); break;
            case 9: segments.push([top, bottom]); break;
            case 10:
                segments.push([top, right]);
                segments.push([left, bottom]);
                break;
            case 11: segments.push([top, right]); break;
            case 12: segments.push([left, right]); break;
            case 13: segments.push([bottom, right]); break;
            case 14: segments.push([left, bottom]); break;
        }

        return segments;
    }

    connectSegments(segments) {
        if (segments.length === 0) return [];

        const points = [];
        const used = new Set();

        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            const chain = [...segments[i]];
            used.add(i);

            // Cap iterations to avoid stalling on large maps
            const maxIterations = Math.min(segments.length * 2, 5000);
            let iterations = 0;
            let changed = true;

            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;

                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;

                    const seg = segments[j];
                    const start = chain[0];
                    const end = chain[chain.length - 1];

                    if (this.pointsClose(seg[1], start)) {
                        chain.unshift(seg[0]);
                        used.add(j);
                        changed = true;
                        break;
                    } else if (this.pointsClose(seg[0], end)) {
                        chain.push(seg[1]);
                        used.add(j);
                        changed = true;
                        break;
                    } else if (this.pointsClose(seg[0], start)) {
                        chain.unshift(seg[1]);
                        used.add(j);
                        changed = true;
                        break;
                    } else if (this.pointsClose(seg[1], end)) {
                        chain.push(seg[0]);
                        used.add(j);
                        changed = true;
                        break;
                    }
                }
            }

            if (chain.length > 1) {
                const simplified = this.simplifyPath(chain);
                points.push(...simplified);
            }
        }

        return points;
    }

    pointsClose(p1, p2, tolerance = 0.01) {
        return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
    }

    simplifyPath(points, tolerance = 2) {
        if (points.length < 3) return points;

        const result = [points[0]];
        let lastAdded = 0;
        const endpoint = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this.pointToLineDistance(
                points[i],
                points[lastAdded],
                endpoint
            );

            if (dist > tolerance) {
                result.push(points[i]);
                lastAdded = i;
            }
        }

        result.push(endpoint);
        return result;
    }

    pointToLineDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);

        const t = Math.max(0, Math.min(1,
            ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (len * len)
        ));

        const projX = lineStart.x + t * dx;
        const projY = lineStart.y + t * dy;

        return Math.hypot(point.x - projX, point.y - projY);
    }

    brushToWaterways(strokes) {
        const waterways = [];

        for (const stroke of strokes) {
            if (stroke.points.length < 2) continue;

            const avgDensity = stroke.points.reduce((sum, p) => sum + (p.density || 1), 0) / stroke.points.length;
            const pathLength = this.calculatePathLength(stroke.points);

            let type = 'creek';
            if (avgDensity > 0.7 && pathLength < 100) {
                type = 'lake';
            } else if (avgDensity > 0.5) {
                type = 'river';
            }

            waterways.push({
                type: type,
                points: stroke.points.map(p => ({ x: p.x, y: p.y })),
                width: stroke.size * avgDensity
            });
        }

        return waterways;
    }

    calculatePathLength(points) {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            length += Math.hypot(
                points[i].x - points[i - 1].x,
                points[i].y - points[i - 1].y
            );
        }
        return length;
    }

    brushToFoliage(strokes) {
        const foliage = [];

        for (const stroke of strokes) {
            if (stroke.points.length < 2) continue;

            const bounds = this.getStrokeBounds(stroke);
            const density = stroke.density || 0.5;

            foliage.push({
                density: density,
                shape: this.createFoliageShape(stroke.points, stroke.size),
                bounds: bounds
            });
        }

        return foliage;
    }

    getStrokeBounds(stroke) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        return { minX, minY, maxX, maxY };
    }

    createFoliageShape(points, size) {
        const shape = [];
        const radius = size / 2;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const angle = i * (Math.PI * 2 / points.length);
            const variation = (this.rng() - 0.5) * radius * 0.5;

            shape.push({
                x: p.x + Math.cos(angle) * (radius + variation),
                y: p.y + Math.sin(angle) * (radius + variation)
            });
        }

        return shape;
    }

    generateWaterways(elevationData) {
        const waterways = [];

        const numRivers = 2 + Math.floor(this.rng() * 3);

        for (let i = 0; i < numRivers; i++) {
            const river = this.generateRiver(elevationData);
            if (river.length > 5) {
                waterways.push({
                    type: 'river',
                    points: river,
                    width: 5 + this.rng() * 10
                });
            }
        }

        const numLakes = Math.floor(this.rng() * 3);
        for (let i = 0; i < numLakes; i++) {
            const lake = this.generateLake(elevationData);
            if (lake) {
                waterways.push(lake);
            }
        }

        return waterways;
    }

    generateRiver(elevationData) {
        const points = [];

        let x, y;
        const edge = Math.floor(this.rng() * 4);
        switch (edge) {
            case 0: x = this.rng() * this.width; y = 0; break;
            case 1: x = this.width; y = this.rng() * this.height; break;
            case 2: x = this.rng() * this.width; y = this.height; break;
            case 3: x = 0; y = this.rng() * this.height; break;
        }

        points.push({ x, y });

        for (let i = 0; i < 100; i++) {
            const neighbors = [
                { x: x - 5, y: y },
                { x: x + 5, y: y },
                { x: x, y: y - 5 },
                { x: x, y: y + 5 },
                { x: x - 5, y: y - 5 },
                { x: x + 5, y: y - 5 },
                { x: x - 5, y: y + 5 },
                { x: x + 5, y: y + 5 }
            ];

            let lowestNeighbor = null;
            let lowestElevation = Infinity;

            for (const n of neighbors) {
                if (n.x < 0 || n.x >= this.width || n.y < 0 || n.y >= this.height) continue;

                const elevation = elevationData[Math.floor(n.y) * this.width + Math.floor(n.x)];
                if (elevation < lowestElevation) {
                    lowestElevation = elevation;
                    lowestNeighbor = n;
                }
            }

            if (!lowestNeighbor) break;

            x = lowestNeighbor.x + (this.rng() - 0.5) * 3;
            y = lowestNeighbor.y + (this.rng() - 0.5) * 3;

            points.push({ x, y });

            if (x < 5 || x > this.width - 5 || y < 5 || y > this.height - 5) break;
        }

        return points;
    }

    generateLake(elevationData) {
        let lowestX = 0, lowestY = 0, lowestVal = Infinity;

        for (let i = 0; i < 100; i++) {
            const x = Math.floor(this.rng() * this.width);
            const y = Math.floor(this.rng() * this.height);
            const val = elevationData[y * this.width + x];

            if (val < lowestVal) {
                lowestVal = val;
                lowestX = x;
                lowestY = y;
            }
        }

        const points = [];
        const numPoints = 8 + Math.floor(this.rng() * 8);
        const radius = 20 + this.rng() * 30;

        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const r = radius * (0.7 + this.rng() * 0.6);
            points.push({
                x: lowestX + Math.cos(angle) * r,
                y: lowestY + Math.sin(angle) * r
            });
        }

        return {
            type: 'lake',
            points: points,
            width: 0
        };
    }

    generateFoliage(elevationData) {
        const foliage = [];
        const numForests = 3 + Math.floor(this.rng() * 5);

        for (let i = 0; i < numForests; i++) {
            let x, y, elevation;
            let attempts = 0;

            do {
                x = this.rng() * this.width;
                y = this.rng() * this.height;
                elevation = elevationData[Math.floor(y) * this.width + Math.floor(x)];
                attempts++;
            } while ((elevation < 2 || elevation > 7) && attempts < 50);

            const numPoints = 6 + Math.floor(this.rng() * 6);
            const radius = 30 + this.rng() * 50;
            const shape = [];

            for (let j = 0; j < numPoints; j++) {
                const angle = (j / numPoints) * Math.PI * 2;
                const r = radius * (0.5 + this.rng());
                shape.push({
                    x: x + Math.cos(angle) * r,
                    y: y + Math.sin(angle) * r
                });
            }

            foliage.push({
                density: 0.3 + this.rng() * 0.7,
                shape: shape,
                bounds: {
                    minX: x - radius,
                    minY: y - radius,
                    maxX: x + radius,
                    maxY: y + radius
                }
            });
        }

        return foliage;
    }
}
