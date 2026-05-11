/**
 * CanvasApp — wraps an HTML5 Canvas, handles resize, provides context.
 * The canvas fills the browser window.
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

    this.ctx = this.canvas.getContext('2d');
    this.autoResize = opts.autoResize !== false;
    this.minWidth = opts.minWidth || 320;
    this.minHeight = opts.minHeight || 480;

    // Disable image smoothing for pixel art
    this.ctx.imageSmoothingEnabled = true;

    /** Callback after resize: (width, height) => {} */
    this.onResize = null;

    if (this.autoResize) {
      this._onResize = this._handleResize.bind(this);
      window.addEventListener('resize', this._onResize);
      this._handleResize();
    }
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  _handleResize() {
    const w = Math.max(this.minWidth, window.innerWidth);
    const h = Math.max(this.minHeight, window.innerHeight);

    // Only update if changed
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;

      if (this.onResize) {
        this.onResize(w, h);
      }
    }
  }

  /**
   * Clear the entire canvas.
   */
  clear(color = '#111111') {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
  }
}
