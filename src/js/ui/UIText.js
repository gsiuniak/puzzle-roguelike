import UIElement from './UIElement.js';

/**
 * UIText — renders a string from dynamic data.
 *
 * Properties:
 *   text          - string content
 *   fontSize      - number (default 16)
 *   fontFamily    - string (default 'serif')
 *   color         - CSS color (default 'white')
 *   bold          - boolean
 *   italic        - boolean
 *   alignH        - 'left' | 'center' | 'right' (default 'left')
 *   alignV        - 'top' | 'center' | 'bottom' (default 'center')
 *   maxWidth      - word-wrap width when > 0; 0 = unconstrained single line
 *   lineHeight    - explicit line spacing in px; null = auto (fontSize * 1.35)
 *   shadowColor   - CSS color for text shadow (default 'rgba(0,0,0,0.65)'; set null to disable)
 *   shadowBlur    - shadow blur radius (default 2)
 *   shadowOffsetX - shadow horizontal offset (default 1)
 *   shadowOffsetY - shadow vertical offset (default 1)
 */
export default class UIText extends UIElement {
  constructor(text = '') {
    super();
    this.text = text;
    this.fontSize = 16;
    this.fontFamily = '"Marcellus SC", Georgia, "Times New Roman", serif';
    this.color = '#ffffff';
    this.bold = false;
    this.italic = false;
    this.alignH = 'left';
    this.alignV = 'center';
    this.maxWidth = 0; // 0 = unconstrained single-line; > 0 = word-wrap at this width
    this.lineHeight = null; // null = auto (fontSize * 1.35)
    /** Subtle dark shadow on all text by default */
    this.shadowColor = 'rgba(0,0,0,0.65)';
    this.shadowBlur = 2;
    this.shadowOffsetX = 1;
    this.shadowOffsetY = 1;

    // Internal cache for wrapped lines
    this._wrappedLines = null;
    this._wrapCacheKey = null;
  }

  /** Effective line height */
  _getLineHeight() {
    return this.lineHeight != null ? this.lineHeight : this.fontSize * 1.35;
  }

