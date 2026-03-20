// Civil War RTS - Procedural Map Editor

export class MapEditor {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = gameState;

        this.currentSeed = Math.floor(Math.random() * 999999);
        this.terrainStyle = 'rolling';

        this.setupCanvas();
        this.setupEventListeners();
        this.generate();
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
        document.getElementById('btn-generate-map').addEventListener('click', () => {
            const seedInput = document.getElementById('map-seed');
            const val = parseInt(seedInput.value);
            if (!isNaN(val)) {
                this.currentSeed = val;
            } else {
                this.currentSeed = Math.floor(Math.random() * 999999);
                seedInput.value = '';
            }
            this.generate();
        });

        document.getElementById('btn-new-seed').addEventListener('click', () => {
            this.currentSeed = Math.floor(Math.random() * 999999);
            document.getElementById('map-seed').value = '';
            this.generate();
        });

        document.getElementById('terrain-style').addEventListener('change', (e) => {
            this.terrainStyle = e.target.value;
            this.generate();
        });

        document.getElementById('btn-save-map').addEventListener('click', () => this.saveMap());
    }

    generate() {
        this.showLoading();

        setTimeout(() => {
            const width = Math.min(800, this.canvas.width);
            const height = Math.min(600, this.canvas.height);

            this.state.generateMap(width, height, this.currentSeed, this.terrainStyle);
            this.render();
        }, 50);
    }

    showLoading() {
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#8b7355';
        this.ctx.font = '20px Georgia';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Generating map...', this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.font = '14px Georgia';
        this.ctx.fillStyle = '#a89070';
        this.ctx.fillText(`Seed: ${this.currentSeed}`, this.canvas.width / 2, this.canvas.height / 2 + 30);
    }

    render() {
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.state.currentMap) {
            this.renderMapPreview();
            this.renderSeedOverlay();
        } else {
            this.ctx.fillStyle = '#8b7355';
            this.ctx.font = '18px Georgia';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Click "Generate Map" to create a map.',
                this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    renderSeedOverlay() {
        this.ctx.fillStyle = 'rgba(44, 36, 22, 0.6)';
        this.ctx.fillRect(8, 8, 200, 28);
        this.ctx.fillStyle = '#a89070';
        this.ctx.font = '13px Georgia';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Seed: ${this.currentSeed}`, 16, 27);
    }

    renderMapPreview() {
        const map = this.state.currentMap;
        this.renderElevation(map);
        this.renderIsolines(map.isolines);
        this.renderWaterways(map.waterways);
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

        const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
        const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

        for (const isoline of isolines) {
            if (isoline.points.length < 2) continue;

            this.ctx.beginPath();
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

    saveMap() {
        if (!this.state.currentMap) {
            alert('Please generate a map first.');
            return;
        }

        const mapData = JSON.stringify({
            seed: this.currentSeed,
            style: this.terrainStyle,
            map: this.state.currentMap
        });

        const blob = new Blob([mapData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `map_${this.currentSeed}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }
}
