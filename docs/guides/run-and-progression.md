# Run & Progression

**Load this when:** you are touching the roguelike **map** (generation, traversal, rendering), **run state**, **player stats / stat scaling**, **floor difficulty (enemy scaling)**, **rewards / post-victory growth**, or **character select**.

Related guides:
- Battle-time logic (turn machine, skill effects, cascade, damage) → **battle-system.md** (the Battle Flow diagram lives there).
- Authoring content (characters, enemies, skills, relics, statuses, keywords) → **content-authoring.md**.
- The Skill Weave reward (woven skills) → **skill-weave.md**.

---

## Hard rules

Verbatim from the project rules. Violate only when explicitly instructed.

8. **Map generation is separate from map rendering.** MapGenerator creates the graph; MapRenderer/MapView draw it.
13. **Character definitions are immutable.** Never mutate `baseStats` during gameplay. Run modifiers go in `runState.statModifiers` via [`playerStats.applyRunModifier()`](../../src/js/data/playerStats.js).
14. **All stat math goes through [`playerStats.js`](../../src/js/data/playerStats.js).** Use `getEffectivePlayerStats()` to resolve stats, `createPlayerBattleState()` for battle init, `syncBattleResultsToRunState()` for persistence. Never scatter `base + modifier` math outside this module.
15. **Rewards modify runState.statModifiers, never baseStats.** Use `applyRunModifier(runState, 'startingMana.purple', 2)` pattern.

---

## Three-layer stat architecture

```
Character Definition (immutable template)
  data/characters/<name>.js: { id, baseStats: { maxHp, startingMana, startingArmor, startingAttack }, skills, relics, ... }
        +
Run State (persistent progression)
  runState.js: { characterId, currentHp, statModifiers: { maxHp, startingMana: {...}, ... }, relics, ... }
        =
Effective Stats (computed each battle via playerStats.js)
  getEffectivePlayerStats(characterDef, runState)
        =
Battle State (fresh each battle via playerStats.js)
  createPlayerBattleState(characterDef, runState)
  ↳ HP starts at full effective maxHp — current HP does NOT persist between fights
        |
  [Battle plays out, playerState mutated by BattleController]
        |
  syncBattleResultsToRunState(runState, playerState) — writes runState.currentHp,
  but it is no longer used to seed battle HP (kept for save/UI bookkeeping)
```

**Key rules:**
- Character definitions are **immutable** — never mutate `baseStats`
- Run modifiers (`statModifiers`) are **additive** — rewards/relics/upgrades modify these, not base stats
- Effective stats are resolved through **centralized helpers** only — no scattered `base + modifier` math
- Battle state is **temporary** — created fresh each battle; mana/armor/attack reset from effective stats
- HP does **not** persist between fights — every battle starts at full effective `maxHp`. `currentHp` is still written back by `syncBattleResultsToRunState` but is not read to seed battle HP. Mana/armor/attack also reset each battle.
- Rewards use `applyRunModifier(runState, statPath, amount)` to modify run statModifiers

