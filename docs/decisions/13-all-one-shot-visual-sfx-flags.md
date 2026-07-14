# Decision #13 — All one-shot visual/SFX flags

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**All one-shot visual/SFX flags** are read-and-cleared in `BattleController.getState()` to prevent double-firing.
