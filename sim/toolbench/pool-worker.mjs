/**
 * toolbench/pool-worker.mjs — worker side of pool.mjs. Resolves policy SPECS
 * (see pool.mjs) into live policies (cached per context), then executes fully
 * seeded tasks: 'battle' (one Battle), 'run' (one full run via runs.mjs
 * runOneRun), 'collect' (one recorded self-play battle via learn.mjs
 * collectOneBattle).
 */

import { parentPort } from 'node:worker_threads';
import { Battle, makePlayerCombatant, makeEnemyCombatant } from './engine.mjs';
import { makeValuePolicy } from './policy.mjs';
import { withSeededRandom } from './rng.mjs';

let policies = {};
const cache = new Map();

async function resolvePolicy(ref) {
  if (ref == null) return null;
  if (cache.has(ref)) return cache.get(ref);
  const spec = policies[ref];
  let pol = null;
  if (spec && spec.kind === 'value') pol = makeValuePolicy(spec.weights || {}, spec.opts || {});
  else if (spec && spec.kind === 'learned') {
    const { makeLearnedPolicy } = await import('./learn.mjs');
    pol = makeLearnedPolicy(spec.model, spec.opts || {});
  } else if (spec && spec.kind === 'conv') {
    const { makeConvPolicy, loadConvModel } = await import('./nn.mjs');
    pol = makeConvPolicy(loadConvModel(spec.model), spec.opts || {});
  } else if (spec && spec.kind === 'formula') {
    const { makeFormulaPolicy } = await import('./formula.mjs');
    pol = makeFormulaPolicy(spec.weights || {}, spec.opts || {});
  }
  cache.set(ref, pol);
  return pol;
}

async function handle(task) {
  switch (task.type) {
    case 'battle': {
      const p = await resolvePolicy(task.playerPolicy);
      const e = await resolvePolicy(task.enemyPolicy);
      return withSeededRandom(task.seed, () => new Battle(
        makePlayerCombatant(task.player),
        makeEnemyCombatant(task.enemy.id, task.enemy.floor, task.enemy.overrides || {}),
        { ...(task.battleOpts || {}), playerPolicy: p, enemyPolicy: e },
      ).run());
    }
    case 'run': {
      const { runOneRun } = await import('./runs.mjs');
      return runOneRun(task.opts, await resolvePolicy(task.playerPolicy));
    }
    case 'collect': {
      const { collectOneBattle } = await import('./learn.mjs');
      return collectOneBattle(task.opts, await resolvePolicy(task.playerPolicy), await resolvePolicy(task.enemyPolicy));
    }
    default: throw new Error(`unknown task type "${task.type}"`);
  }
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'context') {
      policies = (msg.context && msg.context.policies) || {};
      cache.clear();
      parentPort.postMessage({ type: 'ready' });
    } else if (msg.type === 'task') {
      parentPort.postMessage({ type: 'result', id: msg.id, result: await handle(msg.task) });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: (err && err.stack) || String(err) });
  }
});
