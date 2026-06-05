import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';

/**
 * GameOverScene — shown when the player is defeated in battle.
 *
 * The entire physical canvas is covered (cover-fit) by
 * `battle_background_game_over.png`, with a short fade-in. Any keyboard key,
 * mouse click, or touch returns to the CharacterSelectScene to start a new run.
 *
 * Modeled on TitleScreen: full-canvas background drawn in renderBackground so
 * it fills the letterbox/pillarbox bars, no in-viewport UI.
 */
export default class GameOverScene extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;

    this.backgroundAssetKey = 'battle_background_game_over';
    this.smoothing = true;

    // Fade-in state
    this._fadeInDuration = 600; // ms
    this._elapsed = 0;
    this._fadeInDone = false;

    // Short input grace period so the click/key that ended the battle (or a
    // held button) doesn't instantly skip the scene.
    this._inputDelay = 350; // ms

    this._handleAnyInput = this._onAnyInput.bind(this);

    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;
  }

  // ── Lifecycle ─────────────────────────────────────────

  onEnter() {
    this._elapsed = 0;
    this._fadeInDone = false;

    // Clear any battle full-canvas background hook so the game-over image is
    // the one drawn across the bars (defensive — BattleScene clears it too).
    if (this._sceneManager && this._sceneManager._app
        && this._sceneManager._app.setBackgroundImage) {
      this._sceneManager._app.setBackgroundImage(null);
    }

    // Cross-fade from whatever was playing (the just-ended battle track) to
    // the game-over theme. playMusic fades the outgoing track out while this
    // one fades in.
    AudioManager.playMusic('game_over_theme', { fadeIn: 800 });

    const input = this._sceneManager._input;
    input.on('keydown', this._handleAnyInput);
    input.on('mousedown', this._handleAnyInput);
    // Touch fires mousedown via InputManager, already covered

    input.canvas.focus();
  }

  onExit() {
    const input = this._sceneManager._input;
    input.off('keydown', this._handleAnyInput);
    input.off('mousedown', this._handleAnyInput);
  }

  // ── Input ─────────────────────────────────────────────

  _onAnyInput() {
    if (!this._sceneManager || this._sceneManager._currentScene !== this) return;
    // Ignore input during the grace period.
    if (this._elapsed < this._inputDelay) return;

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
   * Paint the game-over image across the entire physical canvas (cover-fit)
   * with the fade-in alpha. Runs before the design-space viewport clip so it
   * fills the letterbox/pillarbox bars.
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

  /** No in-viewport rendering — the image is drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}
}
