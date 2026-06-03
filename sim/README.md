# Battle Simulator (headless, real board + smart AI)

A dependency-free simulator that plays out fights on a **real 8×8 match-3 board**
with a **greedy "smart" AI**, to tune stat / skill / enemy values. No rendering,
no real `BattleController` — but unlike the earlier abstract version, the board,
matches, shapes, and cascades are genuine, so the AI makes localized best-move
decisions and the economy (skull matches/turn, 4+ rate, cascade depth, mana/turn)
is **measured rather than assumed**.

Lives outside `src/` on purpose — a tuning tool, not shipped code.

## Run

```bash
node sim/run.mjs                  # 1500 runs/point, seed 12345 → sim/out/results.json
node sim/run.mjs --runs 4000 --seed 7
node sim/analyze.mjs              # pacing, measured economy, marginal values, HP↔Attack
```

Pure ESM (`.mjs`), no install, no `package.json` changes. Node ≥ 16.
The real board is heavier than the old abstract model, so the default run count is
lower (1500). Raise it for tighter win rates; lower it (or trim `SWEEPS`) if slow.

## Files

| File | Role |
|---|---|
| `board.mjs` | Real 8×8 board — faithful port of `BoardModel` + spawn weights. Swap, connected-match/shape detection, gravity, refill, create/destroy tiles, clone. |
| `model.mjs` | Seedable RNG + faithful numeric formulas (skull damage, armor→block→HP). |
| `engine.mjs` | The battle + **smart AI**. `runBattle(player, enemy, seed)`. Evaluates every swap, scores matches, casts skills when they score higher, resolves real cascades. AI knobs in the exported `AI` object. |
| `scenarios.mjs` | Combatants, fixed `SCENARIOS`, and `SWEEPS` (incl. skill cost→damage ratio). **Edit this to add experiments.** |
| `run.mjs` | Runs everything N times, aggregates, writes `sim/out/results.json`. |
| `analyze.mjs` | Pacing table, measured-economy table, per-sweep marginal values, HP↔Attack exchange. |

## How the AI decides (the "smart localized" part)

Each turn the active side:
1. **Scores every legal swap** on the real board (cheap match-prune first): skull
   matches → damage (`skullCount + attack−1`); color matches → mana × its value;
   **+4 bonus for any 4+ (extra turn)**; small bonuses for shapes and bigger clears
   (cascade potential). Picks the highest-scoring swap.
2. **Values affordable skills** in the same HPe units and **casts one instead** if
   it scores higher (heals only count when hurt).
3. **Mana is valued by what it unlocks:** a color's worth = the best damage skill's
   `value ÷ cost` (HPe per mana). So a *better* skill (higher cost→damage ratio)
   makes the AI build toward it; a weak skill makes it just match skulls. This is
   exactly why the cost→damage ratio sweeps are meaningful.
4. The chosen action executes on the real board and the **real cascade** resolves
   (gravity + random refill), granting rewards per step; a 4+ anywhere → extra turn
   (chained, capped).

A side with no damage skill naturally skull-focuses. Both player and enemy use the
same AI, so enemy Attack now matters (higher Attack → skull matches score higher →
the enemy prefers them).

AI weights live in the exported `AI` object in `engine.mjs`
(`EXTRA_TURN_VALUE`, `BASE_MANA_VALUE`, `HEAL_HP_THRESHOLD`, …) — tunable.

## Output schema (`results.json`)

```jsonc
{
  "meta": { "seed", "runsPerPoint", "aiWeights": { … } },
  "scenarios": [ { "name", "player": {…}, "enemy": {…}, "aggregates": {…} } ],
  "sweeps":    [ { "name", "note", "varying", "points": [ { "value", "aggregates" } ] } ]
}
```

`aggregates`:

| field | meaning |
|---|---|
| `winRate` | player win fraction |
| `playerActions` | `{mean, median, p10, p90}` — turns to resolve (pacing) |
| `playerHpFracOnWin` | avg HP left on a win (lethality) |
| `playerHpFrac` | `{mean, median}` over all runs |
| `playerDPT` | damage dealt per player action |
| `avgSkillCasts` | skills cast per fight |
| `skullGroupsPerAction` | **measured `m`** (skull matches/turn) |
| `fourPlusPerAction` | **measured** extra-turn rate |
| `cascadeStepsPerAction` | **measured** cascade depth (>1 ⇒ chains) |
| `manaPerAction` | **measured** mana income/turn |

The last four replace the constants the old abstract model assumed.

## Fidelity — modeled vs simplified

**Faithful:** real grid, connected-match/shape detection, gravity, random refill,
real cascades, matched/destroyed skull formulas, armor→block→HP, mana costs,
extra-turn-on-4+, `create_tiles`/`destroy_row` board effects, the common passive
triggers.

**Greedy, not optimal / simplified:**
- The AI is **one-ply** — it scores the immediate post-swap matches (like the real
  `EnemyAI`), not multi-step cascade lookahead (refills are random anyway). It values
  4+ and big clears, so it *seeks* cascades without foreseeing them.
- Skill/board passives that touch the board (spawn-rate relics, convert/destroy
  passives) aren't modeled yet — only atomic passives (damage/armor/heal/mana/attack/
  reduce_damage) and `create_tiles`/`destroy_row` on skills.
- No "no legal move" subtlety beyond a full reshuffle.

Treat relative signals (sweep slopes, A-vs-B) as the real output; turn a knob and
re-run when an absolute number must be precise.

## Adding experiments (`scenarios.mjs`)

- **Matchup:** add to `SCENARIOS`.
- **Value question:** add to `SWEEPS` with `base`, `varying` (label), `values`,
  and `mutate(player, enemy, value)`.
- **Skill cost→damage ratio:** see `skill_ratio_value_cost5/8` — `ratioPlayer(cost, dmg)`
  builds a one-skill kit; the sweep sets `damage = round(cost × ratio)`.
- **Skill/relic:** add a `SKILLS` entry or a `passives:[{trigger,type,…}]` array.

## Agent workflow ("process the file later")

1. Run `run.mjs` (fixed seed) with the experiments you want.
2. Hand `out/results.json` to an analysis agent (or extend `analyze.mjs`). It carries
   the combatant defs, AI knobs, and every aggregate.
3. Ask it to derive: pacing vs target, marginal stat curves (diminishing returns),
   the HP↔Attack exchange and how it shifts with fight length, the skill cost→damage
   ratio threshold where a skill beats the skull baseline, and fair enemy HP/Attack.
4. Fold conclusions into the research doc's recommended values, then re-run to confirm.
