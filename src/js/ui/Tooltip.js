import UIText from './UIText.js';
import KeywordText from './KeywordText.js';

/**
 * Tooltip — visual component that draws a single floating tooltip panel
 * (background image + optional bold title + centered, word-wrapped body text).
 *
 * Owned and driven by TooltipManager; not added to the UI tree as a child.
 * The manager calls setOptions() / setPosition() / render(ctx) directly.
 *
 * Aspect ratio:
 *   The panel always preserves the background image's native aspect ratio.
 *   Only the `width` (or `scale` multiplier) is configurable; the height
 *   is derived as width / aspect, so the art never stretches.
 *
 * Layout:
 *   - If `title` is set, it's rendered immediately above the body text and
 *     the combined (title + gap + body) stack is vertically centered inside
 *     the padded inner area.
 *   - If `title` is empty, the body text fills the entire inner area
 *     (centered, as before).
 *
 * Options (passed via setOptions):
 *   text           — body string (may contain '\n' for hard line breaks)
 *   title          — optional title string drawn at the top, bold by default
 *   scale          — multiplier applied to TOOLTIP_DEFAULT_WIDTH (default 1)
 *   width          — explicit pixel width; overrides scale when set
 *   padding        — internal padding between panel edge and text (default 24)
 *   fontSize       — body text size in px (default 18)
 *   lineHeight     — explicit body line height in px (default fontSize * 1.25)
 *   color          — body text color (default '#f5e7c8')
 *   titleFontSize  — title text size in px (default 24)
 *   titleColor     — title text color (default '#f5e7c8')
 *   titleBold      — render title bold (default true)
 *   titleGap       — gap between title and body in px (default 8)
 *   autoSize       — when true, the panel WIDTH grows (from the default/given
 *                    width up to AUTO_SIZE_MAX_WIDTH) until the title + body
 *                    fit the aspect-derived height. Used by the skill-button
 *                    "?" tooltips so a long skill description fits without
 *                    every other tooltip sharing the bigger size.
 */

const DEFAULT_BG_KEY    = 'tooltip_panel';
const TOOLTIP_DEFAULT_WIDTH           = 320;
const TOOLTIP_DEFAULT_PADDING         = 24;
const TOOLTIP_DEFAULT_FONT_SIZE       = 20;
const TOOLTIP_DEFAULT_COLOR           = '#f5e7c8';
const TOOLTIP_DEFAULT_TITLE_FONT_SIZE = 26;
const TOOLTIP_DEFAULT_TITLE_COLOR     = '#ccaa77';
const TOOLTIP_DEFAULT_TITLE_GAP       = 8;
const FALLBACK_ASPECT_RATIO           = 2.5;
/** Widest a panel may auto-grow (autoSize mode). */
const AUTO_SIZE_MAX_WIDTH             = 620;

// Shared offscreen ctx for text measurement outside render (autoSize).
let _measureCtx = null;
function getMeasureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

export default class Tooltip {
  /**
   * @param {object} opts
   * @param {import('../engine/AssetManager.js').default} opts.assetManager
   * @param {string} [opts.bgAssetKey='tooltip_panel']
   */
  constructor({ assetManager = null, bgAssetKey = DEFAULT_BG_KEY } = {}) {
    this._assetManager = assetManager;
    this._bgAssetKey = bgAssetKey;

    this._text = '';
    this._title = '';
    this._scale = 1;
    this._explicitWidth = null;
    this._padding = TOOLTIP_DEFAULT_PADDING;
    this._fontSize = TOOLTIP_DEFAULT_FONT_SIZE;
    this._lineHeight = null;
    this._titleGap = TOOLTIP_DEFAULT_TITLE_GAP;

    // Body is a KeywordText so inline [[Keyword]] markup renders as colored,
    // bracket-free spans. With no markup it behaves like a plain centered label.
    this._textElement = new KeywordText('');
    this._textElement.setStyle({
      fontSize: this._fontSize,
      color: TOOLTIP_DEFAULT_COLOR,
      alignH: 'center',
      alignV: 'center',
    });

    this._titleElement = new UIText('');
    this._titleElement.setStyle({
      fontSize: TOOLTIP_DEFAULT_TITLE_FONT_SIZE,
      color: TOOLTIP_DEFAULT_TITLE_COLOR,
      alignH: 'center',
      alignV: 'top',
      bold: true,
    });

    // Auto-grow width to fit content (skill tooltips). Per-show; reset by
    // resetStyleDefaults.
    this._autoSize = false;

    this._x = 0;
    this._y = 0;
    this._cachedSize = null;
  }

