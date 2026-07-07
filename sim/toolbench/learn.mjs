#!/usr/bin/env node
/**
 * toolbench/learn.mjs — the "plays without knowing WHY" layer: a learned
 * state-value function V(state) ≈ P(win | state), trained purely on self-play
 * OUTCOMES over the generic featurizer (features.mjs — descriptive facts only,
 * zero value judgments). The learned policy plays argmax over the V of each
 * candidate action's PREVIEWED next state — tempo, skulls, mana, extra turns
 * all get valued implicitly by what actually wins.
 *
 * Pipeline (one command runs the whole loop):
 *   node sim/toolbench/learn.mjs iterate [--rounds 3] [--battles 3000]
 *     [--epochs 6] [--floors 2,4,6,8,9] [--out reports/learned-value.json]
 * or stepwise:
 *   node sim/toolbench/learn.mjs collect [--battles 3000] [--out states.jsonl]
 *   node sim/toolbench/learn.mjs fit     [--data states.jsonl] [--out model.json]
 *   node sim/toolbench/learn.mjs eval    [--model model.json] [--battles 400]
 *
 * How it works:
 *  - COLLECT: seeded self-play battles across (hosts × floors × spawn-table
 *    enemies) with a MIXED policy pool (greedy / hand-value / trained CEM /
 *    current learned / ε-random) for state diversity. Players are dealt a
 *    floor-scaled RANDOM relic load + up to ~2 random woven skills (via the
 *    real weave pipeline) so the state distribution matches real runs — a V
 *    trained on kit-only states would be blind to relic/woven contexts. At
 *    every decision point the state is featurized from BOTH perspectives
 *    (selfToMove 1 and 0) and labeled at battle end with "did that side win".
 *  - FIT: logistic regression by SGD (few epochs, L2). Small, fast, and the
 *    weights stay inspectable (a learned "what matters" table).
 *  - POLICY: makeLearnedPolicy(model) — for each affordable cast + legal swap,
 *    apply it on a PREVIEW battle (previewBattle: cloned combatants + board on
 *    the Battle prototype), featurize the resulting state (selfToMove=1 when
 *    the action retains the turn), pick argmax V.
 *  - ITERATE: collect → fit → eval, feeding the new learned policy back into
 *    the collection mix each round (policy-improvement loop).
 *
 * Output model JSON: { featureNames, w, b, acc, auc, config } — load with
 * makeLearnedPolicy(model) or pass to runs.mjs/trainer.mjs via --learned.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Battle, makePlayerCombatant, makeEnemyCombatant, CHARACTERS_BY_ID } from './engine.mjs';
import { resolveFrames, pickRandomRelicIds } from './trainer.mjs';
import { makeRandomWovenSkill } from './runs.mjs';
import { makeValuePolicy, loadWeights } from './policy.mjs';
import { featurize, FEATURE_NAMES } from './features.mjs';
import { hashSeed, withSeededRandom } from './rng.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const deep = (o) => JSON.parse(JSON.stringify(o));

/* ═══════════════════════ preview (apply action on a clone) ═════════════════ */

/** A disposable copy of a Battle sharing the prototype: cloned combatants +
 *  board, so engine methods (_castSkill/_performSwap) can run without touching
 *  the real battle. */
export function previewBattle(battle) {
  const b = Object.create(Object.getPrototypeOf(battle));
  Object.assign(b, battle);
  b.p = deep(battle.p);
  b.e = deep(battle.e);
  b.board = battle.board.clone();
  b.log = null;
  b.opts = { ...battle.opts, playerPolicy: null, enemyPolicy: null };
  return b;
}

/** Apply `action` for side `c` on a preview; returns { preview, self, extraTurn }. */
export function previewAction(battle, c, action) {
  const b = previewBattle(battle);
  const self = c === battle.p ? b.p : b.e;
  let extraTurn = false;
  if (action.type === 'cast') extraTurn = b._castSkill(self, action.skill, action.target || null);
  else if (action.type === 'swap') extraTurn = b._performSwap(self, action.swap);
  return { preview: b, self, extraTurn };
}

/* ═══════════════════════════ model + learned policy ════════════════════════ */

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function predict(model, x) {
  let z = model.b;
  for (let i = 0; i < x.length; i++) z += model.w[i] * x[i];
  return sigmoid(z);
}

/** Policy for the Battle seam: argmax V over previewed next states. */
export function makeLearnedPolicy(model, { epsilon = 0 } = {}) {
  return (battle, c) => {
    const opp = battle.other(c);
    const candidates = [];
    if (!battle._hasStatus(c, 'silenced')) {
      for (const skill of c.skills || []) {
        if (battle.canAfford(c, skill)) candidates.push({ type: 'cast', skill });
      }
    }
    for (const sw of battle.board.getValidSwaps()) candidates.push({ type: 'swap', swap: sw });
    if (!candidates.length) return null; // engine greedy handles reshuffle
    if (epsilon > 0 && Math.random() < epsilon) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    let best = null, bestV = -Infinity;
    for (const action of candidates) {
      const { preview, self, extraTurn } = previewAction(battle, c, action);
      const pOpp = self === preview.p ? preview.e : preview.p;
      // terminal shortcuts: a killing action is a win, dying to your own action a loss
      let v;
      if (pOpp.hp <= 0 && !pOpp.isEgg) v = 1 + 1e-6;
      else if (self.hp <= 0) v = -1;
      else v = predict(model, featurize(preview, self, pOpp, extraTurn ? 1 : 0));
      if (v > bestV) { bestV = v; best = action; }
    }
    return best;
  };
}

