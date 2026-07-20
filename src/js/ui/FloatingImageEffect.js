/**
 * FloatingImageEffect — a self-contained animated floating image effect.
 *
 * Renders a sprite that scales up with a bouncy ease-out from an origin
 * position, holds briefly at full size, then fades out. Designed for
 * "Extra Turn" and similar reward feedback that floats above the board.
 *
 * Not a UIElement — it uses absolute screen coordinates and is managed
 * externally (e.g., by BattleScene).
 *
 * Lifecycle:
 *   1. Instantiate with image, origin (center), target size, config.
 *   2. Call update(dt) each frame.
 *   3. Call render(ctx) each frame.
 *   4. Check `done` property — when true, remove the instance.
 *
 * Animation phases (configurable durations):
 *   GROW:     scale 0 → overshoot (bouncy ease-out with oscillation)
 *   SETTLE:   scale overshoot → 1.0
 *   HOLD:     hold at scale 1.0, alpha 1.0
 *   FADE_OUT: alpha 1.0 → 0.0 (scale stays at 1.0)
 */

export default class FloatingImageEffect {
  /**
   * @param {HTMLImageElement} image          - the sprite to render
   * @param {number}           originX        - center X in screen coordinates
   * @param {number}           originY        - center Y in screen coordinates
   * @param {number}           targetWidth    - full-size width in pixels
   * @param {number}           targetHeight   - full-size height in pixels
   * @param {object}           [config]
   * @param {number}           [config.growDuration=350]     - ms, 0→overshoot
   * @param {number}           [config.settleDuration=200]   - ms, overshoot→1
   * @param {number}           [config.holdDuration=500]     - ms, hold at full
   * @param {number}           [config.fadeDuration=300]     - ms, alpha→0
   * @param {number}           [config.overshoot=1.18]       - peak scale
   */
  constructor(image, originX, originY, targetWidth, targetHeight, config = {}) {
    this.image = image;
    this.originX = originX;
    this.originY = originY;
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;

    this.elapsed = 0;          // ms since creation
    this.done = false;         // true when animation complete

    // Timing (ms)
    this.growDuration   = config.growDuration   || 350;
    this.settleDuration = config.settleDuration || 200;
    this.holdDuration   = config.holdDuration   || 500;
    this.fadeDuration   = config.fadeDuration   || 300;

    this.overshoot = config.overshoot || 1.18;

    // Pre-compute phase boundaries
    this._settleEnd = this.growDuration + this.settleDuration;
    this._fadeStart = this._settleEnd + this.holdDuration;
    this._totalDuration = this._fadeStart + this.fadeDuration;
  }

  /**
   * Advance animation by dt milliseconds.
   * @param {number} dt - delta time in ms
   */
  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= this._totalDuration) {
      this.done = true;
    }
  }

  /**
   * Current scale factor.
   * Phase GROW:    0 → overshoot with bouncy ease-out + decaying wobble
   * Phase SETTLE:  overshoot → 1.0 (ease-out quad)
   * Phase HOLD+:   1.0
   * @returns {number}
   */
  get scale() {
    const t = this.elapsed;
    if (t <= 0) return 0;

    if (t <= this.growDuration) {
      // Phase GROW: 0 → overshoot
      const p = t / this.growDuration;

      // Base ease-out cubic: 0 → 1
      const ease = 1 - Math.pow(1 - p, 3);

      // Damped sinusoidal oscillation for bouncy feel.
      // p*(1-p) ensures wobble is 0 at both p=0 and p=1.
      // sin(p * PI * oscillations) creates the bounce wave.
      const wobble = Math.sin(p * Math.PI * 2.4) * p * (1 - p) * 0.38;

      // Clamp to ensure scale never goes negative
      return Math.max(0, this.overshoot * (ease + wobble));
    }

    if (t <= this._settleEnd) {
      // Phase SETTLE: overshoot → 1.0
      const p = (t - this.growDuration) / this.settleDuration;
      // Ease-out quad
      const ease = 1 - Math.pow(1 - p, 2);
      return this.overshoot + (1.0 - this.overshoot) * ease;
    }

    return 1.0;
  }

  /**
   * Current alpha (0 → 1).
   * @returns {number}
   */
  get alpha() {
    const t = this.elapsed;
    if (t <= this._fadeStart) return 1.0;
    const p = (t - this._fadeStart) / this.fadeDuration;
    if (p >= 1) return 0;
    // Smooth ease-out fade
    return 1.0 - p * p;
  }

  /**
   * Render the effect to a canvas context.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.done || !this.image) return;

    const s = this.scale;
    const alpha = this.alpha;

    if (alpha <= 0 || s <= 0.001) return;

    const w = this.targetWidth * s;
    const h = this.targetHeight * s;
    const x = Math.floor(this.originX - w / 2);
    const y = Math.floor(this.originY - h / 2);
    const rw = Math.ceil(w);
    const rh = Math.ceil(h);

    ctx.save();
    ctx.globalAlpha = alpha;
    // These are detailed, glow-heavy art scaled to a fractional size (and the
    // scale animates each frame), so they must be bilinearly smoothed — nearest
    // neighbour (imageSmoothingEnabled = false) aliases the text/glow edges.
    // The expensive part — the big source art's 'high'-quality downscale —
    // happens ONCE into a pre-scaled copy (see _getDrawImage); the per-frame
    // draw is then a near-1:1 blit that default smoothing handles cleanly.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._getDrawImage(ctx), x, y, rw, rh);
    ctx.restore();
  }

  /**
   * The image to blit each frame: the raw source when it's already near the
   * display size, else a one-time 'high'-quality downscale of it baked at the
   * animation's PEAK physical size (so every per-frame draw is a ≤1:1 blit
   * instead of a fresh multi-hundred-px 'high' downsample of the source art —
   * a constant cost on mobile while a turn/extra-turn banner is up).
   * @private
   */
  _getDrawImage(ctx) {
    if (this._drawImage !== undefined) return this._drawImage || this.image;

    // Physical px per design px (DPR × contain-fit) under the live transform.
    let pxScale = 1;
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      pxScale = Math.max(0.1, Math.hypot(m.a, m.b));
    }
    // Peak displayed size (+ headroom: the grow wobble can briefly exceed the
    // overshoot by a few %), in physical pixels.
    const peakW = Math.ceil(this.targetWidth * this.overshoot * 1.1 * pxScale);
    const peakH = Math.ceil(this.targetHeight * this.overshoot * 1.1 * pxScale);

    // Source already at/below display size (or no DOM) → draw it directly.
    if (typeof document === 'undefined' || !this.image.width
        || this.image.width <= peakW) {
      this._drawImage = null;
      return this.image;
    }

    const cv = document.createElement('canvas');
    cv.width = peakW;
    cv.height = peakH;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.image, 0, 0, peakW, peakH);
    this._drawImage = cv;
    return cv;
  }
}
