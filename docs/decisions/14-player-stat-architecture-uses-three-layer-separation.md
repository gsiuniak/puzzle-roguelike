# Decision #14 — Player stat architecture uses three-layer separation

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Player stat architecture uses three-layer separation** (NEW):
- **Layer 1 — Character definitions** (per-file in [`data/characters/`](../../src/js/data/characters/)): Immutable `baseStats` templates. Never mutated.
- **Layer 2 — Run state** ([`runState.js`](../../src/js/data/runState.js)): Persistent `statModifiers` that accumulate from rewards/relics/upgrades. `currentHp` is tracked but does NOT seed battle HP — each fight starts at full `maxHp`.
- **Layer 3 — Battle state**: Fresh instance created each battle via [`createPlayerBattleState()`](../../src/js/data/playerStats.js). Mana/armor/attack reset from effective stats each battle.
