/**
 * sim/run.mjs — iterative runner. Plays every scenario and sweep N times and
 * writes an aggregated results file the analyzer (or an agent) can process.
 *
 * Usage:
 *   node sim/run.mjs                 # defaults: 2000 runs/point, seed 12345
 *   node sim/run.mjs --runs 5000 --seed 7
 *   node sim/run.mjs --out sim/out/results.json
 *
 * Output JSON schema:
 *   {
 *     meta: { seed, runsPerPoint, economy, generatedAtRound: <n/a> },
 *     scenarios: [ { name, player, enemy, aggregates } ],
 *     sweeps:    [ { name, note, varying, points: [ { value, aggregates } ] } ]
 *   }
 * `aggregates` = see summarize().
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runBattle } from './engine.mjs';
import { ECONOMY } from './model.mjs';
import { SCENARIOS, SWEEPS } from './scenarios.mjs';

// ── arg parsing ──────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}
const RUNS = parseInt(arg('runs', '2000'), 10);
const SEED = parseInt(arg('seed', '12345'), 10);
const OUT = arg('out', 'sim/out/results.json');

const clone = (o) => JSON.parse(JSON.stringify(o));

// Distinct, reproducible seed per run index.
const seedFor = (i) => (SEED + Math.imul(i, 0x9e3779b1)) >>> 0;

// ── stats helpers ─────────────────────────────────────────────────────────────
function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round2 = (x) => Math.round(x * 100) / 100;

function summarize(results) {
  const wins = results.filter((r) => r.winner === 'player').length;
  const actions = results.map((r) => r.playerActions).sort((a, b) => a - b);
  const hpFrac = results.map((r) => r.playerHpFrac).sort((a, b) => a - b);
  const dpt = results.map((r) => r.playerDPT);
  const skullPA = results.map((r) => r.playerSkullGroupsPerAction);
  return {
    n: results.length,
    winRate: round2(wins / results.length),
    playerActions: { mean: round2(mean(actions)), median: pct(actions, 50), p10: pct(actions, 10), p90: pct(actions, 90) },
    playerHpFracOnWin: round2(mean(results.filter((r) => r.winner === 'player').map((r) => r.playerHpFrac))),
    playerHpFrac: { mean: round2(mean(hpFrac)), median: round2(pct(hpFrac, 50)) },
    playerDPT: round2(mean(dpt)),
    skullGroupsPerAction: round2(mean(skullPA)),
    avgSkillCasts: round2(mean(results.map((r) => r.playerSkillCasts))),
  };
}

function runMany(playerDef, enemyDef) {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    out.push(runBattle(clone(playerDef), clone(enemyDef), seedFor(i)));
  }
  return summarize(out);
}

// ── execute ───────────────────────────────────────────────────────────────────
console.log(`[sim] runs/point=${RUNS} seed=${SEED}`);

const scenarioResults = SCENARIOS.map((sc) => {
  const agg = runMany(sc.player, sc.enemy);
  console.log(
    `  ${sc.name.padEnd(26)} win=${(agg.winRate * 100).toFixed(0)}%  ` +
    `turns=${agg.playerActions.median}(${agg.playerActions.p10}-${agg.playerActions.p90})  ` +
    `hpLeftOnWin=${(agg.playerHpFracOnWin * 100).toFixed(0)}%  dpt=${agg.playerDPT}`
  );
  return { name: sc.name, player: sc.player, enemy: sc.enemy, aggregates: agg };
});

const sweepResults = SWEEPS.map((sw) => {
  console.log(`  sweep ${sw.name} (${sw.varying}):`);
  const points = sw.values.map((v) => {
    const p = clone(sw.base.player);
    const e = clone(sw.base.enemy);
    sw.mutate(p, e, v);
    const agg = runMany(p, e);
    console.log(
      `    ${String(v).padStart(4)} -> win=${(agg.winRate * 100).toFixed(0)}%  ` +
      `turns=${agg.playerActions.median}  hpLeftOnWin=${(agg.playerHpFracOnWin * 100).toFixed(0)}%  dpt=${agg.playerDPT}`
    );
    return { value: v, aggregates: agg };
  });
  return { name: sw.name, note: sw.note, varying: sw.varying, points };
});

const payload = {
  meta: { seed: SEED, runsPerPoint: RUNS, economy: ECONOMY },
  scenarios: scenarioResults,
  sweeps: sweepResults,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`[sim] wrote ${OUT}`);
