/**
 * CanvasApp — wraps an HTML5 Canvas, handles DPR-aware resize, provides context.
 *
 * The canvas fills the browser window and renders crisply on high-DPI screens
 * by setting internal resolution to CSS size × devicePixelRatio.
 *
 * Defaults:
 *   - imageSmoothingEnabled = false  (crisp sprites; override per-draw-call)
 *   - alpha = false                  (opaque canvas for performance)
 */
export default class CanvasApp {
  /**
   * @param {string|HTMLCanvasElement} canvasOrId - canvas element or id
   * @param {object} [opts]
   * @param {boolean} [opts.autoResize=true]
   * @param {number}  [opts.minWidth=320]
   * @param {number}  [opts.minHeight=480]
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
    this.minWidth = opts.minWidth || 320;
    this.minHeight = opts.minHeight || 480;

    /** Logical CSS-pixel dimensions (used by layout code) */
    this._cssWidth = 0;
    this._cssHeight = 0;

    // Default to crisp rendering for pixel-art sprites / UI.
    // Individual draw calls may override via imageSmoothingEnabled.
    this.ctx.imageSmoothingEnabled = false;

    /** Callback after resize: (cssWidth, cssHeight) => {} */
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

  /** Logical (CSS-pixel) width the layout system should use */
  get width() { return this._cssWidth; }
  /** Logical (CSS-pixel) height the layout system should use */
  get height() { return this._cssHeight; }

  _handleResize() {
    const prevDpr = this.dpr;
    // Update DPR in case it changed (monitor switch)
    this.dpr = window.devicePixelRatio || 1;

    const w = Math.max(this.minWidth, window.innerWidth);
    const h = Math.max(this.minHeight, window.innerHeight);

    const sizeChanged = this._cssWidth !== w || this._cssHeight !== h;
    const dprChanged = prevDpr !== this.dpr;

    // Update when CSS size OR DPR changes
    if (sizeChanged || dprChanged) {
      this._cssWidth = w;
      this._cssHeight = h;

      // Internal resolution = CSS size × DPR for sharp rendering
      this.canvas.width = w * this.dpr;
      this.canvas.height = h * this.dpr;

      // CSS display size matches layout coordinates
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';

      // Scale the context so all drawing code uses CSS-pixel coordinates.
      // setTransform() resets any prior transform, avoiding cumulative scaling.
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Re-apply default smoothing after reset
      this.ctx.imageSmoothingEnabled = false;

      // Only fire onResize callback for actual size changes (layout recalc)
      if (sizeChanged && this.onResize) {
        this.onResize(w, h);
      }
    }
  }

  /**
   * Clear the entire canvas.
   * All coordinates are in CSS pixels (context is pre-scaled by DPR).
   */
  clear(color = '#111111') {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this._cssWidth, this._cssHeight);
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
