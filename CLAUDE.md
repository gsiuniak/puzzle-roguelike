# SPECIAL NOTE

- This is in WSL. Assume linux commands, the base of the project at ~/test/game/gems. never use powershell commands, or include wsl.localhost in grep/ls etc commands

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
    ui/                   — custom UI framework + battle scene + visual effects + overlays
    audio/                — Howler-based audio manager + sound config
    data/                 — gameplay data definitions
      characters/         — playable character defs (per file + index)
      enemies/            — enemy defs (per file + index)
      skills/             — skill catalog (id-keyed)
      relics/             — relic catalog (id-keyed, passive abilities)
    systems/              — cross-cutting battle systems (passives, effect resolver)
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
                                                           ↓
                                                     RewardOverlay
                                                    (post-battle)
                                                           ↓
                                                        MapScene
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
12. **New characters require:** (a) per-character file in [`src/js/data/characters/`](src/js/data/characters/) with `baseStats` structure, registered in [`characters/index.js`](src/js/data/characters/index.js), (b) entry in [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js), (c) asset registration in [`main.js` ASSET_MAP](src/js/main.js:35).
13. **Character definitions are immutable.** Never mutate `baseStats` during gameplay. Run modifiers go in `runState.statModifiers` via [`playerStats.applyRunModifier()`](src/js/data/playerStats.js).
14. **All stat math goes through [`playerStats.js`](src/js/data/playerStats.js).** Use `getEffectivePlayerStats()` to resolve stats, `createPlayerBattleState()` for battle init, `syncBattleResultsToRunState()` for persistence. Never scatter `base + modifier` math outside this module.
15. **Rewards modify runState.statModifiers, never baseStats.** Use `applyRunModifier(runState, 'startingMana.purple', 2)` pattern.
16. **Skills and relics are referenced by ID, not embedded.** Character/enemy definitions list `skills: ['bash']` / `relics: ['family_crest']`. Full data lives in [`skillCatalog.js`](src/js/data/skills/skillCatalog.js) and [`relicCatalog.js`](src/js/data/relics/relicCatalog.js). IDs are resolved into objects at battle-state creation (`createPlayerBattleState` for players, `MapScene._transitionToBattle` for enemies).
17. **Passive abilities are data-driven via PassiveSystem.** Never write `if (relic.id === 'X')` checks in battle logic. BattleController dispatches trigger events (see [`TriggerTypes.js`](src/js/systems/TriggerTypes.js)); [`PassiveSystem`](src/js/systems/PassiveSystem.js) routes them to matching relic effects through [`EffectResolver`](src/js/systems/EffectResolver.js).
18. **Atomic effects (damage, armor, heal, gain_mana, extra_turn, reduce_damage) live in [`EffectResolver`](src/js/systems/EffectResolver.js)** and are shared between skill resolution and passive resolution. Board-touching effects (create_tiles, destroy_tiles, destroy_tiles_row, destroy_tiles_radius) stay in BattleController because they drive the cascade phase machine. Passive board effects flow through `PassiveSystem.onBoardEffect` — `BattleController._handlePassiveBoardEffect` matches on `effect.effectType` and mutates the in-flight cascade's `_analysis` (positions/mana/skullDamage) so the existing SHOW_MATCH → REMOVE flow handles destruction + rewards.

19. **All damage funnels through [`BattleController._applyDamage(target, amount)`](src/js/game/BattleController.js).** It dispatches `onIncomingDamage` (mutable `amount` payload) before delegating to `MatchResolver.applyDamage`, so defensive passives like Evil Eye (`reduce_damage` effect) can mitigate damage uniformly across skill DAMAGE, cascade skull damage, destroyed-tile skull damage, and passive damage effects. The resolver injected into PassiveSystem is a thin wrapper whose `applyDamage` routes back through `_applyDamage`, so passive-applied damage receives the same pre-mitigation pass. Never call `this.resolver.applyDamage(...)` directly from BattleController.

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
| [`src/js/ui/BattleScene.js`](src/js/ui/BattleScene.js) | `BattleScene` | Battle layout: MainRow contains a passive vertical `RelicBar` followed by 3 character columns (player \| board+combat-log center \| enemy), centered with negative gap so the side panels overlap the board frame. Input handling, visual effects, game-over → reward overlay transition. Hidden turn label retained for backwards-compat (state/data binding only — visual display disabled). |

**Scene lifecycle:** Each scene must implement `onEnter()` and `onExit()`. Scenes receive `_sceneManager` back-reference from SceneManager.

