import UIElement from './UIElement.js';
import Rect from './Rect.js';

/**
 * UIContainer — flexbox-inspired layout container.
 *
 * Properties:
 *   direction      - 'row' | 'column'  (default 'column')
 *   gap            - spacing between children (number)
 *   justifyContent - 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly'
 *   alignItems     - 'start' | 'center' | 'end' | 'stretch'
 *   background     - CSS color string (optional)
 *   borderColor    - CSS color string (optional)
 *   borderWidth    - number (default 0)
 *   cornerRadius   - number (default 0)
 */
export default class UIContainer extends UIElement {
  constructor() {
    super();
    this.direction = 'column';
    this.gap = 0;
    this.justifyContent = 'start';
    this.alignItems = 'stretch';
    this.background = null;
    this.borderColor = null;
    this.borderWidth = 0;
    this.cornerRadius = 0;
  }

  // ── layout algorithm ────────────────────────────────

  layoutChildren() {
    const content = this.getContentRect();
    const isRow = this.direction === 'row';
    const visibleChildren = this.children.filter(c => c.visible);

    if (visibleChildren.length === 0) return;

    const gap = this.gap;
    const totalGap = gap * (visibleChildren.length - 1);

    const axisSize = isRow ? content.w : content.h;    // main axis
    const crossSize = isRow ? content.h : content.w;    // cross axis

    // --- First pass: measure each child ---
    let totalFixedAxis = 0;
    let totalFlexGrow = 0;
    const childMeasures = [];

    for (const child of visibleChildren) {
      let axis = 0;
      let cross = crossSize; // default to full cross size
      let flexGrow = child.flexGrow || 0;

      // Resolve child margin
      const margin = child._resolveMargin();
      const mgnMainStart = isRow ? margin.left : margin.top;
      const mgnMainEnd   = isRow ? margin.right : margin.bottom;
      const mgnCrossStart = isRow ? margin.top : margin.left;
      const mgnCrossEnd   = isRow ? margin.bottom : margin.right;

      // --- Axis sizing (main direction) ---
      if (isRow) {
        if (child.widthPercent !== null && child.widthPercent !== undefined) {
          axis = content.w * child.widthPercent;
        } else if (child.width !== null && child.width !== undefined) {
          axis = child.width;
        } else {
          flexGrow = Math.max(flexGrow, 1); // auto → flex
        }
      } else {
        if (child.heightPercent !== null && child.heightPercent !== undefined) {
          axis = content.h * child.heightPercent;
        } else if (child.height !== null && child.height !== undefined) {
          axis = child.height;
        } else {
          flexGrow = Math.max(flexGrow, 1); // auto → flex
        }
      }

      // --- Cross sizing (perpendicular direction) ---
      if (isRow) {
        if (child.heightPercent !== null && child.heightPercent !== undefined) {
          cross = content.h * child.heightPercent;
        } else if (child.height !== null && child.height !== undefined) {
          cross = child.height;
        } else {
          // stretch: full cross minus cross margins
          cross = crossSize - mgnCrossStart - mgnCrossEnd;
        }
      } else {
        if (child.widthPercent !== null && child.widthPercent !== undefined) {
          cross = content.w * child.widthPercent;
        } else if (child.width !== null && child.width !== undefined) {
          cross = child.width;
        } else {
          // stretch: full cross minus cross margins
          cross = crossSize - mgnCrossStart - mgnCrossEnd;
        }
      }

      // Apply min/max constraints (axis)
      if (isRow) {
        axis = Math.max(child.minWidth, Math.min(child.maxWidth, axis));
        cross = Math.max(child.minHeight, Math.min(child.maxHeight, cross));
      } else {
        axis = Math.max(child.minHeight, Math.min(child.maxHeight, axis));
        cross = Math.max(child.minWidth, Math.min(child.maxWidth, cross));
      }

      // Total main-axis space including margins
      const axisWithMargin = axis + mgnMainStart + mgnMainEnd;

      childMeasures.push({
        child, axis, cross, flexGrow,
        mgnMainStart, mgnMainEnd, mgnCrossStart, mgnCrossEnd,
        axisWithMargin,
      });
      totalFlexGrow += flexGrow;
      if (flexGrow === 0) {
        totalFixedAxis += axisWithMargin;
      }
    }

    // --- Distribute remaining space to flex children ---
    let remaining = axisSize - totalGap - totalFixedAxis;
    if (remaining < 0) remaining = 0;

    const flexUnit = totalFlexGrow > 0 ? remaining / totalFlexGrow : 0;

    for (const m of childMeasures) {
      if (m.flexGrow > 0) {
        m.axis = Math.max(0, flexUnit * m.flexGrow);
        m.axisWithMargin = m.axis + m.mgnMainStart + m.mgnMainEnd;
      }
    }

    // --- Compute total axis used (margin-boxes) ---
    const totalAxisUsed = childMeasures.reduce((s, m) => s + m.axisWithMargin, 0) + totalGap;

    // --- Justify-content: compute per-gap distribution for space-* modes ---
    let effectiveGap = gap;
    let startOffset = 0;

    switch (this.justifyContent) {
      case 'center':
        startOffset = (axisSize - totalAxisUsed) / 2;
        break;
      case 'end':
        startOffset = axisSize - totalAxisUsed;
        break;
      case 'space-between':
        if (visibleChildren.length > 1) {
          effectiveGap = (axisSize - childMeasures.reduce((s, m) => s + m.axisWithMargin, 0))
            / (visibleChildren.length - 1);
        }
        break;
      case 'space-around':
        if (visibleChildren.length > 0) {
          const extra = (axisSize - childMeasures.reduce((s, m) => s + m.axisWithMargin, 0))
            / visibleChildren.length;
          effectiveGap = extra;       // gap between items
          startOffset = extra / 2;   // half-gap before first item
        }
        break;
      case 'space-evenly':
        if (visibleChildren.length > 0) {
          const extra = (axisSize - childMeasures.reduce((s, m) => s + m.axisWithMargin, 0))
            / (visibleChildren.length + 1);
          effectiveGap = extra;
          startOffset = extra;
        }
        break;
      case 'start':
      default:
        break;
    }

    // --- Place children ---
    let axisPos = isRow
      ? (content.x + startOffset)
      : (content.y + startOffset);

    const crossPosStart = isRow ? content.y : content.x;

    for (const m of childMeasures) {
      // Compute cross-axis position from alignItems / alignSelf
      let crossPos;
      const childAlign = this._childAlign(m.child);
      switch (childAlign) {
        case 'center':
          crossPos = crossPosStart + (crossSize - m.cross) / 2;
          break;
        case 'end':
        case 'bottom':
        case 'right':
          crossPos = crossPosStart + crossSize - m.cross;
          break;
        default: // 'start', 'top', 'left', 'stretch'
          crossPos = crossPosStart;
          break;
      }

      // Set child border-box rect — offset by margins
      if (isRow) {
        m.child.rect.x = axisPos + m.mgnMainStart;
        m.child.rect.y = crossPos + m.mgnCrossStart;
        m.child.rect.w = m.axis;
        m.child.rect.h = m.cross;
      } else {
        m.child.rect.x = crossPos + m.mgnCrossStart;
        m.child.rect.y = axisPos + m.mgnMainStart;
        m.child.rect.w = m.cross;
        m.child.rect.h = m.axis;
      }

      // Recurse
      m.child.layoutChildren();

      axisPos += m.axisWithMargin + effectiveGap;
    }
  }

