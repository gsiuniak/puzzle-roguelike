import UIPanel from '../ui/UIPanel.js';

/**
 * TitleScreen — dedicated title scene with cover-fit background image
 * and a fade-in transition.
 *
 * On any keyboard key, mouse click, or touch — transitions to CharacterSelectScene
 * via the SceneManager.
 */
export default class TitleScreen extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;

    // UIPanel background — will be drawn in "cover" mode via renderSelf override
    this.backgroundAssetKey = 'title_screen';
    this.smoothing = true;

    // Fade-in state
    this._fadeInDuration = 500; // ms
    this._elapsed = 0;
    this._fadeInDone = false;

    // Input handler bound once
    this._handleAnyInput = this._onAnyInput.bind(this);

    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;
  }

  // ── Lifecycle ─────────────────────────────────────────

  /** Called by SceneManager when this scene becomes active */
  onEnter() {
    this._elapsed = 0;
    this._fadeInDone = false;

    // Register input listeners — any key or click transitions to CharacterSelectScene
    const input = this._sceneManager._input;
    input.on('keydown', this._handleAnyInput);
    input.on('mousedown', this._handleAnyInput);
    // Touch fires mousedown via InputManager, already covered

    // Focus the canvas so keydown works immediately
    input.canvas.focus();
  }

  /** Called by SceneManager when this scene is being left */
  onExit() {
    // Input listeners are cleared by SceneManager.switchTo(),
    // but remove our reference explicitly for safety
    const input = this._sceneManager._input;
    input.off('keydown', this._handleAnyInput);
    input.off('mousedown', this._handleAnyInput);
  }

  // ── Input ─────────────────────────────────────────────

  _onAnyInput() {
    // Prevent double-transition (keydown + click in same frame, etc.)
    if (!this._sceneManager || this._sceneManager._currentScene !== this) return;

    this._sceneManager.switchTo('CharacterSelectScene');
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    this._elapsed += dt;
    if (this._elapsed >= this._fadeInDuration) {
      this._fadeInDone = true;
    }
    super.update(dt);
  }

  // ── Render ────────────────────────────────────────────

  /**
   * Override renderSelf to draw the title image in "cover" mode
   * (scale proportionally to fill, crop excess, center) instead of
   * the default stretch behavior from UIPanel.
   */
  renderSelf(ctx) {
    // ── Cover-fit background image ──
    if (this.backgroundAssetKey && this._sceneManager) {
      const am = this._sceneManager.assetManager;
      const img = am ? am.get(this.backgroundAssetKey) : null;
      if (img) {
        this._applySmoothing(ctx);

        const r = this.rect;
        const imgW = img.width;
        const imgH = img.height;

        if (imgW > 0 && imgH > 0 && r.w > 0 && r.h > 0) {
          // Cover: scale = max(containerW/imgW, containerH/imgH)
          const scaleX = r.w / imgW;
          const scaleY = r.h / imgH;
          const scale = Math.max(scaleX, scaleY);

          const drawW = imgW * scale;
          const drawH = imgH * scale;
          const drawX = r.x + (r.w - drawW) / 2;
          const drawY = r.y + (r.h - drawH) / 2;

          ctx.save();

          // Clip to the panel rect (crops overflow from cover scaling)
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();

          // Fade-in alpha
          const alpha = this._fadeInDone
            ? 1.0
            : Math.min(1.0, this._elapsed / this._fadeInDuration);
          ctx.globalAlpha = alpha;

          ctx.drawImage(img, drawX, drawY, drawW, drawH);

          ctx.restore();
        }

        this._restoreSmoothing(ctx);
      }
    }

  }
}
