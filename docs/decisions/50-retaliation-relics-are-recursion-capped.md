# Decision #50 — Retaliation relics are recursion-capped: a per-side `_reactDepth` guard + `condition.isSkull` (2026-07-16)

**Two facing `onTakeDamage → damage` relics were an unbounded mutual recursion.** Bone Armor
(Marrow Sentry: retaliate when hit) against Thorned Rose (player: retaliate when hit) crashed
the game with `RangeError: Maximum call stack size exceeded` on the first damage instance of
the battle — the canvas froze on the last painted frame (the skull match's SHOW_MATCH
highlight, both sides visually at full HP).

## Why it recursed forever

Three facts compose into the loop:

1. `MatchResolver.applyDamage` computes `actualDamage = amount - blocked` — **armor-absorbed
   damage counts as damage taken** (deliberate: it's what lets Bone Armor punish hits that
   never reach HP).
2. `BattleController._dispatchDamageEvent` fires `onTakeDamage` for any `actualDamage > 0`,
   and the PassiveSystem `onDamage` callback routes relic-dealt damage back through it.
3. Neither side's retaliation was gated on damage *source* — every retaliation hit was itself
   a qualifying `onTakeDamage` event for the other side.

So: skull match hits the Sentry → Bone Armor retaliates → Thorned Rose answers → Bone Armor
answers → … Each cycle drains a little HP, but death doesn't break the chain (`applyDamage`
keeps reporting `actualDamage > 0` at 0 HP), so the stack overflows in milliseconds —
synchronously inside one `update()` call, which is why the freeze frame still showed
pre-battle-damage values.

**The sim engine never had this bug** — `engine.mjs` has carried a per-combatant
`_reactGuard` (depth ≤ 3 around onTakeDamage/onDealDamage dispatches) since the reactive
passives were mirrored. The guard existed only on the sim side, so sim-validated relic
combinations could crash the real game.

## The fix (two independent layers)

- **Engine guard — [`BattleController._dispatchDamageEvent`](../../src/js/game/BattleController.js):**
  per-side `_reactDepth` counters cap REACTIVE `onTakeDamage`/`onDealDamage` dispatches at
  depth 3 (top-level damage always dispatches at depth 0), mirroring the sim's `_reactGuard`
  semantics exactly. Counters live on the controller, not battle state, so a mid-chain enemy
  transform can't reset them. This closes the bug CLASS for any future retaliation pair.
- **Data gate — `condition.isSkull` (new condition field):** `onTakeDamage`/`onDealDamage`
  payloads now carry `isSkull`, and `_passesCondition` (game + sim mirror) gates on it. Bone
  Armor's retaliation is now `condition: { isSkull: true }` — it punishes skull hits (its
  design intent) and simply doesn't see relic/skill retaliation damage, so the Thorned Rose
  loop can't even start. Description updated to "whenever receiving [[Skull]] damage."

Layer 2 fixes this specific fight's design; layer 1 guarantees the engine survives whatever
content pairs up next (echo relics and Deathbringer already carried their own guards; plain
damage↔damage pairs now do too).

## Verified

Headless: the exact crash scenario (Thorned Rose + Scythe vs Marrow Sentry, skull 4-match
mid-cascade) settles with the retaliation firing once per skull hit and the battle
continuing; Bash (non-skull) draws no retaliation; sim mirror behaves identically;
`drift-check` NO DRIFT; `smoke.mjs` SMOKE OK.
