/**
 * toolbench/pool.mjs — worker_threads pool for the measurement/training
 * harnesses. Battles are embarrassingly parallel and every task is fully
 * seeded (rng.mjs), so results are IDENTICAL regardless of scheduling — the
 * pool changes wall-clock, never numbers.
 *
 * Tasks are handled by pool-worker.mjs (types: 'battle' | 'run' | 'collect').
 * Policies travel as serializable SPECS resolved worker-side:
 *   null / 'greedy'                    → engine greedy
 *   { kind:'value', weights?, opts? }  → policy.mjs makeValuePolicy
 *   { kind:'learned', model, opts? }   → learn.mjs makeLearnedPolicy
 * Specs live in the per-map `context.policies` dict (sent ONCE per worker);
 * tasks reference them by key — so a 15KB learned model isn't re-sent per task.
 *
 * Usage:
 *   const pool = getPool();                      // shared, sized cpus-1, unref'd
 *   const results = await pool.map(tasks, { context, onProgress });
 * Set GEMS_POOL_WORKERS=1 (or new WorkerPool(1)) to debug serially-ish.
 */

import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pool-worker.mjs');

export class WorkerPool {
  constructor(size) {
    const env = parseInt(process.env.GEMS_POOL_WORKERS || '', 10);
    const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    this.size = size || (Number.isFinite(env) && env > 0 ? env : Math.max(1, cores - 1));
    this.workers = Array.from({ length: this.size }, () => {
      const w = new Worker(WORKER_PATH);
      w.unref(); // don't hold the process open between maps
      return w;
    });
  }

  /** Run all tasks; resolves to results aligned with `tasks` order. */
  map(tasks, { context = null, onProgress = null } = {}) {
    if (!tasks.length) return Promise.resolve([]);
    const results = new Array(tasks.length);
    let next = 0, done = 0;
    return Promise.all(this.workers.map((w) => new Promise((resolve, reject) => {
      const feed = () => {
        if (next >= tasks.length) { cleanup(); resolve(); return; }
        const id = next++;
        w.postMessage({ type: 'task', id, task: tasks[id] });
      };
      const onMsg = (msg) => {
        if (msg.type === 'ready') { feed(); return; }
        if (msg.type === 'result') {
          results[msg.id] = msg.result;
          done++;
          if (onProgress) onProgress(done, tasks.length);
          feed();
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(`[pool-worker] ${msg.error}`));
        }
      };
      const onErr = (err) => { cleanup(); reject(err); };
      const cleanup = () => { w.off('message', onMsg); w.off('error', onErr); };
      w.on('message', onMsg);
      w.on('error', onErr);
      w.postMessage({ type: 'context', context }); // worker replies 'ready'
    }))).then(() => results);
  }

  async close() { await Promise.all(this.workers.map((w) => w.terminate())); }
}

let shared = null;
export function getPool() {
  if (!shared) shared = new WorkerPool();
  return shared;
}
