/**
 * PerfHud — tiny frame-time overlay for profiling, enabled with the `?perf`
 * URL flag (wired in main.js → SceneManager.setPerfHud).
 *
 * Tracks a rolling window of frame intervals plus the update / layout / render
 * sub-phases measured by SceneManager._tick, and draws fps, avg and p95 frame
 * time, and per-phase averages in the top-left corner. Stats strings refresh
 * every 30 frames so the HUD itself does no per-frame sorting or string work;
 * drawing is a fillRect + a few fillText — negligible next to what it measures.
 */
export default class PerfHud {
  /** @param {number} [windowSize=120] — rolling sample window (frames) */
  constructor(windowSize = 120) {
    this._n = windowSize;
    this._interval = new Float32Array(windowSize); // rAF-to-rAF delta (ms)
    this._update = new Float32Array(windowSize);   // scene.update time (ms)
    this._layout = new Float32Array(windowSize);   // layoutChildren time (ms)
    this._render = new Float32Array(windowSize);   // clear+render+hooks time (ms)
    this._scratch = new Float32Array(windowSize);  // reused for p95 sort
    this._idx = 0;
    this._count = 0;
    this._framesSinceRefresh = 0;
    this._lines = [];
  }

  /**
   * Record one frame's timings. Called by SceneManager._tick.
   * @param {number} intervalMs — dt between rAF ticks
   * @param {number} updateMs
   * @param {number} layoutMs
   * @param {number} renderMs
   */
  addFrame(intervalMs, updateMs, layoutMs, renderMs) {
    const i = this._idx;
    this._interval[i] = intervalMs;
    this._update[i] = updateMs;
    this._layout[i] = layoutMs;
    this._render[i] = renderMs;
    this._idx = (i + 1) % this._n;
    if (this._count < this._n) this._count++;
    if (++this._framesSinceRefresh >= 30) {
      this._framesSinceRefresh = 0;
      this._refreshLines();
    }
  }

  _avg(arr) {
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += arr[i];
    return sum / this._count;
  }

  _p95(arr) {
    const n = this._count;
    for (let i = 0; i < n; i++) this._scratch[i] = arr[i];
    const view = this._scratch.subarray(0, n);
    view.sort(); // TypedArray sort is numeric
    return view[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  _refreshLines() {
    if (!this._count) return;
    const avgInterval = this._avg(this._interval);
    const fps = avgInterval > 0 ? 1000 / avgInterval : 0;
    const cpu = this._avg(this._update) + this._avg(this._layout) + this._avg(this._render);
    this._lines = [
      `fps ${fps.toFixed(0)}   frame ${avgInterval.toFixed(1)}ms   p95 ${this._p95(this._interval).toFixed(1)}ms`,
      `cpu ${cpu.toFixed(2)}ms = upd ${this._avg(this._update).toFixed(2)} + lay ${this._avg(this._layout).toFixed(2)} + rndr ${this._avg(this._render).toFixed(2)}`,
    ];
  }

  /**
   * Draw the HUD. Called last in the frame, in design-space coordinates.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this._lines.length) return;
    const pad = 6;
    const lineH = 20;
    ctx.save();
    ctx.font = '15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(8, 8, 440, pad * 2 + lineH * this._lines.length);
    ctx.fillStyle = '#7fff7f';
    for (let i = 0; i < this._lines.length; i++) {
      ctx.fillText(this._lines[i], 8 + pad, 8 + pad + i * lineH);
    }
    ctx.restore();
  }
}
