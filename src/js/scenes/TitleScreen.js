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

    this._sceneManager.fadeToScene('CharacterSelectScene', 500);
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
   * Paint the title image across the entire physical canvas (cover-fit),
   * with the fade-in alpha. Called by SceneManager before the design-space
   * viewport clip is applied, so the image fills the letterbox/pillarbox bars.
   */
  renderBackground(ctx) {
    if (!this.backgroundAssetKey || !this._sceneManager) return;
    const am = this._sceneManager.assetManager;
    const img = am ? am.get(this.backgroundAssetKey) : null;
    if (!img) return;

    const alpha = this._fadeInDone
      ? 1.0
      : Math.min(1.0, this._elapsed / this._fadeInDuration);

    this._sceneManager._app.drawFullCanvasImage(img, alpha);
  }

  /** No in-viewport rendering — the title image is drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}
}
