# AGENT ENTRYPOINT — Project Implementation Map

> **AUDIENCE:** Coding agents (not end users).
> **PURPOSE:** Fast, reliable project understanding before implementing any task.

---

## 1. Start Here

**Read this file before making any changes to the codebase.**

This document is the project routing map. Use it to determine which files own which behaviors, where data lives, how systems connect, and what rules govern the architecture.

**After every implementation task, update this file** if you added, removed, renamed, or changed the responsibility of any important file, class, system, data definition, or flow.

---

## 2. Project Overview

**Project:** `gems` — Match-3 Puzzle Roguelike
**Stack:** Vanilla JavaScript (ES modules), HTML5 Canvas, Howler.js for audio
**Build:** No bundler; modules loaded natively via `<script type="module">`
**Entry:** [`src/index.html`](src/index.html) → [`src/js/main.js`](src/js/main.js)

### Directory Layout

```
src/
  index.html              — HTML shell, custom font, module entry
  js/
    main.js               — boot: create services, register scenes, start loop
    engine/               — framework services (canvas, loop, input, assets)
    scenes/               — scene lifecycle + SceneManager
    game/                 — pure game logic (board, match resolution, battle, AI)
    map/                  — roguelike map generation and traversal
    ui/                   — custom UI framework + battle scene + visual effects
    audio/                — Howler-based audio manager + sound config
    data/                 — character, enemy, and selection definitions
    lib/                  — third-party libraries (Howler.js)
  assets/
    sprites/              — all image assets organized by context
    audio/                — SFX, music, ambient audio files
    fonts/                — MarcellusSC-Regular.ttf
```

### Scene Flow

```
TitleScreen  →  CharacterSelectScene  →  MapScene  ⇄  BattleScene
                                          (roam)       (combat)
```

---

## 3. Project Rules

**Violate these only when explicitly instructed.**

1. **Do not rebuild systems unless asked.** Prefer small, focused changes.
2. **Keep UI data-driven.** CharacterPane reads from data objects; never hardcode values.
3. **Keep rendering separate from game logic.** BoardModel/MatchResolver never touch canvas. Visuals live in BattleScene/BoardPlaceholder/MapRenderer.
4. **Skills use `effects: []` array only.** Each effect has an `effectType` string. See [`SKILL_EFFECT_TYPES`](src/js/game/MatchResolver.js:23).
5. **Skill sound is attached to the skill definition** (`skill.sound`), not individual effects.
6. **Tile destruction rewards use centralized logic** — [`resolveDestroyedTileRewards()`](src/js/game/MatchResolver.js:199) in MatchResolver.
7. **Extra turns are non-cumulative retain-turn flags.** Set `_extraTurnEarned`; don't stack.
8. **Map generation is separate from map rendering.** MapGenerator creates the graph; MapRenderer/MapView draw it.
9. **Old/reference directories are read-only** unless explicitly instructed. See §8.
10. **Enemy data uses the same structure as character data** (hp, mana, skills, portrait).
11. **All asset keys are registered in [`main.js` ASSET_MAP](src/js/main.js:35).** Adding a new sprite requires adding it there.
12. **New characters require:** (a) definition in [`mockCharacter.js`](src/js/data/mockCharacter.js), (b) entry in [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js), (c) asset registration in [`main.js` ASSET_MAP](src/js/main.js:35).

---

## 4. System Map

