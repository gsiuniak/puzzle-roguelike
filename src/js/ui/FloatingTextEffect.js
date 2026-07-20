/**
 * FloatingTextEffect — animated floating text for match feedback.
 *
 * Renders colored text that scales up with a bouncy ease-out from an origin
 * position, holds briefly at full size, then fades out. Optionally drifts
 * upward over its lifetime (config.riseDistance) for floating-combat-text
 * style. Used for both "+3"/"+4" match-count feedback above the board (static)
 * and "-x"/"+x" damage/heal/armor numbers above portraits (rising).
 *
 * Renders text with a white dropshadow and black outline for readability
 * against any background.
 *
 * ── Mobile performance ────────────────────────────────────────────────
 * The scale animates every frame, and canvas text is re-rasterized whenever
 * the font size changes — so the old 3-pass draw (shadow fill + outline
 * stroke + color fill) was three fresh glyph rasterizations per effect per
 * frame, exactly during cascade steps when several of these are live. The
 * text is instead baked ONCE into an offscreen sprite (at the animation's
 * peak scale, at physical resolution so it stays crisp) and each frame is a
 * single scaled drawImage. Repeated strings ("+3", "-5"…) share bakes via a
 * small module cache.
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

// Module cache of baked text sprites, keyed by text|color|font|pxScale.
// Match/stat popups reuse a handful of short strings, so most spawns hit the
// cache. Cleared wholesale when it grows past the cap (re-bakes are cheap).
const _textSpriteCache = new Map();
const TEXT_SPRITE_CACHE_MAX = 64;

// The animated scale peaks at overshoot*(ease+wobble); wobble is bounded well
// under +10%, so baking at overshoot*1.1 guarantees the per-frame blit only
// ever DOWNscales (never blurs up).
const BAKE_SCALE_HEADROOM = 1.1;

/**
 * Bake the 3-pass text look (white dropshadow, black outline, colored fill)
 * into an offscreen canvas. `fontPx` is the font size in PHYSICAL pixels;
 * `unitPx` is physical px per design px at the bake scale — the shadow offset
 * (2 design px) and outline width (3.5 design px) are absolute in the live
 * look, so they scale by unitPx, NOT by the font size. The main glyph run is
 * centered on the canvas center (the shadow's +offset asymmetry lives inside
 * the padding), so callers can center the sprite on the text anchor.
 * @returns {{canvas:HTMLCanvasElement, w:number, h:number}|null}
 */
