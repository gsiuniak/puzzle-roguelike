import Tooltip from '../ui/Tooltip.js';
import { buildTooltipChain } from './keywordParser.js';

/**
 * TooltipManager — reusable tooltip system attachable to any UI element.
 *
 * Responsibilities:
 *   - Track (element, options) attachments.
 *   - Resolve hover/touch-hold input into "show this tooltip" decisions.
 *   - Position the tooltip away from the parent toward screen center,
 *     clamped inside the design viewport with a small edge margin.
 *   - Render a single Tooltip instance above other UI.
 *
 * Lifecycle:
 *   const tm = new TooltipManager({ input, app, assetManager });
 *   tm.attach(element, { text: 'Hello' });
 *   // wire input events from the owning scene
 *   input.on('mousemove', (x, y) => tm.onMouseMove(x, y));
 *   input.on('mousedown', (x, y) => tm.onMouseDown(x, y));
 *   input.on('mouseup',   (x, y) => tm.onMouseUp(x, y));
 *   // in update / render:
 *   tm.update(dt);
 *   tm.render(ctx);
 *   // on scene exit:
 *   tm.clear();
 *
 * Input semantics:
 *   - Desktop hover: mousemove with input.mouseDown === false → show on enter,
 *     hide on leave.
 *   - Touch hold: mousedown begins a hold timer for the element under the
 *     pointer. Movement beyond TOOLTIP_TOUCH_MOVE_CANCEL_PX cancels the hold
 *     so swipes/drags aren't blocked. After TOOLTIP_TOUCH_HOLD_MS, the
 *     tooltip is shown; mouseup hides it.
 *
 * The manager distinguishes touch from mouse by reading `input.mouseDown` —
 * the InputManager sets this BEFORE firing mousemove on touchstart, so
 * touch-driven moves always look "pressed" to the hover path and are
 * skipped, while the hold timer takes over.
 *
 * Enable/disable:
 *   setEnabled(false) hides any active tooltip and suppresses new shows
 *   until re-enabled. Useful when a modal overlay (e.g. reward screen) is
 *   active and tooltips would render on top of it inappropriately.
 */

export const TOOLTIP_TOUCH_HOLD_MS = 100;
const TOOLTIP_EDGE_MARGIN          = 12;
const TOOLTIP_DEFAULT_OFFSET       = 150;

// ── Keyword tooltip chaining ──────────────────────────────
// When a tooltip's text contains [[Keyword]] markup, child tooltips for each
// keyword are spawned automatically, each positioned relative to the PREVIOUS
// tooltip in the chain (parent → first keyword → next keyword …). This grows a
// readable chain toward the screen center and is clamped to the viewport.
/** Gap (design px) between one tooltip panel and the next in a chain. */
export const KEYWORD_TOOLTIP_CHAIN_GAP = 20;
/** Maximum number of child keyword tooltips in a single chain. */
export const MAX_TOOLTIP_CHAIN_DEPTH = 3;
// Movement (in design-space px) that cancels a pending touch-hold.
// Real touchscreens emit jitter even on a "stationary" finger: at a typical
// phone landscape scale (~0.4×), 10 design-px is only ~4 CSS px, which the
// finger can wobble through from capacitive noise alone — so the old 10
// cancelled holds before the 350ms timer fired on actual devices (browser
// touch emulators don't reproduce the jitter, which is why it appeared to
// work in DevTools). 30 design-px ≈ 12 CSS px on a phone, well clear of
// jitter but still tighter than the board-swap threshold (~36 design-px)
// so an intentional swipe still beats it.
const TOOLTIP_TOUCH_MOVE_CANCEL_PX = 50;

