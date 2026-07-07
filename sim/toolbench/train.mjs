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
import { selectEnemyForNode } from '../../src/js/data/enemies/index.js';
import { DEFAULT_VALUE_WEIGHTS, WEIGHT_KEYS, makeValuePolicy, loadWeights } from './policy.mjs';
import { DEFAULT_FORMULA_WEIGHTS, FORMULA_WEIGHT_KEYS, loadFormulaWeights } from './formula.mjs';
import { resolveFrames, pickRandomRelicIds } from './trainer.mjs';
import { makeRandomWovenSkill } from './runs.mjs';
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

/* ── evaluation (fixed tasks, fixed seeds → CRN across candidates) ──
 *
 * RUN-REALISTIC task pool (v4 fix): fitness battles must look like the
 * battles the policy will actually play in runs — all floors, the real spawn
 * table (minions/elites/boss), and players carrying floor-scaled RANDOM relic
 * loads + woven skills. Training on 3 kit-only frames overfit: v3 matched the
 * old architecture on its eval pool (65.7%) while collapsing in runs
 * (warrior 51.7%→18.5%). Task generation is seeded → identical pool every
 * invocation → fitness comparable across generations AND runs.
 */
function buildTasks(hosts, battles) {
  const tasks = [];
  withSeededRandom(hashSeed('train-tasks-v4'), () => {
    for (let i = 0; i < battles; i++) {
      const hostId = hosts[i % hosts.length];
      const floor = 1 + Math.floor(Math.random() * 10);
      const nodeType = floor === 10 ? 'boss' : (floor >= 5 && Math.random() < 0.3 ? 'elite' : 'battle');
      const def = selectEnemyForNode({ floor, nodeType, seenByAct: {} });
      const victories = Math.round((floor - 1) * 0.7);
      const relicIds = pickRandomRelicIds(Math.round((floor - 1) * 0.5 * (0.4 + Math.random() * 1.2)));
      const customSkills = [];
      const wovenCount = (floor >= 3 && Math.random() < 0.5 ? 1 : 0) + (floor >= 6 && Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < wovenCount; k++) {
        const made = makeRandomWovenSkill(hostId);
        if (made) customSkills.push(made.skill);
      }
      tasks.push({
        hostId, enemyId: def.id, floor, victories, relicIds, customSkills,
        seed: hashSeed('train-eval-v4', i),
      });
    }
  });
  return tasks;
}

/**
 * RUN-SURVIVAL fitness (the default objective): each candidate plays the SAME
 * seeded set of FULL runs (CRN); fitness = fraction survived. Training metric
 * ≡ deployment metric — no hand-approximated battle distribution to get wrong
 * (fight composition, relic acquisition, enemy dedup all come from the real
 * run simulator). The enemy is inherently the SHIPPED AI (runs don't take an
 * enemy policy) — which is the right opponent: it never adapts in the game,
 * so self-play trains for the wrong game.
 */
async function evaluateRunBatch(pool, candidateSpecs, hosts, nRuns, seedNs = 'train-run-screen') {
  const policies = {};
  candidateSpecs.forEach((s, k) => { policies[`c${k}`] = s; });
  const poolTasks = [];
  for (let k = 0; k < candidateSpecs.length; k++) {
    for (let i = 0; i < nRuns; i++) {
      poolTasks.push({
        type: 'run',
        opts: { seed: hashSeed(seedNs, i), characterId: hosts[i % hosts.length], fightChance: 0.75, weaveFloors: 2 },
        playerPolicy: candidateSpecs[k] ? `c${k}` : null,
      });
    }
  }
  const results = await pool.map(poolTasks, { context: { policies } });
  return candidateSpecs.map((_, k) =>
    results.slice(k * nRuns, (k + 1) * nRuns).filter((r) => r.survived).length / nRuns);
}