  setAssetManager(am) {
    this._assetManager = am;
    this._cachedSize = null;
  }

  /**
   * Configure the tooltip from an options object. Unknown keys are ignored.
   * Changing any size-affecting key invalidates the cached size.
   * @param {object} opts
   */
  setOptions(opts = {}) {
    if (opts.text !== undefined) {
      this._text = opts.text == null ? '' : String(opts.text);
      this._textElement.setStyle({ text: this._text });
      this._cachedSize = null;
    }
    if (opts.title !== undefined) {
      this._title = opts.title == null ? '' : String(opts.title);
      this._titleElement.setStyle({ text: this._title });
      this._cachedSize = null;
    }
    if (opts.scale !== undefined) {
      this._scale = opts.scale;
      this._cachedSize = null;
    }
    if (opts.width !== undefined) {
      this._explicitWidth = opts.width;
      this._cachedSize = null;
    }
    if (opts.padding !== undefined) {
      this._padding = opts.padding;
      this._cachedSize = null;
    }
    if (opts.fontSize !== undefined) {
      this._fontSize = opts.fontSize;
      this._textElement.setStyle({ fontSize: this._fontSize });
      this._cachedSize = null;
    }
    if (opts.lineHeight !== undefined) {
      this._lineHeight = opts.lineHeight;
      this._textElement.setStyle({ lineHeight: this._lineHeight });
      this._cachedSize = null;
    }
    if (opts.color !== undefined) {
      this._textElement.setStyle({ color: opts.color });
    }
    if (opts.titleFontSize !== undefined) {
      this._titleElement.setStyle({ fontSize: opts.titleFontSize });
      this._cachedSize = null;
    }
    if (opts.titleColor !== undefined) {
      this._titleElement.setStyle({ color: opts.titleColor });
    }
    if (opts.titleBold !== undefined) {
      this._titleElement.setStyle({ bold: !!opts.titleBold });
      this._cachedSize = null;
    }
    if (opts.titleGap !== undefined) {
      this._titleGap = opts.titleGap;
      this._cachedSize = null;
    }
    if (opts.autoSize !== undefined) {
      this._autoSize = !!opts.autoSize;
      this._cachedSize = null;
    }
  }

  /**
   * Reset ALL per-show options to their defaults.
   *
   * This Tooltip instance is reused for many different sources (relic
   * descriptions, hovered-keyword definitions, skill-button "?" tooltips).
   * Since setOptions() does PARTIAL updates, anything one source sets
   * (colors, but also width/scale/padding/fontSize/autoSize) would otherwise
   * bleed into the next source that omits it — a skill tooltip's big width
   * must not turn every relic tooltip huge. TooltipManager calls this before
   * applying a new source's options so each show starts from a clean baseline.
   */
  resetStyleDefaults() {
    this._scale = 1;
    this._explicitWidth = null;
    this._padding = TOOLTIP_DEFAULT_PADDING;
    this._fontSize = TOOLTIP_DEFAULT_FONT_SIZE;
    this._lineHeight = null;
    this._titleGap = TOOLTIP_DEFAULT_TITLE_GAP;
    this._autoSize = false;
    this._textElement.setStyle({
      color: TOOLTIP_DEFAULT_COLOR,
      fontSize: TOOLTIP_DEFAULT_FONT_SIZE,
      lineHeight: null,
    });
    this._titleElement.setStyle({
      color: TOOLTIP_DEFAULT_TITLE_COLOR,
      fontSize: TOOLTIP_DEFAULT_TITLE_FONT_SIZE,
      bold: true,
    });
    this._cachedSize = null;
  }

  setPosition(x, y) {
    this._x = x;
    this._y = y;
  }