export default class TooltipManager {
  /**
   * @param {object} opts
   * @param {import('../engine/InputManager.js').default} opts.input
   * @param {import('../engine/CanvasApp.js').default} opts.app
   * @param {import('../engine/AssetManager.js').default} opts.assetManager
   */
  constructor({ input, app, assetManager } = {}) {
    this._input = input;
    this._app = app;
    this._assetManager = assetManager;

    this._tooltip = new Tooltip({ assetManager });

    // ── Keyword tooltip chain ──
    /** Reusable Tooltip instances for chained keyword tooltips. */
    this._chainPool = [];
    /** Active chain links for the current attachment (subset of the pool). */
    /** @type {Array<{ tooltip: Tooltip }>} */
    this._chain = [];
    /** Attachment the current chain was built for (rebuild when it changes). */
    this._chainBuiltFor = null;
    this._chainEnabled = true;
    this._chainGap = KEYWORD_TOOLTIP_CHAIN_GAP;
    this._maxChainDepth = MAX_TOOLTIP_CHAIN_DEPTH;

    /** @type {Array<{ element: import('../ui/UIElement.js').default, options: object }>} */
    this._attachments = [];

    // Currently-shown attachment (any source); null = nothing visible.
    /** @type {{ element, options }|null} */
    this._activeAttachment = null;

    // Hover state (mouse-only path)
    this._hoverElement = null;

    // Touch-hold state
    this._touchHoldAttachment = null;
    this._touchHoldTimer = 0;
    this._touchHoldShown = false;
    this._touchStartX = 0;
    this._touchStartY = 0;

    this._enabled = true;
  }

  // ── Public API ────────────────────────────────────────

  /**
   * Attach a tooltip to a UI element. Idempotent for the same element —
   * a second call updates the options. Element's `.rect` must be kept up
   * to date by the layout system (any UIElement child is fine).
   * @param {import('../ui/UIElement.js').default} element
   * @param {object} options — see Tooltip.setOptions
   */
  attach(element, options = {}) {
    if (!element) return;
    const idx = this._attachments.findIndex(a => a.element === element);
    if (idx !== -1) {
      this._attachments[idx].options = options;
      if (this._activeAttachment && this._activeAttachment.element === element) {
        this._activeAttachment.options = options;
        this._tooltip.setOptions(options);
        this._chainBuiltFor = null; // options changed → rebuild chain on next render
      }
    } else {
      this._attachments.push({ element, options });
    }
  }

  /** Detach a single element. */
  detach(element) {
    const idx = this._attachments.findIndex(a => a.element === element);
    if (idx !== -1) this._attachments.splice(idx, 1);

    if (this._hoverElement === element) this._hoverElement = null;
    if (this._touchHoldAttachment && this._touchHoldAttachment.element === element) {
      this._cancelTouchHold();
    }
    if (this._activeAttachment && this._activeAttachment.element === element) {
      this._hide();
    }
  }

  /** Remove all attachments and hide any visible tooltip. */
  clear() {
    this._attachments.length = 0;
    this._hoverElement = null;
    this._cancelTouchHold();
    this._hide();
  }

  /**
   * Enable / disable the manager. When disabled, any active tooltip hides
   * and onMouseMove/Down/Up become no-ops.
   * @param {boolean} v
   */
  setEnabled(v) {
    this._enabled = !!v;
    if (!this._enabled) {
      this._hoverElement = null;
      this._cancelTouchHold();
      this._hide();
    }
  }

  /** True while a tooltip is visible. */
  isVisible() {
    return this._activeAttachment !== null;
  }

  // ── Input plumbing ────────────────────────────────────

  onMouseMove(x, y) {
    if (!this._enabled) return;
    const pressed = this._input ? !!this._input.mouseDown : false;

    if (pressed) {
      // Pressed = touch drag or held mouse button. Movement beyond the
      // threshold cancels any pending/active touch-hold so the user can
      // still swipe/drag normally.
      if (this._touchHoldAttachment) {
        const dx = x - this._touchStartX;
        const dy = y - this._touchStartY;
        if ((dx * dx + dy * dy) > TOOLTIP_TOUCH_MOVE_CANCEL_PX * TOOLTIP_TOUCH_MOVE_CANCEL_PX) {
          const wasShown = this._touchHoldShown;
          this._cancelTouchHold();
          if (wasShown) this._hide();
        }
      }
      return;
    }

    // Desktop hover path
    const att = this._findAttachmentAt(x, y);
    const el = att ? att.element : null;
    if (el !== this._hoverElement) {
      this._hoverElement = el;
      if (att) this._show(att);
      else this._hide();
    }
  }

