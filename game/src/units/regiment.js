// Civil War RTS - Regiment Unit Class

export class Regiment {
    constructor(type, player, x, y, troopCount) {
        this.id = `regiment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.type = type;
        this.player = player;
        this.position = { x, y };
        this.troopCount = troopCount;
        this.maxTroopCount = troopCount;

        // Combat stats
        this.strength = 100;
        this.morale = 100;
        this.ammo = 100;
        this.food = 100;

        // State
        this.isDugIn = false;
        this.isRetreating = false;
        this.isScattered = false;
        this.targetPosition = null;
        this.holdLine = null;
        this.formation = 'line';
        this.facing = player === 1 ? 0 : Math.PI;
        this.velocity = { x: 0, y: 0 };

        // Combat tracking
        this.inCombatWith = [];
        this.lastDamageTime = 0;

        // Individual balls tracking
        this.balls = [];
        this.initializeBalls();
    }

    initializeBalls() {
        // Create individual balls in grid formation
        this.balls = [];
        const cols = Math.ceil(Math.sqrt(this.troopCount));
        const rows = Math.ceil(this.troopCount / cols);
        const spacing = 4;

        let count = 0;
        for (let r = 0; r < rows && count < this.troopCount; r++) {
            for (let c = 0; c < cols && count < this.troopCount; c++) {
                this.balls.push({
                    id: count,
                    // Store relative position to regiment center
                    relativeX: (c - (cols - 1) / 2) * spacing,
                    relativeY: (r - (rows - 1) / 2) * spacing,
                    isAlive: true,
                    scatterOffset: { x: 0, y: 0 }
                });
                count++;
            }
        }
    }

    getAliveBalls() {
        return this.balls.filter(b => b.isAlive);
    }

    updateTroopCount() {
        this.troopCount = this.getAliveBalls().length;
    }

    // Unit type properties
    static getProperties(type) {
        const props = {
            infantry: {
                speed: 60,
                range: 100,
                firepower: 1,
                ballRadius: 10, // Small - most terrain-capable
                ammoConsumption: 2,
                outOfAmmoModifier: 0.25
            },
            cavalry: {
                speed: 120,
                range: 100,
                firepower: 1,
                ballRadius: 15, // Medium
                ammoConsumption: 2,
                outOfAmmoModifier: 1 // No reduction
            },
            artillery: {
                speed: 30,
                range: 250,
                firepower: 3,
                ballRadius: 20, // Large - least terrain-capable
                ammoConsumption: 3,
                outOfAmmoModifier: 0.0625 // 1/16
            }
        };

        return props[type] || props.infantry;
    }

    getSpeed() {
        return Regiment.getProperties(this.type).speed;
    }

    getRange() {
        let range = Regiment.getProperties(this.type).range;

        if (this.ammo <= 0) {
            if (this.type === 'cavalry') {
                range = 20; // Melee range
            } else {
                range = 10;
            }
        }

        return range;
    }

    getAttackPower() {
        const props = Regiment.getProperties(this.type);
        let power = this.troopCount * (this.strength / 100) * props.firepower;

        if (this.ammo <= 0) {
            power *= props.outOfAmmoModifier;
        }

        if (this.isDugIn) {
            power *= 1.5;
        }

        return power;
    }

    getDefenseModifier() {
        let modifier = 1;

        if (this.isDugIn) {
            modifier *= 0.5; // Take half damage when dug in
        }

        return modifier;
    }

    canTraverseTerrain(isolineSpacing) {
        // Check if unit's ball fits between isolines
        const ballRadius = Regiment.getProperties(this.type).ballRadius;
        return isolineSpacing >= ballRadius * 2;
    }

    takeDamage(damage) {
        const effectiveDamage = damage * this.getDefenseModifier();

        // Troop casualties - kill individual balls
        const aliveBalls = this.getAliveBalls();
        if (aliveBalls.length > 1) {
            const casualtyChance = effectiveDamage / Math.max(1, aliveBalls.length);
            if (Math.random() < casualtyChance) {
                // Kill a random alive ball
                const randomIndex = Math.floor(Math.random() * aliveBalls.length);
                aliveBalls[randomIndex].isAlive = false;
                this.updateTroopCount();
            }
        }

        // Morale damage
        this.morale = Math.max(0, this.morale - effectiveDamage * 0.5);

        // Slight strength reduction
        this.strength = Math.max(10, this.strength - effectiveDamage * 0.1);

        this.lastDamageTime = Date.now();
    }

    consumeSupplies(deltaTime) {
        // Food depletes over time
        this.food = Math.max(0, this.food - deltaTime * 0.5);

        // Out of food penalties
        if (this.food <= 0) {
            this.strength = Math.max(10, this.strength - deltaTime * 2);
            this.morale = Math.max(0, this.morale - deltaTime * 3);
        }
    }

    consumeAmmo(deltaTime) {
        if (this.ammo > 0 && this.inCombatWith.length > 0) {
            const consumption = Regiment.getProperties(this.type).ammoConsumption;
            this.ammo = Math.max(0, this.ammo - deltaTime * consumption);
        }
    }

    resupply(food, ammo) {
        this.food = Math.min(100, this.food + food);
        this.ammo = Math.min(100, this.ammo + ammo);
    }

    updateMorale(deltaTime, isFlanked, nearbyRetreating) {
        // Recovery when not in combat
        if (this.inCombatWith.length === 0 && !this.isScattered) {
            this.morale = Math.min(100, this.morale + deltaTime * 2);
        }

        // Penalties
        if (isFlanked) {
            this.morale = Math.max(0, this.morale - deltaTime * 5);
        }

        if (nearbyRetreating) {
            this.morale = Math.max(0, this.morale - deltaTime * 2);
        }

        // Check thresholds
        if (this.morale < 10 && !this.isScattered) {
            this.scatter();
        } else if (this.morale < 30 && !this.isScattered && !this.isRetreating) {
            this.retreat();
        } else if (this.morale >= 30) {
            if (this.isRetreating) this.isRetreating = false;
            if (this.morale >= 30 && this.isScattered) this.reassemble();
        }
    }

    scatter() {
        this.isScattered = true;
        this.isRetreating = false;
        this.isDugIn = false;
        this.targetPosition = null;
        this.holdLine = null;

        // Scatter individual balls
        for (const ball of this.balls) {
            if (ball.isAlive) {
                ball.scatterOffset = {
                    x: (Math.random() - 0.5) * 100,
                    y: (Math.random() - 0.5) * 100
                };
            }
        }
    }

    retreat() {
        this.isRetreating = true;
        this.isDugIn = false;
        this.holdLine = null;
    }

    reassemble() {
        this.isScattered = false;

        // Reset scatter offsets
        for (const ball of this.balls) {
            ball.scatterOffset = { x: 0, y: 0 };
        }

        // Re-arrange into formation
        this.reformBalls();
    }

    reformBalls() {
        // Re-arrange alive balls into grid formation
        const aliveBalls = this.getAliveBalls();
        const cols = Math.ceil(Math.sqrt(aliveBalls.length));
        const rows = Math.ceil(aliveBalls.length / cols);
        const spacing = 4;

        let count = 0;
        for (let r = 0; r < rows && count < aliveBalls.length; r++) {
            for (let c = 0; c < cols && count < aliveBalls.length; c++) {
                aliveBalls[count].relativeX = (c - (cols - 1) / 2) * spacing;
                aliveBalls[count].relativeY = (r - (rows - 1) / 2) * spacing;
                aliveBalls[count].scatterOffset = { x: 0, y: 0 };
                count++;
            }
        }
    }

    arrangeInLine() {
        // Arrange alive balls in a single line formation
        const aliveBalls = this.getAliveBalls();
        const spacing = 4;

        for (let i = 0; i < aliveBalls.length; i++) {
            aliveBalls[i].relativeX = (i - (aliveBalls.length - 1) / 2) * spacing;
            aliveBalls[i].relativeY = 0;
            aliveBalls[i].scatterOffset = { x: 0, y: 0 };
        }
    }

    digIn() {
        if (!this.isScattered && !this.isRetreating) {
            this.isDugIn = true;
            this.targetPosition = null;
        }
    }

    setTarget(x, y) {
        if (!this.isScattered) {
            this.targetPosition = { x, y };
            this.isDugIn = false;
            this.isRetreating = false;
        }
    }

    setHoldLine(start, end) {
        if (!this.isScattered) {
            this.holdLine = [start, end];
            // Move to center of line
            this.targetPosition = {
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2
            };
        }
    }

    // Arrange balls along a specific line segment
    arrangeAlongLine(lineStart, lineEnd) {
        const aliveBalls = this.getAliveBalls();
        if (aliveBalls.length === 0) return;

        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lineLength = Math.hypot(dx, dy);
        const spacing = Math.min(4, lineLength / aliveBalls.length);

        for (let i = 0; i < aliveBalls.length; i++) {
            const t = aliveBalls.length === 1 ? 0.5 : i / (aliveBalls.length - 1);
            const x = lineStart.x + dx * t;
            const y = lineStart.y + dy * t;

            // Store as relative position from regiment center
            aliveBalls[i].relativeX = x - this.position.x;
            aliveBalls[i].relativeY = y - this.position.y;
            aliveBalls[i].scatterOffset = { x: 0, y: 0 };
        }
    }
}
