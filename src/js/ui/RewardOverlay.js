/**
 * RewardOverlay — post-battle reward screen overlay.
 *
 * Appears after battle completion before returning to the map.
 * Inspired by Slay the Spire's post-battle reward screen.
 *
 * Visual layering:
 *   1. Battle scene remains visible underneath (non-interactive)
 *   2. Semi-transparent black fullscreen backdrop
 *   3. Victory title image positioned above the main panel
 *   4. Centered reward panel (reward_screen_panel) containing:
 *      - Three reward option containers in a row
 *      - Centered Claim Reward button
 *      - Centered Skip Rewards button near bottom
 *
 * Lifecycle:
 *   show()     — activate the overlay (called by BattleScene on GAME_OVER)
 *   dismiss()  — deactivate and fire onDismiss callback
 *   update(dt) — advance animations (placeholder for future cross-fade transition)
 *   render(ctx, w, h) — draw backdrop + reward UI tree
 *   isActive() — true while the overlay is visible
 *   reset()    — force-reset to inactive (cleanup on scene exit)
 *
 * Input behavior:
 *   - Blocks all gameplay input while active (handled by BattleScene)
 *   - ESC key advances to next state (triggers dismiss → MapScene transition)
 *
 * Architecture:
 *   The overlay uses the UI framework (UIContainer/UIPanel/UIImage) for the
 *   primary panel's internal layout (rewards row + buttons). The dark backdrop
 *   and victory title are drawn directly via raw Canvas 2D for simpler
 *   absolute positioning. Reward option containers are UIPanels with
 *   rewards_option_panel backgrounds — extensible for future content.
 */

import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import UIImage from './UIImage.js';

// ═══════════════════════════════════════════════════════════
// Tunable layout constants
// ═══════════════════════════════════════════════════════════

/** Backdrop alpha for the dark overlay covering the entire canvas */
const BACKDROP_ALPHA = 0.72;

/** Maximum fraction of canvas width the reward panel occupies */
const PANEL_MAX_WIDTH_FRAC = 0.55;

/** Maximum fraction of canvas height the reward panel occupies */
const PANEL_MAX_HEIGHT_FRAC = 0.70;

/**
 * Vertical offset for the main panel from the canvas center.
 * Positive = shifted down, negative = shifted up.
 */
const MAIN_PANEL_Y_OFFSET = 10;

/**
 * Vertical offset for the victory title relative to the top of the primary panel.
 * Negative = title sits above / overlaps the panel top edge.
 */
const REWARD_TITLE_Y_OFFSET = -28;

/**
 * Width of the victory title as a fraction of the primary panel width.
 */
const TITLE_WIDTH_FRAC = 0.78;

/** Primary panel internal padding */
const PRIMARY_PANEL_PADDING = { top: 28, right: 36, bottom: 24, left: 36 };

/** Gap between sections inside the primary panel (rewards row / claim button / skip button) */
const PRIMARY_PANEL_GAP = 18;

/** Gap between reward option panels in the row */
const REWARD_OPTION_SPACING = 20;

/** Width of each reward option panel as a fraction of the primary panel's content width */
const REWARD_OPTION_WIDTH_FRAC = 0.28;

/** Height of the Claim Reward button (contain fit mode within) */
const CLAIM_BUTTON_HEIGHT = 56;

/** Width of the Claim Reward button as a fraction of the primary panel's content width */
const CLAIM_BUTTON_WIDTH_FRAC = 0.50;

/**
 * Extra top margin for the Skip Rewards button.
 * Tweak this to adjust the skip button's vertical position relative to the
 * element above it (claim button).
 */
const SKIP_REWARDS_BUTTON_Y_OFFSET = 4;

/** Height of the Skip Rewards button (contain fit mode within) */
const SKIP_BUTTON_HEIGHT = 32;

/** Width of the Skip Rewards button as a fraction of the primary panel's content width */
const SKIP_BUTTON_WIDTH_FRAC = 0.22;

// ── Overlay state enum ────────────────────────────────────
/** @readonly @enum {string} */
const OverlayState = Object.freeze({
  INACTIVE: 'inactive',
  ACTIVE: 'active',
});

