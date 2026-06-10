import UIImage from './UIImage.js';

// ── Tunables ─────────────────────────────────────────────
// The chroma key color — pixels close to this are made transparent. The video's
// background was authored to this flat green (#a4f885). mp4 compression spreads
// the flat fill across nearby values, so a pixel is keyed when its squared RGB
// distance to KEY_COLOR is within KEY_TOLERANCE². Raise the tolerance to key
// more aggressively (risks eating green-tinted edges); lower it to be stricter.
const KEY_COLOR = { r: 164, g: 248, b: 133 };
const KEY_TOLERANCE = 80;
const KEY_TOLERANCE_SQ = KEY_TOLERANCE * KEY_TOLERANCE;
// Cap the per-frame processing resolution. The portrait displays small
// (~150px), so processing the full native video frame each frame is wasteful;
// the offscreen canvas is sized to fit within this box (aspect preserved),
// then cover-fit scaled up by UIImage's normal draw.
const PROCESS_MAX_DIM = 256;

/**
 * VideoPortrait — a UIImage whose "image" is a live video frame with the chroma
 * key color (KEY_COLOR, default the green #a4f885 backdrop) keyed to transparent.
 *
 * It plays a muted, looping <video> off-DOM. Each render it draws the current
 * frame into an offscreen canvas, walks the pixels turning backdrop-colored
 * pixels → transparent (alpha 0), and hands that canvas to UIImage.renderSelf,
 * which cover-fits it into the portrait rect exactly like a normal sprite. The
 * keyed-out backdrop becomes transparent so the panel background shows through.
 *
 * Until the first frame is decodable it falls back to the static portrait
 * sprite (fallbackAssetKey), so the pane never shows an empty box.
 *
 * Reusable for any character/enemy with a `portraitVideo`. Created by
 * CharacterInfoPane when its data carries that field. Call destroy() when the
 * owning pane is rebuilt or the scene exits to release the <video>.
 */
export default class VideoPortrait extends UIImage {
  /**
   * @param {string} videoSrc          - video URL (relative to index.html)
   * @param {string} fallbackAssetKey  - static sprite shown until frames flow
   * @param {import('../engine/AssetManager.js').default|null} assetManager
   */
  constructor(videoSrc, fallbackAssetKey = 'placeholder', assetManager = null) {
    // The fallback sprite is the UIImage's normal asset key; getImage() swaps
    // in the live keyed frame once it's ready.
    super(fallbackAssetKey, assetManager);
    this.smoothing = true;

    /** Chroma key color — pixels near this become transparent. Tunable. */
    this.keyColor = { ...KEY_COLOR };
    /** Squared RGB distance within which a pixel is keyed out. Tunable. */
    this.keyToleranceSq = KEY_TOLERANCE_SQ;

    this._videoSrc = videoSrc;
    /** @type {HTMLVideoElement|null} */
    this._video = null;
    /** @type {HTMLCanvasElement|null} offscreen where chroma-key happens */
    this._offscreen = null;
    /** @type {CanvasRenderingContext2D|null} */
    this._offCtx = null;

    this._createVideo();
  }

  _createVideo() {
    if (!this._videoSrc) return;

    const video = document.createElement('video');
    video.src = this._videoSrc;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;
    video.loop = true;         // portrait idles forever
    video.preload = 'auto';

    video.addEventListener('loadedmetadata', () => {
      // Size the offscreen canvas to fit the native frame inside PROCESS_MAX_DIM
      // (aspect preserved). Smaller canvas = cheaper per-frame getImageData loop.
      const vw = video.videoWidth || PROCESS_MAX_DIM;
      const vh = video.videoHeight || PROCESS_MAX_DIM;
      const scale = Math.min(1, PROCESS_MAX_DIM / Math.max(vw, vh));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vw * scale));
      cv.height = Math.max(1, Math.round(vh * scale));
      this._offscreen = cv;
      // willReadFrequently keeps getImageData on the CPU-side fast path.
      this._offCtx = cv.getContext('2d', { willReadFrequently: true });
    });

    this._video = video;

    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      // Autoplay blocked / load failure — silently keep the static fallback.
      playResult.catch(() => {});
    }
  }

  /**
   * Returns the keyed live frame (offscreen canvas) when a frame is ready,
   * otherwise defers to UIImage's normal asset lookup (the static fallback).
   * Called once per renderSelf by the UIImage base class.
   */
  getImage() {
    if (this._processFrame()) return this._offscreen;
    return super.getImage();
  }

  /**
   * Draw the current video frame into the offscreen canvas and key out white.
   * @returns {boolean} true if a frame was processed and is ready to draw.
   */
  _processFrame() {
    const v = this._video;
    // readyState 2 = HAVE_CURRENT_DATA (a frame is decodable).
    if (!v || v.readyState < 2 || !this._offCtx || !this._offscreen) return false;

    const w = this._offscreen.width;
    const h = this._offscreen.height;
    const ctx = this._offCtx;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(v, 0, 0, w, h);

    let frame;
    try {
      frame = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      // Tainted canvas or transient failure — fall back to the static sprite.
      return false;
    }

    const px = frame.data;
    const { r: kr, g: kg, b: kb } = this.keyColor;
    const tolSq = this.keyToleranceSq;
    for (let i = 0; i < px.length; i += 4) {
      const dr = px[i] - kr;
      const dg = px[i + 1] - kg;
      const db = px[i + 2] - kb;
      if (dr * dr + dg * dg + db * db <= tolSq) {
        px[i + 3] = 0; // fully transparent
      }
    }
    ctx.putImageData(frame, 0, 0);
    return true;
  }

  /** Stop and release the <video>. Call when the owning pane is torn down. */
  destroy() {
    if (this._video) {
      try { this._video.pause(); } catch (e) { /* ignore */ }
      this._video.removeAttribute('src');
      try { this._video.load(); } catch (e) { /* ignore */ }
      this._video = null;
    }
    this._offscreen = null;
    this._offCtx = null;
  }
}
