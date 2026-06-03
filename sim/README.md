# Battle Simulator (headless, math-only)

A dependency-free model of the **combat economy** for tuning stat/skill/enemy
values. It is **not the game**: there is no 8×8 board, no rendering, and the
real `BattleController` is never used. Turns are resolved instantly by a
probabilistic economy model (`model.mjs`) plus the game's actual numeric
formulas (skull damage, armor→block→HP).

Lives outside `src/` on purpose — it is a tuning tool, not shipped code.

## Why it exists

The research doc ([../docs/balance-scaling-research.md](../docs/balance-scaling-research.md))
derives stat/skill/enemy values analytically but flags that the **board economy
constants** (tiles/turn, focus fraction, extra-turn rate) are estimates. This
sim turns those estimates into knobs and lets you read back **win rate, turns,
HP remaining, and DPT** so you can measure — not guess — what a stat or skill is
worth.

## Run

```bash
node sim/run.mjs                      # 2000 runs/point, seed 12345 → sim/out/results.json
node sim/run.mjs --runs 5000 --seed 7
node sim/analyze.mjs                  # process the results file into value tables
node sim/analyze.mjs sim/out/results.json
```

Pure ESM (`.mjs`), no install, no `package.json` changes. Needs Node ≥ 16.

## Files

| File | Role |
|---|---|
| `model.mjs` | Economy constants (the knobs) + RNG + faithful formula mirrors + per-action tile draw. |
| `engine.mjs` | `runBattle(player, enemy, seed, opts)` → one fight's metrics. Turn loop, skill/board policy, passive hooks. |
| `scenarios.mjs` | What to measure: reference combatants, fixed `SCENARIOS`, and `SWEEPS` (vary one thing). **Edit this to add experiments.** |
| `run.mjs` | Runs everything N times, aggregates, writes `sim/out/results.json`, prints a summary. |
| `analyze.mjs` | Starter processor: marginal values per sweep + an HP↔Attack exchange estimate. |
| `out/results.json` | Output (gitignore-able). |

## The model (what one turn does)

Each action draws a tile yield from `MATCH_SIZE_DIST` (+ a chance of one
cascade), splits it by `FOCUS_FRACTION` into a **targeted** resource and
**incidental** tiles, then:

- a **color target** → that many mana of the color (toward a skill);
- a **skull target** → skull tiles grouped into matches of `SKULL_GROUP_SIZE`,
  dealing `inGroupTiles + groups·(attack−1)` (the real matched-skull formula);
- incidental tiles → ~20% skulls (board share) for chip damage, rest spread as mana;
- a base match of 4+ (`P ≈ 0.30–0.40`) grants an **extra turn** (chained, capped).

A side casts a skill instead of swapping when its policy wants one it can afford
(greedy: best affordable damage skill; heal when < 50% HP; free self-buffs).
Damage routes through the same path as the game so passives fire uniformly.

All constants live at the top of `model.mjs` and are documented against
research §16.

## Output schema (`results.json`)

```jsonc
{
  "meta": { "seed": 12345, "runsPerPoint": 2000, "economy": { /* knobs used */ } },
  "scenarios": [
    { "name", "player": {…def}, "enemy": {…def}, "aggregates": { /* see below */ } }
  ],
  "sweeps": [
    { "name", "note", "varying": "player.attack",
      "points": [ { "value": 1, "aggregates": {…} }, { "value": 2, … } ] }
  ]
}
```

`aggregates` per data point:

| field | meaning |
|---|---|
| `n` | runs |
| `winRate` | fraction the player won (0–1) |
| `playerActions` | `{ mean, median, p10, p90 }` — **turns to resolve** (pacing) |
| `playerHpFracOnWin` | avg HP fraction left when the player wins (lethality) |
| `playerHpFrac` | `{ mean, median }` over all runs |
| `playerDPT` | avg damage dealt per player action |
| `skullGroupsPerAction` | measured `m` from research §12.2 (skull matches/turn) |
| `avgSkillCasts` | skills cast per fight |

## Fidelity — what's modeled vs simplified

**Faithful:** matched/destroyed skull-damage formulas, armor→block→HP, mana
costs/spending, extra-turn-on-4+, attack scaling skull damage, the common
effect types and passive triggers.

**Abstracted (by design):**
- The board is probabilistic, not a real grid — no specific tile layouts, no
  swap search, no "no valid move" reshuffles.
- Player/enemy "agency" is a simple greedy policy, not the real `EnemyAI`
  scorer or a human.
- `create_tiles` ≈ `count × 0.7` mana; `destroy_row` ≈ 8 tiles of reward;
  convert/summon-skull effects are modeled via a `skull_damage` stand-in.
- Cascades are a single-step approximation; deep combo chains are under-modeled.

These are tuning approximations. **Treat absolute numbers as directional and
relative comparisons (A vs B, sweep slopes) as the real signal.** When a number
matters precisely, adjust the knob and re-run rather than trusting one figure.

## Adding experiments

Edit `scenarios.mjs`:
- **New matchup:** add to `SCENARIOS` with `player`/`enemy` defs.
- **New value question:** add to `SWEEPS` with `base`, `varying` (label),
  `values`, and `mutate(player, enemy, value)` (mutates a fresh clone).
- **New skill/relic:** add a `SKILLS` entry (effect types in `engine.mjs`
  header) or a `passives: [{ trigger, type, … }]` array on a combatant.

## Agent workflow (the "process the file later" step)

1. Run `run.mjs` with the configuration you want measured (and a fixed seed for
   reproducibility).
2. Hand `out/results.json` to an analysis agent (or extend `analyze.mjs`). The
   file is self-describing: it carries the combatant defs, the knobs used, and
   every aggregate.
3. Ask the agent to derive: fight-length vs target pacing, marginal value curves
   (diminishing returns), the HP↔Attack exchange and how it shifts with fight
   length (research §11.1), and fair skill damage/cost (research §14) by
   comparing win-rate/turns deltas across sweeps.
4. Feed conclusions back into the recommended values in the research doc, then
   re-run to confirm.
