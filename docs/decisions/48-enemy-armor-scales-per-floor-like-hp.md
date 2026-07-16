# Decision #48 — Enemy ARMOR scales per floor like HP, on the SAME curve (2026-07-16)

**Authored enemy `armor` is a floor-1-equivalent baseline, exactly like `maxHp`. At spawn it is
multiplied by the same per-depth curve HP uses — deliberately the same array, not a copy.**

## Why armor needed a curve

[Decision #11](./11-enemy-hp-and-attack-scale-per-floor.md) scaled HP (multiplicative) and
attack (additive steps) but left `armor` flat. That made authored armor a decaying stat: a
10-armor enemy is a wall on floor 2 and a speed bump on floor 9, because player damage-per-turn
grows across the act while the armor number doesn't. Any enemy identity built on armor (the
Goresnout Trackers' authored bulk, the Marrow Sentry's armor-centric kit) silently flattens as
floors climb.

Armor and HP are the **same budget** — both are "how much damage the player must produce to win"
— so armor follows the **HP curve, which already tracks the measured player-DPT ratio**. A
separate armor curve would be a second knob to retune for the identical question.

## The shape of the change

- [`enemyScaling.js`](../../src/js/data/enemyScaling.js) exports `enemyArmorFloorMult(depth)`
  which **returns `enemyHpFloorMult(depth)`** — no second array. Retuning `ENEMY_HP_FLOOR_MULT`
  keeps armor in step automatically; split into its own array only when armor genuinely needs
  independent tuning. (This also means the drift guard's existing `ENEMY_HP_FLOOR_MULT` check
  covers armor for free.)
- [`MapScene._resolveEnemyBattleData`](../../src/js/scenes/MapScene.js) applies
  `data.armor = Math.round(baseline × enemyArmorFloorMult(depth))` at spawn — same place and
  rounding as HP.
- `sim/toolbench/engine.mjs` `makeEnemyCombatant` mirrors it via `armorMultForFloor`
  (aliased to `hpMultForFloor`), including for the `overrides.armor` sweep path — an override
  is a BASELINE, like `overrides.hp`.

## What is deliberately NOT scaled

**In-battle armor gains** (the `armor` effect from skills/relics — Goblin Totem's +1, Bone
Armor's +2 per turn) stay flat. They are pacing knobs inside one battle, not spawn budgets;
scaling them would compound with the enemy's floor-scaled action economy and double-dip.
If a relic's armor gain should grow with floors, that is an authoring choice (an `amount`
per-enemy variant), not a global multiplier.
