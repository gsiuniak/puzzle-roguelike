import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import UIOrb from './UIOrb.js';

// ── Tunable layout constants ─────────────────────────────
const BTN_PADDING = { top: 8, right: 10, bottom: 8, left: 5 };
// Horizontal gap between the three main columns: icon | info | cost.
const BTN_GAP = 10;
const ICON_SIZE = 90;
const LOCKED_ICON_SIZE = 40;
const NAME_FONT_SIZE = 24;
const DESC_FONT_SIZE = 18;
const DESC_LINE_HEIGHT = 20;
// Maximum width for the description text before it word-wraps onto
// additional lines (0 = no wrap, single line).
const DESC_MAX_WIDTH = 180;
const COST_FONT_SIZE = 24;
const COST_ORB_SIZE = 28;
// Width allocated to the right-hand cost column. Wide enough to fit a
// two-digit amount + orb. Increase if you need more than one cost.
const COST_COL_WIDTH = 56;
// Gap between the cost number and its mana orb.
const COST_PAIR_GAP = 4;

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};

/**
 * SkillButton — skill button used by the new SkillsPane.
 *
 * Three layout columns:
 *   [icon] [name + description (stacked)] [mana cost (number + orb)]
 *
 * Two rendered modes:
 *   - locked  — empty placeholder slot (background = `skills_button` with a centered `skills_locked_icon`, no interactivity)
 *   - active  — skill rendered, clickable when affordable
 *
 * Click callback: set `onClick` to a function invoked with skillData.
 */
export default class SkillButton extends UIPanel {
  /**
   * @param {object|null} skillData - {name, icon, cost?, ...} or null for a locked slot
   * @param {object|null} assetManager
   * @param {object}      [opts]
   * @param {boolean}     [opts.locked=false] — force locked placeholder rendering
   */
  constructor(skillData = null, assetManager = null, opts = {}) {
    super();

    this._skillData = skillData;
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this._locked = !!opts.locked || !skillData;

    this.direction = 'row';
    this.gap = BTN_GAP;
    this.alignItems = 'center';
    this.padding = BTN_PADDING;
    // Both locked and active slots share the same `skills_button` frame so
    // empty slots are visually consistent with filled ones. Locked slots
    // render a single centered `skills_locked_icon` instead of skill content.
    this.backgroundAssetKey = 'skills_button';

    /** @type {Function|null} */
    this.onClick = null;
    this._hovered = false;

    // Mana affordability state (mirrors SkillRow logic)
    this._manaState = null;
    this._affordable = false;

    // Refs
    this._iconImage = null;
    this._nameText = null;
    this._descText = null;
    this._costCol = null;

    if (this._locked) this._buildLockedHierarchy();
    else this.buildHierarchy();
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
    if (this._iconImage) this._iconImage.assetManager = am;
  }

  _buildLockedHierarchy() {
    // Override row-flex defaults so the single icon centers in the button.
    this.justifyContent = 'center';
    this.alignItems = 'center';

    const lockIcon = new UIImage('skills_locked_icon', this._assetManager);
    lockIcon.setStyle({
      width: LOCKED_ICON_SIZE,
      height: LOCKED_ICON_SIZE,
      fitMode: 'contain',
      alignSelfV: 'center',
    });
    this._iconImage = lockIcon;
    this.addChild(lockIcon);
  }

