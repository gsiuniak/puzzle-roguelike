/**
 * LevelUpOverlay — post-battle "Level Up" attribute-pick MODAL.
 *
 * Shown FIRST in the post-battle (victory) flow, BEFORE the relic RewardOverlay:
 *   end of battle → LevelUpOverlay (pick an attribute) → RewardOverlay → map.
 *
 * Behaves like RewardOverlay: a modal over the still-visible battle scene, with
 * the owning BattleScene painting a full-canvas dark backdrop behind it
 * (getBackdropAlpha). Unlike the reward screen there is NO skip — the player
 * MUST choose one attribute (the choice always grants growth), so there is no
 * skip button and ESC does not dismiss it.
 *
 * Layout (centered, compact so the battle stays visible behind it):
 *   - `ui_level_up_container_panel` frame (its raised "LEVEL UP" title plate
 *     overlaps the top border), with the "LEVEL UP" title drawn over the plate.
 *   - "CHOOSE AN ATTRIBUTE" subtitle flanked by the two thin gold divider
 *     flairs (`ui_level_up_flair_left` / `_right`).
 *   - Three equal selectable cards (`ui_level_up_attribute_panel`) in a row:
 *     Attack, Magic, Max HP — each a large glowing stat icon, the stat name,
 *     and "current → upgraded".
 *
 * Data flow (mirrors RewardOverlay):
 *   prepareLevelUp(attributes) — [{ key, name, iconKey, glowColor, current, upgraded }]
 *   show() — begin entrance animation
 *   click a card → handleAttributeSelected(i) → onAttributeSelected(key)
 *     (BattleScene applies the growth) → proceedToNextScene() → onDismiss()
 *     (BattleScene then opens the RewardOverlay).
 */

import AudioManager from '../audio/AudioManager.js';

// ═══════════════════════════════════════════════════════════
// Tunable layout constants
// ═══════════════════════════════════════════════════════════

/** Alpha of the full-canvas dark backdrop (matches the reward overlay feel). */
export const OVERLAY_BACKDROP_ALPHA = 0.78;

/** Container (modal frame) width as a fraction of canvas width (height ← art aspect). */
const CONTAINER_WIDTH_FRAC = 0.46;
/** Vertical offset of the whole modal from canvas center (px; negative = up). */
const GROUP_Y_OFFSET = 0;

// Vertical anchors as FRACTIONS of the container height. The art's title plate
// sits very near the top (its center ≈ 0.085), and the inner card area runs
// ≈ 0.16 → 0.90, so the cards must stay inside that band.
const TITLE_CENTER_FRAC = 0.085;   // "LEVEL UP" plate band (top, overlapping border)
const SUBTITLE_CENTER_FRAC = 0.225; // "CHOOSE AN ATTRIBUTE" + divider flairs
const CARDS_CENTER_FRAC = 0.595;   // vertical center of the attribute-card row

// ── Title / subtitle text ──
const TITLE_TEXT = 'Level Up';
const TITLE_FONT_SIZE_FRAC = 0.052; // × container width
const TITLE_COLOR = '#e8cf8f';
const TITLE_LETTER_SPACING = 3;

const SUBTITLE_TEXT = 'Choose an Attribute';
const SUBTITLE_FONT_SIZE_FRAC = 0.026;
const SUBTITLE_COLOR = '#c9a96a';
const SUBTITLE_LETTER_SPACING = 2;

const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

// ── Divider flairs flanking the subtitle ──
const FLAIR_WIDTH_FRAC = 0.155;    // × container width (each flair)
const FLAIR_GAP = 16;              // px gap between subtitle text and each flair

// ── Attribute cards ──
const CARD_HEIGHT_FRAC = 0.54;     // × container height (kept inside the inner frame)
const CARD_GAP_FRAC = 0.03;        // × container width (between cards)
// Within a card (fractions of card height/width):
const CARD_ICON_CENTER_FRAC = 0.34; // icon vertical center (× card height)
const CARD_ICON_SIZE_FRAC = 0.50;   // icon draw size (× card width)
const CARD_ICON_GLOW_BLUR = 22;
const CARD_NAME_CENTER_FRAC = 0.64;
const CARD_NAME_FONT_FRAC = 0.15;   // × card width
const CARD_NAME_COLOR = '#e7ddc4';
const CARD_VALUE_CENTER_FRAC = 0.80;
const CARD_VALUE_FONT_FRAC = 0.14;
const CARD_VALUE_FROM_COLOR = '#b9b09a';
const CARD_VALUE_ARROW_COLOR = '#9a8f76';
const CARD_VALUE_TO_COLOR = '#f3e6b6';

