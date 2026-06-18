/**
 * RewardOverlay — post-battle Victory relic-reward overlay.
 *
 * Renders as a MODAL on top of the still-visible battle scene (not a separate
 * screen). The owning BattleScene paints a full-canvas dark transparent
 * backdrop (see getBackdropAlpha) behind this overlay — same treatment as the
 * map overlay — so the battle stays visible but darkened underneath.
 *
 * Visual layering (this overlay, drawn after the backdrop):
 *   1. "Choose a Relic" title banner (rewards_title_panel art) centered at top
 *   2. Three side-by-side vertical RewardOptionPanel cards below the title
 *   3. A small, centered "Skip Rewards" button BELOW the cards row
 *
 * The whole group (title + cards + skip) floats over the darkened battle scene
 * — there is no large background panel framing it.
 *
 * Data flow:
 *   prepareRewards(relicDefs) — assign relic defs to the option cards (called
 *     by BattleScene right before show(), populated from the relic reward pool)
 *   show() — begin entrance animation
 *   click option → handleRelicRewardSelected(relicDef, index) → onRelicSelected
 *     callback (BattleScene grants the relic) → proceedToNextScene()
 *   click skip / ESC → proceedToNextScene() (no relic granted)
 *
 * Lifecycle / states unchanged from before (INACTIVE/ENTERING/ACTIVE/EXITING).
 */

import UIImage from './UIImage.js';
import RewardOptionPanel from './RewardOptionPanel.js';
import AudioManager from '../audio/AudioManager.js';

// ═══════════════════════════════════════════════════════════
// Tunable layout constants
// ═══════════════════════════════════════════════════════════

/** Alpha of the full-canvas dark backdrop (matches the map overlay feel) */
export const OVERLAY_BACKDROP_ALPHA = 0.78;

// ── Reward cards (three vertical panels in a row) ──────────
/** Card height as a fraction of canvas height (width derives from art aspect) */
const CARD_HEIGHT_FRAC = 0.75;
/** Horizontal spacing between the three vertical cards (px) */
const CARD_SPACING = 26;

/**
 * Vertical offset of the whole reward group (title + cards + skip) from the
 * canvas center. Negative nudges everything UP. Easy to tweak.
 */
const GROUP_Y_OFFSET = -8;

// ── Title panel ("Choose a Relic") ─────────────────────────
/** Title banner width as a fraction of canvas width (height derives from aspect) */
const TITLE_PANEL_WIDTH_FRAC = 0.20;
/** Gap between the title panel bottom and the top of the cards row (px) */
const TITLE_GAP_BELOW = 20;
/**
 * Vertical center of the header text as a FRACTION of the banner height.
 * The banner art's diamond ornament pokes above the frame, so the dark text
 * band sits BELOW the image's geometric center (0.5) — hence > 0.5 here.
 */
const TITLE_TEXT_CENTER_FRAC = 0.56;
/** Additional header text fine-tune offset within the title panel (px, +down) */
const TITLE_TEXT_Y_OFFSET = 5;

const HEADER_TEXT = 'Choose a Relic';
const HEADER_FONT_SIZE = 34;
const HEADER_COLOR = '#ccaa77';
const HEADER_FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

// ── Skip Rewards button (below the cards row) ──────────────
/** Vertical gap between the cards row bottom and the skip button (px) */
const SKIP_REWARDS_BUTTON_Y_OFFSET = 18;
/** Skip button width as a fraction of canvas width */
const SKIP_BUTTON_WIDTH_FRAC = 0.2;
/** Fallback skip button height if the asset has no intrinsic size */
const SKIP_BUTTON_FALLBACK_HEIGHT = 46;

// ── Hover highlight ────────────────────────────────────────
/** Scale factor applied to a hovered reward option (subtle UI emphasis) */
const HOVER_SCALE = 1.03;
/** Duration of the hover-in / hover-out scale animation (ms) */
const HOVER_ANIM_DURATION = 100;
/** Multiplier for animation responsiveness (higher = snappier lerp) */
const HOVER_ANIM_SPEED = 4;
/** Border color drawn around the hovered option card */
const HOVER_BORDER_COLOR = 'rgba(190, 150, 255, 0.85)';
const HOVER_BORDER_WIDTH = 2;
const HOVER_BORDER_RADIUS = 6;