### 4.1 Engine Services (owned by SceneManager, created once in main.js)

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/engine/CanvasApp.js`](src/js/engine/CanvasApp.js) | `CanvasApp` | DPR-aware canvas, resize, clear, context access |
| [`src/js/engine/GameLoop.js`](src/js/engine/GameLoop.js) | `GameLoop` | requestAnimationFrame loop with delta time |
| [`src/js/engine/InputManager.js`](src/js/engine/InputManager.js) | `InputManager` | Mouse/touch/keyboard events, hit-testing, listener registry |
| [`src/js/engine/AssetManager.js`](src/js/engine/AssetManager.js) | `AssetManager` | Image loading/caching, pre-scaled offscreen canvases |

### 4.2 Scene System

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/scenes/SceneManager.js`](src/js/scenes/SceneManager.js) | `SceneManager` | Scene registry, switchTo/fadeToScene, game loop tick, layout |
| [`src/js/scenes/TitleScreen.js`](src/js/scenes/TitleScreen.js) | `TitleScreen` | Cover-fit title image, fade-in, any-input → CharacterSelectScene |
| [`src/js/scenes/CharacterSelectScene.js`](src/js/scenes/CharacterSelectScene.js) | `CharacterSelectScene` | Character selection, splash cross-fade, info panel, aura effect, → MapScene |
| [`src/js/scenes/MapScene.js`](src/js/scenes/MapScene.js) | `MapScene` | Map traversal, node clicking, battle transition, battle result handling |
| [`src/js/ui/BattleScene.js`](src/js/ui/BattleScene.js) | `BattleScene` | Full battle layout (3-column), input handling, visual effects, game-over transition |

**Scene lifecycle:** Each scene must implement `onEnter()` and `onExit()`. Scenes receive `_sceneManager` back-reference from SceneManager.

### 4.3 Battle / Game Logic

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/game/BattleController.js`](src/js/game/BattleController.js) | `BattleController` | **Top-level orchestrator.** Turn state machine (TURN_INTRO → PLAYER_TURN ↔ ENEMY_TURN → RESOLVING → GAME_OVER), swap initiation, skill resolution, cascade phases, enemy turn delegation |
| [`src/js/game/BoardModel.js`](src/js/game/BoardModel.js) | `BoardModel` | **Pure data.** 8×8 grid, swap, gravity, refill, match detection (simple runs + Union-Find connected shapes), clone, valid-move enumeration, tile conversion |
| [`src/js/game/MatchResolver.js`](src/js/game/MatchResolver.js) | `MatchResolver` | **Pure logic.** Match analysis (returns MatchAnalysis, does NOT modify board), damage application (armor→block→HP), skill effect type constants, skull damage formulas (matched vs destroyed), shared tile reward computation |
| [`src/js/game/TileTypes.js`](src/js/game/TileTypes.js) | (module) | Tile type definitions (RED/BLUE/GREEN/YELLOW/PURPLE/SKULL), spawn weights, constants (BOARD_COLS=8, BOARD_ROWS=8), helpers (isSkull, getRandomTileType) |
| [`src/js/game/CombatLog.js`](src/js/game/CombatLog.js) | `CombatLog` | Ring buffer for combat messages, turn counter |
| [`src/js/game/EnemyAI.js`](src/js/game/EnemyAI.js) | `EnemyAI` | Enemy decision: skill-first (damage preferred), then board evaluation with priority scoring (4+ match > skull damage > skill mana > contest player mana) |

**Battle State Machine:**
```
TURN_INTRO → PLAYER_TURN → SWAPPING → RESOLVING → (check extra turn) → TURN_INTRO → ENEMY_TURN → RESOLVING → (check extra turn) → TURN_INTRO → PLAYER_TURN ...
                                                                              ↓
TURN_INTRO → PLAYER_TURN → TARGETING → RESOLVING → ...               GAME_OVER
```

**Cascade Sub-phases:** SHOW_MATCH → REMOVE → FALL → (re-analyze → SHOW_MATCH or finish)

### 4.4 Map System

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/map/MapGenerator.js`](src/js/map/MapGenerator.js) | `MapGenerator` + `SeededRNG` | Deterministic map generation: 10 depths, smoothed node placement (±1 count delta between depths), type assignment (battle/elite/chest/training/rest/boss), local-lane edge wiring (|Δlane| ≤ 1), connectivity & edge-constraint validation |
| [`src/js/map/MapGraph.js`](src/js/map/MapGraph.js) | `MapGraph` | Graph container: node lookup, depth grouping, serialization |
| [`src/js/map/MapNode.js`](src/js/map/MapNode.js) | `MapNode` | Single node: id, type, depth, lane, incoming/outgoing edges, state flags (discovered/reachable/current/completed) |
| [`src/js/map/MapTraversalController.js`](src/js/map/MapTraversalController.js) | `MapTraversalController` | Player position, moveTo validation, completeAndRevealNext, history, reachability queries, serialize/deserialize |
| [`src/js/map/MapRenderer.js`](src/js/map/MapRenderer.js) | `MapRenderer` | Node layout, SVG-like icon drawing, path/edge rendering, hover state, hit-testing |
| [`src/js/map/MapView.js`](src/js/map/MapView.js) | `MapView` | **Shared rendering component.** Used by MapScene (fullscreen) AND BattleScene (overlay with 'm' key). Container layout, backdrop, splash, depth labels, node info. Owns the overlay animation state machine (closed→opening→open→closing→closed) with crossfade + slide transitions |

