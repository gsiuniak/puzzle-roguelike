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

    // Touch support — bind once so we can remove on destroy()
    this._handleTouchStartBound  = this._handleTouchStart.bind(this);
    this._handleTouchMoveBound   = this._handleTouchMove.bind(this);
    this._handleTouchEndBound    = this._handleTouchEnd.bind(this);
    this._handleTouchCancelBound = this._handleTouchCancel.bind(this);
    this.canvas.addEventListener('touchstart',  this._handleTouchStartBound,  { passive: false });
    this.canvas.addEventListener('touchmove',   this._handleTouchMoveBound,   { passive: false });
    this.canvas.addEventListener('touchend',    this._handleTouchEndBound,    { passive: false });
    this.canvas.addEventListener('touchcancel', this._handleTouchCancelBound, { passive: false });
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

  // ── Touch ───────────────────────────────────────────
  // Mirror desktop mouse events 1:1:
  //   touchstart  → mousemove + mousedown
  //   touchmove   → mousemove
  //   touchend    → mouseup + click
  //   touchcancel → mouseup
  // Tracks only the primary (first) touch — multi-touch is ignored.

  _handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 0) return;
    const pos = this._getPos(e.touches[0]);
    this.mouseX = pos.x;
    this.mouseY = pos.y;
    this.mouseDown = true;
    // Fire mousemove first so scenes that rely on hover state (BattleScene
    // tile-swap highlight, CharacterSelect button hover) update before the
    // mousedown handler reads the tapped position.
    this._fire('mousemove', pos.x, pos.y);
    this._fire('mousedown', pos.x, pos.y);
  }

  _handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 0) return;
    const pos = this._getPos(e.touches[0]);
    this.mouseX = pos.x;
    this.mouseY = pos.y;
    this._fire('mousemove', pos.x, pos.y);
  }

  _handleTouchEnd(e) {
    e.preventDefault();
    // e.touches is empty here — the lifted finger lives in e.changedTouches.
    // Cached mouseX/Y from the last touchmove can be stale by 10–30ms on a
    // fast drag, so read the actual lift position from changedTouches.
    let x = this.mouseX;
    let y = this.mouseY;
    if (e.changedTouches && e.changedTouches.length > 0) {
      const pos = this._getPos(e.changedTouches[0]);
      x = pos.x; y = pos.y;
    }
    this.mouseX = x;
    this.mouseY = y;
    this.mouseDown = false;
    this._fire('mouseup', x, y);
    this._fire('click', x, y);
  }

  _handleTouchCancel(e) {
    e.preventDefault();
    let x = this.mouseX;
    let y = this.mouseY;
    if (e.changedTouches && e.changedTouches.length > 0) {
      const pos = this._getPos(e.changedTouches[0]);
      x = pos.x; y = pos.y;
    }
    this.mouseDown = false;
    this._fire('mouseup', x, y);
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
    this.canvas.removeEventListener('touchstart',  this._handleTouchStartBound);
    this.canvas.removeEventListener('touchmove',   this._handleTouchMoveBound);
    this.canvas.removeEventListener('touchend',    this._handleTouchEndBound);
    this.canvas.removeEventListener('touchcancel', this._handleTouchCancelBound);
    this._listeners = {};
  }
}
