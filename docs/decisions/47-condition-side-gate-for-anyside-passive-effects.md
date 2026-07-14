# Decision #47 — `condition.side` gate for `anySide` passive effects (2026-07-14)

**`anySide` widens a passive to both sides' events; `condition.side` narrows it back to one.**
Together they let a relic express "react to the OPPONENT's events only" — purely in data, with
no relic-id checks in battle logic.

## The gap this closes

[Decision #46](./46-fungal-tiles-are-timed-green-affine-board.md) introduced `anySide: true`,
a second dispatch pass letting a relic react to the *opposite* side's events (Vampiric Roots:
"heal whenever ANYONE matches Green"). But `anySide` is a **superset** — the owner's own events
still fire through the normal pass — and `PassiveSystem._passesCondition` supported only
`typeId` / `color` / `minCount`. There was **no way to say "only when the PLAYER does X."**

That limitation was undocumented and only discoverable by reading `PassiveSystem` source. It
surfaced while scoping an enemy relic specified as *"whenever the **player** matches Skulls, the
enemy heals"* — which, written with `anySide` alone, would silently *also* heal the enemy on its
own skull matches. A plausible, wrong, and invisible outcome: exactly the bug class the
data-driven passive system exists to prevent.

## The change

One field, gated in both engines:

- [`PassiveSystem._passesCondition`](../../src/js/systems/PassiveSystem.js) —
  `if (condition.side != null && payload.side !== condition.side) return false;`
- `sim/toolbench/engine.mjs` `_passivesFor` — the mirror. The sim carries the actor on the
  combatant (`c.side`) rather than the payload, so `_passives` threads `c.side` down as
  `actorSide`.

`condition.side` matches `payload.side` — the **actor**, the side whose event it is — NOT the
relic's owner. It is only meaningful alongside `anySide` (without it, an effect already sees
only its owner's events, so the gate is a no-op or an own-goal).

```js
// "Heal 1 HP per skull, but ONLY when the PLAYER matches skulls" (an enemy relic)
{ trigger: 'onTileMatchType', anySide: true,
  condition: { typeId: 'skull', side: 'player' },
  effectType: 'heal', heal: { amount: 1, perCount: true } }
```

## Why a data gate and not a new trigger

An `onOpponentTileMatch`-style trigger would double the trigger surface and force every
dispatch site to fire twice. The condition gate is a filter on an existing dispatch: zero new
dispatch points, zero cost when unused, and it composes with the other condition fields
(ANDed) for free. It keeps [hard rule 5](../../CLAUDE.md) intact — passives stay data-driven;
no `if (relic.id === …)` anywhere.

## Compatibility

**Fully backward-compatible.** Every shipped relic omits `condition.side`, so the gate is
inert for all of them; `vampiric_roots` keeps its "ANYONE" semantics deliberately. Verified:
the game gate unit-checked (fires for the gated side, does NOT fire for the other, unaffected
without the field, ANDs with `minCount`), `node sim/toolbench/drift-check.mjs` → NO DRIFT, and
`node sim/toolbench/smoke.mjs` → SMOKE OK with the Blight Warden's `anySide` heal intact.

**No AI work needed:** `oppMatchHealAmount` in
[`formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js) derives the "my match heals the
opponent" penalty *generically* from the opponent's `anySide` match-heal effects, so a
side-gated relic is scored by the existing `oppMatchHeal` weight with no code change.
