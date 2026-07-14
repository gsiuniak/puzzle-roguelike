# Decision #22 — Passive abilities are data-driven via PassiveSystem dispatch, not conditionals.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Passive abilities are data-driven via PassiveSystem dispatch, not conditionals.** Battle code emits trigger events via `this.passives.dispatch(triggerName, payload)`. [`PassiveSystem`](../../src/js/systems/PassiveSystem.js) iterates the affected side's relics, matches by `effect.trigger`, and resolves via `applyEffect`. Adding a relic requires no code changes outside [`relicCatalog.js`](../../src/js/data/relics/relicCatalog.js). Recursion guard is intentionally absent (today's relics don't recurse — add depth limit when needed).