// ── Hover highlight (matches RewardOverlay) ──
const HOVER_SCALE = 1.04;
const HOVER_ANIM_DURATION = 100;
const HOVER_ANIM_SPEED = 4;
const HOVER_BORDER_COLOR = 'rgba(232, 207, 143, 0.9)';
const HOVER_BORDER_WIDTH = 2;
const HOVER_BORDER_RADIUS = 8;

// ── Entrance/exit animation (matches RewardOverlay) ──
const OVERLAY_FADE_DURATION = 170;
const OVERLAY_SLIDE_FRACTION = 0.10;

const OverlayState = Object.freeze({
  INACTIVE: 'inactive',
  ENTERING: 'entering',
  ACTIVE: 'active',
  EXITING: 'exiting',
});

export default class LevelUpOverlay {
  /**
   * @param {object} deps
   * @param {import('../engine/AssetManager.js').default} deps.assetManager
   * @param {Function} [deps.onDismiss] — fired when the overlay begins exiting (→ reward overlay)
   * @param {Function} [deps.onAttributeSelected] — (attributeKey) when a card is chosen
   */
  constructor({ assetManager, onDismiss, onAttributeSelected } = {}) {
    this._assetManager = assetManager || null;
    this.onDismiss = onDismiss || null;
    this.onAttributeSelected = onAttributeSelected || null;

    this._state = OverlayState.INACTIVE;
    this._timer = 0;

    /** @type {Array<{key,name,iconKey,glowColor,current,upgraded}>} */
    this._attributes = [];
    /** Card hit-rects from the last render (parallel to _attributes). */
    this._cardRects = [];

    this._hoveredIndex = -1;
    this._hoverAnimT = 0;
    this._isResolving = false;
  }

  // ── Public API ─────────────────────────────────────────

  /**
   * Set the three attribute cards. Each entry:
   *   { key, name, iconKey, glowColor, current, upgraded }
   * @param {Array<object>} attributes
   */
  prepareLevelUp(attributes) {
    this._attributes = Array.isArray(attributes) ? attributes.slice(0, 3) : [];
  }

  show() {
    if (this._state === OverlayState.ENTERING || this._state === OverlayState.ACTIVE) return;
    this._state = OverlayState.ENTERING;
    this._timer = 0;
    this._hoveredIndex = -1;
    this._hoverAnimT = 0;
    this._isResolving = false;
    AudioManager.playSfx('sfx_rewards_open');
  }

  isActive() {
    return this._state !== OverlayState.INACTIVE;
  }