### 4.5 Audio System

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/audio/AudioManager.js`](src/js/audio/AudioManager.js) | `AudioManager` (singleton) | Howler.js wrapper: music playback with fade in/out, SFX one-shots, per-category volume, mute/unmute |
| [`src/js/audio/SoundConfig.js`](src/js/audio/SoundConfig.js) | (module) | Sound key→{src, category, options} registry. Categories: MUSIC, SFX, UI, AMBIENT |

**Audio usage pattern:** Scenes call `AudioManager.playMusic('key')` / `AudioManager.playSfx('key')`. Skill resolve sounds are set by BattleController via `_setSkillSound(skill)` and played by BattleScene when `pendingSkillSound` is present in state.

### 4.6 UI Framework

| File | Class | Role |
|------|-------|------|
| [`src/js/ui/UIElement.js`](src/js/ui/UIElement.js) | `UIElement` | **Base class.** Layout rect, padding, margin, flex sizing (fixed/percent/flexGrow), alignment, visibility, hit-test, debug outline |
| [`src/js/ui/UIContainer.js`](src/js/ui/UIContainer.js) | `UIContainer` | Row/column flexbox container, gap, justifyContent, alignItems |
| [`src/js/ui/UIPanel.js`](src/js/ui/UIPanel.js) | `UIPanel` | Container with optional background image (stretch or cover) |
| [`src/js/ui/UIImage.js`](src/js/ui/UIImage.js) | `UIImage` | Image element with fit modes (contain/cover/stretch), asset key lookup |
| [`src/js/ui/UIText.js`](src/js/ui/UIText.js) | `UIText` | Canvas text with font, color, alignment, shadow |
| [`src/js/ui/UIProgressBar.js`](src/js/ui/UIProgressBar.js) | `UIProgressBar` | Health bar with fill, border, color interpolation |
| [`src/js/ui/UIOrb.js`](src/js/ui/UIOrb.js) | `UIOrb` | Mana orb with icon + count text |
| [`src/js/ui/Rect.js`](src/js/ui/Rect.js) | `Rect` | Simple {x, y, w, h} value object |
| [`src/js/ui/CharacterPane.js`](src/js/ui/CharacterPane.js) | `CharacterPane` | Player/enemy stat panel: portrait, name, class, HP bar, attack/armor, mana orbs, skill rows. Data-driven via `updateFromState()` |
| [`src/js/ui/SkillRow.js`](src/js/ui/SkillRow.js) | `SkillRow` | Single skill entry: icon, name, description, mana cost row, click callback |
| [`src/js/ui/ManaCostRow.js`](src/js/ui/ManaCostRow.js) | `ManaCostRow` | Mana cost icons for skills |
| [`src/js/ui/BoardPlaceholder.js`](src/js/ui/BoardPlaceholder.js) | `BoardPlaceholder` | Board grid rendering: tile sprites, highlights, empty cells, fall animation, swap animation, targeting overlay, particle effects |
| [`src/js/ui/FloatingImageEffect.js`](src/js/ui/FloatingImageEffect.js) | `FloatingImageEffect` | Animated floating image (turn announcement, extra turn) with grow/settle/hold/fade phases |
| [`src/js/ui/FloatingTextEffect.js`](src/js/ui/FloatingTextEffect.js) | `FloatingTextEffect` | Floating "+N" match count text |
| [`src/js/ui/TileParticleEffect.js`](src/js/ui/TileParticleEffect.js) | `TileParticleEffect` | Particle burst for tile destruction and conversion effects |
| [`src/js/ui/ScreenShake.js`](src/js/ui/ScreenShake.js) | `ScreenShake` | Screen shake on damage, triggered by shakeIntensity from BattleController |
| [`src/js/ui/AuraStrandsEffect.js`](src/js/ui/AuraStrandsEffect.js) | `AuraStrandsEffect` | Animated aura strands on character select screen |

### 4.7 Data Definitions

| File | Exports | Content |
|------|---------|---------|
| [`src/js/data/mockCharacter.js`](src/js/data/mockCharacter.js) | `warriorCharacter`, `mageCharacter`, `witchDoctorCharacter`, default: `mockCharacter` | Character definitions: id, name, className, hp, maxHp, attack, armor, mana pools, skills[]. **Single source of truth for character gameplay data.** |
| [`src/js/data/mockEnemy.js`](src/js/data/mockEnemy.js) | `mockEnemy` (default) | Goblin enemy: same structure as character. HP scaled by MapScene for elite/boss. |
| [`src/js/data/characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js) | `characterSelectDefinitions` (default) | UI metadata for CharacterSelectScene: portraitKey, splashKey, auraColor, order, enabled. References characterData from mockCharacter.js. |
| [`src/js/game/TileTypes.js`](src/js/game/TileTypes.js) | `TILE_TYPES`, `MANA_COLORS`, constants, helpers | Tile type definitions with spawn weights, particle colors, board dimensions. |

