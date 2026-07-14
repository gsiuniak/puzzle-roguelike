# Decision #15 — Stat resolution is centralized

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Stat resolution is centralized** in [`playerStats.js`](../../src/js/data/playerStats.js). `getEffectivePlayerStats()` is the single source for computing baseStats + statModifiers. No scattered math elsewhere.
