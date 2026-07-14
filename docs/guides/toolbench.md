# Toolbench (sim/)

**Load this when:** running balance simulations, training/evaluating/measuring the battle AI, editing anything under `sim/toolbench/`, or changing anything in `src/` that the sim engine mirrors (see the [Maintenance contract](#-maintenance-contract)).

This guide is the CANONICAL REFERENCE for the toolbench's architecture, modules, and invariants. The step-by-step **training/measurement workflow** (command cookbook, tournament protocol, how to read results) lives in [`.claude/skills/gems-ai-training/SKILL.md`](../../.claude/skills/gems-ai-training/SKILL.md) — do not duplicate it, follow it.

---

## Ground rules

- **WSL.** This project is in WSL. Assume linux commands; the base of the project is at `~/test/game/gems`. Never use powershell commands, and never include `wsl.localhost` in `grep`/`ls` etc. commands.
- **The LEGACY `sim/` scripts are BANNED.** Do **NOT** run or update `node sim/test-*.mjs`, `sim/run.mjs`, `sim/engine.mjs`, or `sim/combat-balance-bench.html`. Ignore any "Tests: `node sim/...`" / "After You Edit" instruction anywhere in the repo that says to run or maintain them — they are stale and should not be acted on. (The EXCEPTION is everything under `sim/toolbench/` plus `sim/balance-bench.html` / `sim/balance-toolbench.html`, which are current tooling.)
- **`sim/toolbench/reports/` is gitignored.** NEVER leave the only copy of good weights there — promote keepers (see [Champion weights lifecycle](#champion-weights-lifecycle)).
- **`withSeededRandom` swaps the GLOBAL `Math.random`** — so never battle on the main thread in the browser. All browser sim runs go through module Web Workers.

---

## Balance Bench v2

**`sim/balance-bench.html` + `sim/toolbench/ui/` is the PRIMARY browser bench (2026-07-08).** Design doc: [`docs/balance-bench-v2-design.md`](../balance-bench-v2-design.md).

**Serve the repo root:**

```bash
node sim/toolbench/serve.mjs      # → http://localhost:8123/sim/balance-bench.html
```

### Tabs

| Tab | What it does |
|-----|--------------|
| **Bench** | The WEIGH SCALE — seeded Monte-Carlo streamed in waves; tilt = logit(win%), heavier side SINKS, CI wedge at the pivot, green fair-band arc, pans = √(DPT×HP) split by damage source; both-brackets ghost needle. |
| **Compare** | Paired common-seed A/B → ΔWin±CI / eqHP / ΔCasts, plus a catalog-wide relic table with a shared cached baseline. |
| **Floors** | Build × floors 1–10 vs spawn pool or fixed enemy, both AI brackets. |
| **Runs** | Full-run RCT via run-core in Web Workers; JSONL import/export interops with the CLI. |
| **Weave** | Real draft tables + synthesizer → skill card + wasted reasons → paired measure / add-to-build / save; power-distribution percentiles. |
| **Designer / Audit / Reference** | Ported from v1. Designer A/B tests are now PAIRED; Reference has a browser↔node parity digest. |

### AI selector (everywhere)

- **Simple** (greedy)
- **Hard** (champion, fetched from `CHAMPION_WEIGHTS_PATH`, provenance shown)
- **custom weights JSON** (auto-detects formula-vs-value keys)
- **value-search** (experimental)

### Worker + browser-safe contract

- Sim runs **ONLY** in module Web Workers. `ui/bench-worker.mjs` mirrors `pool-worker.mjs` task-for-task — same seeds ⇒ identical results as node. `withSeededRandom` swaps GLOBAL `Math.random`, so **never battle on the main thread**.
- `ui/pool.mjs` = `hardwareConcurrency − 1` workers, serialized jobs, ordered results, cancel tokens.
- **BROWSER-SAFE CONTRACT** (guard: `node sim/toolbench/browser-safe-check.mjs`): `engine` / `formula` / `policy` / `policies` / `run-core` / `run-analyze` / `measure` / `rng` / `analytic` / `features` carry **NO static `node:` imports**. Node-only loaders live in `weights-node.mjs` (`loadChampionWeights`).
- **Scripted smoke:** `?tab=bench&autorun=1&ai=simple` weighs once and POSTs a `[bench]` result beacon to `serve.mjs`.

### v1 toolbench (superseded, retained)

`sim/balance-toolbench.html` + `sim/toolbench/` is the original Balance Toolbench (2026-07). It imports the LIVE game modules/catalogs (`BoardModel`, `MatchResolver`, skill/relic/character/enemy catalogs) and runs headless Monte-Carlo battles in the browser (tabs: Matchup Lab / Run Simulator / Sweep Lab / Designer / Catalog Audit / Reference). Serve the repo root (`node sim/toolbench/serve.mjs` → `http://localhost:8123/sim/balance-toolbench.html`). **Prefer the v2 bench**; Designer customs share the same localStorage key across both.

Node smoke checks: `node sim/toolbench/smoke.mjs` / `smoke-analytic.mjs` / `smoke-trainer.mjs`.

---

## Module map

| Module | What it is |
|--------|-----------|
| `engine.mjs` | The headless battle/run engine feeding the WHOLE toolbench (trainer/runs/learn/analytic). Its `Battle` accepts `opts.playerPolicy` / `opts.enemyPolicy` (cast/swap/pass actions, cast-hold, target override — see the engine header's **POLICY SEAM**). Also `engine.simulateRun` (extended with `battleOpts` / `onReward` / `weave` hooks). The built-in greedy AI HOLDS convert-only skills (Arcane Inscription) unless the convert completes a 4+/extra turn. **Mirrors constants from src — see the maintenance contract.** |
| `formula.mjs` | **The deterministic champion policy.** Since 2026-07-08 a RE-EXPORT SHIM of [`src/js/game/ai/formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js) — edit the src file; the shim keeps every toolbench import working. Exports `makeFormulaPolicy`, spec `{kind:'formula',weights}`, `DEFAULT_FORMULA_WEIGHTS` / `FORMULA_WEIGHT_KEYS`, `CHAMPION_WEIGHTS_PATH`. |
| [`src/js/game/ai/formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js) | The promoted source of truth for the formula policy — the SAME module powers the in-game hint system (architecture decision #45). Browser-safe. |
| `policy.mjs` | The preview **SEARCH POLICY** (experiments only — see the pathway-dominance verdict below). |
| `policies.mjs` | Shared spec→policy resolver (used by `pool-worker` + `bench-worker`). |
| `trainer.mjs` | The MEASURED-power harness: catalog-wide sim-uplift A/B sweeps, enemy win-rate bands, and `rescore`. |
| `train.mjs` | CEM trainer — trains weights by self-play/run-survival CEM. |
| `runs.mjs` | The FULL-RUN measurement layer: `simulate` (seeded policy-driven 10-floor runs → JSONL) + `analyze` (run health, deaths-by-enemy, RCT deltas). Re-exports run-core/run-analyze so the CLI is unchanged. |
| `run-core.mjs` | `runOneRun`, extracted from `runs.mjs` (browser-safe). |
| `run-analyze.mjs` | The RCT math, extracted from `runs.mjs` (browser-safe). |
| `learn.mjs` | The LEARNED-VALUE layer: `collect` (self-play episodes) / `fit` (MC regression) / `fit-td` (fitted TD(λ)) / `gate1` (the TD-vs-MC decision experiment). |
| `features.mjs` | Featurizes a battle state with DESCRIPTIVE facts only (HP/mana/board composition/affordability/`selfToMove` — zero value judgments). Exports `boardTensor` (64 tile ints); `TILE_INDEX` / `TILE_PLANES` = the spatial-encoding contract. |
| `nn.mjs` | Runs the Python-trained conv-net forward pass in JS (`makeConvPolicy`; pool spec `{kind:'conv',model}`). |
| `python/train_td_conv.py` | **Phase B (GPU):** trains a conv-net V (one-hot board planes + flat features) with the SAME fitted-TD(λ) algorithm in PyTorch/CUDA on collected episodes; exports plain-JSON weights + parity vectors. |
| `measure.mjs` | `pairedStats` / `eqHpFrom` / `wilson95`, extracted from `trainer.mjs` (browser-safe). |
| `pool.mjs` | `worker_threads` worker pool (cpus−1; `GEMS_POOL_WORKERS` env overrides). |
| `pool-worker.mjs` | The pool worker: task types `battle` / `run` / `collect`, calling the shared helpers (`runs.runOneRun`, `learn.collectOneBattle`). |
| `rng.mjs` | `withSeededRandom` — seeding for paired common-seed batches. **Swaps GLOBAL `Math.random`.** |
| `analytic.mjs` | The analytic power model (the price-the-item side of the balance loop; `trainer.mjs rescore` prints correction suggestions for it). |
| `weights-node.mjs` | Node-only weight loaders (`loadChampionWeights`) — kept out of the browser-safe modules. |
| `drift-check.mjs` | Verifies the mirrored constants in `engine.mjs` against live `src/`. **Run FIRST, always.** |
| `browser-safe-check.mjs` | Guards the browser-safe contract (no static `node:` imports in the listed modules). |

---

## The policy stack

### Greedy (shipped baseline)

The engine's built-in greedy AI. ~2.5% avg run survival — the "shipped player" bracket / struggling-player baseline.

### Formula (DETERMINISTIC — the champion, the deployment policy)

`sim/toolbench/formula.mjs` → [`src/js/game/ai/formulaPolicy.js`](../../src/js/game/ai/formulaPolicy.js). `makeFormulaPolicy`, spec `{kind:'formula',weights}`, `DEFAULT_FORMULA_WEIGHTS` / `FORMULA_WEIGHT_KEYS`.

- Swaps via a **no-refill settle**; casts via **per-effect formulas**.
- **Deterministic TARGET ENUMERATION** for destroy-row / destroy-column / area and `convert_tile` — each target is no-refill-simulated, giving noise-free high-elo targeting.
- **Deterministic CHAIN SEARCH:** extra-turn triggers recurse into the best follow-up on the settled no-refill board. It is **UPSIDE-ONLY** over the flat `extraTurn` weight — the settle is a lower bound, so replacing the weight outright scares the policy off tempo.
- Train it via `train.mjs --evaluator formula [--seedWeights f]` (the genome switches to `FORMULA_WEIGHT_KEYS`; multi-start injects raw defaults at gen 1). Run datasets via `runs.mjs simulate --formula <weights.json>`.
- **Prefer formula for deployment and measurement.**

### Preview-search (`policy.mjs`) — experiments only

Reworked 2026-07-06 for "high-elo" play, using the chess-engine split — rules vs judgment:

- `enumerateActions` is the **MOVE GENERATOR** (every legal swap + every affordable cast × every TARGET of a targeted skill — each fracture row / inscription spot is its own candidate; swaps beyond a beam are prefiltered by a cheap no-refill settle that always keeps extra-turn triggers).
- `previewAction` / `previewBattle` **SIMULATE** each candidate through the REAL engine on a disposable clone (cascades, refill, relic passives, statuses all fire — a fast combatant clone shares immutable skill/relic defs).
- An **extra-turn CHAIN SEARCH** recursively evaluates the best follow-up on turn-retaining actions (discounted; `chainDepth` / `swapBeam` / `chainSwapBeam` opts) so inscription→4+→fracture combos are scored as one plan.
- ALL judgment lives in a pluggable EVALUATOR: `makeDeltaEvaluator(weights)` scores observed before→after deltas (`DEFAULT_VALUE_WEIGHTS` = the CEM training surface — **retrain with `train.mjs` whenever the evaluator/action space changes; old weight JSONs load but are stale**). `makeValuePolicy(weights, opts)` = delta evaluator + search; sweep via `trainer.mjs ... --policy value` / `--weights <json>`.

### Learned V (`learn.mjs` / `nn.mjs`)

`learn.mjs` supplies a learned V(afterstate) evaluator (`mode:'replace'` — chain evaluations supersede the leaf), plugged into the SEARCH policy via `makeLearnedPolicy(loadModel(f))`. `nn.mjs` runs the GPU-trained conv-net (`makeConvPolicy`; pool spec `{kind:'conv',model}`).

> ⚠ **After ANY (re)training, verify parity before use:**
> `node sim/toolbench/nn.mjs parity <model.json> <model.json>.parity.json`

### ⚠ MEASURED VERDICT (2026-07-07): preview-based evaluation LOSES ~2.5× deployment strength to deterministic evaluation

Refill noise inside previews (even CRN-seeded) corrupts the argmax over ~150 decisions/run:

- **formula + v1 weights = 38.3% run survival** vs **14.0% for the SAME weights on preview-search.**

### ⚠ Pathway dominance (measured, 2026-07-07)

**Every preview-pathway policy lands at 10–17% run survival, and every deterministic-pathway policy at 23–45% — regardless of evaluator quality.** A GPU conv-net (gate 3, champion-quality data, 78% outcome-accuracy) still scored **11.8%** through the preview path.

> **Consequence: any future neural evaluator MUST consume DETERMINISTIC settled states.**

The preview-search stack remains only for experiments needing full-fidelity effect simulation.

---

## Champion weights lifecycle

**Champion config (TRACKED): [`src/assets/data/formula-champion.json`](../../src/assets/data/formula-champion.json)** — MOVED 2026-07-08 from `sim/toolbench/weights/`. It is a **GAME ASSET** now: the in-battle hint system fetches it and the Vite build ships it verbatim. Provenance is stamped inside. These are the WORKING weights (**~45% avg run survival vs 2.5% shipped-greedy**).

**Use them:**

- CLI: `runs.mjs simulate --champion` (or bare `--formula`)
- Code: `makeFormulaPolicy(loadChampionWeights())` — `CHAMPION_WEIGHTS_PATH` (exported from `formula.mjs` / `formulaPolicy.js`) points at the new location.
- Browser: fetch via [`src/js/game/ai/hintWeights.js`](../../src/js/game/ai/hintWeights.js), or the bench's `initChampion`.

**Promotion:**

> ⚠ `sim/toolbench/reports/` is **gitignored** — NEVER leave the only copy of good weights there.

Promote keepers via `sim/toolbench/reports/promote-champion.mjs` (writes to `src/assets/data/`). Other keeper (non-champion) weights go to `sim/toolbench/weights/`.

---

## ⚠ Maintenance contract

**SHARED (no sync needed):** the per-floor enemy curves `ENEMY_HP_FLOOR_MULT` / `ENEMY_ATTACK_FLOOR_BONUS` live in the SHARED, dependency-free [`src/js/data/enemyScaling.js`](../../src/js/data/enemyScaling.js), imported by BOTH `MapScene.js` (game) and `sim/toolbench/engine.mjs` (which feeds the whole toolbench — trainer/runs/learn/analytic). Retuning the curve there is picked up by testing/training **AUTOMATICALLY**.

**MIRRORED (you MUST sync by hand):** `engine.mjs` still mirrors a few non-exported constants. If you change THESE in `src/`, update `engine.mjs` (and the doc's tables) to match:

| Constant | Lives in |
|----------|----------|
| `MAGIC_MANA_PER_POINT` | `BattleController` |
| `STATUS_DAMAGE_MODS` | `BattleController` |
| `POISON_DECAY_DIVISOR` | `BattleController` |
| `DEFAULT_GROWTH_PLAN` | `BattleScene` |

**Verify the lot:**

```bash
node sim/toolbench/drift-check.mjs
```

---

## Training & measurement

> **The workflow — command cookbook, hard-won invariants, tournament protocol, how to read results — lives in [`.claude/skills/gems-ai-training/SKILL.md`](../../.claude/skills/gems-ai-training/SKILL.md). Follow that skill for any training or run-measurement session.** What follows is only the entry-point reference.

### `trainer.mjs` — the MEASURED-power harness (per-battle sweeps)

```bash
node sim/toolbench/trainer.mjs skills|relics|stats|all [--quick] [--n N] [--floors 2,5,8] \
  [--hosts ids|owner] [--skills ids] [--relics ids]
```

Catalog-wide sim-uplift A/B sweeps using **PAIRED common-seed batches** (`sim/toolbench/rng.mjs` `withSeededRandom`; baselines cached + shared across items) → **ΔWin ± CI**, **eqHP** (ΔWin ÷ measured win-per-HP slope), **Δcasts / NEVER-CAST**, and analytic-vs-measured **UNDER-/OVER-SCORED** rank flags. JSON reports land in `sim/toolbench/reports/` (gitignored).

Sweeps are still **serial** (adopt the pool if they get hot).

### `trainer.mjs rescore`

```bash
node sim/toolbench/trainer.mjs rescore [--report skills-*.json]
```

Fits per-effect-type DEV correction multipliers from a skills sweep's measured eqHP (ridge regression, prior = 1 = "analytic price is right"; degenerate items — analytic dev > 100 or |ΔWin| > 30pp — are DISREGARDED with a printed reason) and prints RAISE/LOWER suggestions for `analytic.mjs`. **It never auto-edits.** When applying, re-align `SYNTH_POWER` / weaveConfig `POWER` per the doc contract.

### `train.mjs` — CEM

Trains weights by CEM self-play over a fixed common-seed task pool on **floors WITH WIN-RATE HEADROOM** (default 6/8/9 × all hosts — saturated 100%-win tasks give no gradient). `--selfplay k` re-arms the enemy with best-so-far weights. Outputs a weights JSON. Train the formula genome with `--evaluator formula [--seedWeights f]`.

### `runs.mjs` — the FULL-RUN measurement layer (PRIMARY power unit)

Added 2026-07-06 and now the PRIMARY power-measurement unit, since per-battle uplift under-rates ramp/economy items and misses interactions.

```bash
node sim/toolbench/runs.mjs simulate [--n N] [--chars all] [--policy greedy|value] \
  [--weights f] [--weaveChance 0.35] [--analyze]
node sim/toolbench/runs.mjs analyze [--log f]
```

**`simulate`** plays seeded, policy-driven FULL 10-floor runs via `engine.simulateRun` where the player starts with ONLY the character kit and acquires everything in-run:

- Relic rewards are the game's real rarity-weighted 3-option roll with a **UNIFORM-RANDOM pick** (realistic exposure, zero selection bias — each reward node is a randomized trial).
- **2 pre-sampled TRAINING floors per run** (`--weaves 2` — design target ~2 weaves/act; a training node REPLACES that floor's fight, like a real map path) grant woven skills via a random-of-offered tag draft through the REAL `drawTagsForRound` / `synthesize` pipeline, so weave-tag power is measured in context. `runs.mjs` exports `makeRandomWovenSkill`; `learn.mjs collect` deals random relics + wovens into its training battles so the learned V sees realistic states.
- Output = **JSONL in `reports/`** (one run per line, seed included → any death is replayable).

**`analyze`** computes:

- **Run-health metrics** — per-char survival, death-floor histogram, per-floor win curve (the TOP-LEVEL balance target).
- **Deaths-by-enemy killer table** (`res.enemies`, 2026-07-09) — per enemy: deaths, share of all deaths, per-floor death breakdown, avg player turns in the FATAL fight, plus all-encounter fights/win-rate context. Rendered as the "Deaths by enemy" panel in the bench Runs tab and printed by the CLI analyze.
- **Per-relic and per-weave-tag RCT deltas** — picked vs offered-but-not-picked, forward outcomes: ΔSurvival ± SE, ΔFloors, ΔNextWin.
- **Per-CHARACTER relic split** — flags relics whose per-char ΔSurv spread > 10pp.
- **Color-synergy conditional** — color-linked relics (spawn / mana-gain / potion / attack-per-unspent / reactor): ΔSurv WITH that color in the build (kit + wovens acquired before the event) vs WITHOUT — the "is flint good for a red build?" view.
- An exploratory **relic-pair synergy scan** (the Cestus × starting-mana detector).

> **Tune enemies/relics against BOTH skill brackets:** greedy = struggling player, trained value/formula = expert.

### `learn.mjs` — the LEARNED-VALUE layer ("plays without knowing why")

- `collect` — records self-play EPISODES: per-side afterstate SEQUENCES `{xs:[{f,b}],y}` via `episodeRecorder` (both sides run REAL policies + ε-exploration so afterstates are observable).
- `fit` — Monte-Carlo outcome regression (flattens episodes).
- `fit-td` — **fitted TD(λ)**: per-decision credit assignment, the TD-Gammon recipe (λ-returns recomputed from a frozen model each sweep).
- `gate1 [--battles N] [--weights cem.json]` — the decision experiment: TD vs MC on identical data/features, judged on confirmed RUN SURVIVAL; prints a PASS/FAIL/INCONCLUSIVE verdict.

### Worker pool

`train.mjs` / `runs.mjs` / `learn.mjs` all fan battles across the `worker_threads` pool (`pool.mjs` + `pool-worker.mjs`; cpus−1 workers, `GEMS_POOL_WORKERS` env overrides). **Every task is fully seeded, so scheduling NEVER changes results — only wall-clock (~30× on a 32-thread box: a CEM generation 5min→3s, 100 policy runs 40s→6s).** Policies travel as serializable SPECS (`null` = greedy, `{kind:'value',weights}`, `{kind:'learned',model}`, `{kind:'formula',weights}`, `{kind:'conv',model}`), resolved + cached worker-side via the per-map `context.policies` dict.

---

## Reference docs

| Doc | What it covers |
|-----|----------------|
| [`docs/balance-power-model.md`](../balance-power-model.md) | **The master balance reference.** Learned-value / GPU details: §6.3 and §9. |
| [`docs/balance-bench-v2-design.md`](../balance-bench-v2-design.md) | Balance Bench v2 design. |
| [`docs/balance-combat-math.md`](../balance-combat-math.md) | Combat math (HP/attack curves, per-floor scaling). |
| [`docs/balance-findings.md`](../balance-findings.md) | Sim-derived budgets and findings. |
| [`.claude/skills/gems-ai-training/SKILL.md`](../../.claude/skills/gems-ai-training/SKILL.md) | The training & measurement WORKFLOW (cookbook, invariants, tournaments). |