// ── Overlay animation constants ────────────────────────────
/** Duration of the entrance/exit animation (ms) */
const OVERLAY_FADE_DURATION = 170;
/**
 * Scale the whole reward group GROWS from on entrance (fade + grow, about its
 * center). Replaces the old slide-up so the Level Up → Reward handoff reads as
 * a clean "previous panel shrinks away → this one grows in" crossfade over the
 * steady backdrop.
 */
const OVERLAY_ENTER_FROM_SCALE = 0.90;

// ── Overlay state enum ────────────────────────────────────
/** @readonly @enum {string} */
const OverlayState = Object.freeze({
  INACTIVE: 'inactive',
  ENTERING: 'entering',
  ACTIVE: 'active',
  EXITING: 'exiting',
});

export default class RewardOverlay {
  /**
   * @param {object} deps
   * @param {import('../engine/AssetManager.js').default} deps.assetManager
   * @param {Function} [deps.onDismiss] — invoked when the overlay begins exiting (→ next scene)
   * @param {Function} [deps.onRelicSelected] — (relicDef, index) when a reward is chosen
   */
  constructor({ assetManager, onDismiss, onRelicSelected } = {}) {
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = assetManager || null;

    /** Fired when the overlay starts exiting; BattleScene transitions to the map. */
    this.onDismiss = onDismiss || null;

    /** Fired when a relic reward is chosen: (relicDef, rewardIndex). */
    this.onRelicSelected = onRelicSelected || null;

    /** @type {string} one of OverlayState values */
    this._state = OverlayState.INACTIVE;

    /** Elapsed animation time (ms). */
    this._timer = 0;

    /** Which button is hovered: null | 'skip'. */
    this._hoveredButton = null;

    /** Index of the hovered reward option (-1 = none). */
    this._hoveredRewardIndex = -1;

    /** Hover scale animation progress (0-1). */
    this._hoverAnimT = 0;

    /** Guard: prevents double-select / double-transition. */
    this._isResolvingReward = false;

    // ── UI tree references (built once; positioned manually each render) ──
    /** @type {RewardOptionPanel[]} reward option cards (laid out in a row) */
    this._rewardOptions = [];
    /** @type {UIImage} skip rewards button (positioned manually below the row) */
    this._skipButton = null;

    this._buildHierarchy();
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  /**
   * Assign relic definitions to the option cards. Call before show().
   * Cards beyond the supplied list are hidden. Safe to call repeatedly.
   * @param {object[]} relicDefs — relic definitions from the reward pool
   */
  prepareRewards(relicDefs) {
    const defs = Array.isArray(relicDefs) ? relicDefs : [];
    for (let i = 0; i < this._rewardOptions.length; i++) {
      this._rewardOptions[i].setRelic(defs[i] || null);
    }
  }

  /** Begin the entrance animation. No-op if already entering or active. */
  show() {
    if (this._state === OverlayState.ENTERING || this._state === OverlayState.ACTIVE) return;
    this._state = OverlayState.ENTERING;
    this._timer = 0;
    this._hoveredRewardIndex = -1;
    this._hoverAnimT = 0;
    this._isResolvingReward = false;
    this._hoveredButton = null;
    AudioManager.playSfx('sfx_rewards_open');
    AudioManager.onRewardsOrMapEntered();
  }

  /**
   * Dismiss the overlay WITHOUT granting a relic (ESC). No-op unless ACTIVE.
   */
  dismiss() {
    if (this._state !== OverlayState.ACTIVE) return;
    this.proceedToNextScene();
  }

  /** @returns {boolean} true while the overlay is visible (any non-INACTIVE state) */
  isActive() {
    return this._state !== OverlayState.INACTIVE;
  }

  /**
   * Entrance fade alpha (0–1). Used by BattleScene to fade the full-canvas
   * dark backdrop in sync with the panel entrance.
   * @returns {number}
   */
  getEntranceAlpha() {
    if (this._state === OverlayState.INACTIVE) return 0;
    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      return 1 - Math.pow(1 - rawT, 3); // ease-out cubic (matches render())
    }
    return 1;
  }

