# Architecture & Maintainability Review — `BattleScene.js` + `BattleController.js`

> **Scope:** [`src/js/ui/BattleScene.js`](../../src/js/ui/BattleScene.js) (~2,750 lines) and
> [`src/js/game/BattleController.js`](../../src/js/game/BattleController.js) (~3,790 lines).
> **Type:** Design review only — **no code was modified**. This document is a blueprint for
> future refactoring, ordered by value, not a mandate to do everything.
> **Reviewed:** 2026-07-01.

---

## Executive Summary

These two files are the heart of the game and together account for ~6,500 lines. The
**overall architecture between them is sound**: BattleController owns all game logic and never
touches the canvas; BattleScene owns all rendering/audio/input and communicates with the
controller almost exclusively through `getState()`'s read-and-clear one-shot flags and a small
public API. That separation (project rule #3) has held up well and should be preserved.

The problems are **within** each file, not between them:

1. **BattleController is a god class.** It contains at least eight separable subsystems
   (turn state machine, cascade phase machine, skill-effect interpreter, targeting geometry,
   enemy-turn dispatch, status-effect engine, poison engine, the Phoenix/Egg transform phase,
   and passive board-effect handlers). Several documented historical bugs (the "kept
   targeting" bug, the enemy extra-turn freeze, the stale extra-turn flag) are direct
   consequences of the same logic being duplicated across four skill-execution paths.
2. **BattleScene has absorbed the run-progression flow.** Victory growth, level-up, relic
   granting, run-state sync, metrics, and the return-to-map transition are game-flow logic
   living in a UI class, wired through private access into SceneManager and the controller.
3. **The one-shot event channel has outgrown its shape.** `getState()` now hand-rolls
   seventeen capture-and-clear fields, and `updateFromController()` mirrors them with
   seventeen `if` blocks. Every new visual event costs edits in four places.

None of this is on fire — the code is unusually well-commented, the invariants are written
down, and the data-driven passive/effect architecture is genuinely good. But both files are
at the size where each new mechanic (statuses, poison, mark/lock/reflect, the egg phase were
all added *into* these files) increases the chance of cross-feature regressions. The
recommendations below are aimed at flattening that cost curve.

**Top three actions by value:**
1. Extract a single skill-execution pipeline in BattleController (removes the 4-way
   duplication that has already caused shipped bugs) — *High severity, Medium effort*.
2. Extract the post-battle/run-progression flow out of BattleScene — *High severity, Medium effort*.
3. Replace the seventeen one-shot flags with a single typed event queue — *Medium severity,
   Medium effort, large extensibility payoff*.

---

## 1. Overall Architecture

### 1.1 Current shape

**BattleController** responsibilities as-built:

| Subsystem | Approx. location | Lines |
|---|---|---|
| Construction + one-shot flag declarations | ctor | ~380 |
| Static relic modifier aggregation | `_initStaticModifiers`, `_recomputeDynamicAttack`, `_applyMatchBonuses` | ~160 |
| `getState()` capture-and-clear + snapshot | `getState`, `getTurnLabel` | ~130 |
| Player actions (swap / skill / targeting) | `tryPlayerSwap` … `cancelTargeting`, `_computeTargetingArea` + row/column helpers | ~330 |
| Board-mutating skill executors | `_executeDestroyTiles`, `_executeConvertTile`, `_executeCreateTiles`, `_executeConvertTilesByType`, `_executeShuffle`, `_executeLockColor` | ~350 |
| Cascade phase machine | `_beginResolving` → `_finishResolving` | ~370 |
| Turn lifecycle | `_endTurn`, `_beginTurnAnnouncement`, `_completeTurnIntro`, `_maybeAutoPassPlayer` | ~200 |
| Status-effect engine | `_applyStatus` … `_applyStatusTurnStartEffect` | ~160 |
| Frame update / timers | `update` | ~90 |
| Enemy turn (standard + custom AI + extra turn) | `_doEnemyTurn`, `_doEnemySwap`, `_dispatchCustomEnemyAction`, `_beginEnemyExtraTurn` | ~210 |
| Skill-effect interpreter | `_resolveEffect` (single switch) | ~360 |
| Damage pipeline + trigger dispatch | `_applyDamage`, `_dispatchDamageEvent`, `_dispatchManaGain`, `_dispatchMatchEvents` | ~200 |
| Passive board effects (7 handlers) | `_handlePassiveBoardEffect` + `_applyPassive*` | ~470 |
| Phoenix/Egg transform phase | `_transformInto`, `_applyTransform`, `_resolveEggPhaseAtTurnEnd`, `_endEggPhase` | ~130 |
| Poison engine | `_applyPoison`, `_applyPassivePoison`, `_tickPoison` | ~75 |
| Misc (shake calc, `screenToBoard`) | bottom | ~30 |

**BattleScene** responsibilities as-built:

| Subsystem | Approx. location |
|---|---|
| Layout construction | `buildHierarchy`, `_buildSideColumn` |
| Scene lifecycle + wiring (input, tooltips, overlays, turn gate) | `onEnter` / `onExit` |
| Input routing (5 handlers, each opening with the same overlay cascade) | `_handleMouseDown/Move/Up/Wheel/KeyDown`, `_handleContextMenu` |
| Frame sync from controller (SFX + effect spawning + data binding) | `updateFromController` (~240 lines) |
| Effect spawning (8 spawn methods + damage-counter management) | `_spawn*`, `_addDamageToCounter` |
| Attack-animation POC + live tuner (currently disabled) | `ATTACK_ANIMATIONS`, `_attackAnim*`, debug HUD |
| Custom rendering (scrim, corner buttons, targeting controls, overlays) | `renderBackground`, `renderForeground`, `render`, `_renderTargetingControls` |
| Music state machine (two strategies) | `_updateMusicFromState*` |
| **Post-battle run progression** (growth, level-up, relic grant, metrics, run-state sync, healing, return-to-map) | `_applyGrowthPlan`, `_applyLevelUp`, `_grantRelicReward`, `_showRewardOverlay`, `_returnToMap`, `_recordBattleMetrics`, `_applyPostBattleHealing` |
| Loadout modal integration | `_openLoadout`, `_applyLoadout` |
| Debug (`K` win) | `_debugWinBattle` |

### 1.2 Verdict

- The **controller/scene boundary** is correct and worth defending. Data flows one way per
  frame (`update(dt)` → `getState()` → UI), with two deliberate, documented inversions (the
  turn-gate predicate and the loadout mutation) — see §4.
- Both files individually violate the Single Responsibility Principle. Neither needs a
  rewrite; both need **extraction** of subsystems that are already internally cohesive
  (they mostly touch their own fields and a small controller surface).

### 1.3 Files/classes that should eventually exist

Proposed target module map (each item is elaborated as a recommendation below):

```
src/js/game/
  BattleController.js        — state machine + orchestration ONLY (~1,200 lines)
  battle/SkillExecutor.js    — the single skill-cast pipeline + effect-handler registry (R1, R2)
  battle/StatusEngine.js     — statuses + poison + mark/reflect checkpoints (R4)
  battle/TransformPhase.js   — Phoenix/Egg phase + _transformInto (R5)
  battle/PassiveBoardEffects.js — the seven _applyPassive* handlers (R5)
  battle/TargetingModel.js   — targeting state + area geometry (R6)
  battle/BattleEvents.js     — typed one-shot event queue shared with the scene (R3)

src/js/ui/
  BattleScene.js             — layout, per-frame binding, render hooks (~1,200 lines)
  battle/BattleInputRouter.js / ModalStack.js — overlay-aware input routing (R7)
  battle/BattleEffectsDirector.js — event → visual/SFX spawning (R8)
  battle/PostBattleFlow.js   — victory/defeat pipeline + run progression (R9)
```

This is a direction, not a contract — extract in the order of the recommendations, and stop
when marginal value drops.

---

## 2. Performance

Overall: **performance is not a current problem.** The game loop's cost is dominated by
canvas drawing in BoardPlaceholder/effects, and both files show real care already (documented
idempotent `setRelics`, the mobile-tuned ManaStreamEffect, pre-warmed spritesheets). The items
below are GC-pressure and waste reductions, not hot-loop fixes.

| # | Finding | Location | Impact |
|---|---|---|---|
| P1 | `getState()` allocates a fresh ~40-field object **plus** replacement arrays/objects for every one-shot buffer, every frame (`_matchTextTriggers = []`, `_directDamageBySide = {…}`, etc.) — even on completely idle frames. | `BattleController.getState()` | Low–Medium (steady GC churn on mobile) |
| P2 | `updateFromController()` allocates per frame regardless of change: two `{attack, magic}` objects × 4 calls (`setOwnerStats` for both skill panes + both relic bars), `state.log.getRecent(3)` + `.map().join()` for the combat log, and the damage-counter anchor objects. | `BattleScene.updateFromController` | Low |
| P3 | `STAT_TEXT_STYLE` is re-created inside `_spawnStatTextEffect` on every call. Should be a module-level constant (its siblings all are). | `BattleScene._spawnStatTextEffect` | Low (also a readability fix) |
| P4 | `_applyDamage` → `_hasStatus` does an array `.find()` up to 5× per hit (brittle/intangible/berserk/reflecting/crippled). Status lists are tiny (<4), so this is fine — flagged only so nobody "optimizes" it into a cache with invalidation bugs. **No action recommended.** | `BattleController` | None |
| P5 | Per-frame polling: `_recomputeDynamicAttack` + `_enforceStatusAttack` for both sides every `update()`. Both are O(rules)/O(statuses) and delta-based — cheap and deliberately defensive (documented). **No action recommended** unless R3's event queue lands, after which they could become event-driven. | `BattleController.update` | None |
| P6 | `renderBackground` rebuilds the 10-stop scrim gradient every frame. Stops only change on layout change — cacheable, but gradient creation is cheap. Optional. | `BattleScene.renderBackground` | Low |
| P7 | `new EnemyAI(...)` is constructed every enemy turn (and again in the silenced branch). Trivial, but it could be constructed once per battle and re-pointed. | `BattleController._doEnemyTurn` | Low |

**Concrete cheap wins** (safe, mechanical): P3; return `null` instead of `[]`/fresh objects
from `getState()` for empty buffers (or fold into R3's event queue which fixes P1
structurally); memoize the owner-stats objects in `updateFromController` behind an
attack/magic dirty check (fixes P2).

---

## 3. Function Design

### 3.1 The four-way skill-execution duplication (the most important finding in either file)

The sequence *"spend cost → set sound → log → iterate effects (tracking `enteredCascade`) →
check game over → drain pending skull destroys → handle extra turn → end turn"* is
implemented **four times** with divergent details:

1. `tryPlayerSkill` (instant player skills) — lines ~868–925
2. `tryTargetTile` (targeted player skills) — lines ~984–1056
3. `_doEnemyTurn` standard-AI skill branch — lines ~2205–2232
4. `_dispatchCustomEnemyAction` skill branch — lines ~2320–2342

The divergences are exactly where the shipped bugs were:

- `tryTargetTile` needed a hand-added `this.state = BattleState.PLAYER_TURN` in its
  extra-turn branch (the "kept targeting" bug — the other paths didn't need it).
- The enemy paths must route extra turns through `_beginEnemyExtraTurn` to re-arm
  `_enemyFired` (the "battle freezes" bug — the player paths must not).
- Only `tryTargetTile` calls `_maybeAutoPassPlayer` after an extra turn.
- Only the player paths handle `_eggForcedExtraTurn` announcement suppression inline.

Each new post-cast concern (Deathbringer drain was one; leech, mark, and the egg phase all
touch this area) must be remembered in up to four places.

The enemy swap flow is similarly duplicated: `_doEnemySwap` and the swap branch of
`_dispatchCustomEnemyAction` are ~30 near-identical lines each.

### 3.2 `_resolveEffect` — a 360-line switch that wants to be a registry

23 cases in one function. Each case is individually fine, but:

- The file already demonstrates the better pattern twice: `enemyAiOverrides.js` (handlers
  keyed by string) and `_handlePassiveBoardEffect` (a thin switch delegating to named
  `_applyPassive*` methods).
- Several cases (`DAMAGE`, `ARMOR`, `HEAL`, `BARRIER`, `GAIN_MANA`, `DRAIN_MANA`,
  `EXTRA_TURN`, `GAIN_ATTACK`) **also exist in `systems/EffectResolver.js`** with slightly
  different implementations (the passive path). The split is documented (board-touching
  effects need the cascade machine), but atomic effects being implemented twice is drift
  waiting to happen — e.g. heal-flooring, `_recomputeDynamicAttack` calls, and floating-stat
  emission must be kept in sync by hand.

### 3.3 Other function-level findings

| Finding | Location | Note |
|---|---|---|
| `_enterShowMatch` does six jobs: bookkeeping, match bonuses, extra-turn detection + cause-position search, flourish construction, passive dispatch, floating-text triggers, logging, phase entry (~100 lines). | `BattleController._enterShowMatch` | Extract `_detectExtraTurn(analysis)` and `_buildMatch4Flourish(analysis)`. |
| `_finishResolving` interleaves four exit routes (deathbringer follow-up, resume-turn, extra turn, end turn) with flag juggling. | `BattleController._finishResolving` | Candidate for a single "turn outcome" resolution — see R10. |
| `side === 'player' ? 'enemy' : 'player'` appears **9+ times**. | both files | Add `opponentOf(side)` (module-level util). |
| `${p.col},${p.row}` Set-key stringification appears in 4 functions. | `BattleController` | Tiny `posKey(p)` util; or Sets of packed ints. |
| `updateFromController` is ~240 lines of unrelated `if (state.X)` blocks. | `BattleScene` | Split: `_processOneShotEvents(state)` + `_bindPanelData(state)` + `_bindBoardVisuals(state)` — or subsume under R3/R8. |
| `_handleMouseDown` mixes 7 concerns (overlays, corner buttons, targeting buttons, tooltips, relic pages, skills panes, board). Order is load-bearing but implicit. | `BattleScene` | See R7 (router with an explicit priority list). |
| Misplaced/duplicated JSDoc: `_addDamageToCounter` has a second doc block stranded above `_hasPendingDamageDelivery`; `_applyPostBattleHealing`'s doc sits above `_applyVictoryGrowth`. | `BattleScene` ~1499–1523, ~2671–2694 | Mechanical cleanup. |
| `_rewardOverlayShown` actually means "game-over routing has fired" (it also gates the defeat → GameOverScene branch). Misleading name. | `BattleScene.update` | Rename to `_gameOverHandled`. |
| `screenToBoard(px, py, boardW, boardH)` — a rendering-space helper on the **controller**; the scene uses `BoardPlaceholder.screenToCell` instead. **Confirmed dead** (grep: zero callers in `src/`). | `BattleController` bottom | Delete. |
| `enterTargeting(skill)` duplicates the targeting-entry block inside `tryPlayerSkill` and skips the silence/afford checks. **Confirmed dead** (grep: zero callers in `src/`). | `BattleController.enterTargeting` | Delete (or make `tryPlayerSkill` delegate to it if an external entry point is ever wanted). |
| `_applyDamage` has grown a hidden pipeline: incoming-damage dispatch → mark consumption → berserk/brittle/intangible → resolver → reflect recursion → floating stat → sticky death. Correct, but it's 8 stages expressed as sequential mutations of `dmg`. | `BattleController._applyDamage` | Acceptable now; if one more stage lands, restructure as an explicit ordered list of named mitigation steps. |

---

## 4. Data Flow

### 4.1 What's good (preserve these)

- **One-directional frame sync.** Controller mutates state in `update(dt)`; scene reads a
  snapshot via `getState()` and never (with two exceptions) writes back. The read-and-clear
  one-shot pattern guarantees each visual/SFX event fires exactly once.
- **Single damage chokepoint.** Every damage source funnels through `_applyDamage` (rule
  #19), which is what makes mark/reflect/brittle/intangible/mitigation uniform. This is the
  single most valuable invariant in the controller — any refactor must keep it.
- **Turn-gate injection** (`setTurnGate(() => scene predicate)`) is clean dependency
  inversion: the controller waits on presentation without knowing what it's waiting for,
  with a hard cap so a stuck animation can't deadlock. Model future presentation/logic
  synchronization on this rather than on shared timing constants (see §7 M2).

### 4.2 Issues

| Finding | Detail |
|---|---|
| **`getState()` leaks live references.** `playerState`, `enemyState`, `board`, `highlightCells` etc. are the real objects. The scene (and the loadout overlay via `_applyLoadout`) mutates `playerState.skills` directly. Works today, but nothing marks the boundary; a future scene-side mutation of, say, `statuses` would corrupt logic silently. | Document the contract at minimum; ideally route the two legitimate writes (loadout change, debug win) through controller methods (`setPlayerLoadout(ids)`, `debugForceWin()`). |
| **Private-member coupling to SceneManager.** BattleScene reaches for `sm._scenes['MapScene']`, `sm._input`, `sm._app` throughout, and MapView is "borrowed" from another scene's private field. Any SceneManager refactor breaks this file in ~20 places. | Add public accessors (`sceneManager.getScene(name)`, `.input`, `.app`) or inject the services at construction (they're already singletons created in `main.js`). |
| **Scene calls controller privates.** `_debugWinBattle` sets `enemyState.hp = 0` and calls `_checkGameOver()`; `_returnToMap` and the game-over branch call `_winner()`; `_renderTargetingControls` reads `_targetingSkill` even though `getState()` already exposes `targetingSkill`. | Promote to public API: `getWinner()`, `debugForceWin()`; use the snapshot's `targetingSkill`. |
| **`userData` as an untyped side-channel.** `runState`, `nodeId`, `mapSeed`, `music`, `background`, `nodeDepth`, `nodeType` all arrive via `this.userData` set by MapScene, consumed in six scattered methods. There is no single place that documents what a battle needs. | Introduce a typed `BattleContext` object (one field on the scene, constructed by MapScene) — mostly a documentation/aggregation change. |
| **Run-state writes are split across two files and two moments.** `_applyGrowthPlan`/`_applyLevelUp`/`_grantRelicReward` mutate `runState` mid-overlay; `_returnToMap` then does `syncBattleResultsToRunState` + healing + `mapScene.setRunState`. Defeat takes a third path that skips all of it. Understanding "what persists after a battle" requires reading BattleScene, playerStats, and MapScene together. | Fixed structurally by R9 (PostBattleFlow owns all runState mutation in one sequence). |
| **`_cloneState` is field-explicit and silently lossy.** Adding a battle-state field and forgetting the clone drops it — this already shipped one bug (`allSkills`, documented in decision #21). `_transformInto` repeats the same explicit field list a second time. | See R11. |

---

## 5. Readability

The comment discipline in both files is excellent — most non-obvious blocks explain *why*,
often citing the historical bug. The readability problems are structural, not stylistic:

1. **The extra-turn flag cluster.** `_extraTurnEarned`, `pendingExtraTurn`,
   `_eggForcedExtraTurn`, `_resumeTurnAfterResolve`, plus the stale-flag scrub in
   `_completeTurnIntro`, plus `_enemyFired` re-arming — six interacting booleans whose valid
   combinations exist only in comments. This is the hardest part of the controller to reason
   about and the source of three documented bugs. (See R10.)
2. **Magic numbers with names missing.** Brittle `× 1.5`, intangible clamp `1`, berserk
   `× 2`, poison halving `/ 2`, shake full-intensity threshold `0.20`, mark default `×2`,
   lock minimum `2` turns are inline. Most other tunables in these files are proud
   top-of-file constants — these should join them (`STATUS_DAMAGE_MODS`, `SHAKE_FULL_AT_HP_FRACTION`, …).
3. **Dead/dormant code creates false reading paths.** In BattleScene: `_applyVictoryGrowth`
   (deprecated, unused), `_applyPostBattleHealing` (a no-op with `healPct = 0.0`),
   `_showLevelUpOverlay`/`_applyLevelUp` + `LEVEL_UP_*` tables (dormant by decision #36), the
   `ATTACK_ANIMATIONS` POC (all entries `enabled: false`), `_updateMusicFromState_original`
   (a drifted legacy branch), the hidden `_turnLabel`. Each is individually justified, but
   together roughly 15% of the file is code a reader must *discover* is inert. Move dormant
   features behind a single `// ── DORMANT ──` section or extract to a
   `battleSceneDormant.js` so live code reads contiguously. In BattleController:
   `screenToBoard` (apparently dead) and `enterTargeting` (unclear caller).
4. **Naming.** `_rewardOverlayShown` (see §3.3); `_deathbringerFiredThisAction` and
   `_echoDamageActive` name specific relics inside supposedly data-driven engine code —
   rename to mechanism names (`_damageTriggeredDestroyFired`, `_damageEchoInFlight`) so the
   next damage-triggered relic doesn't look like it needs new plumbing.
5. **`getState()`'s 60 lines of capture-and-clear boilerplate** — seventeen identical
   three-line stanzas. R3 removes this wholesale; short of that, a
   `take(field, empty)` helper would collapse it to one line each.

---

## 6. Extensibility

The data-driven catalogs (skills/relics/statuses referencing effects by type) are the
project's biggest strength — adding a relic is pure data. The friction is what happens when a
new **effect type** or **visual event** is needed:

| Adding… | Today requires touching | After R1–R3 |
|---|---|---|
| A new atomic skill effect | `SKILL_EFFECT_TYPES` + a `_resolveEffect` case (+ possibly a duplicate in `EffectResolver` for the relic path) | One handler registration, shared by both paths |
| A new one-shot visual/SFX event | Controller field + ctor JSDoc + `getState()` capture stanza + return field + a scene `if` block in `updateFromController` (5 places) | `events.push({type, …})` + one scene handler registration (2 places) |
| A new modal overlay | A guard clause at the top of **five** scene input handlers + `update` tooltip gating + `renderForeground` + `onEnter`/`onExit` reset | Push/pop on a modal stack |
| A new "boss phase" mechanic (like the egg) | New fields + hooks hand-woven into `_checkGameOver`, `_endTurn`, `_doEnemyTurn`, `_finishResolving`, `tryPlayerSkill`, `tryTargetTile` | A phase module with named hook points (R5) |

Also worth noting: `BattleState` transitions are written as bare `this.state = …` in ~15
places with `onStateChange` fired inconsistently. A `_setState(next)` helper is a 30-minute
change that gives one debug logging point and consistent change notification (R12).

---

## 7. Maintainability — technical debt register

| ID | Debt | Risk |
|---|---|---|
| M1 | Four duplicated skill-execution paths (§3.1). | **High** — has already produced 2+ shipped bugs; every new post-cast mechanic multiplies. |
| M2 | Presentation timing constants inside game logic: `HARVEST_ANIM_DELAY` ("keep roughly in sync with HarvestTendrilEffect's total duration"), `MATCH4_FREEZE_MS`, `TURN_INTRO_DURATION`, `_extraEnemyTurnDelay`. If an artist retunes an effect, a *controller* constant silently desyncs. | Medium — prefer the turn-gate pattern (scene tells controller when presentation is done) over shared magic durations. |
| M3 | Atomic effects implemented twice (controller `_resolveEffect` vs `EffectResolver`) — heal/armor/barrier/damage semantics must be manually kept identical. | Medium |
| M4 | `_cloneState` + `_transformInto` explicit field lists (silent field-drop hazard, one prior shipped bug). | Medium |
| M5 | Extra-turn flag cluster invariants live in comments only (§5.1). | Medium–High |
| M6 | `Math.random()` used directly (`_applyPassiveDestroyRandomRow`, `BoardModel.pickRandomTiles`, board refill) — battles are non-reproducible; no seeded RNG seam for tests or replays, even though MapGenerator already has `SeededRNG`. | Medium (blocks testing/replay more than correctness) |
| M7 | No automated tests cover the controller, and the `sim/` suites are stale (per project instructions, not to be run). The controller is *nearly* headless-testable already (no canvas imports) — the main obstacles are M6 and time-based phases. | Medium |
| M8 | Scene ↔ framework private coupling (`sm._scenes`, `_input`, `_app`, controller privates). | Medium |
| M9 | Dormant code interleaved with live code in BattleScene (§5.3). | Low |
| M10 | `update()` in BattleScene has subtle order dependencies: controller update → `updateFromController` → hit-stop early-return (which also skips `super.update`, i.e. layout) → game-over routing → effect updates. It works, and the hit-stop comment explains it, but inserting a new step in the wrong slot is easy. | Low–Medium |

---

## Recommendations

Severity legend: Critical / High / Medium / Low / Future Enhancement.
Complexity legend: Small (≤½ day) / Medium (1–3 days) / Large (multi-day, staged).

---

### R1 — Extract a single skill-execution pipeline

**Severity:** High
**Why it matters:** The 4-way duplication (§3.1) is the file's largest source of shipped
bugs; the divergent extra-turn/targeting/enemy-gate handling is exactly the code that broke
three times.
**Current issue:** `tryPlayerSkill`, `tryTargetTile`, `_doEnemyTurn` (standard-AI branch),
and `_dispatchCustomEnemyAction` each re-implement spend → sound → log → resolve effects →
game-over → skull-destroy drain → extra-turn → end-turn, with per-path patches.
**Proposed architecture:** One controller method
`_castSkill(side, skill, { targetArea?, targetCell? })` that owns the entire sequence and
returns nothing (it drives the state machine). Side-specific epilogues become two small
strategies: player extra turn (set `PLAYER_TURN`, announce unless egg-forced, auto-pass
check) vs enemy extra turn (`_beginEnemyExtraTurn`). Targeted effects are dispatched inside
the same loop by passing the area into the effect handlers (see R2). Likewise, collapse
`_doEnemySwap` and the custom-AI swap branch into one `_performEnemySwap(swap)`.
**Expected benefits:** One place for every future post-cast mechanic; the three historical
bug classes become structurally impossible to reintroduce; ~150 lines removed.
**Complexity:** Medium. Highest-risk extraction in this document — do it with manual
regression passes over: instant skill, targeted skill (+extra turn, the lock case), enemy
instant skill with extra turn (Cyclops Smash), custom-AI skill (Malakor chain), egg-phase
kill via each path.

---

### R2 — Turn `_resolveEffect` into an effect-handler registry; converge with `EffectResolver`

**Severity:** High
**Why it matters:** 23-case switch (§3.2) plus duplicated atomic-effect implementations
(M3). Effect types are the game's main content axis — this is the highest-traffic extension
point.
**Current issue:** Adding an effect means editing a giant switch; atomic effects that also
need a passive path get a second implementation in `EffectResolver` that must match by hand.
**Proposed architecture:** A `battle/SkillExecutor.js` module exporting a registry
`{ [effectType]: (effect, ctx) => {enteredCascade?: boolean} }` where `ctx` carries
`{controller, side, src, tgt, skill, targetArea?}`. Handlers are the current case bodies,
moved verbatim. Registry composition: atomic handlers are thin wrappers that delegate to
`EffectResolver.applyEffect` (making it the single implementation), board-touching handlers
call the existing `_execute*` methods. `_resolveEffect` becomes a 10-line lookup. Mirror the
existing `enemyAiOverrides.js` pattern so the codebase has one idiom for this.
**Expected benefits:** Adding an effect = one registration; atomic-effect drift eliminated;
`_resolveEffect`'s 360 lines become navigable per-effect files/sections; the synthesizer's
growing effect vocabulary (decision #40 added six at once) stops bloating the controller.
**Complexity:** Medium–Large (mechanical but wide; converge with `EffectResolver`
incrementally — start with `heal`/`armor`/`barrier`, which are the most drift-prone).

---

### R3 — Replace the seventeen one-shot flags with a typed battle-event queue

**Severity:** Medium (large extensibility payoff)
**Why it matters:** Every visual/SFX event currently costs five edits across two files (§6);
`getState()` and `updateFromController` are both dominated by this boilerplate; P1/P2 GC
churn is a side effect.
**Current issue:** Seventeen hand-rolled capture-and-clear fields (`extraTurnTriggerPos`,
`matchTextTriggers`, `shakeIntensity`, `skullDamageDealt`, `directDamageBySide`,
`turnAnnouncement`, `destroyedTiles`, `convertedTiles`, `pendingSkillSound`,
`floatingStatEvents`, `relicTriggers`, `harvestEvents`, `thrallSummoned`, `boardShuffled`,
`reflectTriggered`, `enemyTransformed`, `transformSfx`) with mirrored `if` blocks in the
scene.
**Proposed architecture:** One buffer: `this._events.push({type: 'skullDamage', …})` in the
controller; `drainEvents()` returns and swaps the array (one allocation per frame, none when
idle). The scene registers handlers in a `{ [type]: (ev) => … }` map (this becomes the seed
of `BattleEffectsDirector`, R8). Keep genuinely *stateful* snapshot fields
(`highlightCells`, `swapAnim`, `match4Flourish`, `targetingOverlayCells`, panes' state refs)
in `getState()` — the split rule is "events happened; state is". Migrate incrementally:
the queue can coexist with remaining flags during transition.
**Expected benefits:** New event = 2 edits instead of 5; ~120 lines of boilerplate deleted;
ordering between same-frame events becomes explicit (they're in one array) — today,
cross-buffer ordering (e.g. transform SFX vs destroyed-tile SFX) is implicit in the scene's
block order.
**Complexity:** Medium.

---

### R4 — Extract the status/poison engine

**Severity:** Medium
**Why it matters:** Statuses are a growing catalog (decision #32: "add a catalog entry +
teach BattleController how it behaves"). The "teach BattleController" half currently means
scattering checkpoints across the file.
**Current issue:** `_applyStatus`/`_removeStatus`/`_tickStatusesAtTurnStart`/
`_enforceStatusAttack` plus checkpoint queries (`_isSilenced`, `_canGainMana`,
`_canGainExtraTurn`) plus the damage-mod block inside `_applyDamage` plus the parallel
poison pool (`_applyPoison`/`_tickPoison`) are interleaved with turn logic. Per-status
behavior is encoded positionally (an `if (id === 'crippled')` here, a multiplier there).
**Proposed architecture:** `battle/StatusEngine.js` owning the status list operations, tick
lifecycle, and a per-status behavior table (`onApply`, `onExpire`, `onTurnStart`,
`modifyOutgoingDamage`, `modifyIncomingDamage`, plus capability flags `blocksSkills`,
`blocksMana`, `blocksExtraTurn`). `_applyDamage` asks the engine for its two modifier passes
instead of inlining brittle/intangible/berserk. Poison stays a distinct pool but lives in
the same module (it's the same domain: per-combatant afflictions with turn hooks).
**Expected benefits:** Adding a status becomes catalog entry + one behavior-table entry;
the damage pipeline gets shorter; the magic numbers in §5.2 get named homes.
**Complexity:** Medium.

---

### R5 — Extract the transform/egg phase and the passive board-effect handlers

**Severity:** Medium
**Why it matters:** The Phoenix/Egg machinery adds ten fields and hooks in six methods to a
controller that 95% of battles never use; the seven `_applyPassive*` handlers are ~470
self-contained lines.
**Current issue:** Boss-phase state (`_eggPhaseActive`, `_eggForcedExtraTurn`,
`_eggPhaseConfig`, `_enemyForms`, `_enemyTransformed`, `_pendingTransformSfx`,
`_deathTransformFiring`, `_isDormantEgg` on the enemy state…) is woven through
`_checkGameOver`, `_endTurn`, `_doEnemyTurn`, and `_applyTransform`. The next boss with a
phase mechanic will copy this weave.
**Proposed architecture:** `battle/TransformPhase.js` — a module holding the phase state
with named hook points the controller calls at its (already-identified) seams:
`onEnemyDeath()`, `onPlayerTurnEnd()`, `onEnemyTurnStart()`. Similarly move the
`_applyPassive*` family + `_addCellsToAnalysis` to `battle/PassiveBoardEffects.js`
(they already receive everything through parameters + a small controller surface). Neither
extraction changes behavior; both are file moves with an explicit interface.
**Expected benefits:** Controller shrinks ~600 lines; the "add a boss phase" recipe becomes
"implement the hook interface" instead of "find the six weave points"; passive board effects
get one home matching their §4.7 documentation.
**Complexity:** Medium (mostly mechanical).

---

### R6 — Extract targeting state + geometry

**Severity:** Low
**Why it matters:** Self-contained ~180 lines (`_targetingSkill`, `_targetHoverCell`,
`_targetingOverlayCells`, `_computeTargetingArea`/`_computeRowArea`/`_computeColumnArea`,
`_setDefaultTarget`) that pad the controller and would be reused by any future targeted
enemy skill or UI preview.
**Current issue:** Pure geometry (row/column/radius area math) lives beside turn logic;
the area shape is discriminated by scanning `skill.effects` for a column effect — a data
question answered structurally.
**Proposed architecture:** `battle/TargetingModel.js` with
`begin(skill)`, `hover(col,row)`, `area()`, `clear()`; area computation keyed off an explicit
`skill.areaShape` (derivable at catalog/synthesis time) instead of effect-scanning.
**Expected benefits:** Smaller controller; testable geometry; removes one hidden data
assumption.
**Complexity:** Small.

---

### R7 — BattleScene: modal stack for overlay input routing

**Severity:** High
**Why it matters:** Every input handler opens with the same hand-ordered overlay cascade;
adding the loadout overlay required edits in five handlers plus `update` plus
`renderForeground`. Priority order is duplicated and can silently diverge (it already
subtly differs: `_handleMouseDown` checks loadout → levelUp → reward → map, while
`_handleContextMenu` skips loadout).
**Current issue:** `_handleMouseDown/Move/Up/Wheel/KeyDown` each re-implement "which modal
eats this event"; `update()` re-derives `overlayActive` from four checks;
`renderForeground` re-lists them for the backdrop; `_renderCornerButtons` and
`_renderTargetingControls` re-list them again to self-gate.
**Proposed architecture:** The four overlays + MapView already share a near-uniform contract
(`isActive`, `handleMouseDown/Move/Up`, `handleWheel?`, `handleKeyDown?`,
`getBackdropAlpha`, `update`, `render`). Formalize it: a `ModalStack` that the scene consults
once per event (`if (modals.route('mousedown', x, y)) return;`), exposes
`anyActive()` for tooltip/corner-button gating, and renders backdrops+panels in stack order
in `renderForeground`. Per-modal quirks (level-up swallows keys, reward handles only ESC)
live in the modal, not the router.
**Expected benefits:** New overlay = one `modals.register(...)`; the five duplicated
cascades collapse; ordering bugs become impossible; `renderForeground` stops hardcoding the
list.
**Complexity:** Medium.

---

### R8 — BattleScene: extract an effects director (event → visual/SFX)

**Severity:** Medium
**Why it matters:** `updateFromController` (~240 lines) plus eight `_spawn*` methods plus
the damage-counter management form a coherent subsystem ("translate battle events into
juice") that has tripled in size across decisions #30, #41, #42 and will keep growing.
**Current issue:** Event handling, SFX triggering, effect construction, per-frame anchor
feeding (`setCenter`/`setTarget`/`resolving` on damage counters), and plain data binding
(panes, relic bars, combat log) are interleaved in one method.
**Proposed architecture:** `battle/BattleEffectsDirector.js` owning `_floatingEffects`,
`_particleEffects`, `_damageCounters`, the spawn methods, and (with R3) the event-handler
map. It exposes `handleEvents(events)`, `update(dt)`, `render(ctx)`,
`hasPendingDamageDelivery()` (the turn-gate predicate moves with it). The scene keeps pure
data binding (panes/bars/log/board visual state). Board-anchor math (`_cellToScreen`,
`_getBoardCenter`, `_getDamageCounterAnchor`) moves with it, taking the board as a
constructor dependency.
**Expected benefits:** BattleScene drops ~700 lines; the juice layer gets one home and can
be tuned/tested without touching layout or input; the hit-stop rule ("freeze everything but
the board") becomes one `director.setFrozen(bool)` instead of an early-return that must
enumerate what to skip.
**Complexity:** Medium.

---

### R9 — BattleScene: extract the post-battle / run-progression flow

**Severity:** High
**Why it matters:** Run progression (growth plans, victory counting, relic granting,
run-state sync, metrics, healing, scene routing) is game-flow logic in a UI class, split
across seven methods and two trigger moments, with defeat taking a third path. This is the
code a designer touches when changing meta-progression, and today it requires understanding
scene internals to modify safely.
**Current issue:** `update()`'s GAME_OVER branch → `_applyGrowthPlan` → `_showRewardOverlay`
→ (`_grantRelicReward` mid-overlay) → `_returnToMap` (which does winner determination,
metrics, `_onBattleComplete`, seed restore, `syncBattleResultsToRunState`, healing,
`setRunState`, fade). Plus the dormant level-up branch and deprecated `_applyVictoryGrowth`
interleaved. Defeat branches out of the same `update()` block to GameOverScene.
**Proposed architecture:** `ui/battle/PostBattleFlow.js` (or `game/RunProgression.js` for
the pure parts): a small orchestrator constructed with `{runState, characterDef,
battleController, sceneManager, metrics}` exposing `onGameOver(winner)`. It owns the
victory sequence (growth → reward overlay → grant → sync → heal → notify map → fade) and the
defeat route. The pure runState mutations (`applyGrowthPlan(runState, characterDef)`,
`grantRelic(runState, id)`) become standalone functions — trivially unit-testable and
reusable by any future non-battle reward source. BattleScene keeps only: detect GAME_OVER
after the delay, call `flow.onGameOver(...)`, render the overlays (via R7's stack).
**Expected benefits:** All "what persists after a battle" logic in one readable sequence;
the dormant level-up path can live there without polluting the scene; MapScene coupling
(`userData` fields, `setSeed`, `setRunState`) concentrates in one file; ~400 lines out of
the scene.
**Complexity:** Medium.

---

### R10 — Consolidate the extra-turn / turn-outcome flags

**Severity:** Medium–High
**Why it matters:** M5. The `_extraTurnEarned` / `pendingExtraTurn` / `_eggForcedExtraTurn`
/ `_resumeTurnAfterResolve` cluster plus the stale-flag scrub is the least-auditable logic
in the controller and its historical bug source. R1 reduces the *call sites*; this reduces
the *state*.
**Current issue:** Turn continuation is decided by reading several booleans set at different
times by different systems, with ordering constraints documented in decision #4 (e.g.
`extra_turn` effects must come after `create_tiles` because `_beginResolving` resets the
flag — a data-authoring rule caused by controller internals; the synthesizer even sorts
effects to comply).
**Proposed architecture:** A single `turnOutcome` value object owned by the controller and
resolved at exactly one point per action: accumulate *reasons*
(`{extraTurn: 'match4' | 'skill' | 'eggForced' | null, resume: boolean}`) during resolution
(never reset mid-action — removing the decision-#4 ordering trap), then one
`_resolveTurnOutcome(side)` function (called from `_finishResolving` and the R1 pipeline
epilogue) that maps outcome → next state, handling announcement suppression and enemy-gate
re-arming in one place. The `_completeTurnIntro` stale-flag scrub becomes unnecessary by
construction (the outcome object is created per action and consumed once).
**Expected benefits:** The invariant "a fresh turn never inherits an extra turn" becomes
structural; the create_tiles/extra_turn ordering constraint disappears (synthesizer
simplification too); egg-phase suppression stops being a boolean side-channel.
**Complexity:** Medium. Do after or with R1 — they touch the same lines.

---

### R11 — Harden `_cloneState` / `_transformInto` against silent field drops

**Severity:** Medium
**Why it matters:** M4 — the pattern already shipped the `allSkills` bug and the transform
path duplicates the risk.
**Current issue:** Two hand-maintained field lists must be updated for every new battle-state
field; forgetting one drops data with no error.
**Proposed architecture:** Define battle-state shape once:
`const BATTLE_STATE_DEFAULTS = { block: 0, barrier: 0, poison: 0, mark: 0, statuses: [], … }`
plus a declarative clone spec (which source fields copy, which deep-clone, which reset).
`_cloneState` and `_transformInto` both consume the spec (transform = clone-onto-existing
preserving a small "kept" list: `mana`). Optionally a dev-mode assertion that no unexpected
own-fields exist on incoming data.
**Expected benefits:** One place to add a field; transform stays automatically in sync with
clone; the documented pitfall in decision #21 is retired.
**Complexity:** Small.

---

### R12 — Centralize state transitions

**Severity:** Low
**Why it matters:** `this.state = …` appears in ~15 places; `onStateChange` fires from some
transitions and not others; debugging "why did we enter X" requires breakpoints on a field
write.
**Current issue:** No single transition point; inconsistent change notification.
**Proposed architecture:** `_setState(next, reason?)` — assigns, optionally logs under a
debug flag, always fires `onStateChange`. Purely mechanical substitution.
**Expected benefits:** One tracing point for the whole battle flow; consistent callbacks.
**Complexity:** Small.

---

### R13 — Public API instead of private access (scene ↔ manager ↔ controller)

**Severity:** Medium
**Why it matters:** M8 — ~25 private-member accesses make three classes rigid together.
**Current issue:** `sm._scenes['MapScene']`, `sm._input`, `sm._app`,
`controller._winner()`, `controller._checkGameOver()`, `controller._targetingSkill`,
`mapScene._mapView`.
**Proposed architecture:** Add `SceneManager.getScene(name)` / `.input` / `.app` getters;
`BattleController.getWinner()`, `debugForceWin()`, `setPlayerLoadout(ids)`; read
`targetingSkill` from the existing snapshot. Mechanical rename pass.
**Expected benefits:** SceneManager/controller internals become changeable; the intentional
integration points become visible in the public surface.
**Complexity:** Small.

---

### R14 — Quarantine dormant code; delete dead code

**Severity:** Low
**Why it matters:** §5.3 — reading cost and false paths.
**Current issue:** Dormant level-up flow, deprecated `_applyVictoryGrowth`, no-op
`_applyPostBattleHealing`, disabled attack-anim POC + tuner (~250 lines), drifted legacy
music branch, hidden `_turnLabel`; dead `screenToBoard`; misplaced JSDoc blocks; misleading
`_rewardOverlayShown` name.
**Proposed architecture:** Delete what git history preserves (`_applyVictoryGrowth`,
`screenToBoard` and `enterTargeting` (both confirmed caller-less), the legacy music path if
`ENABLE_PERSISTENT_BATTLE_MUSIC` is considered permanent); move the dormant level-up flow
into R9's PostBattleFlow; keep the attack-anim POC but hoist it plus its tuner into its own
small module the scene calls at three points (spawn/update/render) — it already has that
shape. Fix the two stray doc blocks and the rename.
**Expected benefits:** BattleScene loses ~350 lines of non-live code; the victory path reads
as one branch instead of three eras.
**Complexity:** Small.

---

### R15 — Name the remaining magic numbers

**Severity:** Low
**Why it matters:** §5.2. Both files otherwise set a high bar with named tunables.
**Current issue:** Inline `1.5` (brittle), `2` (berserk ×2 twice), `Math.min(dmg, 1)`
(intangible), `0.20` (shake), `/ 2` (poison decay), `2` (mark default, lock minimum),
`counter drag threshold 0.33`, damage-counter shake formula `7 + 13 * intensity`.
**Proposed architecture:** Top-of-file constants beside their siblings
(`STATUS_DAMAGE_MODS = { brittleMult: 1.5, intangibleCap: 1, berserkMult: 2 }`,
`POISON_DECAY_DIVISOR = 2`, `SHAKE_FULL_AT_HP_FRACTION = 0.20`, …). Folds into R4 for the
status ones.
**Expected benefits:** Balance tuning without code archaeology; consistent with house style.
**Complexity:** Small.

---

## 8. Future Opportunities (not worth doing now)

| Idea | Sketch | Trigger to act |
|---|---|---|
| **Seeded battle RNG** | Inject a `SeededRNG` (already exists in MapGenerator) into BattleController/BoardModel instead of `Math.random()`. Enables deterministic replays, reproducible bug reports, and headless tests. | When automated controller tests are wanted (M7), or when a bug report can't be reproduced. |
| **Headless controller tests** | With R1/R2 + seeded RNG, the controller runs without a canvas: construct with fixture data, drive `update(dt)` with fixed steps, assert on `getState()`/events. Would have caught all three extra-turn bugs. Note: per project instructions the stale `sim/` suites should not be extended — this would be a fresh, minimal harness. | After R1 lands (test the new pipeline as it's built). |
| **Command/event-sourced battle log** | If events (R3) also capture *inputs* (swaps, casts), a battle becomes a replayable command stream — free debugging, kill-cam, and balance telemetry richer than `_recordBattleMetrics`. | If replay/spectate or deep telemetry becomes a feature. |
| **Async action sequencing** | The controller currently simulates sequencing with timers, deferred queues (`_pendingSkullDestroy`), resume flags, and delay extension (`_extraEnemyTurnDelay`). A promise/coroutine-based action queue ("await presentation-done") would subsume the turn gate, the harvest delay, and the two-phase TURN_INTRO. Decision #30 explicitly deferred this — agreed; it's a big machine change. Revisit if 2–3 more "wait for the animation" mechanics accumulate. | The next time a mechanic needs mid-action presentation gating. |
| **Scene-service injection** | `main.js` already builds all services; passing `{input, app, audio, assets}` to scenes at registration (instead of scenes pulling from `sceneManager._x`) would make every scene testable in isolation. Pairs with R13. | Any broader scene-framework work. |
| **Snapshot/DTO boundary for `getState()`** | If a second consumer of battle state appears (spectator UI, AI trainer, network), replace live references with a read-only view. Not worth the copying cost today. | A second consumer. |
| **Data-driven side count** | The `'player' | 'enemy'` string duality is baked in ~60 places. If multi-enemy or ally mechanics ever appear this becomes a rewrite; an early `opponentOf()` util (§3.3) at least concentrates the assumption. | Only if the design ever calls for >2 combatants. |

---

## 9. Positive Findings (preserve these)

1. **Logic/rendering separation held under pressure.** Through ~12 major feature additions
   (statuses, poison, weave effects, transforms, hit-stop, damage counters) the controller
   still imports zero UI and the scene mutates almost no logic. The one-shot flag channel is
   the reason — R3 upgrades it, but its *contract* (read-and-clear, exactly-once) is right.
2. **The single damage chokepoint** (`_applyDamage`, rule #19) — mark, reflect, brittle,
   intangible, berserk, barrier, and sticky-death all compose correctly because there is
   exactly one door. Any refactor must keep this property.
3. **Data-driven passives with zero relic conditionals.** `PassiveSystem` dispatch +
   `_handlePassiveBoardEffect`'s typed handlers mean new relics are catalog entries. The
   guard flags are the only place relic *names* leaked in (see §5.4 renames).
4. **The turn-gate predicate** (`setTurnGate`) is textbook dependency inversion with a
   safety cap — the controller waits on presentation without knowing about it, and a stuck
   animation cannot deadlock the battle. The right template for M2.
5. **Defensive state hygiene:** `_cloneState`'s deep-clone of relics/effects (catalog
   protection), delta-based `_recomputeDynamicAttack` (composes with permanent gains),
   sticky `_defeated` (lethal-then-heal can't flip a result), re-entrancy guards on echo /
   reflect / death-transform / mana-gain depth, and the stale-flag scrub — each encodes a
   learned lesson, in comments, at the site.
6. **Comment quality.** Non-obvious blocks explain *why* and cite the bug they prevent
   ("the 'casts in a different area' bug", "the enemy would never act again and freeze the
   battle"). This is the main reason a 3,800-line file is still navigable, and the standard
   any extracted modules should keep.
7. **Uniform external-effect contract** (`update(dt)` / `render(ctx)` / `done`) across all
   nine effect classes lets the scene manage a heterogeneous pool with one loop — R8 can
   build directly on it.
8. **Near-uniform modal contract** across the four overlays — R7 is cheap precisely because
   this convention already exists.
9. **Tunables as named constants** at the top of both files (layout, timing, feel) — the
   handful of stragglers in R15 are the exception, not the rule.
10. **Mobile-conscious effect engineering** (documented no-`shadowBlur`, sprite-baked glows,
    zero-allocation path walking in ManaStreamEffect) — evidence the per-frame allocation
    notes in §2 will be taken seriously where it matters.

---

## Suggested sequencing

1. **Quick pass (Small items, ~1 day total):** R11, R12, R13, R14, R15 + the §2 cheap wins.
   Low risk, immediately shrinks and de-risks both files.
2. **Controller core (do together):** R1 → R10 → R2. This is the bug-prone heart; test each
   skill path manually per the R1 checklist.
3. **Event channel:** R3 (controller side) then R8 (scene side consumes it).
4. **Scene structure:** R7, R9.
5. **Cohesion moves whenever convenient:** R4, R5, R6 — mechanical extractions that can ride
   along with feature work in their areas.

Each step leaves the game shippable; none requires a big-bang rewrite.
