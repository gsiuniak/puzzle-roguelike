/**
 * SpriteSheetAnimation — play a packed, alpha-TRIMMED spritesheet animation ONCE
 * over a target rect, honoring each frame's trim offset so the motion is stable.
 *
 * PROOF OF CONCEPT (warrior attack flash on skull match). Deliberately
 * self-contained and easy to remove: delete this file, its use in BattleScene
 * (the WARRIOR_ATTACK_ANIM block + `_warriorAttackAnim`), and the
 * `ui_spritesheet_warrior_attack_animation` entry in main.js SPRITESHEET_MAP.
 *
 * Why it draws from the FULL sheet (not the sliced sprites): AssetManager slices
 * each sprite into a w×h canvas but DISCARDS the per-frame trim_x/trim_y/source_w/
 * source_h offsets. Those offsets are exactly what keep a trimmed animation from
 * jittering (each frame has a different content box). So this effect reads the
 * sheet's JSON sidecar itself and blits each frame's source rect out of the full
 * sheet image (am.get(sheetKey)), positioning it within a virtual source frame
 * (source_w × source_h) mapped onto an aspect-correct box centered on the anchor.
 *
 * Externally-managed effect contract (same as the other battle effects):
 *   update(dt) / render(ctx) / `done`. Lives wherever the host wants.
 */

// Module-level cache: jsonPath → Promise<frames[]> (sorted by index). One fetch
// per sheet regardless of how many times the animation plays.
const _frameCache = new Map();

