/**
 * HintCursorEffect — the animated gauntlet pointer for the upgraded hint
 * system (the `ui_hint_cursor` art: an armored hand whose INDEX FINGERTIP
 * is the pointing hotspot, top-left of the sprite).
 *
 * Owned and lifecycled by BattleScene (created on a hint request, dropped
 * when the hint highlight clears) — it has NO `done` flag of its own. The
 * scene feeds it fresh waypoints every frame via setWaypoints() (rects move:
 * the skills list scrolls, layout reflows) and a fade alpha via render(ctx,
 * alpha), so the cursor always tracks live UI positions and fades with the
 * rest of the hint.
 *
 * Behavior: the cursor DWELLS at each waypoint doing a gentle "tap" press
 * (a periodic scale dip about the fingertip), GLIDES to the next with an
 * ease-in-out, and after the last waypoint fades out and restarts at the
 * first — so a swap hint reads as "drag this tile to that one" and a
 * targeted-cast hint as "tap this card, then this tile", looping.
 *
 * Drawing is one drawImage + transforms — no shadowBlur, mobile-safe.
 */

const CURSOR_ASSET_KEY = 'ui_hint_cursor';
/** Fingertip position as a fraction of the art (the pointing hotspot). */
const TIP_FRAC = { x: 0.17, y: 0.05 };
const CURSOR_HEIGHT = 96;   // display height (design px)
const MOVE_MS = 520;        // glide between waypoints
const DWELL_MS = 720;       // pause (tapping) at each waypoint
const RESET_FADE_MS = 170;  // fade-out / fade-in when looping back to start
const TAP_HZ = 1.5;         // taps per second while dwelling
const TAP_DIP = 0.12;       // press scale dip (about the fingertip)
const BOB_AMP = 4;          // idle bob (design px) while gliding
const BOB_HZ = 0.9;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default class HintCursorEffect {
  /** @param {import('../engine/AssetManager.js').default} assetManager */
  constructor(assetManager) {
    this._am = assetManager;
    this.waypoints = [];
    this._leg = 0;         // index of the waypoint we're at / leaving
    this._phase = 'dwell'; // 'dwell' | 'move' | 'fade'
    this._t = 0;           // ms into the current phase
    this._time = 0;        // total ms (drives the tap/bob oscillators)
  }

  /**
   * Replace the waypoint positions ({x, y} design-space points the fingertip
   * visits, in order). Positions may move every frame without resetting the
   * animation; only a COUNT change restarts the cycle.
   * @param {Array<{x:number, y:number}>} points
   */
  setWaypoints(points) {
    const next = points || [];
    if (next.length !== this.waypoints.length) {
      this._leg = 0;
      this._phase = 'dwell';
      this._t = 0;
    }
    this.waypoints = next;
    if (this._leg >= next.length) this._leg = 0;
  }

  update(dt) {
    this._time += dt;
    if (this.waypoints.length === 0) return;
    this._t += dt;
    if (this._phase === 'dwell') {
      if (this._t < DWELL_MS) return;
      this._t = 0;
      if (this._leg < this.waypoints.length - 1) this._phase = 'move';
      else if (this.waypoints.length > 1) this._phase = 'fade';
      // single waypoint: keep dwelling (tap loop) forever
    } else if (this._phase === 'move') {
      if (this._t < MOVE_MS) return;
      this._t = 0;
      this._leg += 1;
      this._phase = 'dwell';
    } else if (this._phase === 'fade') {
      if (this._t < RESET_FADE_MS * 2) return;
      this._t = 0;
      this._leg = 0;
      this._phase = 'dwell';
    }
  }

  /** Current fingertip position (interpolated during a glide). */
  _pos() {
    const wp = this.waypoints;
    const a = wp[Math.min(this._leg, wp.length - 1)];
    if (this._phase === 'move' && this._leg + 1 < wp.length) {
      const b = wp[this._leg + 1];
      const k = easeInOut(Math.min(1, this._t / MOVE_MS));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    if (this._phase === 'fade') {
      // first half: still at the last waypoint; second half: back at the start
      return this._t < RESET_FADE_MS ? a : wp[0];
    }
    return a;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} alpha — external fade (the hint highlight's fade tail)
   */
  render(ctx, alpha = 1) {
    if (this.waypoints.length === 0 || alpha <= 0) return;
    const img = this._am && this._am.get(CURSOR_ASSET_KEY);
    if (!img || img.complete === false) return;

    let a = alpha;
    if (this._phase === 'fade') {
      const k = this._t < RESET_FADE_MS
        ? 1 - this._t / RESET_FADE_MS
        : (this._t - RESET_FADE_MS) / RESET_FADE_MS;
      a *= Math.max(0, Math.min(1, k));
    }
    if (a <= 0) return;

    const pos = this._pos();
    // Tap press while dwelling; gentle bob while gliding.
    let scale = 1;
    let bob = 0;
    if (this._phase === 'dwell') {
      const press = Math.max(0, Math.sin((this._time / 1000) * Math.PI * 2 * TAP_HZ));
      scale = 1 - TAP_DIP * press;
    } else {
      bob = Math.sin((this._time / 1000) * Math.PI * 2 * BOB_HZ) * BOB_AMP;
    }

    const aspect = img.width && img.height ? img.width / img.height : 1;
    const h = CURSOR_HEIGHT * scale;
    const w = h * aspect;
    const x = pos.x - w * TIP_FRAC.x;
    const y = pos.y + bob - h * TIP_FRAC.y;

    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.globalAlpha = prevAlpha * a;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, x, y, w, h);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.globalAlpha = prevAlpha;
  }
}
