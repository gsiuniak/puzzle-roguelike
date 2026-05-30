/**
 * RewardOverlay — post-battle Victory relic-reward overlay.
 *
 * Renders as a MODAL on top of the still-visible battle scene (not a separate
 * screen). The owning BattleScene paints a full-canvas dark transparent
 * backdrop (see getBackdropAlpha) behind this overlay — same treatment as the
 * map overlay — so the battle stays visible but darkened underneath.
 *
 * Visual layering (this overlay, drawn after the backdrop):
 *   1. Primary rewards panel (reward_screen_panel art), centered
 *   2. "Choose a Relic" header text near the top of the panel
 *   3. Three vertically-stacked RewardOptionPanel cards inside the panel
 *   4. A small, centered "Skip Rewards" button BELOW the panel
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

import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import RewardOptionPanel from './RewardOptionPanel.js';
import AudioManager from '../audio/AudioManager.js';

// ═══════════════════════════════════════════════════════════
// Tunable layout constants
// ═══════════════════════════════════════════════════════════

/** Alpha of the full-canvas dark backdrop (matches the map overlay feel) */
export const OVERLAY_BACKDROP_ALPHA = 0.78;

/** Maximum fraction of canvas width the reward panel occupies */
const PANEL_MAX_WIDTH_FRAC = 0.5;
/** Maximum fraction of canvas height the reward panel occupies */
const PANEL_MAX_HEIGHT_FRAC = 0.82;

/**
 * Vertical offset for the main panel from the canvas center.
 * Negative shifts the panel UP to leave room for the skip button below.
 */
const MAIN_PANEL_Y_OFFSET = -24;

/**
 * Inner padding of the primary panel as FRACTIONS of its rendered size.
 * Top padding clears the ornate header banner; sides/bottom inset the option
 * cards inside the frame art.
 */
const PANEL_PADDING_FRAC = { top: 0.165, right: 0.085, bottom: 0.075, left: 0.085 };

/** Gap between stacked reward option cards (px) */
const REWARD_OPTION_SPACING = 12;

// ── Header ("Choose a Relic") ──────────────────────────────
const HEADER_TEXT = 'Choose a Relic';
/** Header baseline Y as a fraction of panel height from the panel top */
const HEADER_Y_FRAC = 0.092;
const HEADER_FONT_SIZE = 30;
const HEADER_COLOR = '#ccaa77';
const HEADER_FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

// ── Skip Rewards button (below the panel) ──────────────────
/**
 * Vertical offset of the skip button below the bottom edge of the panel (px).
 * Easy to tweak to nudge the button up/down.
 */
