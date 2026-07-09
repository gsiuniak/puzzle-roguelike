# Balance Bench v2 — Design (2026-07-08)

> **Status: IMPLEMENTED 2026-07-08** — `sim/balance-bench.html` + `sim/toolbench/ui/*`.
> Phase 0 extraction: `weights-node.mjs`, `policies.mjs`, `run-core.mjs`,
> `run-analyze.mjs`, `measure.mjs`, guarded by `browser-safe-check.mjs`; all
> node smokes + an end-to-end champion `runs.mjs simulate --analyze` verified
> unchanged. Deviations from the design: fonts stay on Google Fonts with
> system fallbacks (not bundled); the parity check is a manual digest button
> in Reference (not a committed fixture); scripted smoke = `?autorun=1` + a
> POST beacon logged by serve.mjs. v1 `balance-toolbench.html` retained until
> the user retires it.
> Successor to `sim/balance-toolbench.html`, borrowing the instrument look/feel of the
> legacy `sim/combat-balance-bench.html`, and — the core upgrade — putting the whole
> MEASURED stack (formula champion policy, paired-seed A/B methodology, full-run RCT
> layer) behind a browser UI instead of node-CLI-only.

---

## 1. Goal

One browser workbench where every number is **measured on the real engine** (seeded
Monte-Carlo through `engine.mjs`, the same modules the game runs), with the trained
AI selectable, presented with the precision-instrument design language of
`combat-balance-bench.html` (which itself stays untouched as a legacy reference —
we take its CSS/composition, not its analytic DEV model).

User-stated requirements → where they land:

| Requirement | Tab (see §4) |
|---|---|
| Use the trained weights + training-era logic | AI selector (§3.4), everywhere |
| Comparison test, combat-balance-bench look/feel | **Bench** (§4.1) + shared design tokens (§3.3) |
| Compare relics / relative strengths | **Compare** (§4.2) — paired A/B + catalog-wide relic table |
| Character at different floors, against enemies | **Floors** (§4.3) |
| Tweak enemies | inline overrides in Bench/Compare + carried-over **Designer** (§4.6) |
| Weave a skill, compare relative strength | **Weave** (§4.5) |
| Load "hard" or "simple" AI | AI selector (§3.4): greedy / formula-champion / custom weights |

Non-goals: training in the browser (CEM/TD stays CLI/GPU); replacing `trainer.mjs`
CLI sweeps (they remain the batch harness — the bench shares their math so numbers
agree); touching the legacy `sim/` scripts.

---

## 2. Current state and the gaps

| Capability | Lives today | Gap |
|---|---|---|
| Instrument look/feel (beam, verdict chips, floor stepper, breakdown bars) | `combat-balance-bench.html` | Analytic-only, baked-in fallback data, no simulation |
| Sim matchup lab | `balance-toolbench.html` Matchup Lab | Greedy AI only, main-thread (slow/blocking), independent seeds (no pairing → noisy deltas), utilitarian styling |
| Paired A/B, ΔWin ± CI, eqHP | `trainer.mjs` (node CLI) | Math is inline in the CLI; not importable by a browser |
| Full runs + relic RCT analysis | `runs.mjs` (node CLI) | Top-level `node:fs/path/readline` imports block browser use |
| Champion policy | `formula.mjs` | Top-level `import { readFileSync } from 'node:fs'` blocks browser import; weights JSON is fetchable but the loader isn't |
| Policy spec → policy resolution | `pool-worker.mjs` (node worker) | Node-only file; the spec dict logic is browser-safe but not extracted |
| Parallelism | `pool.mjs` (node `worker_threads`) | Browser needs its own Web-Worker pool |
| Weave synthesis | `src/js/data/skillSynthesizer.js` + tags/config | Already browser-safe ✔ (the game runs it) |
| Enemy/skill/relic designer + customs | `balance-toolbench.html` Designer (localStorage) | Keep; restyle; wire into the new measured flows |

Browser-clean already: `engine.mjs`, `policy.mjs`, `rng.mjs`, `analytic.mjs`,
`features.mjs`, all of `src/js/**`. Node-locked: `formula.mjs` (1 import),
`runs.mjs`, `trainer.mjs`, `learn.mjs`, `nn.mjs`, `pool.mjs`, `pool-worker.mjs`,
`train.mjs`.

---

## 3. Architecture

### 3.1 Phase 0 — core extraction (make the measurement stack isomorphic)

Small, behavior-preserving refactors so node CLI and browser import the SAME code.
All in `sim/toolbench/`:

