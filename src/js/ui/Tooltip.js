import UIText from './UIText.js';

/**
 * Tooltip — visual component that draws a single floating tooltip panel
 * (background image + centered, word-wrapped text).
 *
 * Owned and driven by TooltipManager; not added to the UI tree as a child.
 * The manager calls setOptions() / setPosition() / render(ctx) directly.
 *
 * Aspect ratio:
 *   The panel always preserves the background image's native aspect ratio.
 *   Only the `width` (or `scale` multiplier) is configurable; the height
 *   is derived as width / aspect, so the art never stretches.
 *
 * Options (passed via setOptions):
 *   text       — string content (may contain '\n' for hard line breaks)
 *   scale      — multiplier applied to TOOLTIP_DEFAULT_WIDTH (default 1)
 *   width      — explicit pixel width; overrides scale when set
 *   padding    — internal padding between panel edge and text (default 24)
 *   fontSize   — text size in px (default 18)
 *   lineHeight — explicit line height in px (default fontSize * 1.25)
 *   color      — text color (default '#f5e7c8')
 */

const DEFAULT_BG_KEY    = 'tooltip_panel';
const TOOLTIP_DEFAULT_WIDTH     = 320;
const TOOLTIP_DEFAULT_PADDING   = 24;
const TOOLTIP_DEFAULT_FONT_SIZE = 18;
const TOOLTIP_DEFAULT_COLOR     = '#f5e7c8';
const FALLBACK_ASPECT_RATIO     = 2.5;

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
    this._scale = 1;
    this._explicitWidth = null;
    this._padding = TOOLTIP_DEFAULT_PADDING;
    this._fontSize = TOOLTIP_DEFAULT_FONT_SIZE;
    this._lineHeight = null;

    this._textElement = new UIText('');
    this._textElement.setStyle({
      fontSize: this._fontSize,
      color: TOOLTIP_DEFAULT_COLOR,
      alignH: 'center',
      alignV: 'center',
    });

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
    const width = this._explicitWidth != null
      ? this._explicitWidth
      : TOOLTIP_DEFAULT_WIDTH * this._scale;
    const height = width / aspect;
    this._cachedSize = { width, height };
    return this._cachedSize;
  }

  /** Render at the configured position. */
  render(ctx) {
    if (!this._text) return;

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

    // Center the wrapped text inside the panel minus padding.
    const padding = this._padding;
    const innerW = Math.max(1, width - padding * 2);
    const innerH = Math.max(1, height - padding * 2);
    this._textElement.setStyle({ maxWidth: innerW });
    this._textElement.rect.x = x + padding;
    this._textElement.rect.y = y + padding;
    this._textElement.rect.w = innerW;
    this._textElement.rect.h = innerH;
    this._textElement.renderSelf(ctx);
  }
}
