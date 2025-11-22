// Civil War RTS - Scenario Editor

export class ScenarioEditor {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = gameState;

        this.currentUnit = 'infantry';
        this.currentPlayer = 1;
        this.deleteMode = false;
        this.selectedUnit = null;

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
        // Unit type selection
        document.querySelectorAll('.unit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentUnit = btn.dataset.unit;
                this.deleteMode = false;
            });
        });

        // Player selection
        document.getElementById('player-select').addEventListener('change', (e) => {
            this.currentPlayer = parseInt(e.target.value);
        });

        // Delete mode
        document.getElementById('btn-delete-unit').addEventListener('click', () => {
            this.deleteMode = !this.deleteMode;
            document.getElementById('btn-delete-unit').classList.toggle('active', this.deleteMode);
        });

        // Canvas click
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
        });

        // Save/Load
        document.getElementById('btn-save-scenario').addEventListener('click', () => this.saveScenario());
        document.getElementById('btn-load-scenario').addEventListener('click', () => this.loadScenario());
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    handleClick(e) {
        const pos = this.getMousePos(e);

        if (this.deleteMode) {
            this.deleteAtPosition(pos);
        } else {
            this.placeUnit(pos);
        }

        this.render();
    }

    handleRightClick(e) {
        const pos = this.getMousePos(e);
        this.deleteAtPosition(pos);
        this.render();
    }

    placeUnit(pos) {
        if (!this.state.currentMap) {
            alert('Please create a map first using the Map Editor.');
            return;
        }

        const scaleX = this.state.currentMap.dimensions.width / this.canvas.width;
        const scaleY = this.state.currentMap.dimensions.height / this.canvas.height;

        const mapPos = {
            x: pos.x * scaleX,
            y: pos.y * scaleY
        };

        switch (this.currentUnit) {
            case 'infantry':
            case 'cavalry':
            case 'artillery':
                const troopCount = this.currentUnit === 'artillery' ? 30 :
                                   this.currentUnit === 'cavalry' ? 50 : 100;
                this.state.addRegiment(this.state.createRegiment(
                    this.currentUnit,
                    this.currentPlayer,
                    mapPos.x,
                    mapPos.y,
                    troopCount
                ));
                break;

            case 'depot':
                this.state.addDepot({
                    position: mapPos,
                    player: this.currentPlayer,
                    foodRate: 10,
                    ammoRate: 10
                });
                break;

            case 'camp':
                this.state.addCamp({
                    position: mapPos,
                    player: this.currentPlayer
                });
                break;
        }
    }

    deleteAtPosition(pos) {
        const scaleX = this.state.currentMap ?
            this.state.currentMap.dimensions.width / this.canvas.width : 1;
        const scaleY = this.state.currentMap ?
            this.state.currentMap.dimensions.height / this.canvas.height : 1;

        const mapPos = {
            x: pos.x * scaleX,
            y: pos.y * scaleY
        };

        // Check for regiment
        const regiment = this.state.getRegimentAt(mapPos.x, mapPos.y);
        if (regiment) {
            this.state.removeRegiment(regiment.id);
            return;
        }

        // Check for supply structure
        const structure = this.state.getSupplyStructureAt(mapPos.x, mapPos.y);
        if (structure) {
            this.state.removeSupplyStructure(structure.id);
            return;
        }
    }

    render() {
        // Clear canvas
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Render map if available
        if (this.state.currentMap) {
            this.renderMap();
        } else {
            this.ctx.fillStyle = '#8b7355';
            this.ctx.font = '20px Georgia';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('No map loaded. Create one in Map Editor first.',
                this.canvas.width / 2, this.canvas.height / 2);
        }

        // Render supply structures
        this.renderSupplyStructures();

        // Render units
        this.renderUnits();
    }

    renderMap() {
        const map = this.state.currentMap;
        const scaleX = this.canvas.width / map.dimensions.width;
        const scaleY = this.canvas.height / map.dimensions.height;

        // Draw elevation
        if (map.elevationData) {
            const imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
            const data = imageData.data;

            for (let y = 0; y < this.canvas.height; y++) {
                for (let x = 0; x < this.canvas.width; x++) {
                    const mapX = Math.floor(x / scaleX);
                    const mapY = Math.floor(y / scaleY);
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

        // Draw isolines
        this.ctx.strokeStyle = '#8b7355';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.5;

        for (const isoline of map.isolines || []) {
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

        // Draw waterways
        for (const waterway of map.waterways || []) {
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

        // Draw foliage
        for (const forest of map.foliage || []) {
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

    renderSupplyStructures() {
        if (!this.state.currentMap) return;

        const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
        const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

        // Draw supply lines
        this.ctx.strokeStyle = '#d4a574';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);

        for (const line of this.state.supplies.supplyLines) {
            this.ctx.beginPath();
            this.ctx.moveTo(line.fromPos.x * scaleX, line.fromPos.y * scaleY);
            this.ctx.lineTo(line.toPos.x * scaleX, line.toPos.y * scaleY);
            this.ctx.stroke();
        }

        this.ctx.setLineDash([]);

        // Draw depots
        for (const depot of this.state.supplies.depots) {
            const x = depot.position.x * scaleX;
            const y = depot.position.y * scaleY;

            this.ctx.fillStyle = this.state.players[depot.player].color;
            this.ctx.strokeStyle = '#2c2416';
            this.ctx.lineWidth = 2;

            // Draw depot as a square
            this.ctx.fillRect(x - 12, y - 12, 24, 24);
            this.ctx.strokeRect(x - 12, y - 12, 24, 24);

            // Label
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 10px Georgia';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('D', x, y + 4);
        }

        // Draw camps
        for (const camp of this.state.supplies.camps) {
            const x = camp.position.x * scaleX;
            const y = camp.position.y * scaleY;

            this.ctx.fillStyle = this.state.players[camp.player].color;
            this.ctx.strokeStyle = '#2c2416';
            this.ctx.lineWidth = 2;

            // Draw camp as a triangle
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - 12);
            this.ctx.lineTo(x - 12, y + 8);
            this.ctx.lineTo(x + 12, y + 8);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    renderUnits() {
        if (!this.state.currentMap) return;

        const scaleX = this.canvas.width / this.state.currentMap.dimensions.width;
        const scaleY = this.canvas.height / this.state.currentMap.dimensions.height;

        for (const regiment of this.state.regiments) {
            const x = regiment.position.x * scaleX;
            const y = regiment.position.y * scaleY;

            this.ctx.fillStyle = this.state.players[regiment.player].color;
            this.ctx.strokeStyle = '#2c2416';
            this.ctx.lineWidth = 2;

            // Draw unit based on type
            const size = regiment.type === 'artillery' ? 18 :
                         regiment.type === 'cavalry' ? 15 : 12;

            if (regiment.type === 'artillery') {
                // Draw artillery as a larger circle
                this.ctx.beginPath();
                this.ctx.arc(x, y, size, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            } else if (regiment.type === 'cavalry') {
                // Draw cavalry as a diamond
                this.ctx.beginPath();
                this.ctx.moveTo(x, y - size);
                this.ctx.lineTo(x + size, y);
                this.ctx.lineTo(x, y + size);
                this.ctx.lineTo(x - size, y);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                // Draw infantry as rows of circles
                const rows = 3;
                const cols = 4;
                const spacing = 4;
                const startX = x - (cols - 1) * spacing / 2;
                const startY = y - (rows - 1) * spacing / 2;

                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        this.ctx.beginPath();
                        this.ctx.arc(startX + c * spacing, startY + r * spacing, 2, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                }

                // Border around formation
                this.ctx.strokeRect(
                    startX - 4, startY - 4,
                    (cols - 1) * spacing + 8, (rows - 1) * spacing + 8
                );
            }

            // Draw troop count
            this.ctx.fillStyle = '#2c2416';
            this.ctx.font = '10px Georgia';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(regiment.troopCount, x, y + size + 12);
        }
    }

    saveScenario() {
        const scenarioData = JSON.stringify({
            regiments: this.state.regiments,
            supplies: this.state.supplies
        });

        const blob = new Blob([scenarioData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'scenario.json';
        a.click();

        URL.revokeObjectURL(url);
    }

    loadScenario() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    this.state.regiments = data.regiments || [];
                    this.state.supplies = data.supplies || {
                        depots: [],
                        camps: [],
                        supplyLines: [],
                        totalAllowedLength: 0
                    };
                    this.state.updateSupplyLines();
                    this.render();
                } catch (err) {
                    alert('Error loading scenario: ' + err.message);
                }
            };
            reader.readAsText(file);
        });

        input.click();
    }
}
