// Civil War RTS - Map Editor Brush Engine

export class MapEditor {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = gameState;

        this.currentBrush = 'elevation';
        this.brushSize = 20;
        this.isDrawing = false;
        this.currentStroke = null;

        this.setupCanvas();
        this.setupEventListeners();
    }

    setupCanvas() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const container = this.canvas.parentElement;
        const toolbar = container.querySelector('.editor-toolbar');
        const toolbarWidth = toolbar ? toolbar.offsetWidth : 300;

        this.canvas.width = container.offsetWidth - toolbarWidth;
        this.canvas.height = container.offsetHeight;

        this.render();
    }

    setupEventListeners() {
        // Brush selection
        document.querySelectorAll('.brush-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentBrush = btn.dataset.brush;
            });
        });

        // Brush size
        const brushSizeSlider = document.getElementById('brush-size');
        const brushSizeValue = document.getElementById('brush-size-value');
        brushSizeSlider.addEventListener('input', () => {
            this.brushSize = parseInt(brushSizeSlider.value);
            brushSizeValue.textContent = this.brushSize;
        });

        // Canvas mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startStroke(e));
        this.canvas.addEventListener('mousemove', (e) => this.continueStroke(e));
        this.canvas.addEventListener('mouseup', () => this.endStroke());
        this.canvas.addEventListener('mouseleave', () => this.endStroke());

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startStroke(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.continueStroke(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', () => this.endStroke());

        // Action buttons
        document.getElementById('btn-generate-map').addEventListener('click', () => this.generateTerrain());
        document.getElementById('btn-random-map').addEventListener('click', () => this.generateRandomMap());
        document.getElementById('btn-clear-map').addEventListener('click', () => this.clearMap());
        document.getElementById('btn-save-map').addEventListener('click', () => this.saveMap());
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    startStroke(e) {
        this.isDrawing = true;
        const pos = this.getMousePos(e);

        this.currentStroke = {
            brush: this.currentBrush,
            size: this.brushSize,
            density: 1,
            points: [pos]
        };

        this.drawBrushPoint(pos);
    }

    continueStroke(e) {
        if (!this.isDrawing || !this.currentStroke) return;

        const pos = this.getMousePos(e);
        const lastPos = this.currentStroke.points[this.currentStroke.points.length - 1];

        // Only add point if moved enough
        const dist = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y);
        if (dist > 3) {
            // Interpolate points for smooth strokes
            const steps = Math.ceil(dist / 3);
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const interpPos = {
                    x: lastPos.x + (pos.x - lastPos.x) * t,
                    y: lastPos.y + (pos.y - lastPos.y) * t
                };
                this.currentStroke.points.push(interpPos);
                this.drawBrushPoint(interpPos);
            }
        }
    }

    endStroke() {
        if (this.isDrawing && this.currentStroke && this.currentStroke.points.length > 0) {
            // Calculate density based on points concentration
            const density = this.calculateStrokeDensity(this.currentStroke);
            this.currentStroke.density = density;

            // Add to brush data
            this.state.brushData[this.currentBrush].push(this.currentStroke);
        }

        this.isDrawing = false;
        this.currentStroke = null;
    }

    calculateStrokeDensity(stroke) {
        if (stroke.points.length < 2) return 0.5;

        // Calculate based on point density
        const bounds = this.getStrokeBounds(stroke.points);
        const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

        if (area === 0) return 1;

        const density = Math.min(1, stroke.points.length / (area * 0.01));
        return density;
    }

    getStrokeBounds(points) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const point of points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        return { minX, minY, maxX, maxY };
    }

    drawBrushPoint(pos) {
        const colors = {
            elevation: '#8b6914',
            water: '#2e5984',
            foliage: '#3d5a3d'
        };

        this.ctx.fillStyle = colors[this.currentBrush];
        this.ctx.globalAlpha = 0.3;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
    }

    render() {
        // Clear canvas with parchment color
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw all brush strokes
        for (const brushType of ['elevation', 'water', 'foliage']) {
            for (const stroke of this.state.brushData[brushType]) {
                this.renderStroke(stroke, brushType);
            }
        }

        // If map has been generated, show preview
        if (this.state.currentMap) {
            this.renderMapPreview();
        }
    }

    renderStroke(stroke, brushType) {
        const colors = {
            elevation: '#8b6914',
            water: '#2e5984',
            foliage: '#3d5a3d'
        };

        this.ctx.fillStyle = colors[brushType];
        this.ctx.globalAlpha = 0.3;

        for (const point of stroke.points) {
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.globalAlpha = 1;
    }

    renderMapPreview() {
        const map = this.state.currentMap;

        // Draw elevation shading
        this.renderElevation(map);

        // Draw isolines
        this.renderIsolines(map.isolines);

        // Draw waterways
        this.renderWaterways(map.waterways);

        // Draw foliage
        this.renderFoliage(map.foliage);
    }

    renderElevation(map) {
        if (!map.elevationData) return;

        const imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        const data = imageData.data;

        for (let y = 0; y < this.canvas.height; y++) {
            for (let x = 0; x < this.canvas.width; x++) {
                const mapX = Math.floor(x * map.dimensions.width / this.canvas.width);
                const mapY = Math.floor(y * map.dimensions.height / this.canvas.height);
                const elevation = map.elevationData[mapY * map.dimensions.width + mapX] || 0;

                // Color based on elevation (parchment tones)
                const baseR = 244, baseG = 228, baseB = 188;
                const shade = elevation / 10;

                const i = (y * this.canvas.width + x) * 4;
                data[i] = baseR - shade * 30;
                data[i + 1] = baseG - shade * 40;
                data[i + 2] = baseB - shade * 50;
                data[i + 3] = 255;
            }
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    renderIsolines(isolines) {
        if (!isolines) return;

        this.ctx.strokeStyle = '#8b7355';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.5;

        for (const isoline of isolines) {
            if (isoline.points.length < 2) continue;

            this.ctx.beginPath();

            const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
            const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

            const first = isoline.points[0];
            this.ctx.moveTo(first.x * scaleX, first.y * scaleY);

            for (let i = 1; i < isoline.points.length; i++) {
                const p = isoline.points[i];
                this.ctx.lineTo(p.x * scaleX, p.y * scaleY);
            }

            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1;
    }

    renderWaterways(waterways) {
        if (!waterways) return;

        const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
        const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

        for (const waterway of waterways) {
            if (waterway.type === 'lake') {
                // Fill lake
                this.ctx.fillStyle = '#6ca6cd';
                this.ctx.globalAlpha = 0.6;
                this.ctx.beginPath();

                const first = waterway.points[0];
                this.ctx.moveTo(first.x * scaleX, first.y * scaleY);

                for (let i = 1; i < waterway.points.length; i++) {
                    const p = waterway.points[i];
                    this.ctx.lineTo(p.x * scaleX, p.y * scaleY);
                }

                this.ctx.closePath();
                this.ctx.fill();
            } else {
                // Draw river/creek
                this.ctx.strokeStyle = '#6ca6cd';
                this.ctx.lineWidth = waterway.width * scaleX;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.globalAlpha = 0.7;

                this.ctx.beginPath();

                const first = waterway.points[0];
                this.ctx.moveTo(first.x * scaleX, first.y * scaleY);

                for (let i = 1; i < waterway.points.length; i++) {
                    const p = waterway.points[i];
                    this.ctx.lineTo(p.x * scaleX, p.y * scaleY);
                }

                this.ctx.stroke();
            }
        }

        this.ctx.globalAlpha = 1;
    }

    renderFoliage(foliage) {
        if (!foliage) return;

        const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
        const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

        for (const forest of foliage) {
            const alpha = 0.3 + forest.density * 0.4;
            this.ctx.fillStyle = '#6b8e23';
            this.ctx.globalAlpha = alpha;

            this.ctx.beginPath();

            const first = forest.shape[0];
            this.ctx.moveTo(first.x * scaleX, first.y * scaleY);

            for (let i = 1; i < forest.shape.length; i++) {
                const p = forest.shape[i];
                this.ctx.lineTo(p.x * scaleX, p.y * scaleY);
            }

            this.ctx.closePath();
            this.ctx.fill();
        }

        this.ctx.globalAlpha = 1;
    }

    generateTerrain() {
        this.state.generateMapFromBrushData(this.canvas.width, this.canvas.height);
        this.render();
    }

    generateRandomMap() {
        // Show loading state
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#8b7355';
        this.ctx.font = '20px Georgia';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Generating map...', this.canvas.width / 2, this.canvas.height / 2);

        // Use setTimeout to allow the UI to update
        setTimeout(() => {
            this.state.brushData = { elevation: [], water: [], foliage: [] };

            // Use a reasonable size (max 800x600) to prevent performance issues
            const width = Math.min(800, this.canvas.width);
            const height = Math.min(600, this.canvas.height);

            this.state.generateRandomMap(width, height);
            this.render();
        }, 100);
    }

    clearMap() {
        this.state.brushData = { elevation: [], water: [], foliage: [] };
        this.state.currentMap = null;
        this.render();
    }

    saveMap() {
        if (!this.state.currentMap) {
            alert('Please generate a map first.');
            return;
        }

        const mapData = JSON.stringify({
            brushData: this.state.brushData,
            map: this.state.currentMap
        });

        const blob = new Blob([mapData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'map.json';
        a.click();

        URL.revokeObjectURL(url);
    }
}