  buildHierarchy() {
    const sd = this._skillData;
    if (!sd) return;

    // ── Column 1: icon ──
    this._iconImage = new UIImage(sd.icon || 'placeholder', this._assetManager);
    this._iconImage.setStyle({
      width: ICON_SIZE,
      height: ICON_SIZE,
      fitMode: 'contain',
      alignSelfV: 'center',
    });
    this.addChild(this._iconImage);

    // ── Column 2: name (top row) + description (bottom row) ──
    const info = new UIContainer();
    info.direction = 'column';
    info.gap = 2;
    info.flexGrow = 1;
    info.alignItems = 'stretch';
    info.justifyContent = 'center';

    this._nameText = new UIText(sd.name || '');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      color: '#e4e4d9',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: NAME_FONT_SIZE + 4,
    });
    info.addChild(this._nameText);

    // Description (may contain '\n' line breaks — UIText supports them).
    this._descText = new UIText(sd.description || '');
    this._descText.setStyle({
      fontSize: DESC_FONT_SIZE,
      color: '#cfc8a8',
      alignH: 'left',
      alignV: 'top',
      lineHeight: DESC_LINE_HEIGHT,
      maxWidth: DESC_MAX_WIDTH,
      flexGrow: 1,
    });
    info.addChild(this._descText);

    this.addChild(info);

    // ── Column 3: mana cost (number + orb) ──
    this._costCol = this._buildCostColumn(sd.cost);
    this.addChild(this._costCol);
  }

  /**
   * Right-hand cost column. Each cost (color, amount) renders as a row
   * of [number] [orb]; multiple costs stack vertically. Centered within
   * the fixed-width column so it stays out of the description's way.
   */
  _buildCostColumn(costData) {
    const col = new UIContainer();
    col.direction = 'column';
    col.gap = 4;
    col.alignItems = 'end';
    col.justifyContent = 'center';
    col.width = COST_COL_WIDTH;

    if (!costData || typeof costData !== 'object') return col;

    const activeColors = Object.keys(costData).filter(c => costData[c] > 0);
    for (const color of activeColors) {
      const amount = costData[color];

      const pair = new UIContainer();
      pair.direction = 'row';
      pair.gap = COST_PAIR_GAP;
      pair.alignItems = 'center';
      pair.height = COST_ORB_SIZE;

      const value = new UIText(String(amount));
      value.setStyle({
        fontSize: COST_FONT_SIZE,
        color: '#ffffff',
        bold: true,
        alignH: 'right',
        alignV: 'center',
      });
      pair.addChild(value);

      const orb = new UIOrb();
      orb.setStyle({
        color: MANA_COLORS[color] || '#888',
        count: amount,
        width: COST_ORB_SIZE,
        height: COST_ORB_SIZE,
        borderColor: '#665522',
        borderWidth: 1,
        showCount: false,
        showAmountPlate: false,
      });
      if (this._assetManager) {
        const key = `mana_${color}_simple`;
        if (this._assetManager.get(key)) {
          orb.assetKey = key;
          orb.assetManager = this._assetManager;
        }
      }
      pair.addChild(orb);

      col.addChild(pair);
    }
    return col;
  }

  // ── Mana affordability ──────────────────────────────
  setManaState(manaState) {
    this._manaState = manaState;
    this._computeAffordable();
  }

  _computeAffordable() {
    const sd = this._skillData;
    if (!sd || !sd.cost || Object.keys(sd.cost).length === 0) {
      this._affordable = true;
      return;
    }
    const mana = this._manaState;
    if (!mana) { this._affordable = false; return; }
    for (const [color, amount] of Object.entries(sd.cost)) {
      if ((mana[color] || 0) < amount) { this._affordable = false; return; }
    }
    this._affordable = true;
  }

  // ── Hit-test: only clickable when not locked AND has onClick ──
  hitTest(x, y) {
    if (!this.visible) return null;
    if (!this.rect.containsPoint(x, y)) return null;
    if (this._locked) return null; // locked = pass-through to parent
    if (this.onClick) return this;
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitTest(x, y);
      if (hit) return hit;
    }
    return this;
  }

  renderSelf(ctx) {
    super.renderSelf(ctx);
    if (this._locked) return;

    const r = this.rect;
    const canCast = this._affordable && this.onClick;

    // ── Castable accent + hover overlay (similar to SkillRow) ──
    if (canCast) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,240,180,0.10)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(237, 249, 142, 0.75)';
      ctx.fillRect(r.x, r.y, 3, r.h);
      ctx.strokeStyle = 'rgba(255, 240, 180, 0.95)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();
    }
    if (this._hovered && canCast) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,200,0.12)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,255,200,0.40)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();
    }
  }
}
