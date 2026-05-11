/**
 * FloatingTextEffect — animated floating text for match feedback.
 *
 * Renders colored text that scales up with a bouncy ease-out from an origin
 * position, holds briefly at full size, then fades out. Designed for
 * "+3", "+4", "+5" match-count feedback that floats above the board.
 *
 * Renders text with a white dropshadow and black outline for readability
 * against any background.
 *
 * Not a UIElement — uses absolute screen coordinates and is managed
 * externally (e.g., by BattleScene).
 *
 * Lifecycle:
 *   1. Instantiate with text, color, origin, config.
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

export default class FloatingTextEffect {
  /**
   * @param {string}  text           - the text to render (e.g., "+3")
   * @param {string}  color          - CSS color for the text fill
   * @param {number}  originX        - center X in screen coordinates
   * @param {number}  originY        - center Y in screen coordinates
   * @param {object}  [config]
   * @param {number}  [config.fontSize=22]        - font size in pixels at scale 1.0
   * @param {string}  [config.fontFamily='Marcellus SC, serif']
   * @param {number}  [config.growDuration=200]   - ms, 0→overshoot
   * @param {number}  [config.settleDuration=100] - ms, overshoot→1
   * @param {number}  [config.holdDuration=300]   - ms, hold at full
   * @param {number}  [config.fadeDuration=100]   - ms, alpha→0
   * @param {number}  [config.overshoot=1.18]     - peak scale
   */
  constructor(text, color, originX, originY, config = {}) {
    this.text = text;
    this.color = color;
    this.originX = originX;
    this.originY = originY;

    this.fontSize = config.fontSize || 22;
    this.fontFamily = config.fontFamily || 'Marcellus SC, serif';

    this.elapsed = 0;          // ms since creation
    this.done = false;         // true when animation complete

    // Timing (ms)
    this.growDuration   = config.growDuration   || 200;
    this.settleDuration = config.settleDuration || 100;
    this.holdDuration   = config.holdDuration   || 300;
    this.fadeDuration   = config.fadeDuration   || 100;

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
    if (this.done) return;

    const s = this.scale;
    const alpha = this.alpha;

    if (alpha <= 0 || s <= 0.001) return;

    const scaledFontSize = Math.round(this.fontSize * s);
    const font = `bold ${scaledFontSize}px "${this.fontFamily}"`;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // White dropshadow — offset downward-right
    const shadowOffset = Math.max(1, 2 * s);
    ctx.font = font;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(this.text, this.originX + shadowOffset, this.originY + shadowOffset);

    // Black outline stroke
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = Math.max(1.5, 3.5 * s);
    ctx.lineJoin = 'round';
    ctx.strokeText(this.text, this.originX, this.originY);

    // Colored fill on top
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.originX, this.originY);

    ctx.restore();
  }
}