The three layers are decisions [#14](../decisions/14-player-stat-architecture-uses-three-layer-separation.md) / [#15](../decisions/15-stat-resolution-is-centralized.md) / [#16](../decisions/16-rewards-modify-run-modifiers-not-base-stats.md) / [#17](../decisions/17-hp-resets-to-full-each-battle.md).

---

## Enemy floor scaling

Each enemy's authored `maxHp` / `attack` / `armor` in [`src/js/data/enemies/`](../../src/js/data/enemies/) is a **floor-1-equivalent baseline**. [`MapScene._transitionToBattle`](../../src/js/scenes/MapScene.js) scales it at spawn:

- **HP** is MULTIPLIED by `ENEMY_HP_FLOOR_MULT[node.depth]` (a player-DPT-ratio curve).
- **Armor** is MULTIPLIED by its **own curve** `ENEMY_ARMOR_FLOOR_MULT[node.depth]` (`enemyArmorFloorMult`) — armor is a survivability budget like HP, but is tuned independently (split from the HP array 2026-07-16, seeded with the HP values at the time; retuning HP no longer moves armor). (In-battle armor GAINS — skills/relics like Bone Armor — are NOT floor-scaled; only the authored baseline is.)
- **Attack** gets an ADDITIVE per-floor step bonus `ENEMY_ATTACK_FLOOR_BONUS[node.depth]` (≈ +1 every 2 floors, top +4). Attack is the lethality knob (it drives skull-match damage AND enemy SKILLS, which carry `scaling`), so it ramps as small additive steps — preserving per-enemy identity — rather than a multiplier.
- A per-enemy **`attackScale`** (default 1) scales that floor bonus for designed exceptions (`0` = opt out).
- **Tiering is by base value + role** (minions authored ~12-18, elites ~24-28) plus floor-gating.

### ⚠ MAINTENANCE CONTRACT — the curves are SHARED

`ENEMY_HP_FLOOR_MULT` / `ENEMY_ARMOR_FLOOR_MULT` / `ENEMY_ATTACK_FLOOR_BONUS` live in the shared, dependency-free [`src/js/data/enemyScaling.js`](../../src/js/data/enemyScaling.js), imported by BOTH:

- [`MapScene.js`](../../src/js/scenes/MapScene.js) (the game), and
- `sim/toolbench/engine.mjs` (which feeds the whole toolbench — trainer / runs / learn / analytic).

So **retuning the curve there is picked up by testing/training AUTOMATICALLY** — no sync step. (`engine.mjs` still MIRRORS a few other non-exported constants; `node sim/toolbench/drift-check.mjs` verifies the lot.)

Full rationale + history: decision [#11](../decisions/11-enemy-hp-and-attack-scale-per-floor.md); balance math in [`docs/balance-combat-math.md`](../balance-combat-math.md) §7.1 and [`docs/balance-findings.md`](../balance-findings.md).

---

## Map system

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/map/MapGenerator.js`](../../src/js/map/MapGenerator.js) | `MapGenerator` + `SeededRNG` | Deterministic map generation: 10 depths, smoothed node placement (±1 count delta between depths), type assignment (battle/elite/chest/training/rest/boss), local-lane edge wiring (\|Δlane\| ≤ 1), connectivity & edge-constraint validation. **Width:** start node sits at a center lane (`START_LANE`) and depth 1 = 3 nodes (`DEPTH_1_NODE_COUNT`) for a wider opening; middle-depth counts are picked uniformly (no width bias) so widths vary depth-to-depth. **Elites:** `_placeReachableElites` puts two elites at randomized depths/lanes (`ELITE_EARLY_DEPTHS` / `ELITE_LATE_DEPTHS`), the late one chosen from the early one's reachable descendants so a single route can hit both (≥2 reachable, not a fixed spot); `_dedupeConsecutiveElites` keeps elites non-adjacent. |
| [`src/js/map/MapGraph.js`](../../src/js/map/MapGraph.js) | `MapGraph` | Graph container: node lookup, depth grouping, serialization |
| [`src/js/map/MapNode.js`](../../src/js/map/MapNode.js) | `MapNode` | Single node: id, type, depth, lane, incoming/outgoing edges, state flags (discovered/reachable/current/completed) |
| [`src/js/map/MapTraversalController.js`](../../src/js/map/MapTraversalController.js) | `MapTraversalController` | Player position, moveTo validation, completeAndRevealNext, history, reachability queries, serialize/deserialize |
| [`src/js/map/MapRenderer.js`](../../src/js/map/MapRenderer.js) | `MapRenderer` | Node layout, SVG-like icon drawing, path/edge rendering, hover state, hit-testing |
| [`src/js/map/MapView.js`](../../src/js/map/MapView.js) | `MapView` | **Shared rendering component.** Used by MapScene (fullscreen) AND BattleScene (overlay with 'm' key). Container layout, backdrop, splash, depth labels, node info. Owns the overlay animation state machine (closed→opening→open→closing→closed) with crossfade + slide transitions, and the fresh-run **entry reveal** (`beginEntryReveal`: fullscreen splash → shrink into container → contents fade in; armed by MapScene after the map-transition movie handoff — see the UI guide's MapScene section) |

**Local-lane constraint (decision [#7](../decisions/07-local-lane-constraint.md)):** connections between consecutive depths may only move vertically by at most 1 lane (|source.lane − target.lane| ≤ 1). Node counts are smoothed (±1 between depths) to guarantee valid targets exist; edge validation enforces this at generation time.

---

## Run state & stats

| File | Exports | Content |
|------|---------|---------|
| [`src/js/data/playerStats.js`](../../src/js/data/playerStats.js) | `getEffectivePlayerStats`, `createPlayerBattleState`, `syncBattleResultsToRunState`, `createDefaultStatModifiers`, `applyRunModifier`, `MAX_EQUIPPED_SKILLS`, `getAllPlayerSkills`, `getEquippedSkills` | **Centralized stat resolution.** Resolves baseStats + statModifiers -> effectiveStats -> battle state. Single source of truth for all stat math. **Skills are split EQUIPPED vs OWNED:** `getAllPlayerSkills` = catalog skills + woven `runState.skills`; `getEquippedSkills` = the loadout (`runState.equippedSkillIds`, capped at `MAX_EQUIPPED_SKILLS`; `null` → first owned skills). `createPlayerBattleState` sets battle `skills` = equipped (the only castable ones) and `allSkills` = the full pool for the loadout modal. **Stats include `startingMagic`** (the Magic stat — mirrors `startingAttack` through baseStats/statModifiers/effective; battle state field `magic`; see decision [#34](../decisions/34-magic-stat-per-effect-damage-scaling-phys.md)). **Fractional modifiers are supported:** `applyRunModifier` accumulates raw fractions in `statModifiers` (e.g. a `growthPlan` of `startingAttack: 0.5` → +1 effective attack every other victory); `getEffectivePlayerStats` FLOORS every resolved stat (incl. per-color mana) at the single resolution point. ⚠ `sim/toolbench/engine.mjs` `makePlayerCombatant` mirrors the floor — keep them in sync. |
| [`src/js/data/scalingConfig.js`](../../src/js/data/scalingConfig.js) | `DAMAGE_SCALE_PER_POINT`, `DAMAGE_SCALING_PRESETS`, `SCALING_PRESETS`, `resolveScaling`, `scaledBonus`, `scaledAmount`, `resolveDynamicText` | **Damage stat-scaling config + helpers.** Single place to tune how a damage effect's individual `scaling` object grows its amount with the OWNER's stats: bonus = `floor(attack*scaling.attack + magic*scaling.magic)`. **`scaling` is an inline `{ attack, magic }` object per effect** (each skill/relic tunes its own rate); `DAMAGE_SCALE_PER_POINT` (= 1/3, "+1 per 3 stat") is the shared knob the data references. A preset name (`'magic'`/`'physical'`) is also accepted. `scaledAmount(base, scaling, caster)` (EffectResolver damage), `scaledBonus(scaling, caster)` (BattleController skill damage). **`resolveDynamicText(raw, effects, caster, cursor?)`** rewrites `<<n>>` tokens (the dynamic-value markup) with each damage effect's LIVE `amount + bonus`, preserving the `<<>>` wrapper so KeywordText colors it; used by skillCard (per-frame, live) + RelicBar tooltips. Opt-in: no `scaling` → flat; no caster → base shown. See decision [#34](../decisions/34-magic-stat-per-effect-damage-scaling-phys.md). |
| [`src/js/data/runState.js`](../../src/js/data/runState.js) | `createRunState`, `serializeRunState`, `deserializeRunState` | **Run state factory.** Tracks characterId, currentHp (persistent), statModifiers (persistent run progression), **`skills` (FULL skill objects acquired during the run — woven skills exist nowhere else)**, **`equippedSkillIds` (ordered battle-loadout ids, ≤ `MAX_EQUIPPED_SKILLS`; `null` = never customized → default loadout; managed by the in-battle loadout modal, read by `getEquippedSkills`)**, relics/upgrades/rewards placeholders, and `seenEnemiesByAct` ({act → enemy-id[]}, used by the spawn selector for per-act enemy dedup — see [`enemies/index.js`](../../src/js/data/enemies/index.js) `markEnemySeen`/`selectEnemyForNode`). Serialized/deserialized with the rest of the run. |

Character-select UI metadata ([`characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js)), the character defs themselves, and the relic reward pool ([`relicRewards.js`](../../src/js/data/relics/relicRewards.js)) are documented in **content-authoring.md**.