---

## 5. Task Routing Guide

When given a task, locate the owning system using this table:

| Symptom / Task | Look Here First | Secondary Files |
|----------------|-----------------|-----------------|
| "Skill doesn't work" | [`BattleController._resolveEffect()`](src/js/game/BattleController.js:1110) | [`MatchResolver.js` SKILL_EFFECT_TYPES](src/js/game/MatchResolver.js:23), skill definition in [`mockCharacter.js`](src/js/data/mockCharacter.js) |
| "Tile matching wrong" | [`MatchResolver.analyzeMatches()`](src/js/game/MatchResolver.js:109) | [`BoardModel.findAllConnectedMatches()`](src/js/game/BoardModel.js:239) |
| "Scene transition wrong" | [`SceneManager.switchTo()`](src/js/scenes/SceneManager.js:105) | Scene `onEnter`/`onExit` methods |
| "Map node highlight wrong" | [`MapRenderer`](src/js/map/MapRenderer.js) | [`MapTraversalController`](src/js/map/MapTraversalController.js) state queries |
| "Character select data wrong" | [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js) | [`mockCharacter.js`](src/js/data/mockCharacter.js) |
| "Audio not playing" | [`AudioManager._play()`](src/js/audio/AudioManager.js:300) | [`SoundConfig.js`](src/js/audio/SoundConfig.js), skill `.sound` field |
| "UI overlaps / layout broken" | [`UIElement` sizing model](src/js/ui/UIElement.js) | The specific view/scene's `buildHierarchy()` / `layoutChildren()` |
| "Enemy AI behavior" | [`EnemyAI.findBestSkill()` / `findBestSwap()`](src/js/game/EnemyAI.js) | [`EnemyAI._scoreBoard()`](src/js/game/EnemyAI.js:142) |
| "Map generation wrong" | [`MapGenerator.generate()`](src/js/map/MapGenerator.js:119) | [`SeededRNG`](src/js/map/MapGenerator.js:8), [`_wireConnections`](src/js/map/MapGenerator.js:315) |
| "Tile disappear/reappear bug" | [`BoardModel.removeTiles()`](src/js/game/BoardModel.js:355) / [`applyGravity()`](src/js/game/BoardModel.js:372) | [`BattleController` cascade phases](src/js/game/BattleController.js:28) |
| "Health/damage calculation wrong" | [`MatchResolver.applyDamage()`](src/js/game/MatchResolver.js:163) | [`BattleController._setShakeFromDamage()`](src/js/game/BattleController.js:1193) |
| "Add new character" | [`mockCharacter.js`](src/js/data/mockCharacter.js) | [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js), [`main.js` ASSET_MAP](src/js/main.js:35) |
| "Add new skill effect type" | [`SKILL_EFFECT_TYPES`](src/js/game/MatchResolver.js:23) | [`BattleController._resolveEffect()`](src/js/game/BattleController.js:1110) |
| "Add new tile type" | [`TILE_TYPES`](src/js/game/TileTypes.js:11) | [`BoardModel` spawn weights](src/js/game/BoardModel.js:26), tile sprite in [`main.js` ASSET_MAP](src/js/main.js:35) |
| "Board rendering wrong" | [`BoardPlaceholder`](src/js/ui/BoardPlaceholder.js) | [`BattleScene.updateFromController()`](src/js/ui/BattleScene.js:481) |
| "Combat log issues" | [`CombatLog`](src/js/game/CombatLog.js) | [`BattleScene.updateFromController()`](src/js/ui/BattleScene.js:481) |
| "Performance issues" | [`GameLoop` delta time](src/js/engine/GameLoop.js) | [`CanvasApp` DPR handling](src/js/engine/CanvasApp.js), AssetManager pre-scaling |