  /**
   * Alpha for the full-canvas dark backdrop, ramped with the entrance.
   * BattleScene paints `rgba(0,0,0,getBackdropAlpha())` full-canvas behind
   * this overlay, matching the map overlay treatment.
   * @returns {number}
   */
  getBackdropAlpha() {
    // Steady full backdrop while active. The reward overlay always follows the
    // Level Up overlay (which already darkened the screen and keeps its backdrop
    // up through its exit), so the backdrop must NOT re-ramp here — that would
    // flicker the dark layer during the handoff. Only the panel grows/fades in.
    return this._state === OverlayState.INACTIVE ? 0 : OVERLAY_BACKDROP_ALPHA;
  }

  /** Force-reset to INACTIVE without firing callbacks (scene-exit cleanup). */
  reset() {
    this._state = OverlayState.INACTIVE;
    this._timer = 0;
    this._hoveredRewardIndex = -1;
    this._hoverAnimT = 0;
    this._isResolvingReward = false;
    this._hoveredButton = null;
  }

  /**
   * Designated home for relic-reward logic. This is where FUTURE reward
   * behavior should live (kept out of the raw click handler):
   *   - grant the relic to the player's run state
   *   - play a reward animation / sound
   *   - show a selection confirmation
   *   - record reward history
   *
   * Today it notifies the host (onRelicSelected) so BattleScene can add the
   * relic to the run state, then proceeds to the next scene. Guards against
   * double-select.
   *
   * @param {object} relicDefinition — the chosen relic definition
   * @param {number} rewardIndex — index of the chosen option (0-based)
   */
  handleRelicRewardSelected(relicDefinition, rewardIndex) {
    if (this._isResolvingReward) return;
    if (!relicDefinition) return;

    // Relic-pick confirmation sound (only on choosing a relic, not skip/ESC).
    // Reuses the map node-selection sound for a consistent "commit" cue.
    AudioManager.playSfx('sfx_map_click_node');

    // ── Future reward-granting logic belongs here (see doc above). ──
    if (typeof this.onRelicSelected === 'function') {
      this.onRelicSelected(relicDefinition, rewardIndex);
    }

    this.proceedToNextScene();
  }

