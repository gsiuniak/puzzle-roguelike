# Decision #10 — MapScene is a singleton

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**MapScene is a singleton** — graph, renderer, traversal, `_runState`, and `_characterDef` all survive scene switches.