---

## 6. Data Flow Diagrams

### Character Select Flow
```
main.js init()
  → TitleScreen (any input)
  → CharacterSelectScene.onEnter()
  → characterSelectDefinitions[] (filtered enabled, sorted by order)
  → _selectIndex() → _updateInfoPanel() (rebuilds from characterData)
  → _chooseHero()
     → deep-clone characterData → MapScene.setPlayerData()
     → MapScene.setSeed('run_' + Date.now())
     → fadeToScene('MapScene')
```

### Map Flow
```
MapScene.onEnter()
  → MapGenerator.generate(seed) → MapGraph
  → MapTraversalController(graph)  — depth-0 nodes reachable
  → MapRenderer + MapView
  → click reachable node → _traversal.moveTo(nodeId)
  → _onNodeEntered(node)
     → if battle/elite/boss: _transitionToBattle(node)
        → deep-clone playerData, scale enemy HP for elite/boss
        → new BattleController(playerData, enemyData)
        → new BattleScene(...) with _onBattleComplete callback
        → fadeToScene('BattleScene')
  → [on return from battle]
     → _handleBattleComplete() sets _needsCompleteAndReveal flag
     → onEnter: completeCurrentAndRevealNext()
     → re-wire input, ready for next node click
```

### Battle Flow
```
BattleScene.onEnter()
  → buildHierarchy(): PlayerPane | Center(board+log) | EnemyPane
  → wire input handlers (mousedown/move/up for drag-swap)
  → wire skill click → BattleController.tryPlayerSkill()

Per-frame: BattleScene.update(dt)
  → BattleController.update(dt)
     → SWAPPING: animate swap → execute swap → beginResolving
     → RESOLVING: SHOW_MATCH → REMOVE → FALL → finishStep → re-analyze
     → ENEMY_TURN: delay → EnemyAI.findBestSkill() or findBestSwap()
     → TURN_INTRO → completeTurnIntro → PLAYER_TURN/ENEMY_TURN
  → BattleScene.updateFromController()
     → reads getState() (clears one-shot flags)
     → updates CharacterPane via updateFromState()
     → updates turn label, combat log
     → spawns visual effects (floating images, particles, screen shake)
     → plays SFX (turn announcement, extra turn, skull damage, skill sound, tile destroy)
     → manages music transitions on state change
  → on GAME_OVER: delay → _returnToMap()
     → _onBattleComplete({result, nodeId})
     → MapScene._handleBattleComplete() sets flag
     → fadeToScene('MapScene')
```

