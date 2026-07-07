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
import {
  makeValuePolicy, makeSearchPolicy, loadWeights,
  previewBattle, previewAction, enumerateActions,
} from './policy.mjs';
import { featurize, FEATURE_NAMES } from './features.mjs';
import { hashSeed, withSeededRandom } from './rng.mjs';

export { previewBattle, previewAction }; // re-export (moved to policy.mjs)

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const deep = (o) => JSON.parse(JSON.stringify(o));

/* ═══════════════════════════ model + learned policy ════════════════════════ */

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** V(state) for either model type: 'mlp' (1 tanh hidden layer) or logistic. */
export function predict(model, x) {
  if (model.type === 'mlp') {
    const { W1, b1, W2, h } = model;
    let z2 = model.b2;
    for (let j = 0; j < h; j++) {
      let z1 = b1[j];
      const row = W1[j];
      for (let i = 0; i < x.length; i++) z1 += row[i] * x[i];
      z2 += W2[j] * Math.tanh(z1);
    }
    return sigmoid(z2);
  }
  let z = model.b;
  for (let i = 0; i < x.length; i++) z += model.w[i] * x[i];
  return sigmoid(z);
}

/** Learned-V evaluator for the SEARCH policy (policy.mjs): scores the
 *  previewed afterstate with V; mode 'replace' — deeper chain evaluations
 *  supersede the leaf (V already encodes the future). Targets + extra-turn
 *  chains come from the shared search wrapper, judgment from the model. */
export function makeLearnedPolicy(model, { epsilon = 0, chainDepth = 2 } = {}) {
  const evaluator = (battle, c, opp, action, preview, self, pOpp, extraTurn) =>
    predict(model, featurize(preview, self, pOpp, extraTurn ? 1 : 0));
  evaluator.mode = 'replace';
  return makeSearchPolicy(evaluator, { chainDepth, epsilon });
}

