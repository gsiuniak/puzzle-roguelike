import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import UIOrb from './UIOrb.js';

/**
 * SkillRow — renders a single skill from a skill data object.
 *
 * Structure:
 *   [icon] [name + description] [mana costs...]
 *
 * Properties:
 *   skillData   - { name, description, icon, cost: { red, blue, ... } }
 *   assetManager - AssetManager reference
 */
export default class SkillRow extends UIContainer {
  constructor(skillData = null, assetManager = null) {
    super();
    this.direction = 'row';
    this.gap = 8;
    this.alignItems = 'center';
    this.padding = { top: 4, right: 6, bottom: 4, left: 6 };

    this._skillData = skillData;
    this._assetManager = assetManager;

    this._icon = null;
    this._nameText = null;
    this._descText = null;
    this._costContainer = null;

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
    // Propagate to children
    if (this._icon) this._icon.assetManager = am;
  }

  buildHierarchy() {
    const sd = this._skillData;
    if (!sd) return;

    // --- Icon ---
    const iconKey = sd.icon || 'placeholder';
    this._icon = new UIImage(iconKey, this._assetManager);
    this._icon.setStyle({
      width: 40,
      height: 40,
      fitMode: 'contain',
      margin: { right: 4 },
    });
    this.addChild(this._icon);

    // --- Info column (name + description) ---
    const infoCol = new UIContainer();
    infoCol.direction = 'column';
    infoCol.gap = 2;
    infoCol.flexGrow = 1;

    this._nameText = new UIText(sd.name || '');
    this._nameText.setStyle({
      fontSize: 15,
      color: '#f0e68c',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 18,
    });
    infoCol.addChild(this._nameText);

    this._descText = new UIText(sd.description || '');
    this._descText.setStyle({
      fontSize: 11,
      color: '#bbbbbb',
      italic: true,
      alignH: 'left',
      alignV: 'center',
      height: 16,
      maxWidth: 180,
    });
    infoCol.addChild(this._descText);

    this.addChild(infoCol);

    // --- Mana cost row ---
    this._costContainer = new UIContainer();
    this._costContainer.direction = 'row';
    this._costContainer.gap = 6;
    this._costContainer.alignItems = 'center';
    this._costContainer.justifyContent = 'end';
    this._costContainer.setStyle({
      height: 36,
    });

    // Mana color definitions
    const manaColors = {
      red:    '#cc3333',
      blue:   '#3366cc',
      green:  '#33aa33',
      yellow: '#cccc33',
      purple: '#9933cc',
    };

    if (sd.cost && typeof sd.cost === 'object') {
      for (const [color, amount] of Object.entries(sd.cost)) {
        if (!amount || amount <= 0) continue;

        const orb = new UIOrb();
        orb.setStyle({
          color: manaColors[color] || '#888888',
          count: amount,
          countColor: '#ffffff',
          fontSize: 14,
          width: 32,
          height: 32,
          borderColor: '#665522',
          borderWidth: 1,
        });

        // Try asset key for mana orb image overlay
        if (this._assetManager) {
          const manaAssetKey = `mana_${color}`;
          if (this._assetManager.get(manaAssetKey)) {
            orb.assetKey = manaAssetKey;
            orb.assetManager = this._assetManager;
          }
        }

        this._costContainer.addChild(orb);
      }
    }

    // Only add cost container if it has children
    if (this._costContainer.children.length > 0) {
      this.addChild(this._costContainer);
    }
  }

  /** Update text values from current skillData (call when data changes) */
  updateFromData() {
    const sd = this._skillData;
    if (!sd) return;

    if (this._nameText) this._nameText.text = sd.name || '';
    if (this._descText) this._descText.text = sd.description || '';

    // Rebuild cost container if costs changed (simpler than trying to update each orb)
    if (this._costContainer) {
      this.removeChild(this._costContainer);
      this._costContainer = null;
    }
    // Rebuild costs
    if (this.children.length >= 2) {
      // Icon + infoCol are first two children
      // Rebuild costs
      this.clearChildren();
      this.buildHierarchy();
    }
  }
}
