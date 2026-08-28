import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';
import { TITLE_SCREEN_VIDEOS } from '../data/videoManifest.js';

/**
 * TitleScreen — video-driven title scene.
 *
 * Phases:
 *   'intro'      — the title intro movie plays full-canvas; over its last
 *                  INTRO_CROSSFADE_MS the static title image cross-fades in on
 *                  top, so the movie settles into the classic title screen.
 *   'idle'       — the static title image (the pre-movie behavior).
 *   'transition' — on any input, the transition movie + its SFX start
 *                  together; when the movie is within
 *                  TRANSITION_HANDOFF_LEAD_MS (~1 frame) of its end, the
 *                  <video> is HANDED OFF to CharacterSelectScene
 *                  (setEntryVideoOverlay + an instant switchTo — no black
 *                  fade), which dissolves the movie's held LAST frame over its
 *                  UI (TRANSITION_CROSSFADE_MS) while the hero splash video
 *                  already plays beneath.
 *
 * Videos are off-DOM muted <video> elements drawn to the canvas each frame
 * (same approach as BossIntroScene — NOT AssetManager entries). Both movies
 * are buffered ahead of time via preloadVideos() (called from main.js at boot)
 * so the intro starts instantly and a click plays the transition with no
 * stall. Every video path fails fast (decision #53): a load error is
 * remembered on the element (`_tsFailed`), and a video that never becomes
 * paintable within VIDEO_STALL_BAILOUT_MS falls back — the intro to the
 * static image, the transition to the classic fadeToScene.
 */

// Static title image fades in over the intro movie's last stretch.
const INTRO_CROSSFADE_MS = 800;
// The handoff fires this close to the transition movie's end (~1 frame at
// 30fps): the movie is effectively over, so only its LAST frame carries into
// the cross-fade — fading a still-moving picture reads as mush.
const TRANSITION_HANDOFF_LEAD_MS = 40;
// The held last frame then dissolves over the character-select UI (whose
// splash video is already playing beneath it).
const TRANSITION_CROSSFADE_MS = 350;
// SoundConfig key played simultaneously with the transition movie.
const TRANSITION_SFX_KEY = 'sfx_title_transition';
// Fail-fast: no paintable frame within this window → fall back (decision #53).
const VIDEO_STALL_BAILOUT_MS = 4000;
// Safety net if the transition movie never reports 'ended'.
const TRANSITION_MAX_DURATION_MS = 15000;
// Classic fade used by every fallback path (the pre-movie behavior).
const FALLBACK_FADE_MS = 500;

