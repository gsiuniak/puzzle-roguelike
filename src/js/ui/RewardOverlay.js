/**
 * RewardOverlay — post-battle reward screen overlay.
 *
 * Appears after battle completion before returning to the map.
 * Inspired by Slay the Spire's post-battle reward screen.
 *
 * Visual layering:
 *   1. Battle scene remains visible underneath (non-interactive)
 *   2. rewards_background_splash drawn cover-style with controlled opacity
 *   3. Victory title image positioned above the main panel
 *   4. Centered reward panel (reward_screen_panel) containing:
 *      - Three reward option containers in a row
 *      - Centered Skip Rewards button near bottom
 *
 * Lifecycle:
 *   show()     — begin entrance animation (fade + slide, same as map overlay)
 *   dismiss()  — fire onDismiss immediately; EXITING state guards against
 *                double-trigger. Overlay stays rendered at full opacity during
 *                the SceneManager's fadeToScene transition.
 *   update(dt) — advance entrance animation timer
 *   render(ctx, w, h) — draw backdrop + reward UI tree with animated transform
 *   isActive() — true while the overlay is visible (any non-INACTIVE state)
 *   reset()    — force-reset to INACTIVE without callback (cleanup on scene exit)
 *
 * States (OverlayState):
 *   INACTIVE — not rendered, no interaction
 *   ENTERING — entrance animation: ease-out cubic fade + slide up from bottom
 *   ACTIVE   — fully visible, interactive
 *   EXITING  — dismissed; rendered at full opacity (SceneManager handles cross-fade)
 *
 * Input behavior:
 *   - Only ACTIVE state allows click/hover on the skip button
 *   - During ENTERING/EXITING all input is ignored (handled by BattleScene)
 *   - ESC key dismisses (triggers EXITING → onDismiss → fadeToScene transition)
 *
 * Architecture:
 *   The overlay uses the UI framework (UIContainer/UIPanel/UIImage) for the
 *   primary panel's internal layout (rewards row + skip button). The splash backdrop
 *   and victory title are drawn directly via raw Canvas 2D for simpler
 *   absolute positioning. Reward option containers are UIPanels with
 *   rewards_option_panel backgrounds — extensible for future content.
 */

import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import UIImage from './UIImage.js';
import AudioManager from '../audio/AudioManager.js';

// ═══════════════════════════════════════════════════════════
// Tunable layout constants
// ═══════════════════════════════════════════════════════════

/** Maximum fraction of canvas width the reward panel occupies */
const PANEL_MAX_WIDTH_FRAC = 0.66;

/** Maximum fraction of canvas height the reward panel occupies */
const PANEL_MAX_HEIGHT_FRAC = 0.6;

/**
 * Vertical offset for the main panel from the canvas center.
 * Positive = shifted down, negative = shifted up.
 */
const MAIN_PANEL_Y_OFFSET = 40;

/**
 * How far the bottom of the victory title image extends past the top edge
 * of the primary panel (in px). Positive = title overlaps/nestles into the
 * panel's top groove.
 */
const TITLE_NESTLE_OVERLAP = 14;

/**
 * Width of the victory title as a fraction of the primary panel width.
 */
const TITLE_WIDTH_FRAC = 0.45;

/** Primary panel internal padding */
const PRIMARY_PANEL_PADDING = { top: 28, right: 36, bottom: 24, left: 36 };

/** Gap between sections inside the primary panel (rewards row / skip button) */
const PRIMARY_PANEL_GAP = 18;

/** Gap between reward option panels in the row */
const REWARD_OPTION_SPACING = 10;

/** Width of each reward option panel as a fraction of the primary panel's content width */
const REWARD_OPTION_WIDTH_FRAC = 0.31;

/**
 * Extra bottom margin for the Skip Rewards button.
 * Provides a little padding beneath the button so it sits slightly higher
 * and nestles into the panel's bottom notch.
 */
const SKIP_REWARDS_BUTTON_BOTTOM_MARGIN = 8;

/** Height of the Skip Rewards button (contain fit mode within) */
const SKIP_BUTTON_HEIGHT = 50;

/** Width of the Skip Rewards button as a fraction of the primary panel's content width */
const SKIP_BUTTON_WIDTH_FRAC = 0.22;

// ── Overlay animation constants ────────────────────────────
/** Duration of the entrance/exit animation (ms) */
const OVERLAY_FADE_DURATION = 170;
/** Fraction of canvas height the panel slides up on entrance */
const OVERLAY_SLIDE_FRACTION = 0.10;

