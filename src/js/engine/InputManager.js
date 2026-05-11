/**
 * InputManager — simple mouse/touch event handling with hit-testing.
 *
 * Provides:
 *   - mouse position (x, y)
 *   - click/mousedown/mouseup events
 *   - hit testing delegation to a root UIElement tree
 *
 * Usage:
 *   const input = new InputManager(canvas);
 *   input.on('click', (x, y) => { ... });
 *   input.setRootUI(rootUIElement); // for hit testing
 */
export default class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
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
    };

    // Bound handlers
    this._handleClick = this._onClick.bind(this);
    this._handleMouseDown = this._onMouseDown.bind(this);
    this._handleMouseUp = this._onMouseUp.bind(this);
    this._handleMouseMove = this._onMouseMove.bind(this);

    // Attach canvas events
    this.canvas.addEventListener('click', this._handleClick);
    this.canvas.addEventListener('mousedown', this._handleMouseDown);
    this.canvas.addEventListener('mouseup', this._handleMouseUp);
    this.canvas.addEventListener('mousemove', this._handleMouseMove);

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

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    // Canvas CSS size matches our logical coordinate space,
    // so getBoundingClientRect coords are already in the correct units.
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _onClick(e) { this._fire('click', this._getPos(e)); }
  _onMouseDown(e) {
    const pos = this._getPos(e);
    this.mouseDown = true;
    this._fire('mousedown', pos);
  }
  _onMouseUp(e) {
    const pos = this._getPos(e);
    this.mouseDown = false;
    this._fire('mouseup', pos);
  }
  _onMouseMove(e) {
    const pos = this._getPos(e);
    this.mouseX = pos.x;
    this.mouseY = pos.y;
    this._fire('mousemove', pos);
  }

  _handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length > 0) {
      const pos = this._getPos(e.touches[0]);
      this.mouseX = pos.x;
      this.mouseY = pos.y;
      this.mouseDown = true;
      this._fire('mousedown', pos);
    }
  }

  _handleTouchEnd(e) {
    e.preventDefault();
    const pos = { x: this.mouseX, y: this.mouseY };
    this.mouseDown = false;
    this._fire('mouseup', pos);
    this._fire('click', pos);
  }

  _fire(eventName, pos) {
    const arr = this._listeners[eventName];
    if (arr) {
      for (const cb of arr) {
        try {
          cb(pos.x, pos.y);
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
    this._listeners = {};
  }
}
