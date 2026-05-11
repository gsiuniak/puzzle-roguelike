import Rect from './Rect.js';

/**
 * Base UIElement with layout, render, hit-test, padding, margin,
 * sizing (fixed / percent / flexGrow), alignment, debug outline.
 *
 * All UI components inherit from this.
 */
let _idCounter = 0;

export default class UIElement {
  constructor() {
    this._id = ++_idCounter;
    this.parent = null;
    this.children = [];

    /** Computed layout rect in parent-local coordinates */
    this.rect = new Rect();

    /** Padding: single number or {top, right, bottom, left} */
    this.padding = 0;
    /** Margin: single number or {top, right, bottom, left} */
    this.margin = 0;

    /** Fixed size (null = auto) */
    this.width = null;
    this.height = null;

    /** Percent of parent available space (0-1), overrides width/height if set */
    this.widthPercent = null;
    this.heightPercent = null;

    /** Flex grow factor for filling remaining space */
    this.flexGrow = 0;

    /** Min / max constraints */
    this.minWidth = 0;
    this.maxWidth = Infinity;
    this.minHeight = 0;
    this.maxHeight = Infinity;

    /** Self alignment (overrides container's alignItems) */
    this.alignSelfH = null;  // 'left' | 'center' | 'right' | 'stretch'
    this.alignSelfV = null;  // 'top'  | 'center' | 'bottom' | 'stretch'

    /** Visibility */
    this.visible = true;

    /** Debug */
    this.debug = false;

    /** User data ref */
    this.userData = null;
  }

  // ── helpers ──────────────────────────────────────────

  /** Resolve padding to {top,right,bottom,left} */
  _resolvePadding() {
    if (typeof this.padding === 'number') {
      return { top: this.padding, right: this.padding, bottom: this.padding, left: this.padding };
    }
    const p = this.padding || {};
    return {
      top: p.top || 0,
      right: p.right || 0,
      bottom: p.bottom || 0,
      left: p.left || 0,
    };
  }

  /** Resolve margin to {top,right,bottom,left} */
  _resolveMargin() {
    if (typeof this.margin === 'number') {
      return { top: this.margin, right: this.margin, bottom: this.margin, left: this.margin };
    }
    const m = this.margin || {};
    return {
      top: m.top || 0,
      right: m.right || 0,
      bottom: m.bottom || 0,
      left: m.left || 0,
    };
  }

  /** Content area inside padding */
  getContentRect() {
    const p = this._resolvePadding();
    return new Rect(
      this.rect.x + p.left,
      this.rect.y + p.top,
      this.rect.w - p.left - p.right,
      this.rect.h - p.top - p.bottom
    );
  }

  // ── tree ─────────────────────────────────────────────

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parent = null;
      this.children.splice(idx, 1);
    }
    return child;
  }

  clearChildren() {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
  }

  /** Depth-first search for a child by id */
  findChildById(id) {
    if (this._id === id) return this;
    for (const c of this.children) {
      const found = c.findChildById(id);
      if (found) return found;
    }
    return null;
  }

  // ── layout ───────────────────────────────────────────

  /**
   * Compute this element's rect from the given parent content rect.
   * Base implementation handles margin, then delegates to layoutSelf + layoutChildren.
   */
  layout(parentRect) {
    if (!this.visible) return;

    const margin = this._resolveMargin();

    // Apply margin to shrink available area
    const available = new Rect(
      parentRect.x + margin.left,
      parentRect.y + margin.top,
      parentRect.w - margin.left - margin.right,
      parentRect.h - margin.top - margin.bottom
    );

    this.layoutSelf(available);
    this.layoutChildren();
  }

  /**
   * Compute own rect based on available space.
   * Override in subclasses for custom sizing.
   */
  layoutSelf(available) {
    let w, h;

    // Determine width
    if (this.widthPercent !== null && this.widthPercent !== undefined) {
      w = available.w * this.widthPercent;
    } else if (this.width !== null && this.width !== undefined) {
      w = this.width;
    } else {
      w = available.w; // auto = fill available
    }

    // Determine height
    if (this.heightPercent !== null && this.heightPercent !== undefined) {
      h = available.h * this.heightPercent;
    } else if (this.height !== null && this.height !== undefined) {
      h = this.height;
    } else {
      h = available.h; // auto = fill available
    }

    // Apply min/max constraints
    w = Math.max(this.minWidth, Math.min(this.maxWidth, w));
    h = Math.max(this.minHeight, Math.min(this.maxHeight, h));

    // Position — default to available origin
    this.rect.x = available.x;
    this.rect.y = available.y;
    this.rect.w = w;
    this.rect.h = h;
  }

  /** Layout children. Override in containers. */
  layoutChildren() {
    // Base: no-op. Subclasses (UIContainer) do the real work.
  }

  // ── render ───────────────────────────────────────────

  render(ctx) {
    if (!this.visible) return;

    this.renderSelf(ctx);
    this.renderChildren(ctx);

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }

  renderSelf(ctx) {
    // Override in subclasses
  }

  renderChildren(ctx) {
    for (const child of this.children) {
      child.render(ctx);
    }
  }

  _drawDebug(ctx) {
    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);

    // Draw ID label
    const label = `${this.constructor.name}#${this._id}`;
    ctx.fillStyle = 'red';
    ctx.font = '10px monospace';
    ctx.fillText(label, this.rect.x + 2, this.rect.y + 12);
    ctx.restore();
  }

  // ── hit test ─────────────────────────────────────────

  hitTest(x, y) {
    if (!this.visible) return null;
    if (!this.rect.containsPoint(x, y)) return null;

    // Check children in reverse (top-most first)
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitTest(x, y);
      if (hit) return hit;
    }
    return this;
  }

  // ── update ───────────────────────────────────────────

  update(dt) {
    if (!this.visible) return;
    for (const child of this.children) {
      child.update(dt);
    }
  }

  /**
   * Batch-set style properties from an object.
   * Supported keys: padding, margin, width, height, widthPercent, heightPercent,
   *   flexGrow, minWidth, maxWidth, minHeight, maxHeight, alignSelfH, alignSelfV, debug, visible
   */
  setStyle(props) {
    for (const [key, value] of Object.entries(props)) {
      if (key in this) {
        this[key] = value;
      }
    }
  }
}