export function loadModel(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(m.w) || m.w.length !== FEATURE_NAMES.length) {
    throw new Error(`model/featurizer mismatch: model has ${m.w && m.w.length} weights, featurizer ${FEATURE_NAMES.length}`);
  }
  return m;
}

/* ═══════════════════════════════ collect ═══════════════════════════════════ */

function buildTasks(floors, hosts) {
  const frames = resolveFrames(floors);
  const tasks = [];
  for (const hostId of hosts) for (const frame of frames) tasks.push({ hostId, frame });
  return tasks;
}

/** A recording wrapper: records both-perspective features at each decision
 *  point, then delegates to `base` (or engine greedy when base is null). */
function recordingPolicy(base, sink) {
  return (battle, c) => {
    const opp = battle.other(c);
    sink.push(
      { x: featurize(battle, c, opp, 1), side: c.side },
      { x: featurize(battle, opp, c, 0), side: opp.side },
    );
    return base ? base(battle, c) : null;
  };
}

function cmdCollect(args, mixExtra = []) {
  const battles = parseInt(args.battles, 10) || 3000;
  const floors = String(args.floors || '2,4,6,8,9').split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const hosts = Object.keys(CHARACTERS_BY_ID);
  const tasks = buildTasks(floors, hosts);
  const epsilon = args.epsilon != null ? Number(args.epsilon) : 0.08;
  // policy pool for state diversity: null = engine greedy
  const pool = [null, makeValuePolicy({}), ...mixExtra];
  if (args.weights && fs.existsSync(String(args.weights))) {
    pool.push(makeValuePolicy(loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8')))));
  }
  const dir = path.join(DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = args.out ? String(args.out) : path.join(dir, 'learn-states.jsonl');
  const out = fs.createWriteStream(file);
  const t0 = Date.now();
  let samples = 0;
  for (let i = 0; i < battles; i++) {
    const task = tasks[i % tasks.length];
    const seed = hashSeed('gems-learn', i);
    const sink = [];
    const pPol = pool[i % pool.length];
    const ePol = pool[(i * 7 + 3) % pool.length];
    const wrapped = recordingPolicy(pPol, sink);
    const eWrapped = (battle, c) => {
      if (epsilon > 0 && Math.random() < epsilon) {
        const sw = battle.board.getValidSwaps();
        if (sw.length) return { type: 'swap', swap: sw[Math.floor(Math.random() * sw.length)] };
      }
      return ePol ? ePol(battle, c) : null;
    };
    const res = withSeededRandom(seed, () => {
      // REALISTIC state distribution: deal a floor-scaled random relic load
      // and up to ~2 random woven skills into the player (matching what real
      // runs accumulate — kit-only states would leave V blind to them)
      const floor = task.frame.floor;
      const relicCount = Math.round((floor - 1) * 0.5 * (0.4 + Math.random() * 1.2));
      const customSkills = [];
      const wovenCount = (floor >= 3 && Math.random() < 0.5 ? 1 : 0) + (floor >= 6 && Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < wovenCount; k++) {
        const made = makeRandomWovenSkill(task.hostId);
        if (made) customSkills.push(made.skill);
      }
      return new Battle(
        makePlayerCombatant({
          characterId: task.hostId, victories: task.frame.victories,
          relicIds: pickRandomRelicIds(relicCount), customSkills,
        }),
        makeEnemyCombatant(task.frame.enemyId, task.frame.floor),
        { playerPolicy: wrapped, enemyPolicy: eWrapped },
      ).run();
    });
    if (res.winner === 'draw') continue; // no signal
    for (const s of sink) {
      out.write(JSON.stringify({ x: s.x, y: s.side === res.winner ? 1 : 0 }) + '\n');
      samples++;
    }
    if ((i + 1) % 500 === 0) line(`  collect ${i + 1}/${battles} battles, ${samples} samples (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  return new Promise((resolve) => out.end(() => {
    line(`collect → ${path.relative(process.cwd(), file)} (${samples} samples from ${battles} battles)`);
    resolve(file);
  }));
}

/* ═══════════════════════════════ fit ═══════════════════════════════════════ */

async function cmdFit(args) {
  const file = args.data ? String(args.data) : path.join(DIR, 'reports', 'learn-states.jsonl');
  const epochs = parseInt(args.epochs, 10) || 6;
  const lr0 = args.lr != null ? Number(args.lr) : 0.05;
  const l2 = args.l2 != null ? Number(args.l2) : 1e-4;
  const X = [], Y = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    const r = JSON.parse(raw);
    X.push(r.x); Y.push(r.y);
  }
  if (X.length < 200) { line(`fit: only ${X.length} samples — collect more`); process.exitCode = 1; return null; }
  const d = FEATURE_NAMES.length;
  const w = new Array(d).fill(0);
  let b = 0;
  const idx = X.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    // shuffle (plain Math.random — fitting needn't be seeded)
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const lr = lr0 / (1 + e);
    let loss = 0;
    for (const i of idx) {
      const x = X[i];
      let z = b;
      for (let k = 0; k < d; k++) z += w[k] * x[k];
      const p = sigmoid(z);
      const g = p - Y[i];
      loss += Y[i] ? -Math.log(Math.max(1e-9, p)) : -Math.log(Math.max(1e-9, 1 - p));
      for (let k = 0; k < d; k++) w[k] -= lr * (g * x[k] + l2 * w[k]);
      b -= lr * g;
    }
    line(`  fit epoch ${e + 1}/${epochs}: logloss=${(loss / X.length).toFixed(4)}`);
  }
  // train accuracy (optimistic but a sanity floor)
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    let z = b; for (let k = 0; k < d; k++) z += w[k] * X[i][k];
    if ((sigmoid(z) >= 0.5 ? 1 : 0) === Y[i]) correct++;
  }
  const model = { featureNames: FEATURE_NAMES, w, b, acc: correct / X.length, samples: X.length, date: new Date().toISOString() };
  const out = args.out ? String(args.out) : path.join(DIR, 'reports', 'learned-value.json');
  fs.writeFileSync(out, JSON.stringify(model, null, 2));
  line(`fit: acc=${pct(model.acc)} on ${X.length} samples → ${path.relative(process.cwd(), out)}`);
  // top learned weights — the machine's own "what matters" table
  const ranked = FEATURE_NAMES.map((name, i) => ({ name, w: w[i] })).sort((a, z) => Math.abs(z.w) - Math.abs(a.w)).slice(0, 12);
  line('  top weights: ' + ranked.map((r) => `${r.name}=${r.w.toFixed(2)}`).join('  '));
  return out;
}

/* ═══════════════════════════════ eval ══════════════════════════════════════ */

function evalPolicy(policy, tasks, battles, tag) {
  let wins = 0, n = 0;
  for (let i = 0; i < battles; i++) {
    const task = tasks[i % tasks.length];
    const seed = hashSeed('gems-learn-eval', i);
    const res = withSeededRandom(seed, () => new Battle(
      makePlayerCombatant({ characterId: task.hostId, victories: task.frame.victories }),
      makeEnemyCombatant(task.frame.enemyId, task.frame.floor),
      { playerPolicy: policy },
    ).run());
    if (res.playerWon) wins++;
    n++;
  }
  line(`  eval ${tag.padEnd(16)} win=${pct(wins / n)}`);
  return wins / n;
}

async function cmdEval(args) {
  const modelFile = args.model ? String(args.model) : path.join(DIR, 'reports', 'learned-value.json');
  const model = loadModel(modelFile);
  const battles = parseInt(args.battles, 10) || 400;
  const floors = String(args.floors || '6,8,9').split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const tasks = buildTasks(floors, Object.keys(CHARACTERS_BY_ID));
  line(`eval on floors ${floors.join(',')} (${battles} battles each, same seeds):`);
  const results = {
    greedy: evalPolicy(null, tasks, battles, 'greedy'),
    handValue: evalPolicy(makeValuePolicy({}), tasks, battles, 'hand-value'),
    learned: evalPolicy(makeLearnedPolicy(model), tasks, battles, 'LEARNED'),
  };
  if (args.weights && fs.existsSync(String(args.weights))) {
    results.trainedCEM = evalPolicy(
      makeValuePolicy(loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8')))),
      tasks, battles, 'trained-CEM');
  }
  return results;
}

/* ═══════════════════════════════ iterate ═══════════════════════════════════ */

async function cmdIterate(args) {
  const rounds = parseInt(args.rounds, 10) || 3;
  const modelOut = args.out ? String(args.out) : path.join(DIR, 'reports', 'learned-value.json');
  let mixExtra = [];
  for (let r = 0; r < rounds; r++) {
    line(`\n== learn round ${r + 1}/${rounds} ==`);
    const dataFile = await cmdCollect({ ...args, out: path.join(DIR, 'reports', 'learn-states.jsonl') }, mixExtra);
    const fitted = await cmdFit({ ...args, data: dataFile, out: modelOut });
    if (!fitted) return;
    const model = loadModel(modelOut);
    // feed the improved policy back into the next round's collection mix
    mixExtra = [makeLearnedPolicy(model, { epsilon: 0.05 })];
    await cmdEval({ ...args, model: modelOut });
  }
  line(`\nfinal model → ${path.relative(process.cwd(), modelOut)}`);
}

/* ═══════════════════════════════════ main ══════════════════════════════════ */

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
  const cmd = args._[0] || 'iterate';
  if (cmd === 'collect') await cmdCollect(args);
  else if (cmd === 'fit') await cmdFit(args);
  else if (cmd === 'eval') await cmdEval(args);
  else if (cmd === 'iterate') await cmdIterate(args);
  else { line(`unknown command "${cmd}" — use collect | fit | eval | iterate`); process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
