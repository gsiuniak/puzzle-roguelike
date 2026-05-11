import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import UIProgressBar from './UIProgressBar.js';
import UIOrb from './UIOrb.js';
import SkillRow from './SkillRow.js';

/**
 * CharacterPane — the main character info panel.
 *
 * Takes a character data object and renders:
 *   - Header (portrait + name + class)
 *   - Health bar
 *   - Stats row (attack, armor)
 *   - Mana orbs row
 *   - Skills section (dynamic SkillRow list)
 *
 * All values come from characterData. No hardcoded values.
 *
 * Supports two update paths:
 *   - setCharacterData(data) — full rebuild from new data
 *   - updateFromState(state)  — fast update from BattleController combatant state
 *   - updateFromData()        — update from stored _characterData
 */
export default class CharacterPane extends UIPanel {
  /**
   * @param {object} characterData - mock character object
   * @param {object} assetManager   - AssetManager instance
   */
  constructor(characterData = null, assetManager = null) {
    super();

    this._characterData = characterData;
    this._assetManager = assetManager;
    this.assetManager = assetManager; // for UIPanel background rendering

    // Decorative background panel benefits from smoothing
    this.smoothing = true;

    // Skill click callback
    /** @type {Function|null} (skillData) => {} */
    this.onSkillClick = null;

    // Child references for updating
    this._portrait = null;
    this._nameText = null;
    this._classText = null;
    this._healthBar = null;
    this._attackIcon = null;
    this._attackLabel = null;
    this._attackValue = null;
    this._armorIcon = null;
    this._armorLabel = null;
    this._armorValue = null;
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    this._skillsTitle = null;
    this._skillsContainer = null;
    this._skillRows = [];

    // Configure self
    this.direction = 'column';
    this.gap = 10;
    this.padding = { top: 14, right: 16, bottom: 16, left: 16 };

    if (characterData) {
      this.buildHierarchy();
    }
  }

  /** Set or update character data, rebuild everything */
  setCharacterData(data) {
    this._characterData = data;
    this.clearChildren();
    this._skillRows = [];
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    this.buildHierarchy();
  }