### Skill Resolution Flow
```
Player clicks skill → CharacterPane.onSkillClick → BattleController.tryPlayerSkill(skill)

1. If board_tile targeting: enter TARGETING state
   → hover: setTargetHover → compute targeting area
   → click: tryTargetTile → _executeDestroyTiles → enter RESOLVING

2. If instant: _spendCost → _setSkillSound → for each effect:
   → DAMAGE: applyDamage() → shake + log
   → ARMOR: src.armor += amount
   → HEAL: src.hp = min(maxHp, hp + amount)
   → CREATE_TILES: convert random tiles → check matches → beginResolving
   → EXTRA_TURN: set _extraTurnEarned flag (non-cumulative)
   → DESTROY_TILES: _executeDestroyTiles → resolveDestroyedTileRewards → beginResolving
```

---

## 7. Current Known Architecture Decisions

1. **Skills use `effects: []` array only.** Each effect is `{ effectType, damage?, armor?, heal?, createTiles? }`. No other skill resolution mechanism exists.
2. **Skill sound is on the skill definition** (`.sound` field), not on individual effects. Played once per skill resolution via `_pendingSkillSound`.
3. **Tile destruction rewards use centralized [`resolveDestroyedTileRewards()`](src/js/game/MatchResolver.js:199)** in MatchResolver, called from both match cascades and skill-based destruction.
4. **Extra turns are non-cumulative retain-turn flags.** `_extraTurnEarned` is a boolean. The scene reads `pendingExtraTurn` and `extraTurnTriggerPos` (one-shot cleared via getState).
5. **CharacterPane must be data-driven.** `updateFromState(combatantState)` reads HP, mana, armor, block. No hardcoded character-specific logic.
6. **Map generation is separate from map rendering.** MapGenerator creates immutable MapGraph; MapRenderer/MapView draw it; MapTraversalController manages state mutations.
7. **Local-lane constraint:** Connections between consecutive depths may only move vertically by at most 1 lane (|source.lane − target.lane| ≤ 1). Node counts are smoothed (±1 between depths) to guarantee valid targets exist. Edge validation enforces this at generation time.
8. **MapView is shared** between MapScene (fullscreen) and BattleScene (overlay via 'm' key).
9. **BattleScene is created on demand** (registered lazily by MapScene), not at boot.
10. **MapScene is a singleton** — graph, renderer, and traversal survive scene switches.
11. **Enemy difficulty scaling** happens in MapScene: elite = 1.5× HP, boss = 2.5× HP.
12. **Music transitions are state-driven** in BattleScene: battle_theme on PLAYER/ENEMY_TURN, stopped on GAME_OVER.
13. **All one-shot visual/SFX flags** are read-and-cleared in `BattleController.getState()` to prevent double-firing.
14. **Player data is deep-cloned** at character select and battle entry to avoid mutating definitions.
15. **Canvas uses DPR-aware rendering** — all layout is in CSS pixels; context is pre-scaled.

---

## 8. Reference / Legacy / Old Folders

| Path | Status | Notes |
|------|--------|-------|
| `src/assets/sprites/character_pane/icons/old/` | **Reference only** | Old icon assets; do not use or modify |
| `src/assets/sprites/grid/old/` | **Reference only** | Old grid sprites; do not use or modify |
| `src/assets/sprites/character_pane/skills/old/` | **Reference only** | Old skill icons; do not use or modify |
| `src/assets/sprites/character_pane/mana/(old)/` | **Reference only** | Old mana assets; do not use or modify |
| `src/js/lib/howler.js` | **Third-party** | Howler.js library; do not modify |

**Rule:** Do not build on or reference files in `old/` or `(old)/` directories unless explicitly instructed.

---

## 9. "Before You Edit" Checklist

