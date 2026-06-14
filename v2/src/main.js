// App shell: mode switching, camera (pan/zoom), input routing, save/load.

import { generateMap, serializeMap, deserializeMap, WORLD_W, WORLD_H } from './terrain.js';
import { TerrainRenderer } from './renderer.js';
import { Company } from './units.js';
import { Editor } from './editor.js';
import { Game } from './game.js';

const SAVE_KEY = 'regiments-v2-level';

class App {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.map = generateMap(null, 'rolling');
        this.companies = [];
        this.terrainRenderer = new TerrainRenderer();
        this.editor = new Editor(this);
        this.game = new Game(this);
        this.mode = 'editor';
        this.scenarioSnapshot = null;

        // Camera: world coords of top-left corner + zoom scale
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.panning = null;

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.bindUI();
        this.bindCanvas();

        this.lastTime = performance.now();
        requestAnimationFrame(t => this.frame(t));
    }

    resizeCanvas() {
        const wrap = document.getElementById('canvas-wrap');
        this.canvas.width = wrap.clientWidth;
        this.canvas.height = wrap.clientHeight;
        this.minZoom = Math.min(this.canvas.width / WORLD_W, this.canvas.height / WORLD_H) * 0.95;
        if (!this._zoomInitialized) {
            this.camera.zoom = this.minZoom;
            this._zoomInitialized = true;
        }
        this.clampCamera();
    }

    clampCamera() {
        const cam = this.camera;
        cam.zoom = Math.max(this.minZoom, Math.min(5, cam.zoom));
        const viewW = this.canvas.width / cam.zoom;
        const viewH = this.canvas.height / cam.zoom;
        cam.x = Math.max(Math.min(cam.x, WORLD_W - viewW * 0.5), -viewW * 0.5);
        cam.y = Math.max(Math.min(cam.y, WORLD_H - viewH * 0.5), -viewH * 0.5);
    }

    // --- Mode switching ---

    setMode(mode) {
        if (mode === this.mode) return;
        if (mode === 'play') {
            this.scenarioSnapshot = this.companies.map(c => ({ side: c.side, type: c.type, x: c.x, y: c.y }));
            this.companies = this.scenarioSnapshot.map(s => new Company(s.side, s.type, s.x, s.y));
            this.game.reset();
        } else if (this.scenarioSnapshot) {
            this.companies = this.scenarioSnapshot.map(s => new Company(s.side, s.type, s.x, s.y));
        }
        this.mode = mode;
        document.getElementById('tab-editor').classList.toggle('active', mode === 'editor');
        document.getElementById('tab-play').classList.toggle('active', mode === 'play');
        document.getElementById('editor-panel').style.display = mode === 'editor' ? '' : 'none';
        document.getElementById('play-panel').style.display = mode === 'play' ? '' : 'none';
    }

    // --- UI wiring ---

    bindUI() {
        document.getElementById('tab-editor').addEventListener('click', () => this.setMode('editor'));
        document.getElementById('tab-play').addEventListener('click', () => this.setMode('play'));

        document.getElementById('btn-generate').addEventListener('click', () => {
            const seedInput = document.getElementById('gen-seed').value;
            const seed = seedInput === '' ? null : parseInt(seedInput, 10);
            const style = document.getElementById('gen-style').value;
            this.editor.regenerate(seed, style);
            document.getElementById('gen-seed').value = this.map.seed;
        });

        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.editor.tool = btn.dataset.tool;
                document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
            });
        });

        const radiusSlider = document.getElementById('brush-radius');
        radiusSlider.addEventListener('input', () => { this.editor.brushRadius = +radiusSlider.value; });
        const strengthSlider = document.getElementById('brush-strength');
        strengthSlider.addEventListener('input', () => { this.editor.brushStrength = +strengthSlider.value; });
        const streamSlider = document.getElementById('stream-size');
        streamSlider.addEventListener('input', () => { this.editor.streamSize = +streamSlider.value; });

        document.getElementById('unit-side').addEventListener('change', e => { this.editor.unitSide = +e.target.value; });
        document.getElementById('unit-type').addEventListener('change', e => { this.editor.unitType = e.target.value; });
        document.getElementById('btn-clear-units').addEventListener('click', () => { this.companies = []; });

        document.getElementById('btn-save').addEventListener('click', () => {
            const data = {
                map: serializeMap(this.map),
                units: this.companies.map(c => ({ side: c.side, type: c.type, x: c.x, y: c.y }))
            };
            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            this.flashStatus('Level saved.');
        });
        document.getElementById('btn-load').addEventListener('click', () => {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) { this.flashStatus('No saved level found.'); return; }
            try {
                const data = JSON.parse(raw);
                this.map = deserializeMap(data.map);
                this.companies = data.units.map(u => new Company(u.side, u.type, u.x, u.y));
                this.terrainRenderer.invalidate();
                this.flashStatus('Level loaded.');
            } catch (err) {
                this.flashStatus(err.message);
            }
        });

        document.getElementById('btn-pause').addEventListener('click', e => {
            this.game.paused = !this.game.paused;
            e.target.textContent = this.game.paused ? 'Resume' : 'Pause';
        });
        document.querySelectorAll('[data-speed]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.game.speed = +btn.dataset.speed;
                document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
            });
        });
        document.getElementById('btn-restart').addEventListener('click', () => {
            if (this.scenarioSnapshot) {
                this.companies = this.scenarioSnapshot.map(s => new Company(s.side, s.type, s.x, s.y));
                this.game.reset();
            }
        });
    }

    flashStatus(msg) {
        const el = document.getElementById('status-bar');
        el.textContent = msg;
        clearTimeout(this._statusTimer);
        this._statusTimer = setTimeout(() => { el.textContent = ''; }, 2500);
    }

    // --- Canvas input ---

    screenCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    worldCoords(e) {
        const s = this.screenCoords(e);
        return {
            x: s.x / this.camera.zoom + this.camera.x,
            y: s.y / this.camera.zoom + this.camera.y
        };
    }

    bindCanvas() {
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());

        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const s = this.screenCoords(e);
            const cam = this.camera;
            const wx = s.x / cam.zoom + cam.x;
            const wy = s.y / cam.zoom + cam.y;
            cam.zoom *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
            cam.zoom = Math.max(this.minZoom, Math.min(5, cam.zoom));
            // Keep the point under the cursor fixed while zooming
            cam.x = wx - s.x / cam.zoom;
            cam.y = wy - s.y / cam.zoom;
            this.clampCamera();
        }, { passive: false });

        this.canvas.addEventListener('pointerdown', e => {
            if (e.button === 1) {
                e.preventDefault();
                const s = this.screenCoords(e);
                this.panning = { sx: s.x, sy: s.y, cx: this.camera.x, cy: this.camera.y };
                this.canvas.setPointerCapture(e.pointerId);
                return;
            }
            const { x, y } = this.worldCoords(e);
            if (this.mode === 'editor') this.editor.onPointerDown(x, y, e.button);
            else this.game.onPointerDown(x, y, e.button, e.shiftKey);
        });

        this.canvas.addEventListener('pointermove', e => {
            if (this.panning) {
                const s = this.screenCoords(e);
                this.camera.x = this.panning.cx - (s.x - this.panning.sx) / this.camera.zoom;
                this.camera.y = this.panning.cy - (s.y - this.panning.sy) / this.camera.zoom;
                this.clampCamera();
                return;
            }
            const { x, y } = this.worldCoords(e);
            if (this.mode === 'editor') this.editor.onPointerMove(x, y);
            else this.game.onPointerMove(x, y);
        });

        window.addEventListener('pointerup', e => {
            if (e.button === 1) { this.panning = null; return; }
            const { x, y } = this.worldCoords(e);
            if (this.mode === 'editor') this.editor.onPointerUp();
            else this.game.onPointerUp(x, y, e.button);
        });
    }

    // --- Main loop ---

    frame(time) {
        const dt = Math.min(0.05, (time - this.lastTime) / 1000);
        this.lastTime = time;

        if (this.mode === 'play') {
            this.game.update(dt);
            const status = document.getElementById('battle-status');
            if (status) status.textContent = this.game.statusText();
        }

        const ctx = this.ctx;
        const cam = this.camera;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#221e18';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);

        this.terrainRenderer.draw(ctx, this.map);

        if (this.mode === 'editor') {
            for (const c of this.companies) c.draw(ctx, false);
            this.editor.draw(ctx, cam.zoom);
        } else {
            this.game.draw(ctx);
        }

        requestAnimationFrame(t => this.frame(t));
    }
}

window.app = new App();
document.getElementById('gen-seed').value = '';