function _bakeTextSprite(text, color, fontFamily, fontPx, unitPx) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  const font = `bold ${Math.round(fontPx)}px "${fontFamily}"`;
  const shadowOffset = Math.max(1, 2 * unitPx);
  const lineWidth = Math.max(1.5, 3.5 * unitPx);
  c.font = font;
  const textW = c.measureText(text).width;
  // Padding covers the outline stroke + the down-right shadow offset.
  const pad = Math.ceil(lineWidth / 2 + shadowOffset) + 2;
  const w = Math.ceil(textW) + pad * 2;
  const h = Math.ceil(fontPx * 1.4) + pad * 2;
  canvas.width = w;
  canvas.height = h;
  c.font = font; // reset by the resize
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cx = w / 2;
  const cy = h / 2;

  // White dropshadow — offset downward-right.
  c.fillStyle = 'rgba(255, 255, 255, 0.9)';
  c.fillText(text, cx + shadowOffset, cy + shadowOffset);
  // Black outline stroke.
  c.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  c.lineWidth = lineWidth;
  c.lineJoin = 'round';
  c.strokeText(text, cx, cy);
  // Colored fill on top.
  c.fillStyle = color;
  c.fillText(text, cx, cy);
  return { canvas, w, h };
}

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
   * @param {number}  [config.riseDistance=0]     - px the text drifts UPWARD
   *                                                over its lifetime (0 = static,
   *                                                the classic "+3" match style;
   *                                                >0 = floating-combat-text style)
   */
  constructor(text, color, originX, originY, config = {}) {
    this.text = text;
    this.color = color;
    this.originX = originX;
    this.originY = originY;

    this.fontSize = config.fontSize || 22;
    this.fontFamily = config.fontFamily || 'Marcellus SC, serif';
    this.riseDistance = config.riseDistance || 0;

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
   * Current upward drift in pixels (0 → riseDistance), eased so the text moves
   * quickly at first and decelerates as it fades — the classic floating-combat-
   * text arc. Returns 0 when riseDistance is 0 (static match-count style).
   * @returns {number}
   */
  get riseOffset() {
    if (!this.riseDistance) return 0;
    const p = Math.min(1, this.elapsed / this._totalDuration);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
    return this.riseDistance * ease;
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
   * Render the effect to a canvas context — one scaled blit of the baked
   * text sprite (see _bakeTextSprite; falls back to direct text drawing
   * until the custom font is ready so a bake never freezes the fallback font).
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.done) return;

    const s = this.scale;
    const alpha = this.alpha;

    if (alpha <= 0 || s <= 0.001) return;

    // Drift upward over the lifetime (0 for static match-count text).
    const y = this.originY - this.riseOffset;

    const sprite = this._getSprite(ctx);
    if (!sprite) {
      this._renderDirect(ctx, s, alpha, y);
      return;
    }

    // Design-px size of the blit: the bake is at bakeScale (× pxScale physical),
    // so the current animation scale maps to a pure downscale of the sprite.
    const f = s / sprite.bakeScale / sprite.pxScale;
    const w = sprite.w * f;
    const h = sprite.h * f;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sprite.canvas, this.originX - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  /**
   * Fetch (or bake) this effect's text sprite from the module cache.
   * Returns null when baking isn't possible/appropriate (no DOM, or the
   * custom font hasn't loaded yet — baking then would freeze the fallback
   * font for the effect's whole life).
   * @private
   */
  _getSprite(ctx) {
    if (this._sprite) return this._sprite;
    if (typeof document === 'undefined') return null;

    // Physical pixels per design px under the current transform (DPR ×
    // contain-fit) — bake at physical resolution so the text stays as crisp
    // as the old per-frame rasterization.
    let pxScale = 1;
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      pxScale = Math.max(0.1, Math.hypot(m.a, m.b));
    }
    pxScale = Math.round(pxScale * 100) / 100;

    const bakeScale = this.overshoot * BAKE_SCALE_HEADROOM;
    const fontPx = this.fontSize * bakeScale * pxScale;

    // Don't bake (or cache) while fonts are still LOADING — a bake made with
    // a fallback font would freeze that look for the effect's whole life.
    // (fonts.check() can't be used here: fontFamily is a comma list, which
    // check() treats as one unknown family and rejects forever.) Once loading
    // has settled — always the case in battle — bake freely.
    if (document.fonts && document.fonts.status === 'loading') return null;

    const key = `${this.text}|${this.color}|${this.fontSize}|${this.fontFamily}|${pxScale}`;
    let baked = _textSpriteCache.get(key);
    if (!baked) {
      baked = _bakeTextSprite(this.text, this.color, this.fontFamily, fontPx, bakeScale * pxScale);
      if (!baked) return null;
      if (_textSpriteCache.size >= TEXT_SPRITE_CACHE_MAX) _textSpriteCache.clear();
      _textSpriteCache.set(key, baked);
    }
    this._sprite = { canvas: baked.canvas, w: baked.w, h: baked.h, bakeScale, pxScale };
    return this._sprite;
  }

  /**
   * Legacy per-frame text drawing — used only until the font is ready.
   * @private
   */
  _renderDirect(ctx, s, alpha, y) {
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
    ctx.fillText(this.text, this.originX + shadowOffset, y + shadowOffset);

    // Black outline stroke
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = Math.max(1.5, 3.5 * s);
    ctx.lineJoin = 'round';
    ctx.strokeText(this.text, this.originX, y);

    // Colored fill on top
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, this.originX, y);

    ctx.restore();
  }
}