**Scene render pipeline (per frame):**
```
CanvasApp.clear()              — fills entire physical canvas with one color (or barFillImage)
scene.renderBackground(ctx)?   — OPTIONAL hook. Paints full-canvas backgrounds covering letterbox/pillarbox bars (use CanvasApp.drawFullCanvasImage / fillFullCanvas)
CanvasApp.beginViewportClip()  — clips to 1920×1080 design space
scene.render(ctx)              — normal UI rendering (clipped to design space)
CanvasApp.endViewportClip()
scene.renderForeground(ctx)?   — OPTIONAL hook. Full-canvas overlays on top of UI (e.g. reward splash, map overlay backdrop)
SceneManager transition fade   — full-canvas black overlay (via CanvasApp.fillFullCanvas)
```
Use `renderBackground` for splashes that sit BEHIND the scene's UI but must cover the bars. Use `renderForeground` for splashes/backdrops that sit ON TOP of the scene's UI but must cover the bars. UI inside the design viewport is drawn from `render()` as usual.

### 4.3 Battle / Game Logic

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/game/BattleController.js`](src/js/game/BattleController.js) | `BattleController` | **Top-level orchestrator.** Turn state machine (TURN_INTRO → PLAYER_TURN ↔ ENEMY_TURN → RESOLVING → GAME_OVER), swap initiation, skill resolution, cascade phases, enemy turn delegation |
| [`src/js/game/BoardModel.js`](src/js/game/BoardModel.js) | `BoardModel` | **Pure data.** 8×8 grid, swap, gravity, refill, match detection (simple runs + Union-Find connected shapes), clone, valid-move enumeration, tile conversion |
| [`src/js/game/MatchResolver.js`](src/js/game/MatchResolver.js) | `MatchResolver` | **Pure logic.** Match analysis (returns MatchAnalysis, does NOT modify board), damage application (armor→block→HP), skill effect type constants, skull damage formulas (matched vs destroyed), shared tile reward computation |
| [`src/js/game/TileTypes.js`](src/js/game/TileTypes.js) | (module) | Tile type definitions (RED/BLUE/GREEN/YELLOW/PURPLE/SKULL), spawn weights, constants (BOARD_COLS=8, BOARD_ROWS=8), helpers (isSkull, getRandomTileType) |
| [`src/js/game/CombatLog.js`](src/js/game/CombatLog.js) | `CombatLog` | Ring buffer for combat messages, turn counter |
| [`src/js/game/EnemyAI.js`](src/js/game/EnemyAI.js) | `EnemyAI` | Enemy decision: skill-first (damage preferred), then board evaluation with priority scoring (4+ match > skull damage > skill mana > contest player mana) |
| [`src/js/game/customEnemyAi.js`](src/js/game/customEnemyAi.js) | (module) | **AI override dispatch.** Exports `chooseEnemyAction(enemyState, context)` and `getEnemyAiHandler(aiBehavior)`. Tries custom AI first; falls back to standard EnemyAI. Used by BattleController._doEnemyTurn(). |
| [`src/js/game/enemyAiOverrides.js`](src/js/game/enemyAiOverrides.js) | (module) | **Custom AI registry.** Plain object keyed by `aiBehavior` string → handler function. Handlers receive `{ enemy, player, board, battleState, standardAI }` and return `{ action, skill?, swap? }` or `null`. Add new enemy behaviors here. |
| [`src/js/systems/TriggerTypes.js`](src/js/systems/TriggerTypes.js) | (module) | **Passive trigger constants.** Canonical list of trigger event names (`onTileMatch`, `onTileMatchType`, `onMatch4Plus`, `onTurnStart`, `onTurnEnd`, `onTakeDamage`, `onDealDamage`) with documented payload conventions. |
| [`src/js/systems/EffectResolver.js`](src/js/systems/EffectResolver.js) | (module) | **Shared atomic-effect resolver.** `applyEffect(effect, ctx)` handles `damage`, `armor`, `heal`, `gain_mana`, `extra_turn` for both skill and passive effects. Returns false on unrecognized effect types so callers can fall back. Board-touching effects stay in BattleController. |
| [`src/js/systems/PassiveSystem.js`](src/js/systems/PassiveSystem.js) | `PassiveSystem` | **Passive ability dispatcher.** `dispatch(triggerName, payload)` looks up the relics on `payload.side`, finds effects whose `trigger` matches, and resolves them via EffectResolver. Board-touching effects that EffectResolver doesn't recognize are forwarded to `ctx.onBoardEffect(effect, triggerName, payload, ctx)` so the host (BattleController) can mutate the cascade state. Owned by BattleController; instantiated once per battle. No per-relic code lives here — adding a new relic is purely data. |

**Battle State Machine:**
```
TURN_INTRO → PLAYER_TURN → SWAPPING → RESOLVING → (check extra turn) → TURN_INTRO → ENEMY_TURN → RESOLVING → (check extra turn) → TURN_INTRO → PLAYER_TURN ...
                                                                              ↓
