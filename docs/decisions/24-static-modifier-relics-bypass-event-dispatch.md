# Decision #24 — Static-modifier relics bypass event dispatch.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Static-modifier relics bypass event dispatch.** Persistent passives (Group A spawn-rate, Group B mana-gain, Funerary Bell skull-damage, Claymore attack) are NOT event reactions, so they don't flow through PassiveSystem/EffectResolver. They use `trigger: 'onBattleStart'` and one of the static effect types (`modify_stat`, `modify_spawn_rate`, `modify_mana_gain`, `modify_skull_damage`). [`BattleController._initStaticModifiers()`](../../src/js/game/BattleController.js) scans both sides' relics ONCE at construction (before `board.initialize()`), dispatching by `effectType` (never by relic id):
- `modify_stat` → adds to the combatant stat (e.g. `attack += 3`).
- `modify_spawn_rate` → accumulates board-global percentage-point boosts, applied via [`BoardModel.setSpawnRateBoosts()`](../../src/js/game/BoardModel.js). `getEffectiveWeights()` raises each boosted tile to `base% + boost` and redistributes the remaining probability across the other tiles in proportion to their base rates (skull absorbs the remainder), so the boosted tile lands at exactly base+boost and the rest keep their ratios.
- `modify_mana_gain` / `modify_skull_damage` → stored per-combatant as `_manaGainBonus` / `_skullDamageBonus`, applied in [`BattleController._applyMatchBonuses()`](../../src/js/game/BattleController.js) which augments each cascade step's analysis (in `_enterShowMatch`, before passive dispatch & reward granting).
