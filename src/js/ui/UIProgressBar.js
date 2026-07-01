import UIElement from './UIElement.js';

/**
 * UIProgressBar — horizontal bar with fill, background, and centered label.
 *
 * Properties:
 *   value           - current value (number)
 *   maxValue        - max value (number)
 *   fillColor       - CSS color for filled portion
 *   fillAssetKey    - optional authored fill art (with assetManager); drawn
 *                     stretched to the full bar, clipped to the filled
 *                     fraction (reveals, never squashes). Falls back to fillColor
 *   assetManager    - AssetManager reference for fillAssetKey
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
    /**
     * Optional authored fill art (asset key + AssetManager). When set and
     * loaded, the image is drawn stretched to the FULL bar rect and clipped to
     * the filled fraction — the art "reveals" as HP changes instead of
     * squashing. Falls back to the solid fillColor when absent/not loaded.
     */
    this.fillAssetKey = null;
    this.assetManager = null;
    this.backgroundColor = '#222222';
    /**
     * "Lost health" ghost bar. When `value` drops, the red fill chunks down
     * IMMEDIATELY, and the just-lost slice lingers as a lighter (white) bar that
     * holds briefly — so multiple hits in a combo accumulate into one white
     * slice — then drains down to the current health once the damage stops.
     * Driven by update(dt); purely cosmetic (never affects `value`).
     */
    this.ghostColor = '#f2ede0';
    this.ghostAlpha = 0.85;
    this._ghostValue = null;   // trailing (higher) value, in HP units; null until first tick
    this._prevValue = null;    // last-seen `value`, to detect fresh drops
    this._ghostHold = 0;       // ms remaining to hold before the white bar drains
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

  /**
   * Drive the "lost health" ghost bar. `dt` is in milliseconds (matching the
   * rest of the UI's update contract). On a fresh drop we (re)arm a short hold
   * so combo hits pool into one white slice; after the hold the ghost drains
   * toward current HP at a bar-relative rate (so the visual speed is the same
   * regardless of maxHp). Healing (value rising) snaps the ghost up instantly.
   */
  update(dt) {
    super.update(dt);
    const v = this._clampToBar(this.value);

    // First tick — start settled at the current value, no trailing bar.
    if (this._ghostValue === null) {
      this._ghostValue = v;
      this._prevValue = v;
      return;
    }

    // Fresh damage this frame → keep the white slice where it is and (re)arm
    // the hold so successive combo hits keep accumulating into it.
    if (v < this._prevValue - UIProgressBar.GHOST_EPS) {
      this._ghostHold = UIProgressBar.GHOST_HOLD_MS;
    }
    this._prevValue = v;

    if (v >= this._ghostValue - UIProgressBar.GHOST_EPS) {
      // Caught up or healed — no trailing bar.
      this._ghostValue = v;
      this._ghostHold = 0;
      return;
    }

    // Lost health is showing as white: hold, then drain down to current HP.
    if (this._ghostHold > 0) {
      this._ghostHold -= dt;
      return;
    }
    const span = this.maxValue > 0 ? this.maxValue : 100;
    const rate = span / UIProgressBar.GHOST_DRAIN_MS; // HP units per ms
    this._ghostValue = Math.max(v, this._ghostValue - rate * dt);
  }

  /** Clamp a value to [0, maxValue]. */
  _clampToBar(v) {
    if (this.maxValue <= 0) return 0;
    return Math.min(this.maxValue, Math.max(0, v));
  }

  renderSelf(ctx) {
    const r = this.rect;
    const cr = this.cornerRadius;
    const ratio = this.maxValue > 0 ? Math.min(1, Math.max(0, this.value / this.maxValue)) : 0;

    ctx.save();

    // Background
    ctx.fillStyle = this.backgroundColor;
    this._fillRoundRect(ctx, r.x, r.y, r.w, r.h, cr);

    // Fill — authored art (revealed to the filled fraction) or solid color.
    if (ratio > 0) {
      const fillW = r.w * ratio;
      const img = this.fillAssetKey && this.assetManager
        ? this.assetManager.get(this.fillAssetKey) : null;
      // Sliced sheet sprites are canvases (complete === undefined); only a
      // real, still-loading Image reports complete === false.
      const imgReady = img && img.complete !== false && img.width;
      // Clip fill to rounded rect
      ctx.save();
      ctx.beginPath();
      this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
      ctx.clip();
      if (imgReady) {
        ctx.beginPath();
        ctx.rect(r.x, r.y, fillW, r.h);
        ctx.clip();
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
        ctx.imageSmoothingEnabled = prevSmooth;
      } else {
        ctx.fillStyle = this.fillColor;
        ctx.fillRect(r.x, r.y, fillW, r.h);
      }
      ctx.restore();
    }

    // "Lost health" ghost bar — the lighter slice between current HP (red fill's
    // right edge) and the trailing ghost value, drawn over the empty-health
    // region. Drained by update(dt). Clipped to the rounded bar; sits under the
    // shield overlays + border + label.
    if (this._ghostValue !== null && this.maxValue > 0) {
      const pxPerUnit = r.w / this.maxValue;
      const hp = this._clampToBar(this.value);
      const ghost = this._clampToBar(this._ghostValue);
      if (ghost > hp + UIProgressBar.GHOST_EPS) {
        ctx.save();
        ctx.beginPath();
        this._roundRectPath(ctx, r.x, r.y, r.w, r.h, cr);
        ctx.clip();
        ctx.globalAlpha = this.ghostAlpha;
        ctx.fillStyle = this.ghostColor;
        ctx.fillRect(r.x + hp * pxPerUnit, r.y, (ghost - hp) * pxPerUnit, r.h);
        ctx.restore();
      }
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
    if (props.fillAssetKey !== undefined) this.fillAssetKey = props.fillAssetKey;
    if (props.assetManager !== undefined) this.assetManager = props.assetManager;
    if (props.backgroundColor !== undefined) this.backgroundColor = props.backgroundColor;
    if (props.ghostColor !== undefined) this.ghostColor = props.ghostColor;
    if (props.ghostAlpha !== undefined) this.ghostAlpha = props.ghostAlpha;
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

// ── "Lost health" ghost-bar tunables ──────────────────────
// How long (ms) the white slice holds after the LAST hit before it starts
// draining — long enough that a multi-hit combo pools into one slice.
UIProgressBar.GHOST_HOLD_MS = 450;
// Drain speed, expressed as the time (ms) to drain a FULL bar's worth; the
// actual drain is proportional, so the on-screen speed is consistent across
// different maxHp values. A small chunk drains quickly, a big one over ~this.
UIProgressBar.GHOST_DRAIN_MS = 650;
// Values within this of each other are treated as equal (HP units).
UIProgressBar.GHOST_EPS = 0.01;