1. **`formula.mjs` — drop the `node:fs` import.**
   `loadChampionWeights()` moves to a new node-only **`weights-node.mjs`**
   (`readFileSync(CHAMPION_WEIGHTS_PATH)`). `CHAMPION_WEIGHTS_PATH` stays exported
   from `formula.mjs` — `new URL('./weights/formula-champion.json', import.meta.url)`
   resolves to an http URL in the browser, so the browser loader is just
   `loadFormulaWeights(await (await fetch(CHAMPION_WEIGHTS_PATH)).json())`.
   *(2026-07-08 update: formula.mjs was later promoted to
   `src/js/game/ai/formulaPolicy.js` (sim file = re-export shim) and the champion
   JSON moved to `src/assets/data/formula-champion.json` for the in-game hint
   system — CHAMPION_WEIGHTS_PATH now points there; everything else holds.)*
   Update the ~4 CLI callers (`trainer.mjs`, `runs.mjs`, `train.mjs`, docs snippets).

2. **`policies.mjs` (new, browser-safe)** — extract `resolvePolicySpec(spec)` from
   `pool-worker.mjs`: `null` → greedy; `{kind:'formula',weights,opts}` →
   `makeFormulaPolicy`; `{kind:'value',weights,opts}` → `makeValuePolicy`.
   The node-only kinds (`learned`, `conv`) stay behind `await import(...)` guards
   exactly as they are today (dynamic import never executes in the browser unless
   selected — and we don't offer them there). `pool-worker.mjs` delegates to it.

3. **`run-core.mjs` (new, browser-safe)** — extract from `runs.mjs`: `runOneRun`,
   `makeRandomWovenSkill`, and the run-record shape. `runs.mjs` keeps the CLI,
   JSONL I/O, and pool fan-out, re-exporting from run-core for back-compat
   (learn.mjs imports `makeRandomWovenSkill` from runs.mjs today).

4. **`run-analyze.mjs` (new, browser-safe, pure)** — the `runs.mjs analyze`
   computations (per-floor curves, per-relic RCT deltas, per-char split,
   color-synergy conditional, pair scan) as pure functions over in-memory run
   arrays. CLI `analyze` wraps it with JSONL reading.

5. **`measure.mjs` (new, browser-safe, pure)** — the paired-batch math extracted
   from `trainer.mjs`: `pairedStats(base, variant)` (per-seed diffs → ΔWin ± 95% CI),
   the win-per-HP slope / `eqHpFrom` conversion, casts-per-fight + NEVER-CAST
   detection. `trainer.mjs` refactors to consume it so CLI and bench numbers are
   the same code path.

6. **Guard** — add a tiny node check (extend `drift-check.mjs` or a new
   `browser-safe-check.mjs`) that greps the browser-safe set
   (`engine, formula, policy, policies, run-core, run-analyze, measure, rng,
   analytic, features`) for `node:` imports and fails loudly. Re-run all smokes
   (`smoke.mjs`, `smoke-analytic.mjs`, `smoke-trainer.mjs`, `drift-check.mjs`)
   after the refactor — Phase 0 must be a no-op for the CLI stack.

### 3.2 Browser worker pool

Simulation NEVER runs on the page's main thread — both for responsiveness and
because `withSeededRandom` swaps the **global** `Math.random` (safe inside a
single-threaded worker; hazardous next to UI rAF code).

- **`sim/toolbench/ui/bench-worker.mjs`** — a module Worker (`{type:'module'}`)
  importing `engine.mjs`, `policies.mjs`, `run-core.mjs`, `rng.mjs`. Message
  protocol mirrors `pool-worker.mjs`: a `context` message carries the serializable
  policy-spec dict (resolved+cached worker-side); `task` messages are fully
  seeded `battle` / `run` jobs. Same task shapes as the node pool → a browser
  batch and a node batch on the same seeds produce **identical results**.
- **`sim/toolbench/ui/pool.mjs`** — spawns `min(navigator.hardwareConcurrency - 1, 12)`
  workers; task queue, per-batch progress callback, cancellation token, results
  keyed by task id (scheduling never changes results — same invariant as node).
- Fallback: no module-worker support → chunked main-thread execution with
  yield-to-UI (the current `runBatchAsync` pattern), greedy-AI only, with a
  visible "degraded" badge.
- `serve.mjs` already serves `.mjs` from the repo root; verify its content-type
  for module workers (must be a JS MIME).

### 3.3 UI shell

- **New page `sim/balance-bench.html`** — a thin shell (tokens + `<div id=root>` +
  one module import). The 1,200-line-inline-script pattern of the current
  toolbench doesn't scale to this feature set; the app lives in
  **`sim/toolbench/ui/`** modules:
  - `app.mjs` — boot, tab router, error screen (http-serve hint, same as today)
  - `store.mjs` — shared config (player build, enemy config, AI per side, N),
    localStorage persistence, **merging the existing `gems-toolbench-customs-v1`
    store** so Designer content carries over
  - `components.mjs` — charts (line/histogram/share-bars), the **balance beam**,
    verdict chips, stat tiles, progress bar, combatant editor panels
  - `views/bench.mjs`, `views/compare.mjs`, `views/floors.mjs`, `views/runs.mjs`,
    `views/weave.mjs`, `views/designer.mjs`, `views/audit.mjs`, `views/reference.mjs`
- **Design language: lift `combat-balance-bench.html`'s tokens verbatim** — the
  `:root` block (indigo `#0E1119` bg, cyan `--signal` voice, muted six-tile data
  palette), Space Grotesk + JetBrains Mono, panel/eyebrow/verdict/vchip/beam/
  side-switch/floor-stepper CSS. Player speaks cyan, enemy speaks red, verdicts
  speak in chips. Fonts: bundle locally (woff2 under `sim/toolbench/ui/fonts/`)
  rather than Google Fonts so the bench works offline.
- `balance-toolbench.html` stays until the new page reaches parity, then is
  deleted (one CLAUDE.md/AGENT_ENTRYPOINT update at that point).

### 3.4 The AI selector (the "hard vs simple" seam)

A shared control rendered wherever a side acts, backed by policy SPECS (so it
serializes straight into worker context):

| Choice | Spec | Notes |
|---|---|---|
| **Simple** (shipped greedy) | `null` | The struggling-player bracket; fast (~ms/battle) |
| **Hard** (champion) | `{kind:'formula', weights}` | Weights fetched once from `CHAMPION_WEIGHTS_PATH`; provenance line (stamped inside the JSON) shown in the UI; ~45% run survival vs 2.5% greedy |
| **Custom weights** | `{kind:'formula'\|'value', weights}` | File input / paste JSON; auto-detect by key shape (`FORMULA_WEIGHT_KEYS` vs value keys); warn on unknown keys (stale-genome guard) |
| **Value-search** (experimental) | `{kind:'value', weights}` | Preview-search stack; flagged slow + "measured ~2.5× weaker deployment" per the 2026-07-07 verdict |

Default: player=**Hard**, enemy=**Simple** (enemies ship with greedy/custom AI —
that's what the game runs; `Battle` already accepts `enemyPolicy` for experiments).
Bench and Floors additionally offer **"both brackets"**: run greedy AND champion
and show the two results side by side — the design target is that content works
for both the struggling and the expert player.

---

## 4. Tabs

### 4.1 Bench — the instrument (default tab)

The combat-balance-bench composition, with every readout **measured**:

#### 4.1.1 The Weigh Scale (hero component)

The centerpiece: a physical balance-scale visual that **weighs the enemy against
the player by simulation**. It answers "who's heavier, by how much, and how sure
are we" in one glance.

**What drives the tilt — measured win probability, on a logit scale.**
The pivot question is "who wins," so the beam angle is a direct function of the
Monte-Carlo win rate, NOT an abstract power score:

- `tilt ∝ logit(winRate)` clamped to ±max-angle (logit, not linear, so the
  interesting 35–65% band gets most of the angular range and 90% vs 99% doesn't
  waste it; 50% = perfectly level).
- A **confidence arc** at the pivot renders the 95% CI (Wilson interval) as a
  shaded wedge of possible beam angles — a wide wedge literally *looks*
  unsettled. The wedge narrows as n grows.
- The **fair band** for the enemy's slot (minion 85–95% / elite 65–80% /
  boss 45–65%) renders as a green zone on the tilt gauge; the verdict chip
  (player-favored / in-band / enemy-favored / swingy) restates it in words.

**What sits in the pans — each side's measured power composite.**
Each pan holds that side's ingot stack: a composite
`power = √(measured DPT × measured eHP)` built from battle telemetry the engine
already aggregates (DPT dealt; eHP = HP + armor/barrier absorbed + healing
received per fight). The pan breaks its weight into stacked ingots — skull
damage / skills / passives / economy — so you see not just *that* a side is
heavy but *what makes it heavy*. Pan weights are descriptive (the telemetry
view); the tilt is authoritative (the outcome view). When they disagree — pans
near-even but the beam tilted — that's a real diagnostic (tempo/variance is
deciding fights, not raw stats), and the verdict text says so.

