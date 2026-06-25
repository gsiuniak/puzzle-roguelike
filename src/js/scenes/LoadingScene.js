import UIPanel from '../ui/UIPanel.js';

/**
 * LoadingScene — minimal dark-fantasy preload screen shown BEFORE the title
 * screen while game assets load.
 *
 * It is a real scene/state (not baked into TitleScreen): the game loop boots
 * straight into it (see main.js), the AssetManager loads in the background, and
 * this scene polls `assetManager.progress` each frame to drive a thin gold
 * glowing progress bar beneath centered "LOADING" text. When loading completes
 * (and a small minimum-display floor has elapsed so the screen never just
 * flashes), it fades to the TitleScreen.
 *
 * The whole screen is drawn with canvas primitives only — no asset is required
 * to render it, so it appears immediately on the first frame.
 *
 * All visual tunables live in the constants block below.
 */

// ── Layout (design-space 1920×1080 coordinates) ─────────────
const LOADING_TEXT_Y   = 496;   // baseline-ish center Y of the "LOADING" label
const BAR_Y            = 556;   // vertical center of the progress bar
const BAR_WIDTH        = 640;   // total bar width
const BAR_HEIGHT       = 14;    // bar (frame) height

const TEXT_FONT_SIZE   = 30;
const TEXT_LETTER_SPACING = 10; // px between letters of "LOADING"
const TEXT_LABEL       = 'LOADING';

// ── Colors / glow ───────────────────────────────────────────
const BG_COLOR         = '#0a0a0c';                 // near-black fantasy base
const FRAME_COLOR      = 'rgba(180, 160, 110, 0.55)'; // ornate frame stroke
const TEXT_COLOR       = '#cdb87f';                 // muted gold text
const GOLD_FILL_CORE   = '#ffe9a8';                 // bright gold fill center
const GOLD_FILL_EDGE   = '#c79a3a';                 // deeper gold fill edge
const GOLD_GLOW_COLOR  = 'rgba(255, 213, 120, 0.9)';
const GOLD_GLOW_BLUR   = 18;                        // shadowBlur for the fill glow
const SHIMMER_COLOR    = 'rgba(255, 248, 220, 0.85)';

// ── Behavior ────────────────────────────────────────────────
const FADE_DURATION    = 600;   // ms fade into TitleScreen
const FADE_IN_DURATION = 350;   // ms this scene fades up on first appearance
const MIN_DISPLAY_MS   = 350;   // floor so the screen doesn't just flash (loading runs in parallel, so this doesn't delay loading itself)
const PROGRESS_LERP    = 0.12;  // how fast the displayed bar eases toward real progress
const SHIMMER_SPEED     = 0.0012; // shimmer sweep cycles per ms
const INDETERMINATE_SPEED = 0.0009; // looping sweep speed when no real progress is known

