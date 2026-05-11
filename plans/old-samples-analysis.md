# Old Samples — Extracted Game Logic Concepts

> **Reference only.** Do not copy old architecture. Adapt concepts cleanly into the new modular, data-driven system.

---

## 1. Match 3+ Detection

**Source:** [`Board.findAllMatches()`](old_samples/Board.js:175) and [`Board.findAllConnectedMatches()`](old_samples/Board.js:240)

Two-tier detection:

| Method | Algorithm | Behavior |
|---|---|---|
| `findAllMatches()` | Scan horizontal/vertical runs | Each 3+ run = separate match. Simple, used for initial board cleanup. |
| `findAllConnectedMatches()` | Find raw runs, then **Union-Find merge** | Merges overlapping runs of same type sharing exactly 1 tile. Produces L/T/cross shapes. Used during actual gameplay resolution. |

### Would-Create-Match Check
[`Board.wouldCreateMatch(col, row, typeId)`](old_samples/Board.js:150) — Checks horizontal left/right and vertical up/down from a proposed position. Returns `true` if placing the tile would form a line of 3+. Used during board initialization and refill to prevent pre-existing matches.

---

## 2. L/T/Cross Shaped Match Merging

**Source:** [`Board.findAllConnectedMatches()`](old_samples/Board.js:240)

Algorithm:
1. Find all raw horizontal and vertical runs (3+ in a line).
2. Group runs by tile type.
3. For each type, use **Union-Find (Disjoint Set Union)** to merge runs that share exactly 1 tile (the intersection point).
4. For each merged group, collect all **unique** tile positions (deduplication via `Set`).
5. `isShape: true` when `groupRuns.length > 1` (L, T, cross detected).

**Key insight:** The match `count` is the number of unique tiles in the connected shape, NOT the sum of run lengths. This prevents double-counting the intersection tile.

---

## 3. Extra Turn Detection

**Source:** [`MatchResolver.resolve()`](old_samples/MatchResolver.js:42)

- Trigger: **Any match of 4+ tiles** (skull or mana) grants an extra turn.
- Toast is shown immediately when 4+ match is first detected in the sequence (not re-shown for cascades).
- `extraTurnConfirmed` emitted after all cascades complete.
- In [`BattleSystem.playerSwap()`](old_samples/BattleSystem.js:239), if `result.extraTurn` is true, the state resets to `PLAYER_ACTION` instead of switching to enemy turn.

---

## 4. Mana Gain from Matched Colored Tiles

**Source:** [`MatchResolver.resolve()`](old_samples/MatchResolver.js:101)

- Each matched colored tile = 1 mana of that color.
- Mana is accumulated per color across all matches in a cascade using a `mergedMana` dict.
- Uses **unique (deduplicated)** tile counts.
- Awarded via `combatant.gainMana(color, count)`.
- Emits `manaGained` event per color with `{ side, color, amount }`.

---

## 5. Skull Damage from Matched Skull Tiles

**Source:** [`MatchResolver.resolve()`](old_samples/MatchResolver.js:71)

- Damage formula: `Math.min(matchCount, SKULL_DAMAGE_CONFIG.maxDamage) * SKULL_DAMAGE_CONFIG.baseMultiplier`
- Config keys: `maxDamage` (cap), `baseMultiplier` (scalar)
- Skull damage is applied **immediately** when match is detected — before cascading, before gravity animation.
- 4+ skull matches also trigger extra turn.
- Damage flows through [`Combatant.takeDamage()`](old_samples/Combatant.js:158): **Armor → Block → HP**.
- Emits `damageDealt` and `damageTaken` events for visual feedback (screen shake, red flash).

---

## 6. Cascade / Refill Logic

**Source:** [`MatchResolver.resolve()`](old_samples/MatchResolver.js:42) (async loop with `maxCascades = 50` safety limit)

