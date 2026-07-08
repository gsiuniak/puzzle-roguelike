/**
 * toolbench/ui/pool.mjs — browser Web-Worker pool (Balance Bench).
 *
 * Counterpart of the node pool.mjs: min(hardwareConcurrency−1, 12) module
 * workers, a task queue, ordered results, progress + cancellation. Every task
 * is fully seeded, so scheduling NEVER changes results — only wall-clock.
 *
 * Jobs are serialized through an internal chain: `context` (the policy-spec
 * dict) is per-JOB state broadcast to every worker, so two overlapping map()
 * calls must not interleave. Views can fire-and-forget; queued jobs wait.
 *
 * Cancellation: token = { cancelled:false }. Setting it stops NEW dispatches;
 * in-flight tasks finish (battle chunks are short). A cancelled map() rejects
 * with { cancelled:true } so callers can distinguish abort from failure.
 */

const POOL_MAX = 12;

class BenchPool {
  constructor(size) {
    this.size = size;
    this.workers = [];
  }

  _spawn() {
    if (this.workers.length) return;
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('./bench-worker.mjs', import.meta.url), { type: 'module' });
      this.workers.push(w);
    }
  }

  async _setContext(context) {
    this._spawn();
    await Promise.all(this.workers.map((w) => new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data && e.data.type === 'ready') { w.removeEventListener('message', onMsg); resolve(); }
        if (e.data && e.data.type === 'error') { w.removeEventListener('message', onMsg); reject(new Error(e.data.error)); }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'context', context: context || {} });
    })));
  }

  /**
   * Run tasks across the pool. Returns results ORDERED to match `tasks`.
   * opts: { context, onProgress(done,total), token }
   */
  map(tasks, opts = {}) {
    // serialize jobs — context is pool-global state
    this._chain = (this._chain || Promise.resolve()).then(
      () => this._run(tasks, opts),
      () => this._run(tasks, opts), // a failed/cancelled prior job doesn't poison the queue
    );
    return this._chain;
  }

  async _run(tasks, { context = {}, onProgress, token } = {}) {
    if (!tasks.length) return [];
    await this._setContext(context);
    const results = new Array(tasks.length);
    let next = 0, done = 0;
    return new Promise((resolve, reject) => {
      const idle = [...this.workers];
      const pump = () => {
        if (token && token.cancelled) { reject({ cancelled: true }); return; }
        while (idle.length && next < tasks.length) {
          const w = idle.pop();
          const id = next++;
          const onMsg = (e) => {
            const d = e.data || {};
            if (d.id !== id) return;
            w.removeEventListener('message', onMsg);
            if (d.type === 'error') { reject(new Error(d.error)); return; }
            results[id] = d.result;
            done++;
            onProgress && onProgress(done, tasks.length);
            idle.push(w);
            if (done === tasks.length) resolve(results);
            else pump();
          };
          w.addEventListener('message', onMsg);
          w.postMessage({ type: 'task', id, task: tasks[id] });
        }
      };
      pump();
    });
  }

  destroy() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

let _pool = null;
export function getPool() {
  if (!_pool) {
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    _pool = new BenchPool(Math.max(1, Math.min(POOL_MAX, hw - 1)));
  }
  return _pool;
}

export function makeToken() { return { cancelled: false }; }
export const supportsModuleWorkers = typeof Worker !== 'undefined';
