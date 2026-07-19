import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';

/**
 * BossIntroScene — a full-canvas, no-audio video cutscene played BEFORE a boss
 * battle (today: Lord Malakor). The video frames are rendered directly onto the
 * game canvas (an off-DOM <video> element is drawn each frame), NOT via a DOM
 * video player.
 *
 * Music: the boss battle track is started the moment the FIRST video frame is
 * ready to paint (not on entry), so a slow-buffering video can't play music
 * over a black screen — picture and music begin together. It still routes
 * through the AudioManager battle-music lifecycle, so the BattleScene that
 * follows treats the same track as already-playing and does NOT restart it —
 * the music plays continuously through the scene cross-fade into the fight. If
 * the video never renders (autoplay block / error / immediate skip / timeout),
 * the music is started on the finish path so the battle still has its track.
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
    /**
     * Src of the video element currently held in `_video`. Lets `preloadVideo`
     * (called from the map) and `onEnter` reuse a buffered element instead of
     * starting the download from scratch when the cutscene begins.
     * @type {string|null}
     */
    this._preloadedSrc = null;
    /** Bound element listeners, retained so they can be removed on teardown. */
    this._onLoadedMeta = null;
    this._onBuildError = null;
    this._onCanPlay = null;
    this._onEnded = null;
    this._onError = null;
    /** Set true once enough has buffered to start drawing frames. */
    this._videoReady = false;
    /** True once the boss music has been started (deferred to first frame). */
    this._musicStarted = false;
    /** True once the transition to the next scene has been kicked off. */
    this._finished = false;
    /** Set by the various end conditions; consumed in update() to start the fade. */
    this._pendingFinish = false;

    // Safety net: if the video never fires 'ended' (codec/loop issue), bail out.
    this._maxDuration = 20000; // ms
    // Fail-fast: no paintable frame yet after this long (offline PWA — the
    // .mp4 fetch fails) → skip the cutscene instead of holding a black screen
    // for the full _maxDuration.
    this._stallBailout = 4000; // ms

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
    this._musicStarted = false;

    // No bar-fill image — the cutscene paints the video itself over black.
    if (sm._app && sm._app.setBackgroundImage) {
      sm._app.setBackgroundImage(null);
    }

    // NOTE: the boss music is deliberately NOT started here. It starts the moment
    // the first video frame is ready to paint (_startMusic, driven from update())
    // so a slow-buffering video can't play music over a black screen.

    // Play the (muted) video off-DOM; its frames are drawn to canvas. Reuses a
    // video the map already buffered via preloadVideo() when one is available.
    this._startPlayback();

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

  // ── Preload (called from the map ahead of time) ───────

  /**
   * Buffer the cutscene video AHEAD of the cutscene — call from the map while
   * the player roams so the first frame is already decoded by the time the
   * scene is entered, eliminating the black-screen stall. The element is
   * created and `.load()`ed but NOT played (it stays parked on its first frame
   * until onEnter plays it). Idempotent: re-calling with the same src is a
   * no-op; a different src replaces the buffered element.
   * @param {string} videoSrc — video URL (relative to index.html)
   */
  preloadVideo(videoSrc) {
    if (!videoSrc) return;
    if (this._video && this._preloadedSrc === videoSrc) return; // already buffering this one
    if (this._video) this._destroyVideo();                      // swap to a different video
    this._video = this._buildVideoElement(videoSrc);
    this._preloadedSrc = videoSrc;
    // Kick off buffering now (preload='auto' + an explicit load()).
    try { this._video.load(); } catch (e) { /* ignore */ }
  }

  // ── Video setup / teardown ────────────────────────────

  /**
   * Create the off-DOM <video> for `videoSrc` and wire the metadata listener
   * (needed during preload so the cover-fit size is ready before playback).
   * Playback listeners are added later in _startPlayback().
   */
  _buildVideoElement(videoSrc) {
    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;  // smooth inline playback on mobile
    video.preload = 'auto';
    video.loop = false;

    this._onLoadedMeta = () => {
      // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
      // intrinsic video size so the cover-fit math works for the <video>.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    };
    video.addEventListener('loadedmetadata', this._onLoadedMeta);
    // Remember a preload-time failure ON the element (offline PWA: the .mp4
    // errors while the player still roams the map, before the playback
    // listeners exist). Only mark it — never _requestFinish() from here: that
    // would start the boss music mid-map. _startPlayback checks the flag.
    this._onBuildError = () => { video._biFailed = true; };
    video.addEventListener('error', this._onBuildError);
    return video;
  }

  /**
   * Start playback when the scene is entered. Reuses a video the map already
   * buffered via preloadVideo() when its src matches; otherwise builds + buffers
   * a fresh one. Wires the playback listeners (canplay/ended/error) and plays.
   */
  _startPlayback() {
    if (!this._videoSrc) {
      // Nothing to play — go straight to the battle.
      this._requestFinish();
      return;
    }

    // Reuse a preloaded element if it matches; otherwise build fresh.
    if (!this._video || this._preloadedSrc !== this._videoSrc) {
      if (this._video) this._destroyVideo();
      this._video = this._buildVideoElement(this._videoSrc);
      this._preloadedSrc = this._videoSrc;
      try { this._video.load(); } catch (e) { /* ignore */ }
    }

    const video = this._video;

    // A preloaded element that already failed won't re-fire 'error' and its
    // play() promise never settles — skip the cutscene instead of hanging on
    // a black screen (the fail-fast in update() backstops later failures).
    if (video._biFailed || video.error) {
      this._requestFinish();
      return;
    }

    // Metadata may already have arrived during preload — mirror the size now in
    // case the loadedmetadata listener fired before this scene was entered.
    if (video.videoWidth && !video.width) {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    }

    this._onCanPlay = () => { this._videoReady = true; };
    this._onEnded = () => this._requestFinish();
    this._onError = () => this._requestFinish();
    video.addEventListener('canplay', this._onCanPlay);
    video.addEventListener('ended', this._onEnded);
    video.addEventListener('error', this._onError);

    // Always start from the top (a preloaded element was never played, but be safe).
    try { video.currentTime = 0; } catch (e) { /* ignore */ }

    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {
        // Autoplay blocked or load failure — skip the cutscene (music keeps going).
        this._requestFinish();
      });
    }
  }

  _destroyVideo() {
    const video = this._video;
    if (!video) return;
    if (this._onLoadedMeta) video.removeEventListener('loadedmetadata', this._onLoadedMeta);
    if (this._onBuildError) video.removeEventListener('error', this._onBuildError);
    if (this._onCanPlay) video.removeEventListener('canplay', this._onCanPlay);
    if (this._onEnded) video.removeEventListener('ended', this._onEnded);
    if (this._onError) video.removeEventListener('error', this._onError);
    this._onLoadedMeta = this._onBuildError = this._onCanPlay = this._onEnded = this._onError = null;
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
    this._video = null;
    this._preloadedSrc = null;
  }

  // ── Music ─────────────────────────────────────────────

  /**
   * Start the boss music (once). Routed through the battle-music lifecycle so
   * the BattleScene that follows sees it as already-active and does NOT restart
   * it. Called the moment the first video frame is ready (so picture + music
   * start together) and, as a fallback, from _requestFinish so the non-rendering
   * end paths still hand a playing track to the battle.
   */
  _startMusic() {
    if (this._musicStarted) return;
    this._musicStarted = true;
    if (this._musicKey) {
      AudioManager.startBattleMusic(this._musicKey, this._isSpecialTrack);
    }
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
    // If we're bailing out before the video ever rendered (autoplay block,
    // error, immediate skip, safety timeout), make sure the music is going so
    // the battle still has its track. No-op if it already started on first frame.
    this._startMusic();
    this._pendingFinish = true;
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    this._elapsed += dt;

    // Start the music the moment the first frame is ready to paint (same
    // readyState gate renderBackground uses), so picture + music begin together.
    if (!this._musicStarted && this._video && this._video.readyState >= 2) {
      this._startMusic();
    }

    // Fail-fast: the video errored or never produced a paintable frame within
    // the bailout window (offline / unreachable .mp4) — skip to the battle.
    const vid = this._video;
    if (!this._pendingFinish && this._elapsed >= this._stallBailout
        && (!vid || vid._biFailed || vid.error || vid.readyState < 2)) {
      this._requestFinish();
    }

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
