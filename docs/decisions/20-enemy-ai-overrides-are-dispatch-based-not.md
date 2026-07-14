# Decision #20 — Enemy AI overrides are dispatch-based, not conditional.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Enemy AI overrides are dispatch-based, not conditional.** Custom AI is registered in [`enemyAiOverrides.js`](../../src/js/game/enemyAiOverrides.js) as handler functions keyed by `aiBehavior`. [`customEnemyAi.js`](../../src/js/game/customEnemyAi.js) orchestrates: try custom → fallback to standard `EnemyAI`. Enemy definitions link via optional `aiBehavior` field.