TURN_INTRO → PLAYER_TURN → TARGETING → RESOLVING → ...               GAME_OVER
                                                                          ↓
                                                                   RewardOverlay
                                                                          ↓
                                                                       MapScene
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
| [`src/js/ui/CharacterPane.js`](src/js/ui/CharacterPane.js) | `CharacterPane` | **Legacy tall pane** (portrait + HP + mana + skills inline). Still exported but **no longer used** by BattleScene — kept for backwards compatibility / future reuse. |
| [`src/js/ui/CharacterInfoPane.js`](src/js/ui/CharacterInfoPane.js) | `CharacterInfoPane` | Compact horizontal info pane used in the new battle layout. Two rows: (portrait \| name/class/HP bar/attack-armor) and a 5-orb mana bar. Background asset: `character_pane_panel`. Data-driven via `updateFromState()`. |
| [`src/js/ui/SkillRow.js`](src/js/ui/SkillRow.js) | `SkillRow` | **Legacy** single skill entry used by `CharacterPane`. Not used by the new SkillsPane. |
| [`src/js/ui/SkillButton.js`](src/js/ui/SkillButton.js) | `SkillButton` | Compact skill button used by `SkillsPane`. Two columns: icon \| (name + cost row). Supports a `locked` placeholder mode that renders the same `skills_button` frame as active slots with a single centered `skills_locked_icon`, and disables hit-testing. |
| [`src/js/ui/SkillsPane.js`](src/js/ui/SkillsPane.js) | `SkillsPane` | 2×3 grid of `SkillButton`s with background `skill_pane_panel`. Fills slots with the character's skills, pads remaining slots with locked placeholders. Exposes `onSkillClick`, `setManaState()`, and `skillButtons` accessor. |
| [`src/js/ui/RelicBar.js`](src/js/ui/RelicBar.js) | `RelicBar` | Thin passive vertical column of relic icons, mounted as the first child of MainRow before the player column. Icons stack top-down with no background or border (they "float" over the battle background). `hitTest()` returns null so it never absorbs clicks. When a `TooltipManager` is supplied via `setTooltipManager(tm)` (BattleScene wires this in `onEnter`), each icon registers a tooltip showing the relic's name + description; hover/touch-hold input is owned by the manager. The `MAIN_ROW_GAP` negative-overlap trick pulls the column ~30px into the player col so icons tuck against the panel's transparent left margin. `setRelics()` is idempotent — safe to call every frame. |
| [`src/js/ui/BattleBoardPanel.js`](src/js/ui/BattleBoardPanel.js) | `BattleBoardPanel` | Decorative wrapper panel around `BoardPlaceholder`. Uses `battle_board_panel` background asset and provides internal padding so the board lays out inside the frame. |
| [`src/js/ui/CombatLogPanel.js`](src/js/ui/CombatLogPanel.js) | `CombatLogPanel` | Compact panel below the board displaying recent log messages. No dedicated asset yet — falls back to styled dark background. Designed to later host the hidden turn-status messages. |
| [`src/js/ui/ManaCostRow.js`](src/js/ui/ManaCostRow.js) | `ManaCostRow` | Mana cost icons for skills (used by legacy `SkillRow`). |
| [`src/js/ui/BoardPlaceholder.js`](src/js/ui/BoardPlaceholder.js) | `BoardPlaceholder` | Board grid rendering: tile sprites, highlights, empty cells, fall animation, swap animation, targeting overlay, particle effects |
| [`src/js/ui/FloatingImageEffect.js`](src/js/ui/FloatingImageEffect.js) | `FloatingImageEffect` | Animated floating image (turn announcement, extra turn) with grow/settle/hold/fade phases |
| [`src/js/ui/FloatingTextEffect.js`](src/js/ui/FloatingTextEffect.js) | `FloatingTextEffect` | Floating "+N" match count text |
| [`src/js/ui/TileParticleEffect.js`](src/js/ui/TileParticleEffect.js) | `TileParticleEffect` | Particle burst for tile destruction and conversion effects |
| [`src/js/ui/ScreenShake.js`](src/js/ui/ScreenShake.js) | `ScreenShake` | Screen shake on damage, triggered by shakeIntensity from BattleController |
| [`src/js/ui/AuraStrandsEffect.js`](src/js/ui/AuraStrandsEffect.js) | `AuraStrandsEffect` | Animated aura strands on character select screen |
| [`src/js/ui/RewardOverlay.js`](src/js/ui/RewardOverlay.js) | `RewardOverlay` | **Post-battle reward screen overlay.** Renders above BattleScene with semi-transparent black backdrop (`BACKDROP_ALPHA`), victory title image (`reward_victory_text`), and centered primary reward panel (`reward_screen_temp_panel`). Panel contents use the UI framework (UIContainer/UIPanel/UIImage): three reward option containers (`rewards_option_panel`), centered Claim Reward button (`rewards_button_confirm`), and centered Skip Rewards button (`rewards_button_skip`) with tunable vertical offset. All layout values are named constants at the top of the file. Blocks all gameplay input. ESC dismisses → transitions to MapScene. Designed to be reusable for future reward/loot/event overlays. |
| [`src/js/ui/Tooltip.js`](src/js/ui/Tooltip.js) | `Tooltip` | **Reusable floating tooltip visual.** Background asset `tooltip_panel` + centered, word-wrapped `UIText`. Aspect ratio is preserved — only width (or `scale` multiplier) is configurable; height is derived as width / native aspect so the art never stretches. Driven externally by `TooltipManager` (not added as a child of any container). `setOptions({text, scale, width, padding, fontSize, lineHeight, color})` + `setPosition(x, y)` + `render(ctx)`. |
| [`src/js/systems/TooltipManager.js`](src/js/systems/TooltipManager.js) | `TooltipManager` | **Reusable tooltip system.** Owns a single `Tooltip` instance and a list of `(element, options)` attachments. Resolves hover vs touch-hold input by reading `input.mouseDown` (set BEFORE mousemove fires on touchstart, so touches always look "pressed" and skip the hover path). Hover shows on mouseover/hides on mouseout. Touch-hold uses `TOOLTIP_TOUCH_HOLD_MS` (350ms) timer started on mousedown; cancelled by movement beyond `TOOLTIP_TOUCH_MOVE_CANCEL_PX` (10px) so swipes still work. Position picks the side opposite to the parent relative to screen center (horizontal preferred, vertical fallback if it would clip), then clamps to the design viewport with `TOOLTIP_EDGE_MARGIN`. API: `attach(el, opts)`, `detach(el)`, `clear()`, `setEnabled(bool)`, `onMouseMove/Down/Up`, `update(dt)`, `render(ctx)`. |