/** Per-battle fitness on a fixed task set (legacy objective, --objective battles). */
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
        player: { characterId: t.hostId, victories: t.victories, relicIds: t.relicIds, customSkills: t.customSkills },
        enemy: { id: t.enemyId, floor: t.floor },
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
  const objective = args.objective === 'battles' ? 'battles' : 'runs';
  const selfplay = objective === 'runs' ? 0 : (parseInt(args.selfplay, 10) || 0); // runs mode: enemy IS the shipped AI — selfplay is the wrong game
  const nRuns = parseInt(args.runs, 10) || 80;             // SCREEN runs per candidate
  const nConfirm = parseInt(args.confirmRuns, 10) || 400;  // CONFIRM runs (fresh seeds) for the top-K
  const CONFIRM_K = parseInt(args.confirmK, 10) || 4;
  const allHosts = Object.keys(CHARACTERS_BY_ID);
  const hosts = args.hosts ? String(args.hosts).split(',').filter((h) => allHosts.includes(h)) : allHosts;
  const tasks = objective === 'battles' ? buildTasks(hosts, battles) : null;
  const { getPool } = await import('./pool.mjs');
  const pool = getPool();
  const evalCandidates = (specs, enemySpec) => (objective === 'runs'
    ? evaluateRunBatch(pool, specs, hosts, nRuns)
    : evaluateBatch(pool, specs, enemySpec, tasks));
  if (objective === 'runs') {
    line(`train: pop=${pop} gen=${gens} objective=RUN-SURVIVAL (screen ${nRuns} runs/candidate, confirm top-${CONFIRM_K} on ${nConfirm} fresh runs) workers=${pool.size}`);
    line(`fitness ≡ deployment: real map composition, rarity-weighted random-of-offered relics, weave drafts, shipped enemy AI (selfplay off)`);
  } else {
    line(`train: pop=${pop} gen=${gens} objective=battles (${tasks.length}/candidate) selfplay=${selfplay || 'off'} workers=${pool.size}`);
    const floorSpread = {};
    for (const t of tasks) floorSpread[t.floor] = (floorSpread[t.floor] || 0) + 1;
    line(`tasks: floors ${Object.entries(floorSpread).map(([f, n]) => `f${f}:${n}`).join(' ')}`);
  }

  // evaluator family: 'value' (preview-search delta) or 'formula'
  // (deterministic — measured FAR stronger in deployment; see formula.mjs)
  const evaluator = args.evaluator === 'formula' ? 'formula' : 'value';
  const KEYS = evaluator === 'formula' ? FORMULA_WEIGHT_KEYS : WEIGHT_KEYS;
  const DEFAULTS_MAP = evaluator === 'formula' ? DEFAULT_FORMULA_WEIGHTS : DEFAULT_VALUE_WEIGHTS;
  const toV = (w) => KEYS.map((k) => w[k]);
  const toW = (vec) => Object.fromEntries(KEYS.map((k, i) => [k, vec[i]]));
  const mkSpec = (vec) => ({ kind: evaluator, weights: toW(vec) });
  line(`evaluator: ${evaluator} (${KEYS.length} weights)`);

  // reference baselines — in runs mode, on the CONFIRM set so best.fitness
  // starts on the same scale bestEver is tracked on
  const t0 = Date.now();
  const [baselineGreedy, baselineDefault] = objective === 'runs'
    ? await evaluateRunBatch(pool, [null, { kind: evaluator }], hosts, nConfirm, 'train-run-confirm')
    : await evalCandidates([null, { kind: evaluator }], null);
  line(`baselines (confirm-scale): greedy=${(baselineGreedy * 100).toFixed(1)}% ${evaluator}Default=${(baselineDefault * 100).toFixed(1)}%`);

  const defaults = toV(DEFAULTS_MAP);
  // --seedWeights <file>: WARM-START the search MEAN at proven weights
  // (population, not just distribution: the raw defaults are also injected as
  // a gen-1 candidate — multi-start, fitness decides)
  let mean = [...defaults];
  if (args.seedWeights && fs.existsSync(String(args.seedWeights))) {
    const sw = JSON.parse(fs.readFileSync(String(args.seedWeights), 'utf8'));
    const loaded = evaluator === 'formula' ? loadFormulaWeights(sw) : loadWeights(sw);
    mean = toV({ ...DEFAULTS_MAP, ...loaded });
    line(`seed mean ← ${String(args.seedWeights)}`);
  }
  let sigma = defaults.map((d) => Math.abs(d) * 0.35 + 0.05);
  let best = { vec: [...mean], fitness: -1 }; // confirmed on first generation
  let enemySpec = null;
  const history = [];

  for (let gen = 0; gen < gens; gen++) {
    if (selfplay && gen > 0 && gen % selfplay === 0) {
      enemySpec = mkSpec(best.vec);
      line(`  [selfplay] enemy re-armed with best-so-far weights`);
    }
    // population: current mean + best-ever (elitism) + gaussian samples
    const candidates = [[...mean], [...best.vec]];
    if (gen === 0) candidates.push([...defaults]); // multi-start: audition raw defaults too
    while (candidates.length < pop) {
      candidates.push(mean.map((m, i) => m + sigma[i] * gaussian()));
    }
    // whole generation in ONE pooled batch (runs mode: the cheap SCREEN pass)
    const fitness = await evalCandidates(candidates.map(mkSpec), enemySpec);
    const scored = candidates.map((vec, k) => ({ vec, fitness: fitness[k] }));
    scored.sort((a, b) => b.fitness - a.fitness);
    let confirmNote = '';
    if (objective === 'runs') {
      // TWO-STAGE EVALUATION (winner's-curse fix): the screen max over `pop`
      // noisy estimates overshoots by ~1.5-2 SE, so nothing legitimately beats
      // an inflated bestEver and CEM stalls. CONFIRM the top few on a larger,
      // SEPARATE seed set; bestEver lives on the confirm scale only.
      const topK = scored.slice(0, CONFIRM_K);
      const confirmFit = await evaluateRunBatch(
        pool, topK.map((s) => mkSpec(s.vec)), hosts, nConfirm, 'train-run-confirm');
      let genBest = null;
      topK.forEach((s, i) => { s.confirm = confirmFit[i]; if (!genBest || s.confirm > genBest.confirm) genBest = s; });
      if (genBest.confirm > best.fitness) best = { vec: [...genBest.vec], fitness: genBest.confirm };
      confirmNote = ` confirm=${(genBest.confirm * 100).toFixed(1)}%`;
    } else if (scored[0].fitness >= best.fitness) {
      best = { vec: [...scored[0].vec], fitness: scored[0].fitness };
    }
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
    line(`  gen ${String(gen + 1).padStart(2)}/${gens}: screenBest=${(scored[0].fitness * 100).toFixed(1)}% mean=${(meanFit * 100).toFixed(1)}%${confirmNote} bestEver=${(best.fitness * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const outDir = path.join(DIR, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const file = args.out ? String(args.out) : path.join(outDir, 'trained-weights.json');
  fs.writeFileSync(file, JSON.stringify({
    evaluator,
    weights: toW(best.vec),
    fitness: best.fitness,
    baselines: { greedy: baselineGreedy, [`${evaluator}Default`]: baselineDefault },
    history,
    config: { pop, gens, objective, evaluator, runsPerCandidate: objective === 'runs' ? nRuns : undefined, battles: tasks ? tasks.length : undefined, hosts, selfplay, seedWeights: args.seedWeights || null },
    date: new Date().toISOString(),
  }, null, 2));
  line(`\nbest fitness ${(best.fitness * 100).toFixed(1)}% (greedy ${(baselineGreedy * 100).toFixed(1)}%, default ${(baselineDefault * 100).toFixed(1)}%)`);
  line(`weights → ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