export default class LoadingScene extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;
    this.backgroundAssetKey = null;

    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = null;

    this._elapsed = 0;          // total time in scene (ms)
    this._displayProgress = 0;  // eased progress shown by the bar (0–1)
    this._shimmerPhase = 0;     // animation phase for shimmer / indeterminate sweep
    this._transitioning = false;

    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;
  }

  /** AssetManager whose `progress` this scene polls. Set by main.js. */
  setAssetManager(am) { this._assetManager = am; }

  // ── Lifecycle ─────────────────────────────────────────
  onEnter() {
    this._elapsed = 0;
    this._displayProgress = 0;
    this._shimmerPhase = 0;
    this._transitioning = false;
    if (this._sceneManager && this._assetManager == null) {
      this._assetManager = this._sceneManager.assetManager;
    }
  }

  onExit() {}

  // ── Update ────────────────────────────────────────────
  update(dt) {
    this._elapsed += dt;
    this._shimmerPhase += dt;

    // Ease the displayed bar toward the real load progress so it animates
    // smoothly instead of snapping between discrete asset-load steps.
    const target = this._assetManager ? this._assetManager.progress : 1;
    this._displayProgress += (target - this._displayProgress) * PROGRESS_LERP;

    // Transition once assets are loaded AND the minimum display time elapsed.
    const loaded = !this._assetManager || this._assetManager.progress >= 1;
    if (loaded && this._elapsed >= MIN_DISPLAY_MS && !this._transitioning) {
      if (this._sceneManager && !this._sceneManager.isTransitioning()) {
        this._transitioning = true;
        this._sceneManager.fadeToScene('TitleScreen', FADE_DURATION);
      }
    }

    super.update(dt);
  }

  // ── Render ────────────────────────────────────────────

  /**
   * Paint the dark base AND the radial vignette across the entire physical
   * canvas (covers the letterbox/pillarbox bars). The vignette must live here
   * rather than in renderSelf — renderSelf is clipped to the 1920×1080 design
   * viewport, so on wider screens its vignette stopped at the viewport edge and
   * left the pillarbox bars an un-vignetted flat fill (a visible seam).
   */
  renderBackground(ctx) {
    if (!this._sceneManager) return;
    const app = this._sceneManager._app;
    app.fillFullCanvas(BG_COLOR);
    this._drawVignetteFullCanvas(app);
  }

  /** UIPanel hook — drawn in design space (inside the viewport clip). */
  renderSelf(ctx) {
    const alpha = Math.min(1, this._elapsed / FADE_IN_DURATION);
    ctx.save();
    ctx.globalAlpha = alpha;

    const cx = this.rect.w / 2;
    this._drawText(ctx, cx);
    this._drawBar(ctx, cx);

    ctx.restore();
  }

  // ── Drawing helpers ───────────────────────────────────

  /**
   * Draw the radial vignette across the FULL physical canvas (CSS pixels),
   * bypassing the design-space transform — same approach as
   * CanvasApp.fillFullCanvas — so it covers the pillarbox/letterbox bars
   * seamlessly. Centered on the canvas; radius scales with canvas height.
   * @param {import('../engine/CanvasApp.js').default} app
   */
  _drawVignetteFullCanvas(app) {
    const ctx = app.ctx;
    const w = app.cssWidth;
    const h = app.cssHeight;
    ctx.save();
    ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, h * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _drawText(ctx, cx) {
    ctx.save();
    ctx.font = `${TEXT_FONT_SIZE}px "Marcellus SC", Georgia, serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT_COLOR;

    // Manual letter spacing for the engraved-caps look in the mock.
    const letters = TEXT_LABEL.split('');
    const widths = letters.map(ch => ctx.measureText(ch).width);
    let total = 0;
    for (let i = 0; i < letters.length; i++) {
      total += widths[i];
      if (i < letters.length - 1) total += TEXT_LETTER_SPACING;
    }
    let x = cx - total / 2;
    ctx.textAlign = 'left';
    for (let i = 0; i < letters.length; i++) {
      ctx.fillText(letters[i], x, LOADING_TEXT_Y);
      x += widths[i] + TEXT_LETTER_SPACING;
    }
    ctx.restore();
  }

  _drawBar(ctx, cx) {
    const left = cx - BAR_WIDTH / 2;
    const top  = BAR_Y - BAR_HEIGHT / 2;

    // ── Ornate frame ──────────────────────────────────
    ctx.save();
    ctx.strokeStyle = FRAME_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, BAR_WIDTH, BAR_HEIGHT);

    // End flourishes (small arrow/diamond caps, drawn with primitives).
    this._drawEndCap(ctx, left, BAR_Y, -1);
    this._drawEndCap(ctx, left + BAR_WIDTH, BAR_Y, 1);
    ctx.restore();

    // ── Fill ──────────────────────────────────────────
    const inset = 3;
    const innerLeft   = left + inset;
    const innerTop    = top + inset;
    const innerWidth  = BAR_WIDTH - inset * 2;
    const innerHeight = BAR_HEIGHT - inset * 2;

    const determinate = !!this._assetManager && this._assetManager.count > 0;
    const fillFrac = determinate
      ? Math.max(0, Math.min(1, this._displayProgress))
      : 1; // indeterminate → full-width track with a looping shimmer sweep
    const fillWidth = innerWidth * fillFrac;

    if (fillWidth > 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(innerLeft, innerTop, fillWidth, innerHeight);
      ctx.clip();

      // Gold gradient + glow.
      const grad = ctx.createLinearGradient(0, innerTop, 0, innerTop + innerHeight);
      grad.addColorStop(0, GOLD_FILL_EDGE);
      grad.addColorStop(0.5, GOLD_FILL_CORE);
      grad.addColorStop(1, GOLD_FILL_EDGE);
      ctx.shadowColor = GOLD_GLOW_COLOR;
      ctx.shadowBlur = GOLD_GLOW_BLUR;
      ctx.fillStyle = grad;
      ctx.fillRect(innerLeft, innerTop, fillWidth, innerHeight);

      // Moving shimmer highlight sweeping along the filled portion.
      ctx.shadowBlur = 0;
      const sweepSpeed = determinate ? SHIMMER_SPEED : INDETERMINATE_SPEED;
      const sweep = (this._shimmerPhase * sweepSpeed) % 1;
      const sx = innerLeft + sweep * fillWidth;
      const sw = Math.max(40, innerWidth * 0.18);
      const sg = ctx.createLinearGradient(sx - sw / 2, 0, sx + sw / 2, 0);
      sg.addColorStop(0, 'rgba(255,248,220,0)');
      sg.addColorStop(0.5, SHIMMER_COLOR);
      sg.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - sw / 2, innerTop, sw, innerHeight);

      ctx.restore();
    }
  }

  /**
   * Small triangular end-cap flourish at a bar end.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x   — bar end x
   * @param {number} y   — bar center y
   * @param {number} dir — +1 points right (right end), -1 points left (left end)
   */
  _drawEndCap(ctx, x, y, dir) {
    const size = BAR_HEIGHT * 0.9;
    ctx.save();
    ctx.fillStyle = FRAME_COLOR;
    ctx.beginPath();
    ctx.moveTo(x + dir * size, y);
    ctx.lineTo(x, y - size * 0.7);
    ctx.lineTo(x, y + size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
