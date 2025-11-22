// Civil War RTS - Battle Controller

import { GameLoop } from '../gameLoop.js';
import { AIController } from '../ai/aiController.js';

export class BattleController {
    constructor(canvas, minimap, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.minimap = minimap;
        this.minimapCtx = minimap.getContext('2d');
        this.state = gameState;

        this.selectedUnits = [];
        this.isSelecting = false;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.drawingHoldLine = false;
        this.holdLineStart = null;

        this.camera = {
            x: 0,
            y: 0,
            zoom: 1
        };

        this.showSupplyLines = false;
        this.showElevation = true;

        this.gameLoop = null;
        this.aiController = new AIController(this.state);

        this.setupCanvas();
        this.setupEventListeners();
    }

    setupCanvas() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const container = this.canvas.parentElement;
        const hud = document.getElementById('battle-hud');
        const hudWidth = hud ? hud.offsetWidth : 300;

        this.canvas.width = container.offsetWidth - hudWidth;
        this.canvas.height = container.offsetHeight;
    }

    setupEventListeners() {
        // Mouse events for selection and commands
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
        });

        // Keyboard controls
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));

        // Minimap click
        this.minimap.addEventListener('click', (e) => this.handleMinimapClick(e));

        // HUD controls
        document.getElementById('btn-dig-in').addEventListener('click', () => this.commandDigIn());
        document.getElementById('btn-hold-line').addEventListener('click', () => this.toggleHoldLineMode());
        document.getElementById('btn-retreat').addEventListener('click', () => this.commandRetreat());

        document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
        document.getElementById('btn-normal-speed').addEventListener('click', () => this.setSpeed(1));
        document.getElementById('btn-fast-speed').addEventListener('click', () => this.setSpeed(2));

        document.getElementById('toggle-supply-lines').addEventListener('change', (e) => {
            this.showSupplyLines = e.target.checked;
        });

        document.getElementById('toggle-elevation').addEventListener('change', (e) => {
            this.showElevation = e.target.checked;
        });
    }

    start() {
        this.resize();
        this.state.isPaused = false;
        this.state.gameSpeed = 1;
        this.state.gameTime = 0;

        // Center camera
        if (this.state.currentMap) {
            this.camera.x = this.state.currentMap.dimensions.width / 2 - this.canvas.width / 2;
            this.camera.y = this.state.currentMap.dimensions.height / 2 - this.canvas.height / 2;
        }

        this.gameLoop = new GameLoop(this.state, this);
        this.gameLoop.start();
    }

    stop() {
        if (this.gameLoop) {
            this.gameLoop.stop();
            this.gameLoop = null;
        }
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left + this.camera.x,
            y: e.clientY - rect.top + this.camera.y
        };
    }

    handleMouseDown(e) {
        if (e.button !== 0) return;

        const pos = this.getMousePos(e);

        if (this.drawingHoldLine) {
            this.holdLineStart = pos;
            return;
        }

        // Check if clicking on a unit
        const clickedUnit = this.state.getRegimentAt(pos.x, pos.y);

        if (clickedUnit && clickedUnit.player === 1) {
            if (e.shiftKey) {
                // Add to selection
                if (!this.selectedUnits.includes(clickedUnit)) {
                    this.selectedUnits.push(clickedUnit);
                }
            } else {
                // Single select
                this.selectedUnits = [clickedUnit];
            }
            this.updateUnitInfoPanel();
        } else {
            // Start selection box
            this.isSelecting = true;
            this.selectionStart = pos;
            this.selectionEnd = pos;
        }
    }

    handleMouseMove(e) {
        const pos = this.getMousePos(e);

        if (this.isSelecting) {
            this.selectionEnd = pos;
        }
    }

    handleMouseUp(e) {
        const pos = this.getMousePos(e);

        if (this.drawingHoldLine && this.holdLineStart) {
            // Apply hold line to selected units
            for (const unit of this.selectedUnits) {
                if (unit.player === 1) {
                    unit.holdLine = [this.holdLineStart, pos];
                    // Move towards line center
                    unit.targetPosition = {
                        x: (this.holdLineStart.x + pos.x) / 2,
                        y: (this.holdLineStart.y + pos.y) / 2
                    };
                }
            }
            this.holdLineStart = null;
            this.drawingHoldLine = false;
            return;
        }

        if (this.isSelecting) {
            this.isSelecting = false;

            // Select units in box
            const minX = Math.min(this.selectionStart.x, this.selectionEnd.x);
            const maxX = Math.max(this.selectionStart.x, this.selectionEnd.x);
            const minY = Math.min(this.selectionStart.y, this.selectionEnd.y);
            const maxY = Math.max(this.selectionStart.y, this.selectionEnd.y);

            // If box is too small, clear selection
            if (maxX - minX < 5 && maxY - minY < 5) {
                this.selectedUnits = [];
            } else {
                this.selectedUnits = this.state.regiments.filter(r =>
                    r.player === 1 &&
                    r.position.x >= minX && r.position.x <= maxX &&
                    r.position.y >= minY && r.position.y <= maxY
                );
            }

            this.updateUnitInfoPanel();
        }
    }

    handleRightClick(e) {
        if (this.selectedUnits.length === 0) return;

        const pos = this.getMousePos(e);

        // Move selected units to position
        for (const unit of this.selectedUnits) {
            if (unit.player === 1 && !unit.isScattered) {
                unit.targetPosition = { x: pos.x, y: pos.y };
                unit.isRetreating = false;
                unit.isDugIn = false;
                unit.holdLine = null;
            }
        }
    }

    handleKeyDown(e) {
        const moveSpeed = 20;

        switch (e.key) {
            case 'ArrowLeft':
                this.camera.x -= moveSpeed;
                break;
            case 'ArrowRight':
                this.camera.x += moveSpeed;
                break;
            case 'ArrowUp':
                this.camera.y -= moveSpeed;
                break;
            case 'ArrowDown':
                this.camera.y += moveSpeed;
                break;
            case 'd':
                this.commandDigIn();
                break;
            case 'h':
                this.toggleHoldLineMode();
                break;
            case 'r':
                this.commandRetreat();
                break;
            case ' ':
                this.togglePause();
                break;
        }

        // Clamp camera
        if (this.state.currentMap) {
            this.camera.x = Math.max(0, Math.min(
                this.state.currentMap.dimensions.width - this.canvas.width,
                this.camera.x
            ));
            this.camera.y = Math.max(0, Math.min(
                this.state.currentMap.dimensions.height - this.canvas.height,
                this.camera.y
            ));
        }
    }

    handleMinimapClick(e) {
        if (!this.state.currentMap) return;

        const rect = this.minimap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const scaleX = this.state.currentMap.dimensions.width / this.minimap.width;
        const scaleY = this.state.currentMap.dimensions.height / this.minimap.height;

        this.camera.x = x * scaleX - this.canvas.width / 2;
        this.camera.y = y * scaleY - this.canvas.height / 2;

        // Clamp
        this.camera.x = Math.max(0, Math.min(
            this.state.currentMap.dimensions.width - this.canvas.width,
            this.camera.x
        ));
        this.camera.y = Math.max(0, Math.min(
            this.state.currentMap.dimensions.height - this.canvas.height,
            this.camera.y
        ));
    }

    commandDigIn() {
        for (const unit of this.selectedUnits) {
            if (unit.player === 1 && !unit.isScattered) {
                unit.isDugIn = true;
                unit.targetPosition = null;
            }
        }
    }

    toggleHoldLineMode() {
        this.drawingHoldLine = !this.drawingHoldLine;
        document.getElementById('btn-hold-line').classList.toggle('active', this.drawingHoldLine);
    }

    commandRetreat() {
        for (const unit of this.selectedUnits) {
            if (unit.player === 1) {
                unit.isRetreating = true;
                // Retreat towards friendly depot
                const depot = this.state.supplies.depots.find(d => d.player === 1);
                if (depot) {
                    unit.targetPosition = { x: depot.position.x + 50, y: depot.position.y };
                }
            }
        }
    }

    togglePause() {
        this.state.isPaused = !this.state.isPaused;
        document.getElementById('btn-pause').textContent = this.state.isPaused ? 'Resume' : 'Pause';
    }

    setSpeed(speed) {
        this.state.gameSpeed = speed;
        document.getElementById('btn-normal-speed').classList.toggle('active', speed === 1);
        document.getElementById('btn-fast-speed').classList.toggle('active', speed === 2);
    }

    updateUnitInfoPanel() {
        const panel = document.getElementById('unit-details');

        if (this.selectedUnits.length === 0) {
            panel.innerHTML = '<p>Select a unit</p>';
            return;
        }

        if (this.selectedUnits.length === 1) {
            const unit = this.selectedUnits[0];
            panel.innerHTML = `
                <p><strong>${unit.type.charAt(0).toUpperCase() + unit.type.slice(1)}</strong></p>
                <p>Troops: ${unit.troopCount}/${unit.maxTroopCount}</p>
                <p>Strength: ${Math.round(unit.strength)}%</p>
                <div class="stat-bar"><div class="stat-bar-fill strength" style="width: ${unit.strength}%"></div></div>
                <p>Morale: ${Math.round(unit.morale)}%</p>
                <div class="stat-bar"><div class="stat-bar-fill morale" style="width: ${unit.morale}%"></div></div>
                <p>Ammo: ${Math.round(unit.ammo)}%</p>
                <div class="stat-bar"><div class="stat-bar-fill ammo" style="width: ${unit.ammo}%"></div></div>
                <p>Food: ${Math.round(unit.food)}%</p>
                <div class="stat-bar"><div class="stat-bar-fill food" style="width: ${unit.food}%"></div></div>
                <p>${unit.isDugIn ? 'Dug In' : ''} ${unit.isRetreating ? 'Retreating' : ''} ${unit.isScattered ? 'Scattered' : ''}</p>
            `;
        } else {
            panel.innerHTML = `<p><strong>${this.selectedUnits.length} units selected</strong></p>`;
        }
    }

    render() {
        // Clear canvas
        this.ctx.fillStyle = '#f4e4bc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.state.currentMap) return;

        // Save context and apply camera transform
        this.ctx.save();
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // Render map
        this.renderMap();

        // Render supply lines
        if (this.showSupplyLines) {
            this.renderSupplyLines();
        }

        // Render supply structures
        this.renderSupplyStructures();

        // Render units
        this.renderUnits();

        // Render selection box
        if (this.isSelecting) {
            this.renderSelectionBox();
        }

        // Render hold line preview
        if (this.drawingHoldLine && this.holdLineStart) {
            this.ctx.strokeStyle = '#d4a574';
            this.ctx.lineWidth = 3;
            this.ctx.setLineDash([10, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(this.holdLineStart.x, this.holdLineStart.y);
            // Draw to mouse position
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = this.camera.x + (window.mouseX || 0) - rect.left;
            const mouseY = this.camera.y + (window.mouseY || 0) - rect.top;
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        this.ctx.restore();

        // Render minimap
        this.renderMinimap();

        // Update unit info panel periodically
        if (this.selectedUnits.length > 0) {
            this.updateUnitInfoPanel();
        }
    }

    renderMap() {
        const map = this.state.currentMap;

        // Draw elevation (only visible portion)
        if (this.showElevation && map.elevationData) {
            const startX = Math.floor(this.camera.x);
            const startY = Math.floor(this.camera.y);
            const endX = Math.min(map.dimensions.width, startX + this.canvas.width);
            const endY = Math.min(map.dimensions.height, startY + this.canvas.height);

            const imageData = this.ctx.createImageData(endX - startX, endY - startY);
            const data = imageData.data;

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const elevation = map.elevationData[y * map.dimensions.width + x] || 0;

                    const baseR = 244, baseG = 228, baseB = 188;
                    const shade = elevation / 10;

                    const i = ((y - startY) * (endX - startX) + (x - startX)) * 4;
                    data[i] = baseR - shade * 30;
                    data[i + 1] = baseG - shade * 40;
                    data[i + 2] = baseB - shade * 50;
                    data[i + 3] = 255;
                }
            }

            this.ctx.putImageData(imageData, startX, startY);
        }

        // Draw isolines
        this.ctx.strokeStyle = '#8b7355';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.5;

        for (const isoline of map.isolines || []) {
            if (isoline.points.length < 2) continue;

            this.ctx.beginPath();
            this.ctx.moveTo(isoline.points[0].x, isoline.points[0].y);

            for (let i = 1; i < isoline.points.length; i++) {
                this.ctx.lineTo(isoline.points[i].x, isoline.points[i].y);
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

                this.ctx.moveTo(waterway.points[0].x, waterway.points[0].y);
                for (let i = 1; i < waterway.points.length; i++) {
                    this.ctx.lineTo(waterway.points[i].x, waterway.points[i].y);
                }
                this.ctx.closePath();
                this.ctx.fill();
            } else {
                this.ctx.strokeStyle = '#6ca6cd';
                this.ctx.lineWidth = waterway.width;
                this.ctx.lineCap = 'round';
                this.ctx.globalAlpha = 0.7;

                this.ctx.beginPath();
                this.ctx.moveTo(waterway.points[0].x, waterway.points[0].y);
                for (let i = 1; i < waterway.points.length; i++) {
                    this.ctx.lineTo(waterway.points[i].x, waterway.points[i].y);
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
            this.ctx.moveTo(forest.shape[0].x, forest.shape[0].y);
            for (let i = 1; i < forest.shape.length; i++) {
                this.ctx.lineTo(forest.shape[i].x, forest.shape[i].y);
            }
            this.ctx.closePath();
            this.ctx.fill();
        }

        this.ctx.globalAlpha = 1;
    }

    renderSupplyLines() {
        this.ctx.strokeStyle = '#d4a574';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);

        for (const line of this.state.supplies.supplyLines) {
            this.ctx.beginPath();
            this.ctx.moveTo(line.fromPos.x, line.fromPos.y);
            this.ctx.lineTo(line.toPos.x, line.toPos.y);
            this.ctx.stroke();
        }

        this.ctx.setLineDash([]);
    }

    renderSupplyStructures() {
        // Draw depots
        for (const depot of this.state.supplies.depots) {
            this.ctx.fillStyle = this.state.players[depot.player].color;
            this.ctx.strokeStyle = '#2c2416';
            this.ctx.lineWidth = 2;

            this.ctx.fillRect(depot.position.x - 12, depot.position.y - 12, 24, 24);
            this.ctx.strokeRect(depot.position.x - 12, depot.position.y - 12, 24, 24);

            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 10px Georgia';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('D', depot.position.x, depot.position.y + 4);
        }

        // Draw camps
        for (const camp of this.state.supplies.camps) {
            this.ctx.fillStyle = this.state.players[camp.player].color;
            this.ctx.strokeStyle = '#2c2416';
            this.ctx.lineWidth = 2;

            this.ctx.beginPath();
            this.ctx.moveTo(camp.position.x, camp.position.y - 12);
            this.ctx.lineTo(camp.position.x - 12, camp.position.y + 8);
            this.ctx.lineTo(camp.position.x + 12, camp.position.y + 8);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    renderUnits() {
        for (const regiment of this.state.regiments) {
            this.renderRegiment(regiment);
        }
    }

    renderRegiment(regiment) {
        const x = regiment.position.x;
        const y = regiment.position.y;
        const color = this.state.players[regiment.player].color;
        const isSelected = this.selectedUnits.includes(regiment);

        // Draw selection highlight
        if (isSelected) {
            this.ctx.strokeStyle = '#ffd700';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 25, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Draw hold line
        if (regiment.holdLine) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(regiment.holdLine[0].x, regiment.holdLine[0].y);
            this.ctx.lineTo(regiment.holdLine[1].x, regiment.holdLine[1].y);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Draw troops as circles in formation
        const troopsToDraw = Math.min(regiment.troopCount, 50); // Limit for performance
        const cols = Math.ceil(Math.sqrt(troopsToDraw));
        const rows = Math.ceil(troopsToDraw / cols);
        const spacing = 4;

        // Apply color modification for status
        let actualColor = color;
        if (regiment.isScattered) {
            actualColor = '#808080'; // Gray for scattered
        } else if (regiment.isRetreating) {
            actualColor = this.lightenColor(color, 0.3);
        }

        this.ctx.fillStyle = actualColor;

        // Rotate based on facing
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(regiment.facing);

        const startX = -(cols - 1) * spacing / 2;
        const startY = -(rows - 1) * spacing / 2;

        let count = 0;
        for (let r = 0; r < rows && count < troopsToDraw; r++) {
            for (let c = 0; c < cols && count < troopsToDraw; c++) {
                this.ctx.beginPath();
                this.ctx.arc(startX + c * spacing, startY + r * spacing, 2, 0, Math.PI * 2);
                this.ctx.fill();
                count++;
            }
        }

        this.ctx.restore();

        // Draw unit type indicator
        this.ctx.strokeStyle = '#2c2416';
        this.ctx.lineWidth = 1;

        if (regiment.type === 'artillery') {
            // Circle around artillery
            this.ctx.beginPath();
            this.ctx.arc(x, y, 15, 0, Math.PI * 2);
            this.ctx.stroke();
        } else if (regiment.type === 'cavalry') {
            // Diamond for cavalry
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - 15);
            this.ctx.lineTo(x + 15, y);
            this.ctx.lineTo(x, y + 15);
            this.ctx.lineTo(x - 15, y);
            this.ctx.closePath();
            this.ctx.stroke();
        }

        // Draw dug-in indicator
        if (regiment.isDugIn) {
            this.ctx.strokeStyle = '#8b4513';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 20, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Draw morale indicator (colored bar above unit)
        const moraleWidth = 30;
        const moraleHeight = 4;
        const moraleX = x - moraleWidth / 2;
        const moraleY = y - 25;

        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(moraleX, moraleY, moraleWidth, moraleHeight);

        const moraleColor = regiment.morale > 50 ? '#6b8e23' :
                          regiment.morale > 20 ? '#ffa500' : '#dc143c';
        this.ctx.fillStyle = moraleColor;
        this.ctx.fillRect(moraleX, moraleY, moraleWidth * regiment.morale / 100, moraleHeight);
    }

    lightenColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + 255 * amount);
        const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + 255 * amount);
        const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + 255 * amount);
        return `rgb(${r}, ${g}, ${b})`;
    }

    renderSelectionBox() {
        const minX = Math.min(this.selectionStart.x, this.selectionEnd.x);
        const maxX = Math.max(this.selectionStart.x, this.selectionEnd.x);
        const minY = Math.min(this.selectionStart.y, this.selectionEnd.y);
        const maxY = Math.max(this.selectionStart.y, this.selectionEnd.y);

        this.ctx.strokeStyle = '#d4a574';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = 'rgba(212, 165, 116, 0.1)';
        this.ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }

    renderMinimap() {
        if (!this.state.currentMap) return;

        const map = this.state.currentMap;
        const scaleX = this.minimap.width / map.dimensions.width;
        const scaleY = this.minimap.height / map.dimensions.height;

        // Clear minimap
        this.minimapCtx.fillStyle = '#f4e4bc';
        this.minimapCtx.fillRect(0, 0, this.minimap.width, this.minimap.height);

        // Draw terrain simplified
        this.minimapCtx.fillStyle = '#d4c4a4';
        this.minimapCtx.fillRect(0, 0, this.minimap.width, this.minimap.height);

        // Draw foliage
        this.minimapCtx.fillStyle = '#6b8e23';
        this.minimapCtx.globalAlpha = 0.5;
        for (const forest of map.foliage || []) {
            this.minimapCtx.beginPath();
            this.minimapCtx.moveTo(forest.shape[0].x * scaleX, forest.shape[0].y * scaleY);
            for (let i = 1; i < forest.shape.length; i++) {
                this.minimapCtx.lineTo(forest.shape[i].x * scaleX, forest.shape[i].y * scaleY);
            }
            this.minimapCtx.closePath();
            this.minimapCtx.fill();
        }
        this.minimapCtx.globalAlpha = 1;

        // Draw waterways
        this.minimapCtx.fillStyle = '#6ca6cd';
        for (const waterway of map.waterways || []) {
            if (waterway.type === 'lake') {
                this.minimapCtx.beginPath();
                this.minimapCtx.moveTo(waterway.points[0].x * scaleX, waterway.points[0].y * scaleY);
                for (let i = 1; i < waterway.points.length; i++) {
                    this.minimapCtx.lineTo(waterway.points[i].x * scaleX, waterway.points[i].y * scaleY);
                }
                this.minimapCtx.closePath();
                this.minimapCtx.fill();
            }
        }

        // Draw units
        for (const regiment of this.state.regiments) {
            this.minimapCtx.fillStyle = this.state.players[regiment.player].color;
            this.minimapCtx.beginPath();
            this.minimapCtx.arc(
                regiment.position.x * scaleX,
                regiment.position.y * scaleY,
                3,
                0, Math.PI * 2
            );
            this.minimapCtx.fill();
        }

        // Draw camera viewport
        this.minimapCtx.strokeStyle = '#d4a574';
        this.minimapCtx.lineWidth = 2;
        this.minimapCtx.strokeRect(
            this.camera.x * scaleX,
            this.camera.y * scaleY,
            this.canvas.width * scaleX,
            this.canvas.height * scaleY
        );
    }
}
