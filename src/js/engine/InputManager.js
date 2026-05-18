/**
 * InputManager — simple mouse/touch/keyboard event handling with hit-testing.
 *
 * Provides:
 *   - mouse position (x, y)
 *   - click/mousedown/mouseup/mousemove/keydown events
 *   - hit testing delegation to a root UIElement tree
 *
 * Usage:
 *   const input = new InputManager(canvas, canvasApp);
 *   input.on('click', (x, y) => { ... });
 *   input.on('keydown', (event) => { ... });
 *   input.setRootUI(rootUIElement); // for hit testing
 *
 * Pointer coordinates are converted from CSS pixels into design-space via
 * canvasApp.cssToDesign(), so scenes always receive coords in the same
 * coordinate system they laid out into.
 */
export default class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./CanvasApp.js').default} [canvasApp] — for design-space coord conversion
   */
  constructor(canvas, canvasApp = null) {
    this.canvas = canvas;
    this._app = canvasApp;
    this._rootUI = null;

    // Mouse state
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;

    // Event listeners
    this._listeners = {
      click: [],
      mousedown: [],
      mouseup: [],
      mousemove: [],
      keydown: [],
    };

    // Bound handlers
    this._handleClick = this._onClick.bind(this);
    this._handleMouseDown = this._onMouseDown.bind(this);
    this._handleMouseUp = this._onMouseUp.bind(this);
    this._handleMouseMove = this._onMouseMove.bind(this);
    this._handleKeyDown = this._onKeyDown.bind(this);

    // Make canvas focusable for keyboard events
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.style.outline = 'none';

    // Attach canvas events
    this.canvas.addEventListener('click', this._handleClick);
    this.canvas.addEventListener('mousedown', this._handleMouseDown);
    this.canvas.addEventListener('mouseup', this._handleMouseUp);
    this.canvas.addEventListener('mousemove', this._handleMouseMove);
    this.canvas.addEventListener('keydown', this._handleKeyDown);

    // Touch support
    this.canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
  }

  /** Set the root UI element for hit testing */
  setRootUI(rootElement) {
    this._rootUI = rootElement;
  }

  /** Register an event listener */
  on(eventName, callback) {
    if (this._listeners[eventName]) {
      this._listeners[eventName].push(callback);
    }
  }

  /** Remove an event listener */
  off(eventName, callback) {
    const arr = this._listeners[eventName];
    if (arr) {
      const idx = arr.indexOf(callback);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  /** Remove all event listeners (used during scene transitions) */
  clearAllListeners() {
    for (const key of Object.keys(this._listeners)) {
      this._listeners[key] = [];
    }
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    if (this._app) {
      return this._app.cssToDesign(cssX, cssY);
    }
    return { x: cssX, y: cssY };
  }

  _onClick(e) {
    const pos = this._getPos(e);
    this._fire('click', pos.x, pos.y);
  }
  _onMouseDown(e) {
    const pos = this._getPos(e);
    this.mouseDown = true;
    this._fire('mousedown', pos.x, pos.y);
  }
  _onMouseUp(e) {
    const pos = this._getPos(e);
    this.mouseDown = false;
    this._fire('mouseup', pos.x, pos.y);
  }
  _onMouseMove(e) {
    const pos = this._getPos(e);
    this.mouseX = pos.x;
    this.mouseY = pos.y;
    this._fire('mousemove', pos.x, pos.y);
  }

  _onKeyDown(e) {
    this._fire('keydown', e);
  }

  _handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length > 0) {
      const pos = this._getPos(e.touches[0]);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this.mouseDown = true;
      this._fire('mousedown', pos.x, pos.y);
    }
  }

  _handleTouchEnd(e) {
    e.preventDefault();
    this.mouseDown = false;
    this._fire('mouseup', this.mouseX, this.mouseY);
    this._fire('click', this.mouseX, this.mouseY);
  }

  _fire(eventName, ...args) {
    const arr = this._listeners[eventName];
    if (arr) {
      for (const cb of arr) {
        try {
          cb(...args);
        } catch (e) {
          console.error(`InputManager: error in ${eventName} handler:`, e);
        }
      }
    }
  }

  /**
   * Hit-test the root UI tree and return the deepest element at (x,y).
   * Returns null if no element is hit.
   */
  hitTest(x, y) {
    if (!this._rootUI) return null;
    return this._rootUI.hitTest(x, y);
  }

  /** Clean up all event listeners */
  destroy() {
    this.canvas.removeEventListener('click', this._handleClick);
    this.canvas.removeEventListener('mousedown', this._handleMouseDown);
    this.canvas.removeEventListener('mouseup', this._handleMouseUp);
    this.canvas.removeEventListener('mousemove', this._handleMouseMove);
    this.canvas.removeEventListener('keydown', this._handleKeyDown);
    this._listeners = {};
  }
}