**The weighing is the animation.** Pressing **Weigh** streams batches from the
worker pool; the beam starts loose, wobbles with the early samples, and settles
as the CI wedge narrows — the Monte-Carlo convergence IS the weighing motion.
A live `n=…` counter and win% tick up beside the pivot; Cancel stops at the
current n. Auto-weigh (debounced, small n) on any config change; the big Weigh
button runs the full-n pass. With the **both-brackets toggle** the beam renders
two needles (greedy ghost-needle behind the champion needle) so the two skill
brackets read on one instrument.

**Under the beam**: the TTK pair ("player kills in N / enemy kills in M", p10–p90
whiskers) and the fight-outcome distribution strip — the same supporting cast the
legacy bench placed there.

The scale component lives in `components.mjs` as a reusable widget
(`weighScale({left, right, winRate, ci, band, brackets})`) — Compare (§4.2)
reuses it to weigh config A vs config B (tilt = paired ΔWin mapped the same
way, wedge = the paired CI), and Floors (§4.3) renders a mini-beam per floor
row as a sparkline of tilt across the run.

- **Header**: side-switch (Player/Enemy editor focus), floor stepper (1–10),
  AI selector pair, battles-N control (auto-run 200 on change, button for 1000).
- **Left column — editor** (per side-switch): character + victories(growth) +
  stat deltas + relic checklist + woven/custom skills for the player; enemy
  picker + floor + **HP/attack baseline overrides** (tweak-the-enemy inline,
  with legal-floors readout) + "open in Designer" for deep edits.
