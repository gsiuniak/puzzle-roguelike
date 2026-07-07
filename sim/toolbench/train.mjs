#!/usr/bin/env node
/**
 * toolbench/train.mjs — CEM (cross-entropy method) trainer for the value
 * policy's weight vector (policy.mjs DEFAULT_VALUE_WEIGHTS is the genome).
 *
 * Black-box policy search, deliberately NOT deep RL: the trained weights stay
 * interpretable (each one is "what is X worth, in damage units") and transfer
 * to unseen synth skills because the policy is effect-featurized.
 *
 * Loop: sample a population of weight vectors around the current mean →
 * evaluate each on a FIXED task set (hosts × floors × the same seeds for every
 * candidate — common random numbers, so fitness differences are policy, not
 * luck) → refit mean/std to the top quartile → decay exploration noise.
 * Fitness = mean win rate across the task pool (mixed floors/characters, so
 * it can't overfit one matchup). `--selfplay k` re-arms the ENEMY with the
 * best-so-far weights every k generations (the policy is side-agnostic).
 *
 * Usage (node, repo root):
 *   node sim/toolbench/train.mjs [--pop 20] [--gen 20] [--battles 72]
 *     [--floors 2,5,8] [--hosts warrior,mage,witch_doctor] [--selfplay 0]
 *     [--out sim/toolbench/reports/trained-weights.json]
 *
 * Output JSON: { weights, fitness, baselines, history, config } — feed it to
 * the sweep via `trainer.mjs skills --weights <file>` or load in code via
 * policy.mjs loadWeights().
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Battle, makePlayerCombatant, makeEnemyCombatant, CHARACTERS_BY_ID } from './engine.mjs';
import { DEFAULT_VALUE_WEIGHTS, WEIGHT_KEYS, makeValuePolicy } from './policy.mjs';
import { resolveFrames } from './trainer.mjs';
import { hashSeed, withSeededRandom } from './rng.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');

/* ── genome helpers ── */
const toVec = (w) => WEIGHT_KEYS.map((k) => w[k]);
const toWeights = (vec) => Object.fromEntries(WEIGHT_KEYS.map((k, i) => [k, vec[i]]));

