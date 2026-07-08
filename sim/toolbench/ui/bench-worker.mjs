/**
 * toolbench/ui/bench-worker.mjs — the BROWSER module worker (Balance Bench).
 *
 * Mirrors pool-worker.mjs (node) task-for-task so a browser batch and a node
 * batch on the same seeds produce identical results — both import the same
 * engine + policies + run-core. Simulation runs ONLY here, never on the page
 * thread: `withSeededRandom` swaps the GLOBAL Math.random (safe in a worker's
 * single-threaded scope, hazardous beside UI code).
 *
 * Protocol (postMessage):
 *   in : { type:'context', context:{ policies:{ref→spec} } } → { type:'ready' }
 *   in : { type:'task', id, task }                           → { type:'result', id, result }
 *                                                       error → { type:'error', id, error }
 * Tasks:
 *   { type:'battles', seeds:[...], player, enemy:{id|def,floor,overrides},
 *     playerPolicy:ref, enemyPolicy:ref, battleOpts } → Battle.run() results (seed order)
 *   { type:'run', opts:{seed,characterId,fightChance,weaveFloors}, playerPolicy:ref }
 *     → runOneRun record
 */

import { Battle, makePlayerCombatant, makeEnemyCombatant } from '../engine.mjs';
import { makePolicyResolver } from '../policies.mjs';
import { withSeededRandom } from '../rng.mjs';
import { runOneRun } from '../run-core.mjs';

let resolvePolicy = makePolicyResolver({});

async function handle(task) {
  switch (task.type) {
    case 'battles': {
      const p = await resolvePolicy(task.playerPolicy);
      const e = await resolvePolicy(task.enemyPolicy);
      const enemyRef = task.enemy.def || task.enemy.id; // Designer customs travel as full defs
      const out = new Array(task.seeds.length);
      for (let i = 0; i < task.seeds.length; i++) {
        out[i] = withSeededRandom(task.seeds[i], () => new Battle(
          makePlayerCombatant(task.player),
          makeEnemyCombatant(enemyRef, task.enemy.floor, task.enemy.overrides || {}),
          { ...(task.battleOpts || {}), playerPolicy: p, enemyPolicy: e },
        ).run());
      }
      return out;
    }
    case 'run':
      return runOneRun(task.opts, await resolvePolicy(task.playerPolicy));
    default:
      throw new Error(`unknown task type "${task.type}"`);
  }
}

self.onmessage = async (msg) => {
  const data = msg.data || {};
  try {
    if (data.type === 'context') {
      resolvePolicy = makePolicyResolver((data.context && data.context.policies) || {});
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'task') {
      self.postMessage({ type: 'result', id: data.id, result: await handle(data.task) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, error: (err && err.stack) || String(err) });
  }
};