- **Right column — readouts**, re-run (debounced, cancellable, progress bar) on
  any config change:
  - **Balance beam** (the signature visual): tilts by measured win% instead of
    analytic power; CI whisker on the pivot; big win% + verdict chip vs the
    band for the enemy's slot (minion 85–95 / elite 65–80 / boss 45–65, from
    `analytic.mjs` CAL).
  - **TTK tiles**: mean turns + p10/p90, fight-length histogram.
  - **Damage-source share bars**, both sides (skull / skills / destroyed /
    passives / poison…), burst share with spiky/toothless chip.
  - **Risk row**: player death %, HP left on win, draw rate.
  - **Skill economics strip** per equipped skill: casts/fight, mana/turn,
    NEVER-CAST flag (measured, not modeled).
  - **Both-brackets toggle**: greedy and champion results rendered as paired
    columns (expert vs struggling read at a glance).

### 4.2 Compare — the generalized A/B lab

The heart of "compare relative strengths." Two config columns **A | B** (B starts
as a clone of A; edit anything: add/remove a relic, different loadout, stat delta,
different AI, enemy tweak, attach a woven skill). Run **paired common-seed
batches** (`withSeededRandom`, same seed per pair — the trainer methodology, ~10×
sample efficiency) →

- **ΔWin ± 95% CI** (from `measure.mjs pairedStats`) with a significance chip
  ("resolved" / "needs more n" + one-click double-n),
