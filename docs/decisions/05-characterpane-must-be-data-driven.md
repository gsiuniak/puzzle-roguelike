# Decision #5 — CharacterPane must be data-driven.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**CharacterPane must be data-driven.** `updateFromState(combatantState)` reads HP, mana, armor, block. No hardcoded character-specific logic.
