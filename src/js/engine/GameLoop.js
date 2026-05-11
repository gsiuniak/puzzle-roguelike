/**
 * GameLoop — a simple requestAnimationFrame loop with delta time.
 *
 * Usage:
 *   const loop = new GameLoop();
 *   loop.start((dt) => { update(dt); render(); });
 */
export default class GameLoop {
  constructor() {
    this._callback = null;
    this._running = false;
    this._lastTime = 0;
    this._rafId = null;

    // Cap delta to avoid spiral of death
    this.maxDelta = 100; // ms

    // Bound tick for requestAnimationFrame
    this._tick = this._tick.bind(this);
  }

  /**
   * Start the loop.
   * @param {function} callback - (deltaTimeMs) => {}
   */
  start(callback) {
    this._callback = callback;
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick(now) {
    if (!this._running) return;

    let dt = now - this._lastTime;
    this._lastTime = now;

    // Clamp delta to avoid huge jumps on tab-away
    if (dt > this.maxDelta) {
      dt = this.maxDelta;
    }

    // Ensure positive
    if (dt <= 0) dt = 16.67;

    try {
      this._callback(dt);
    } catch (e) {
      console.error('GameLoop error:', e);
      this.stop();
      return;
    }

    this._rafId = requestAnimationFrame(this._tick);
  }

  get running() { return this._running; }
}
