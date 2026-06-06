import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';

/**
 * BossIntroScene — a full-canvas, no-audio video cutscene played BEFORE a boss
 * battle (today: Lord Malakor). The video frames are rendered directly onto the
 * game canvas (an off-DOM <video> element is drawn each frame), NOT via a DOM
 * video player.
 *
 * Music: the boss battle track is started as the video starts (via the
 * AudioManager battle-music lifecycle). Because it is routed through
 * `startBattleMusic`, the BattleScene that follows treats the same track as
 * already-playing and does NOT restart it — so the music plays continuously
 * through the scene cross-fade into the fight.
 *
 * When the video ends (~15s), or on error / autoplay-block / skip / safety
 * timeout, the scene cross-fades (SceneManager fade) to the configured battle
 * scene. Any input skips the cutscene after a short grace period.
 *
 * Reusable for future bosses: call `configure({...})` before entering.
 * Modeled on TitleScreen / GameOverScene (full-canvas paint in renderBackground,
 * no in-viewport UI).
 */
export default class BossIntroScene extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;
    this.backgroundAssetKey = null;
    this.smoothing = true;

    // Visual fade-in over the first moments of the cutscene.
    this._fadeInDuration = 500; // ms
    this._elapsed = 0;

    // ── Config (set via configure() before the scene is entered) ──
    /** @type {string|null} video URL (relative to index.html) */
    this._videoSrc = null;
    /** @type {string|null} SoundConfig music key to start as the video plays */
    this._musicKey = null;
    /** @type {boolean} whether the music track is a special (non-persistent) track */
    this._isSpecialTrack = true;
    /** @type {string} scene to transition to when the cutscene ends */
    this._nextScene = 'BattleScene';

    // ── Video element + playback state ──
    /** @type {HTMLVideoElement|null} */
    this._video = null;
    /** Set true once enough has buffered to start drawing frames. */
    this._videoReady = false;
    /** True once the transition to the next scene has been kicked off. */
    this._finished = false;
    /** Set by the various end conditions; consumed in update() to start the fade. */
    this._pendingFinish = false;

    // Safety net: if the video never fires 'ended' (codec/loop issue), bail out.
    this._maxDuration = 20000; // ms

    // Short grace so the click/key that started the cutscene can't instantly skip it.
    this._skipGrace = 400; // ms

    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = null;
    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;

    this._handleSkip = this._onSkip.bind(this);
  }

  // ── Configuration ─────────────────────────────────────

  /**
   * Configure the cutscene. Call before the scene is entered.
   * @param {object} cfg
   * @param {string}  cfg.videoSrc        — video URL (relative to index.html)
   * @param {string}  cfg.musicKey        — SoundConfig key for the boss track
   * @param {boolean} [cfg.isSpecialTrack=true] — true if the track is non-persistent
   * @param {string}  [cfg.nextScene='BattleScene'] — scene to enter after the video
   */
  configure({ videoSrc, musicKey, isSpecialTrack = true, nextScene = 'BattleScene' } = {}) {
    this._videoSrc = videoSrc || null;
    this._musicKey = musicKey || null;
    this._isSpecialTrack = isSpecialTrack;
    this._nextScene = nextScene || 'BattleScene';
  }

  // ── Lifecycle ─────────────────────────────────────────

  onEnter() {
    const sm = this._sceneManager;
    if (!sm) return;
    this._assetManager = sm.assetManager;

    this._elapsed = 0;
    this._finished = false;
    this._pendingFinish = false;
    this._videoReady = false;

    // No bar-fill image — the cutscene paints the video itself over black.
    if (sm._app && sm._app.setBackgroundImage) {
      sm._app.setBackgroundImage(null);
    }

    // Start the boss music as the video starts. Routed through the battle-music
    // lifecycle so the BattleScene that follows sees it as already-active and
    // does NOT restart it — the track plays continuously into the fight.
    if (this._musicKey) {
      AudioManager.startBattleMusic(this._musicKey, this._isSpecialTrack);
    }

    // Create + play the (muted) video off-DOM; its frames are drawn to canvas.
    this._createVideo();

    // Skip on any input (after a short grace period).
    const input = sm._input;
    input.on('keydown', this._handleSkip);
    input.on('mousedown', this._handleSkip);
    input.canvas.focus();
  }

  onExit() {
    const sm = this._sceneManager;
    if (sm) {
      const input = sm._input;
      input.off('keydown', this._handleSkip);
      input.off('mousedown', this._handleSkip);
    }

    // Tear down the video element. Do NOT touch the music — it continues into
    // the battle scene.
    this._destroyVideo();
  }

  // ── Video setup / teardown ────────────────────────────

  _createVideo() {
    if (!this._videoSrc) {
      // Nothing to play — go straight to the battle.
      this._requestFinish();
      return;
    }

    const video = document.createElement('video');
    video.src = this._videoSrc;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;  // smooth inline playback on mobile
    video.preload = 'auto';
    video.loop = false;

    video.addEventListener('loadedmetadata', () => {
      // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
      // intrinsic video size so the cover-fit math works for the <video>.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    });
    video.addEventListener('canplay', () => { this._videoReady = true; });
    video.addEventListener('ended', () => this._requestFinish());
    video.addEventListener('error', () => this._requestFinish());

    this._video = video;

    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {
        // Autoplay blocked or load failure — skip the cutscene (music keeps going).
        this._requestFinish();
      });
    }
  }

  _destroyVideo() {
    if (!this._video) return;
    try { this._video.pause(); } catch (e) { /* ignore */ }
    this._video.removeAttribute('src');
    try { this._video.load(); } catch (e) { /* ignore */ }
    this._video = null;
  }

  // ── Input / finish ────────────────────────────────────

  _onSkip() {
    if (this._elapsed < this._skipGrace) return;
    this._requestFinish();
  }

  /**
   * Mark that the cutscene should end. The actual transition is started in
   * update() once we're active and no SceneManager transition is in flight
   * (fadeToScene is a no-op mid-transition, so we must defer to avoid getting
   * stuck if an end condition fires during the entry fade-in).
   */
  _requestFinish() {
    this._pendingFinish = true;
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    this._elapsed += dt;

    // Safety bail-out if the video never reports 'ended'.
    if (!this._pendingFinish && this._elapsed >= this._maxDuration) {
      this._requestFinish();
    }

    const sm = this._sceneManager;
    if (this._pendingFinish && !this._finished && sm
        && sm._currentScene === this && !sm.isTransitioning()) {
      this._finished = true;
      sm.fadeToScene(this._nextScene, 400);
    }

    super.update(dt);
  }

  // ── Render ────────────────────────────────────────────

  /**
   * Paint the current video frame across the entire physical canvas (cover-fit)
   * with the fade-in alpha. Runs before the design-space viewport clip so it
   * fills the letterbox/pillarbox bars. Black shows until the first frame is
   * decodable (readyState >= HAVE_CURRENT_DATA).
   */
  renderBackground(_ctx) {
    const sm = this._sceneManager;
    if (!sm) return;
    const video = this._video;
    if (!video || video.readyState < 2) return; // 2 = HAVE_CURRENT_DATA

    const alpha = Math.min(1.0, this._elapsed / this._fadeInDuration);
    sm._app.drawFullCanvasImage(video, alpha);
  }

  /** No in-viewport rendering — the video is drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}
}