export default class RewardOverlay {
  /**
   * @param {object} deps
   * @param {import('../engine/AssetManager.js').default} deps.assetManager
   * @param {Function} [deps.onDismiss] — callback invoked when overlay is dismissed
   */
  constructor({ assetManager, onDismiss } = {}) {
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = assetManager || null;

    /**
     * Callback invoked when the overlay is dismissed (ESC pressed).
     * The parent scene (BattleScene) wires this to transition back to MapScene.
     * @type {Function|null}
     */
    this.onDismiss = onDismiss || null;

    /** @type {string} one of OverlayState values */
    this._state = OverlayState.INACTIVE;

    /**
     * Elapsed time since activation (ms).
     * Reserved for future cross-fade / transition animation.
     * @type {number}
     */
    this._timer = 0;

    /** @type {boolean} whether dismiss has already been triggered */
    this._dismissTriggered = false;

    /**
     * Which button is currently hovered: null, 'claim', or 'skip'.
     * @type {string|null}
     */
    this._hoveredButton = null;

    // ── UI tree references (built once) ──
    /** @type {UIContainer} primary panel container — parent of all reward UI */
    this._primaryPanel = null;
    /** @type {UIContainer} rewards row container */
    this._rewardsRow = null;
    /** @type {UIPanel[]} three reward option containers */
    this._rewardOptions = [];
    /** @type {UIImage} claim reward button */
    this._claimButton = null;
    /** @type {UIImage} skip rewards button */
    this._skipButton = null;

    this._buildHierarchy();
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  /** Activate the overlay. No-op if already active. */
  show() {
    if (this._state === OverlayState.ACTIVE) return;
    this._state = OverlayState.ACTIVE;
    this._timer = 0;
    this._dismissTriggered = false;
  }

  /**
   * Dismiss the overlay and fire the onDismiss callback.
   * No-op if already dismissed or not active.
   */
  dismiss() {
    if (this._state !== OverlayState.ACTIVE || this._dismissTriggered) return;
    this._dismissTriggered = true;
    this._state = OverlayState.INACTIVE;
    this._timer = 0;

    if (typeof this.onDismiss === 'function') {
      this.onDismiss();
    }
  }

  /** @returns {boolean} true if the overlay is currently visible */
  isActive() {
    return this._state === OverlayState.ACTIVE;
  }

  /**
   * Force-reset the overlay to INACTIVE without firing the callback.
   * Use when the owning scene is exiting to ensure clean state.
   */
  reset() {
    this._state = OverlayState.INACTIVE;
    this._timer = 0;
    this._dismissTriggered = false;
  }

  // ═══════════════════════════════════════════════════════════
  // Per-frame update
  // ═══════════════════════════════════════════════════════════

  /**
   * Advance overlay animation timer.
   * Currently a no-op; reserved for future cross-fade / slide-in transition.
   * Call once per frame from the owning scene's update().
   *
   * @param {number} dt — delta time in ms
   */
  update(dt) {
    if (this._state !== OverlayState.ACTIVE) return;
    this._timer += dt;
    // TODO: Future transition animations will interpolate based on _timer.
  }

  // ═══════════════════════════════════════════════════════════
  // Input handling (called by BattleScene when overlay is active)
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle mouse movement for hover effects on claim/skip buttons.
   * Swaps the button's assetKey between normal and _hover variant based
   * on whether the cursor is over the button.
   *
   * @param {number} x — mouse x in canvas coordinates
   * @param {number} y — mouse y in canvas coordinates
   */
  handleMouseMove(x, y) {
    if (this._state !== OverlayState.ACTIVE) return;

    const hit = this._primaryPanel ? this._primaryPanel.hitTest(x, y) : null;

    // Determine which button (if any) is hovered
    let newHover = null;
    if (hit === this._claimButton) {
      newHover = 'claim';
    } else if (hit === this._skipButton) {
      newHover = 'skip';
    }

    // Only swap assetKeys when hover state changes
    if (newHover !== this._hoveredButton) {
      // Restore previous hovered button to its normal asset
      if (this._hoveredButton === 'claim' && this._claimButton) {
        this._claimButton.assetKey = 'rewards_button_confirm';
      } else if (this._hoveredButton === 'skip' && this._skipButton) {
        this._skipButton.assetKey = 'rewards_button_skip';
      }

      // Set new hovered button to its hover asset
      if (newHover === 'claim' && this._claimButton) {
        this._claimButton.assetKey = 'rewards_button_confirm_hover';
      } else if (newHover === 'skip' && this._skipButton) {
        this._skipButton.assetKey = 'rewards_button_skip_hover';
      }

      this._hoveredButton = newHover;
    }
  }

  /**
   * Handle mouse click on claim/skip buttons.
   * Both buttons dismiss the overlay and proceed to the next screen.
   *
   * @param {number} x — mouse x in canvas coordinates
   * @param {number} y — mouse y in canvas coordinates
   */
  handleMouseDown(x, y) {
    if (this._state !== OverlayState.ACTIVE) return;

    const hit = this._primaryPanel ? this._primaryPanel.hitTest(x, y) : null;

    if (hit === this._claimButton || hit === this._skipButton) {
      this.dismiss();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  /**
   * Render the reward overlay on top of the battle scene.
   *
   * Draws in this order:
   *   1. Semi-transparent black fullscreen backdrop (raw canvas)
   *   2. Victory title image centered above the panel (raw canvas)
   *   3. Primary panel background image (raw canvas)
   *   4. Panel children via UI framework (rewards row, claim button, skip button)
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW — full canvas width
   * @param {number} canvasH — full canvas height
   */
  render(ctx, canvasW, canvasH) {
    if (this._state !== OverlayState.ACTIVE) return;

    // ── 1. Semi-transparent black fullscreen backdrop ──
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKDROP_ALPHA})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // ── 2. Calculate primary panel dimensions from image aspect ratio ──
    const panelImg = this._assetManager
      ? this._assetManager.get('reward_screen_panel')
      : null;
    if (!panelImg || !panelImg.width || !panelImg.height) return;

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
    const panelY = Math.floor((canvasH - panelH) / 2) + MAIN_PANEL_Y_OFFSET;

    // ── 3. Victory title image — centered above the primary panel ──
    if (this._assetManager) {
      const titleImg = this._assetManager.get('reward_victory_text');
      if (titleImg && titleImg.width && titleImg.height) {
        const titleW = panelW * TITLE_WIDTH_FRAC;
        const titleH = titleW * (titleImg.height / titleImg.width);
        const titleX = Math.floor(panelX + (panelW - titleW) / 2);
        const titleY = Math.floor(panelY + REWARD_TITLE_Y_OFFSET);

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

    // ── 4. Primary panel background ──
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

    // ── 5. Layout and render panel children via UI framework ──
    this._renderPanelChildren(ctx, panelX, panelY, panelW, panelH);
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
   *     claimButton (UIImage with rewards_button_confirm)
   *     skipButton (UIImage with rewards_button_skip)
   */
  _buildHierarchy() {
    // ── Primary panel container ─────────────────────────
    this._primaryPanel = new UIContainer();
    this._primaryPanel.setStyle({
      direction: 'column',
      alignItems: 'center',
      justifyContent: 'start',
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

    // ── Claim Reward button ─────────────────────────────
    this._claimButton = new UIImage('rewards_button_confirm', this._assetManager);
    this._claimButton.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      // width/height set dynamically in _renderPanelChildren
    });
    this._claimButton.userData = { action: 'claim' };
    this._primaryPanel.addChild(this._claimButton);

    // ── Skip Rewards button ─────────────────────────────
    this._skipButton = new UIImage('rewards_button_skip', this._assetManager);
    this._skipButton.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      margin: { top: SKIP_REWARDS_BUTTON_Y_OFFSET },
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
    let optionH = optionW * 1.4;
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

    // ── Compute button sizes ────────────────────────────
    this._claimButton.width = Math.floor(contentW * CLAIM_BUTTON_WIDTH_FRAC);
    this._claimButton.height = CLAIM_BUTTON_HEIGHT;

    this._skipButton.width = Math.floor(contentW * SKIP_BUTTON_WIDTH_FRAC);
    this._skipButton.height = SKIP_BUTTON_HEIGHT;

    // ── Run flexbox layout ──────────────────────────────
    this._primaryPanel.layoutChildren();

    // ── Render children (skips panel background — drawn manually above) ──
    this._primaryPanel.renderChildren(ctx);
  }
}
