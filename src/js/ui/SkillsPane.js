import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import SkillButton from './SkillButton.js';

// ── Tunable layout constants ─────────────────────────────
// Top padding is intentionally larger to clear the decorative
// `skill_pane_panel` top frame art (a "Skills" label / arc area
// is reserved in the panel image).
const PANE_PADDING = { top: 48, right: 20, bottom: 24, left: 20 };
const GRID_GAP = 6;
const SLOT_HEIGHT = 105; // 126;

// Default capacity matches the mock (2 columns × 3 rows).
const COLS = 1;
const ROWS = 6; // 5;
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
 * SkillsPane — 2x3 grid of SkillButtons.
 *
 * Fills slots with the character's skills first, then pads remaining
 * slots with locked placeholder buttons. The pane is data-driven via
 * setSkills() / updateFromState() (mana state for affordability).
 */
export default class SkillsPane extends UIPanel {
  constructor(skills = null, assetManager = null) {
    super();

    this._skills = skills || [];
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'column';
    this.gap = GRID_GAP;
    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'skill_pane_panel';
    // Lock height so the pane stops at the bottom of its last row
    // instead of stretching to fill the column.
    this.height = NATURAL_HEIGHT;

    /** @type {Function|null} (skillData) => void */
    this.onSkillClick = null;

    /** @type {SkillButton[]} */
    this._buttons = [];

    this.buildHierarchy();
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
    for (const btn of this._buttons) btn.setAssetManager(am);
  }

  setSkills(skills) {
    this._skills = skills || [];
    this.clearChildren();
    this._buttons = [];
    this.buildHierarchy();
  }

  buildHierarchy() {
    const total = SLOT_COUNT;
    const skills = this._skills.slice(0, total);

    for (let row = 0; row < ROWS; row++) {
      const rowContainer = new UIContainer();
      rowContainer.direction = 'row';
      rowContainer.gap = GRID_GAP;
      rowContainer.alignItems = 'stretch';
      rowContainer.height = SLOT_HEIGHT;

      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        let btn;
        if (idx < skills.length) {
          btn = new SkillButton(skills[idx], this._assetManager);
          // Wire click — actual handler is set later via setSkillClickHandler()
          // so the BattleScene controls the controller call.
          const skillData = skills[idx];
          btn.onClick = () => {
            if (this.onSkillClick) this.onSkillClick(skillData);
          };
        } else {
          btn = new SkillButton(null, this._assetManager, { locked: true });
        }
        btn.flexGrow = 1;
        this._buttons.push(btn);
        rowContainer.addChild(btn);
      }
      this.addChild(rowContainer);
    }
  }

  /** Update mana affordability for all active buttons */
  setManaState(manaState) {
    for (const btn of this._buttons) {
      if (!btn._locked) btn.setManaState(manaState);
    }
  }

  /** Iterate clickable skill buttons (for hover state from BattleScene) */
  get skillButtons() {
    return this._buttons.filter(b => !b._locked);
  }

  /** Description KeywordText elements of active skills (for keyword tooltips). */
  get descKeywordTexts() {
    return this._buttons
      .filter(b => !b._locked && b.descKeywordText)
      .map(b => b.descKeywordText);
  }
}