  /** Build CSS font string */
  getFontString() {
    const style = this.italic ? 'italic ' : '';
    const weight = this.bold ? 'bold ' : '';
    return `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
  }

  /**
   * Build a cache key from properties that affect line-breaking,
   * so we can skip re-wrapping when nothing changed.
   */
  _getWrapCacheKey(ctx) {
    return `${this.text}|${this.getFontString()}|${this.maxWidth}`;
  }

  /**
   * Break text into an array of lines that each fit within maxWidth.
   * If maxWidth <= 0, returns the text as a single line.
   * Words longer than maxWidth are force-broken at the character level.
   * Preserves leading / trailing whitespace per line as Canvas would.
   * Requires a valid 2D context (ctx) for measurement.
   */
  _wrapText(ctx) {
    // Single-line / unconstrained path
    if (!this.maxWidth || this.maxWidth <= 0) {
      return this.text ? [this.text] : [];
    }

    ctx.font = this.getFontString();
    const maxW = this.maxWidth;
    const lines = [];

    // Split on newlines first, then wrap each segment
    const paragraphs = this.text.split('\n');
    for (const para of paragraphs) {
      if (para === '') {
        lines.push('');
        continue;
      }

      const words = para.split(' ');
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth <= maxW) {
          // Fits — add to current line
          currentLine = testLine;
        } else if (!currentLine) {
          // Single word is wider than maxWidth — force-break it character by character
          let partial = '';
          for (const ch of word) {
            const partialTest = partial + ch;
            if (ctx.measureText(partialTest).width <= maxW) {
              partial = partialTest;
            } else {
              if (partial) lines.push(partial);
              partial = ch;
            }
          }
          if (partial) currentLine = partial;
        } else {
          // Word doesn't fit on current line — push current and start new
          lines.push(currentLine);
          currentLine = word;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines;
  }

  /**
   * Get the wrapped lines for the current state, using cache.
   * Call this with a valid ctx during rendering or measurement.
   */
  _getWrappedLines(ctx) {
    const key = this._getWrapCacheKey(ctx);
    if (this._wrappedLines && this._wrapCacheKey === key) {
      return this._wrappedLines;
    }
    this._wrappedLines = this._wrapText(ctx);
    this._wrapCacheKey = key;
    return this._wrappedLines;
  }

  /** Invalidate the wrap cache (call when relevant properties change) */
  _invalidateWrapCache() {
    this._wrappedLines = null;
    this._wrapCacheKey = null;
  }

  /**
   * Measure the text dimensions, accounting for word-wrapping.
   * Returns { width, height, ascent, lineCount }.
   * Requires a valid 2D context for measurement.
   */
  measureText(ctx) {
    ctx.font = this.getFontString();
    const lines = this._getWrappedLines(ctx);
    const lineH = this._getLineHeight();
    let maxWidth = 0;

    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxWidth) maxWidth = w;
    }

    // Single-line metrics for ascent
    const singleMetrics = ctx.measureText('M');
    const ascent = singleMetrics.actualBoundingBoxAscent || this.fontSize * 0.8;

    return {
      width: maxWidth,
      height: lines.length > 0 ? (lines.length - 1) * lineH + this.fontSize : 0,
      ascent,
      lineCount: lines.length,
    };
  }

  renderSelf(ctx) {
    const r = this.rect;
    if (!this.text) return;

    ctx.save();

    const font = this.getFontString();
    ctx.font = font;
    ctx.fillStyle = this.color;
    ctx.textBaseline = 'middle';

    // Apply text shadow
    if (this.shadowColor) {
      ctx.shadowColor = this.shadowColor;
      ctx.shadowBlur = this.shadowBlur;
      ctx.shadowOffsetX = this.shadowOffsetX;
      ctx.shadowOffsetY = this.shadowOffsetY;
    }

    const lines = this._getWrappedLines(ctx);
    const lineH = this._getLineHeight();
    const lineCount = lines.length;
    if (lineCount === 0) {
      ctx.restore();
      return;
    }

    // Total block height of the wrapped text
    const blockHeight = (lineCount - 1) * lineH + this.fontSize;

    // Determine horizontal anchor point per alignment
    let getAnchorX;
    switch (this.alignH) {
      case 'center':
        getAnchorX = () => r.x + r.w / 2;
        ctx.textAlign = 'center';
        break;
      case 'right':
        getAnchorX = () => r.x + r.w;
        ctx.textAlign = 'right';
        break;
      default:
        getAnchorX = () => r.x;
        ctx.textAlign = 'left';
        break;
    }

    // Calculate the starting Y for the first line based on vertical alignment
    let startY;
    switch (this.alignV) {
      case 'top':
        startY = r.y + this.fontSize / 2;
        break;
      case 'bottom':
        startY = r.y + r.h - blockHeight + this.fontSize / 2;
        break;
      default: // center
        startY = r.y + (r.h - blockHeight) / 2 + this.fontSize / 2;
        break;
    }

    // Only clip in wrapping mode, and only when the text block exceeds the element bounds
    const needsClip = this.maxWidth > 0 && lineCount > 1 && blockHeight > r.h;
    if (needsClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }

    // Draw each line
    for (let i = 0; i < lineCount; i++) {
      const ty = startY + i * lineH;
      const tx = getAnchorX();
      ctx.fillText(lines[i], tx, ty);
    }

    if (needsClip) {
      ctx.restore();
    }

    ctx.restore();
  }

  setStyle(props) {
    super.setStyle(props);

    // Invalidate wrap cache when layout-affecting properties change
    let needsInvalidate = false;
    if (props.text !== undefined) { this.text = props.text; needsInvalidate = true; }
    if (props.fontSize !== undefined) { this.fontSize = props.fontSize; needsInvalidate = true; }
    if (props.fontFamily !== undefined) { this.fontFamily = props.fontFamily; needsInvalidate = true; }
    if (props.maxWidth !== undefined) { this.maxWidth = props.maxWidth; needsInvalidate = true; }

    if (props.color !== undefined) this.color = props.color;
    if (props.bold !== undefined) { this.bold = props.bold; needsInvalidate = true; }
    if (props.italic !== undefined) { this.italic = props.italic; needsInvalidate = true; }
    if (props.alignH !== undefined) this.alignH = props.alignH;
    if (props.alignV !== undefined) this.alignV = props.alignV;
    if (props.lineHeight !== undefined) { this.lineHeight = props.lineHeight; needsInvalidate = true; }
    if (props.shadowColor !== undefined) this.shadowColor = props.shadowColor;
    if (props.shadowBlur !== undefined) this.shadowBlur = props.shadowBlur;
    if (props.shadowOffsetX !== undefined) this.shadowOffsetX = props.shadowOffsetX;
    if (props.shadowOffsetY !== undefined) this.shadowOffsetY = props.shadowOffsetY;

    if (needsInvalidate) {
      this._invalidateWrapCache();
    }
  }
}
