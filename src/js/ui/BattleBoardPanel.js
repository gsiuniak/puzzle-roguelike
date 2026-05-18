import UIPanel from './UIPanel.js';

// ── Tunable layout constants ─────────────────────────────
// Padding is biased to match the decorative `battle_board_panel`
// frame artwork — the inner playable area sits inset from the panel
// edges. Tune these per asset.
const PANEL_PADDING = { top: 36, right: 36, bottom: 36, left: 36 };

/**
 * BattleBoardPanel — wrapper panel that visually encases the board.
 *
 * Uses `battle_board_panel` as the background image and provides
 * internal padding so the BoardPlaceholder child can lay out inside
 * the decorative frame without overlapping its borders.
 *
 * The actual board (BoardPlaceholder) is added as a child by the
 * BattleScene; this component only owns layout and background art.
 */
export default class BattleBoardPanel extends UIPanel {
  constructor(assetManager = null) {
    super();
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'column';
    this.alignItems = 'stretch';
    this.padding = PANEL_PADDING;
    this.backgroundAssetKey = 'battle_board_panel';
  }

  setAssetManager(am) {
    this.assetManager = am;
  }
}