const SKIP_REWARDS_BUTTON_Y_OFFSET = 12;
/** Skip button width as a fraction of the panel width */
const SKIP_BUTTON_WIDTH_FRAC = 0.34;
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
/** Fraction of canvas height the panel slides up on entrance */
const OVERLAY_SLIDE_FRACTION = 0.10;

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

    // ── UI tree references (built once) ──
    /** @type {UIContainer} primary panel container — parent of the option cards */
    this._primaryPanel = null;
    /** @type {RewardOptionPanel[]} reward option cards */
    this._rewardOptions = [];
    /** @type {UIImage} skip rewards button (positioned manually below the panel) */
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
    return OVERLAY_BACKDROP_ALPHA * this.getEntranceAlpha();
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
   * Draw the reward overlay (panel + options + header + skip button) on top
   * of the battle scene. The dark backdrop is painted by BattleScene.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   */
  render(ctx, canvasW, canvasH) {
    if (this._state === OverlayState.INACTIVE) return;

    // ── Entrance animation params ──
    let overlayAlpha = 1;
    let containerSlideY = 0;
    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      const easedT = 1 - Math.pow(1 - rawT, 3); // ease-out cubic
      overlayAlpha = easedT;
      containerSlideY = (1 - easedT) * canvasH * OVERLAY_SLIDE_FRACTION;
    }

    const panelImg = this._assetManager ? this._assetManager.get('reward_screen_panel') : null;
    if (!panelImg || !panelImg.width || !panelImg.height) return;

    ctx.save();
    ctx.globalAlpha = overlayAlpha;

    // ── Panel dimensions from image aspect, clamped to max fractions ──
    const maxW = canvasW * PANEL_MAX_WIDTH_FRAC;
    const maxH = canvasH * PANEL_MAX_HEIGHT_FRAC;
    const imgAspect = panelImg.width / panelImg.height;

    let panelW, panelH;
    if (maxW / maxH > imgAspect) {
      panelH = maxH;
      panelW = panelH * imgAspect;
    } else {
      panelW = maxW;
      panelH = panelW / imgAspect;
    }

    const panelX = Math.floor((canvasW - panelW) / 2);
    const panelY = Math.floor((canvasH - panelH) / 2) + MAIN_PANEL_Y_OFFSET + containerSlideY;

    // ── Panel background art ──
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(panelImg, panelX, panelY, Math.ceil(panelW), Math.ceil(panelH));
    ctx.restore();

    // ── Header text ──
    this._renderHeader(ctx, panelX, panelY, panelW, panelH);

    // ── Option cards inside the panel ──
    this._renderPanelChildren(ctx, panelX, panelY, panelW, panelH);

    // ── Skip button below the panel ──
    this._renderSkipButton(ctx, panelX, panelY, panelW, panelH);

    ctx.restore(); // globalAlpha
  }

  // ═══════════════════════════════════════════════════════════
  // Private: hierarchy construction
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the UI tree:
   *   primaryPanel (column) → RewardOptionPanel × 3
   *   skipButton (standalone, positioned below the panel)
   */
  _buildHierarchy() {
    this._primaryPanel = new UIContainer();
    this._primaryPanel.setStyle({
      direction: 'column',
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: REWARD_OPTION_SPACING,
      // padding set dynamically (fractions of panel size) in _renderPanelChildren
    });

    this._rewardOptions = [];
    for (let i = 0; i < 3; i++) {
      const option = new RewardOptionPanel(this._assetManager);
      option.userData.rewardIndex = i;
      this._rewardOptions.push(option);
      this._primaryPanel.addChild(option);
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

  /** Draw the "Choose a Relic" header centered near the panel top. */
  _renderHeader(ctx, panelX, panelY, panelW, panelH) {
    ctx.save();
    ctx.font = `${HEADER_FONT_SIZE}px ${HEADER_FONT_FAMILY}`;
    ctx.fillStyle = HEADER_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillText(HEADER_TEXT, panelX + panelW / 2, panelY + panelH * HEADER_Y_FRAC);
    ctx.restore();
  }

  /**
   * Lay out and render the stacked reward option cards inside the panel,
   * applying a subtle scale + border highlight to the hovered card.
   */
  _renderPanelChildren(ctx, panelX, panelY, panelW, panelH) {
    // Position + size the primary panel to the panel art's inner content area.
    this._primaryPanel.padding = {
      top: panelH * PANEL_PADDING_FRAC.top,
      right: panelW * PANEL_PADDING_FRAC.right,
      bottom: panelH * PANEL_PADDING_FRAC.bottom,
      left: panelW * PANEL_PADDING_FRAC.left,
    };
    this._primaryPanel.rect.x = panelX;
    this._primaryPanel.rect.y = panelY;
    this._primaryPanel.rect.w = panelW;
    this._primaryPanel.rect.h = panelH;
    this._primaryPanel.layoutChildren();

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

  /** Position + render the Skip Rewards button centered below the panel. */
  _renderSkipButton(ctx, panelX, panelY, panelW, panelH) {
    if (!this._skipButton) return;

    const btnW = panelW * SKIP_BUTTON_WIDTH_FRAC;
    let btnH = SKIP_BUTTON_FALLBACK_HEIGHT;
    const img = this._assetManager ? this._assetManager.get(this._skipButton.assetKey) : null;
    if (img && img.width && img.height) {
      btnH = btnW * (img.height / img.width);
    }

    this._skipButton.rect.x = Math.floor(panelX + (panelW - btnW) / 2);
    this._skipButton.rect.y = Math.floor(panelY + panelH + SKIP_REWARDS_BUTTON_Y_OFFSET);
    this._skipButton.rect.w = btnW;
    this._skipButton.rect.h = btnH;
    this._skipButton.render(ctx);
  }
}