Each cascade iteration:
1. **Find:** `board.findAllConnectedMatches()` → deduplicated, shape-merged matches.
2. **Resolve:** Accumulate mana, calculate skull damage (applied immediately).
3. **Emit:** `matchFound` → particle system spawns explosions.
4. **Remove:** `board.removeTiles(positions)` → matched tiles set to `null`.
5. **Wait:** `explosionDisplayTime = 600ms` — empty cells visible before gravity.
6. **Gravity:** [`board.applyGravity()`](old_samples/Board.js:385) — compact non-null tiles to bottom of each column.
7. **Refill:** [`board.refill()`](old_samples/Board.js:409) — fill null cells with random tiles (using spawn weights + modifiers).
8. **Animate:** [`board.generateFallAnimations(beforeGrid)`](old_samples/Board.js:599) — tracks which tiles fell and how far.
9. **Wait:** `cascadeDelay = 400ms` for fall animation.
10. **Loop:** Back to step 1 until no matches found.

### Gravity Algorithm
[`Board.applyGravity()`](old_samples/Board.js:385):
- Per column: iterate bottom-to-top, compact non-null tiles downward.
- Write pointer starts at bottom; after compacting existing tiles, remaining top cells set to `null`.

### Refill Algorithm
[`Board.refill()`](old_samples/Board.js:409):
- Scan all cells; fill any `null` with `getRandomTileType(getEffectiveWeights())`.
- **Important:** New architecture should run `wouldCreateMatch()` check during refill to prevent pre-existing matches after refill. The old code does NOT do this in `refill()` — it relies on cascades to clean up.

### Fall Animation Data
[`Board.generateFallAnimations(beforeGrid)`](old_samples/Board.js:599):
- Old tiles that fell: `{ col, row: newRow, startRow: oldRow, startCol: col }`
- New tiles from above: `{ col, row, startRow: -1, startCol: col }` (startRow `-1` means "from above the board")

---

## 7. Particle Effect Logic

**Source:** [`Game._setupEventListeners()`](old_samples/Game.js:244)

On `matchFound` event:
- For each match position, spawn explosion particle at `(col, row)` with type-specific color.
- Color mapping (hardcoded in old code — should be data-driven in new system):

| Tile Type | Particle Color |
|---|---|
| `skull` | `#2C3E50` |
| `red` | `#E74C3C` |
| `blue` | `#3498DB` |
| `green` | `#2ECC71` |
| `yellow` | `#F1C40F` |
| `purple` | `#9B59B6` |

---

## 8. Board Initialization (No Pre-Existing Matches)

**Source:** [`Board.initialize()`](old_samples/Board.js:112)

Two-phase approach:
1. Fill cell-by-cell, checking `wouldCreateMatch()` for each placement. Retry up to 50 times per cell. If can't avoid match, place anyway.
2. Post-initialization cleanup: [`_removeAllInitialMatches()`](old_samples/Board.js:502) — loop (max 100 iterations) that finds all matches, removes them, and refills each position with `wouldCreateMatch()` check.

---

## 9. Board Clone for AI Simulation

**Source:** [`Board.clone()`](old_samples/Board.js:434)

Deep-copies the 2D grid, spawn weights, and weight modifiers. Used by `EnemyAI` to simulate swaps without mutating the real board.

---

## 10. AI Scoring System

**Source:** [`EnemyAI._scoreSwap()`](old_samples/EnemyAI.js:148)

Scoring weights (tunable, should be data-driven in new system):

| Factor | Weight |
|---|---|
| Any 4+ match found | +500 |
| Skull damage per point | ×35 |
| Mana tiles (general) | +8 per tile |
| Mana for own skills | +20 per tile |
| Mana contesting player skills | +10 per tile |
| Can afford a skill after match | +250 |
| Extra turn (if not already via 4+) | +200 |
| Skull match bonus | +25 per match |
| Total 5+ tiles matched | +50 |

Also analyzes player's skill costs to determine which colors are "contested" (valuable to deny).

---

## 11. Combatant Damage Model

**Source:** [`Combatant.takeDamage()`](old_samples/Combatant.js:158)