function gaussian() { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── evaluation (fixed tasks, fixed seeds → CRN across candidates) ── */
function buildTasks(hosts, frames, battles) {
  const combos = [];
  for (const hostId of hosts) for (const frame of frames) combos.push({ hostId, frame });
  const nPer = Math.max(1, Math.round(battles / combos.length));
  const tasks = [];
  for (let ci = 0; ci < combos.length; ci++) {
    for (let i = 0; i < nPer; i++) {
      tasks.push({ ...combos[ci], seed: hashSeed('train-eval', ci, i) });
    }
  }
  return tasks;
}

/** Evaluate MANY candidate policy specs on the same task set in one pooled
 *  batch (CRN: identical seeds per candidate). Returns fitness[] aligned with
 *  candidateSpecs. A spec of null = engine greedy. */
async function evaluateBatch(pool, candidateSpecs, enemySpec, tasks) {
  const policies = {};
  if (enemySpec) policies.enemy = enemySpec;
  candidateSpecs.forEach((s, k) => { policies[`c${k}`] = s; });
  const poolTasks = [];
  for (let k = 0; k < candidateSpecs.length; k++) {
    for (const t of tasks) {
      poolTasks.push({
        type: 'battle',
        seed: t.seed,
        player: { characterId: t.hostId, victories: t.frame.victories },
        enemy: { id: t.frame.enemyId, floor: t.frame.floor },
        playerPolicy: candidateSpecs[k] ? `c${k}` : null,
        enemyPolicy: enemySpec ? 'enemy' : null,
      });
    }
  }
  const results = await pool.map(poolTasks, { context: { policies } });
  const T = tasks.length;
  return candidateSpecs.map((_, k) =>
    results.slice(k * T, (k + 1) * T).filter((r) => r.playerWon).length / T);
}

/* ── main ── */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { args[a.slice(2)] = next; i++; }
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pop = parseInt(args.pop, 10) || 20;
  const gens = parseInt(args.gen, 10) || 20;
  const battles = parseInt(args.battles, 10) || 72;
  const eliteFrac = 0.25;
  const selfplay = parseInt(args.selfplay, 10) || 0;
  // default floors need WIN-RATE HEADROOM (a saturated 100%-win task gives CEM
  // no gradient): f6 minion ~85-95%, f8/f9 elites ~50-70% for the ref player
  const floors = String(args.floors || '6,8,9').split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const allHosts = Object.keys(CHARACTERS_BY_ID);
  const hosts = args.hosts ? String(args.hosts).split(',').filter((h) => allHosts.includes(h)) : allHosts;
  const frames = resolveFrames(floors);
  const tasks = buildTasks(hosts, frames, battles);
  const { getPool } = await import('./pool.mjs');
  const pool = getPool();
  line(`train: pop=${pop} gen=${gens} battles/candidate=${tasks.length} selfplay=${selfplay || 'off'} workers=${pool.size}`);
  line(`tasks: ${frames.map((f) => `f${f.floor}:${f.enemyId}`).join(' ')} × ${hosts.join(',')}`);

  // reference baselines on the same tasks (one pooled batch)
  const t0 = Date.now();
  const [baselineGreedy, baselineDefault] = await evaluateBatch(pool, [null, { kind: 'value' }], null, tasks);
  line(`baselines: greedy=${(baselineGreedy * 100).toFixed(1)}% valueDefault=${(baselineDefault * 100).toFixed(1)}%`);

  const defaults = toVec(DEFAULT_VALUE_WEIGHTS);
  let mean = [...defaults];
  let sigma = defaults.map((d) => Math.abs(d) * 0.35 + 0.05);
  let best = { vec: [...defaults], fitness: baselineDefault };
  let enemySpec = null;
  const history = [];

  for (let gen = 0; gen < gens; gen++) {
    if (selfplay && gen > 0 && gen % selfplay === 0) {
      enemySpec = { kind: 'value', weights: toWeights(best.vec) };
      line(`  [selfplay] enemy re-armed with best-so-far weights`);
    }
    // population: current mean + best-ever (elitism) + gaussian samples
    const candidates = [[...mean], [...best.vec]];
    while (candidates.length < pop) {
      candidates.push(mean.map((m, i) => m + sigma[i] * gaussian()));
    }
    // whole generation in ONE pooled batch (pop × tasks battles)
    const fitness = await evaluateBatch(pool, candidates.map((vec) => ({ kind: 'value', weights: toWeights(vec) })), enemySpec, tasks);
    const scored = candidates.map((vec, k) => ({ vec, fitness: fitness[k] }));
    scored.sort((a, b) => b.fitness - a.fitness);
    if (scored[0].fitness >= best.fitness) best = { vec: [...scored[0].vec], fitness: scored[0].fitness };
    const elites = scored.slice(0, Math.max(2, Math.round(pop * eliteFrac)));
    // refit mean/std to elites, with a decaying exploration floor
    const decay = 1 - gen / gens;
    mean = mean.map((_, i) => elites.reduce((a, e) => a + e.vec[i], 0) / elites.length);
    sigma = sigma.map((_, i) => {
      const m = mean[i];
      const varE = elites.reduce((a, e) => a + (e.vec[i] - m) ** 2, 0) / elites.length;
      return Math.sqrt(varE) + (Math.abs(defaults[i]) * 0.08 + 0.01) * decay;
    });
    const meanFit = scored.reduce((a, s) => a + s.fitness, 0) / scored.length;
    history.push({ gen, best: scored[0].fitness, mean: meanFit, bestEver: best.fitness });
    line(`  gen ${String(gen + 1).padStart(2)}/${gens}: best=${(scored[0].fitness * 100).toFixed(1)}% mean=${(meanFit * 100).toFixed(1)}% bestEver=${(best.fitness * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const outDir = path.join(DIR, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const file = args.out ? String(args.out) : path.join(outDir, 'trained-weights.json');
  fs.writeFileSync(file, JSON.stringify({
    weights: toWeights(best.vec),
    fitness: best.fitness,
    baselines: { greedy: baselineGreedy, valueDefault: baselineDefault },
    history,
    config: { pop, gens, battles: tasks.length, floors, hosts, selfplay },
    date: new Date().toISOString(),
  }, null, 2));
  line(`\nbest fitness ${(best.fitness * 100).toFixed(1)}% (greedy ${(baselineGreedy * 100).toFixed(1)}%, default ${(baselineDefault * 100).toFixed(1)}%)`);
  line(`weights → ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
