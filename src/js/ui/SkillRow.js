import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import ManaCostRow from './ManaCostRow.js';

/**
 * SkillRow — renders a single skill from a skill data object.
 *
 * Structure:
 *   [icon] [name + description] | [mana cost row...]
 *
 * Click callback support: set `onClick` to a function that receives the skill data.
 *
 * Properties:
 *   skillData   - { name, description, icon, cost: { red, blue, ... } }
 *   assetManager - AssetManager reference
 *   onClick      - Function | null — called when skill row is clicked
 */
export default class SkillRow extends UIPanel {
  constructor(skillData = null, assetManager = null) {
    super();
    this.direction = 'row';
    this.gap = 8;
    this.alignItems = 'stretch';
    this.padding = { top: 10, right: 14, bottom: 10, left: 14 };
    this.backgroundAssetKey = 'character_pane_skill_row';
    this.smoothing = true; // decorative background

    this._skillData = skillData;
    this._assetManager = assetManager;
    this.assetManager = assetManager; // for UIPanel background rendering

    /** @type {Function|null} */
    this.onClick = null;

    this._iconContainer = null;
    this._icon = null;
    this._nameText = null;
    this._descText = null;
    this._costRow = null;
    this._separator = null;

    // Interactive state
    this._hovered = false;

    // Mana affordability state
    /** @type {Object<string,number>|null} — current mana pool, e.g. {red:3, blue:0} */
    this._manaState = null;
    /** @type {boolean} — cached affordability; recomputed when mana or skill changes */
    this._affordable = false;

    if (skillData) {
      this.buildHierarchy();
    }
  }

  /** Set or update skill data and rebuild */
  setSkillData(skillData) {
    this._skillData = skillData;
    this.clearChildren();
    this.buildHierarchy();
    this._computeAffordable();
  }

  /** Set asset manager reference */
  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am; // for UIPanel background rendering
    if (this._icon) this._icon.assetManager = am;
    if (this._costRow) this._costRow.setAssetManager(am);
  }

  buildHierarchy() {
    const sd = this._skillData;
    if (!sd) return;

    // --- Icon container ---
    this._iconContainer = new UIContainer();
    this._iconContainer.setStyle({
      width: 56,
      height: 56,
      alignSelfV: 'center',
    });
    this._iconContainer.alignItems = 'center';
    this._iconContainer.justifyContent = 'center';
    this._iconContainer.direction = 'row';

    const iconKey = sd.icon || 'placeholder';
    this._icon = new UIImage(iconKey, this._assetManager);
    this._icon.setStyle({
      width: 70,
      height: 70,
      fitMode: 'contain'
    });
    this._iconContainer.addChild(this._icon);
    this.addChild(this._iconContainer);

    // --- Info column ---
    const infoCol = new UIContainer();
    infoCol.direction = 'column';
    infoCol.gap = 2;
    infoCol.widthPercent = 0.48;
    infoCol.justifyContent = 'center';

    this._nameText = new UIText(sd.name || '');
    this._nameText.setStyle({
      fontSize: 16,
      color: '#e4e4d9',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 20,
      margin: { left: 15 }
    });
    infoCol.addChild(this._nameText);

    this._descText = new UIText(sd.description || '');
    this._descText.setStyle({
      fontSize: 11,
      color: '#f7f1c0',
      italic: false,
      alignH: 'left',
      alignV: 'center',
      height: 18,
      maxWidth: 200,
       margin: { left: 15 }
    });
    infoCol.addChild(this._descText);

    this.addChild(infoCol);

    // --- Vertical separator ---
    this._separator = new UIContainer();
    this._separator.setStyle({
      width: 2,
      background: '#505050',
      cornerRadius: 1,
    });
    this.addChild(this._separator);

    // --- Mana cost row ---
    if (sd.cost && typeof sd.cost === 'object') {
      this._costRow = new ManaCostRow(sd.cost, this._assetManager);
      this.addChild(this._costRow);
    }
  }

  /** Update text values from current skillData */
  updateFromData() {
    const sd = this._skillData;
    if (!sd) return;

    if (this._nameText) this._nameText.text = sd.name || '';
    if (this._descText) this._descText.text = sd.description || '';

    if (this._costRow && sd.cost && typeof sd.cost === 'object') {
      this._costRow.setCostData(sd.cost);
    } else if (this._costRow && (!sd.cost || Object.keys(sd.cost).length === 0)) {
      this.removeChild(this._costRow);
      this._costRow = null;
    } else if (!this._costRow && sd.cost && typeof sd.cost === 'object') {
      this._costRow = new ManaCostRow(sd.cost, this._assetManager);
      this.addChild(this._costRow);
    }

    this._computeAffordable();
  }

  // ── Mana affordability ──────────────────────────────

  /**
   * Update the player's current mana pool and recompute whether
   * this skill is affordable.
   * @param {Object<string,number>|null} manaState — e.g. {red:3, blue:0, green:1, yellow:0, purple:0}
   */
  setManaState(manaState) {
    this._manaState = manaState;
    this._computeAffordable();
  }

  /** Recompute _affordable from _skillData.cost vs _manaState */
  _computeAffordable() {
    const sd = this._skillData;
    const mana = this._manaState;
    if (!sd || !sd.cost || typeof sd.cost !== 'object' || Object.keys(sd.cost).length === 0) {
      // No cost means always affordable
      this._affordable = true;
      return;
    }
    if (!mana) {
      // No mana state available yet — default to not affordable
      this._affordable = false;
      return;
    }
    for (const [color, amount] of Object.entries(sd.cost)) {
      if ((mana[color] || 0) < amount) {
        this._affordable = false;
        return;
      }
    }
    this._affordable = true;
  }

  // ── Hover support for interactivity ──────────────────

  /**
   * Override hit test to support click detection.
   * Returns this if the point is within the row's rect.
   */
  hitTest(x, y) {
    if (!this.visible) return null;
    if (!this.rect.containsPoint(x, y)) return null;

    // If onClick is set, this row is clickable and returns itself
    if (this.onClick) {
      return this;
    }

    // Otherwise, delegate to child hit testing (default behavior)
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitTest(x, y);
      if (hit) return hit;
    }
    return this;
  }

  renderSelf(ctx) {
    super.renderSelf(ctx);

    const r = this.rect;
    const canCast = this._affordable && this.onClick;

    // ── Subtle "castable" overlay — always visible when skill is affordable ──
    if (canCast) {
      ctx.save();
      // Warm golden fill across the row
      ctx.fillStyle = 'rgba(255,240,180,0.12)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // Left-edge accent bar signalling "available to cast"
      ctx.fillStyle = 'rgba(255,240,160,0.35)';
      ctx.fillRect(r.x, r.y, 4, r.h);
      // Subtle border around the row
      ctx.strokeStyle = 'rgba(255,240,180,0.20)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();
    }

    // ── Hover highlight — only when affordable ──
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
