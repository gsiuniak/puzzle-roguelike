import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import UIOrb from './UIOrb.js';

// ── Tunable layout constants ─────────────────────────────
const BTN_PADDING = { top: 6, right: 8, bottom: 6, left: 6 };
const BTN_GAP = 6;
const ICON_SIZE = 44;
const NAME_FONT_SIZE = 12;
const COST_FONT_SIZE = 12;
const COST_ORB_SIZE = 18;
// Fixed width for the cost amount text — prevents it from flexing
// and pushing the orb to the far edge of the cost row.
const COST_TEXT_WIDTH = 14;
// Gap between the cost number and its mana orb. Smaller = tighter.
const COST_PAIR_GAP = 2;

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};

/**
 * SkillButton — compact skill button used by the new SkillsPane.
 *
 * Two layout columns:
 *   [icon] [name / cost row]
 *
 * Three rendered modes:
 *   - locked  — empty placeholder slot (background = `skills_locked_button`, no interactivity)
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
    // Locked uses the locked placeholder; active uses the unlocked
    // skill button background art so each slot has the same frame.
    this.backgroundAssetKey = this._locked ? 'skills_locked_button' : 'skills_button';

    /** @type {Function|null} */
    this.onClick = null;
    this._hovered = false;

    // Mana affordability state (mirrors SkillRow logic)
    this._manaState = null;
    this._affordable = false;

    // Refs
    this._iconImage = null;
    this._nameText = null;
    this._costRow = null;

    if (!this._locked) this.buildHierarchy();
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
    if (this._iconImage) this._iconImage.assetManager = am;
  }

  buildHierarchy() {
    const sd = this._skillData;
    if (!sd) return;

    // Icon
    this._iconImage = new UIImage(sd.icon || 'placeholder', this._assetManager);
    this._iconImage.setStyle({
      width: ICON_SIZE,
      height: ICON_SIZE,
      fitMode: 'contain',
      alignSelfV: 'center',
    });
    this.addChild(this._iconImage);

    // Info column
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

    // Compact cost row: e.g. "7 [red orb]"
    this._costRow = this._buildCostRow(sd.cost);
    info.addChild(this._costRow);

    this.addChild(info);
  }

  _buildCostRow(costData) {
    const row = new UIContainer();
    row.direction = 'row';
    row.gap = 6;
    row.alignItems = 'center';
    row.justifyContent = 'start';
    row.height = COST_ORB_SIZE + 2;

    if (!costData || typeof costData !== 'object') return row;

    const activeColors = Object.keys(costData).filter(c => costData[c] > 0);
    for (let i = 0; i < activeColors.length; i++) {
      const color = activeColors[i];
      const amount = costData[color];

      // Wrap each [value, orb] pair in a tight inner container so they
      // stick together. Without this, the unsized text auto-flexes and
      // pushes the orb to the far edge of the row.
      const pair = new UIContainer();
      pair.direction = 'row';
      pair.gap = COST_PAIR_GAP;
      pair.alignItems = 'center';
      pair.width = COST_TEXT_WIDTH + COST_PAIR_GAP + COST_ORB_SIZE;

      const value = new UIText(String(amount));
      value.setStyle({
        fontSize: COST_FONT_SIZE,
        color: '#ffffff',
        bold: true,
        alignH: 'right',
        alignV: 'center',
        width: COST_TEXT_WIDTH,
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

      row.addChild(pair);
    }
    return row;
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
      ctx.fillStyle = 'rgba(255,240,160,0.32)';
      ctx.fillRect(r.x, r.y, 3, r.h);
      ctx.strokeStyle = 'rgba(255,240,180,0.20)';
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
