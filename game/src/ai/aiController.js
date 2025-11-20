// Civil War RTS - AI Controller

export class AIController {
    constructor(gameState) {
        this.state = gameState;
        this.player = 2; // AI controls player 2
        this.updateInterval = 1; // Update every second
        this.timeSinceUpdate = 0;

        this.strategicGoals = [];
        this.tacticalOrders = new Map();
    }

    update(deltaTime) {
        this.timeSinceUpdate += deltaTime;

        if (this.timeSinceUpdate >= this.updateInterval) {
            this.timeSinceUpdate = 0;
            this.think();
        }
    }

    think() {
        // Get AI units
        const myUnits = this.state.regiments.filter(r => r.player === this.player);
        const enemyUnits = this.state.regiments.filter(r => r.player !== this.player);

        if (myUnits.length === 0 || enemyUnits.length === 0) return;

        // Strategic assessment
        this.assessStrategicSituation(myUnits, enemyUnits);

        // Issue tactical orders
        for (const unit of myUnits) {
            this.issueTacticalOrders(unit, myUnits, enemyUnits);
        }
    }

    assessStrategicSituation(myUnits, enemyUnits) {
        // Calculate force strengths
        const myStrength = this.calculateForceStrength(myUnits);
        const enemyStrength = this.calculateForceStrength(enemyUnits);

        // Calculate center of mass
        const myCenter = this.getCenterOfMass(myUnits);
        const enemyCenter = this.getCenterOfMass(enemyUnits);

        // Determine strategic stance
        if (myStrength > enemyStrength * 1.3) {
            this.strategicGoals = ['attack', 'flank'];
        } else if (myStrength < enemyStrength * 0.7) {
            this.strategicGoals = ['defend', 'regroup'];
        } else {
            this.strategicGoals = ['probe', 'hold'];
        }

        // Check supply situation
        const avgFood = myUnits.reduce((sum, u) => sum + u.food, 0) / myUnits.length;
        const avgAmmo = myUnits.reduce((sum, u) => sum + u.ammo, 0) / myUnits.length;

        if (avgFood < 30 || avgAmmo < 20) {
            this.strategicGoals.unshift('resupply');
        }
    }

    calculateForceStrength(units) {
        return units.reduce((sum, unit) => {
            let strength = unit.troopCount * (unit.strength / 100) * (unit.morale / 100);
            if (unit.type === 'artillery') strength *= 2;
            if (unit.type === 'cavalry') strength *= 1.5;
            return sum + strength;
        }, 0);
    }

    getCenterOfMass(units) {
        if (units.length === 0) return { x: 0, y: 0 };

        const sum = units.reduce((acc, u) => ({
            x: acc.x + u.position.x,
            y: acc.y + u.position.y
        }), { x: 0, y: 0 });

        return {
            x: sum.x / units.length,
            y: sum.y / units.length
        };
    }

    issueTacticalOrders(unit, myUnits, enemyUnits) {
        // Skip scattered units
        if (unit.isScattered) return;

        // Handle retreating units
        if (unit.isRetreating) {
            this.handleRetreat(unit);
            return;
        }

        // Get nearest enemy
        const nearestEnemy = this.getNearestEnemy(unit, enemyUnits);
        if (!nearestEnemy) return;

        const distToEnemy = Math.hypot(
            nearestEnemy.position.x - unit.position.x,
            nearestEnemy.position.y - unit.position.y
        );

        // Unit-specific tactics
        switch (unit.type) {
            case 'artillery':
                this.handleArtillery(unit, nearestEnemy, distToEnemy, myUnits);
                break;
            case 'cavalry':
                this.handleCavalry(unit, nearestEnemy, distToEnemy, enemyUnits);
                break;
            default:
                this.handleInfantry(unit, nearestEnemy, distToEnemy, myUnits, enemyUnits);
                break;
        }
    }

