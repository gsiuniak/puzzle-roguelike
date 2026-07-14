---
name: battlecontroller
description: Rules, recipes, and verification steps for safely amending BattleController and the battle logic around it (skill effects, turn flow, extra turns, damage, passives, cascade machine, board AI). Use BEFORE editing src/js/game/BattleController.js, battle/skillEffectHandlers.js, EffectResolver, or the turn/cascade/extra-turn flow.
---

# Amending BattleController

The battle core was reworked 2026-07 ([decision #43](../../../docs/decisions/43-battlecontroller-rework-one-cast-pipeline-an-effect.md); full detail in
[docs/reviews/battlecontroller-rework-2026-07.md](../../../docs/reviews/battlecontroller-rework-2026-07.md);
design rationale in [docs/reviews/battlescene-battlecontroller-architecture-review.md](../../../docs/reviews/battlescene-battlecontroller-architecture-review.md)).
This skill encodes the invariants that keep it correct and the recipes for the common
change types. Read the relevant recipe BEFORE editing.

> **Reference vs. procedure.** This skill is the *procedure* — invariants, recipes,
> verification. The *reference* (component ownership, the state machine, every
> `SKILL_EFFECT_TYPES` payload shape, the flow diagrams) lives in
> [docs/guides/battle-system.md](../../../docs/guides/battle-system.md). Load that guide
> for "what exists and where"; use this skill for "how to change it safely."

## Architecture in 30 seconds

- `src/js/game/BattleController.js` — turn state machine + cascade phase machine +
  orchestration. Owns all game logic; imports zero UI. The scene reads snapshots via
  `getState()` (read-and-clear one-shot flags).
- `src/js/game/battle/skillEffectHandlers.js` — THE skill-effect registry:
  `{ [effectType]: (effect, ctx) => enteredCascade }`,
  `ctx = { c, skill, side, oppSide, src, tgt, enteredResolving() }` (`c` = controller).
- `src/js/systems/EffectResolver.js` — shared ATOMIC effect implementations
  (armor/barrier/heal/gain_attack/gain_magic/damage/…) used by BOTH the skill path
  (via delegating registry handlers) and the relic/passive path (PassiveSystem).
- `src/js/game/BoardSimulator.js` / `MoveAdvisor.js` — pure headless board AI
  (cascade prediction + move ranking). Wired to `aiBehavior: 'smart_matcher'`
  (no enemy uses it yet). The HINT UI moved off MoveAdvisor (2026-07-08):
  BattleScene's "?" button now uses `controller.getSuggestedAction()` — the
  champion FORMULA POLICY (`src/js/game/ai/formulaPolicy.js`, promoted from
  sim/toolbench) run through the `_makeHintFacade` seam. See [decision #45](../../../docs/decisions/45-the-in-game-hint-system-plays-the.md).

## Invariants — violate these and you WILL reintroduce a shipped bug

1. **Every skill cast goes through `_castSkill(side, skill, opts?)`.** Never re-create
   a spend→resolve→end-turn sequence at a call site. Non-cascade casts end via
   `_finishInstantAction(side)`; cascade casts end via `_finishResolving`. Any new
   post-cast concern (like the Deathbringer drain) goes in those two epilogues ONLY.
2. **All damage funnels through `_applyDamage(target, amount, opts?)`** (project rule
   #19). Never call `this.resolver.applyDamage` directly from controller code — you'd
   bypass mark/reflect/brittle/intangible/berserk/incoming-damage relics. (Exception
   on record: `_tickPoison`, deliberate and documented.)
3. **`_extraTurnEarned` is action-scoped.** Set during an action; consumed exactly once
   in `_finishResolving` / `_finishInstantAction`; scrubbed at `_completeTurnIntro`.
   NEVER reset it mid-action (e.g. inside `_beginResolving` or an executor) — that
   recreates the old "extra_turn must be authored after create_tiles" trap.
4. **Enemy extra turns must re-arm the fire gate** (`_enemyFired = false`,
   `_enemyTimer = 0`, stay in ENEMY_TURN). The enemy turn is timer-driven; forgetting
   this freezes the battle. The epilogues already do it — route through them.
5. **State transitions go through `_setState(next)`** — never `this.state = …`.
6. **New battle-state fields go in `_cloneState` ONLY.** `_transformInto` copies every
   clone key automatically (keeping `mana`). If your field must SURVIVE a transform
   (like mana does), add it to the keep-list in `_transformInto` explicitly.
7. **One-shot scene signals follow read-and-clear.** Buffer on the controller
   (`this._myEvent`), capture-and-clear inside `getState()`, return it in the snapshot,
   handle it in `BattleScene.updateFromController`. All four places or it double-fires
   or never fires.
8. **`activeSide` is the actor.** Never hardcode `'player'`/`'enemy'` in shared
   executors — use `this.activeSide`, the `side` param, or `opponentOf(side)`.
9. **Passives stay data-driven.** No `if (relic.id === X)` in battle logic; dispatch
   triggers via `this.passives.dispatch(...)`, handle board-touching relic effects in
   `_handlePassiveBoardEffect` by `effectType`.

## Recipes

### Add a new skill effect type
1. Add the constant to `SKILL_EFFECT_TYPES` in `src/js/game/MatchResolver.js` (with a
   payload doc comment — follow the existing style).
2. Register a handler in `battle/skillEffectHandlers.js`:
   - Pure atomic effect that relics might also use → implement it ONCE in
     `EffectResolver.applyEffect` and register the shared `delegateAtomic` (or a thin
     wrapper). Do NOT write a second copy in the registry (that drift shipped bugs).
   - Needs controller plumbing (damage chokepoint, mana dispatch, board mutation) →
     write the body in the registry using `ctx.c`. Board effects that start a cascade
     call a `c._execute*` executor and `return ctx.enteredResolving()`.
3. Targeted effect (player clicks a tile)? Also add a case to
   `BattleController._dispatchTargetedEffect` and give the skill `targeting: 'board_tile'`
   + an `area` in its catalog entry.
4. If the weave synthesizer should emit it, wire `skillSynthesizer.js` separately.
5. Document the payload shape in the `SKILL_EFFECT_TYPES` section of
   [docs/guides/battle-system.md](../../../docs/guides/battle-system.md).

### Add a new one-shot visual/SFX event (controller → scene)
Follow invariant #7 (4 places). Keep the field name and the getState snapshot key
aligned with the existing seventeen. (Review R3 — a typed event queue — is the planned
replacement; if you're adding several events at once, consider doing R3 instead.)

### Change turn flow / extra turns / TURN_INTRO
Touch only: `_endTurn`, `_beginTurnAnnouncement`, `_completeTurnIntro`,
`_finishResolving`, `_finishInstantAction`. Re-read invariants #3/#4 first. Remember:
extra turns BYPASS `_completeTurnIntro` (statuses don't re-tick, barrier doesn't
expire, the stale-flag scrub doesn't run) — that's by design.

### Add a status effect
Catalog entry in `data/statusEffects.js` + behavior checkpoints in the controller
(`_hasStatus` query at the relevant chokepoint; per-turn effects in
`_applyStatusTurnStartEffect`; damage mods via `STATUS_DAMAGE_MODS`). See [decision #32](../../../docs/decisions/32-status-effects-are-a-general-data-driven.md).

### Tune / extend the board AI
Weights: `MoveAdvisor.DEFAULT_WEIGHTS` (every objective is a named relative weight).
New scoring objective: add a term in `scoreOutcome` + a weight + a `breakdown` key.
Give an enemy the smart matching: set `aiBehavior: 'smart_matcher'` on its def — no
code change. Player hints: `controller.getSuggestedAction()` (champion formula
policy via `_makeHintFacade` — keep the facade's field list in sync with the
INPUT CONTRACT in `src/js/game/ai/formulaPolicy.js` if you add battle-state
fields the policy should see); `getSuggestedMove()/getRankedMoves()` remain the
older MoveAdvisor swap-only queries.
BoardSimulator/MoveAdvisor must stay PURE (no controller/scene imports, operate on
board clones only) and are on-demand — never call them per frame.

## Verify your change (headless — do this before handing off)

The controller runs without a canvas. Write a temp script, run it, DELETE it
(don't put it in `sim/` — that directory is off-limits per CLAUDE.md):

```bash
# from the repo root, inside WSL:
node .tmp-check.mjs && rm .tmp-check.mjs
```

```js
// .tmp-check.mjs — minimal harness (extend for your change)
const { default: BattleController } = await import('./src/js/game/BattleController.js');
const mkSide = (name) => ({
  name, className: 't', level: 1, hp: 30, maxHp: 30, attack: 2, magic: 1, armor: 0,
  mana: {}, portrait: '', relics: [],
  skills: [{ id: 's', name: 'S', cost: {}, effects: [/* your effect here */] }],
});
const c = new BattleController(mkSide('Hero'), mkSide('Goblin'));
for (let i = 0; i < 200; i++) c.update(16);           // run TURN_INTRO
// ...cast skills / tryPlayerSwap / assert on c.state, c.getState(), hp, mana...
for (let i = 0; i < 3000 && c.state === 'RESOLVING'; i++) c.update(16); // settle cascades
console.log(c.state, c.pendingExtraTurn, c.playerState.hp, c.enemyState.hp);
```

Then `node --check` every edited file. Manual regression checklist when you touched
the cast pipeline or turn flow (from review R1) — test in the browser:
instant skill · targeted skill (+extra turn, the lock case) · enemy instant skill with
extra turn (Cyclops Smash) · custom-AI skill chain (Malakor) · Phoenix→Egg kill via a
cascade, an instant skill, AND a targeted destroy.

## After you edit

Follow the doc update contract in [CLAUDE.md](../../../CLAUDE.md) §6 — **do not append to
CLAUDE.md**:
- Changed how something WORKS (a new effect type, a new condition gate, a new tuning knob)
  → update [docs/guides/battle-system.md](../../../docs/guides/battle-system.md).
- Made a DESIGN choice with rationale/tradeoffs → add a new record in
  [docs/decisions/](../../../docs/decisions/) + a row in its README. Don't rewrite an
  existing decision; they are history. (Example: #47 extends #46 rather than editing it.)
- A file now OWNS a behavior it didn't → one line in the CLAUDE.md §4 routing table.

If you implemented another review recommendation, tick it off in the IMPLEMENTATION STATUS
block of `docs/reviews/battlescene-battlecontroller-architecture-review.md`.