  getEntranceAlpha() {
    if (this._state === OverlayState.INACTIVE) return 0;
    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      return 1 - Math.pow(1 - rawT, 3);
    }
    return 1;
  }

  getBackdropAlpha() {
    return OVERLAY_BACKDROP_ALPHA * this.getEntranceAlpha();
  }

  reset() {
    this._state = OverlayState.INACTIVE;
    this._timer = 0;
    this._hoveredIndex = -1;
    this._hoverAnimT = 0;
    this._isResolving = false;
  }

  /**
   * Commit a chosen attribute: notify the host (which applies the growth), then
   * exit (→ onDismiss opens the reward overlay). Guards against double-select.
   * @param {number} index
   */
  handleAttributeSelected(index) {
    if (this._isResolving) return;
    const attr = this._attributes[index];
    if (!attr) return;

    AudioManager.playSfx('sfx_map_click_node'); // "commit" cue, same as reward pick
    if (typeof this.onAttributeSelected === 'function') {
      this.onAttributeSelected(attr.key);
    }
    this.proceedToNextScene();
  }

  /**
   * Single exit point: fire onDismiss (BattleScene opens the reward overlay in
   * the SAME scene) then go INACTIVE immediately — there's no scene change to
   * hide an exit animation, so lingering would draw behind the reward overlay.
   */
  proceedToNextScene() {
    if (this._isResolving) return;
    this._isResolving = true;
    if (typeof this.onDismiss === 'function') this.onDismiss();
    this.reset();
  }

  // ── Per-frame update ───────────────────────────────────

  update(dt) {
    if (this._state === OverlayState.ENTERING) {
      this._timer += dt;
      if (this._timer >= OVERLAY_FADE_DURATION) this._state = OverlayState.ACTIVE;
    }
    if (this._state === OverlayState.ACTIVE && !this._isResolving) {
      const target = this._hoveredIndex >= 0 ? 1 : 0;
      const speed = Math.min(1, (dt / HOVER_ANIM_DURATION) * HOVER_ANIM_SPEED);
      this._hoverAnimT += (target - this._hoverAnimT) * speed;
    }
    if (this._state === OverlayState.EXITING || this._isResolving) this._hoverAnimT = 0;
  }

  // ── Input (routed by BattleScene while active) ─────────

  handleMouseMove(x, y) {
    if (this._state !== OverlayState.ACTIVE || this._isResolving) return;
    let hover = -1;
    for (let i = 0; i < this._cardRects.length; i++) {
      const r = this._cardRects[i];
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { hover = i; break; }
    }
    this._hoveredIndex = hover;
  }

  handleMouseDown(x, y) {
    if (this._state !== OverlayState.ACTIVE || this._isResolving) return;
    for (let i = 0; i < this._cardRects.length; i++) {
      const r = this._cardRects[i];
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this.handleAttributeSelected(i);
        return;
      }
    }
  }

  // ── Render ─────────────────────────────────────────────

  render(ctx, canvasW, canvasH) {
    if (this._state === OverlayState.INACTIVE) return;
    const am = this._assetManager;
    const container = this._img('ui_level_up_container_panel');
    if (!container) return;

    // Entrance fade + slide.
    let alpha = 1;
    let slideY = 0;
    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      const eased = 1 - Math.pow(1 - rawT, 3);
      alpha = eased;
      slideY = (1 - eased) * canvasH * OVERLAY_SLIDE_FRACTION;
    }

    const cw = canvasW * CONTAINER_WIDTH_FRAC;
    const ch = cw * (container.height / container.width);
    const cx = (canvasW - cw) / 2;
    const cy = (canvasH - ch) / 2 + GROUP_Y_OFFSET + slideY;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Container frame (raised "LEVEL UP" plate is baked into the art's top).
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(container, Math.floor(cx), Math.floor(cy), Math.ceil(cw), Math.ceil(ch));

    // Title over the plate.
    this._drawText(ctx, TITLE_TEXT.toUpperCase(), canvasW / 2, cy + ch * TITLE_CENTER_FRAC, {
      size: cw * TITLE_FONT_SIZE_FRAC, color: TITLE_COLOR, spacing: TITLE_LETTER_SPACING,
      shadowBlur: 8,
    });

    // Subtitle + flanking divider flairs.
    this._renderSubtitle(ctx, canvasW, cw, cy + ch * SUBTITLE_CENTER_FRAC);

    // Three attribute cards.
    this._renderCards(ctx, canvasW, cx, cy, cw, ch);

    ctx.restore();
  }

  // ── Private render helpers ─────────────────────────────

  _renderSubtitle(ctx, canvasW, containerW, centerY) {
    const size = containerW * SUBTITLE_FONT_SIZE_FRAC;
    ctx.save();
    ctx.font = `${size}px ${FONT_FAMILY}`;
    const text = SUBTITLE_TEXT.toUpperCase();
    // Approximate spaced-text width (letterSpacing isn't on all canvas impls).
    const textW = ctx.measureText(text).width + SUBTITLE_LETTER_SPACING * (text.length - 1);
    ctx.restore();

    this._drawText(ctx, text, canvasW / 2, centerY, {
      size, color: SUBTITLE_COLOR, spacing: SUBTITLE_LETTER_SPACING, shadowBlur: 4,
    });

    // Divider flairs immediately flanking the subtitle text.
    const flL = this._img('ui_level_up_flair_left');
    const flR = this._img('ui_level_up_flair_right');
    const fw = containerW * FLAIR_WIDTH_FRAC;
    const leftEnd = canvasW / 2 - textW / 2 - FLAIR_GAP;
    const rightStart = canvasW / 2 + textW / 2 + FLAIR_GAP;
    if (flL) {
      const fh = fw * (flL.height / flL.width);
      ctx.drawImage(flL, Math.floor(leftEnd - fw), Math.floor(centerY - fh / 2), Math.ceil(fw), Math.ceil(fh));
    }
    if (flR) {
      const fh = fw * (flR.height / flR.width);
      ctx.drawImage(flR, Math.floor(rightStart), Math.floor(centerY - fh / 2), Math.ceil(fw), Math.ceil(fh));
    }
  }

  _renderCards(ctx, canvasW, cx, cy, cw, ch) {
    this._cardRects = [];
    const cardArt = this._img('ui_level_up_attribute_panel');
    const n = this._attributes.length;
    if (n === 0) return;

    const cardH = ch * CARD_HEIGHT_FRAC;
    const cardW = cardArt ? cardH * (cardArt.width / cardArt.height) : cardH * 0.76;
    const gap = cw * CARD_GAP_FRAC;
    const rowW = cardW * n + gap * (n - 1);
    const rowX = (canvasW - rowW) / 2;
    const cardTop = cy + ch * CARDS_CENTER_FRAC - cardH / 2;

    const scale = 1 + (HOVER_SCALE - 1) * this._hoverAnimT;

    // Position + record hit rects first.
    for (let i = 0; i < n; i++) {
      const x = rowX + i * (cardW + gap);
      this._cardRects[i] = { x, y: cardTop, w: cardW, h: cardH };
    }

    // Draw non-hovered first, hovered last (on top, scaled + bordered).
    let hoveredIdx = -1;
    for (let i = 0; i < n; i++) {
      if (i === this._hoveredIndex) { hoveredIdx = i; continue; }
      this._drawCard(ctx, cardArt, this._cardRects[i], this._attributes[i]);
    }
    if (hoveredIdx >= 0) {
      const r = this._cardRects[hoveredIdx];
      if (scale > 1.0001) {
        const mx = r.x + r.w / 2;
        const my = r.y + r.h / 2;
        ctx.save();
        ctx.translate(mx, my);
        ctx.scale(scale, scale);
        ctx.translate(-mx, -my);
        this._drawCard(ctx, cardArt, r, this._attributes[hoveredIdx]);
        this._drawHoverBorder(ctx, r);
        ctx.restore();
      } else {
        this._drawCard(ctx, cardArt, r, this._attributes[hoveredIdx]);
        this._drawHoverBorder(ctx, r);
      }
    }
  }

  /** Draw one attribute card: frame art + glowing icon + name + "cur → up". */
  _drawCard(ctx, cardArt, r, attr) {
    if (!attr) return;
    if (cardArt) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cardArt, Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h));
    }

    // Glowing stat icon (reused character-panel / character-select icons).
    const icon = this._img(attr.iconKey);
    if (icon) {
      const size = r.w * CARD_ICON_SIZE_FRAC;
      const ix = r.x + r.w / 2 - size / 2;
      const iy = r.y + r.h * CARD_ICON_CENTER_FRAC - size / 2;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if (attr.glowColor) {
        ctx.shadowColor = attr.glowColor;
        ctx.shadowBlur = CARD_ICON_GLOW_BLUR;
      }
      ctx.drawImage(icon, ix, iy, size, size);
      ctx.restore();
    }

    // Stat name.
    this._drawText(ctx, attr.name, r.x + r.w / 2, r.y + r.h * CARD_NAME_CENTER_FRAC, {
      size: r.w * CARD_NAME_FONT_FRAC, color: CARD_NAME_COLOR, shadowBlur: 4,
    });

    // "current → upgraded" — drawn as three runs so the arrow + new value pop.
    this._drawValueLine(ctx, r.x + r.w / 2, r.y + r.h * CARD_VALUE_CENTER_FRAC,
      r.w * CARD_VALUE_FONT_FRAC, attr.current, attr.upgraded);
  }

  _drawValueLine(ctx, cx, cy, size, current, upgraded) {
    ctx.save();
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    const from = String(current);
    const arrow = '  →  ';
    const to = String(upgraded);
    const wFrom = ctx.measureText(from).width;
    const wArrow = ctx.measureText(arrow).width;
    const wTo = ctx.measureText(to).width;
    const total = wFrom + wArrow + wTo;
    let x = cx - total / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_VALUE_FROM_COLOR; ctx.fillText(from, x, cy); x += wFrom;
    ctx.fillStyle = CARD_VALUE_ARROW_COLOR; ctx.fillText(arrow, x, cy); x += wArrow;
    ctx.fillStyle = CARD_VALUE_TO_COLOR; ctx.fillText(to, x, cy);
    ctx.restore();
  }

  _drawHoverBorder(ctx, r) {
    const { x, y, w, h } = r;
    const rad = HOVER_BORDER_RADIUS;
    ctx.save();
    ctx.strokeStyle = HOVER_BORDER_COLOR;
    ctx.lineWidth = HOVER_BORDER_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** Centered text with optional letter-spacing + shadow. */
  _drawText(ctx, text, cx, cy, { size, color, spacing = 0, shadowBlur = 0 }) {
    ctx.save();
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    if (shadowBlur > 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetY = 1;
    }
    if (spacing > 0) {
      // Manual letter-spacing (broad canvas support).
      const widths = [];
      let total = 0;
      for (const chr of text) { const w = ctx.measureText(chr).width; widths.push(w); total += w + spacing; }
      total -= spacing;
      ctx.textAlign = 'left';
      let x = cx - total / 2;
      let i = 0;
      for (const chr of text) { ctx.fillText(chr, x, cy); x += widths[i++] + spacing; }
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(text, cx, cy);
    }
    ctx.restore();
  }

  /** AssetManager image getter that tolerates sliced-sprite canvases. */
  _img(key) {
    if (!this._assetManager || !key) return null;
    const img = this._assetManager.get(key);
    return img && img.complete !== false && img.width ? img : null;
  }
}
