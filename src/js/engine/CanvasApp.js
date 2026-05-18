/**
 * CanvasApp — wraps an HTML5 Canvas with a fixed design-space viewport.
 *
 * The canvas always covers the full browser window (CSS + backing store at
 * devicePixelRatio for crispness). Internally, the 2D context is pre-scaled
 * and pre-translated so all drawing code uses a fixed design coordinate
 * system (default 1920×1080). The design rect is fit-scaled into the window
 * uniformly, producing letterbox/pillarbox black bars on whichever axis has
 * extra room.
 *
 * width / height getters return DESIGN-space dimensions, so existing scene
 * layout code that reads them continues to work without modification.
 */
export default class CanvasApp {
  /**
   * @param {string|HTMLCanvasElement} canvasOrId - canvas element or id
   * @param {object} [opts]
   * @param {boolean} [opts.autoResize=true]
   * @param {number}  [opts.designWidth=1920]
   * @param {number}  [opts.designHeight=1080]
   */
  constructor(canvasOrId, opts = {}) {
    this.canvas = typeof canvasOrId === 'string'
      ? document.getElementById(canvasOrId)
      : canvasOrId;

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'app-canvas';
      document.body.appendChild(this.canvas);
    }

    // Request opaque context for performance (no alpha blending with page)
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    /** Current device pixel ratio */
    this.dpr = window.devicePixelRatio || 1;

    this.autoResize = opts.autoResize !== false;

    /** Fixed design-space dimensions — all scene code lays out into this rect */
    this.designWidth  = opts.designWidth  || 1920;
    this.designHeight = opts.designHeight || 1080;

    /** Physical CSS-pixel size of the canvas (== window.innerWidth/Height) */
    this._cssWidth = 0;
    this._cssHeight = 0;

    /** Uniform scale that fits design rect into the window */
    this._scale = 1;
    /** CSS-pixel offset from canvas top-left to the design rect (centers the viewport) */
    this._offsetX = 0;
    this._offsetY = 0;

    // Default to crisp rendering for pixel-art sprites / UI.
    // Individual draw calls may override via imageSmoothingEnabled.
    this.ctx.imageSmoothingEnabled = false;

    /** Callback after resize: (designWidth, designHeight) => {} */
    this.onResize = null;

    if (this.autoResize) {
      this._onResize = this._handleResize.bind(this);
      window.addEventListener('resize', this._onResize);
      // Re-check on DPR change (e.g. dragging window to a different-DPI monitor)
      this._dprMql = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
      this._onResizeOnDPR = this._handleResize.bind(this);
      this._dprMql.addEventListener('change', this._onResizeOnDPR);
      this._handleResize();
    }
  }

  /** Design-space width (constant — what scene layout code reads) */
  get width()  { return this.designWidth; }
  /** Design-space height (constant — what scene layout code reads) */
  get height() { return this.designHeight; }

  /** Physical CSS-pixel canvas width (= window.innerWidth) */
  get cssWidth()  { return this._cssWidth; }
  /** Physical CSS-pixel canvas height (= window.innerHeight) */
  get cssHeight() { return this._cssHeight; }

  /** Uniform design-to-CSS scale factor */
  get scale()   { return this._scale; }
  /** CSS-pixel X offset from canvas left to design (0,0) */
  get offsetX() { return this._offsetX; }
  /** CSS-pixel Y offset from canvas top to design (0,0) */
  get offsetY() { return this._offsetY; }

  _handleResize() {
    this.dpr = window.devicePixelRatio || 1;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    this._cssWidth = winW;
    this._cssHeight = winH;

    // Backing store covers the full window at DPR.
    this.canvas.width  = Math.max(1, Math.floor(winW * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(winH * this.dpr));
    this.canvas.style.width  = winW + 'px';
    this.canvas.style.height = winH + 'px';

    // Uniform scale that fits the entire design rect inside the window.
    this._scale = Math.min(winW / this.designWidth, winH / this.designHeight);
    this._offsetX = (winW - this.designWidth  * this._scale) / 2;
    this._offsetY = (winH - this.designHeight * this._scale) / 2;

    // Apply combined design-scale × DPR transform so all draw calls use design coords.
    this._applyDesignTransform();
    this.ctx.imageSmoothingEnabled = false;

    if (this.onResize) {
      this.onResize(this.designWidth, this.designHeight);
    }
  }

  /** Re-apply the design-space transform (used after temporary resets). */
  _applyDesignTransform() {
    const s = this._scale * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, this._offsetX * this.dpr, this._offsetY * this.dpr);
  }

  /**
   * Clear the canvas: black on the side/letterbox bars, viewport color inside
   * the design rect. All coordinates passed to subsequent draw calls are in
   * design space.
   */
  clear(viewportColor = '#1a0a0a') {
    const ctx = this.ctx;
    // 1. Fill the entire physical canvas (including bars) with black.
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this._cssWidth, this._cssHeight);
    ctx.restore();
    // 2. Restored transform is the design-space one — paint viewport background.
    ctx.fillStyle = viewportColor;
    ctx.fillRect(0, 0, this.designWidth, this.designHeight);
  }

  /**
   * Push a clip rect equal to the design viewport so scenes cannot draw into
   * the letterbox bars. Pair with endViewportClip().
   */
  beginViewportClip() {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.designWidth, this.designHeight);
    ctx.clip();
  }

  /** Restore the state pushed by beginViewportClip(). */
  endViewportClip() {
    this.ctx.restore();
  }

  /**
   * Convert a CSS-pixel coordinate (e.g. from a pointer event relative to
   * the canvas top-left) into design-space coordinates.
   * @param {number} cssX
   * @param {number} cssY
   * @returns {{x:number, y:number}}
   */
  cssToDesign(cssX, cssY) {
    const s = this._scale || 1;
    return {
      x: (cssX - this._offsetX) / s,
      y: (cssY - this._offsetY) / s,
    };
  }

  /**
   * Schedule manual resize check (useful after DOM changes).
   */
  checkResize() {
    if (this.autoResize) {
      this._handleResize();
    }
  }

  /** Clean up event listeners */
  destroy() {
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this._onResizeOnDPR && this._dprMql) {
      this._dprMql.removeEventListener('change', this._onResizeOnDPR);
      this._onResizeOnDPR = null;
      this._dprMql = null;
    }
  }
}