  onMouseDown(x, y) {
    if (!this._enabled) return;
    const att = this._findAttachmentAt(x, y);
    if (att) {
      this._touchHoldAttachment = att;
      this._touchHoldTimer = 0;
      this._touchHoldShown = false;
      this._touchStartX = x;
      this._touchStartY = y;
    } else {
      this._cancelTouchHold();
    }
  }

  onMouseUp(_x, _y) {
    if (!this._enabled) return;
    if (this._touchHoldShown) this._hide();
    this._cancelTouchHold();
  }

  // ── Tick ──────────────────────────────────────────────

  update(dt) {
    if (!this._enabled) return;
    if (this._touchHoldAttachment && !this._touchHoldShown) {
      this._touchHoldTimer += dt;
      if (this._touchHoldTimer >= TOOLTIP_TOUCH_HOLD_MS) {
        this._touchHoldShown = true;
        this._show(this._touchHoldAttachment);
      }
    }
  }

  // ── Render ────────────────────────────────────────────

  render(ctx) {
    if (!this._enabled) return;
    if (!this._activeAttachment) return;

    // Rebuild the keyword chain if the active attachment / its options changed.
    if (this._chainBuiltFor !== this._activeAttachment) {
      this._buildChain(this._activeAttachment);
      this._chainBuiltFor = this._activeAttachment;
    }

    // Re-position every frame so the tooltip tracks any layout updates
    // (e.g. an element shifting after a relic is added). The parent is placed
    // relative to its source element; each chain link is placed relative to the
    // previous tooltip panel, growing the chain toward the screen center.
    const opts = this._activeAttachment.options || {};
    let prevRect = this._positionTooltip(this._tooltip, this._activeAttachment.element.rect, opts);
    this._tooltip.render(ctx);

    for (const link of this._chain) {
      prevRect = this._positionTooltip(link.tooltip, prevRect, { offset: this._chainGap });
      link.tooltip.render(ctx);
    }
  }

  /** Enable/disable automatic keyword tooltip chaining. */
  setKeywordChainEnabled(v) {
    this._chainEnabled = !!v;
    this._chainBuiltFor = null;
  }

  // ── Internals ─────────────────────────────────────────

  _show(attachment) {
    if (!attachment) return;
    this._activeAttachment = attachment;
    this._tooltip.setOptions(attachment.options || {});
    this._buildChain(attachment);
    this._chainBuiltFor = attachment;
    this._repositionFor(attachment);
  }

  _hide() {
    this._activeAttachment = null;
    // Children are rendered only while a parent is active, so clearing the
    // active attachment here also hides the whole chain.
    this._chain.length = 0;
    this._chainBuiltFor = null;
  }

  /**
   * Build the chain of child keyword tooltips for an attachment by scanning its
   * title + body text for [[Keyword]] markup. Reuses pooled Tooltip instances.
   * No-op (empty chain) when chaining is disabled, the attachment opts out
   * (`options.keywordChain === false`), or no keywords are found.
   */
  _buildChain(attachment) {
    this._chain.length = 0;
    if (!this._chainEnabled) return;
    const opts = attachment.options || {};
    if (opts.keywordChain === false) return;

    const rootText = `${opts.title || ''} ${opts.text || ''}`;
    const maxDepth = opts.maxChainDepth != null ? opts.maxChainDepth : this._maxChainDepth;
    const links = buildTooltipChain(rootText, maxDepth);

    for (let i = 0; i < links.length; i++) {
      const def = links[i];
      const tt = this._acquireChainTooltip(i);
      tt.setOptions({
        title: def.label,
        titleColor: def.color,
        text: def.description || '',
        scale: opts.scale,
        width: opts.width,
        padding: opts.padding,
      });
      this._chain.push({ tooltip: tt });
    }
  }