export function loadModel(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const inDim = m.type === 'mlp' ? (m.W1 && m.W1[0] && m.W1[0].length) : (m.w && m.w.length);
  if (inDim !== FEATURE_NAMES.length) {
    throw new Error(`model/featurizer mismatch: model input dim ${inDim}, featurizer ${FEATURE_NAMES.length}`);
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
 *  point, PLUS the afterstate of the chosen action (what the search policy
 *  actually queries V with — matching train/inference distributions), then
 *  delegates to `base` (or engine greedy when base is null). */
function recordingPolicy(base, sink) {
  return (battle, c) => {
    const opp = battle.other(c);
    sink.push(
      { x: featurize(battle, c, opp, 1), side: c.side },
      { x: featurize(battle, opp, c, 0), side: opp.side },
    );
    const action = base ? base(battle, c) : null;
    if (action) {
      const { preview, self, opp: pOpp, extraTurn } = previewAction(battle, c, action);
      if (self.hp > 0 && (pOpp.hp > 0 || pOpp.isEgg)) {
        sink.push({ x: featurize(preview, self, pOpp, extraTurn ? 1 : 0), side: c.side });
      }
    }
    return action;
  };
}

/** ONE fully seeded recorded self-play battle → { samples } (shared by the
 *  serial path and pool-worker.mjs 'collect' tasks). Players are dealt a
 *  floor-scaled random relic load + up to ~2 random woven skills so the state
 *  distribution matches real runs. */
export function collectOneBattle({ seed, hostId, frame, epsilon = 0.08 }, pPolicy = null, ePolicy = null) {
  const sink = [];
  const wrapped = recordingPolicy(pPolicy, sink);
  const eWrapped = (battle, c) => {
    if (epsilon > 0 && Math.random() < epsilon) {
      const sw = battle.board.getValidSwaps();
      if (sw.length) return { type: 'swap', swap: sw[Math.floor(Math.random() * sw.length)] };
    }
    return ePolicy ? ePolicy(battle, c) : null;
  };
  const res = withSeededRandom(seed, () => {
    const floor = frame.floor;
    const relicCount = Math.round((floor - 1) * 0.5 * (0.4 + Math.random() * 1.2));
    const customSkills = [];
    const wovenCount = (floor >= 3 && Math.random() < 0.5 ? 1 : 0) + (floor >= 6 && Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < wovenCount; k++) {
      const made = makeRandomWovenSkill(hostId);
      if (made) customSkills.push(made.skill);
    }
    return new Battle(
      makePlayerCombatant({
        characterId: hostId, victories: frame.victories,
        relicIds: pickRandomRelicIds(relicCount), customSkills,
      }),
      makeEnemyCombatant(frame.enemyId, frame.floor),
      { playerPolicy: wrapped, enemyPolicy: eWrapped },
    ).run();
  });
  if (res.winner === 'draw') return { samples: [] };
  return { samples: sink.map((s) => ({ x: s.x, y: s.side === res.winner ? 1 : 0 })) };
}

async function cmdCollect(args, mixExtraSpecs = []) {
  const battles = parseInt(args.battles, 10) || 3000;
  const floors = String(args.floors || '2,4,6,8,9').split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const hosts = Object.keys(CHARACTERS_BY_ID);
  const tasks = buildTasks(floors, hosts);
  const epsilon = args.epsilon != null ? Number(args.epsilon) : 0.08;
  // policy SPEC pool for state diversity (resolved worker-side)
  const policies = { greedy: null, hand: { kind: 'value' } };
  const refs = ['greedy', 'hand'];
  if (args.weights && fs.existsSync(String(args.weights))) {
    policies.cem = { kind: 'value', weights: loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8'))) };
    refs.push('cem');
  }
  mixExtraSpecs.forEach((s, i) => { policies[`mix${i}`] = s; refs.push(`mix${i}`); });
  const dir = path.join(DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = args.out ? String(args.out) : path.join(dir, 'learn-states.jsonl');
  const out = fs.createWriteStream(file, { flags: args.append ? 'a' : 'w' });
  const t0 = Date.now();
  const { getPool } = await import('./pool.mjs');
  const pool = getPool();
  const poolTasks = [];
  for (let i = 0; i < battles; i++) {
    const task = tasks[i % tasks.length];
    poolTasks.push({
      type: 'collect',
      opts: { seed: hashSeed('gems-learn', i), hostId: task.hostId, frame: task.frame, epsilon },
      playerPolicy: refs[i % refs.length],
      enemyPolicy: refs[(i * 7 + 3) % refs.length],
    });
  }
  const results = await pool.map(poolTasks, {
    context: { policies },
    onProgress: (done, totalN) => { if (done % 1000 === 0) line(`  collect ${done}/${totalN} battles (${((Date.now() - t0) / 1000).toFixed(0)}s)`); },
  });
  let samples = 0;
  for (const r of results) {
    for (const s of r.samples) { out.write(JSON.stringify(s) + '\n'); samples++; }
  }
  return new Promise((resolve) => out.end(() => {
    line(`collect → ${path.relative(process.cwd(), file)} (${samples} samples from ${battles} battles, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    resolve(file);
  }));
}

/* ═══════════════════════════════ fit ═══════════════════════════════════════ */

async function cmdFit(args) {
  const file = args.data ? String(args.data) : path.join(DIR, 'reports', 'learn-states.jsonl');
  const epochs = parseInt(args.epochs, 10) || 6;
  const hidden = args.hidden != null ? parseInt(args.hidden, 10) : 24; // 0 → plain logistic
  const lr0 = args.lr != null ? Number(args.lr) : (hidden ? 0.03 : 0.05);
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
  const idx = X.map((_, i) => i);
  const shuffle = () => { for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } };
  let model;
  if (hidden > 0) {
    // 1-hidden-layer MLP (tanh), SGD backprop. Still trained ONLY on outcomes;
    // the nonlinearity is what lets V rank ACTIONS (small state deltas) sharply.
    const h = hidden;
    const r = () => (Math.random() - 0.5) * 0.3;
    const W1 = Array.from({ length: h }, () => Array.from({ length: d }, r));
    const b1 = new Array(h).fill(0);
    const W2 = Array.from({ length: h }, r);
    let b2 = 0;
    const a = new Array(h);
    for (let e = 0; e < epochs; e++) {
      shuffle();
      const lr = lr0 / (1 + e * 0.5);
      let loss = 0;
      for (const i of idx) {
        const x = X[i];
        let z2 = b2;
        for (let j = 0; j < h; j++) {
          let z1 = b1[j];
          const row = W1[j];
          for (let k = 0; k < d; k++) z1 += row[k] * x[k];
          a[j] = Math.tanh(z1);
          z2 += W2[j] * a[j];
        }
        const p = sigmoid(z2);
        const g2 = p - Y[i];
        loss += Y[i] ? -Math.log(Math.max(1e-9, p)) : -Math.log(Math.max(1e-9, 1 - p));
        for (let j = 0; j < h; j++) {
          const g1 = g2 * W2[j] * (1 - a[j] * a[j]);
          W2[j] -= lr * (g2 * a[j] + l2 * W2[j]);
          const row = W1[j];
          for (let k = 0; k < d; k++) row[k] -= lr * (g1 * x[k] + l2 * row[k]);
          b1[j] -= lr * g1;
        }
        b2 -= lr * g2;
      }
      line(`  fit epoch ${e + 1}/${epochs}: logloss=${(loss / X.length).toFixed(4)}`);
    }
    model = { type: 'mlp', h, featureNames: FEATURE_NAMES, W1, b1, W2, b2, samples: X.length, date: new Date().toISOString() };
  } else {
    const w = new Array(d).fill(0);
    let b = 0;
    for (let e = 0; e < epochs; e++) {
      shuffle();
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
    model = { featureNames: FEATURE_NAMES, w, b, samples: X.length, date: new Date().toISOString() };
  }
  // train accuracy (optimistic but a sanity floor)
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    if ((predict(model, X[i]) >= 0.5 ? 1 : 0) === Y[i]) correct++;
  }
  model.acc = correct / X.length;
  const out = args.out ? String(args.out) : path.join(DIR, 'reports', 'learned-value.json');
  fs.writeFileSync(out, JSON.stringify(model, null, 2));
  line(`fit: ${hidden ? `mlp(h=${hidden})` : 'logistic'} acc=${pct(model.acc)} on ${X.length} samples → ${path.relative(process.cwd(), out)}`);
  // "what matters" table: mean |∂V/∂x_k| over a sample (works for both types)
  const sens = new Array(d).fill(0);
  const nS = Math.min(400, X.length);
  for (let s = 0; s < nS; s++) {
    const x = X[Math.floor((s / nS) * X.length)];
    if (model.type === 'mlp') {
      for (let j = 0; j < model.h; j++) {
        let z1 = model.b1[j];
        for (let k = 0; k < d; k++) z1 += model.W1[j][k] * x[k];
        const t = Math.tanh(z1);
        const gj = model.W2[j] * (1 - t * t);
        for (let k = 0; k < d; k++) sens[k] += Math.abs(gj * model.W1[j][k]) / nS;
      }
    } else {
      for (let k = 0; k < d; k++) sens[k] += Math.abs(model.w[k]) / nS;
    }
  }
  const ranked = FEATURE_NAMES.map((name, i) => ({ name, s: sens[i] })).sort((a, z) => z.s - a.s).slice(0, 12);
  line('  most influential: ' + ranked.map((r) => `${r.name}=${r.s.toFixed(2)}`).join('  '));
  return out;
}

/* ═══════════════════════════════ eval ══════════════════════════════════════ */

async function evalPolicySpec(pool, spec, tasks, battles, tag) {
  const poolTasks = [];
  for (let i = 0; i < battles; i++) {
    const t = tasks[i % tasks.length];
    poolTasks.push({
      type: 'battle',
      seed: hashSeed('gems-learn-eval', i),
      player: { characterId: t.hostId, victories: t.frame.victories },
      enemy: { id: t.frame.enemyId, floor: t.frame.floor },
      playerPolicy: spec ? 'p' : null,
    });
  }
  const results = await pool.map(poolTasks, { context: { policies: { p: spec } } });
  const win = results.filter((r) => r.playerWon).length / results.length;
  line(`  eval ${tag.padEnd(16)} win=${pct(win)}`);
  return win;
}

async function cmdEval(args) {
  const modelFile = args.model ? String(args.model) : path.join(DIR, 'reports', 'learned-value.json');
  const model = loadModel(modelFile);
  const battles = parseInt(args.battles, 10) || 400;
  const floors = String(args.floors || '6,8,9').split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const tasks = buildTasks(floors, Object.keys(CHARACTERS_BY_ID));
  const { getPool } = await import('./pool.mjs');
  const pool = getPool();
  line(`eval on floors ${floors.join(',')} (${battles} battles each, same seeds, workers=${pool.size}):`);
  const results = {
    greedy: await evalPolicySpec(pool, null, tasks, battles, 'greedy'),
    handValue: await evalPolicySpec(pool, { kind: 'value' }, tasks, battles, 'hand-value'),
    learned: await evalPolicySpec(pool, { kind: 'learned', model }, tasks, battles, 'LEARNED'),
  };
  if (args.weights && fs.existsSync(String(args.weights))) {
    results.trainedCEM = await evalPolicySpec(
      pool, { kind: 'value', weights: loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8'))) },
      tasks, battles, 'trained-CEM');
  }
  return results;
}

/* ═══════════════════════════════ iterate ═══════════════════════════════════ */

async function cmdIterate(args) {
  const rounds = parseInt(args.rounds, 10) || 3;
  const modelOut = args.out ? String(args.out) : path.join(DIR, 'reports', 'learned-value.json');
  const roundModel = path.join(DIR, 'reports', 'learned-value-round.json');
  const dataFile = path.join(DIR, 'reports', 'learn-states.jsonl');
  let mixExtra = [];
  let best = { win: -1, round: 0 };
  for (let r = 0; r < rounds; r++) {
    line(`\n== learn round ${r + 1}/${rounds} ==`);
    // data ACCUMULATES across rounds (fit on everything so far)
    await cmdCollect({ ...args, out: dataFile, append: r > 0 }, mixExtra);
    const fitted = await cmdFit({ ...args, data: dataFile, out: roundModel });
    if (!fitted) return;
    const model = loadModel(roundModel);
    // feed the current policy back into the next round's collection mix (as a SPEC)
    mixExtra = [{ kind: 'learned', model, opts: { epsilon: 0.05 } }];
    const results = await cmdEval({ ...args, model: roundModel });
    // keep the BEST round's model as the final output (rounds can regress)
    if (results.learned > best.win) {
      best = { win: results.learned, round: r + 1 };
      fs.copyFileSync(roundModel, modelOut);
      line(`  ↑ new best (round ${r + 1}, ${pct(results.learned)}) → ${path.relative(process.cwd(), modelOut)}`);
    }
  }
  line(`\nbest model: round ${best.round} at ${pct(best.win)} → ${path.relative(process.cwd(), modelOut)}`);
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
