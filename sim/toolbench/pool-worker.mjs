/**
 * toolbench/pool-worker.mjs — worker side of pool.mjs. Resolves policy SPECS
 * (see pool.mjs) into live policies via the shared policies.mjs resolver
 * (cached per context), then executes fully seeded tasks: 'battle' (one
 * Battle), 'run' (one full run via run-core.mjs runOneRun), 'collect' (one
 * recorded self-play battle via learn.mjs collectOneBattle).
 */

import { parentPort } from 'node:worker_threads';
import { Battle, makePlayerCombatant, makeEnemyCombatant } from './engine.mjs';
import { makePolicyResolver } from './policies.mjs';
import { withSeededRandom } from './rng.mjs';

let resolvePolicy = makePolicyResolver({});

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
      const { runOneRun } = await import('./run-core.mjs');
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
      resolvePolicy = makePolicyResolver((msg.context && msg.context.policies) || {});
      parentPort.postMessage({ type: 'ready' });
    } else if (msg.type === 'task') {
      parentPort.postMessage({ type: 'result', id: msg.id, result: await handle(msg.task) });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: (err && err.stack) || String(err) });
  }
});