  /**
   * Compute outer panel size. Width is taken from explicit override or
   * (default × scale); height is derived from the background image's
   * native aspect ratio so the art is never stretched.
   * @returns {{width:number, height:number}}
   */
  getSize() {
    if (this._cachedSize) return this._cachedSize;
    const img = this._assetManager ? this._assetManager.get(this._bgAssetKey) : null;
    const aspect = (img && img.width && img.height)
      ? img.width / img.height
      : FALLBACK_ASPECT_RATIO;
    let width = this._explicitWidth != null
      ? this._explicitWidth
      : TOOLTIP_DEFAULT_WIDTH * this._scale;
    if (this._autoSize) width = this._computeAutoWidth(width, aspect);
    const height = width / aspect;
    this._cachedSize = { width, height };
    return this._cachedSize;
  }

  /**
   * autoSize: smallest width ≥ `minWidth` (capped at AUTO_SIZE_MAX_WIDTH)
   * whose aspect-derived height fits the title + gap + wrapped body. Widening
   * also widens the wrap, so the loop converges in a couple of iterations.
   */
  _computeAutoWidth(minWidth, aspect) {
    const ctx = getMeasureCtx();
    let width = minWidth;
    for (let i = 0; i < 5; i++) {
      const innerW = Math.max(1, width - this._padding * 2);
      this._titleElement.setStyle({ maxWidth: innerW });
      this._textElement.setStyle({ maxWidth: innerW });
      const titleH = this._title ? this._titleElement.measureText(ctx).height : 0;
      const bodyH = this._text ? this._textElement.measureText(ctx).height : 0;
      const gap = this._title && this._text ? this._titleGap : 0;
      const neededH = this._padding * 2 + titleH + gap + bodyH;
      const neededW = neededH * aspect;
      if (neededW <= width + 0.5 || width >= AUTO_SIZE_MAX_WIDTH) break;
      width = Math.min(AUTO_SIZE_MAX_WIDTH, Math.ceil(neededW));
    }
    return width;
  }

  /** Render at the configured position. */
  render(ctx) {
    if (!this._text && !this._title) return;

    const { width, height } = this.getSize();
    const x = Math.round(this._x);
    const y = Math.round(this._y);
    const w = Math.ceil(width);
    const h = Math.ceil(height);

    const img = this._assetManager ? this._assetManager.get(this._bgAssetKey) : null;
    if (img) {
      ctx.save();
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x, y, w, h);
      ctx.imageSmoothingEnabled = prev;
      ctx.restore();
    } else {
      // Fallback panel — used only if the bg asset failed to load.
      ctx.save();
      ctx.fillStyle = 'rgba(20,20,28,0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.restore();
    }

    const padding = this._padding;
    const innerW = Math.max(1, width - padding * 2);
    const innerH = Math.max(1, height - padding * 2);

    let bodyY = y + padding;
    let bodyH = innerH;

    if (this._title) {
      // Stack title + gap + body and vertically center the whole block
      // inside the padded inner area. Body is measured at its natural
      // wrapped height; if the combined stack exceeds innerH, the body
      // is clamped (UIText clips overflow inside its rect).
      this._titleElement.setStyle({ maxWidth: innerW });
      this._textElement.setStyle({ maxWidth: innerW });

      const titleMeasure = this._titleElement.measureText(ctx);
      const titleH = Math.min(titleMeasure.height, innerH);

      const bodyMeasure = this._text ? this._textElement.measureText(ctx) : { height: 0 };
      const gap = this._text ? this._titleGap : 0;
      const naturalBodyH = bodyMeasure.height;

      const remaining = Math.max(0, innerH - titleH - gap);
      const measuredBodyH = Math.min(naturalBodyH, remaining);
      const stackH = titleH + gap + measuredBodyH;
      const stackTop = y + padding + Math.max(0, (innerH - stackH) / 2);

      this._titleElement.rect.x = x + padding;
      this._titleElement.rect.y = stackTop;
      this._titleElement.rect.w = innerW;
      this._titleElement.rect.h = titleH;
      this._titleElement.renderSelf(ctx);

      bodyY = stackTop + titleH + gap;
      bodyH = Math.max(1, measuredBodyH);
    }

    if (this._text) {
      this._textElement.setStyle({ maxWidth: innerW, alignV: this._title ? 'top' : 'center' });
      this._textElement.rect.x = x + padding;
      this._textElement.rect.y = bodyY;
      this._textElement.rect.w = innerW;
      this._textElement.rect.h = bodyH;
      this._textElement.renderSelf(ctx);
    }
  }
}
