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
 * The vertical separator line (|) aligns across all rows for a clean,
 * consistent layout thanks to the fixed widthPercent on the info column.
 *
 * Properties:
 *   skillData   - { name, description, icon, cost: { red, blue, ... } }
 *   assetManager - AssetManager reference
 */
export default class SkillRow extends UIPanel {
  constructor(skillData = null, assetManager = null) {
    super();
    this.direction = 'row';
    this.gap = 8;
    this.alignItems = 'stretch';
    this.padding = { top: 10, right: 14, bottom: 10, left: 14 };
    this.backgroundAssetKey = 'character_pane_skill_row';

    this._skillData = skillData;
    this._assetManager = assetManager;
    this.assetManager = assetManager; // for UIPanel background rendering

    this._iconContainer = null;
    this._icon = null;
    this._nameText = null;
    this._descText = null;
    this._costRow = null;
    this._separator = null;

    if (skillData) {
      this.buildHierarchy();
    }
  }

  /** Set or update skill data and rebuild */
  setSkillData(skillData) {
    this._skillData = skillData;
    this.clearChildren();
    this.buildHierarchy();
  }

  /** Set asset manager reference */
  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am; // for UIPanel background rendering
    // Propagate to children
    if (this._icon) this._icon.assetManager = am;
    if (this._costRow) this._costRow.setAssetManager(am);
  }

  buildHierarchy() {
    const sd = this._skillData;
    if (!sd) return;

    // --- Icon container (56x56 frame with centered 48x48 icon) ---
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
      width: 48,
      height: 48,
      fitMode: 'contain',
    });
    this._iconContainer.addChild(this._icon);
    this.addChild(this._iconContainer);

    // --- Info column (name + description) ---
    // Consistent width across all rows so separator line aligns vertically
    const infoCol = new UIContainer();
    infoCol.direction = 'column';
    infoCol.gap = 2;
    infoCol.widthPercent = 0.48;
    infoCol.justifyContent = 'center';

    this._nameText = new UIText(sd.name || '');
    this._nameText.setStyle({
      fontSize: 16,
      color: '#cdcdcd',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 20,
    });
    infoCol.addChild(this._nameText);

    this._descText = new UIText(sd.description || '');
    this._descText.setStyle({
      fontSize: 12,
      color: '#f7f1c0',
      italic: true,
      alignH: 'left',
      alignV: 'center',
      height: 18,
      maxWidth: 200,
    });
    infoCol.addChild(this._descText);

    this.addChild(infoCol);

    // --- Vertical separator line ---
    this._separator = new UIContainer();
    this._separator.setStyle({
      width: 2,
      background: '#665533',
      cornerRadius: 1,
    });
    this.addChild(this._separator);

    // --- Mana cost row (using reusable component) ---
    if (sd.cost && typeof sd.cost === 'object') {
      this._costRow = new ManaCostRow(sd.cost, this._assetManager);
      this.addChild(this._costRow);
    }
  }

  /** Update text values from current skillData (call when data changes) */
  updateFromData() {
    const sd = this._skillData;
    if (!sd) return;

    if (this._nameText) this._nameText.text = sd.name || '';
    if (this._descText) this._descText.text = sd.description || '';

    // Update cost row
    if (this._costRow && sd.cost && typeof sd.cost === 'object') {
      this._costRow.setCostData(sd.cost);
    } else if (this._costRow && (!sd.cost || Object.keys(sd.cost).length === 0)) {
      // Remove cost row if no costs
      this.removeChild(this._costRow);
      this._costRow = null;
    } else if (!this._costRow && sd.cost && typeof sd.cost === 'object') {
      // Add cost row if newly present
      this._costRow = new ManaCostRow(sd.cost, this._assetManager);
      this.addChild(this._costRow);
    }
  }
}

