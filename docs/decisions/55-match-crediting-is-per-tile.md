# Decision #55 — Match crediting is PER-TILE: overlapping wild matches pay out once (2026-07-18)

**A wild tile shared by several runs was paid out once per run.** `BoardModel`'s scan
emits one match per concrete color, so a wild bridging a red and a blue run appears in
BOTH matches (and a wild can likewise join a skull run). `analyzeMatches` deduplicated
*positions* (each tile is destroyed once) but summed *rewards* per match — a multi-wild
board could yield e.g. 19 red mana from ~11 distinct tiles, and skull damage scaled the
same inflated way. Reward inflation, invisible in normal play, explosive on
wild-flooding skill boards (Embered Reshaping of Flame).

## The rule

In `MatchResolver.analyzeMatches`, each board position is **credited exactly once — to
the first match that contains it in scan order** (deterministic: `findAllConnectedMatches`
scan order). Mana and matched-skull damage are computed from the deduped credit count.
Two deliberate carve-outs:

- **Extra-turn checks still use the RAW run size** (`match.count`): a legitimate 4-run
  that shares its wild with another run must not lose its extra turn to crediting order.
- **Inert (Disease) matches never claim a shared tile's credit** — they award nothing
  for it, so letting them claim would silently destroy value.

Only wilds can overlap (concrete tiles belong to one type, and connected same-type runs
are merged by the union-find), so non-wild boards are byte-identical to the old behavior.

## Ripple

BoardSimulator / MoveAdvisor / the formula-policy hints all consume `analyzeMatches`
on clones, so prediction and reward agree automatically. The sim engine imports the same
module; drift-check stays green. Cosmetic duplication in the flourish cell list /
mana-stream triggers (a shared wild sparkling once per color) is unchanged — visual
only, no reward attached.