export default class TitleScreen extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;

    // Static title image (the intro cross-fades into it; also every fallback).
    this.backgroundAssetKey = 'title_screen';
    this.smoothing = true;

    // Fade-in state
    this._fadeInDuration = 500; // ms
    this._elapsed = 0;

    /** @type {'intro'|'idle'|'transition'} */
    this._phase = 'idle';

    // ── Video elements + retained listeners ──
    /** @type {HTMLVideoElement|null} */
    this._introVideo = null;
    /** @type {HTMLVideoElement|null} */
    this._transitionVideo = null;
    /** Bound listeners per element, retained for removal: video → [[ev, fn]] */
    this._videoListeners = new Map();

    // ── Transition state ──
    this._transitionElapsed = 0;
    /** Set when the handoff/fallback should run; consumed in update() once no
     *  SceneManager transition is in flight (fadeToScene/switchTo are no-ops
     *  mid-transition, so end conditions must defer — same as BossIntroScene). */
    this._pendingHandoff = false;
    this._pendingFallback = false;
    /** True once the scene exit (handoff or fallback fade) has been kicked off. */
    this._finished = false;

    // Input handler bound once
    this._handleAnyInput = this._onAnyInput.bind(this);

    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;
  }

  // ── Preload (called from main.js at boot) ─────────────

  /**
   * Buffer both title movies ahead of time so the intro starts frame-perfect
   * when the LoadingScene fades in to the title, and a click plays the
   * transition instantly. Idempotent — safe to re-call from onEnter.
   */
  preloadVideos() {
    if (!this._introVideo) {
      this._introVideo = this._buildVideoElement(TITLE_SCREEN_VIDEOS.intro);
      try { this._introVideo.load(); } catch (e) { /* ignore */ }
    }
    if (!this._transitionVideo) {
      this._transitionVideo = this._buildVideoElement(TITLE_SCREEN_VIDEOS.transition);
      try { this._transitionVideo.load(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Loading-gate readiness of the boot-preloaded title movies. A failed or
   * errored element counts as READY — the gate must never wait on a video
   * that will never arrive (this scene falls back to the static title).
   * @returns {{ready:number, total:number}}
   */
  getPreloadVideoStatus() {
    const vids = [this._introVideo, this._transitionVideo].filter(Boolean);
    let ready = 0;
    for (const v of vids) {
      if (v._tsFailed || v.error || v.readyState >= 3) ready++;
    }
    return { ready, total: vids.length };
  }

  // ── Video setup / teardown ────────────────────────────

  /**
   * Create an off-DOM muted <video> and wire the metadata + error listeners.
   * A load failure is only MARKED on the element (`_tsFailed`) — an errored
   * element never re-fires 'error' and its play() promise never settles, so
   * the consumers check the flag instead of relying on events (decision #53).
   */
  _buildVideoElement(videoSrc) {
    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;  // smooth inline playback on mobile
    video.preload = 'auto';
    video.loop = false;

    this._addVideoListener(video, 'loadedmetadata', () => {
      // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
      // intrinsic video size so the cover-fit math works for the <video>.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    });
    this._addVideoListener(video, 'error', () => { video._tsFailed = true; });
    return video;
  }

  _addVideoListener(video, event, fn) {
    video.addEventListener(event, fn);
    if (!this._videoListeners.has(video)) this._videoListeners.set(video, []);
    this._videoListeners.get(video).push([event, fn]);
  }

  /** Remove all listeners this scene attached to `video` (handoff keeps the element alive). */
  _detachVideoListeners(video) {
    const listeners = this._videoListeners.get(video);
    if (listeners) {
      for (const [event, fn] of listeners) video.removeEventListener(event, fn);
      this._videoListeners.delete(video);
    }
  }

  _destroyVideo(video) {
    if (!video) return;
    this._detachVideoListeners(video);
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
  }

  /** True when the element has a frame ready to paint and hasn't failed. */
  _isPaintable(video) {
    return !!video && !video._tsFailed && !video.error && video.readyState >= 2;
  }

  // ── Lifecycle ─────────────────────────────────────────

  /** Called by SceneManager when this scene becomes active */
  onEnter() {
    this._elapsed = 0;
    this._transitionElapsed = 0;
    this._pendingHandoff = false;
    this._pendingFallback = false;
    this._finished = false;
    this._phase = 'idle';

    // Rebuild anything not already buffered (idempotent; also restores the
    // transition element if a previous visit handed it off).
    this.preloadVideos();

    // Start the intro movie; a dead element falls straight back to the static image.
    const intro = this._introVideo;
    if (intro && !intro._tsFailed && !intro.error) {
      this._phase = 'intro';
      this._addVideoListener(intro, 'ended', () => this._endIntro());
      try { intro.currentTime = 0; } catch (e) { /* ignore */ }
      const playResult = intro.play();
      if (playResult && typeof playResult.catch === 'function') {
        // Autoplay blocked or load failure — show the static title instead.
        playResult.catch(() => this._endIntro());
      }
    } else {
      this._endIntro();
    }

    // Register input listeners — any key or click starts the transition
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

    // Tear down both videos. After a handoff `_transitionVideo` is already
    // null — CharacterSelectScene owns (and releases) that element.
    this._destroyVideo(this._introVideo);
    this._introVideo = null;
    this._destroyVideo(this._transitionVideo);
    this._transitionVideo = null;
  }

  // ── Intro ─────────────────────────────────────────────

  /** End the intro movie (finished, failed, or bailed) → static title screen. */
  _endIntro() {
    if (this._phase === 'intro') this._phase = 'idle';
    this._destroyVideo(this._introVideo);
    this._introVideo = null;
  }

  /**
   * Static-image alpha over the intro movie: 0 until the movie is within
   * INTRO_CROSSFADE_MS of its end, then ramps to 1 exactly at the end.
   */
  _introCrossfadeAlpha() {
    const v = this._introVideo;
    if (!v) return 1;
    const d = v.duration;
    if (!isFinite(d) || d <= 0) return 0;
    const remainMs = Math.max(0, (d - v.currentTime) * 1000);
    return Math.min(1, Math.max(0, 1 - remainMs / INTRO_CROSSFADE_MS));
  }

  // ── Input / transition ────────────────────────────────

  _onAnyInput() {
    // Prevent double-transition (keydown + click in same frame, etc.)
    if (!this._sceneManager || this._sceneManager._currentScene !== this) return;
    if (this._phase === 'transition' || this._finished) return;

    this._beginTransition();
  }

  /**
   * Start the transition movie + its SFX together. The intro (if still
   * playing) pauses in place and keeps serving as the base frame until the
   * transition movie's first frame is paintable. A dead transition element
   * falls back to the classic fade.
   */
  _beginTransition() {
    if (this._introVideo) {
      try { this._introVideo.pause(); } catch (e) { /* ignore */ }
    }

    const video = this._transitionVideo;
    if (!video || video._tsFailed || video.error) {
      this._pendingFallback = true;
      return;
    }

    this._phase = 'transition';
    this._transitionElapsed = 0;

    AudioManager.playSfx(TRANSITION_SFX_KEY);

    this._addVideoListener(video, 'ended', () => { this._pendingHandoff = true; });
    try { video.currentTime = 0; } catch (e) { /* ignore */ }
    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => { this._pendingFallback = true; });
    }
  }

  /**
   * Hand the still-playing transition <video> to CharacterSelectScene and
   * switch scenes INSTANTLY (no black fade): the scene draws the video over
   * its UI at a decaying alpha (renderForeground), so the movie's end
   * cross-fades into the character select layout. Ownership of the element
   * transfers — our listeners detach and our reference nulls BEFORE switchTo,
   * so onExit doesn't tear it down.
   */
  _executeHandoff() {
    const sm = this._sceneManager;
    const cs = sm._scenes && sm._scenes['CharacterSelectScene'];
    const video = this._transitionVideo;

    if (!cs || typeof cs.setEntryVideoOverlay !== 'function' || !this._isPaintable(video)) {
      this._executeFallback();
      return;
    }

    this._finished = true;
    this._detachVideoListeners(video);
    this._transitionVideo = null;
    cs.setEntryVideoOverlay(video, TRANSITION_CROSSFADE_MS);
    sm.switchTo('CharacterSelectScene');
  }

  /** Classic pre-movie behavior — fade through black to the character select. */
  _executeFallback() {
    this._finished = true;
    this._sceneManager.fadeToScene('CharacterSelectScene', FALLBACK_FADE_MS);
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    this._elapsed += dt;

    if (this._phase === 'intro') {
      const v = this._introVideo;
      // Fail-fast: the intro errored or never produced a paintable frame
      // within the bailout window → settle on the static title image.
      if (!v || v._tsFailed || v.error
          || (this._elapsed >= VIDEO_STALL_BAILOUT_MS && v.readyState < 2)) {
        this._endIntro();
      }
    }

    if (this._phase === 'transition' && !this._finished
        && !this._pendingHandoff && !this._pendingFallback) {
      this._transitionElapsed += dt;
      const v = this._transitionVideo;

      if (!v || v._tsFailed || v.error) {
        // Died mid-play — classic fade.
        this._pendingFallback = true;
      } else if (this._transitionElapsed >= VIDEO_STALL_BAILOUT_MS && v.readyState < 2) {
        // Never became paintable (offline / unreachable .mp4) — fail fast.
        this._pendingFallback = true;
      } else if (this._transitionElapsed >= TRANSITION_MAX_DURATION_MS) {
        // Safety net if 'ended' never fires.
        this._pendingHandoff = true;
      } else if (this._isPaintable(v) && isFinite(v.duration) && v.duration > 0
          && (v.duration - v.currentTime) * 1000 <= TRANSITION_HANDOFF_LEAD_MS) {
        // The movie is a frame from its end — hand its last frame off now.
        this._pendingHandoff = true;
      }
    }

    // Execute a pending handoff/fallback once no SceneManager transition is in
    // flight (switchTo/fadeToScene are ignored mid-transition — e.g. during the
    // LoadingScene → Title fade-in).
    const sm = this._sceneManager;
    if (!this._finished && sm && sm._currentScene === this && !sm.isTransitioning()) {
      if (this._pendingHandoff) this._executeHandoff();
      else if (this._pendingFallback) this._executeFallback();
    }

    super.update(dt);
  }

  // ── Render ────────────────────────────────────────────

  /**
   * Paint the title visuals across the entire physical canvas (cover-fit).
   * Called by SceneManager before the design-space viewport clip is applied,
   * so the image fills the letterbox/pillarbox bars.
   *
   * Layering (bottom → top):
   *   1. intro movie frame (while the intro element lives) — else the static
   *      title image; black only while the intro is still buffering.
   *   2. static title image at the intro cross-fade alpha (the movie's tail).
   *   3. transition movie frame, fully opaque once paintable (covers all).
   */
  renderBackground(_ctx) {
    const sm = this._sceneManager;
    if (!sm) return;
    const app = sm._app;
    const am = sm.assetManager;

    const fadeAlpha = Math.min(1.0, this._elapsed / this._fadeInDuration);

    // 3. Transition movie once paintable — it covers everything beneath.
    const trans = this._phase === 'transition' ? this._transitionVideo : null;
    if (this._isPaintable(trans)) {
      app.drawFullCanvasImage(trans, 1.0);
      return;
    }

    // 1 + 2. Intro movie with its static-image cross-fade tail…
    const intro = this._introVideo;
    if (this._isPaintable(intro)) {
      app.drawFullCanvasImage(intro, fadeAlpha);
      const cross = this._introCrossfadeAlpha();
      if (cross > 0 && am) {
        const img = am.get(this.backgroundAssetKey);
        if (img) app.drawFullCanvasImage(img, cross * fadeAlpha);
      }
      return;
    }

    // …or the static title image (idle / every fallback). Black while an
    // unplayed intro is still buffering (pre-bailout).
    if (this._phase !== 'intro' && am) {
      const img = am.get(this.backgroundAssetKey);
      if (img) app.drawFullCanvasImage(img, fadeAlpha);
    }
  }

  /** No in-viewport rendering — the title visuals are drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}
}
