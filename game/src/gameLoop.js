// Civil War RTS - Game State and Loop
import { TerrainGenerator } from './map/terrainGenerator.js';

export class GameState {
    constructor() {
        this.currentMap = null;
        this.brushData = {
            elevation: [],
            water: [],
            foliage: []
        };
        this.regiments = [];
        this.supplies = {
            depots: [],
            camps: [],
            supplyLines: [],
            totalAllowedLength: 0
        };
        this.players = {
            1: { color: '#4169E1', name: 'Union' },
            2: { color: '#DC143C', name: 'Confederacy' }
        };
        this.gameTime = 0;
        this.isPaused = false;
        this.gameSpeed = 1;
    }

    generateRandomMap(width, height) {
        const generator = new TerrainGenerator(width, height);
        this.currentMap = generator.generateRandom();
        this.brushData = { elevation: [], water: [], foliage: [] };
    }

    generateMapFromBrushData(width, height) {
        const generator = new TerrainGenerator(width, height);
        this.currentMap = generator.generateFromBrushData(this.brushData);
    }

    hasUnits() {
        return this.regiments.length > 0;
    }

    addRegiment(regiment) {
        regiment.id = `regiment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.regiments.push(regiment);
        this.updateSupplyAllowance();
        return regiment;
    }

    removeRegiment(id) {
        this.regiments = this.regiments.filter(r => r.id !== id);
        this.updateSupplyAllowance();
    }

    addDepot(depot) {
        depot.id = `depot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.supplies.depots.push(depot);
        return depot;
    }