  /**
   * Single exit point: transitions to EXITING and fires onDismiss (→ map).
   * All exit paths (reward click, skip, ESC) flow through here so double
   * input cannot trigger multiple scene transitions.
   */
  proceedToNextScene() {
    if (this._isResolvingReward) return;
    this._isResolvingReward = true;

    this._state = OverlayState.EXITING;
    this._timer = 0;
    this._hoveredRewardIndex = -1;
    this._hoverAnimT = 0;
    this._hoveredButton = null;

    if (typeof this.onDismiss === 'function') {
      this.onDismiss();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Per-frame update
  // ═══════════════════════════════════════════════════════════

  /**
   * Advance entrance timer + hover scale animation.
   * @param {number} dt — delta time in ms
   */
  update(dt) {
    if (this._state === OverlayState.ENTERING) {
      this._timer += dt;
      if (this._timer >= OVERLAY_FADE_DURATION) {
        this._state = OverlayState.ACTIVE;
      }
    }

    if (this._state === OverlayState.ACTIVE && !this._isResolvingReward) {
      const target = this._hoveredRewardIndex >= 0 ? 1 : 0;
      const speed = Math.min(1, (dt / HOVER_ANIM_DURATION) * HOVER_ANIM_SPEED);
      this._hoverAnimT += (target - this._hoverAnimT) * speed;
    }

    if (this._state === OverlayState.EXITING || this._isResolvingReward) {
      this._hoverAnimT = 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Input handling (called by BattleScene while the overlay is active)
  // ═══════════════════════════════════════════════════════════

  /**
   * Hover detection for reward options (scale) and the skip button (asset swap).
   * @param {number} x @param {number} y — canvas coordinates
   */
  handleMouseMove(x, y) {
    if (this._state !== OverlayState.ACTIVE || this._isResolvingReward) return;

    // Reward option hover
    let newRewardHover = -1;
    for (let i = 0; i < this._rewardOptions.length; i++) {
      const opt = this._rewardOptions[i];
      if (opt.visible && opt.hitTest(x, y)) {
        newRewardHover = i;
        break;
      }
    }
    this._hoveredRewardIndex = newRewardHover;

    // Skip button hover (separate element below the panel)
    const overSkip = this._skipButton &&
      this._skipButton.visible &&
      this._skipButton.rect.containsPoint(x, y);
    const newButtonHover = overSkip ? 'skip' : null;

    if (newButtonHover !== this._hoveredButton) {
      if (this._skipButton) {
        this._skipButton.assetKey = overSkip ? 'rewards_button_skip_hover' : 'rewards_button_skip';
      }
      this._hoveredButton = newButtonHover;
    }
  }

  /**
   * Click handling: reward option → grant + next; skip button → next (no relic).
   * @param {number} x @param {number} y — canvas coordinates
   */
  handleMouseDown(x, y) {
    if (this._state !== OverlayState.ACTIVE || this._isResolvingReward) return;

    for (let i = 0; i < this._rewardOptions.length; i++) {
      const opt = this._rewardOptions[i];
      if (opt.visible && opt.hitTest(x, y)) {
        this.handleRelicRewardSelected(opt.relic, i);
        return;
      }
    }

    if (this._skipButton && this._skipButton.visible && this._skipButton.rect.containsPoint(x, y)) {
      this.proceedToNextScene();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  /**
   * Draw the reward overlay (title banner + three vertical cards + skip button)
   * on top of the battle scene. The dark backdrop is painted by BattleScene.
   *
   * Layout: the whole group (title → cards row → skip) is measured, then
   * vertically centered (with GROUP_Y_OFFSET) and each piece positioned within.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   */
  render(ctx, canvasW, canvasH) {
    if (this._state === OverlayState.INACTIVE) return;

    // ── Entrance animation params (fade + grow about center) ──
    let overlayAlpha = 1;
    let enterScale = 1;
    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      const easedT = 1 - Math.pow(1 - rawT, 3); // ease-out cubic
      overlayAlpha = easedT;
      enterScale = OVERLAY_ENTER_FROM_SCALE + (1 - OVERLAY_ENTER_FROM_SCALE) * easedT;
    }

    const cardImg = this._assetManager
      ? this._assetManager.get('rewards_option_panel_vertical')
      : null;
    if (!cardImg || !cardImg.width || !cardImg.height) return;

    ctx.save();
    ctx.globalAlpha = overlayAlpha;

    // ── Card dimensions from the vertical card art aspect ──
    const cardH = canvasH * CARD_HEIGHT_FRAC;
    const cardW = cardH * (cardImg.width / cardImg.height);
    const rowW = cardW * 3 + CARD_SPACING * 2;

    // ── Title banner dimensions from the title art aspect ──
    const titleImg = this._assetManager ? this._assetManager.get('rewards_title_panel') : null;
    let titleW = 0;
    let titleH = 0;
    if (titleImg && titleImg.width && titleImg.height) {
      titleW = canvasW * TITLE_PANEL_WIDTH_FRAC;
      titleH = titleW * (titleImg.height / titleImg.width);
    }

    // ── Skip button dimensions ──
    const skipImg = this._skipButton && this._assetManager
      ? this._assetManager.get(this._skipButton.assetKey)
      : null;
    const skipW = canvasW * SKIP_BUTTON_WIDTH_FRAC;
    const skipH = (skipImg && skipImg.width && skipImg.height)
      ? skipW * (skipImg.height / skipImg.width)
      : SKIP_BUTTON_FALLBACK_HEIGHT;

    // ── Vertically center the whole group ──
    const groupH = titleH + TITLE_GAP_BELOW + cardH + SKIP_REWARDS_BUTTON_Y_OFFSET + skipH;
    const groupTop = (canvasH - groupH) / 2 + GROUP_Y_OFFSET;

    // Entrance grow: scale the whole group about its center (composes with the
    // outer save's globalAlpha; restored by the matching ctx.restore()).
    if (enterScale !== 1) {
      const mcx = canvasW / 2;
      const mcy = groupTop + groupH / 2;
      ctx.translate(mcx, mcy);
      ctx.scale(enterScale, enterScale);
      ctx.translate(-mcx, -mcy);
    }

    const titleX = (canvasW - titleW) / 2;
    const titleY = groupTop;
    const cardsTop = titleY + titleH + TITLE_GAP_BELOW;
    const rowX = (canvasW - rowW) / 2;
    const skipY = cardsTop + cardH + SKIP_REWARDS_BUTTON_Y_OFFSET;

    // ── Title banner + header text ──
    if (titleImg && titleW > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(titleImg, Math.floor(titleX), Math.floor(titleY), Math.ceil(titleW), Math.ceil(titleH));
      ctx.restore();
    }
    this._renderHeader(ctx, canvasW, titleY, titleH);

    // ── Three vertical reward cards in a row ──
    this._renderCards(ctx, rowX, cardsTop, cardW, cardH);

    // ── Skip button below the cards row ──
    this._renderSkipButton(ctx, canvasW, skipY, skipW, skipH);

    ctx.restore(); // globalAlpha
  }

  // ═══════════════════════════════════════════════════════════
  // Private: hierarchy construction
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the UI tree (all elements positioned manually each render):
   *   RewardOptionPanel × 3 (laid out side-by-side in a row)
   *   skipButton (standalone, positioned below the row)
   */
  _buildHierarchy() {
    this._rewardOptions = [];
    for (let i = 0; i < 3; i++) {
      const option = new RewardOptionPanel(this._assetManager);
      option.userData.rewardIndex = i;
      this._rewardOptions.push(option);
    }

    this._skipButton = new UIImage('rewards_button_skip', this._assetManager);
    this._skipButton.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
    });
    this._skipButton.userData = { action: 'skip' };
  }

  // ═══════════════════════════════════════════════════════════
  // Private: render helpers
  // ═══════════════════════════════════════════════════════════

  /** Draw the "Choose a Relic" header centered inside the title banner. */
  _renderHeader(ctx, canvasW, titleY, titleH) {
    const cy = titleH > 0
      ? titleY + titleH * TITLE_TEXT_CENTER_FRAC + TITLE_TEXT_Y_OFFSET
      : titleY + HEADER_FONT_SIZE / 2 + TITLE_TEXT_Y_OFFSET;
    ctx.save();
    ctx.font = `${HEADER_FONT_SIZE}px ${HEADER_FONT_FAMILY}`;
    ctx.fillStyle = HEADER_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillText(HEADER_TEXT, canvasW / 2, cy);
    ctx.restore();
  }

  /**
   * Lay out the three vertical reward cards side-by-side starting at (rowX,
   * cardsTop), then render them — applying a subtle scale + border highlight
   * to the hovered card (drawn last so it sits on top of its neighbours).
   */
  _renderCards(ctx, rowX, cardsTop, cardW, cardH) {
    // Position + size each card, then lay out its children.
    let x = rowX;
    for (let i = 0; i < this._rewardOptions.length; i++) {
      const opt = this._rewardOptions[i];
      opt.rect.x = Math.floor(x);
      opt.rect.y = Math.floor(cardsTop);
      opt.rect.w = cardW;
      opt.rect.h = cardH;
      opt.layoutChildren();
      x += cardW + CARD_SPACING;
    }

    const hoverIndex = this._hoveredRewardIndex;
    const currentScale = 1 + (HOVER_SCALE - 1) * this._hoverAnimT;

    // Render non-hovered cards first, hovered card last (on top).
    let hoveredOption = null;
    for (let i = 0; i < this._rewardOptions.length; i++) {
      const opt = this._rewardOptions[i];
      if (!opt.visible) continue;
      if (i === hoverIndex) {
        hoveredOption = opt;
      } else {
        opt.render(ctx);
      }
    }

    if (hoveredOption) {
      const r = hoveredOption.rect;
      if (currentScale > 1.0001) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(currentScale, currentScale);
        ctx.translate(-cx, -cy);
        hoveredOption.render(ctx);
        this._drawHoverBorder(ctx, r);
        ctx.restore();
      } else {
        hoveredOption.render(ctx);
        this._drawHoverBorder(ctx, r);
      }
    }
  }

  /** Draw a rounded highlight border around a hovered option card. */
  _drawHoverBorder(ctx, r) {
    const x = r.x;
    const y = r.y;
    const w = r.w;
    const h = r.h;
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

  /** Position + render the Skip Rewards button centered below the cards row. */
  _renderSkipButton(ctx, canvasW, skipY, skipW, skipH) {
    if (!this._skipButton) return;

    this._skipButton.rect.x = Math.floor((canvasW - skipW) / 2);
    this._skipButton.rect.y = Math.floor(skipY);
    this._skipButton.rect.w = skipW;
    this._skipButton.rect.h = skipH;
    this._skipButton.render(ctx);
  }
}
