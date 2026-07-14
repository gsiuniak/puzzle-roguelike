# Decision #16 — Rewards modify run modifiers, not base stats.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Rewards modify run modifiers, not base stats.** Use `applyRunModifier(runState, statPath, amount)`. Example: `applyRunModifier(runState, 'startingMana.purple', 2)`.
