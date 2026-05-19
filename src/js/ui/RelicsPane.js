import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import RelicButton from './RelicButton.js';

// ── Tunable layout constants ─────────────────────────────
// Top padding is intentionally larger to clear the decorative
// `relics_pane_panel` top frame art (the panel image leaves a
// visual gap above its inner grid area).
const PANE_PADDING = { top: 48, right: 14, bottom: 19, left: 14 };
const GRID_GAP = 6;
// Relic slots are vertically oriented (taller than wide) per
// the `relics_locked_button` art aspect ratio.
const SLOT_HEIGHT = 90;

const COLS = 5;
const ROWS = 2;
const SLOT_COUNT = COLS * ROWS;

/**
 * Natural height of the pane = top + bottom padding + N rows + gaps.
 * Used to lock the pane's height so it doesn't stretch inside its column.
 */
const NATURAL_HEIGHT =
  PANE_PADDING.top +
  PANE_PADDING.bottom +
  ROWS * SLOT_HEIGHT +
  (ROWS - 1) * GRID_GAP;

/**
 * RelicsPane — 6×2 grid of RelicButtons.
 *
 * For now every slot is rendered as a `relics_locked_button` placeholder.
 * The pane accepts a relics array so future logic can replace any slot
 * with an active relic button without changing the layout.
 */
export default class RelicsPane extends UIPanel {
  constructor(relics = null, assetManager = null) {
    super();

    this._relics = relics || [];
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'column';
    this.gap = GRID_GAP;
    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'relics_pane_panel';
    // Lock height so the pane stops at the bottom of its last row
    // instead of stretching to fill the column.
    this.height = NATURAL_HEIGHT;

    /** @type {RelicButton[]} */
    this._buttons = [];

    this.buildHierarchy();
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
    for (const btn of this._buttons) btn.setAssetManager(am);
  }

  setRelics(relics) {
    this._relics = relics || [];
    this.clearChildren();
    this._buttons = [];
    this.buildHierarchy();
  }

  buildHierarchy() {
    const total = SLOT_COUNT;
    const relics = this._relics.slice(0, total);

    for (let row = 0; row < ROWS; row++) {
      const rowContainer = new UIContainer();
      rowContainer.direction = 'row';
      rowContainer.gap = GRID_GAP;
      rowContainer.alignItems = 'stretch';
      rowContainer.height = SLOT_HEIGHT;

      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const relicData = idx < relics.length ? relics[idx] : null;
        const btn = new RelicButton(relicData, this._assetManager, { locked: !relicData });
        btn.flexGrow = 1;
        this._buttons.push(btn);
        rowContainer.addChild(btn);
      }
      this.addChild(rowContainer);
    }
  }
}
