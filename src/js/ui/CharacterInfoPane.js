import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import UIProgressBar from './UIProgressBar.js';
import UIOrb from './UIOrb.js';

// ── Tunable layout constants ─────────────────────────────
const PANE_PADDING = { top: 30, right: 12, bottom: 12, left: 12 };
const HEADER_HEIGHT = 96;
const PORTRAIT_WIDTH = 150;
const PORTRAIT_HEIGHT = 150;
const HEADER_GAP = 12;

const NAME_FONT_SIZE = 36;
const CLASS_FONT_SIZE = 24;
const HEALTH_BAR_HEIGHT = 36;
const HEALTH_LABEL_FONT_SIZE = 20;
const STATS_HEIGHT = 22;
const STAT_ICON_SIZE = 28;
const STAT_VALUE_FONT_SIZE = 22;

const MANA_ROW_HEIGHT = 150;
const MANA_GAP = 0;
const MANA_ORB_WIDTH = 70;
const MANA_ORB_HEIGHT = 80;
const MANA_FONT_SIZE = 21;

/**
 * Natural height of the pane = top + bottom padding + header + mana row + gap.
 * Locks the pane height so it doesn't stretch inside its column.
 */
const NATURAL_HEIGHT =
  PANE_PADDING.top + PANE_PADDING.bottom +
  HEADER_HEIGHT + MANA_ROW_HEIGHT + 6 /* outer column gap */ + 20 /* mana row top margin */;

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};
const MANA_ORDER = ['red', 'blue', 'green', 'yellow', 'purple'];

/**
 * CharacterInfoPane — compact horizontal character info panel.
 *
 * Structure:
 *   Row 1:
 *     [portrait] [name / class / hp bar / attack-armor stats]
 *   Row 2:
 *     [mana orb x5]
 *
 * Data-driven via setCharacterData()/updateFromState(). No skills section —
 * skills live in the separate SkillsPane.
 */
export default class CharacterInfoPane extends UIPanel {
  constructor(characterData = null, assetManager = null) {
    super();

    this._characterData = characterData;
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'column';
    this.gap = 6;
    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'character_pane_panel';
    // Lock height so the pane sizes to content instead of stretching.
    this.height = NATURAL_HEIGHT;

    // Refs for fast update
    this._portrait = null;
    this._nameText = null;
    this._classText = null;
    this._healthBar = null;
    this._attackValue = null;
    this._armorValue = null;
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };

