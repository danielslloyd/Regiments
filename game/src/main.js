// Civil War RTS - Main Entry Point
import { GameState } from './gameLoop.js';
import { MapEditor } from './map/brushEngine.js';
import { ScenarioEditor } from './ui/scenarioEditor.js';
import { BattleController } from './ui/battleController.js';

class Game {
    constructor() {
        this.state = new GameState();
        this.mapEditor = null;
        this.scenarioEditor = null;
        this.battleController = null;
        this.currentScreen = 'main-menu';

        this.init();
    }

    init() {
        this.setupMenuHandlers();
        this.setupKeyboardShortcuts();
    }

    setupMenuHandlers() {
        // Main menu buttons
        document.getElementById('btn-map-editor').addEventListener('click', () => {
            this.showScreen('map-editor-screen');
            this.initMapEditor();
        });

        document.getElementById('btn-scenario-editor').addEventListener('click', () => {
            this.showScreen('scenario-editor-screen');
            this.initScenarioEditor();
        });

        document.getElementById('btn-battle').addEventListener('click', () => {
            if (this.state.currentMap && this.state.hasUnits()) {
                this.showScreen('battle-screen');
                this.initBattle();
            } else {
                alert('Please create a map and place units first using the editors.');
            }
        });

        document.getElementById('btn-quick-battle').addEventListener('click', () => {
            this.generateQuickBattle();
        });

        // Back buttons
        document.getElementById('btn-back-from-map').addEventListener('click', () => {
            this.showScreen('main-menu');
        });

        document.getElementById('btn-back-from-scenario').addEventListener('click', () => {
            this.showScreen('main-menu');
        });

        document.getElementById('btn-back-from-battle').addEventListener('click', () => {
            if (this.battleController) {
                this.battleController.stop();
            }
            this.showScreen('main-menu');
        });

        // Start battle from scenario editor
        document.getElementById('btn-start-battle').addEventListener('click', () => {
            if (this.state.currentMap && this.state.hasUnits()) {
                this.showScreen('battle-screen');
                this.initBattle();
            } else {
                alert('Please place units before starting battle.');
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.currentScreen !== 'main-menu') {
                    if (this.battleController) {
                        this.battleController.stop();
                    }
                    this.showScreen('main-menu');
                }
            }
        });
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
        this.currentScreen = screenId;
    }

    initMapEditor() {
        if (!this.mapEditor) {
            const canvas = document.getElementById('map-editor-canvas');
            this.mapEditor = new MapEditor(canvas, this.state);
        }
        this.mapEditor.resize();
    }

    initScenarioEditor() {
        if (!this.scenarioEditor) {
            const canvas = document.getElementById('scenario-editor-canvas');
            this.scenarioEditor = new ScenarioEditor(canvas, this.state);
        }
        this.scenarioEditor.resize();
        this.scenarioEditor.render();
    }

    initBattle() {
        const canvas = document.getElementById('battle-canvas');
        const minimap = document.getElementById('minimap');
        this.battleController = new BattleController(canvas, minimap, this.state);
        this.battleController.start();
    }

    generateQuickBattle() {
        // Generate a random map
        this.state.generateRandomMap(800, 600);

        // Place default units for both players
        this.state.createDefaultScenario();

        // Start battle
        this.showScreen('battle-screen');
        this.initBattle();
    }
}

// Start the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();
});