    getNearestEnemy(unit, enemyUnits) {
        let nearest = null;
        let minDist = Infinity;

        for (const enemy of enemyUnits) {
            if (enemy.isScattered) continue;

            const dist = Math.hypot(
                enemy.position.x - unit.position.x,
                enemy.position.y - unit.position.y
            );

            if (dist < minDist) {
                minDist = dist;
                nearest = enemy;
            }
        }

        return nearest;
    }

    handleArtillery(unit, nearestEnemy, distToEnemy, myUnits) {
        const optimalRange = 180; // Keep at good range
        const minRange = 100; // Don't get too close

        // Check if there's infantry in front
        const hasInfantryScreen = myUnits.some(u =>
            u.type === 'infantry' &&
            Math.hypot(u.position.x - unit.position.x, u.position.y - unit.position.y) < 80
        );

        if (distToEnemy < minRange) {
            // Too close, retreat
            const retreatDir = this.getDirectionAway(unit.position, nearestEnemy.position);
            unit.targetPosition = {
                x: unit.position.x + retreatDir.x * 100,
                y: unit.position.y + retreatDir.y * 100
            };
            unit.isDugIn = false;
        } else if (distToEnemy > optimalRange + 50) {
            // Too far, advance
            const advanceDir = this.getDirectionTowards(unit.position, nearestEnemy.position);
            unit.targetPosition = {
                x: unit.position.x + advanceDir.x * 50,
                y: unit.position.y + advanceDir.y * 50
            };
            unit.isDugIn = false;
        } else if (hasInfantryScreen && !unit.isDugIn && !unit.targetPosition) {
            // Good position, dig in
            unit.isDugIn = true;
        }
    }

    handleCavalry(unit, nearestEnemy, distToEnemy, enemyUnits) {
        // Cavalry looks for flanking opportunities
        const flankTarget = this.findFlankTarget(unit, enemyUnits);

        if (flankTarget) {
            // Move to flank
            unit.targetPosition = flankTarget;
            unit.isDugIn = false;
        } else if (unit.ammo < 20) {
            // Out of ammo, charge!
            if (distToEnemy > 30) {
                unit.targetPosition = {
                    x: nearestEnemy.position.x,
                    y: nearestEnemy.position.y
                };
            }
        } else if (distToEnemy < 150 && distToEnemy > 80) {
            // Good skirmish range, hold
            if (!unit.targetPosition) {
                unit.isDugIn = false;
                // Harass
                const perpDir = this.getPerpendicularDirection(unit.position, nearestEnemy.position);
                unit.targetPosition = {
                    x: unit.position.x + perpDir.x * 30,
                    y: unit.position.y + perpDir.y * 30
                };
            }
        }
    }

    handleInfantry(unit, nearestEnemy, distToEnemy, myUnits, enemyUnits) {
        // Check morale
        if (unit.morale < 40) {
            // Low morale, fall back
            const retreatDir = this.getDirectionAway(unit.position, nearestEnemy.position);
            unit.targetPosition = {
                x: unit.position.x + retreatDir.x * 50,
                y: unit.position.y + retreatDir.y * 50
            };
            unit.isDugIn = false;
            return;
        }

        // Strategic behavior
        if (this.strategicGoals.includes('defend')) {
            this.defendBehavior(unit, nearestEnemy, distToEnemy);
        } else if (this.strategicGoals.includes('attack')) {
            this.attackBehavior(unit, nearestEnemy, distToEnemy);
        } else {
            this.probeBehavior(unit, nearestEnemy, distToEnemy);
        }
    }

    defendBehavior(unit, nearestEnemy, distToEnemy) {
        if (distToEnemy > 200) {
            // Enemy far away, find good defensive position
            const highGround = this.findHighGround(unit.position);
            if (highGround) {
                unit.targetPosition = highGround;
            }
            unit.isDugIn = false;
        } else if (distToEnemy > 100) {
            // Enemy approaching, dig in
            if (!unit.isDugIn && !unit.targetPosition) {
                unit.isDugIn = true;
            }
        } else {
            // Enemy close, stay dug in
            unit.isDugIn = true;
        }
    }

