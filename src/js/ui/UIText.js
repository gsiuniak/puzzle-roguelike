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
 *   maxWidth      - optional clip width (0 = none)
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
    this.maxWidth = 0; // 0 = unconstrained
    /** Subtle dark shadow on all text by default */
    this.shadowColor = 'rgba(0,0,0,0.65)';
    this.shadowBlur = 2;
    this.shadowOffsetX = 1;
    this.shadowOffsetY = 1;
  }

  /** Build CSS font string */
  getFontString() {
    const style = this.italic ? 'italic ' : '';
    const weight = this.bold ? 'bold ' : '';
    return `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
  }

  /** Measure the text dimensions */
  measureText(ctx) {
    ctx.font = this.getFontString();
    const metrics = ctx.measureText(this.text);
    return {
      width: metrics.width,
      height: this.fontSize, // approximate
      ascent: metrics.actualBoundingBoxAscent || this.fontSize * 0.8,
    };
  }

  renderSelf(ctx) {
    const r = this.rect;
    const text = this.text;
    if (!text) return;

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

    // Measure
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = this.fontSize;

    // Horizontal position
    let tx;
    switch (this.alignH) {
      case 'center': tx = r.x + r.w / 2; break;
      case 'right':  tx = r.x + r.w; break;
      default:       tx = r.x; break;
    }

    // Vertical position
    let ty;
    switch (this.alignV) {
      case 'top':    ty = r.y + textHeight / 2; break;
      case 'bottom': ty = r.y + r.h - textHeight / 2; break;
      default:       ty = r.y + r.h / 2; break;
    }

    // Clip if maxWidth set
    if (this.maxWidth > 0 && textWidth > this.maxWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, this.maxWidth, r.h);
      ctx.clip();
    }

    ctx.fillText(text, tx, ty);

    if (this.maxWidth > 0 && textWidth > this.maxWidth) {
      ctx.restore();
    }

    ctx.restore();
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.text !== undefined) this.text = props.text;
    if (props.fontSize !== undefined) this.fontSize = props.fontSize;
    if (props.fontFamily !== undefined) this.fontFamily = props.fontFamily;
    if (props.color !== undefined) this.color = props.color;
    if (props.bold !== undefined) this.bold = props.bold;
    if (props.italic !== undefined) this.italic = props.italic;
    if (props.alignH !== undefined) this.alignH = props.alignH;
    if (props.alignV !== undefined) this.alignV = props.alignV;
    if (props.maxWidth !== undefined) this.maxWidth = props.maxWidth;
    if (props.shadowColor !== undefined) this.shadowColor = props.shadowColor;
    if (props.shadowBlur !== undefined) this.shadowBlur = props.shadowBlur;
    if (props.shadowOffsetX !== undefined) this.shadowOffsetX = props.shadowOffsetX;
    if (props.shadowOffsetY !== undefined) this.shadowOffsetY = props.shadowOffsetY;
  }
}
