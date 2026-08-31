# 59 — Direct damage is DELIVERED by visual carriers (skull streams / spell projectiles)

**Date:** 2026-08-30

## Decision

Direct damage — skull-tile damage and direct skill hits — no longer feeds the
accumulating damage counter the frame the model applies it. Instead it rides a
**visual carrier** from its cause to the receiver, and every piece of impact
feedback fires at the carrier's ARRIVAL:

- **Skull damage** → a `SkullStreamEffect`: crimson wisps + tumbling ghost
  copies of the skull tile art fly from each destroyed skull cell to the
  receiver's portrait. The damage is attached as a *payload* and handed back
  in per-wisp chunks (`onDeliver(chunk, isLast)`), so the counter ticks up as
  each skull lands.
- **Skill damage** (a cast with a `damage`/`consume` effect) → an
  element-tinted spell projectile (a punchy `ManaStreamEffect` from the caster
  portrait to the receiver portrait; the enemy's launches after its cast
  showcase via the new `delayMs` config) that flushes the cast's damage at
  `onArrive`.
- At delivery, BattleScene's `_deliverDamage` fires the whole impact suite in
  one beat: counter tick, receiver portrait **recoil** (`PortraitRecoilEffect`)
  + additive **hit flash** (`CharacterInfoPane.flashPortrait`), **directional
  screen shake** (the controller's frame shake is suppressed when its damage
  was deferred; the shake re-fires at arrival with an attack-axis bias), the
  player-side **red edge vignette**, and an impact particle burst.

### The plumbing contract

- `BattleController._applyDamage` tags every damage `floatingStatEvent` with a
  `source`: `'skull'` (opts.isSkull), `'skill'` (the DAMAGE/CONSUME handlers
  pass `{ source: 'skill' }`), or `null` for everything incidental (poison,
  reflect, relic echo, bleed). **Sourceless damage keeps the old immediate
  counter behavior** — only direct damage rides a carrier.
- A new one-shot `skillCastEvents` (pushed in `_castSkill` BEFORE effects
  resolve, standard 4-place read-and-clear) tells the scene about every cast:
  `{ side, skillId, skill, cost copy, targetCol/Row }`. The scene processes it
  before `floatingStatEvents` in the same snapshot, so a cast's damage always
  finds its just-spawned projectile.
- Carriers register per RECEIVING side in `BattleScene._carriers`; damage
  events route to the most recent OPEN carrier, or deliver immediately when
  none exists (spawn failure, arrival already passed). Carriers flush any
  undelivered payload when they finish — **damage feedback can never be
  lost** — and they extend the existing `_hasPendingDamageDelivery` turn gate
  so the turn can't pass while damage is visually in flight.

## Why

The mana loop had a complete cause→effect story (tiles → wisps → orb → pulse)
but damage had none: numbers appeared in the receiver's column with nothing
traveling from the board or caster to explain them. Syncing the counter to a
carrier's arrival is what makes the damage *read* — each tick is a skull that
landed.

## Tradeoffs / accepted quirks

- **The HP bar still drops at model time** (~300-600ms before the wisps land).
  Deferring actual HP application would mean re-timing battle logic; the
  UIProgressBar ghost-bar animation covers the gap acceptably.
- The `skullDamageDealt` SFX stays at model time — it reads as the LAUNCH
  sound (tiles shattering); arrival has no dedicated sound yet.
- A fully blocked hit emits no damage event: the stream flies with an empty
  payload and simply fizzles (small burst, no counter/recoil) — accepted as
  "the attack was absorbed".
- The turn gate now also waits for carrier flight (~0.5-1.3s post-cast for
  enemy casts including the showcase). Deliberate: it doubles as pacing that
  lets the player read the enemy's cast.

## Related

- Extends decision #41 (accumulating damage counter + mana streams).
- Decision #13 (one-shot flags) — `skillCastEvents` follows the same pattern.
- The enemy cast showcase (`SkillCastShowcaseEffect`) and the skill `vfx`
  color derivation live in the same change; see
  [ui-and-scenes.md](../guides/ui-and-scenes.md).
