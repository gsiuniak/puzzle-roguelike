import UIElement from './UIElement.js';

/**
 * UIProgressBar — horizontal bar with fill, background, and centered label.
 *
 * Properties:
 *   value           - current value (number)
 *   maxValue        - max value (number)
 *   fillColor       - CSS color for filled portion
 *   backgroundColor - CSS color for unfilled portion
 *   label           - string displayed centered in bar
 *   labelColor      - CSS color for label text
 *   labelFontSize   - number (default 18)
 *   borderColor     - CSS color for border
 *   borderWidth     - number (default 1)
 *   cornerRadius    - number (default 4)
 *   shadowColor     - CSS color for label shadow (default 'rgba(0,0,0,0.65)'; set null to disable)
 *   shadowBlur      - shadow blur radius (default 2)
 *   shadowOffsetX   - shadow horizontal offset (default 1)
 *   shadowOffsetY   - shadow vertical offset (default 1)
 */
export default class UIProgressBar extends UIElement {
  constructor() {
    super();
    this.value = 0;
    this.maxValue = 100;
    this.fillColor = '#cc3333';
    this.backgroundColor = '#222222';
    /**
     * Armor overlay (semi-transparent blue) drawn OVER the fill, hugging the
     * right edge of current health: it first fills the empty-health region
     * (forward), then — if armor exceeds the missing health — extends BACKWARD
     * over the red fill as a translucent overlay (so the padded "effective HP"
     * reads on a fixed-width bar). Visible width is capped at the full bar; the
     * exact number is shown elsewhere. 0 = no overlay.
     */
    this.armorValue = 0;
    this.armorColor = '#4aa3ff';
    this.armorFillAlpha = 0.78;     // forward part, over empty health
    this.armorOverlayAlpha = 0.42;  // backward part, over the red fill
    this.label = '';
    this.labelColor = '#ffffff';
    this.labelFontSize = 18;
    this.borderColor = '#555555';
    this.borderWidth = 1;
    this.cornerRadius = 4;
    /** Subtle dark shadow on label text by default */
    this.shadowColor = 'rgba(0,0,0,0.65)';
    this.shadowBlur = 2;
    this.shadowOffsetX = 1;
    this.shadowOffsetY = 1;
  }

  renderSelf(ctx) {
    const r = this.rect;
    const cr = this.cornerRadius;
    const ratio = this.maxValue > 0 ? Math.min(1, Math.max(0, this.value / this.maxValue)) : 0;

    ctx.save();

    // Background
    ctx.fillStyle = this.backgroundColor;
    this._fillRoundRect(ctx, r.x, r.y, r.w, r.h, cr);

    // Fill
    if (ratio > 0) {
      ctx.fillStyle = this.fillColor;
      const fillW = r.w * ratio;
      // Clip fill to rounded rect
      ctx.save();
      ctx.beginPath();
      this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.clip();
      ctx.fillRect(r.x, r.y, fillW, r.h);
      ctx.restore();
    }

    // Armor overlay (blue), clipped to the rounded bar so it respects the shape.
    // Drawn after the red fill, before the border + label (so the label stays on
    // top). Hugs the right edge of current health: forward over empty, then
    // backward over red. Total visible width is naturally capped at the full bar
    // (forward ≤ missing, backward ≤ current health).
    if (this.armorValue > 0 && this.maxValue > 0) {
      const pxPerUnit = r.w / this.maxValue;
      const hp = Math.min(this.maxValue, Math.max(0, this.value));
      const hpRightX = r.x + hp * pxPerUnit;
      const missing = this.maxValue - hp;
      const forward = Math.min(this.armorValue, missing);
      const backward = Math.min(Math.max(0, this.armorValue - missing), hp);
      ctx.save();
      ctx.beginPath();
      this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.clip();
      ctx.fillStyle = this.armorColor;
      if (backward > 0) {
        ctx.globalAlpha = this.armorOverlayAlpha;
        ctx.fillRect(hpRightX - backward * pxPerUnit, r.y, backward * pxPerUnit, r.h);
      }
      if (forward > 0) {
        ctx.globalAlpha = this.armorFillAlpha;
        ctx.fillRect(hpRightX, r.y, forward * pxPerUnit, r.h);
      }
      ctx.restore();
    }

    // Border
    if (this.borderWidth > 0) {
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.stroke();
    }

    // Label centered
    if (this.label) {
      // Apply text shadow
      if (this.shadowColor) {
        ctx.shadowColor = this.shadowColor;
        ctx.shadowBlur = this.shadowBlur;
        ctx.shadowOffsetX = this.shadowOffsetX;
        ctx.shadowOffsetY = this.shadowOffsetY;
      }
      ctx.fillStyle = this.labelColor;
      ctx.font = `${this.labelFontSize}px "Marcellus SC", Georgia, "Times New Roman", serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(this.label, r.x + r.w / 2, r.y + r.h / 2);
    }

    ctx.restore();
  }

  _roundRectPath(ctx, x, y, w, h, r) {
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

  _fillRoundRect(ctx, x, y, w, h, r) {
    if (r > 0) {
      this._roundRectPath(ctx, x, y, w, h, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.value !== undefined) this.value = props.value;
    if (props.maxValue !== undefined) this.maxValue = props.maxValue;
    if (props.fillColor !== undefined) this.fillColor = props.fillColor;
    if (props.backgroundColor !== undefined) this.backgroundColor = props.backgroundColor;
    if (props.armorValue !== undefined) this.armorValue = props.armorValue;
    if (props.armorColor !== undefined) this.armorColor = props.armorColor;
    if (props.armorFillAlpha !== undefined) this.armorFillAlpha = props.armorFillAlpha;
    if (props.armorOverlayAlpha !== undefined) this.armorOverlayAlpha = props.armorOverlayAlpha;
    if (props.label !== undefined) this.label = props.label;
    if (props.labelColor !== undefined) this.labelColor = props.labelColor;
    if (props.labelFontSize !== undefined) this.labelFontSize = props.labelFontSize;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.borderWidth !== undefined) this.borderWidth = props.borderWidth;
    if (props.cornerRadius !== undefined) this.cornerRadius = props.cornerRadius;
    if (props.shadowColor !== undefined) this.shadowColor = props.shadowColor;
    if (props.shadowBlur !== undefined) this.shadowBlur = props.shadowBlur;
    if (props.shadowOffsetX !== undefined) this.shadowOffsetX = props.shadowOffsetX;
    if (props.shadowOffsetY !== undefined) this.shadowOffsetY = props.shadowOffsetY;
  }
}
