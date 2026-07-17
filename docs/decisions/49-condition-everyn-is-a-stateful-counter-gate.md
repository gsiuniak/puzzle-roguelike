# Decision #49 — `condition.everyN` is a STATEFUL counter gate; RelicBar shows the live count as an icon badge (2026-07-16)

**"Every Nth event" relics are expressed as one data field, not battle-logic code.**
`condition: { everyN: 10 }` on a passive effect makes it fire only on every 10th event that
passes the other condition gates, then reset. The Hourglass relic ("Every 10 matches, gain an
Extra Turn") is the first user; the mechanism is generic.

## The gap this closes

Every existing condition field (`typeId` / `color` / `minCount` / `side` — decision #47) is a
**pure payload filter**: it looks at the event and answers yes/no. There was no way to express
a relic that accumulates progress ACROSS events ("every 10 matches", "every 5th cast", "every
3rd hit taken"). Writing Hourglass without it would have meant a relic-id check plus a counter
field inside BattleController — exactly what [hard rule 5](../../CLAUDE.md) (passives stay
data-driven) forbids.

## The change

- **[`PassiveSystem._dispatchToOwner`](../../src/js/systems/PassiveSystem.js)** — after the pure
  payload gates pass, an effect with `condition.everyN > 0` advances `effect._everyNCounter`;
  below N the dispatch `continue`s (counted, NOT fired — no `onRelicTrigger` jiggle, no warn),
  on the Nth it resets to 0 and falls through to normal resolution. `_passesCondition` stays
  **side-effect-free** — the stateful gate deliberately lives in the dispatch loop.
- **Counter storage: the per-battle effect clone.** `resolveRelicIds` (and the sim's deep-clone
  `resolveIds`) clone effects at battle-state creation, so `_everyNCounter` starts at 0 every
  battle for free, never touches the catalog, and needs no `_cloneState` entry (it is relic
  data, not a battle-state field).
- **[`BattleController._dispatchMatchEvents`](../../src/js/game/BattleController.js)** — the
  Extra Turn popup anchor: the 4+ path sets `extraTurnTriggerPos` from the analysis, but a
  passive-granted extra turn has no analysis trigger. The dispatch loop snapshots
  `_extraTurnEarned` before each per-match dispatch; if a passive flips it (and no pos is set,
  and this isn't a `_resumeTurnAfterResolve` setup cascade), the popup anchors to that match's
  middle tile. Works for ANY future extra-turn passive on a match trigger, not just Hourglass.
- **[`RelicBar._drawCounterBadges`](../../src/js/ui/RelicBar.js)** — any visible relic whose
  effect carries `condition.everyN` gets a mana-cost-style pill badge (lower-right of the icon)
  showing the live count, read per frame from the effect object (battle-state relics are live
  references; a new RelicBar is built per battle, so no cross-battle staleness).
- **`sim/toolbench/engine.mjs`** — the mirror: the same counter gate in `_passivesFor`, plus a
  relic `extra_turn` case that sets `_passiveExtraTurn`, folded into `_resolveCascade`'s
  return with the same `suppressExtraTurn` / `_canGainExtraTurn` gates as the 4+ path.

## Why a counter on the effect clone and not battle state

The counter is *relic-shaped* data: it exists only while its relic is resolved, resets with
re-resolution, and the UI needs to find it FROM the relic (the badge is drawn per icon). Storing
it on the combatant state would need a keying scheme (relic id + effect index), a `_cloneState`
entry, and transform keep-list decisions — all to track what is naturally a property of the
effect instance. Mutating the per-battle clone is already an established pattern (PassiveSystem
mutates trigger payloads; `_initStaticModifiers` reads effect payloads).

## Semantics worth remembering

- `everyN` composes (ANDs) with the pure gates: `{ typeId: 'skull', everyN: 5 }` = "every 5th
  SKULL match" — non-qualifying events don't advance the counter.
- Like every passive `extra_turn`, the grant routes through the `onExtraTurn` callback →
  `_extraTurnEarned`, so it is **action-scoped and non-cumulative** (hard rule 9) and respects
  Frozen (`_canGainExtraTurn`). Firing mid-cascade retains the CURRENT action's turn.
- Extra turns bypass `_completeTurnIntro`, so the counter carries across extra turns within a
  side's chain — 10 matches is 10 matches, however many retained turns they span.

## Compatibility

No shipped relic carried `everyN` before Hourglass, so the gate is inert everywhere else.
Verified headless: counter 0→9 without firing, fire+reset on the 10th, enemy matches don't
advance the owner's counter, popup pos read-and-clears once, exactly one jiggle per fire; sim
mirror identical, 200-battle batch runs clean with the extra-turn rate rising vs. baseline;
`node sim/toolbench/drift-check.mjs` → NO DRIFT.
