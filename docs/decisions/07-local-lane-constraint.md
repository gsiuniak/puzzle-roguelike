# Decision #7 — Local-lane constraint:

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Local-lane constraint:** Connections between consecutive depths may only move vertically by at most 1 lane (|source.lane − target.lane| ≤ 1). Node counts are smoothed (±1 between depths) to guarantee valid targets exist. Edge validation enforces this at generation time. The start node is centered at `START_LANE` so its ±1 fan-out reaches 3 lanes (depth 1 = 3 nodes). The two guaranteed elites are placed by `_placeReachableElites` *after* wiring/validation (the late elite is picked from the early elite's reachable descendants, so a route through both always exists without a fixed spine). MapRenderer applies a small deterministic per-node jitter (`_idJitter`) so positions aren't a rigid grid.