  buildHierarchy() {
    const cd = this._characterData;
    if (!cd) return;

    // ── 1. Header row ──────────────────────────────────
    const headerRow = new UIContainer();
    headerRow.direction = 'row';
    headerRow.gap = 12;
    headerRow.alignItems = 'center';
    headerRow.padding = { top: 4, right: 0, bottom: 8, left: 6 };
    headerRow.height = 88;

    const portraitKey = cd.portrait ? `portrait_${cd.portrait}` : 'placeholder';
    this._portrait = new UIImage(portraitKey, this._assetManager);
    this._portrait.setStyle({
      width: 76,
      height: 76,
      fitMode: 'cover',
    });
    headerRow.addChild(this._portrait);

    const nameCol = new UIContainer();
    nameCol.direction = 'column';
    nameCol.gap = 2;
    nameCol.flexGrow = 1;

    this._nameText = new UIText(cd.name || '');
    this._nameText.setStyle({
      fontSize: 24,
      color: '#f5deb3',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 30,
    });
    nameCol.addChild(this._nameText);

    const classStr = cd.className ? `${cd.className}` : '';
    const levelStr = cd.level ? `  Lv.${cd.level}` : '';
    this._classText = new UIText(classStr + levelStr);
    this._classText.setStyle({
      fontSize: 15,
      color: '#ccaa77',
      italic: true,
      alignH: 'left',
      alignV: 'center',
      height: 22,
    });
    nameCol.addChild(this._classText);

    headerRow.addChild(nameCol);
    this.addChild(headerRow);

    // ── 2. Health bar ──────────────────────────────────
    this._healthBar = new UIProgressBar();
    this._healthBar.setStyle({
      value: cd.hp ?? 0,
      maxValue: cd.maxHp ?? 100,
      fillColor: '#cc3333',
      backgroundColor: '#2a1a1a',
      label: `${cd.hp ?? 0} / ${cd.maxHp ?? 0}`,
      labelColor: '#ffffff',
      labelFontSize: 18,
      borderColor: '#554433',
      borderWidth: 1,
      cornerRadius: 6,
      height: 52,
      widthPercent: 1,
      margin: { top: 2, bottom: 4 },
    });
    this.addChild(this._healthBar);

    // ── 3. Stats row ───────────────────────────────────
    const statsRow = new UIContainer();
    statsRow.direction = 'row';
    statsRow.justifyContent = 'space-between';
    statsRow.alignItems = 'center';
    statsRow.gap = 16;
    statsRow.padding = { top: 4, right: 8, bottom: 4, left: 8 };
    statsRow.height = 44;

    const attackGroup = new UIContainer();
    attackGroup.direction = 'row';
    attackGroup.gap = 8;
    attackGroup.alignItems = 'center';

    this._attackIcon = new UIImage('icon_attack', this._assetManager);
    this._attackIcon.setStyle({ width: 28, height: 28, fitMode: 'contain' });
    attackGroup.addChild(this._attackIcon);

    this._attackLabel = new UIText('ATK');
    this._attackLabel.setStyle({
      fontSize: 14,
      color: '#cc9966',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    attackGroup.addChild(this._attackLabel);

    this._attackValue = new UIText(String(cd.attack ?? 0));
    this._attackValue.setStyle({
      fontSize: 18,
      color: '#ffffff',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    attackGroup.addChild(this._attackValue);

    statsRow.addChild(attackGroup);

    const armorGroup = new UIContainer();
    armorGroup.direction = 'row';
    armorGroup.gap = 8;
    armorGroup.alignItems = 'center';

    this._armorIcon = new UIImage('icon_block', this._assetManager);
    this._armorIcon.setStyle({ width: 28, height: 28, fitMode: 'contain' });
    armorGroup.addChild(this._armorIcon);

    this._armorLabel = new UIText('DEF');
    this._armorLabel.setStyle({
      fontSize: 14,
      color: '#6699cc',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    armorGroup.addChild(this._armorLabel);

    this._armorValue = new UIText(String(cd.armor ?? 0));
    this._armorValue.setStyle({
      fontSize: 18,
      color: '#ffffff',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    armorGroup.addChild(this._armorValue);

    statsRow.addChild(armorGroup);
    this.addChild(statsRow);

    // ── 4. Mana orbs row ─────────────────────────────
    const manaRow = new UIPanel();
    manaRow.direction = 'row';
    manaRow.justifyContent = 'center';
    manaRow.alignItems = 'center';
    manaRow.gap = 12;
    manaRow.padding = { top: 40, right: 8, bottom: 8, left: 8 };
    manaRow.height = 100;
    manaRow.backgroundAssetKey = 'character_pane_skill_row';
    manaRow.assetManager = this._assetManager;
    manaRow.smoothing = true;

    const manaColors = {
      red:    '#cc3333',
      blue:   '#3366cc',
      green:  '#33aa33',
      yellow: '#cccc33',
      purple: '#9933cc',
    };

    const manaOrder = ['red', 'blue', 'green', 'yellow', 'purple'];
    const manaData = cd.mana || {};

    for (const color of manaOrder) {
      const orb = new UIOrb();
      orb.setStyle({
        color: manaColors[color],
        count: manaData[color] ?? 0,
        countColor: '#ffffff',
        fontSize: 18,
        width: 56,
        height: 84,
        borderColor: '#886622',
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

    // ── 5. Skills section ──────────────────────────────
    this._skillsTitle = new UIText('Skills');
    this._skillsTitle.setStyle({
      fontSize: 18,
      color: '#e0d070',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 28,
      margin: { top: 8, bottom: 4 },
    });
    this.addChild(this._skillsTitle);

    this._skillsContainer = new UIContainer();
    this._skillsContainer.direction = 'column';
    this._skillsContainer.gap = 30;
    this._skillsContainer.flexGrow = 1;
    this._skillsContainer.padding = 4;

    const skills = cd.skills || [];
    this._skillRows = [];

    for (const skillData of skills) {
      const row = new SkillRow(skillData, this._assetManager);
      row.setStyle({ height: 72 });
      // Wire skill click
      row._skillData = skillData;
      row.onClick = () => {
        if (this.onSkillClick) this.onSkillClick(skillData);
      };
      this._skillRows.push(row);
      this._skillsContainer.addChild(row);
    }

    this.addChild(this._skillsContainer);
  }

  /**
   * Fast update from BattleController combatant state.
   * Updates HP, armor, mana without rebuilding hierarchy.
   * @param {object} state - { hp, maxHp, armor, block, mana: {...}, ... }
   */
  updateFromState(state) {
    if (!state) return;

    // Health bar
    if (this._healthBar) {
      this._healthBar.value = state.hp ?? 0;
      this._healthBar.maxValue = state.maxHp ?? 100;
      const blockLabel = (state.block && state.block > 0) ? ` [${state.block}]` : '';
      this._healthBar.label = `${state.hp ?? 0} / ${state.maxHp ?? 0}${blockLabel}`;
    }

    // Stats
    if (this._attackValue) this._attackValue.text = String(state.attack ?? 0);
    if (this._armorValue) this._armorValue.text = String(state.armor ?? 0);

    // Mana orbs
    const manaData = state.mana || {};
    for (const color of Object.keys(this._manaOrbs)) {
      const orb = this._manaOrbs[color];
      if (orb) {
        orb.count = manaData[color] ?? 0;
      }
    }
  }

  /**
   * Update all display values from the current characterData.
   * Call this when changing character data externally.
   */
  updateFromData() {
    const cd = this._characterData;
    if (!cd) return;

    if (this._healthBar) {
      this._healthBar.value = cd.hp ?? 0;
      this._healthBar.maxValue = cd.maxHp ?? 100;
      this._healthBar.label = `${cd.hp ?? 0} / ${cd.maxHp ?? 0}`;
    }

    if (this._attackValue) this._attackValue.text = String(cd.attack ?? 0);
    if (this._armorValue) this._armorValue.text = String(cd.armor ?? 0);

    const manaData = cd.mana || {};
    for (const color of Object.keys(this._manaOrbs)) {
      const orb = this._manaOrbs[color];
      if (orb) orb.count = manaData[color] ?? 0;
    }

    const skills = cd.skills || [];
    if (skills.length !== this._skillRows.length) {
      this._skillsContainer.clearChildren();
      this._skillRows = [];
      for (const skillData of skills) {
        const row = new SkillRow(skillData, this._assetManager);
        row.setStyle({ height: 72 });
        if (this.onSkillClick) {
          row.onClick = () => this.onSkillClick(skillData);
        }
        this._skillRows.push(row);
        this._skillsContainer.addChild(row);
      }
    } else {
      for (let i = 0; i < skills.length; i++) {
        this._skillRows[i]._skillData = skills[i];
        this._skillRows[i].updateFromData();
      }
    }
  }

  /** Set shared asset manager on all children that need it */
  setAssetManager(am) {
    this._assetManager = am;
    if (this._portrait) this._portrait.assetManager = am;
    if (this._attackIcon) this._attackIcon.assetManager = am;
    if (this._armorIcon) this._armorIcon.assetManager = am;
    for (const row of this._skillRows) {
      row.setAssetManager(am);
    }
    for (const orb of Object.values(this._manaOrbs)) {
      if (orb) orb.assetManager = am;
    }
  }
}