    addCamp(camp) {
        camp.id = `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.supplies.camps.push(camp);
        this.updateSupplyLines();
        return camp;
    }

    removeSupplyStructure(id) {
        this.supplies.depots = this.supplies.depots.filter(d => d.id !== id);
        this.supplies.camps = this.supplies.camps.filter(c => c.id !== id);
        this.updateSupplyLines();
    }

    updateSupplyAllowance() {
        // Total supply line length is proportional to starting troop count
        const totalTroops = this.regiments.reduce((sum, r) => sum + r.troopCount, 0);
        this.supplies.totalAllowedLength = totalTroops * 2; // 2 units of line per soldier
    }

    updateSupplyLines() {
        // Calculate minimum spanning tree from camps to nearest depot
        this.supplies.supplyLines = [];

        for (const camp of this.supplies.camps) {
            let nearestDepot = null;
            let minDist = Infinity;

            for (const depot of this.supplies.depots) {
                if (depot.player === camp.player) {
                    const dist = Math.hypot(
                        depot.position.x - camp.position.x,
                        depot.position.y - camp.position.y
                    );
                    if (dist < minDist) {
                        minDist = dist;
                        nearestDepot = depot;
                    }
                }
            }

            if (nearestDepot) {
                this.supplies.supplyLines.push({
                    from: nearestDepot.id,
                    to: camp.id,
                    length: minDist,
                    fromPos: nearestDepot.position,
                    toPos: camp.position,
                    player: camp.player
                });
                camp.connectedToDepot = nearestDepot.id;
            }
        }
    }

    createDefaultScenario() {
        // Clear existing
        this.regiments = [];
        this.supplies.depots = [];
        this.supplies.camps = [];
        this.supplies.supplyLines = [];

        if (!this.currentMap) return;

        const mapWidth = this.currentMap.dimensions.width;
        const mapHeight = this.currentMap.dimensions.height;

        // Player 1 (Blue/Union) - Left side
        this.addDepot({
            position: { x: 50, y: mapHeight / 2 },
            player: 1,
            foodRate: 10,
            ammoRate: 10
        });

        this.addCamp({
            position: { x: 150, y: mapHeight / 2 },
            player: 1
        });

        // Player 1 units
        this.addRegiment(this.createRegiment('infantry', 1, 200, mapHeight / 2 - 80, 100));
        this.addRegiment(this.createRegiment('infantry', 1, 200, mapHeight / 2, 100));
        this.addRegiment(this.createRegiment('infantry', 1, 200, mapHeight / 2 + 80, 100));
        this.addRegiment(this.createRegiment('cavalry', 1, 180, mapHeight / 2 - 150, 50));
        this.addRegiment(this.createRegiment('artillery', 1, 120, mapHeight / 2, 30));

        // Player 2 (Red/Confederacy) - Right side
        this.addDepot({
            position: { x: mapWidth - 50, y: mapHeight / 2 },
            player: 2,
            foodRate: 10,
            ammoRate: 10
        });

        this.addCamp({
            position: { x: mapWidth - 150, y: mapHeight / 2 },
            player: 2
        });

        // Player 2 units
        this.addRegiment(this.createRegiment('infantry', 2, mapWidth - 200, mapHeight / 2 - 80, 100));
        this.addRegiment(this.createRegiment('infantry', 2, mapWidth - 200, mapHeight / 2, 100));
        this.addRegiment(this.createRegiment('infantry', 2, mapWidth - 200, mapHeight / 2 + 80, 100));
        this.addRegiment(this.createRegiment('cavalry', 2, mapWidth - 180, mapHeight / 2 + 150, 50));
        this.addRegiment(this.createRegiment('artillery', 2, mapWidth - 120, mapHeight / 2, 30));
    }

    createRegiment(type, player, x, y, troopCount) {
        return {
            type: type,
            player: player,
            position: { x, y },
            troopCount: troopCount,
            maxTroopCount: troopCount,
            strength: 100,
            morale: 100,
            ammo: 100,
            food: 100,
            isDugIn: false,
            isRetreating: false,
            isScattered: false,
            targetPosition: null,
            holdLine: null,
            formation: 'line',
            facing: player === 1 ? 0 : Math.PI, // Face opponent
            velocity: { x: 0, y: 0 }
        };
    }

    clearAll() {
        this.currentMap = null;
        this.brushData = { elevation: [], water: [], foliage: [] };
        this.regiments = [];
        this.supplies = {
            depots: [],
            camps: [],
            supplyLines: [],
            totalAllowedLength: 0
        };
    }

    getRegimentAt(x, y, radius = 30) {
        for (const regiment of this.regiments) {
            const dist = Math.hypot(regiment.position.x - x, regiment.position.y - y);
            if (dist < radius) {
                return regiment;
            }
        }
        return null;
    }

    getSupplyStructureAt(x, y, radius = 20) {
        for (const depot of this.supplies.depots) {
            const dist = Math.hypot(depot.position.x - x, depot.position.y - y);
            if (dist < radius) {
                return depot;
            }
        }
        for (const camp of this.supplies.camps) {
            const dist = Math.hypot(camp.position.x - x, camp.position.y - y);
            if (dist < radius) {
                return camp;
            }
        }
        return null;
    }
}

export class GameLoop {
    constructor(state, battleController) {
        this.state = state;
        this.battleController = battleController;
        this.lastTime = 0;
        this.animationId = null;
        this.isRunning = false;
    }

    start() {
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    loop() {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;

        if (!this.state.isPaused) {
            const scaledDelta = deltaTime * this.state.gameSpeed;
            this.update(scaledDelta);
        }

        this.battleController.render();
        this.animationId = requestAnimationFrame(() => this.loop());
    }

    update(deltaTime) {
        this.state.gameTime += deltaTime;

        // Update supplies
        this.updateSupplies(deltaTime);

        // Update unit movement
        this.updateUnitMovement(deltaTime);

        // Check combat ranges
        this.checkCombatRanges();

        // Resolve combat
        this.resolveCombat(deltaTime);

        // Update morale
        this.updateMorale(deltaTime);

        // Check retreat/scatter
        this.checkRetreatScatter();

        // Update AI
        this.updateAI(deltaTime);
    }

    updateSupplies(deltaTime) {
        for (const regiment of this.state.regiments) {
            // Deplete food over time
            regiment.food = Math.max(0, regiment.food - deltaTime * 0.5);

            // Check if near camp for resupply
            const nearCamp = this.isNearFriendlyCamp(regiment);
            if (nearCamp) {
                regiment.food = Math.min(100, regiment.food + deltaTime * 5);
                regiment.ammo = Math.min(100, regiment.ammo + deltaTime * 3);
            }

            // Apply out-of-food penalties
            if (regiment.food <= 0) {
                regiment.strength = Math.max(10, regiment.strength - deltaTime * 2);
                regiment.morale = Math.max(0, regiment.morale - deltaTime * 3);
            }
        }
    }

    isNearFriendlyCamp(regiment) {
        for (const camp of this.state.supplies.camps) {
            if (camp.player === regiment.player) {
                const dist = Math.hypot(
                    camp.position.x - regiment.position.x,
                    camp.position.y - regiment.position.y
                );
                if (dist < 50) return true;
            }
        }
        return false;
    }

    updateUnitMovement(deltaTime) {
        for (const regiment of this.state.regiments) {
            if (regiment.isScattered || !regiment.targetPosition) continue;
            if (regiment.isDugIn) continue;

            const dx = regiment.targetPosition.x - regiment.position.x;
            const dy = regiment.targetPosition.y - regiment.position.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 5) {
                regiment.targetPosition = null;
                regiment.velocity = { x: 0, y: 0 };
                continue;
            }

            // Calculate speed based on unit type and terrain
            let speed = this.getUnitSpeed(regiment);

            // Apply terrain modifiers
            if (this.state.currentMap) {
                const terrainMod = this.getTerrainModifier(regiment.position);
                speed *= terrainMod;
            }

            const vx = (dx / dist) * speed;
            const vy = (dy / dist) * speed;

            regiment.position.x += vx * deltaTime;
            regiment.position.y += vy * deltaTime;
            regiment.velocity = { x: vx, y: vy };

            // Update facing direction
            regiment.facing = Math.atan2(dy, dx);
        }
    }

    getUnitSpeed(regiment) {
        const baseSpeed = {
            infantry: 60,
            cavalry: 120,
            artillery: 30
        };
        return baseSpeed[regiment.type] || 60;
    }

    getTerrainModifier(position) {
        if (!this.state.currentMap) return 1;

        // Check elevation gradient at position
        const elevation = this.getElevationAt(position.x, position.y);
        const nearbyElevation = this.getElevationAt(position.x + 5, position.y);
        const gradient = Math.abs(nearbyElevation - elevation);

        // Steeper terrain = slower movement
        return Math.max(0.3, 1 - gradient * 0.1);
    }

    getElevationAt(x, y) {
        if (!this.state.currentMap || !this.state.currentMap.elevationData) return 0;

        const data = this.state.currentMap.elevationData;
        const width = this.state.currentMap.dimensions.width;
        const ix = Math.floor(x);
        const iy = Math.floor(y);

        if (ix < 0 || ix >= width || iy < 0 || iy >= data.length / width) return 0;

        return data[iy * width + ix] || 0;
    }

    checkCombatRanges() {
        for (const regiment of this.state.regiments) {
            regiment.inCombatWith = [];

            for (const other of this.state.regiments) {
                if (regiment.player === other.player) continue;
                if (regiment.isScattered || other.isScattered) continue;

                const dist = Math.hypot(
                    other.position.x - regiment.position.x,
                    other.position.y - regiment.position.y
                );

                const range = this.getUnitRange(regiment);
                if (dist <= range) {
                    regiment.inCombatWith.push(other);
                }
            }
        }
    }

    getUnitRange(regiment) {
        const baseRange = {
            infantry: 100,
            cavalry: 100,
            artillery: 250
        };

        let range = baseRange[regiment.type] || 100;

        // Reduce range if out of ammo
        if (regiment.ammo <= 0) {
            if (regiment.type === 'cavalry') {
                range = 20; // Melee range
            } else {
                range = 10; // Nearly zero
            }
        }

        return range;
    }

    resolveCombat(deltaTime) {
        for (const regiment of this.state.regiments) {
            if (!regiment.inCombatWith || regiment.inCombatWith.length === 0) continue;
            if (regiment.isScattered) continue;

            for (const enemy of regiment.inCombatWith) {
                const dist = Math.hypot(
                    enemy.position.x - regiment.position.x,
                    enemy.position.y - regiment.position.y
                );

                // Calculate attacking power
                let attackPower = regiment.troopCount * (regiment.strength / 100);

                // Apply unit type modifier
                if (regiment.type === 'artillery') {
                    attackPower *= 3;
                }

                // Apply ammo modifier
                if (regiment.ammo <= 0) {
                    if (regiment.type === 'infantry') {
                        attackPower *= 0.25;
                    } else if (regiment.type === 'artillery') {
                        attackPower *= 0.0625;
                    }
                    // Cavalry: no reduction
                }

                // Apply dug-in bonus
                if (regiment.isDugIn && dist > 20) {
                    attackPower *= 1.5;
                }

                // Proximity factor: closer = more damage
                const range = this.getUnitRange(regiment);
                const proximityFactor = 1 - (dist / range) * 0.5;

                // Time-integrated damage
                const damage = attackPower * proximityFactor * deltaTime * 0.1;

                // Apply damage to enemy
                this.applyDamage(enemy, damage);

                // Consume ammo
                if (regiment.ammo > 0) {
                    regiment.ammo = Math.max(0, regiment.ammo - deltaTime * 2);
                }
            }
        }
    }

    applyDamage(regiment, damage) {
        // Reduce troop count
        const casualtyChance = damage / regiment.troopCount;
        if (Math.random() < casualtyChance) {
            regiment.troopCount = Math.max(1, regiment.troopCount - 1);
        }

        // Reduce morale based on damage
        regiment.morale = Math.max(0, regiment.morale - damage * 0.5);

        // Reduce strength slightly
        regiment.strength = Math.max(10, regiment.strength - damage * 0.1);
    }

    updateMorale(deltaTime) {
        for (const regiment of this.state.regiments) {
            // Morale recovery when not in combat
            if (!regiment.inCombatWith || regiment.inCombatWith.length === 0) {
                if (!regiment.isScattered) {
                    regiment.morale = Math.min(100, regiment.morale + deltaTime * 2);
                } else {
                    // Scattered units slowly recover
                    regiment.morale = Math.min(30, regiment.morale + deltaTime * 1);
                }
            }

            // Check flanking (enemies on multiple sides)
            const flanked = this.isUnitFlanked(regiment);
            if (flanked) {
                regiment.morale = Math.max(0, regiment.morale - deltaTime * 5);
            }

            // Check nearby friendly retreats
            for (const other of this.state.regiments) {
                if (other.player === regiment.player && other !== regiment) {
                    const dist = Math.hypot(
                        other.position.x - regiment.position.x,
                        other.position.y - regiment.position.y
                    );
                    if (dist < 100 && (other.isRetreating || other.isScattered)) {
                        regiment.morale = Math.max(0, regiment.morale - deltaTime * 2);
                    }
                }
            }
        }
    }

    isUnitFlanked(regiment) {
        if (!regiment.inCombatWith || regiment.inCombatWith.length < 2) return false;

        // Check if enemies are on opposite sides
        const angles = regiment.inCombatWith.map(enemy => {
            return Math.atan2(
                enemy.position.y - regiment.position.y,
                enemy.position.x - regiment.position.x
            );
        });

        for (let i = 0; i < angles.length; i++) {
            for (let j = i + 1; j < angles.length; j++) {
                const diff = Math.abs(angles[i] - angles[j]);
                if (diff > Math.PI * 0.75) return true;
            }
        }

        return false;
    }

    checkRetreatScatter() {
        for (const regiment of this.state.regiments) {
            if (regiment.morale < 10 && !regiment.isScattered) {
                // Scatter
                regiment.isScattered = true;
                regiment.isRetreating = false;
                regiment.targetPosition = null;
            } else if (regiment.morale < 30 && !regiment.isScattered && !regiment.isRetreating) {
                // Auto-retreat
                regiment.isRetreating = true;
                const retreatDir = this.getRetreatDirection(regiment);
                regiment.targetPosition = {
                    x: regiment.position.x + retreatDir.x * 200,
                    y: regiment.position.y + retreatDir.y * 200
                };
            } else if (regiment.morale >= 30 && regiment.isRetreating) {
                // Stop retreating
                regiment.isRetreating = false;
            } else if (regiment.morale >= 30 && regiment.isScattered) {
                // Reassemble
                regiment.isScattered = false;
            }

            // Scattered movement (random)
            if (regiment.isScattered) {
                if (!regiment.targetPosition || Math.random() < 0.02) {
                    const retreatDir = this.getRetreatDirection(regiment);
                    regiment.targetPosition = {
                        x: regiment.position.x + retreatDir.x * 50 + (Math.random() - 0.5) * 50,
                        y: regiment.position.y + retreatDir.y * 50 + (Math.random() - 0.5) * 50
                    };
                }
            }
        }
    }

    getRetreatDirection(regiment) {
        // Retreat away from nearest enemy
        let nearestEnemy = null;
        let minDist = Infinity;

        for (const other of this.state.regiments) {
            if (other.player !== regiment.player) {
                const dist = Math.hypot(
                    other.position.x - regiment.position.x,
                    other.position.y - regiment.position.y
                );
                if (dist < minDist) {
                    minDist = dist;
                    nearestEnemy = other;
                }
            }
        }

        if (nearestEnemy) {
            const dx = regiment.position.x - nearestEnemy.position.x;
            const dy = regiment.position.y - nearestEnemy.position.y;
            const dist = Math.hypot(dx, dy);
            return { x: dx / dist, y: dy / dist };
        }

        return { x: 0, y: -1 }; // Default: retreat up
    }

    updateAI(deltaTime) {
        // AI controls player 2
        this.battleController.aiController.update(deltaTime);
    }
}
