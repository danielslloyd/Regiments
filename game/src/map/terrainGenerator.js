// Civil War RTS - Terrain Generator with Isolines

export class TerrainGenerator {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }

    generateRandom() {
        // Generate elevation using Perlin-like noise
        const elevationData = this.generateNoiseMap();

        // Generate water features
        const waterways = this.generateWaterways(elevationData);

        // Generate foliage
        const foliage = this.generateFoliage(elevationData);

        // Generate isolines from elevation data
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
        // Convert brush strokes to elevation data
        const elevationData = this.brushToElevation(brushData.elevation);

        // Convert water brush to waterways
        const waterways = this.brushToWaterways(brushData.water);

        // Convert foliage brush to forest shapes
        const foliage = this.brushToFoliage(brushData.foliage);

        // Generate isolines
        const isolines = this.generateIsolines(elevationData);

        return {
            elevationData: elevationData,
            isolines: isolines,
            waterways: waterways,
            foliage: foliage,
            dimensions: { width: this.width, height: this.height }
        };
    }

    generateNoiseMap() {
        const data = new Float32Array(this.width * this.height);

        // Simple value noise implementation
        const gridSize = 64;
        const grid = [];
        const gridW = Math.ceil(this.width / gridSize) + 1;
        const gridH = Math.ceil(this.height / gridSize) + 1;

        for (let i = 0; i < gridW * gridH; i++) {
            grid.push(Math.random());
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

                // Smooth interpolation
                const sx = fx * fx * (3 - 2 * fx);
                const sy = fy * fy * (3 - 2 * fy);

                const v00 = grid[y0 * gridW + x0] || 0;
                const v10 = grid[y0 * gridW + x1] || 0;
                const v01 = grid[y1 * gridW + x0] || 0;
                const v11 = grid[y1 * gridW + x1] || 0;

                const top = v00 + sx * (v10 - v00);
                const bottom = v01 + sx * (v11 - v01);
                const value = top + sy * (bottom - top);

                data[y * this.width + x] = value;
            }
        }

        // Add multiple octaves for more detail
        this.addOctave(data, 32, 0.5);
        this.addOctave(data, 16, 0.25);

        // Normalize to 0-10 range (elevation levels)
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
        for (let i = 0; i < data.length; i++) {
            data[i] = ((data[i] - min) / (max - min)) * 10;
        }

        return data;
    }

    addOctave(data, gridSize, amplitude) {
        const grid = [];
        const gridW = Math.ceil(this.width / gridSize) + 1;
        const gridH = Math.ceil(this.height / gridSize) + 1;

        for (let i = 0; i < gridW * gridH; i++) {
            grid.push(Math.random() * amplitude);
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
                const value = top + sy * (bottom - top);

                data[y * this.width + x] += value;
            }
        }
    }

    brushToElevation(strokes) {
        const data = new Float32Array(this.width * this.height);

        // Apply each stroke to the elevation data
        for (const stroke of strokes) {
            for (const point of stroke.points) {
                this.applyBrushPoint(data, point.x, point.y, stroke.size, stroke.density);
            }
        }

        // Smooth the data
        this.smoothData(data);

        // Normalize
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

        // Edge points
        const top = { x: lerp(x, x + 1, v0, v1), y: y };
        const right = { x: x + 1, y: lerp(y, y + 1, v1, v2) };
        const bottom = { x: lerp(x, x + 1, v3, v2), y: y + 1 };
        const left = { x: x, y: lerp(y, y + 1, v0, v3) };

        // Lookup table for marching squares
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

            // Limit iterations to prevent infinite loops
            let iterations = 0;
            const maxIterations = segments.length * 2;
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
                        break; // Only add one segment per iteration
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

            // Simplify chain before adding
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

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this.pointToLineDistance(
                points[i],
                points[lastAdded],
                points[i + 1]
            );

            if (dist > tolerance) {
                result.push(points[i]);
                lastAdded = i;
            }
        }

        result.push(points[points.length - 1]);
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

            // Determine water type based on stroke characteristics
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

            // Create foliage shape from stroke
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
        // Create an irregular shape around the stroke points
        const shape = [];
        const radius = size / 2;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const angle = i * (Math.PI * 2 / points.length);
            const variation = (Math.random() - 0.5) * radius * 0.5;

            shape.push({
                x: p.x + Math.cos(angle) * (radius + variation),
                y: p.y + Math.sin(angle) * (radius + variation)
            });
        }

        return shape;
    }

    generateWaterways(elevationData) {
        const waterways = [];

        // Find low points and create rivers flowing from them
        const numRivers = 2 + Math.floor(Math.random() * 3);

        for (let i = 0; i < numRivers; i++) {
            const river = this.generateRiver(elevationData);
            if (river.length > 5) {
                waterways.push({
                    type: 'river',
                    points: river,
                    width: 5 + Math.random() * 10
                });
            }
        }

        // Add some lakes in low areas
        const numLakes = Math.floor(Math.random() * 3);
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

        // Start from a random edge
        let x, y;
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
            case 0: x = Math.random() * this.width; y = 0; break;
            case 1: x = this.width; y = Math.random() * this.height; break;
            case 2: x = Math.random() * this.width; y = this.height; break;
            case 3: x = 0; y = Math.random() * this.height; break;
        }

        points.push({ x, y });

        // Flow downhill
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

            // Add some randomness
            x = lowestNeighbor.x + (Math.random() - 0.5) * 3;
            y = lowestNeighbor.y + (Math.random() - 0.5) * 3;

            points.push({ x, y });

            // Stop if we reach an edge
            if (x < 5 || x > this.width - 5 || y < 5 || y > this.height - 5) break;
        }

        return points;
    }

    generateLake(elevationData) {
        // Find a low point
        let lowestX = 0, lowestY = 0, lowestVal = Infinity;

        for (let i = 0; i < 100; i++) {
            const x = Math.floor(Math.random() * this.width);
            const y = Math.floor(Math.random() * this.height);
            const val = elevationData[y * this.width + x];

            if (val < lowestVal) {
                lowestVal = val;
                lowestX = x;
                lowestY = y;
            }
        }

        // Create lake shape
        const points = [];
        const numPoints = 8 + Math.floor(Math.random() * 8);
        const radius = 20 + Math.random() * 30;

        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const r = radius * (0.7 + Math.random() * 0.6);
            points.push({
                x: lowestX + Math.cos(angle) * r,
                y: lowestY + Math.sin(angle) * r
            });
        }

        return {
            type: 'lake',
            points: points,
            width: 0 // Lakes are filled shapes
        };
    }

    generateFoliage(elevationData) {
        const foliage = [];
        const numForests = 3 + Math.floor(Math.random() * 5);

        for (let i = 0; i < numForests; i++) {
            // Place forests on moderate elevation
            let x, y, elevation;
            let attempts = 0;

            do {
                x = Math.random() * this.width;
                y = Math.random() * this.height;
                elevation = elevationData[Math.floor(y) * this.width + Math.floor(x)];
                attempts++;
            } while ((elevation < 2 || elevation > 7) && attempts < 50);

            // Create irregular forest shape
            const numPoints = 6 + Math.floor(Math.random() * 6);
            const radius = 30 + Math.random() * 50;
            const shape = [];

            for (let j = 0; j < numPoints; j++) {
                const angle = (j / numPoints) * Math.PI * 2;
                const r = radius * (0.5 + Math.random());
                shape.push({
                    x: x + Math.cos(angle) * r,
                    y: y + Math.sin(angle) * r
                });
            }

            foliage.push({
                density: 0.3 + Math.random() * 0.7,
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