/** Numeric suffix of a sprite name (e.g. "frame_00007_" → 7), or null. */
function _nameOrder(name) {
  const m = String(name).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function _loadFrames(jsonPath) {
  if (_frameCache.has(jsonPath)) return _frameCache.get(jsonPath);
  const p = fetch(jsonPath)
    .then((r) => r.json())
    .then((data) => {
      const sprites = (data && data.sprites) || {};
      // Play in FRAME-NAME order (frame_00001_, frame_00002_, …) — the name's
      // numeric suffix is the true timeline order. Do NOT trust the JSON `index`
      // field: some packers set it to bin-PACKING order, which scrambles the
      // animation (e.g. frame_00043_ packed as index 0). Fall back to `index`
      // only for sprite names that carry no number.
      return Object.entries(sprites)
        .map(([name, f]) => ({
          x: f.x, y: f.y, w: f.w, h: f.h,
          order: _nameOrder(name),
          index: f.index ?? 0,
          trimX: f.trim_x ?? 0,
          trimY: f.trim_y ?? 0,
          sourceW: f.source_w || f.w,
          sourceH: f.source_h || f.h,
        }))
        .sort((a, b) => {
          const ka = a.order != null ? a.order : a.index;
          const kb = b.order != null ? b.order : b.index;
          return ka - kb;
        });
    })
    .catch((err) => {
      console.warn(`SpriteSheetAnimation: failed to load frames "${jsonPath}":`, err);
      return [];
    });
  _frameCache.set(jsonPath, p);
  return p;
}

export default class SpriteSheetAnimation {
  /**
   * @param {string} sheetKey    - AssetManager key of the FULL packed sheet image
   * @param {string} jsonPath    - path to the sheet's JSON sidecar (page-relative)
   * @param {import('../engine/AssetManager.js').default} assetManager
   * @param {object} opts
   * @param {{x:number,y:number,w:number,h:number}} opts.anchorRect - rect to center over (e.g. a portrait)
   * @param {number} [opts.scale=1.2]  - box height as a multiple of the anchor's height (width follows source aspect)
   * @param {{x:number,y:number}} [opts.offset={x:0,y:0}] - nudge from the anchor center (design px)
   * @param {number} [opts.fps=18]     - playback frame rate
   * @param {number} [opts.alpha=1]    - overall opacity
   * @param {boolean} [opts.loop=false]  - repeat instead of completing (debug preview)
   * @param {boolean} [opts.hold=false]  - hold on the last frame instead of completing (never `done`)
   * @param {boolean} [opts.paused=false]- start paused (debug: step frames by hand)
   * @param {number} [opts.fadeOutFrames=0] - over the LAST N frames, ramp opacity 1→0 so the
   *   animation cross-fades into the portrait beneath it (smooths the hand-off, hides end-frame
   *   artifacts). 0 = no fade. Continuous (time-based), not stepped.
   */
  constructor(sheetKey, jsonPath, assetManager, opts = {}) {
    this._sheetKey = sheetKey;
    this._am = assetManager;
    this._anchor = { ...opts.anchorRect };
    this._scale = opts.scale ?? 1.2;
    this._offset = opts.offset ? { ...opts.offset } : { x: 0, y: 0 };
    this._fps = opts.fps ?? 18;
    this._alpha = opts.alpha ?? 1;
    this._fadeOutFrames = Math.max(0, opts.fadeOutFrames || 0);
    this._loop = !!opts.loop;
    this._hold = !!opts.hold;
    this._paused = !!opts.paused;

    this._frames = null;
    this._time = 0;       // seconds since start
    this.done = false;

    _loadFrames(jsonPath).then((frames) => {
      this._frames = frames;
      if (!frames || frames.length === 0) this.done = true;
    });
  }

  update(dt) {
    if (this.done || this._paused) return;
    this._time += dt / 1000;
    if (this._frames && this._frames.length) {
      const totalSec = this._frames.length / this._fps;
      if (this._time >= totalSec) {
        if (this._loop) this._time %= totalSec;
        else if (this._hold) this._time = (this._frames.length - 1) / this._fps;
        else this.done = true;
      }
    }
  }

  /** Current (clamped) frame index. @private */
  _currentIndex() {
    if (!this._frames || !this._frames.length) return 0;
    return Math.max(0, Math.min(this._frames.length - 1, Math.floor(this._time * this._fps)));
  }

  // ── Live controls (for the BattleScene debug tuner) ──
  pause() { this._paused = true; }
  play() { this._paused = false; if (this.done) { this.done = false; this._time = 0; } }
  togglePause() { if (this._paused) this.play(); else this.pause(); }
  setScale(s) { this._scale = Math.max(0.05, s); }
  setOffset(x, y) { this._offset.x = x; this._offset.y = y; }
  setFadeOutFrames(n) { this._fadeOutFrames = Math.max(0, n || 0); }

  /**
   * Opacity multiplier for the tail cross-fade: 1 until the last `fadeOutFrames`
   * frames, then ramps linearly to 0 at the end (continuous, time-based). @private
   */
  _fadeAlpha() {
    const n = this._frames ? this._frames.length : 0;
    if (this._fadeOutFrames <= 0 || n <= 0) return 1;
    const framePos = this._time * this._fps; // continuous position in [0, n)
    const fadeStart = n - this._fadeOutFrames;
    if (framePos <= fadeStart) return 1;
    return Math.max(0, Math.min(1, 1 - (framePos - fadeStart) / this._fadeOutFrames));
  }
  /** Jump to a frame and pause (clamped). */
  setFrame(i) {
    if (!this._frames || !this._frames.length) return;
    const c = Math.max(0, Math.min(this._frames.length - 1, i));
    this._time = c / this._fps + 1e-4;
    this._paused = true;
    this.done = false;
  }
  stepFrame(delta) { this.setFrame(this._currentIndex() + delta); }
  /** Snapshot of the current tuning/playback for a debug HUD. */
  getDebugInfo() {
    return {
      scale: this._scale,
      offset: { x: this._offset.x, y: this._offset.y },
      frame: this._currentIndex(),
      frameCount: this._frames ? this._frames.length : 0,
      paused: this._paused,
      fadeOutFrames: this._fadeOutFrames,
      fadeAlpha: this._fadeAlpha(),
    };
  }

  render(ctx) {
    if (this.done || !this._frames || this._frames.length === 0) return;
    const sheet = this._am ? this._am.get(this._sheetKey) : null;
    if (!sheet) return;

    const f = this._frames[this._currentIndex()];
    if (!f) return;

    // Aspect-correct box centered on the anchor: box height = anchor height ×
    // scale; width follows the source frame's aspect (so no squish). The frame's
    // trimmed content is then placed by its trim offset within that box.
    const a = this._anchor;
    const srcAspect = f.sourceW / f.sourceH;
    const boxH = a.h * this._scale;
    const boxW = boxH * srcAspect;
    const cx = a.x + a.w / 2 + this._offset.x;
    const cy = a.y + a.h / 2 + this._offset.y;
    const boxX = cx - boxW / 2;
    const boxY = cy - boxH / 2;

    const sx = boxW / f.sourceW;
    const sy = boxH / f.sourceH;
    const dx = boxX + f.trimX * sx;
    const dy = boxY + f.trimY * sy;
    const dw = f.w * sx;
    const dh = f.h * sy;

    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha ?? 1) * this._alpha * this._fadeAlpha();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    ctx.restore();
  }
}
