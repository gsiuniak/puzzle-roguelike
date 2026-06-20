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
    /**
     * Barrier overlay (semi-transparent PURPLE) — a second "temporary HP" shield
     * drawn the same way as the armor overlay, but stacked OUTWARD beyond armor
     * (health | armor | barrier). Barrier is the one-round magic shield. 0 = none.
     */
    this.barrierValue = 0;
    this.barrierColor = '#a24dff';
    this.barrierFillAlpha = 0.6;    // forward part, over empty health
    this.barrierOverlayAlpha = 0.34; // backward part, over the red fill
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

    // Shield overlays (armor = blue, barrier = purple), clipped to the rounded
    // bar so they respect the shape. Drawn after the red fill, before the border +
    // label (so the label stays on top). Each shield hugs the right edge of
    // current health, stacking OUTWARD in order (armor first, then barrier):
    // forward over the empty-health region at fillAlpha, then — when it exceeds
    // the empty space — backward over the red fill at overlayAlpha. Total visible
    // width is naturally capped at the full bar. With armor only, this is
    // identical to the original single-overlay behavior.
    const shields = [];
    if (this.armorValue > 0) {
      shields.push({ v: this.armorValue, color: this.armorColor, fa: this.armorFillAlpha, oa: this.armorOverlayAlpha });
    }
    if (this.barrierValue > 0) {
      shields.push({ v: this.barrierValue, color: this.barrierColor, fa: this.barrierFillAlpha, oa: this.barrierOverlayAlpha });
    }
    if (shields.length > 0 && this.maxValue > 0) {
      const pxPerUnit = r.w / this.maxValue;
      const hp = Math.min(this.maxValue, Math.max(0, this.value));
      const hpRightX = r.x + hp * pxPerUnit;
      ctx.save();
      ctx.beginPath();
      this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.clip();
      let fwdX = hpRightX;                   // forward cursor (into empty health)
      let fwdRemaining = this.maxValue - hp; // units of empty space left
      let bwdX = hpRightX;                   // backward cursor (over the red fill)
      for (const s of shields) {
        ctx.fillStyle = s.color;
        let val = s.v;
        const fwd = Math.min(val, fwdRemaining);
        if (fwd > 0) {
          ctx.globalAlpha = s.fa;
          ctx.fillRect(fwdX, r.y, fwd * pxPerUnit, r.h);
          fwdX += fwd * pxPerUnit; fwdRemaining -= fwd; val -= fwd;
        }
        if (val > 0) {
          const bwd = Math.min(val, (bwdX - r.x) / pxPerUnit); // cap at the left edge
          if (bwd > 0) {
            ctx.globalAlpha = s.oa;
            ctx.fillRect(bwdX - bwd * pxPerUnit, r.y, bwd * pxPerUnit, r.h);
            bwdX -= bwd * pxPerUnit;
          }
        }
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
    if (props.barrierValue !== undefined) this.barrierValue = props.barrierValue;
    if (props.barrierColor !== undefined) this.barrierColor = props.barrierColor;
    if (props.barrierFillAlpha !== undefined) this.barrierFillAlpha = props.barrierFillAlpha;
    if (props.barrierOverlayAlpha !== undefined) this.barrierOverlayAlpha = props.barrierOverlayAlpha;
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
