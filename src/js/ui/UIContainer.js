import UIElement from './UIElement.js';

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
    // Allocation-free per-frame layout (perf review F8's sanctioned
    // intermediate step): placement semantics are IDENTICAL to the old code,
    // but there is no children.filter array, no getContentRect Rect, no
    // per-child measure/margin objects, and no reduce closures — this method
    // runs for every container every frame from SceneManager's layout pass.
    // Measure slots are pooled per instance (grow-only).
    const rect = this.rect;
    let pt, pr, pb, pl;
    const pad = this.padding;
    if (typeof pad === 'number') { pt = pr = pb = pl = pad; }
    else if (pad) { pt = pad.top || 0; pr = pad.right || 0; pb = pad.bottom || 0; pl = pad.left || 0; }
    else { pt = pr = pb = pl = 0; }
    const contentX = rect.x + pl;
    const contentY = rect.y + pt;
    const contentW = rect.w - pl - pr;
    const contentH = rect.h - pt - pb;

    const isRow = this.direction === 'row';
    const children = this.children;
    const measures = this._layoutMeasures || (this._layoutMeasures = []);

    const axisSize = isRow ? contentW : contentH;    // main axis
    const crossSize = isRow ? contentH : contentW;    // cross axis

    // --- First pass: measure each visible child ---
    let count = 0;
    let totalFixedAxis = 0;
    let totalFlexGrow = 0;

    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];
      if (!child.visible) continue;

      let axis = 0;
      let cross = crossSize; // default to full cross size
      let flexGrow = child.flexGrow || 0;

      // Resolve child margin into locals (no object)
      let mt, mr, mb, ml;
      const mg = child.margin;
      if (typeof mg === 'number') { mt = mr = mb = ml = mg; }
      else if (mg) { mt = mg.top || 0; mr = mg.right || 0; mb = mg.bottom || 0; ml = mg.left || 0; }
      else { mt = mr = mb = ml = 0; }
      const mgnMainStart = isRow ? ml : mt;
      const mgnMainEnd   = isRow ? mr : mb;
      const mgnCrossStart = isRow ? mt : ml;
      const mgnCrossEnd   = isRow ? mb : mr;

      // --- Axis sizing (main direction) ---
      if (isRow) {
        if (child.widthPercent !== null && child.widthPercent !== undefined) {
          axis = contentW * child.widthPercent;
        } else if (child.width !== null && child.width !== undefined) {
          axis = child.width;
        } else {
          flexGrow = Math.max(flexGrow, 1); // auto → flex
        }
      } else {
        if (child.heightPercent !== null && child.heightPercent !== undefined) {
          axis = contentH * child.heightPercent;
        } else if (child.height !== null && child.height !== undefined) {
          axis = child.height;
        } else {
          flexGrow = Math.max(flexGrow, 1); // auto → flex
        }
      }

      // --- Cross sizing (perpendicular direction) ---
      if (isRow) {
        if (child.heightPercent !== null && child.heightPercent !== undefined) {
          cross = contentH * child.heightPercent;
        } else if (child.height !== null && child.height !== undefined) {
          cross = child.height;
        } else {
          // stretch: full cross minus cross margins
          cross = crossSize - mgnCrossStart - mgnCrossEnd;
        }
      } else {
        if (child.widthPercent !== null && child.widthPercent !== undefined) {
          cross = contentW * child.widthPercent;
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

      const m = measures[count] || (measures[count] = {
        child: null, axis: 0, cross: 0, flexGrow: 0,
        mgnMainStart: 0, mgnMainEnd: 0, mgnCrossStart: 0, mgnCrossEnd: 0,
        axisWithMargin: 0,
      });
      m.child = child;
      m.axis = axis;
      m.cross = cross;
      m.flexGrow = flexGrow;
      m.mgnMainStart = mgnMainStart;
      m.mgnMainEnd = mgnMainEnd;
      m.mgnCrossStart = mgnCrossStart;
      m.mgnCrossEnd = mgnCrossEnd;
      m.axisWithMargin = axisWithMargin;
      count++;

      totalFlexGrow += flexGrow;
      if (flexGrow === 0) {
        totalFixedAxis += axisWithMargin;
      }
    }

    if (count === 0) return;

    const gap = this.gap;
    const totalGap = gap * (count - 1);

    // --- Distribute remaining space to flex children ---
    let remaining = axisSize - totalGap - totalFixedAxis;
    if (remaining < 0) remaining = 0;

    const flexUnit = totalFlexGrow > 0 ? remaining / totalFlexGrow : 0;

    let sumAxisWithMargin = 0;
    for (let i = 0; i < count; i++) {
      const m = measures[i];
      if (m.flexGrow > 0) {
        m.axis = Math.max(0, flexUnit * m.flexGrow);
        m.axisWithMargin = m.axis + m.mgnMainStart + m.mgnMainEnd;
      }
      sumAxisWithMargin += m.axisWithMargin;
    }

    // --- Compute total axis used (margin-boxes) ---
    const totalAxisUsed = sumAxisWithMargin + totalGap;

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
        if (count > 1) {
          effectiveGap = (axisSize - sumAxisWithMargin) / (count - 1);
        }
        break;
      case 'space-around': {
        const extra = (axisSize - sumAxisWithMargin) / count;
        effectiveGap = extra;       // gap between items
        startOffset = extra / 2;   // half-gap before first item
        break;
      }
      case 'space-evenly': {
        const extra = (axisSize - sumAxisWithMargin) / (count + 1);
        effectiveGap = extra;
        startOffset = extra;
        break;
      }
      case 'start':
      default:
        break;
    }

    // --- Place children ---
    let axisPos = (isRow ? contentX : contentY) + startOffset;
    const crossPosStart = isRow ? contentY : contentX;

    for (let i = 0; i < count; i++) {
      const m = measures[i];
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

    // Drop child references in unused pool slots so removed subtrees can GC.
    for (let i = count; i < measures.length; i++) measures[i].child = null;
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