    attackBehavior(unit, nearestEnemy, distToEnemy) {
        if (distToEnemy > 150) {
            // Advance towards enemy
            const advanceDir = this.getDirectionTowards(unit.position, nearestEnemy.position);
            unit.targetPosition = {
                x: unit.position.x + advanceDir.x * 60,
                y: unit.position.y + advanceDir.y * 60
            };
            unit.isDugIn = false;
        } else if (distToEnemy > 80) {
            // Engage at range
            unit.targetPosition = null;
            unit.isDugIn = false;
        } else {
            // Push forward
            unit.targetPosition = {
                x: nearestEnemy.position.x,
                y: nearestEnemy.position.y
            };
        }
    }

    probeBehavior(unit, nearestEnemy, distToEnemy) {
        if (distToEnemy > 200) {
            // Move towards enemy cautiously
            const advanceDir = this.getDirectionTowards(unit.position, nearestEnemy.position);
            unit.targetPosition = {
                x: unit.position.x + advanceDir.x * 40,
                y: unit.position.y + advanceDir.y * 40
            };
        } else if (distToEnemy > 100) {
            // Hold and observe
            if (!unit.targetPosition) {
                unit.isDugIn = true;
            }
        } else {
            // In combat range, fight
            unit.isDugIn = true;
        }
    }

    handleRetreat(unit) {
        // Find friendly depot or camp
        const friendlyDepot = this.state.supplies.depots.find(d => d.player === this.player);
        const friendlyCamp = this.state.supplies.camps.find(c => c.player === this.player);

        const target = friendlyCamp || friendlyDepot;

        if (target) {
            unit.targetPosition = {
                x: target.position.x + (Math.random() - 0.5) * 50,
                y: target.position.y + (Math.random() - 0.5) * 50
            };
        }
    }

    findFlankTarget(unit, enemyUnits) {
        // Find an enemy that can be flanked
        for (const enemy of enemyUnits) {
            if (enemy.isScattered) continue;

            // Check if enemy is engaged with another unit
            if (enemy.inCombatWith && enemy.inCombatWith.length > 0) {
                // Find position to flank
                const angle = Math.atan2(
                    enemy.position.y - unit.position.y,
                    enemy.position.x - unit.position.x
                );

                // Go around to the side
                const flankAngle = angle + Math.PI / 2;
                const flankDist = 100;

                return {
                    x: enemy.position.x + Math.cos(flankAngle) * flankDist,
                    y: enemy.position.y + Math.sin(flankAngle) * flankDist
                };
            }
        }

        return null;
    }

    findHighGround(currentPos) {
        if (!this.state.currentMap || !this.state.currentMap.elevationData) {
            return null;
        }

        const map = this.state.currentMap;
        let bestPos = null;
        let bestElevation = 0;

        // Sample nearby positions
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const dist = 100;
            const x = currentPos.x + Math.cos(angle) * dist;
            const y = currentPos.y + Math.sin(angle) * dist;

            if (x < 0 || x >= map.dimensions.width || y < 0 || y >= map.dimensions.height) {
                continue;
            }

            const elevation = map.elevationData[Math.floor(y) * map.dimensions.width + Math.floor(x)];

            if (elevation > bestElevation) {
                bestElevation = elevation;
                bestPos = { x, y };
            }
        }

        return bestPos;
    }

    getDirectionTowards(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);

        if (dist === 0) return { x: 0, y: 0 };

        return { x: dx / dist, y: dy / dist };
    }

    getDirectionAway(from, to) {
        const towards = this.getDirectionTowards(from, to);
        return { x: -towards.x, y: -towards.y };
    }

    getPerpendicularDirection(from, to) {
        const towards = this.getDirectionTowards(from, to);
        // Rotate 90 degrees
        return { x: -towards.y, y: towards.x };
    }
}