- **eqHP** (ΔWin ÷ measured win-per-HP slope on the host — "this relic is worth
  ≈ N max HP here"),
- ΔTurns, ΔCasts, per-skill cast deltas.

Presets that pre-fill B: *+relic X*, *AI greedy→champion*, *enemy +1 attack*,
*floor f→f+2*.

**Relic table mode** (the "compare relics" ask): loop the player relic catalog,
each paired against the current build/enemy/floor — a browser mini-`trainer relics`
scoped to the live context — sortable table: relic, rarity, ΔWin ± CI, eqHP,
verdict chip. Baseline arm cached and shared across relics (as trainer does), so
the table costs ~1 batch + 1 per relic.

### 4.3 Floors — character × floor sweep

For the current player build: sweep floors 1–10. Per floor, opponents are either
(a) **the floor-legal spawn table** (each eligible enemy weighted by the real
rarity weights — expected-mix curve) or (b) a **fixed enemy** (how does this build
scale into Malakor?). Growth toggle: victories = f(floor) via a winsPerFloor-style
estimate or exact per-floor victory counts. Output: the old bench's sweep
composition — line chart (win% per floor, optionally two lines for the two AI
brackets; turns; death risk) + per-floor table with verdict chips marking where
the curve leaves band.

### 4.4 Runs — the full-run lab

`run-core.mjs` in workers: N seeded runs for a character (or all three), weave
floors, relic-pick policy, player AI selectable. Readouts via `run-analyze.mjs`
(identical math to the CLI): survival %, death-floor histogram, per-floor win
curve, deadliest enemies, **per-relic RCT delta table** (picked vs offered-not-
picked → ΔSurvival ± SE), per-character relic split, color-synergy conditionals.
Interop: **download JSONL** (same record shape as `reports/`, seed included) and
**import a JSONL** produced by the CLI — one dataset format, two frontends.

### 4.5 Weave — weave a skill, then price it

Two modes:

- **Draft**: reproduce the in-game draft headlessly — roll the weave plan
  (`rollRoundsPerWeave`/`rollTagsPerRound`) and per-round options
  (`drawTagsForRound`, with the character's affinity colors), pick tags (or
  free-pick any tags, skipping the draw); `synthesize()` → a **skill card**:
  name, split cost, effect lines, wasted-tag reasons, rolled values, analytic
  power. Buttons: *Reroll magnitudes* (same recipe), **Measure** (paired battles
  with/without the skill on the current Bench context or floors 2/5/8 →
  ΔWin ± CI, eqHP, casts — exactly the trainer skills-mode unit), *Add to build*
  (becomes selectable in Bench/Compare/Runs as a woven skill), *Save to customs*.
- **Distribution**: synthesize N random weaves (per character), score all
  analytically, optionally measure the top/bottom K → histogram of the weave
  system's power range + a **percentile placement** of the drafted skill against
  the authored catalog (catalog baseline from a bundled snapshot of the latest
  `trainer.mjs skills` report, refreshable by re-running the CLI).

### 4.6 Designer / Audit / Reference — carried over

Port the existing Designer (enemy/skill/relic editors, effect templates,
localStorage customs, paste-ready code output), Catalog Audit, and Reference tabs
with the new styling. Upgrades: every Designer verdict becomes a one-click
**measured** check (paired vs the reference frame, both AI brackets), and a
"send to Bench/Compare" button. `rescore` stays CLI-only (it writes suggestions
against `analytic.mjs`).

---

## 5. Measurement semantics (must match the CLI)

- **Seeding**: `hashSeed(label, i)` conventions identical to trainer/runs; battle
  task payloads identical to `pool-worker.mjs` — same seeds ⇒ bit-identical
  outcomes browser vs node (both import the same engine). Optional "parity"
  button in Reference: run a fixed 20-seed batch and compare a digest against a
  committed node-generated fixture.
- **Pairing**: every comparison uses common random numbers (same seed both arms);
  ΔWin CI from per-pair diffs (`measure.mjs`), never from independent batches.
- **eqHP**: ΔWin ÷ win-per-HP slope, slope measured with ±HP probe arms on the
  host at the same frame — cached per (build, enemy, floor, AI).
- **Never on the main thread** (global `Math.random` swap).

## 6. Performance envelope

- Greedy battles: ~1ms — thousands per second even single-threaded.
- Formula-champion battles: ~100–300ms/battle/core (extrapolated from node:
  100 policy runs ≈ 6s on 31 workers). Budget on an 8-worker browser pool:
  200 paired battles ≈ 10–25s → acceptable with progress + cancel; default
  N=200 for champion, N=1000 for greedy; Compare's relic-table mode surfaces an
  ETA before starting.
- Baseline caching (per config signature) so Compare/relic-table/Weave-measure
  never re-run an arm they already have this session.

## 7. Phasing

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | Core extraction (§3.1) + guards; all node smokes green | Pure refactor, no UI |
| 1 | Shell + tokens + worker pool + **Bench** tab | First usable page: measured beam with AI selector |
| 2 | **Compare** (A/B + relic table) + custom-weights loader | The trainer methodology in the browser |
| 3 | **Floors** + **Runs** (incl. JSONL import/export) | |
| 4 | **Weave** + Designer/Audit/Reference port; retire `balance-toolbench.html`; update CLAUDE.md/AGENT_ENTRYPOINT | |

Each phase ships a working page; the old toolbench keeps serving until Phase 4.

## 8. Risks & notes

- **The formula.mjs fs refactor touches CLI imports** (trainer/runs/train) — run
  `smoke.mjs`, `smoke-trainer.mjs`, `smoke-analytic.mjs`, `drift-check.mjs` after;
  the browser-safe grep guard prevents regressions.
- **Champion weights are fetched at runtime** — show the provenance stamp; warn if
  the JSON's keys don't match `FORMULA_WEIGHT_KEYS` (stale/foreign weights).
- **Module workers + serve**: confirm `serve.mjs` MIME for `.mjs`; module workers
  are supported in all current desktop browsers; fallback path exists (§3.2).
- **Determinism trap**: any future async inside `runOneRun`/`Battle` would break
  `withSeededRandom` — it's sync today; the guard is documented in `rng.mjs`.
- **`combat-balance-bench.html` remains legacy/read-only** (per project rules);
  we copy its CSS tokens into `ui/`, we do not import from it.
- **Google Fonts** in the legacy bench violate offline use — bundle woff2 locally.