- [ ] Read `AGENT_ENTRYPOINT.md` (this file).
- [ ] Identify the owning system using the [Task Routing Guide](#5-task-routing-guide).
- [ ] Inspect related data files (character definitions, tile types, sound config, asset map).
- [ ] Understand the data flow for the affected system (see [Data Flow Diagrams](#6-data-flow-diagrams)).
- [ ] Avoid unrelated rewrites — make the smallest change that solves the task.
- [ ] Preserve the dynamic/data-driven architecture (no hardcoded values in UI).
- [ ] Check if new assets need registration in [`main.js` ASSET_MAP](src/js/main.js:35).
- [ ] Check if new sounds need entries in [`SoundConfig.js`](src/js/audio/SoundConfig.js).

---

## 10. "After You Edit" Checklist

- [ ] Test the affected scene in isolation.
- [ ] Confirm no console errors (`F12` in browser).
- [ ] If UI changed: confirm responsive layout still works at different window sizes.
- [ ] If scene flow changed: test the full scene transition chain.
- [ ] If game logic changed: test both player and enemy turns.
- [ ] If data definitions changed: confirm all references to those keys still work.
- [ ] If audio changed: confirm sounds play without errors and don't overlap incorrectly.
- [ ] **Update `AGENT_ENTRYPOINT.md`** with any new files, systems, data definitions, or architecture decisions.

---

## 11. Quick Reference: Key Constants & Enums

| Name | Location | Values |
|------|----------|--------|
| `BattleState` | [`BattleController.js:18`](src/js/game/BattleController.js:18) | PLAYER_TURN, ENEMY_TURN, RESOLVING, SWAPPING, TURN_INTRO, TARGETING, GAME_OVER |
| `SKILL_EFFECT_TYPES` | [`MatchResolver.js:23`](src/js/game/MatchResolver.js:23) | damage, armor, destroy_tiles, destroy_tiles_row, create_tiles, heal, extra_turn |
| `TILE_TYPES` | [`TileTypes.js:11`](src/js/game/TileTypes.js:11) | RED, BLUE, GREEN, YELLOW, PURPLE, SKULL — each with id, isSkull, color, particleColor, spawnWeight |
| `BOARD_COLS / BOARD_ROWS` | [`TileTypes.js:33`](src/js/game/TileTypes.js:33) | 8 / 8 |
| `AudioCategory` | [`SoundConfig.js:15`](src/js/audio/SoundConfig.js:15) | MASTER, MUSIC, SFX, UI, AMBIENT |
| `MANA_COLORS` | [`TileTypes.js:21`](src/js/game/TileTypes.js:21) | ['red', 'blue', 'green', 'yellow', 'purple'] |
| `DEBUG_MODE` | [`main.js:32`](src/js/main.js:32) | `true` — press 'K' in battle for instant win |
| Scene names | [`main.js:150`](src/js/main.js:150) | 'TitleScreen', 'CharacterSelectScene', 'MapScene', 'BattleScene' |

---

## 12. Key Callback / Event Patterns

| Pattern | Where | How |
|---------|-------|-----|
| Scene input wiring | Each scene's `onEnter()` | `input.on('mousedown', handler)` — cleared in `onExit()` |
| Skill click → controller | [`CharacterPane.onSkillClick`](src/js/ui/CharacterPane.js:43) | Set by BattleScene to `battleController.tryPlayerSkill()` |
| Battle complete → map | [`BattleScene._onBattleComplete`](src/js/ui/BattleScene.js:110) | Set by MapScene to `_handleBattleComplete()` |
| State change notification | [`BattleController.onStateChange`](src/js/game/BattleController.js:182) | Callback; currently unused (BattleScene polls via getState) |
| One-shot visual/SFX flags | [`BattleController.getState()`](src/js/game/BattleController.js:207) | Read-and-clear pattern: extraTurnTriggerPos, shakeIntensity, skullDamageDealt, pendingSkillSound, destroyedTiles, convertedTiles, matchTextTriggers |

---

> **AFTER COMPLETING ANY IMPLEMENTATION TASK, UPDATE THIS FILE** if you added, removed, renamed, or changed the responsibility of any important file, class, system, data definition, or flow. This keeps the entry point accurate for the next agent.
