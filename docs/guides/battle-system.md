# Battle System

**Load this when:** editing battle logic — skill effects, turn flow, damage, cascade phases, extra turns, passives/triggers, or the board AI (simulation, move ranking, hint/formula policy).

> Before EDITING BattleController, also load [`.claude/skills/battlecontroller/SKILL.md`](../../.claude/skills/battlecontroller/SKILL.md) (invariants + recipes + verification harness).

---

## Ownership

### [`src/js/game/BattleController.js`](../../src/js/game/BattleController.js) — `BattleController`

**Top-level orchestrator.** Turn state machine (TURN_INTRO → PLAYER_TURN ↔ ENEMY_TURN → RESOLVING → GAME_OVER), swap initiation, skill resolution, cascade phases, enemy turn delegation. **Single skill-cast pipeline (2026-07 rework — decision #43):** EVERY skill cast (player instant, player targeted, enemy standard-AI, enemy custom-AI) runs through `_castSkill(side, skill, {targetCol?, targetRow?, targetArea?})`; the post-cast sequence (game-over check → pending skull-destroy drain → extra-turn routing with per-side rules → end turn) exists ONLY in its epilogue `_finishInstantAction(side)` (cascade-entering casts finish via `_finishResolving`). `_resolveEffect` is a thin lookup into the [`battle/skillEffectHandlers.js`](../../src/js/game/battle/skillEffectHandlers.js) registry. All state transitions go through `_setState(next)` (fires `onStateChange` consistently). `_extraTurnEarned` is ACTION-scoped: never reset mid-action (`_beginResolving` doesn't clear it), consumed once at the epilogue, scrubbed at every fresh turn intro. **Player hint API (upgraded 2026-07-08, decision #45):** `getSuggestedAction(options?)` — the PRIMARY hint: best full ACTION (cast — with best target — or swap) from the champion FORMULA POLICY ([`ai/formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js)) run through a tiny battle FACADE (`_makeHintFacade`: live board ref + combatant snapshots mapping `_attackPerManaRules`→`dynAtkRules`); `_describeSuggestedAction` adds `targetCells` (the cells a targeted cast would hit) + a human `description` built from the refill-off settle (guaranteed lower bound — never over-promises). Pass champion weights via `options.weights` ([`ai/hintWeights.js`](../../src/js/game/ai/hintWeights.js)); no weights → strong defaults. On-demand only, never per frame. The older `getSuggestedMove(options?)` / `getRankedMoves(options?)` [`MoveAdvisor`](../../src/js/game/MoveAdvisor.js) queries remain — `getSuggestedMove` still drives the idle board GLINT (its own per-turn cache), just not the "?"/'h' hint. Exports `opponentOf(side)`. **Mid-battle enemy transform** (Sanguine Phoenix ⇄ Egg, decision #37): `_transformInto(id)` swaps the enemy identity IN PLACE (keep mana, full HP, new name/portrait/skills/relics) from a pre-resolved `_enemyForms` map (MapScene-supplied); `_applyTransform` (onDeath `transform` board effect) drives Phoenix death→Egg and starts the TURN-BASED egg phase — the Egg is a NORMAL, killable low-HP (floor-scaled) enemy and the player KEEPS the turn (forced hidden extra turn) to slay it: slay it → victory (normal enemy-death path) / `_resolveEggPhaseAtTurnEnd` (player's turn end with the Egg still alive → revert to a full-life Phoenix); one-shot `enemyTransformed` state signals the scene to rebuild the enemy pane.

### [`src/js/game/BoardModel.js`](../../src/js/game/BoardModel.js) — `BoardModel`

**Pure data.** 8×8 grid, swap, gravity, refill, **wild-aware match detection** (simple runs + Union-Find connected shapes; `_scanLineRuns` lets a wild **Thrall** tile substitute for any concrete color/skull type per line, but never for an inert Disease tile; **Fungal** tiles join the GREEN scan class as concrete members — they match with Green or each other, emitted as green matches; see decision #46), clone, valid-move enumeration, tile conversion, `positionCreatesMatch()` (safe-spawn check used for Thralls), `shuffle()` (permutes every tile into a fresh NO-MATCH arrangement preserving the tile multiset — used by the SHUFFLE skill effect)

### [`src/js/game/MatchResolver.js`](../../src/js/game/MatchResolver.js) — `MatchResolver`

**Pure logic.** Match analysis (returns MatchAnalysis, does NOT modify board), damage application (armor→block→HP), skill effect type constants, skull damage formulas (matched vs destroyed), shared tile reward computation. **Match crediting is PER-TILE** (2026-07-18, decision #55): a wild can complete several overlapping runs at once (two colors, or a color + a skull run), so `analyzeMatches` credits each board position exactly once — to the first match containing it in scan order; mana and skull damage are computed from that deduped credit, while the RAW run size (`match.count`) still drives the 4+ extra-turn checks. Inert (Disease) matches never claim a shared tile's credit (they'd award nothing for it).

### [`src/js/game/battle/skillEffectHandlers.js`](../../src/js/game/battle/skillEffectHandlers.js) — (module)

**Skill-effect handler REGISTRY** (decision #43). Plain object `SKILL_EFFECT_HANDLERS` keyed by `SKILL_EFFECT_TYPES` value → `(effect, ctx) => enteredCascade` (same idiom as enemyAiOverrides). `ctx` = `{ c: BattleController, skill, side, oppSide, src, tgt, enteredResolving() }` — handlers are an extension of the controller and use its private surface. **Adding a skill effect type = one registration here** (+ the constant in MatchResolver). Pure-atomic effects shared with the relic path (armor/barrier/heal/gain_attack/gain_magic) DELEGATE to `EffectResolver.applyEffect` so their math has exactly ONE implementation; effects needing controller plumbing (damage chokepoint, mana-gain dispatch, cascade executors) keep their bodies here. Also exports `MARK_DEFAULT_MULT` / `LOCK_MIN_TURNS`.

### [`src/js/game/BoardSimulator.js`](../../src/js/game/BoardSimulator.js) — (module)

**Pure headless cascade PREDICTION** (no rendering, no battle-state mutation — operates on `BoardModel.clone()`s with real MatchResolver logic, so wilds/locks/inert/skull-scaling behave exactly as in battle). `simulateSwap(board, swap, attacker, {samples})` → `{ guaranteed, expected, settledBoard }`: **guaranteed** = deterministic outcome (existing tiles falling, refill OFF — certain regardless of RNG); **expected** = Monte-Carlo averaged full resolutions (refill ON with the board's effective spawn weights; `extraTurnChance` = fraction of samples). `enumerateMoves(board, attacker, opts)` maps every legal swap. `resolveBoardInPlace(sim, attacker, refill)` is the core loop. On-demand cost (hundreds of sims per full enumeration) — never per frame. Consumers: MoveAdvisor, any future swap-preview UI.

### [`src/js/game/MoveAdvisor.js`](../../src/js/game/MoveAdvisor.js) — (module)

**General side-agnostic move-ranking AI** on top of BoardSimulator (usable by ANY enemy or as player hints — deliberately wired to nothing by default). `rankMoves({board, self, opponent?, weights?, samples?, lookahead?})` scores every legal swap: extra turns (guaranteed + refill-chance), skull damage (+ certainty premium + dominant `lethal` bonus vs hp+armor+barrier+block), mana toward the mover's still-NEEDED skill colors (`remainingSkillNeeds`), skill-becomes-castable bonus, DENIAL of the opponent's needed colors, cascade depth, and a **1-ply opponent-reply lookahead** via `bestOpponentReplyValue` on the deterministic `settledBoard` (their best guaranteed skull damage / 4+ extra-turn setup / mana, + a `replyLethal` mega-penalty if their reply would kill the mover). The lookahead is **lazy-converged leader-first** — the current #1 is evaluated and the list re-sorted until the leader carries its penalty — so the returned best move ALWAYS accounts for the opponent's reply (a pre-penalty top-K pass let unevaluated moves float to #1, the "hint set up the enemy's 4+" bug). Moves that keep the turn get the penalty at the reduced `replyAfterExtraTurnFactor`. **`DEFAULT_WEIGHTS` is the whole tunable personality** — the "training" surface; per-call partial overrides supported. `getBestMove(ctx)` returns the top entry with a per-objective `breakdown`. Entry points: `BattleController.getSuggestedMove/getRankedMoves` (player hints) + the `smart_matcher` aiBehavior override (enemies).

### [`src/js/game/ai/formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js) — (module)

**The champion FORMULA POLICY (promoted 2026-07-08 from `sim/toolbench/formula.mjs`, which is now a re-export shim — ONE source of truth, the enemyScaling pattern).** Deterministic trained evaluator: `makeFormulaPolicy(weights, {chainDepth})` → `(battle, c) => {type:'cast',skill,target?}\|{type:'swap',swap}\|null`; exports `settleBoard` (refill-off cascade settle), `targetPositions` (row/column/area cells — feeds the hint UI's target ghost), `DEFAULT_FORMULA_WEIGHTS`/`FORMULA_WEIGHT_KEYS`/`loadFormulaWeights`, `CHAMPION_WEIGHTS_PATH` (→ `src/assets/data/formula-champion.json`). BROWSER-SAFE (no node: imports — guarded by `sim/toolbench/browser-safe-check.mjs`). Input seam = a minimal "battle" `{ board, p, e, other(), canAfford(), _hasStatus() }` (see the file's INPUT CONTRACT header) — satisfied natively by the sim engine's Battle and by `BattleController._makeHintFacade`. Consumers: the in-game hint system + the ENTIRE toolbench (trainer/train/runs/bench Hard AI).

### [`src/js/game/ai/hintWeights.js`](../../src/js/game/ai/hintWeights.js) — (module)

`loadHintWeights()` — module-cached browser fetch of the champion weights JSON (via `CHAMPION_WEIGHTS_PATH`), validated through `loadFormulaWeights`; resolves `{}` on any failure so hints fall back to `DEFAULT_FORMULA_WEIGHTS`. Kicked in `BattleScene.onEnter`.

### [`src/js/game/TileTypes.js`](../../src/js/game/TileTypes.js) — (module)

Tile type definitions (RED/BLUE/GREEN/YELLOW/PURPLE/SKULL), spawn weights, constants (BOARD_COLS=8, BOARD_ROWS=8), helpers (isSkull, getRandomTileType)

### [`src/js/game/CombatLog.js`](../../src/js/game/CombatLog.js) — `CombatLog`

Ring buffer for combat messages, turn counter

### [`src/js/game/EnemyAI.js`](../../src/js/game/EnemyAI.js) — `EnemyAI`

Enemy decision: skill-first (damage preferred), then board evaluation with priority scoring (4+ match > skull damage > skill mana > contest player mana)

### [`src/js/game/customEnemyAi.js`](../../src/js/game/customEnemyAi.js) — (module)

**AI override dispatch.** Exports `chooseEnemyAction(enemyState, context)` and `getEnemyAiHandler(aiBehavior)`. Tries custom AI first; falls back to standard EnemyAI. Used by BattleController._doEnemyTurn().

### [`src/js/game/enemyAiOverrides.js`](../../src/js/game/enemyAiOverrides.js) — (module)

**Custom AI registry.** Plain object keyed by `aiBehavior` string → handler function. Handlers receive `{ enemy, player, board, battleState, standardAI }` and return `{ action, skill?, swap? }` or `null` (fall back to standard AI). Add new enemy behaviors here. Implemented: **`goblin_sapper`** — casts Boom Baby! then Ignition when affordable, otherwise ranks swaps by a custom tiered scorer (4+ > yellow > red > skull > anything else) that deliberately demotes skulls, unlike the standard AI. **`chokeweed`** — only ever casts its free `encroach` skill (gain +1 attack, end turn); returns null to fall back to standard AI if encroach is unavailable. **`malakor`** (Act 1 boss, Lord Malakor) — every skill grants an extra turn and his Heart of the Usurper relic feeds him 2 of every mana per turn start, so he chains casts down a strict priority Desecrate (3 purple, needs Green on board) > Harvest (3 yellow, needs Skulls on board) > Soul Burn (3 blue) > Exsanguinate (3 red); otherwise ranks swaps by `scoreMalakorBoard` (4+ > skulls > purple > the Yellow/Blue/Red color it's CLOSEST to its cost, weighted by current mana — Green demoted since Green mana is useless to him). **`smart_matcher`** (GENERAL, not enemy-specific — **registered but referenced by NO enemy yet**): simulation-based swap ranking via [`MoveAdvisor`](../../src/js/game/MoveAdvisor.js)/[`BoardSimulator`](../../src/js/game/BoardSimulator.js); skill decisions stay with the standard AI (defers via null when a skill is castable — it only upgrades the SWAP choice). To give any enemy the smarter matching, set `aiBehavior: 'smart_matcher'` on its def.

### [`src/js/systems/TriggerTypes.js`](../../src/js/systems/TriggerTypes.js) — (module)

**Passive trigger constants.** Canonical list of trigger event names (`onTileMatch`, `onTileMatchType`, `onMatch4Plus`, `onGainMana`, `onTileCreated`, `onTurnStart`, `onTurnEnd`, `onIncomingDamage`, `onTakeDamage`, `onDealDamage`, `onDeath`) with documented payload conventions. **`onDeath`** (payload `{ side }`) fires when a combatant reaches 0 HP, dispatched from [`BattleController._checkGameOver`](../../src/js/game/BattleController.js) (`_tryEnemyDeathTransform`) BEFORE victory is declared; a relic may transform/revive the owner (the Sanguine Phoenix's `sanguine_egg` relic → Egg form) so that if the owner is no longer dead after dispatch the battle continues. Re-entry guarded (`_deathTransformFiring`). See decision #37. `onTileCreated` (payload `{ side, typeId, count }`) fires once per tile placed on the board by an EFFECT (not natural matches/refill) — today Infected Tooth's `create_tiles` board passive dispatches it per Disease tile so Severed Maxilla (`condition:{typeId:'disease'}` `gain_attack`) gains +1 attack per tile. `onGainMana` (payload `{ side, color, amount }`) fires once per color per in-battle mana-gain event: cascade match rewards (`_doRemove`), skill tile destruction (`_executeDestroyTiles`), AND relic-granted mana (Familiars/Family Crest/Prism — via `EffectResolver.gain_mana` → the PassiveSystem `onGainMana` callback) — so reactor relics (Flaming Arrow/Water Balloon/Thorned Branch/Static Comb/Tuning Rod) deal damage on gaining a specific color regardless of the mana's source. One-time starting mana / Potion grants (`grant_starting_mana`) do NOT fire it. Relic-triggered dispatches are depth-guarded (`BattleController._manaGainDepth`) against loops.

### [`src/js/systems/EffectResolver.js`](../../src/js/systems/EffectResolver.js) — (module)

**Shared atomic-effect resolver.** `applyEffect(effect, ctx)` handles `damage`, `armor`, `heal`, `gain_mana`, `drain_mana` (removes mana from `ctx.target`/opponent — caster does not gain it), `gain_attack` (permanent `caster.attack += amount` — Tsunami/Reckoning/Scythe), `extra_turn`, `reduce_damage` for both skill and passive effects. Returns false on unrecognized effect types so callers can fall back. **Damage scaling:** a `damage` effect may carry an opt-in `scaling` field (preset name like `'magic'`/`'physical'`, or inline `{ attack, magic }`) — the floored Attack/Magic bonus from the effect OWNER is added on top of the flat `amount` via [`scalingConfig.scaledAmount`](../../src/js/data/scalingConfig.js) (BattleController's skill `damage` case does the same via `scaledBonus`). No `scaling` field → flat. See decision #34. Fires optional host callbacks for visual feedback: `onDamage` (carries `caster`/`target` refs — BattleController uses them to dispatch onTakeDamage/onDealDamage + screen shake), and `onStatChange` ({ kind:'heal'\|'armor', target, amount } — BattleController turns these into floating "+x" portrait text). Board-touching effects stay in BattleController.

### [`src/js/systems/PassiveSystem.js`](../../src/js/systems/PassiveSystem.js) — `PassiveSystem`

**Passive ability dispatcher.** `dispatch(triggerName, payload)` looks up the relics on `payload.side`, finds effects whose `trigger` matches, and resolves them via EffectResolver; a SECOND pass consults the OPPOSITE side's relics for effects flagged **`anySide: true`** (react to the opponent's events too — Vampiric Roots' "whenever ANYONE matches Green"; ctx.caster stays the relic owner; keep anySide effects atomic — see decision #46). An effect may carry an optional `condition: { typeId?, minCount?, color?, side?, isSkull? }` payload gate (checked by `_passesCondition`; `isSkull` gates damage triggers on skull-sourced hits — Bone Armor's retaliation, decision #50) so it only fires for specific matches/events — e.g. Scythe reacts only to skull matches of 3+ on `onTileMatchType`; the mana-gain reactor relics gate on `condition.color` against the `onGainMana` payload color; `condition.side` narrows an `anySide` effect back to one actor (decision #47). **`condition.everyN` is the one STATEFUL gate** — handled in the dispatch loop (NOT `_passesCondition`, which stays pure): each event that passes the payload gates advances a counter on the per-battle effect clone (`_everyNCounter`); the effect fires only on the Nth event, then the counter resets (Hourglass: `extra_turn` every 10 `onTileMatchType` events; RelicBar shows the live count as an icon badge — decision #49). Non-firing increments don't count as "fired" (no `onRelicTrigger` jiggle). Board-touching effects that EffectResolver doesn't recognize are forwarded to `ctx.onBoardEffect(effect, triggerName, payload, ctx)` so the host (BattleController) can mutate the cascade state. Owned by BattleController; instantiated once per battle. No per-relic code lives here — adding a new relic is purely data. Fires an optional `onRelicTrigger(relicId, side)` callback once per relic per dispatch when any of its effects actually fire, so the host can animate the icon (relic jiggle).

---

## State machine

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

Phase lengths = `BASE_PHASE_MS[phase] / speedMultiplier` (`_phaseMs`). The controller
exposes **`getFallDurationMs()`** so the board VIEW syncs its fall animation to the
real FALL phase — view animations mirroring a controller phase must derive their
duration from the controller, never carry a local copy (decision #57).

---

## Flows

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
     → handles skillCastEvents (mana-drain wisps, spent-card ghost, enemy cast
       showcase, spell-projectile damage carrier) BEFORE floatingStatEvents —
       'skull'/'skill'-sourced damage defers into its carrier and is delivered
       (counter tick, recoil, flash, directional shake, vignette) at arrival
       (decision #59); sourceless damage counts immediately
     → plays SFX (turn announcement, extra turn, skull damage, skill sound, tile destroy)
     → manages music transitions on state change
  → on GAME_OVER (victory): delay → LevelUpOverlay.show()  (mandatory attribute pick)
     → Battle scene remains visible behind overlay; all battle input blocked
     → click a card → _applyLevelUp(key) (applyRunModifier: +1 Attack / +1 Magic /
       +6 Max HP per LEVEL_UP_GROWTH; bumps runState.victories) → onDismiss → _showRewardOverlay()
  → RewardOverlay.show()  (Choose a Relic; ESC/Skip = no relic)
     → reward pick / skip → _returnToMap():
        → syncBattleResultsToRunState(runState, playerState)
        → _applyPostBattleHealing(runState, playerState)   (no auto-growth — the Level Up screen replaces it)
        → _onBattleComplete({result, nodeId})
        → MapScene._handleBattleComplete() sets flag
        → fadeToScene('MapScene')
  (defeat: no overlays → fadeToScene('GameOverScene'))
```

### Skill Resolution Flow
```
Player clicks skill → CharacterPane.onSkillClick → BattleController.tryPlayerSkill(skill)

1. If board_tile targeting: enter TARGETING state (seeds a default center target)
   → DESKTOP: hover previews the area; CLICK a tile → tryTargetTile (instant cast). Centered Cancel button only.
   → TOUCH: tap/drag a tile: setTargetHover → preview area (does NOT cast); Cast button / Enter → confirmTarget → tryTargetTile
   → both: Cancel button / ESC / right-click: cancelTargeting

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

## Constants & effect types

### `BattleState` — [`BattleController.js:18`](../../src/js/game/BattleController.js)

PLAYER_TURN, ENEMY_TURN, RESOLVING, SWAPPING, TURN_INTRO, TARGETING, GAME_OVER

### `BOARD_COLS / BOARD_ROWS` — [`TileTypes.js:33`](../../src/js/game/TileTypes.js)

8 / 8

### `MANA_COLORS` — [`TileTypes.js:21`](../../src/js/game/TileTypes.js)

['red', 'blue', 'green', 'yellow', 'purple']

### `SKILL_EFFECT_TYPES` — [`MatchResolver.js:23`](../../src/js/game/MatchResolver.js)

damage (optional `damage.perSkull` adds N × the board's Skull count at cast, woven by `skull + damage`; optional `damage.perArmor` adds N × the CASTER's current armor at cast — armor is read, NOT consumed (contrast `consume`) — the Marrow Sentry's Deadstop), armor, barrier (a one-round MAGIC shield — payload `barrier: { amount, scaling? }`; adds to the caster's `state.barrier` pool which absorbs damage like armor in `MatchResolver.applyDamage` (barrier → armor → block → HP) but expires at the caster's next turn start; scales with Magic at `_66` ×2/3 by default; resolved in EffectResolver + BattleController._resolveEffect; the woven `barrier` action tag; see decision #38), destroy_tiles, destroy_tiles_row, destroy_tiles_column (column mirror of row — numeric `area` = column count; targeting routed by effect type in `_computeTargetingArea` → `_computeColumnArea`; synthesized "destroy + column" skills), create_tiles, convert_tile, convert_tiles_by_type, destroy_tiles_by_type (destroy tiles of a type board-wide — payload `destroyByType: { type, amount? }`; omit `amount` = ALL of that type, set = up to N random ones; routes through the shared destroy/cascade path; woven by `skull + destroy` (N Skulls) and `destroy + all + color` (wipe a color)), heal, gain_max_hp (permanently raise the caster's maxHp WITHOUT healing — payload `gainMaxHp: { amount }`; pair with a `heal` to fill it, e.g. the Sanguine Phoenix's Blood Gorge), extra_turn, gain_attack (permanent caster attack +amount, e.g. Encroach), gain_magic (permanent caster MAGIC +amount — payload `gainMagic: { amount }`; counterpart to gain_attack, the woven `magic` tag; resolved in EffectResolver + BattleController._resolveEffect), self_destruct (caster hp→0, ends battle on next `_checkGameOver`), drain_mana (remove `amount` of one/every mana color from the OPPONENT — Soul Burn), gain_mana (grant the CASTER mana — payload `gainMana: { color, amount }`; Enfeeble-gated, fires onGainMana so reactor relics see it; emitted by the synthesizer's orphan-`random` mana-surge injection), apply_status (apply a named buff/debuff from [`statusEffects.js`](../../src/js/data/statusEffects.js) to self/opponent for N turn cycles — payload `applyStatus: { id, target:'self'\|'opponent', turns, attackValue? }`; resolved via `_applyStatus`; see decision #32), silence (legacy alias → `apply_status` 'silenced'), set_attack (legacy alias → `apply_status` 'crippled' with `attackValue` — Exsanguinate), shuffle (randomize the whole board into a fresh no-match layout via `BoardModel.shuffle()` → `_executeShuffle`; non-cascade, synthesized "shuffle" skills, always paired with extra_turn; BattleScene plays a fly-in via `BoardPlaceholder.playShuffleAnimation()` off the one-shot `boardShuffled` state flag), apply_poison (apply POISON stacks to the opponent — payload `poison: { amount, scaling?, target?, perSkull? }`; application scales with the caster's stat at a LOW rate (Poison Dart: Magic `_25`; woven `poison` tag: rolled preset halved — the decay tail already ≈ doubles each stack), `perSkull` adds +N stacks per board Skull (woven `skull + poison`, capped at +1), the per-tick damage is flat = stack count; resolved in `_resolveEffect` (skill) + `_handlePassiveBoardEffect` (relic, e.g. Poison Vial which applies `requireSkull` poison = floor(half the damage dealt)); ticks at the applier's turn end (absorbed by barrier→armor→block, NOT armor-piercing) then halves — see decision #39)

### `TILE_TYPES` — [`TileTypes.js:11`](../../src/js/game/TileTypes.js)

RED, BLUE, GREEN, YELLOW, PURPLE, SKULL, DISEASE, WILD, THRALL, SANGUINE_EGG, FUNGAL_2, FUNGAL_1 — each with id, isSkull, color, particleColor, spawnWeight. **FUNGAL_2/FUNGAL_1** (`isFungal: true` + `isInert: true` + `spawnWeight: 0`, `fungalTimer` 2/1, both drawn with the `green_blight_tile` art via `tile_fungal_*` aliases) are the Blight Warden's TIMED, GREEN-AFFINE tiles — the remaining turn timer IS the type id; they match with Green or each other (emitted as GREEN matches) and explode into a Skull + spread when expired (decision #46). **DISEASE** is `isInert: true` + `spawnWeight: 0`: it never spawns naturally (placed only by effects, e.g. Infected Tooth), is neither mana nor skull, and matching/destroying it awards no mana/skull damage (MatchResolver skips inert tiles for those), though a 4+ inert match still grants an extra turn. **WILD and THRALL** are both `isWild: true` + `spawnWeight: 0`: placed only by effects, they never spawn naturally and act as **match-anything jokers** — in `BoardModel._scanLineRuns` a wild substitutes for any concrete color/skull type it lines up beside (Red+Wild+Red = Red match), but NOT for inert Disease tiles; a wild match resolves to the concrete type (awards that color's mana / skull damage), while a wild destroyed WITHOUT a host (raw destroy) awards nothing. The three differ only in ART + provenance: **WILD** (`wild_tile` sprite) is the STANDARD wild every generic effect uses (player-woven "wild" skills), **THRALL** (`thrall_tile`) is Lord Malakor's variant (Baron's Signet seeds them, Usurper's Heart harvests specifically `type:'thrall'`), **SANGUINE_EGG** (`tile_sanguine_egg`, aliased to the `phoenix_egg_tile` sheet sprite) is a now-UNUSED leftover of the Phoenix's old tile minigame — the Sanguine Egg phase is now damage-based (slay the Egg enemy in one turn), so no egg tiles spawn anymore (the type + art stay registered but inert — see decision #37). All wild tiles get the `wild_tile_border` overlay (BoardPlaceholder keys it off `isWild`); fungal tiles get a turns-remaining number badge (`isFungal` + `fungalTimer`). Helpers: `isInert(typeId)`, `isWild(typeId)`, `isFungal(typeId)`, `fungalTimer(typeId)`, and `isMana(typeId)` excludes inert (incl. fungal) and wild.

---

## Design decisions

| # | Decision | Hook |
|---|----------|------|
| [#1](../decisions/01-skills-use-effects-array-only.md) | Skills use `effects: []` array only | Every skill effect is `{ effectType, ... }` — no other skill resolution mechanism exists. |
| [#2](../decisions/02-skill-sound-is-on-the-skill-definition.md) | Skill sound is on the skill definition | `.sound` on the skill (not per effect), played once via `_pendingSkillSound`. |
| [#3](../decisions/03-tile-destruction-rewards-use-centralized-resolvedestroyedtilerewards.md) | Tile destruction rewards centralized | `resolveDestroyedTileRewards()` in MatchResolver, shared by cascades + skill destruction. |
| [#4](../decisions/04-extra-turns-are-non-cumulative-retain-turn.md) | Extra turns are non-cumulative, ACTION-scoped flags | `_extraTurnEarned` consumed once at the action epilogue; enemy extra turns must re-arm the fire gate. |
| [#13](../decisions/13-all-one-shot-visual-sfx-flags.md) | One-shot visual/SFX flags | Read-and-cleared in `getState()` to prevent double-firing. |
| [#59](../decisions/59-direct-damage-is-delivered-by-visual-carriers.md) | Direct damage is delivered by visual carriers | `_applyDamage` tags damage floatingStatEvents with `source` ('skull' from `opts.isSkull`; 'skill' passed by the DAMAGE/CONSUME handlers; null = incidental). `_castSkill` pushes a one-shot `skillCastEvents` entry (side, skill ref, cost copy, target cell) BEFORE effects resolve. BattleScene syncs the damage counter + impact feedback to the carrier effect's arrival. |
| [#17](../decisions/17-hp-resets-to-full-each-battle.md) | HP resets to full each battle | Battle mana/armor/attack also reset; `currentHp` is bookkeeping only. |
| [#18](../decisions/18-canvas-uses-dpr-aware-rendering.md) | Canvas uses DPR-aware rendering | Layout in CSS pixels; context pre-scaled. |
| [#19](../decisions/19-post-battle-flow-level-up-reward-map.md) | Post-battle flow: Level Up → Reward → map | GAME_OVER does not return to MapScene directly; defeat routes to GameOverScene. |
| [#20](../decisions/20-enemy-ai-overrides-are-dispatch-based-not.md) | Enemy AI overrides are dispatch-based | Handlers keyed by `aiBehavior` in enemyAiOverrides.js; fallback to standard EnemyAI. |
| [#21](../decisions/21-skills-and-relics-are-id-referenced-catalog.md) | Skills/relics are id-referenced + catalog-resolved | `_cloneState` is FIELD-EXPLICIT — a new battle-state field must be added there or it silently drops. |
| [#22](../decisions/22-passive-abilities-are-data-driven-via-passivesystem.md) | Passives are data-driven via PassiveSystem dispatch | No `if (relic.id === 'X')` in battle logic. |
| [#23](../decisions/23-trigger-dispatch-points-in-battlecontroller.md) | Trigger dispatch points in BattleController | Where each onTileMatch/onTurnStart/onDealDamage/… actually fires. |
| [#24](../decisions/24-static-modifier-relics-bypass-event-dispatch.md) | Static-modifier relics bypass event dispatch | `onBattleStart` modifiers aggregated once in `_initStaticModifiers()`. |
| [#25](../decisions/25-turn-start-passive-cascades-resume-the-turn.md) | Turn-start passive cascades resume the turn | `_resumeTurnAfterResolve` — setup cascades don't consume the turn or grant extra turns. |
| [#26](../decisions/26-turn-scoped-debuffs-live-on-the-combatant.md) | Turn-scoped debuffs on the combatant state | Silence/Exsanguinate tick at the END of the debuffed side's own turn (superseded by #32's status system). |
| [#30](../decisions/30-thrall-wild-tiles-baron-s-signet-harvest.md) | Thrall wild tiles + Baron's Signet harvest | The Act 1 boss engine, built purely from create_tiles/harvest_tiles board passives. |
| [#32](../decisions/32-status-effects-are-a-general-data-driven.md) | Status effects are general + data-driven; durations tick by TURN CYCLE | `state.statuses`, `_armed` model, per-status checkpoints in the controller. |
| [#37](../decisions/37-mid-battle-enemy-transform-is-a-general.md) | Mid-battle enemy TRANSFORM (Sanguine Phoenix) | `_transformInto` swaps identity IN PLACE (PassiveSystem caches the state ref). |
| [#38](../decisions/38-barrier-is-a-one-round-magic-shield.md) | Barrier is a one-round MAGIC shield, not a status | Numeric `state.barrier` pool absorbed barrier → armor → block → HP. |
| [#39](../decisions/39-poison-is-a-numeric-stack-pool-not.md) | Poison is a numeric STACK pool | Ticks at the applier's turn end, then halves; not armor-piercing. |
| [#40](../decisions/40-six-new-weave-mechanics-transmute-consume-leech.md) | `transmute`/`consume`/`leech`/`mark`/`lock`/`reflect` | Six weave mechanics + their controller-side effects (incl. lock-by-color on BoardModel). |
| [#42](../decisions/42-match-4-resolves-get-an-emphasis-freeze.md) | Match-4+ freeze beat + flourish | `_match4FreezeMs` hit-stop; skill-cast sounds pre-checked and HELD when the cast will flourish. Chained 4+ flourishes within one cascade escalate: `_flourishChainDepth` (action-scoped, reported as `match4ChainDepth` / `match4Flourish.chainDepth` in `getState()`) grows the freeze by `MATCH4_CHAIN_FREEZE_STEP` (+25%) per chain and pitches the flourish SFX up UI-side, both capped at `MATCH4_CHAIN_DEPTH_MAX` (5). GAME_OVER clears the freeze state at `_setState` so `isHitStopActive()` can never outlive the battle (decision #54 — the scene's hit-stop early-return runs BEFORE its game-over detection and would otherwise deadlock). |
| [#43](../decisions/43-battlecontroller-rework-one-cast-pipeline-an-effect.md) | BattleController rework: one cast pipeline + effect-handler registry | `_castSkill` / `_finishInstantAction` / `_setState`; BoardSimulator + MoveAdvisor board-AI layer. |
| [#46](../decisions/46-fungal-tiles-are-timed-green-affine-board.md) | Fungal tiles are TIMED, GREEN-AFFINE; `anySide` relics | Timer encoded in the type id; PassiveSystem's opposite-side second pass. |
