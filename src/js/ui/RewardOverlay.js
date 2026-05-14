/**
 * RewardOverlay — post-battle reward screen overlay.
 *
 * Appears after battle completion before returning to the map.
 * Inspired by Slay the Spire's post-battle reward screen.
 *
 * Visual layering:
 *   1. Battle scene remains visible underneath (non-interactive)
 *   2. Semi-transparent black fullscreen backdrop
 *   3. Centered reward panel (reward_screen_temp_panel)
 *
 * Lifecycle:
 *   show()     — activate the overlay (called by BattleScene on GAME_OVER)
 *   dismiss()  — deactivate and fire onDismiss callback
 *   update(dt) — advance animations (placeholder for future cross-fade transition)
 *   render(ctx, w, h) — draw backdrop + reward panel
 *   isActive() — true while the overlay is visible
 *   reset()    — force-reset to inactive (cleanup on scene exit)
 *
 * Input behavior:
 *   - Blocks all gameplay input while active
 *   - ESC key advances to next state (triggers dismiss → MapScene transition)
 *
 * Architecture:
 *   This is designed to be a reusable overlay structure. Future reward types
 *   (level-up choices, loot selection, event dialogs) can extend or compose
 *   this pattern. The overlay owns its own rendering and input handling,
 *   and notifies the parent scene via onDismiss when the player is done.
 *
 *   Currently a minimal implementation — no reward selection logic.
 *   Will potentially handle some sort of rewards later.
 */

// ── Layout constants ──────────────────────────────────────
/** Backdrop alpha for the dark overlay covering the entire canvas */
const BACKDROP_ALPHA = 0.72;
/** Maximum fraction of canvas width the reward panel occupies */
const PANEL_MAX_WIDTH_FRAC = 0.55;
/** Maximum fraction of canvas height the reward panel occupies */
const PANEL_MAX_HEIGHT_FRAC = 0.70;

// ── Overlay state enum ────────────────────────────────────
/** @readonly @enum {string} */
const OverlayState = Object.freeze({
  INACTIVE: 'inactive',
  ACTIVE: 'active',
});

export default class RewardOverlay {
  /**
   * @param {object} deps
   * @param {import('../engine/AssetManager.js').default} deps.assetManager
   * @param {Function} [deps.onDismiss] — callback invoked when overlay is dismissed
   */
  constructor({ assetManager, onDismiss } = {}) {
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = assetManager || null;

    /**
     * Callback invoked when the overlay is dismissed (ESC pressed).
     * The parent scene (BattleScene) wires this to transition back to MapScene.
     * @type {Function|null}
     */
    this.onDismiss = onDismiss || null;

    /** @type {string} one of OverlayState values */
    this._state = OverlayState.INACTIVE;

    /**
     * Elapsed time since activation (ms).
     * Reserved for future cross-fade / transition animation.
     * @type {number}
     */
    this._timer = 0;

    /** @type {boolean} whether dismiss has already been triggered */
    this._dismissTriggered = false;
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  /** Activate the overlay. No-op if already active. */
  show() {
    if (this._state === OverlayState.ACTIVE) return;
    this._state = OverlayState.ACTIVE;
    this._timer = 0;
    this._dismissTriggered = false;
  }

  /**
   * Dismiss the overlay and fire the onDismiss callback.
   * No-op if already dismissed or not active.
   */
  dismiss() {
    if (this._state !== OverlayState.ACTIVE || this._dismissTriggered) return;
    this._dismissTriggered = true;
    this._state = OverlayState.INACTIVE;
    this._timer = 0;

    if (typeof this.onDismiss === 'function') {
      this.onDismiss();
    }
  }

  /** @returns {boolean} true if the overlay is currently visible */
  isActive() {
    return this._state === OverlayState.ACTIVE;
  }

  /**
   * Force-reset the overlay to INACTIVE without firing the callback.
   * Use when the owning scene is exiting to ensure clean state.
   */
  reset() {
    this._state = OverlayState.INACTIVE;
    this._timer = 0;
    this._dismissTriggered = false;
  }

  // ═══════════════════════════════════════════════════════════
  // Per-frame update
  // ═══════════════════════════════════════════════════════════

  /**
   * Advance overlay animation timer.
   * Currently a no-op; reserved for future cross-fade / slide-in transition.
   * Call once per frame from the owning scene's update().
   *
   * @param {number} dt — delta time in ms
   */
  update(dt) {
    if (this._state !== OverlayState.ACTIVE) return;
    this._timer += dt;
    // TODO: Future transition animations will interpolate based on _timer.
    // For now there is no transition/cross-fade — the overlay appears instantly.
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  /**
   * Render the reward overlay on top of the battle scene.
   * Draws in this order:
   *   1. Semi-transparent black fullscreen backdrop
   *   2. Centered reward panel image
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW — full canvas width
   * @param {number} canvasH — full canvas height
   */
  render(ctx, canvasW, canvasH) {
    if (this._state !== OverlayState.ACTIVE) return;

    // TODO: When transition animation is added, interpolate alpha based on _timer.

    // 1. Semi-transparent black fullscreen backdrop
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKDROP_ALPHA})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // 2. Centered reward panel
    this._renderPanel(ctx, canvasW, canvasH);
  }

  // ═══════════════════════════════════════════════════════════
  // Private: panel rendering
  // ═══════════════════════════════════════════════════════════

  /**
   * Draw the reward_screen_temp_panel centered on screen.
   * Scales to fit within PANEL_MAX_WIDTH_FRAC × PANEL_MAX_HEIGHT_FRAC
   * of the canvas, maintaining the image's natural aspect ratio.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   */
  _renderPanel(ctx, canvasW, canvasH) {
    if (!this._assetManager) return;

    const img = this._assetManager.get('reward_screen_temp_panel');
    if (!img || !img.complete || !img.width || !img.height) return;

    // Compute target size: fit within fraction of canvas, maintain aspect ratio
    const maxW = canvasW * PANEL_MAX_WIDTH_FRAC;
    const maxH = canvasH * PANEL_MAX_HEIGHT_FRAC;
    const imgAspect = img.width / img.height;

    let panelW, panelH;
    if (maxW / maxH > imgAspect) {
      // Height-constrained
      panelH = maxH;
      panelW = panelH * imgAspect;
    } else {
      // Width-constrained
      panelW = maxW;
      panelH = panelW / imgAspect;
    }

    // Center on screen
    const px = Math.floor((canvasW - panelW) / 2);
    const py = Math.floor((canvasH - panelH) / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, px, py, Math.ceil(panelW), Math.ceil(panelH));
    ctx.restore();
  }
}
