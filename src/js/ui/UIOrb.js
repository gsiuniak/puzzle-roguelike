import UIElement from './UIElement.js';

/**
 * UIOrb — circular mana/stat orb with color, count text, optional image.
 *
 * Properties:
 *   color         - fallback fill color (CSS string)
 *   count         - number displayed centered inside
 *   countColor    - CSS color for count text (default 'white')
 *   fontSize      - number
 *   assetKey      - optional image overlay from AssetManager
 *   assetManager  - AssetManager reference
 *   borderColor   - CSS border color
 *   borderWidth   - number (default 1)
 *   showCount     - boolean, whether to render the count number (default true)
 *   shadowColor   - CSS color for count text shadow (default 'rgba(0,0,0,0.65)'; set null to disable)
 *   shadowBlur    - shadow blur radius (default 2)
 *   shadowOffsetX - shadow horizontal offset (default 1)
 *   shadowOffsetY - shadow vertical offset (default 1)
 */
export default class UIOrb extends UIElement {
  constructor() {
    super();
    this.color = '#ff4444';
    this.count = 0;
    this.countColor = '#ffffff';
    this.fontSize = 16;
    this.assetKey = null;
    this.assetManager = null;
    this.borderColor = '#ffffff';
    this.borderWidth = 2;
    this.showCount = true;
    /** If true, renders mana_amount plate below orb with count on plate */
    this.showAmountPlate = false;
    /**
     * Plate width as a factor of the orb circle diameter (default 1.1 = the
     * classic slightly-wider-than-orb plate). Lower it when orbs sit in a
     * tight row so adjacent plates don't touch/overlap.
     */
    this.plateScale = 1.1;
    /** Subtle dark shadow on count text by default */
    this.shadowColor = 'rgba(0,0,0,0.65)';
    this.shadowBlur = 2;
    this.shadowOffsetX = 1;
    this.shadowOffsetY = 1;

    // ── Pulse "bobble" animation (e.g. when a mana stream lands) ──
    // A short scale punch about the orb center, decaying back to rest. Driven
    // by update(dt); triggered via pulse(). Deliberately a SLIGHT, non-
    // intensifying flourish (unlike the damage counter).
    this._pulseElapsed = UIOrb.PULSE_MS; // start settled
    this._pulsing = false;
  }

  /** Trigger (or restart) the slight scale bobble. */
  pulse() {
    this._pulseElapsed = 0;
    this._pulsing = true;
  }

  update(dt) {
    super.update(dt);
    if (this._pulsing) {
      this._pulseElapsed += dt;
      if (this._pulseElapsed >= UIOrb.PULSE_MS) this._pulsing = false;
    }
  }

  /** Current pulse scale factor (1 when settled). */
  _pulseScale() {
    if (!this._pulsing) return 1;
    const p = this._pulseElapsed / UIOrb.PULSE_MS;
    return 1 + UIOrb.PULSE_AMP * (1 - p) * Math.cos(p * Math.PI * 1.5);
  }

  renderSelf(ctx) {
    const r = this.rect;

    const s = this._pulseScale();
    let scaled = false;
    if (s !== 1) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      scaled = true;
    }

    if (this.showAmountPlate) {
      this._renderWithPlate(ctx, r);
    } else {
      this._renderSimple(ctx, r);
    }