**Post-victory growth** is AUTO-applied per character from a fixed `growthPlan` field on the character def (Warrior `{maxHp:5, startingAttack:1}`, Mage & Witch Doctor `{maxHp:4, startingMagic:1}`), applied by `BattleScene._applyGrowthPlan` on victory (fallback `DEFAULT_GROWTH_PLAN`). The player-chosen Level Up overlay is DORMANT — see decision [#36](../decisions/36-post-victory-growth-is-auto-applied-per.md).

---

## Flows

### Character Select Flow
```
main.js init()
  → TitleScreen (any input)
  → CharacterSelectScene.onEnter()
  → characterSelectDefinitions[] (filtered enabled, sorted by order)
  → _selectIndex() → _updateInfoPanel() (rebuilds from characterData.baseStats)
  → _chooseHero()
     → createRunState(def.characterData) → fresh runState with zero statModifiers
     → MapScene.resetForNewRun() → clears stale map/traversal so a fresh map regenerates
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

> The **Battle Flow** diagram (BattleScene/BattleController per-frame loop, victory → Level Up → Reward → map) lives in **battle-system.md**.

---

## Recipes

| Symptom / Task | Look Here First | Secondary Files |
|----------------|-----------------|-----------------|
| "Map generation wrong" | [`MapGenerator.generate()`](../../src/js/map/MapGenerator.js) | [`SeededRNG`](../../src/js/map/MapGenerator.js), `_wireConnections` |
| "Map node highlight wrong" | [`MapRenderer`](../../src/js/map/MapRenderer.js) | [`MapTraversalController`](../../src/js/map/MapTraversalController.js) state queries |
| "Character select data wrong" | [`characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js) | per-character file in [`data/characters/`](../../src/js/data/characters/) |
| "Stat calculation wrong" | [`playerStats.getEffectivePlayerStats()`](../../src/js/data/playerStats.js) | [`runState.js`](../../src/js/data/runState.js), per-character file `baseStats` in [`data/characters/`](../../src/js/data/characters/) |
| "Run modifier not persisting" | [`playerStats.applyRunModifier()`](../../src/js/data/playerStats.js) | [`runState.js` statModifiers](../../src/js/data/runState.js) |
| "Battle starts with wrong HP/mana" | [`playerStats.createPlayerBattleState()`](../../src/js/data/playerStats.js) | [`syncBattleResultsToRunState()`](../../src/js/data/playerStats.js), MapScene `_transitionToBattle()` |
| "Add new character" | new file in [`data/characters/`](../../src/js/data/characters/) + register in [`characters/index.js`](../../src/js/data/characters/index.js) | [`characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js), [`main.js` ASSET_MAP](../../src/js/main.js) |

---

## Design decisions

| # | Hook |
|---|------|
| [#6](../decisions/06-map-generation-is-separate-from-map-rendering.md) | Map generation is separate from map rendering (MapGenerator → immutable MapGraph; MapRenderer/MapView draw; MapTraversalController mutates state). |
| [#7](../decisions/07-local-lane-constraint.md) | Local-lane constraint (\|Δlane\| ≤ 1), smoothed node counts, centered start lane, reachable-elite placement. |
| [#8](../decisions/08-mapview-is-shared.md) | MapView is shared between MapScene (fullscreen) and BattleScene ('m' overlay). |
| [#9](../decisions/09-battlescene-is-created-on-demand.md) | BattleScene is created on demand (registered lazily by MapScene), not at boot. |
| [#10](../decisions/10-mapscene-is-a-singleton.md) | MapScene is a singleton — graph, renderer, traversal, `_runState`, `_characterDef` survive scene switches. |
| [#11](../decisions/11-enemy-hp-and-attack-scale-per-floor.md) | Enemy HP (multiplicative) and attack (additive steps) scale per floor; authored values are floor-1 baselines. |
| [#14](../decisions/14-player-stat-architecture-uses-three-layer-separation.md) | Three-layer stat separation: immutable character def + run statModifiers → effective stats → fresh battle state. |
| [#15](../decisions/15-stat-resolution-is-centralized.md) | Stat resolution is centralized in playerStats.js — no scattered `base + modifier` math. |
| [#16](../decisions/16-rewards-modify-run-modifiers-not-base-stats.md) | Rewards modify run modifiers, not base stats (`applyRunModifier`). |
| [#17](../decisions/17-hp-resets-to-full-each-battle.md) | HP resets to full each battle; `currentHp` is bookkeeping only. |
| [#19](../decisions/19-post-battle-flow-level-up-reward-map.md) | Post-battle flow: (Level Up →) Reward → map; overlays render over the still-visible BattleScene. |
| [#27](../decisions/27-defeat-routes-to-a-dedicated-gameoverscene-not.md) | Defeat routes to GameOverScene (no sync/healing/growth); `MapScene.resetForNewRun()` clears stale traversal. |
| [#34](../decisions/34-magic-stat-per-effect-damage-scaling-phys.md) | Magic stat + per-effect `scaling` + `[[phys]]`/`[[mag]]` keywords + `<<n>>` live-value markup. |
| [#36](../decisions/36-post-victory-growth-is-auto-applied-per.md) | Post-victory growth is auto-applied from the character's `growthPlan`; the Level Up pick is dormant. |