Damage absorption order:
1. **Armor** — depleted first (acts as persistent shield)
2. **Block** — temporary shield, consumed after armor
3. **HP** — reduced by remaining damage

Returns `{ actualDamage, blocked, armorDamage }`.

---

## 12. Spawn Weight System

**Source:** [`Board.getEffectiveWeights()`](old_samples/Board.js:52)

- Each tile type has a base spawn weight.
- `weightModifiers` (applied by passives/abilities) are additive.
- Effective weight = `max(0, baseWeight + modifier)`.
- Used by `getRandomTileType()` for weighted random selection.

---

## 13. Battle State Machine

**Source:** [`BattleSystem`](old_samples/BattleSystem.js)

States: `IDLE` → `PLAYER_ACTION` → `BOARD_RESOLVING` → `ENEMY_ACTION` → (loops or `GAME_OVER`)

Event bus (pub/sub) for decoupled communication:
```
turnStart → swap/match → matchFound → manaGained / damageDealt → 
tilesDestroyed → tilesFalling → boardSettled → extraTurn → turnStart
```

---

## 14. Existing New Architecture Context

Current new codebase structure:

| File | Role |
|---|---|
| [`src/js/main.js`](src/js/main.js) | Entry point, wires CanvasApp + AssetManager + BattleScene |
| [`src/js/engine/CanvasApp.js`](src/js/engine/CanvasApp.js) | Canvas wrapper, resize, clear |
| [`src/js/engine/GameLoop.js`](src/js/engine/GameLoop.js) | requestAnimationFrame loop |
| [`src/js/engine/AssetManager.js`](src/js/engine/AssetManager.js) | Image loading / caching |
| [`src/js/engine/InputManager.js`](src/js/engine/InputManager.js) | Mouse/touch input |
| [`src/js/ui/BattleScene.js`](src/js/ui/BattleScene.js) | Three-column layout (player · board · enemy) |
| [`src/js/ui/CharacterPane.js`](src/js/ui/CharacterPane.js) | Character info panel (HP, stats, mana, skills) |
| [`src/js/ui/BoardPlaceholder.js`](src/js/ui/BoardPlaceholder.js) | Visual-only 8×8 grid, random colors, no logic |
| [`src/js/ui/UIElement.js`](src/js/ui/UIElement.js) | Base UI element with rect + render |
| [`src/js/ui/UIContainer.js`](src/js/ui/UIContainer.js) | Flexbox-like layout container |

The new system is **purely visual** — no gameplay logic exists yet. BoardPlaceholder generates its own random grid; a real Board module would provide the grid data.

---

## Adaptation Guidelines

When implementing gameplay logic:

1. **Board logic** should be a pure data module (no rendering, no DOM, no canvas):
   - Grid storage: `grid[col][row] = typeId`
   - Swap, match detection, gravity, refill, clone, spawn weights
   - Provide grid snapshot for UI rendering

2. **MatchResolver** should be pure logic (no `setTimeout`, no rendering):
   - Accept board + combatants, return results
   - Callers handle animation timing and event emission

3. **EventBus** (or similar pub/sub) for decoupling:
   - Game logic emits events
   - UI elements subscribe to update displays (mana orbs, HP bars, etc.)
   - Particle system subscribes to `matchFound`

4. **Data-driven configs:**
   - Tile types, spawn weights, skull damage config → JSON/config objects
   - AI scoring weights → tunable config
   - Particle colors → tile type data

5. **Separation from rendering:**
   - Board grid data lives in a logic module, not in a UI element
   - BoardPlaceholder becomes a renderer that reads from the game board
   - Fall animations are rendering concerns, not logic concerns

6. **Extension points for future skills/passives/explosions:**
   - Spawn weight modifiers (already designed in old code)
   - Tile manipulation hooks (destroy specific tiles, change types, shuffle)
   - Status effects system (buffs/debuffs on combatants)
   - Explosion/area damage from special tiles