  _childAlign(child) {
    const crossKey = this.direction === 'row' ? 'alignSelfV' : 'alignSelfH';
    let align = child[crossKey];
    if (!align) {
      align = this.alignItems;
    }
    // Normalize direction-agnostic aliases
    if (align === 'top' || align === 'left') align = 'start';
    if (align === 'bottom' || align === 'right') align = 'end';
    return align || 'start';
  }

  // ── render ───────────────────────────────────────────

  renderSelf(ctx) {
    if (this.background) {
      this._drawBackground(ctx);
    }

    if (this.borderColor && this.borderWidth > 0) {
      this._drawBorder(ctx);
    }
  }

  _drawBackground(ctx) {
    const r = this.rect;
    const cr = this.cornerRadius;

    ctx.save();
    ctx.fillStyle = this.background;

    if (cr > 0) {
      this._roundRect(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.fill();
    } else {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  _drawBorder(ctx) {
    const r = this.rect;
    const cr = this.cornerRadius;

    ctx.save();
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;

    if (cr > 0) {
      this._roundRect(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.stroke();
    } else {
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ── style helpers ────────────────────────────────────

  setStyle(props) {
    super.setStyle(props);
    if (props.background !== undefined) this.background = props.background;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.borderWidth !== undefined) this.borderWidth = props.borderWidth;
    if (props.cornerRadius !== undefined) this.cornerRadius = props.cornerRadius;
    if (props.direction !== undefined) this.direction = props.direction;
    if (props.gap !== undefined) this.gap = props.gap;
    if (props.justifyContent !== undefined) this.justifyContent = props.justifyContent;
    if (props.alignItems !== undefined) this.alignItems = props.alignItems;
  }
}