    if (characterData) {
      this.buildHierarchy();
    }
  }

  setCharacterData(data) {
    this._characterData = data;
    this.clearChildren();
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    this.buildHierarchy();
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
    if (this._portrait) this._portrait.assetManager = am;
    for (const orb of Object.values(this._manaOrbs)) {
      if (orb) orb.assetManager = am;
    }
  }

  buildHierarchy() {
    const cd = this._characterData;
    if (!cd) return;

    // ── Header row: portrait + info ──
    const header = new UIContainer();
    header.direction = 'row';
    header.gap = HEADER_GAP;
    header.alignItems = 'stretch';
    header.height = HEADER_HEIGHT;

    // Portrait
    const portraitKey = cd.portrait ? `portrait_${cd.portrait}` : 'placeholder';
    this._portrait = new UIImage(portraitKey, this._assetManager);
    this._portrait.setStyle({
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      fitMode: 'cover',
      alignSelfV: 'center',
      margin: { top: 20, left: 5}
    });
    header.addChild(this._portrait);

    // Info column
    const info = new UIContainer();
    info.direction = 'column';
    info.gap = 2;
    info.flexGrow = 1;
    info.padding = { top: 10, right: 4 };

    // Name
    this._nameText = new UIText(cd.name || '');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      color: '#d0d0c4',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: NAME_FONT_SIZE + 6,
    });
    info.addChild(this._nameText);

    // Class / level
    const classStr = cd.className ? `${cd.className}` : '';
    const levelStr = cd.level ? `  Lv.${cd.level}` : '';
    this._classText = new UIText(classStr + levelStr);
    this._classText.setStyle({
      fontSize: CLASS_FONT_SIZE,
      color: '#ccaa77',
      alignH: 'left',
      alignV: 'center',
      height: CLASS_FONT_SIZE + 4,
    });
    info.addChild(this._classText);

    // HP bar
    this._healthBar = new UIProgressBar();
    this._healthBar.setStyle({
      value: cd.hp ?? 0,
      maxValue: cd.maxHp ?? 100,
      fillColor: '#cc3333',
      backgroundColor: '#1a0e0e',
      label: `${cd.hp ?? 0} / ${cd.maxHp ?? 0}`,
      labelColor: '#ffffff',
      labelFontSize: HEALTH_LABEL_FONT_SIZE,
      borderColor: '#554433',
      borderWidth: 1,
      cornerRadius: 3,
      height: HEALTH_BAR_HEIGHT,
      widthPercent: 0.95,
      margin: { top: 4, bottom: 8 },
    });
    info.addChild(this._healthBar);

    // Stats row (attack | armor)
    const statsRow = new UIContainer();
    statsRow.direction = 'row';
    statsRow.alignItems = 'center';
    statsRow.gap = 14;
    statsRow.height = STATS_HEIGHT;

    statsRow.addChild(this._buildStatGroup('icon_attack', () => this._attackValue, (el) => { this._attackValue = el; }, cd.attack ?? 0));
    statsRow.addChild(this._buildStatGroup('icon_block',  () => this._armorValue,  (el) => { this._armorValue = el;  }, cd.armor  ?? 0));

    info.addChild(statsRow);
    header.addChild(info);

    this.addChild(header);

    // ── Mana row ──
    const manaRow = new UIContainer();
    manaRow.direction = 'row';
    manaRow.justifyContent = 'center';
    manaRow.alignItems = 'center';
    manaRow.gap = MANA_GAP;
    manaRow.height = MANA_ROW_HEIGHT;
    manaRow.padding = { top: 20, right: 2, bottom: 2, left: 2 };
    manaRow.margin = { top: 40 };

    const manaData = cd.mana || {};
    for (const color of MANA_ORDER) {
      const orb = new UIOrb();
      orb.setStyle({
        color: MANA_COLORS[color],
        count: manaData[color] ?? 0,
        countColor: '#ffffff',
        fontSize: MANA_FONT_SIZE,
        width: MANA_ORB_WIDTH,
        height: MANA_ORB_HEIGHT,
        borderColor: '#151515',
        borderWidth: 2,
        showAmountPlate: true,
      });

      const manaAssetKey = `mana_${color}`;
      if (this._assetManager && this._assetManager.get(manaAssetKey)) {
        orb.assetKey = manaAssetKey;
        orb.assetManager = this._assetManager;
      }

      this._manaOrbs[color] = orb;
      manaRow.addChild(orb);
    }

    this.addChild(manaRow);
  }

  _buildStatGroup(iconKey, getValueRef, setValueRef, initialValue) {
    const group = new UIContainer();
    group.direction = 'row';
    group.gap = 4;
    group.alignItems = 'center';

    const icon = new UIImage(iconKey, this._assetManager);
    icon.setStyle({ width: STAT_ICON_SIZE, height: STAT_ICON_SIZE, fitMode: 'contain' });
    group.addChild(icon);

    const valueText = new UIText(String(initialValue));
    valueText.setStyle({
      fontSize: STAT_VALUE_FONT_SIZE,
      color: '#ffffff',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: STAT_VALUE_FONT_SIZE + 4,
      margin: { left: 5 }
    });
    setValueRef(valueText);
    group.addChild(valueText);

    return group;
  }

  /**
   * Fast update from BattleController combatant state.
   * @param {object} state
   */
  updateFromState(state) {
    if (!state) return;

    if (this._healthBar) {
      this._healthBar.value = state.hp ?? 0;
      this._healthBar.maxValue = state.maxHp ?? 100;
      const blockLabel = (state.block && state.block > 0) ? ` [${state.block}]` : '';
      this._healthBar.label = `${state.hp ?? 0} / ${state.maxHp ?? 0}${blockLabel}`;
    }

    if (this._attackValue) this._attackValue.text = String(state.attack ?? 0);
    if (this._armorValue)  this._armorValue.text  = String(state.armor ?? 0);

    const manaData = state.mana || {};
    for (const color of Object.keys(this._manaOrbs)) {
      const orb = this._manaOrbs[color];
      if (orb) orb.count = manaData[color] ?? 0;
    }
  }

  updateFromData() {
    if (this._characterData) this.updateFromState(this._characterData);
  }
}
