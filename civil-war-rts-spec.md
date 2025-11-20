# Civil War RTS Game - Technical Specification

## Overview
A real-time strategy game set in the Civil War era featuring topographic warfare, supply logistics, and morale-based combat. Players design custom maps, create scenarios, and command regiments in strategic battles.

## Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Canvas**: HTML5 Canvas for map rendering and unit display
- **Backend**: Firebase Realtime Database
- **Offline AI**: Local JavaScript AI opponent

## Visual Design
- **Art Style**: Minimalistic historical map aesthetic with earthy tones (browns, tans, beiges)
- **View**: Top-down orthographic (bird's eye view)
- **Units**: Bright colors (blue/red/gold) represented as rows/columns of circles
- **UI**: Clean, minimal interface with historical map styling

## Core Game Modes

### 1. Map Editor
Players create custom topographic maps using three brush types:

#### Brush System
- **Elevation Brush (Brown)**: 
  - Dense strokes = high, steep terrain
  - Sudden density changes = cliffs
  - Untouched areas = flat ground
  
- **Waterway Brush (Blue)**:
  - Dense strokes = deep lakes/ponds
  - Thin quick lines = creeks/streams
  - Medium strokes = rivers
  
- **Foliage Brush (Green)**:
  - Dense strokes = thick forests
  - Broad scrawling = mixed grassland with tree copses
  - No strokes = grassland (flat) or bare rock (steep slopes)

#### Map Generation Process
1. User toggles between three brush types
2. User paints on blank canvas (density = intensity)
3. Upon completion, system generates final terrain map with:
   - Isoline contours for elevation
   - Lines/shapes for water features
   - Irregular shapes for forests/copses

#### Random Map Generation
- Procedurally generate maps using Perlin/Simplex noise
- Create realistic terrain with mountains, valleys, rivers, forests

### 2. Scenario Editor
Place military units and supply infrastructure:

#### Unit Types
**Infantry**
- Movement: Medium speed
- Ball radius: Small (most terrain-capable)
- Firepower: Baseline
- Range: Medium

**Cavalry**
- Movement: Fast
- Ball radius: Medium
- Firepower: Same as infantry
- Range: Same as infantry
- Special: No strength reduction when out of ammo

**Artillery**
- Movement: Slow
- Ball radius: Large (least terrain-capable)
- Firepower: High
- Range: Long
- Special: Devastating at range, vulnerable up close

#### Supply Infrastructure
**Depots** (Fixed by scenario)
- External supply arrival points
- Cannot be moved or created during gameplay

**Camps** (Player-created)
- Establish supply distribution points
- Connected to depots via supply lines
- Constraints:
  - Total supply line length = f(starting troop count)
  - Calculate minimum spanning tree from all camps to nearest depot
  - Line length proportional to initial army size (ignore casualties)

**Supply Mechanics**
- Food: Depletes steadily over time
  - Out of food: reduces strength and morale
- Ammo: Consumed during combat
  - Out of ammo effects:
    - Cavalry: No reduction
    - Infantry: 1/4 firing strength, range → nearly zero
    - Artillery: 1/16 infantry firing strength, range → nearly zero
- Units can stockpile supplies (carry reserves)

### 3. Battle Mode
Real-time tactical combat with morale and supply management.

## Terrain & Movement System

### Isoline-Based Movement
- Terrain represented by elevation isolines (contour lines)
- Each unit type has a "ball" radius representing terrain capability
- **Movement Rule**: Unit can only cross isoline B if ball fits between:
  - Lower isoline A and B
  - B and higher isoline C
- Steep terrain (closely spaced isolines) slows movement
- Movement speed inversely proportional to terrain steepness

### Visibility & Line of Sight
- Units see each other if line from 6ft above one position to 6ft above other doesn't intersect:
  - Ground (elevation from isolines)
  - Trees (modeled as 20ft tall solid shapes)
- Terrain and forests block visibility and firing
- No firing over terrain obstacles (even for artillery)

### Map Navigation
- Max map size: 4x visible screen area
- Zoom levels: In/Out
- Minimap: Shows full map when zoomed in
- Navigation: Click minimap or arrow keys to pan

## Combat System

### Unit Representation
- Visual: Rows and columns of colored circles
- Each circle = individual soldier
- Casualties: Remove individual circles from formation
- Colors: Blue (Player 1), Red (Player 2), Gold (Player 3), etc.

### Combat Metrics
Each unit tracks:
- **Troop Count**: Visual representation (number of circles)
- **Strength**: Combat effectiveness (separate from troop count)
- **Morale**: Willingness to fight

**Attacking Power** = Troop Count × Unit Strength × Ammo Modifier

### Combat Resolution (Auto)
- Combat triggers when units in range of each other
- **Time-integrated damage**: Damage ∝ (proximity × duration)
  - Brief contact at max range = light damage
  - Prolonged side-by-side = heavy grinding damage
- Simultaneous damage exchange (both units can damage each other)

### Morale System
**Morale Factors** (decreases morale):
- Taking casualties
- Being flanked (enemy on multiple sides)
- Seeing nearby friendly units retreat/scatter
- Low/no supplies (food especially)
- Prolonged combat without reinforcement
- Facing superior numbers

**Morale Thresholds**:
- **Below 30%**: Unit auto-retreats to safe distance
- **Below 10%**: Unit scatters
  - Cannot receive orders
  - Moves randomly away from enemy
  - If taking heavy fire while retreating → scatter
  - Gradually reassembles over time (morale slowly recovers when safe)

### Defensive Positions
**Dig In Command**:
- Units entrench at current position
- Grants defensive bonus (reduced incoming damage)
- Grants offensive bonus (increased outgoing damage)
- Bonuses lost when enemy closes to hand-to-hand range
- Takes time to dig in (unit immobile during process)

**Hold Line Command**:
- Player draws line on map
- Assigned regiments spread out or stack to fill line
- Units automatically space themselves along line
- Good for defensive positions and controlling terrain

### Strength vs Casualties
- Heavy casualties don't necessarily reduce strength
- Strength represents unit cohesion, training, supply status
- Possible for depleted unit (few circles) to maintain high strength
- Possible for full-strength unit (many circles) to have low strength

## Unit Command Interface

### Selection & Orders
- Click to select regiment(s)
- Right-click or drag to move
- Draw line for "Hold Line" command
- Button for "Dig In" command
- Formation options: Spread out, Stack up, Column, Line

### UI Elements
- Unit info panel: Strength, Morale, Ammo, Food
- Minimap (when zoomed in)
- Supply line visualization toggle
- Terrain elevation visualization toggle

## Multiplayer (Firebase)

### Real-Time Features
- Synchronized unit positions and actions
- Turn-based player entry, real-time execution
- Lobby system for matchmaking
- Observer mode for completed games

### Game State Sync
```javascript
{
  gameId: string,
  players: {
    playerId: {
      regiments: [...],
      supplies: {...},
      camps: [...],
    }
  },
  map: {...},
  timestamp: number
}
```

## AI Opponent (Offline Mode)

### AI Sophistication Requirements
**Strategic Layer**:
- Recognize key terrain (high ground, chokepoints, forests)
- Establish supply camps near frontline
- Maintain supply lines to depots
- Adapt strategy based on player actions

**Tactical Layer**:
- Combined arms: Use infantry, cavalry, artillery together
- Flanking maneuvers: Attack from multiple angles
- Artillery positioning: Keep artillery behind frontline
- Retreat decisions: Pull back weak units before scatter
- Exploitation: Press advantage when player morale drops

**Defensive Tactics**:
- Dig in on high ground
- Use forests for concealment
- Create defensive lines at chokepoints
- Reserve units for counterattack

## Data Structures

### Map Data
```javascript
{
  isolines: [
    { elevation: number, points: [{x, y}, ...] }
  ],
  waterways: [
    { type: 'creek|river|lake', points: [...] }
  ],
  foliage: [
    { density: number, shape: [...] }
  ],
  dimensions: { width, height }
}
```

### Regiment Data
```javascript
{
  id: string,
  type: 'infantry|cavalry|artillery',
  position: {x, y},
  troopCount: number,
  strength: number, // 0-100
  morale: number, // 0-100
  ammo: number, // 0-100
  food: number, // 0-100
  isDugIn: boolean,
  isRetreating: boolean,
  isScattered: boolean,
  targetPosition: {x, y} | null,
  holdLine: [{x, y}, ...] | null
}
```

### Supply Structure Data
```javascript
{
  depots: [
    { id, position: {x, y}, foodRate: number, ammoRate: number }
  ],
  camps: [
    { id, position: {x, y}, connectedToDepot: string }
  ],
  supplyLines: [
    { from: id, to: id, length: number }
  ],
  totalAllowedLength: number // f(starting troops)
}
```

## Implementation Phases

### Phase 1: Core Map System
- Canvas setup and rendering
- Brush painting interface (3 brushes, toggle)
- Density-to-terrain conversion
- Isoline generation from elevation data
- Waterway and foliage shape generation

### Phase 2: Scenario Editor
- Unit placement interface
- Supply depot/camp placement
- Supply line validation
- Save/load scenarios

### Phase 3: Movement & Terrain
- Isoline ball-fitting pathfinding
- Movement speed calculation (terrain steepness)
- Line-of-sight calculation (6ft elevation, 20ft trees)
- Unit selection and movement commands

### Phase 4: Combat System
- Range detection and auto-engagement
- Time-integrated damage calculation
- Morale system and auto-retreat
- Scatter mechanics and reassembly
- Dig in and hold line commands

### Phase 5: Supply & Logistics
- Food/ammo depletion over time
- Camp establishment and supply line rules
- Out-of-supply penalties
- Supply line visualization

### Phase 6: AI Opponent
- Pathfinding and terrain evaluation
- Strategic decision making
- Tactical unit control
- Combined arms coordination

### Phase 7: Multiplayer
- Firebase integration
- Game state synchronization
- Lobby and matchmaking
- Observer mode

### Phase 8: Polish & UI
- Historical map styling
- Sound effects (optional)
- Tutorial/help system
- Game settings and preferences

## Technical Considerations

### Performance
- Efficient isoline rendering (use cached paths)
- Spatial partitioning for collision/visibility (quadtree)
- Limit simultaneous combat calculations per frame
- Optimize LOS calculations (raycasting with early termination)

### Canvas Rendering Layers
1. Terrain base (elevation colors)
2. Isolines
3. Water features
4. Foliage
5. Supply lines (toggleable)
6. Units (circles)
7. UI overlays

### Game Loop
```javascript
function gameLoop(deltaTime) {
  updateSupplies(deltaTime);
  updateUnitMovement(deltaTime);
  checkCombatRanges();
  resolveCombat(deltaTime);
  updateMorale();
  checkRetreatScatter();
  updateAI(deltaTime);
  render();
}
```

## File Structure
```
/game
  /src
    /map
      - brushEngine.js
      - terrainGenerator.js
      - isolineRenderer.js
    /units
      - regiment.js
      - movement.js
      - combat.js
      - morale.js
    /supply
      - logistics.js
      - supplyLine.js
    /ai
      - aiController.js
      - tactics.js
    /multiplayer
      - firebase.js
      - syncEngine.js
    /ui
      - canvas.js
      - controls.js
      - hud.js
    - main.js
    - gameLoop.js
  /assets
    /sounds (optional)
  index.html
  styles.css
```

## Victory Conditions
- Eliminate all enemy regiments
- Force complete army retreat (all units scattered/routed)
- Control all depots for X minutes
- Custom scenario objectives

## Future Enhancements
- Fog of war
- Weather effects (rain slows movement, affects morale)
- Unit veterancy (experience improves strength)
- Reinforcement mechanics
- Historical scenarios (Gettysburg, Antietam, etc.)
- Replay system