### 4.7 Data Definitions

| File | Exports | Content |
|------|---------|---------|
| [`src/js/data/characters/warrior.js`](src/js/data/characters/warrior.js) | default: `warrior` | Warrior character definition (Thorgrim). `baseStats`, skills by ID, relics by ID. |
| [`src/js/data/characters/mage.js`](src/js/data/characters/mage.js) | default: `mage` | Mage character definition (Shylana). |
| [`src/js/data/characters/witchDoctor.js`](src/js/data/characters/witchDoctor.js) | default: `witchDoctor` | Witch Doctor character definition (Kalfou). |
| [`src/js/data/characters/index.js`](src/js/data/characters/index.js) | `warrior`, `mage`, `witchDoctor`, `getCharacterById`, default: `CHARACTERS_BY_ID` | **Character registry.** Re-exports each per-character file. `getCharacterById(id)` resolves by string id. Add new characters by importing + adding to `CHARACTERS_BY_ID`. |
| [`src/js/data/enemies/goblin.js`](src/js/data/enemies/goblin.js) | default: `goblin` | Goblin enemy definition. `hp`/`maxHp`/`attack`/`armor`, skills by ID, relics by ID, optional `aiBehavior` + `music`. |
| [`src/js/data/enemies/index.js`](src/js/data/enemies/index.js) | `goblin`, `getEnemyById`, default: `ENEMIES_BY_ID` | **Enemy registry.** Same pattern as characters/index.js. HP is scaled by MapScene for elite/boss nodes. |
| [`src/js/data/skills/skillCatalog.js`](src/js/data/skills/skillCatalog.js) | `SKILL_CATALOG` (default), `getSkillById`, `resolveSkillIds` | **Skill registry.** Plain object keyed by skill `id`. Each entry has `name`, `description`, `icon`, `sound`, `cost`, optional `targeting`/`area`, and `effects[]`. `resolveSkillIds(ids)` returns shallow-cloned full skill objects. |
| [`src/js/data/relics/relicCatalog.js`](src/js/data/relics/relicCatalog.js) | `RELIC_CATALOG` (default), `getRelicById`, `resolveRelicIds` | **Relic registry.** Plain object keyed by relic `id`. Each entry has `name`, `description`, `icon`, optional `area`, and `effects[]`. Each effect carries its own `trigger` field (TRIGGER_TYPES value) plus `effectType` and payload. |
| [`src/js/data/characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js) | `characterSelectDefinitions` (default) | UI metadata for CharacterSelectScene: portraitKey, splashKey, auraColor, order, enabled. References characterData from data/characters/. |
| [`src/js/data/playerStats.js`](src/js/data/playerStats.js) | `getEffectivePlayerStats`, `createPlayerBattleState`, `syncBattleResultsToRunState`, `createDefaultStatModifiers`, `applyRunModifier` | **Centralized stat resolution.** Resolves baseStats + statModifiers -> effectiveStats -> battle state. Single source of truth for all stat math. |
| [`src/js/data/runState.js`](src/js/data/runState.js) | `createRunState`, `serializeRunState`, `deserializeRunState` | **Run state factory.** Tracks characterId, currentHp (persistent), statModifiers (persistent run progression), relics/upgrades/rewards placeholders. |
| [`src/js/game/TileTypes.js`](src/js/game/TileTypes.js) | `TILE_TYPES`, `MANA_COLORS`, constants, helpers | Tile type definitions with spawn weights, particle colors, board dimensions. |

---

## 5. Task Routing Guide

When given a task, locate the owning system using this table:

| Symptom / Task | Look Here First | Secondary Files |
|----------------|-----------------|-----------------|
| "Skill doesn't work" | [`BattleController._resolveEffect()`](src/js/game/BattleController.js:1110) | [`MatchResolver.js` SKILL_EFFECT_TYPES](src/js/game/MatchResolver.js:23), skill definition in [`skillCatalog.js`](src/js/data/skills/skillCatalog.js) |
| "Tile matching wrong" | [`MatchResolver.analyzeMatches()`](src/js/game/MatchResolver.js:109) | [`BoardModel.findAllConnectedMatches()`](src/js/game/BoardModel.js:239) |
| "Scene transition wrong" | [`SceneManager.switchTo()`](src/js/scenes/SceneManager.js:105) | Scene `onEnter`/`onExit` methods |
| "Map node highlight wrong" | [`MapRenderer`](src/js/map/MapRenderer.js) | [`MapTraversalController`](src/js/map/MapTraversalController.js) state queries |
| "Character select data wrong" | [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js) | per-character file in [`data/characters/`](src/js/data/characters/) |
| "Audio not playing" | [`AudioManager._play()`](src/js/audio/AudioManager.js:300) | [`SoundConfig.js`](src/js/audio/SoundConfig.js), skill `.sound` field |
| "UI overlaps / layout broken" | [`UIElement` sizing model](src/js/ui/UIElement.js) | The specific view/scene's `buildHierarchy()` / `layoutChildren()` |
| "Enemy AI behavior" | [`EnemyAI.findBestSkill()` / `findBestSwap()`](src/js/game/EnemyAI.js) | [`EnemyAI._scoreBoard()`](src/js/game/EnemyAI.js:142) |
| "Add custom enemy AI" | [`enemyAiOverrides.js`](src/js/game/enemyAiOverrides.js) | [`customEnemyAi.js`](src/js/game/customEnemyAi.js), set `aiBehavior` on enemy definition in [`data/enemies/`](src/js/data/enemies/) |
| "Map generation wrong" | [`MapGenerator.generate()`](src/js/map/MapGenerator.js:119) | [`SeededRNG`](src/js/map/MapGenerator.js:8), [`_wireConnections`](src/js/map/MapGenerator.js:315) |
| "Tile disappear/reappear bug" | [`BoardModel.removeTiles()`](src/js/game/BoardModel.js:355) / [`applyGravity()`](src/js/game/BoardModel.js:372) | [`BattleController` cascade phases](src/js/game/BattleController.js:28) |
| "Health/damage calculation wrong" | [`MatchResolver.applyDamage()`](src/js/game/MatchResolver.js:163) | [`BattleController._setShakeFromDamage()`](src/js/game/BattleController.js:1193) |
| "Add new character" | new file in [`data/characters/`](src/js/data/characters/) + register in [`characters/index.js`](src/js/data/characters/index.js) | [`characterSelectDefinitions.js`](src/js/data/characterSelectDefinitions.js), [`main.js` ASSET_MAP](src/js/main.js:35) |
| "Add new enemy" | new file in [`data/enemies/`](src/js/data/enemies/) + register in [`enemies/index.js`](src/js/data/enemies/index.js) | Reference from [`MapScene._transitionToBattle`](src/js/scenes/MapScene.js) to spawn it |
| "Add new skill" | [`skillCatalog.js`](src/js/data/skills/skillCatalog.js) | Reference its `id` from `skills: [...]` on the owner; register icon/sound in [`main.js` ASSET_MAP](src/js/main.js:35) and [`SoundConfig.js`](src/js/audio/SoundConfig.js) |
| "Add new relic / passive" | [`relicCatalog.js`](src/js/data/relics/relicCatalog.js) | Pick a trigger from [`TriggerTypes.js`](src/js/systems/TriggerTypes.js), an effect type from [`EffectResolver.js`](src/js/systems/EffectResolver.js) (atomic) or [`BattleController._handlePassiveBoardEffect`](src/js/game/BattleController.js) (board-touching); reference id from `relics: [...]` on the owner |
| "Add new passive trigger event" | [`TriggerTypes.js`](src/js/systems/TriggerTypes.js) | Dispatch from the relevant spot in [`BattleController`](src/js/game/BattleController.js) via `this.passives.dispatch(...)` |
| "Add new effect type (atomic)" | [`EffectResolver.js`](src/js/systems/EffectResolver.js) | Add a case to the switch; if used by skills, also add to [`SKILL_EFFECT_TYPES`](src/js/game/MatchResolver.js:23) |
| "Add new skill effect type (board-touching)" | [`SKILL_EFFECT_TYPES`](src/js/game/MatchResolver.js:23) | [`BattleController._resolveEffect()`](src/js/game/BattleController.js) — handles cascade-driving effects |
| "Add new tile type" | [`TILE_TYPES`](src/js/game/TileTypes.js:11) | [`BoardModel` spawn weights](src/js/game/BoardModel.js:26), tile sprite in [`main.js` ASSET_MAP](src/js/main.js:35) |
| "Board rendering wrong" | [`BoardPlaceholder`](src/js/ui/BoardPlaceholder.js) | [`BattleScene.updateFromController()`](src/js/ui/BattleScene.js:481) |
| "Combat log issues" | [`CombatLog`](src/js/game/CombatLog.js) | [`BattleScene.updateFromController()`](src/js/ui/BattleScene.js:481) |
| "Post-battle reward/overlay issues" | [`RewardOverlay`](src/js/ui/RewardOverlay.js) | [`BattleScene._handleKeyDown()`](src/js/ui/BattleScene.js:448) (ESC dismiss), BattleScene `update()` (GAME_OVER → show) |
| "Add a tooltip to a UI element" | [`TooltipManager.attach(element, opts)`](src/js/systems/TooltipManager.js) | [`Tooltip`](src/js/ui/Tooltip.js) (visual); BattleScene constructs/clears the manager in `onEnter`/`onExit` and feeds it `_handleMouseDown/Move/Up`; aspect ratio is preserved via the `tooltip_panel` asset's native dims |
| "Stat calculation wrong" | [`playerStats.getEffectivePlayerStats()`](src/js/data/playerStats.js) | [`runState.js`](src/js/data/runState.js), per-character file `baseStats` in [`data/characters/`](src/js/data/characters/) |
| "Run modifier not persisting" | [`playerStats.applyRunModifier()`](src/js/data/playerStats.js) | [`runState.js` statModifiers](src/js/data/runState.js) |
| "Battle starts with wrong HP/mana" | [`playerStats.createPlayerBattleState()`](src/js/data/playerStats.js) | [`syncBattleResultsToRunState()`](src/js/data/playerStats.js), MapScene `_transitionToBattle()` |
| "Performance issues" | [`GameLoop` delta time](src/js/engine/GameLoop.js) | [`CanvasApp` DPR handling](src/js/engine/CanvasApp.js), AssetManager pre-scaling |

---

## 6. Data Flow Diagrams

### Character Select Flow
```
main.js init()
  → TitleScreen (any input)
  → CharacterSelectScene.onEnter()
  → characterSelectDefinitions[] (filtered enabled, sorted by order)
  → _selectIndex() → _updateInfoPanel() (rebuilds from characterData.baseStats)
  → _chooseHero()
     → createRunState(def.characterData) → fresh runState with zero statModifiers
     → MapScene.setRunState(runState, characterDef)
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
        → createPlayerBattleState(characterDef, runState) → fresh battle state
        → scale enemy HP for elite/boss
        → new BattleController(playerBattleState, enemyData)
        → new BattleScene(...) with _onBattleComplete callback
        → fadeToScene('BattleScene')
  → [on return from battle]
     → syncBattleResultsToRunState(runState, playerState) — persists currentHp
     → _applyPostBattleHealing(runState, playerState) — 30% HP heal
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
  → on GAME_OVER: delay → RewardOverlay.show()
     → Battle scene remains visible behind overlay
     → All battle input blocked
     → ESC → RewardOverlay.dismiss()
        → syncBattleResultsToRunState(runState, playerState)
        → _applyPostBattleHealing(runState, playerState)
        → _onBattleComplete({result, nodeId})
        → MapScene._handleBattleComplete() sets flag
        → fadeToScene('MapScene')
```

### Stat Architecture Flow (NEW)
```
Character Definition (immutable template)
  data/characters/<name>.js: { id, baseStats: { maxHp, startingMana, startingArmor, startingAttack }, skills, relics, ... }
        +
Run State (persistent progression)
  runState.js: { characterId, currentHp, statModifiers: { maxHp, startingMana: {...}, ... }, relics, ... }
        =
Effective Stats (computed each battle via playerStats.js)
  getEffectivePlayerStats(characterDef, runState)
        +
  runState.currentHp
        =
Battle State (fresh each battle via playerStats.js)
  createPlayerBattleState(characterDef, runState)
        |
  [Battle plays out, playerState mutated by BattleController]
        |
  syncBattleResultsToRunState(runState, playerState) — only currentHp persists back
```

**Key rules:**
- Character definitions are **immutable** — never mutate `baseStats`
- Run modifiers (`statModifiers`) are **additive** — rewards/relics/upgrades modify these, not base stats
- Effective stats are resolved through **centralized helpers** only — no scattered `base + modifier` math
- Battle state is **temporary** — created fresh each battle; mana/armor/attack reset from effective stats
- Only `currentHp` syncs back to run state after battle; mana/armor/attack are reset each battle
- Rewards use `applyRunModifier(runState, statPath, amount)` to modify run statModifiers

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

3. For targeted skills (tryTargetTile after tile click):
   _spendCost → _setSkillSound → compute area, then dispatch per effect:
   → DESTROY_TILES / DESTROY_TILES_ROW: _executeDestroyTiles(area)
   → CONVERT_TILE: _executeConvertTile(area, type) → match check → beginResolving
   → other effects: standard _resolveEffect (damage/armor/etc.)
   If no effect entered RESOLVING, the turn ends inline (mirrors tryPlayerSkill).
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
10. **MapScene is a singleton** — graph, renderer, traversal, `_runState`, and `_characterDef` all survive scene switches.
11. **Enemy difficulty scaling** happens in MapScene: elite = 1.5× HP, boss = 2.5× HP.
12. **Music transitions are state-driven** in BattleScene: battle_theme on PLAYER/ENEMY_TURN, stopped on GAME_OVER.
13. **All one-shot visual/SFX flags** are read-and-cleared in `BattleController.getState()` to prevent double-firing.
14. **Player stat architecture uses three-layer separation** (NEW):
    - **Layer 1 — Character definitions** (per-file in [`data/characters/`](src/js/data/characters/)): Immutable `baseStats` templates. Never mutated.
    - **Layer 2 — Run state** ([`runState.js`](src/js/data/runState.js)): Persistent `statModifiers` that accumulate from rewards/relics/upgrades. `currentHp` persists between battles.
    - **Layer 3 — Battle state**: Fresh instance created each battle via [`createPlayerBattleState()`](src/js/data/playerStats.js). Mana/armor/attack reset from effective stats each battle.
15. **Stat resolution is centralized** in [`playerStats.js`](src/js/data/playerStats.js). `getEffectivePlayerStats()` is the single source for computing baseStats + statModifiers. No scattered math elsewhere.
16. **Rewards modify run modifiers, not base stats.** Use `applyRunModifier(runState, statPath, amount)`. Example: `applyRunModifier(runState, 'startingMana.purple', 2)`.
17. **Only currentHp syncs back** from battle state to run state via `syncBattleResultsToRunState()`. Battle mana/armor/attack/temporary effects do NOT persist.
18. **Canvas uses DPR-aware rendering** — all layout is in CSS pixels; context is pre-scaled.
19. **Post-battle flow uses RewardOverlay** — GAME_OVER does NOT immediately return to MapScene. Instead, RewardOverlay appears over the (still-visible) BattleScene. ESC dismisses the overlay and triggers the MapScene transition.
20. **Enemy AI overrides are dispatch-based, not conditional.** Custom AI is registered in [`enemyAiOverrides.js`](src/js/game/enemyAiOverrides.js) as handler functions keyed by `aiBehavior`. [`customEnemyAi.js`](src/js/game/customEnemyAi.js) orchestrates: try custom → fallback to standard `EnemyAI`. Enemy definitions link via optional `aiBehavior` field.
21. **Skills and relics are id-referenced + catalog-resolved.** Character/enemy definitions store `skills: string[]` and `relics: string[]`. Resolution happens once at battle-state creation: [`createPlayerBattleState`](src/js/data/playerStats.js) for players, [`MapScene._transitionToBattle`](src/js/scenes/MapScene.js) for enemies (calls `resolveSkillIds` / `resolveRelicIds`). [`BattleController._cloneState`](src/js/game/BattleController.js) deep-clones the resolved relics + effect arrays so per-battle mutation cannot leak back to catalogs or runState.
22. **Passive abilities are data-driven via PassiveSystem dispatch, not conditionals.** Battle code emits trigger events via `this.passives.dispatch(triggerName, payload)`. [`PassiveSystem`](src/js/systems/PassiveSystem.js) iterates the affected side's relics, matches by `effect.trigger`, and resolves via `applyEffect`. Adding a relic requires no code changes outside [`relicCatalog.js`](src/js/data/relics/relicCatalog.js). Recursion guard is intentionally absent (today's relics don't recurse — add depth limit when needed).
23. **Trigger dispatch points in BattleController:**
    - `onTileMatch` / `onTileMatchType` / `onMatch4Plus` — fired from `_enterShowMatch` (every cascade step)
    - `onTurnStart` — fired from `_completeTurnIntro` (after state is set to PLAYER_TURN/ENEMY_TURN)
    - `onTurnEnd` — fired from `_endTurn` (before transitioning to TURN_INTRO)
    - `onTakeDamage` / `onDealDamage` — fired by `_dispatchDamageEvent` after every `applyDamage` call that lands `actualDamage > 0` (skill DAMAGE, skull damage in `_doRemove`, skull damage in `_executeDestroyTiles`).

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
| `SKILL_EFFECT_TYPES` | [`MatchResolver.js:23`](src/js/game/MatchResolver.js:23) | damage, armor, destroy_tiles, destroy_tiles_row, create_tiles, convert_tile, heal, extra_turn |
| `TILE_TYPES` | [`TileTypes.js:11`](src/js/game/TileTypes.js:11) | RED, BLUE, GREEN, YELLOW, PURPLE, SKULL — each with id, isSkull, color, particleColor, spawnWeight |
| `BOARD_COLS / BOARD_ROWS` | [`TileTypes.js:33`](src/js/game/TileTypes.js:33) | 8 / 8 |
| `AudioCategory` | [`SoundConfig.js:15`](src/js/audio/SoundConfig.js:15) | MASTER, MUSIC, SFX, UI, AMBIENT |
| `MANA_COLORS` | [`TileTypes.js:21`](src/js/game/TileTypes.js:21) | ['red', 'blue', 'green', 'yellow', 'purple'] |
| `DEBUG_MODE` | [`main.js:32`](src/js/main.js:32) | `true` — press 'K' in battle for instant win |
| Scene names | [`main.js:150`](src/js/main.js:150) | 'TitleScreen', 'CharacterSelectScene', 'MapScene', 'BattleScene' |
| `RewardOverlay` state | [`RewardOverlay.js:49`](src/js/ui/RewardOverlay.js:49) | INACTIVE, ACTIVE |

---

## 12. Key Callback / Event Patterns

| Pattern | Where | How |
|---------|-------|-----|
| Scene input wiring | Each scene's `onEnter()` | `input.on('mousedown', handler)` — cleared in `onExit()` |
| Skill click → controller | [`CharacterPane.onSkillClick`](src/js/ui/CharacterPane.js:43) | Set by BattleScene to `battleController.tryPlayerSkill()` |
| Battle complete → map | [`BattleScene._onBattleComplete`](src/js/ui/BattleScene.js:110) | Set by MapScene to `_handleBattleComplete()` |
| Reward overlay dismiss → map | [`RewardOverlay.onDismiss`](src/js/ui/RewardOverlay.js:74) | Set by BattleScene to `_returnToMap()` |
| State change notification | [`BattleController.onStateChange`](src/js/game/BattleController.js:182) | Callback; currently unused (BattleScene polls via getState) |
| One-shot visual/SFX flags | [`BattleController.getState()`](src/js/game/BattleController.js:207) | Read-and-clear pattern: extraTurnTriggerPos, shakeIntensity, skullDamageDealt, pendingSkillSound, destroyedTiles, convertedTiles, matchTextTriggers |

---

> **AFTER COMPLETING ANY IMPLEMENTATION TASK, UPDATE THIS FILE** if you added, removed, renamed, or changed the responsibility of any important file, class, system, data definition, or flow. This keeps the entry point accurate for the next agent.
