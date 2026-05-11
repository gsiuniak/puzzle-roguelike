import UIContainer from './UIContainer.js';
import UIOrb from './UIOrb.js';
import UIText from './UIText.js';

/**
 * ManaCostRow — renders skill mana costs as "number [orb]" pairs.
 *
 * Structure:
 *   8 [red orb]  /  4 [yellow orb]
 *
 * Properties:
 *   costData     - { red: 8, yellow: 4, ... }
 *   assetManager - AssetManager reference
 *
 * Dynamic:
 *   - Supports 1+ mana costs
 *   - Supports any mana color combination
 *   - Separator between multiple costs
 *   - Auto-adjusts layout based on cost count
 */
export default class ManaCostRow extends UIContainer {
  constructor(costData = null, assetManager = null) {
    super();
    this.direction = 'row';
    this.gap = 3;
    this.alignItems = 'center';
    this.justifyContent = 'end';
    this.flexGrow = 1;

    this._costData = costData;
    this._assetManager = assetManager;
    this._costOrbs = [];
    this._costValues = [];
    this._separators = [];

    if (costData) {
      this.buildHierarchy();
    }
  }

  /** Set or update cost data and rebuild */
  setCostData(costData) {
    this._costData = costData;
    this.clearChildren();
    this._costOrbs = [];
    this._costValues = [];
    this._separators = [];
    if (costData) {
      this.buildHierarchy();
    }
  }

  /** Set shared asset manager */
  setAssetManager(am) {
    this._assetManager = am;
    for (const orb of this._costOrbs) {
      orb.assetManager = am;
    }
  }

  buildHierarchy() {
    const manaColors = {
      red:    '#cc3333',
      blue:   '#3366cc',
      green:  '#33aa33',
      yellow: '#cccc33',
      purple: '#9933cc',
    };

    // Filter to only colors with positive amounts
    const activeColors = Object.keys(this._costData).filter(
      c => this._costData[c] > 0
    );

    for (let i = 0; i < activeColors.length; i++) {
      const color = activeColors[i];
      const amount = this._costData[color];

      // Separator between multiple costs
      if (i > 0) {
        const separator = new UIText('/');
        separator.setStyle({
          fontSize: 14,
          color: '#888888',
          bold: true,
          alignH: 'center',
          alignV: 'center',
        });
        this.addChild(separator);
        this._separators.push(separator);
      }

      // Cost group sub-container: [value] [orb]
      const costGroup = new UIContainer();
      costGroup.direction = 'row';
      costGroup.gap = 10;
      costGroup.alignItems = 'center';

      // Simple orb (no count inside, no decorative plate in skill row)
      const orb = new UIOrb();
      orb.setStyle({
        color: manaColors[color] || '#888888',
        count: amount,
        countColor: '#ffffff',
        fontSize: 10,
        width: 24,
        height: 24,
        borderWidth: 0,
        showCount: false,
        showAmountPlate: false,
      });

      // Use simple mana icon for skill row cost orbs
      if (this._assetManager) {
        const manaAssetKey = `mana_${color}_simple`;
        if (this._assetManager.get(manaAssetKey)) {
          orb.assetKey = manaAssetKey;
          orb.assetManager = this._assetManager;
        }
      }

      costGroup.addChild(orb);
      this._costOrbs.push(orb);

      // Value text LEFT of orb (skill cost format: "8 [orb]")
      const value = new UIText(String(amount));
      value.setStyle({
        fontSize: 16,
        color: '#ffffff',
        bold: true,
        alignH: 'left',
        alignV: 'center',
      });
      costGroup.addChild(value);
      this._costValues.push(value);

      this.addChild(costGroup);
    }
  }
}
