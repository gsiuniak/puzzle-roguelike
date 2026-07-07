---
name: gems-ai-training
description: Train, evaluate, and measure with the gems battle AI (toolbench trainer/runs/learn stack) — weights lifecycle, drift guard, run-survival training, tournaments, RCT balance datasets. Use BEFORE any AI-training or run-measurement session, or when asked to retrain/check/compare weights or regenerate balance datasets.
---

# Gems AI Training & Measurement

All commands run from repo root in WSL: `wsl -e bash -lic "cd ~/test/game/gems && <cmd>"`.
Everything fans out over a worker pool (cpus−1; `GEMS_POOL_WORKERS` overrides). All tasks
are seeded — parallelism never changes numbers.

## Hard-won invariants (violate = wasted compute)

1. **Run `node sim/toolbench/drift-check.mjs` FIRST.** Exit 1 = mirrored constants drifted
   from live src; fix mirrors before trusting anything.
2. **Deterministic pathway only.** Measured verdict: every preview/sampled-afterstate
   policy caps at 10–17% run survival; deterministic evaluation reaches 23–45%
   regardless of evaluator sophistication (even a GPU conv-net). The FORMULA policy
   (`formula.mjs`, spec `{kind:'formula',weights}`) is the deployment/measurement player.
3. **Train on the deployment objective**: `train.mjs --objective runs` (default) = literal
   run survival, two-stage eval (screen + confirm on fresh seeds — kills winner's curse).
   Never selfplay (enemies are the fixed shipped AI). Never battle-proxy pools (Goodhart:
   v2 exploited preview noise, v3 two matchups, v4 a mis-weighted distribution).
4. **Fresh-seed tournament before crowning weights** (`reports/tournament.mjs` pattern,
   seeds never used in training/selection). Train-confirm numbers run ~5-7pp optimistic.
5. **Promote keeper weights to `sim/toolbench/weights/`** (tracked) with provenance.
   `reports/` is gitignored — never leave the only copy there.
   Champion: `weights/formula-champion.json` (~45% avg run survival; greedy AI = 2.5%).

## Command cookbook

```bash
node sim/toolbench/drift-check.mjs                        # ALWAYS first
node sim/toolbench/smoke.mjs && node sim/toolbench/smoke-trainer.mjs   # after code edits

# train (CEM, run-survival, two-stage; ~2min/gen on 32 threads)
node sim/toolbench/train.mjs --evaluator formula --seedWeights sim/toolbench/weights/formula-champion.json \
  --pop 24 --gen 24 --runs 100 --confirmRuns 500 --out sim/toolbench/reports/formula-new.json

# fresh-seed tournament (edit entries in reports/tournament.mjs; change seed ns per event)
node sim/toolbench/reports/tournament.mjs

# balance dataset under the champion (the RCT tables: relics, weave tags, per-char,
# color-synergy) — THE verification step after any data/balance change
node sim/toolbench/runs.mjs simulate --n 1500 --chars all --champion --out sim/toolbench/reports/runs-check.jsonl
node sim/toolbench/runs.mjs analyze --log sim/toolbench/reports/runs-check.jsonl --min 60

# per-item paired battle check (fast screen)     node sim/toolbench/trainer.mjs relics --relics <id> --n 200
# enemy win-rate bands                            node sim/toolbench/trainer.mjs enemies
# learned-V experiments (TD passed gate 1; conv/preview failed gates 2-3 — see CLAUDE.md)
node sim/toolbench/learn.mjs gate1 --battles 6000
```

## Reading results

- Run health targets: warrior ≈50–60% champion survival, mage/WD within ~5pp; flat
  death-floor histogram. Rarity bands (ΔSurv): common ≤3pp, uncommon 3–6, rare 6–12.
- RCT deltas are "picked vs offered-not-picked" — negative means WORSE than the average
  alternative. Only trust signals consistent across two datasets; small-n rares swing.
- Weave-tag table maps 1:1 onto `weaveConfig` tables + synthesizer `POWER` /
  `DEBUFF_POWER_MULT` (per-status pricing; analytic.mjs holds an inline mirror —
  drift-check covers it).

## File map

`formula.mjs` deterministic champion policy (+chain search, upside-only) · `policy.mjs`
preview-search (experiments only) · `train.mjs` CEM · `runs.mjs` run sim + RCT analyzer ·
`trainer.mjs` per-battle sweeps + enemies + rescore · `learn.mjs`/`features.mjs`/`nn.mjs`/
`python/train_td_conv.py` learned-V stack (GPU via `python/.venv`) · `pool.mjs` workers ·
`rng.mjs` seeding · full history: `docs/balance-recommendations-2026-07-07.md`, CLAUDE.md
toolbench section.