    if (scaled) ctx.restore();
  }

  /** Original style: orb centered in rect, count inside orb */
  _renderSimple(ctx, r) {
    const size = Math.min(r.w, r.h);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = size / 2 - this.borderWidth;

    ctx.save();

    // Draw circle fill
    // ctx.beginPath();
    // ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    // ctx.fillStyle = this.color;
    // ctx.fill();

    // Draw image overlay if available
    if (this.assetKey && this.assetManager) {
      const img = this.assetManager.get(this.assetKey);
      if (img) {
        this._applySmoothing(ctx);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        const scale = Math.min(
          (radius * 2) / img.width,
          (radius * 2) / img.height
        );
        const sw = Math.ceil(img.width * scale);
        const sh = Math.ceil(img.height * scale);
        const dx = Math.floor(cx - sw / 2);
        const dy = Math.floor(cy - sh / 2);
        ctx.drawImage(img, dx, dy, sw, sh);
        ctx.restore();
        this._restoreSmoothing(ctx);
      }
    }

    // Count text centered inside orb
    if (this.showCount) {
      // Apply text shadow
      if (this.shadowColor) {
        ctx.shadowColor = this.shadowColor;
        ctx.shadowBlur = this.shadowBlur;
        ctx.shadowOffsetX = this.shadowOffsetX;
        ctx.shadowOffsetY = this.shadowOffsetY;
      }
      ctx.fillStyle = this.countColor;
      const fs = Math.max(10, Math.min(this.fontSize, radius));
      ctx.font = `bold ${fs}px "Marcellus SC", Georgia, "Times New Roman", serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(String(this.count), cx, cy);
    }

    ctx.restore();
  }

  /** Plate style: orb at top, decorative plate visible below orb, count over overlap.
   *
   *  Visual hierarchy:
   *        [ORB]        <- orb centered in upper portion
   *     ┌──────────┐    <- plate drawn ON TOP of orb bottom, visible below
   *     │    12    │    <- count text in overlap zone
   *     └──────────┘
   */
  _renderWithPlate(ctx, r) {
    // Orb takes upper ~60% of height; plate overlaps orb bottom
    const orbSize = Math.min(r.w, r.h * 0.65);
    const orbCx = r.x + r.w / 2;
    const orbCy = r.y + orbSize * 0.40;
    const orbRadius = orbSize / 2 - this.borderWidth;

    // Plate: positioned to overlap orb bottom, extending below
    const plateW = Math.ceil(orbSize * this.plateScale);
    const plateH = Math.ceil(orbSize * 0.5);
    const plateX = Math.floor(r.x + (r.w - plateW) / 2);
    const plateY = Math.floor(orbCy + orbRadius * 0.55);

    ctx.save();

    // ── Orb circle (drawn first, plate overlaps it) ─
    // ctx.beginPath();
    // ctx.arc(orbCx, orbCy, orbRadius, 0, Math.PI * 2);
    // ctx.fillStyle = this.color;
    // ctx.fill();

    // Draw image overlay if available
    if (this.assetKey && this.assetManager) {
      const img = this.assetManager.get(this.assetKey);
      if (img) {
        this._applySmoothing(ctx);
        ctx.save();
        ctx.beginPath();
        ctx.arc(orbCx, orbCy, orbRadius, 0, Math.PI * 2);
        ctx.clip();

        const scale = Math.min(
          (orbRadius * 2) / img.width,
          (orbRadius * 2) / img.height
        );
        const sw = Math.ceil(img.width * scale);
        const sh = Math.ceil(img.height * scale);
        const dx = Math.floor(orbCx - sw / 2);
        const dy = Math.floor(orbCy - sh / 2);
        ctx.drawImage(img, dx, dy, sw, sh);
        ctx.restore();
        this._restoreSmoothing(ctx);
      }
    }

    // ── Amount plate (drawn AFTER orb, so it is visible) ─
    const amountImg = this.assetManager
      ? this.assetManager.get('mana_amount')
      : null;

    if (amountImg) {
      this._applySmoothing(ctx);
      ctx.drawImage(amountImg, plateX, plateY, plateW, plateH);
      this._restoreSmoothing(ctx);
    }

    // Count text centered over lower orb / upper plate overlap
    if (this.showCount) {
      // Apply text shadow
      if (this.shadowColor) {
        ctx.shadowColor = this.shadowColor;
        ctx.shadowBlur = this.shadowBlur;
        ctx.shadowOffsetX = this.shadowOffsetX;
        ctx.shadowOffsetY = this.shadowOffsetY;
      }
      ctx.fillStyle = this.countColor;
      const fs = Math.max(11, Math.min(this.fontSize, plateH * 0.55));
      ctx.font = `bold ${fs}px "Marcellus SC", Georgia, "Times New Roman", serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      // Position count at the overlap zone
      const countY = plateY + plateH * 0.45;
      ctx.fillText(String(this.count), r.x + r.w / 2, countY);
    }

    ctx.restore();
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.color !== undefined) this.color = props.color;
    if (props.count !== undefined) this.count = props.count;
    if (props.countColor !== undefined) this.countColor = props.countColor;
    if (props.fontSize !== undefined) this.fontSize = props.fontSize;
    if (props.assetKey !== undefined) this.assetKey = props.assetKey;
    if (props.assetManager !== undefined) this.assetManager = props.assetManager;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.borderWidth !== undefined) this.borderWidth = props.borderWidth;
    if (props.showCount !== undefined) this.showCount = props.showCount;
    if (props.showAmountPlate !== undefined) this.showAmountPlate = props.showAmountPlate;
    if (props.plateScale !== undefined) this.plateScale = props.plateScale;
    if (props.shadowColor !== undefined) this.shadowColor = props.shadowColor;
    if (props.shadowBlur !== undefined) this.shadowBlur = props.shadowBlur;
    if (props.shadowOffsetX !== undefined) this.shadowOffsetX = props.shadowOffsetX;
    if (props.shadowOffsetY !== undefined) this.shadowOffsetY = props.shadowOffsetY;
  }
}

// Pulse "bobble" tunables (slight, non-intensifying flourish).
UIOrb.PULSE_MS = 280;
UIOrb.PULSE_AMP = 0.22;