// ── Reward option hover animation constants ──────────────
/** Scale factor applied to a hovered reward option (subtle UI emphasis) */
const HOVER_SCALE = 1.04;
/** Duration of the hover-in / hover-out scale animation (ms) */
const HOVER_ANIM_DURATION = 100;
/** Multiplier for animation responsiveness (higher = snappier lerp) */
const HOVER_ANIM_SPEED = 4;

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
   * @param {Function} [deps.onDismiss] — callback invoked when exit animation completes
   */
  constructor({ assetManager, onDismiss } = {}) {
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = assetManager || null;

    /**
     * Callback invoked when the overlay exit animation completes.
     * The parent scene (BattleScene) wires this to transition back to MapScene.
     * @type {Function|null}
     */
    this.onDismiss = onDismiss || null;

    /** @type {string} one of OverlayState values */
    this._state = OverlayState.INACTIVE;

    /**
     * Elapsed animation time (ms). Tracks entrance and exit animation progress.
     * @type {number}
     */
    this._timer = 0;

    /**
     * Which button is currently hovered: null or 'skip'.
     * @type {string|null}
     */
    this._hoveredButton = null;

    /**
     * Index of the currently hovered reward option (-1 = none).
     * @type {number}
     */
    this._hoveredRewardIndex = -1;

    /**
     * Current hover scale animation progress (0-1).
     * Lerps toward 1 when a reward is hovered, toward 0 when not.
     * @type {number}
     */
    this._hoverAnimT = 0;

    /**
     * Guard flag: prevents double-click / multi-transition once a reward
     * has been selected or the skip button has been pressed.
     * @type {boolean}
     */
    this._isResolvingReward = false;

    // ── UI tree references (built once) ──
    /** @type {UIContainer} primary panel container — parent of all reward UI */
    this._primaryPanel = null;
    /** @type {UIContainer} rewards row container */
    this._rewardsRow = null;
    /** @type {UIPanel[]} three reward option containers */
    this._rewardOptions = [];
    /** @type {UIImage} skip rewards button */
    this._skipButton = null;

    this._buildHierarchy();
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

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
    // Notify the audio system that we're entering the rewards screen.
    // In persistent battle music mode this ensures normal battle music
    // is playing at the reduced background volume.
    AudioManager.onRewardsOrMapEntered();
  }

  /**
   * Dismiss the overlay and transition to the next scene.
   * Delegates to proceedToNextScene() for shared transition logic.
   * No-op if not ACTIVE (prevents double-dismiss).
   */
  dismiss() {
    if (this._state !== OverlayState.ACTIVE) return;
    this.proceedToNextScene();
  }

  /** @returns {boolean} true if the overlay is currently visible (any non-INACTIVE state) */
  isActive() {
    return this._state !== OverlayState.INACTIVE;
  }

  /**
   * Current entrance fade alpha (0–1). 0 while INACTIVE; eased ramp during
   * ENTERING; 1 while ACTIVE/EXITING. Used by BattleScene to fade the
   * rewards_background_splash across the entire physical canvas in sync
   * with the overlay's panel entrance.
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
   * Force-reset the overlay to INACTIVE without firing the callback.
   * Use when the owning scene is exiting to ensure clean state.
   */
  reset() {
    this._state = OverlayState.INACTIVE;
    this._timer = 0;
    this._hoveredRewardIndex = -1;
    this._hoverAnimT = 0;
    this._isResolvingReward = false;
    this._hoveredButton = null;
  }

  /**
   * Intermediary handler called when a specific reward option is clicked.
   *
   * This is the designated place to add future reward-granting logic:
   *   - grant card / relic / stat reward
   *   - update player run state
   *   - play reward animation / sound
   *   - save chosen reward
   *   - disable further input while resolving
   *
   * Guards against double-click; delegates the actual transition to
   * proceedToNextScene() which is the single point for setting the
   * resolving flag and firing the dismiss callback.
   *
   * Currently advances to the next scene immediately.
   *
   * @param {UIPanel} rewardOption — the clicked reward option UI element
   * @param {number} rewardIndex — index of the chosen reward (0-2)
   */
  handleRewardSelected(rewardOption, rewardIndex) {
    if (this._isResolvingReward) return;

    // ── Future reward-granting logic goes here ──────────
    // console.log(`[RewardOverlay] Reward ${rewardIndex} selected.`);
    // TODO: grant card/relic/stat, update player run state, play animation, etc.
    // ─────────────────────────────────────────────────────

    this.proceedToNextScene();
  }

  /**
   * Shared transition: exits the overlay and fires the onDismiss callback
   * which triggers the SceneManager's fadeToScene back to the map.
   *
   * This is the single point that sets _isResolvingReward and transitions
   * state to EXITING. All exit paths (reward click, skip button, ESC key)
   * flow through here so double-click / double-skip cannot trigger
   * multiple scene transitions.
   */
  proceedToNextScene() {
    if (this._isResolvingReward) return;
    this._isResolvingReward = true;

    this._state = OverlayState.EXITING;
    this._timer = 0;

    // Disable further hover / click interactions
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
   * Advance overlay animation timer and hover scale animation.
   * Call once per frame from the owning scene's update().
   *
   * @param {number} dt — delta time in ms
   */
  update(dt) {
    // ── Entrance animation timer ──
    if (this._state === OverlayState.ENTERING) {
      this._timer += dt;
      if (this._timer >= OVERLAY_FADE_DURATION) {
        this._state = OverlayState.ACTIVE;
      }
    }

    // ── Hover scale animation ──
    // Interactable only while ACTIVE and not resolving
    if (this._state === OverlayState.ACTIVE && !this._isResolvingReward) {
      const target = this._hoveredRewardIndex >= 0 ? 1 : 0;
      const speed = Math.min(1, (dt / HOVER_ANIM_DURATION) * HOVER_ANIM_SPEED);
      this._hoverAnimT += (target - this._hoverAnimT) * speed;
    }

    // Always return to 0 when exiting or resolving
    if (this._state === OverlayState.EXITING || this._isResolvingReward) {
      this._hoverAnimT = 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Input handling (called by BattleScene when overlay is active)
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle mouse movement for hover effects on reward options and the skip button.
   *
   * Reward options: Animate a subtle scale-up (HOVER_SCALE) on hover.
   * Skip button: Swaps assetKey between normal and _hover variant.
   *
   * @param {number} x — mouse x in canvas coordinates
   * @param {number} y — mouse y in canvas coordinates
   */
  handleMouseMove(x, y) {
    // Only allow interaction while fully active and not resolving
    if (this._state !== OverlayState.ACTIVE || this._isResolvingReward) return;

    const hit = this._primaryPanel ? this._primaryPanel.hitTest(x, y) : null;

    // ── Reward option hover detection ──────────────────
    let newRewardHover = -1;
    if (hit) {
      for (let i = 0; i < this._rewardOptions.length; i++) {
        if (hit === this._rewardOptions[i]) {
          newRewardHover = i;
          break;
        }
      }
    }

    // Update hovered reward index (scale animation lerps toward target in update())
    this._hoveredRewardIndex = newRewardHover;

    // ── Skip button hover detection ────────────────────
    let newButtonHover = null;
    if (hit === this._skipButton) {
      newButtonHover = 'skip';
    }

    // Only swap assetKeys when button hover state changes
    if (newButtonHover !== this._hoveredButton) {
      // Restore previous hovered button to its normal asset
      if (this._hoveredButton === 'skip' && this._skipButton) {
        this._skipButton.assetKey = 'rewards_button_skip';
      }

      // Set new hovered button to its hover asset
      if (newButtonHover === 'skip' && this._skipButton) {
        this._skipButton.assetKey = 'rewards_button_skip_hover';
      }

      this._hoveredButton = newButtonHover;
    }
  }

  /**
   * Handle mouse click on reward options or the skip button.
   *
   * Reward option click → handleRewardSelected() → proceedToNextScene()
   * Skip button click    → proceedToNextScene()
   *
   * @param {number} x — mouse x in canvas coordinates
   * @param {number} y — mouse y in canvas coordinates
   */
  handleMouseDown(x, y) {
    // Only allow interaction while fully active and not resolving
    if (this._state !== OverlayState.ACTIVE || this._isResolvingReward) return;

    const hit = this._primaryPanel ? this._primaryPanel.hitTest(x, y) : null;

    // ── Check reward option clicks ─────────────────────
    for (let i = 0; i < this._rewardOptions.length; i++) {
      if (hit === this._rewardOptions[i]) {
        this.handleRewardSelected(this._rewardOptions[i], i);
        return;
      }
    }

    // ── Check skip button click ────────────────────────
    if (hit === this._skipButton) {
      this.proceedToNextScene();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  /**
   * Render the reward overlay on top of the battle scene.
   *
   * Draws in this order:
   *   1. rewards_background_splash drawn cover-style with controlled opacity (raw canvas)
   *   2. Primary panel background image (raw canvas)
   *   3. Victory title image on top, bottom nestled into panel groove (raw canvas)
   *   4. Panel children via UI framework (rewards row, skip button)
   *
   * Animation:
   *   ENTERING — ease-out cubic: fades in + slides up from bottom
   *   EXITING  — ease-in cubic: cross-fades out (no slide)
   *   ACTIVE   — full opacity, no transform
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW — full canvas width
   * @param {number} canvasH — full canvas height
   */
  render(ctx, canvasW, canvasH) {
    if (this._state === OverlayState.INACTIVE) return;

    // ── Compute animation parameters ──
    let overlayAlpha = 1;
    let containerSlideY = 0;

    if (this._state === OverlayState.ENTERING) {
      const rawT = Math.min(1, this._timer / OVERLAY_FADE_DURATION);
      // ease-out cubic: fast start, gentle settle (same as map overlay)
      const easedT = 1 - Math.pow(1 - rawT, 3);
      overlayAlpha = easedT;
      containerSlideY = (1 - easedT) * canvasH * OVERLAY_SLIDE_FRACTION;
    }
    // ACTIVE / EXITING: overlayAlpha=1, containerSlideY=0 (full opacity, no transform)
    // EXITING renders at full opacity — the SceneManager's fadeToScene handles
    // the cross-fade to black on top of the overlay.

    // Wrap all drawing in a save/restore with globalAlpha for cross-fade.
    // The rewards_background_splash is painted full-canvas (covering the
    // letterbox/pillarbox bars) by BattleScene.renderBackground, in sync with
    // this overlay's entrance fade via getEntranceAlpha().
    ctx.save();
    ctx.globalAlpha = overlayAlpha;

    // ── 2. Calculate primary panel dimensions from image aspect ratio ──
    const panelImg = this._assetManager
      ? this._assetManager.get('reward_screen_panel')
      : null;
    if (!panelImg || !panelImg.width || !panelImg.height) {
      ctx.restore();
      return;
    }

    const maxW = canvasW * PANEL_MAX_WIDTH_FRAC;
    const maxH = canvasH * PANEL_MAX_HEIGHT_FRAC;
    const imgAspect = panelImg.width / panelImg.height;

    let panelW, panelH;
    if (maxW / maxH > imgAspect) {
      // Height-constrained
      panelH = maxH;
      panelW = panelH * imgAspect;
    } else {
      // Width-constrained
      panelW = maxW;
      panelH = panelW / imgAspect;
    }

    const panelX = Math.floor((canvasW - panelW) / 2);
    // Slide the panel and title upward on entrance
    const panelY = Math.floor((canvasH - panelH) / 2) + MAIN_PANEL_Y_OFFSET + containerSlideY;

    // ── 3. Primary panel background ──
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      panelImg,
      panelX,
      panelY,
      Math.ceil(panelW),
      Math.ceil(panelH),
    );
    ctx.restore();

    // ── 4. Victory title image — on top, bottom nestled into panel groove ──
    if (this._assetManager) {
      const titleImg = this._assetManager.get('reward_victory_text');
      if (titleImg && titleImg.width && titleImg.height) {
        const titleW = panelW * TITLE_WIDTH_FRAC;
        const titleH = titleW * (titleImg.height / titleImg.width);
        const titleX = Math.floor(panelX + (panelW - titleW) / 2);
        // Position so the bottom of the title overlaps the panel top by TITLE_NESTLE_OVERLAP px
        const titleY = Math.floor(panelY - titleH + TITLE_NESTLE_OVERLAP);

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          titleImg,
          titleX,
          titleY,
          Math.ceil(titleW),
          Math.ceil(titleH),
        );
        ctx.restore();
      }
    }

    // ── 5. Layout and render panel children via UI framework ──
    this._renderPanelChildren(ctx, panelX, panelY, panelW, panelH);

    ctx.restore(); // globalAlpha
  }

  // ═══════════════════════════════════════════════════════════
  // Private: hierarchy construction
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the UI framework tree for the primary panel's contents.
   *
   * Hierarchy:
   *   primaryPanel (UIContainer, column)
   *     rewardsRow (UIContainer, row)
   *       rewardOptionContainer (UIPanel with rewards_option_panel) × 3
   *     skipButton (UIImage with rewards_button_skip)
   */
  _buildHierarchy() {
    // ── Primary panel container ─────────────────────────
    this._primaryPanel = new UIContainer();
    this._primaryPanel.setStyle({
      direction: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: PRIMARY_PANEL_GAP,
      padding: PRIMARY_PANEL_PADDING,
    });

    // ── Rewards row — 3 reward option containers ────────
    this._rewardsRow = new UIContainer();
    this._rewardsRow.setStyle({
      direction: 'row',
      gap: REWARD_OPTION_SPACING,
      justifyContent: 'center',
      alignItems: 'center',
      margin: { top: 20 }
    });

    this._rewardOptions = [];
    for (let i = 0; i < 3; i++) {
      const option = new UIPanel();
      option.setStyle({
        backgroundAssetKey: 'rewards_option_panel',
        assetManager: this._assetManager,
        // width/height set dynamically in _renderPanelChildren based on
        // panel content dimensions and reward option image aspect ratio.
      });
      // userData for future identification (selection state, tooltip anchor, etc.)
      option.userData = { rewardIndex: i };
      this._rewardOptions.push(option);
      this._rewardsRow.addChild(option);
    }

    this._primaryPanel.addChild(this._rewardsRow);

    // ── Skip Rewards button ─────────────────────────────
    this._skipButton = new UIImage('rewards_button_skip', this._assetManager);
    this._skipButton.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      margin: { bottom: SKIP_REWARDS_BUTTON_BOTTOM_MARGIN },
      // width/height set dynamically in _renderPanelChildren
    });
    this._skipButton.userData = { action: 'skip' };
    this._primaryPanel.addChild(this._skipButton);
  }

  // ═══════════════════════════════════════════════════════════
  // Private: panel children layout & render
  // ═══════════════════════════════════════════════════════════

  /**
   * Size, layout, and render the primary panel's children using the UI
   * framework's flexbox layout system.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} panelX
   * @param {number} panelY
   * @param {number} panelW
   * @param {number} panelH
   */
  _renderPanelChildren(ctx, panelX, panelY, panelW, panelH) {
    // Set the primary panel's rect for layout calculations
    this._primaryPanel.rect.x = panelX;
    this._primaryPanel.rect.y = panelY;
    this._primaryPanel.rect.w = panelW;
    this._primaryPanel.rect.h = panelH;

    // ── Compute reward option panel sizes ───────────────
    const padding = this._primaryPanel._resolvePadding();
    const contentW = panelW - padding.left - padding.right;

    const optionW = contentW * REWARD_OPTION_WIDTH_FRAC;

    // Height from option panel image aspect ratio (with fallback)
    let optionH = optionW * 1.7;
    if (this._assetManager) {
      const optImg = this._assetManager.get('rewards_option_panel');
      if (optImg && optImg.width && optImg.height) {
        optionH = optionW * (optImg.height / optImg.width);
      }
    }

    for (const opt of this._rewardOptions) {
      opt.width = Math.floor(optionW);
      opt.height = Math.floor(optionH);
    }

    // ── Compute skip button size ────────────────────────
    this._skipButton.width = Math.floor(contentW * SKIP_BUTTON_WIDTH_FRAC);
    this._skipButton.height = SKIP_BUTTON_HEIGHT;

    // ── Run flexbox layout ──────────────────────────────
    this._primaryPanel.layoutChildren();

    // ── Render children with hover scale transform ──────
    // The hovered reward option is scaled around its center and rendered
    // on top of neighboring items for clean visual layering.
    const hoverIndex = this._hoveredRewardIndex;
    const currentScale = 1 + (HOVER_SCALE - 1) * this._hoverAnimT;

    // 1) Render reward options: non-hovered first, hovered last (on top)
    const rewardChildren = this._rewardsRow.children;
    const nonHovered = [];
    let hoveredOption = null;

    for (let i = 0; i < rewardChildren.length; i++) {
      if (i === hoverIndex) {
        hoveredOption = rewardChildren[i];
      } else {
        nonHovered.push(rewardChildren[i]);
      }
    }

    // Render non-hovered reward options normally
    for (const child of nonHovered) {
      child.render(ctx);
    }

    // Render the hovered reward option with scale transform around its center
    if (hoveredOption && currentScale > 1.0) {
      const r = hoveredOption.rect;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(currentScale, currentScale);
      ctx.translate(-cx, -cy);
      hoveredOption.render(ctx);
      ctx.restore();
    } else if (hoveredOption) {
      // No active scale — render normally
      hoveredOption.render(ctx);
    }

    // 2) Render skip button
    this._skipButton.render(ctx);
  }
}
