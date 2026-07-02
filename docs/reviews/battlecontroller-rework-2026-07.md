# BattleController Rework + Board AI — Implementation Notes (2026-07-02)

> **What this is:** the record of the controller-side refactor implementing the top
> recommendations of [battlescene-battlecontroller-architecture-review.md](battlescene-battlecontroller-architecture-review.md)
> (R1, R2, R10-lite, R11, R12, R14, R15), plus the NEW simulation-based board AI layer
> (BoardSimulator / MoveAdvisor). Summarized in CLAUDE.md decision #43; this file keeps
> the full detail — including latent bugs fixed and deliberate behavior changes.
>
> **For agents about to modify BattleController:** use the `/battlecontroller` skill
> (`.claude/skills/battlecontroller/SKILL.md`) — it distills this into working rules.

---

## 1. The rework, by review item

`src/js/game/BattleController.js` went from ~3,790 to ~3,100 lines; the skill-effect
logic moved into a new module.

### R1 — single skill-cast pipeline

The four divergent copies of *"spend cost → set sound → log → resolve effects →
game-over check → skull-destroy drain → extra-turn routing → end turn"* (player
instant `tryPlayerSkill`, player targeted `tryTargetTile`, enemy standard-AI branch,
enemy custom-AI branch) were collapsed:

- **`_castSkill(side, skill, { targetCol?, targetRow?, targetArea? })`** — THE single
  cast path. Cost/sound/log once at the top; each effect resolves through the handler
  registry. Targeted casts pass the affected area; `_dispatchTargetedEffect` routes
  the targeting-aware board effects (destroy row/column/radius, convert_tile,
  lock_color) to their executors, everything else falls through to `_resolveEffect`.
- **`_finishInstantAction(side)`** — the shared epilogue for casts that did NOT enter
  a cascade (cascade-entering casts finish via `_finishResolving`). It owns, in order:
  game-over guard (incl. an "already GAME_OVER" early-out so a mid-cast lethal doesn't
  double-log the result) → pending skull-destroy drain → extra-turn routing → `_endTurn`.
  The side-specific rules that previously diverged live here once:
  - *Player extra turn:* set `PLAYER_TURN` (we may have arrived from TARGETING — the
    old "kept targeting" bug is structurally impossible), suppress the announcement for
    the hidden egg-phase retained turn, then `_maybeAutoPassPlayer()`.
  - *Enemy extra turn:* stay in `ENEMY_TURN` and re-arm the timer gate
    (`_enemyFired = false`, `_enemyTimer = 0`) — the old "enemy freeze" bug.
  - *Both:* re-arm the once-per-action destroy guard (`_deathbringerFiredThisAction`).
- **`_performEnemySwap(swap)`** — the two ~30-line near-identical enemy swap blocks
  (standard AI + custom-AI 'swap' action) became one method.
- `_beginEnemyExtraTurn` was absorbed into the epilogue and deleted.

**Latent bugs fixed by the unification:**

