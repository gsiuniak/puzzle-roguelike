# Decision #6 — Map generation is separate from map rendering.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Map generation is separate from map rendering.** MapGenerator creates immutable MapGraph; MapRenderer/MapView draw it; MapTraversalController manages state mutations.