  /** Lazily create / reuse a pooled Tooltip for chain index `i`. */
  _acquireChainTooltip(i) {
    if (!this._chainPool[i]) {
      this._chainPool[i] = new Tooltip({ assetManager: this._assetManager });
    }
    return this._chainPool[i];
  }

  _cancelTouchHold() {
    this._touchHoldAttachment = null;
    this._touchHoldTimer = 0;
    this._touchHoldShown = false;
  }

  /**
   * Iterate attachments in reverse (latest-attached wins) and return the
   * one whose element rect (optionally inflated by `options.hitPadding`)
   * contains (x, y). `hitPadding` is in design-space px and applied to all
   * four sides; useful for making small icons easier to hit on touch
   * without changing their visual size.
   * @returns {{element, options}|null}
   */
  _findAttachmentAt(x, y) {
    for (let i = this._attachments.length - 1; i >= 0; i--) {
      const att = this._attachments[i];
      const el = att.element;
      if (!el || !el.visible) continue;
      const r = el.rect;
      if (!r) continue;
      const pad = (att.options && att.options.hitPadding) || 0;
      if (x >= r.x - pad && x <= r.x + r.w + pad &&
          y >= r.y - pad && y <= r.y + r.h + pad) {
        return att;
      }
    }
    return null;
  }

  /** Position the parent tooltip relative to its source element. */
  _repositionFor(attachment) {
    const el = attachment.element;
    if (!el || !el.rect) return;
    this._positionTooltip(this._tooltip, el.rect, attachment.options || {});
  }

  /**
   * Place a tooltip away from `sourceRect` toward screen center, clamped inside
   * the design viewport. Shared by the parent (source = element rect) and each
   * chain link (source = previous tooltip's rect). Returns the placed rect so
   * the next link can chain off it.
   *
   * Strategy:
   *   1. Prefer horizontal placement on the side opposite the source relative
   *      to center (source on left → tooltip right; vice versa).
   *   2. If that would clip the edge, fall back to vertical placement
   *      (above/below, toward center), centered horizontally on the source.
   *   3. Final clamp keeps the tooltip inside [edgeMargin, viewport-edgeMargin].
   * @param {Tooltip} tooltip
   * @param {{x:number,y:number,w:number,h:number}} sourceRect
   * @param {object} opts — { offset?, edgeMargin? }
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  _positionTooltip(tooltip, sourceRect, opts = {}) {
    const offset = opts.offset != null ? opts.offset : TOOLTIP_DEFAULT_OFFSET;
    const margin = opts.edgeMargin != null ? opts.edgeMargin : TOOLTIP_EDGE_MARGIN;

    const designW = this._app ? this._app.width : 1920;
    const designH = this._app ? this._app.height : 1080;
    const { width: tw, height: th } = tooltip.getSize();

    const r = sourceRect;
    const pcx = r.x + r.w / 2;
    const pcy = r.y + r.h / 2;
    const cx = designW / 2;
    const cy = designH / 2;

    let tx;
    let ty;
    let placed = false;

    if (pcx < cx) {
      // Parent on left → tooltip on its right.
      tx = r.x + r.w + offset;
      ty = pcy - th / 2;
      if (tx + tw <= designW - margin) placed = true;
    } else {
      // Parent on right → tooltip on its left.
      tx = r.x - offset - tw;
      ty = pcy - th / 2;
      if (tx >= margin) placed = true;
    }

    if (!placed) {
      // Fall back to vertical placement on the side closer to center.
      tx = pcx - tw / 2;
      if (pcy < cy) {
        ty = r.y + r.h + offset;
      } else {
        ty = r.y - offset - th;
      }
    }

    // Final clamp inside viewport.
    tx = Math.max(margin, Math.min(designW - tw - margin, tx));
    ty = Math.max(margin, Math.min(designH - th - margin, ty));

    tooltip.setPosition(tx, ty);
    return { x: tx, y: ty, w: tw, h: th };
  }
}