1. `_executeDestroyTiles` hardcoded `this.activeSide = 'player'` — an enemy
   destroy-type skill would have credited its cascade rewards to the player. It now
   trusts `activeSide` (always the actor's side at cast time).
2. Enemy non-cascade casts never drained `_pendingSkullDestroy` — a queued
   Deathbringer-style destruction would leak into the *player's* next action and award
   the player. The shared epilogue drains it for both sides.
3. The player paths never re-armed `_deathbringerFiredThisAction` on an instant-skill
   extra turn (the cascade path did), so a damage-triggered destroyer couldn't fire
   again during a chained turn. Now uniform.

### R10-lite — action-scoped extra-turn flag

`_beginResolving` **no longer resets `_extraTurnEarned`**. The flag's lifecycle is now:
set during an action (a skill's `extra_turn` effect or a 4+ match in
`_enterShowMatch`) → consumed **exactly once** at the action epilogue
(`_finishResolving` or `_finishInstantAction`) → scrubbed at every fresh turn intro
(`_completeTurnIntro`, unchanged).

This retired the documented decision-#4 authoring trap ("an `extra_turn` effect must
be authored AFTER any `create_tiles` effect"). Verified headlessly: a skill with
`extra_turn` *before* `create_tiles` now keeps its extra turn through the cascade.
The `_executeDestroyTiles` save/restore dance for the flag was removed as obsolete.
(The full R10 — replacing the flag cluster with a turn-outcome value object — was NOT
done; `pendingExtraTurn`, `_eggForcedExtraTurn`, `_resumeTurnAfterResolve` remain.)

### R2 — effect-handler registry

`_resolveEffect`'s 23-case, ~360-line switch moved to
**`src/js/game/battle/skillEffectHandlers.js`**:

- `SKILL_EFFECT_HANDLERS` — plain object keyed by `SKILL_EFFECT_TYPES` value →
  `(effect, ctx) => enteredCascade` (same registry idiom as `enemyAiOverrides.js`).
- `ctx = { c, skill, side, oppSide, src, tgt, enteredResolving() }` where `c` is the
  controller — handlers are an extension of it and use its private surface. The
  `enteredResolving()` closure exists to avoid a circular import of `BattleState`.
- **Convergence with EffectResolver (review M3):** `armor`, `barrier`, `heal`,
  `gain_attack`, `gain_magic` now DELEGATE to `systems/EffectResolver.applyEffect`
  (with `onStatChange` wired to the controller's floating-stat emitter) — one
  implementation for the skill AND relic paths. Effects needing controller plumbing
  (the `_applyDamage` chokepoint, `_dispatchManaGain`, `_recomputeDynamicAttack`,
  the cascade executors) keep their bodies in the registry.
- `MARK_DEFAULT_MULT` and `LOCK_MIN_TURNS` live here (exported; the controller
  imports `LOCK_MIN_TURNS` for `_executeLockColor`) — the import is one-directional
  (controller → registry), no cycle.
- `_resolveEffect` on the controller is now a ~15-line lookup.

### R11 — transform derives from the clone spec

`_transformInto` no longer maintains its own field list: it builds a fresh
`_cloneState(form)` and copies **every** key onto the live `enemyState` (in place —
PassiveSystem caches the object reference), keeping only `mana`, then sets
`hp = maxHp`, clears `_defeated`/`_isDormantEgg`, and resets the static-modifier
bookkeeping (`_manaGainBonus` etc., which `_initStaticModifiers` attaches, not
`_cloneState`). **A new battle-state field added to `_cloneState` now flows to
transforms automatically** — the decision-#21 "silent field drop" hazard is retired
for the transform path.

*Deliberate behavior change:* `poison` now resets on transform like the other runtime
pools (barrier/mark/statuses/block). Previously a poisoned Phoenix kept its stacks as
the Egg — that looked like an oversight; "fresh body" semantics now apply uniformly.

### R12 / R14 / R15 — mechanical cleanups

- `_setState(next)` is the single state-transition point (no-op on same state; always
  fires `onStateChange`). All former bare `this.state =` writes route through it
  (constructor initialization excepted).
- Dead code deleted: `screenToBoard`, `enterTargeting` (both confirmed caller-less).
- Utils: exported `opponentOf(side)`; module-local `posKey(p)` — replacing ~13
  inlined ternaries / template-string keys.
- Named constants (top of file / registry): `STATUS_DAMAGE_MODS`
  (`brittleMult: 1.5`, `intangibleCap: 1`, `berserkMult: 2`), `POISON_DECAY_DIVISOR`,
  `SHAKE_FULL_AT_HP_FRACTION`, `MARK_DEFAULT_MULT`, `LOCK_MIN_TURNS`.

---

## 2. The board AI layer (new)

Two pure, headless modules — usable by any enemy or as player hints, **deliberately
wired to nothing by default**.

### `src/js/game/BoardSimulator.js` — cascade prediction

Operates on `BoardModel.clone()`s with the real `MatchResolver`, so wild (Thrall)
substitution, locked colors, inert tiles, and skull attack-scaling behave exactly as
in battle. For a candidate swap, `simulateSwap(board, swap, attacker, { samples })`
returns:

- **`guaranteed`** — deterministic outcome: the immediate match plus every cascade
  formed by *existing* tiles falling (refill OFF). Certain regardless of tile RNG.
  `{ mana, manaTotal, skullDamage, extraTurn, cascades, tilesDestroyed, matches4Plus }`
- **`expected`** — Monte-Carlo averaged full resolutions (refill ON, real effective
  spawn weights incl. relic boosts). Captures refill upside; `extraTurnChance` is the
  fraction of samples that triggered an extra turn.
- **`settledBoard`** — the deterministic post-move board (holes unfilled), used for
  opponent-reply lookahead.

`enumerateMoves(board, attacker, opts)` maps every legal swap;
`resolveBoardInPlace(sim, attacker, refill)` is the core loop.

### `src/js/game/MoveAdvisor.js` — general move ranking

`rankMoves({ board, self, opponent?, weights?, samples?, lookahead?, lookaheadTopK? })`
scores every legal swap by:

| Objective | Notes |
|---|---|
| Extra turns | guaranteed (full weight) vs refill-chance (probability-weighted) |
| Skull damage | expected pts + a certainty premium on guaranteed pts + a dominant `lethal` bonus when guaranteed damage ≥ opponent hp+armor+barrier+block |
| Mana economy | every expected point scores base; points of colors the mover's skills still NEED (`remainingSkillNeeds`) score extra, capped at the need |
| Skill readiness | a previously uncastable skill becomes castable (extra if it deals damage) |
| Denial | expected mana of colors the OPPONENT's skills still need, capped at their need |
| Cascade depth | expected cascades beyond the first |
| Opponent reply | 1-ply lookahead: penalty × the opponent's best GUARANTEED reply on `settledBoard`. Applied only to the top-K candidates (the expensive term) and skipped when the move keeps the turn |

**`DEFAULT_WEIGHTS` is the whole personality** — every objective is a named relative
weight, tunable in isolation or overridable per call. This is the "training surface":
a future offline harness can search the weight space with zero code changes.

### Entry points (capability wired, activation opt-in)

- **Enemies:** the `smart_matcher` handler in `enemyAiOverrides.js`. Set
  `aiBehavior: 'smart_matcher'` on any enemy def to upgrade its SWAP decision;
  skill decisions stay with the standard AI (the handler defers via `null` whenever a
  skill is castable). **No enemy references it yet.**
- **Player hints:** `BattleController.getSuggestedMove(options?)` /
  `getRankedMoves(options?)` — PLAYER_TURN only, returns `{ swap, score, breakdown,
  outcome }` (the per-objective `breakdown` supports "why this move" hint UI).
  **No UI calls them yet.**
- **Cost:** a full ranking is hundreds of board simulations — on-demand only (an
  enemy decision, a hint request), never per frame.

---

## 3. Verification performed

Headless smoke suite (temporary script, node in WSL, deleted after use):

- Module graph loads clean; all touched files pass `node --check`.
- Unified pipeline: instant cast + extra turn works; `extra_turn` authored BEFORE
  `create_tiles` survives the cascade (the R10 fix).
- Simulator never mutates the live board; all guaranteed outcomes sane
  (≥1 cascade, ≥3 tiles).
- Advisor rankings sorted; hint is always a member of `getValidSwaps()`; the
  opponent-reply penalty engages; `smart_matcher` returns swaps and defers to skills.
- Full headless battle with the player playing advisor moves each turn ran to
  GAME_OVER cleanly (both victory and defeat observed across runs).

**Not covered:** rendering-path behavior (BattleScene untouched), the Phoenix/Egg
transform in live play, Malakor's harvest flow — manual passes recommended per the
review's R1 checklist when convenient.

---

## 4. What's still open from the review

- **R3** — typed one-shot event queue (getState still hand-rolls seventeen
  capture-and-clear fields).
- **R4–R6** — status/poison engine, transform/egg phase, targeting-model extractions
  (mechanical moves; ride along with feature work).
- **R7–R9, R13, scene-side R14** — all BattleScene work: modal stack, effects
  director, post-battle flow extraction, public-API boundaries, dormant-code
  quarantine.
- Full **R10** — the turn-outcome value object replacing the remaining flag cluster.
