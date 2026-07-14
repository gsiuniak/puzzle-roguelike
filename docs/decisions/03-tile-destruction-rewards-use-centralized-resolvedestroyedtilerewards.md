# Decision #3 — Tile destruction rewards use centralized [resolveDestroyedTileRewards()](../../src/js/game/MatchResolver.js#L199)

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Tile destruction rewards use centralized [`resolveDestroyedTileRewards()`](../../src/js/game/MatchResolver.js#L199)** in MatchResolver, called from both match cascades and skill-based destruction.
