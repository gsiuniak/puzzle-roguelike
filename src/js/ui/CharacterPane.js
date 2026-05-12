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

    // Configure self — tighter gap so sections feel cohesive
    this.direction = 'column';
    this.gap = 8;
    this.padding = { top: 10, right: 14, bottom: 14, left: 14 };

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

    // ── 1. Unified identity card ── two columns: portrait | everything else ──
    const headerCard = new UIContainer();
    headerCard.direction = 'row';
    headerCard.gap = 24;
    headerCard.alignItems = 'start';
    headerCard.padding = { top: 4, right: 8, bottom: 8, left: 4 };

    // Left column — large portrait anchoring the header
    const portraitKey = cd.portrait ? `portrait_${cd.portrait}` : 'placeholder';
    this._portrait = new UIImage(portraitKey, this._assetManager);
    this._portrait.setStyle({
      width: 144,
      height: 184,
      fitMode: 'cover',
    });
    headerCard.addChild(this._portrait);

    // Right column — identity, health, stats stacked vertically
    const rightCol = new UIContainer();
    rightCol.direction = 'column';
    rightCol.gap = 0;
    rightCol.flexGrow = 1;
    rightCol.padding = { top: 8, right: 12 };

    // Name — primary focus of the identity area
    this._nameText = new UIText(cd.name || '');
    this._nameText.setStyle({
      fontSize: 30,
      color: '#d0d0c4',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 36,
    });
    rightCol.addChild(this._nameText);

    // Class + level — subtitle beneath name
    const classStr = cd.className ? `${cd.className}` : '';
    const levelStr = cd.level ? `  Lv.${cd.level}` : '';
    this._classText = new UIText(classStr + levelStr);
    this._classText.setStyle({
      fontSize: 14,
      color: '#b8966c',
      alignH: 'left',
      alignV: 'center',
      height: 22,
    });
    rightCol.addChild(this._classText);

    // Decorative divider beneath title area
    const titleDivider = new UIContainer();
    titleDivider.setStyle({
      height: 2,
      background: '#6a5a4a',
      margin: { top: 8, bottom: 8 },
      cornerRadius: 1,
    });
    rightCol.addChild(titleDivider);

    // HEALTH label
    const healthLabel = new UIText('HEALTH');
    healthLabel.setStyle({
      fontSize: 11,
      color: '#c4c4bb',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 18,
    });
    rightCol.addChild(healthLabel);

    // Compact, elegant HP bar — shorter, integrated into the layout
    this._healthBar = new UIProgressBar();
    this._healthBar.setStyle({
      value: cd.hp ?? 0,
      maxValue: cd.maxHp ?? 100,
      fillColor: '#cc3333',
      backgroundColor: '#1a0e0e',
      label: `${cd.hp ?? 0} / ${cd.maxHp ?? 0}`,
      labelColor: '#ffffff',
      labelFontSize: 12,
      borderColor: '#443322',
      borderWidth: 1,
      cornerRadius: 3,
      height: 22,
      widthPercent: 1,
      margin: { top: 2, bottom: 10 },
    });
    rightCol.addChild(this._healthBar);

    // Stats row — two balanced blocks with a vertical divider
    const statsRow = new UIContainer();
    statsRow.direction = 'row';
    statsRow.justifyContent = 'center';
    statsRow.alignItems = 'center';
    statsRow.gap = 6;
    statsRow.height = 56;

    // Attack block
    const attackBlock = new UIContainer();
    attackBlock.direction = 'column';
    attackBlock.alignItems = 'center';
    attackBlock.gap = 3;
    attackBlock.width = 100;

    const attackIconRow = new UIContainer();
    attackIconRow.direction = 'row';
    attackIconRow.gap = 6;
    attackIconRow.alignItems = 'center';
    attackIconRow.justifyContent = 'center';
    attackIconRow.height = 22;

    this._attackIcon = new UIImage('icon_attack', this._assetManager);
    this._attackIcon.setStyle({ width: 22, height: 22, fitMode: 'contain' });
    attackIconRow.addChild(this._attackIcon);

    this._attackLabel = new UIText('ATTACK');
    this._attackLabel.setStyle({
      fontSize: 12,
      color: '#cc9966',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    attackIconRow.addChild(this._attackLabel);

    attackBlock.addChild(attackIconRow);

    this._attackValue = new UIText(String(cd.attack ?? 0));
    this._attackValue.setStyle({
      fontSize: 26,
      color: '#ffffff',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 30,
    });
    attackBlock.addChild(this._attackValue);

    statsRow.addChild(attackBlock);

    // Vertical divider between stat blocks
    const vDivider = new UIContainer();
    vDivider.setStyle({
      width: 2,
      height: 44,
      background: '#3a2a1a',
      cornerRadius: 1,
      margin: { left: 6, right: 6 },
    });
    statsRow.addChild(vDivider);

    // Armor block
    const armorBlock = new UIContainer();
    armorBlock.direction = 'column';
    armorBlock.alignItems = 'center';
    armorBlock.gap = 3;
    armorBlock.width = 100;

    const armorIconRow = new UIContainer();
    armorIconRow.direction = 'row';
    armorIconRow.gap = 6;
    armorIconRow.alignItems = 'center';
    armorIconRow.justifyContent = 'center';
    armorIconRow.height = 22;

    this._armorIcon = new UIImage('icon_block', this._assetManager);
    this._armorIcon.setStyle({ width: 22, height: 22, fitMode: 'contain' });
    armorIconRow.addChild(this._armorIcon);

    this._armorLabel = new UIText('ARMOR');
    this._armorLabel.setStyle({
      fontSize: 12,
      color: '#6699cc',
      bold: true,
      alignH: 'left',
      alignV: 'center',
    });
    armorIconRow.addChild(this._armorLabel);

    armorBlock.addChild(armorIconRow);

    this._armorValue = new UIText(String(cd.armor ?? 0));
    this._armorValue.setStyle({
      fontSize: 26,
      color: '#ffffff',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 30,
    });
    armorBlock.addChild(this._armorValue);

    statsRow.addChild(armorBlock);
    rightCol.addChild(statsRow);

    headerCard.addChild(rightCol);
    this.addChild(headerCard);

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

    // ── 5. Skills section ──────────────────────────────
    // Centered row: [flair_left] "Skills" [flair_right]
    const skillsTitleRow = new UIContainer();
    skillsTitleRow.direction = 'row';
    skillsTitleRow.justifyContent = 'center';
    skillsTitleRow.alignItems = 'center';
    skillsTitleRow.gap = 10;
    skillsTitleRow.padding = { top: 0, bottom: 0 };
    skillsTitleRow.height = 25;

    const flairLeft = new UIImage('skill_flair_left', this._assetManager);
    flairLeft.setStyle({ width: 120, height: 28, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    skillsTitleRow.addChild(flairLeft);

    this._skillsTitle = new UIText('Skills');
    this._skillsTitle.setStyle({
      fontSize: 18,
      color: '#d0d0c4',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: 300,
      height: 28,
    });
    skillsTitleRow.addChild(this._skillsTitle);

    const flairRight = new UIImage('skill_flair_right', this._assetManager);
    flairRight.setStyle({ width: 120, height: 28, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center', margin: { left: 42 } });
    skillsTitleRow.addChild(flairRight);

    this.addChild(skillsTitleRow);

    this._skillsContainer = new UIContainer();
    this._skillsContainer.direction = 'column';
    this._skillsContainer.gap = 0;
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
      row.setManaState(manaData);
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

    // Propagate mana state to skill rows for affordability overlays
    for (const row of this._skillRows) {
      row.setManaState(manaData);
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
        row.setManaState(manaData);
        this._skillRows.push(row);
        this._skillsContainer.addChild(row);
      }
    } else {
      for (let i = 0; i < skills.length; i++) {
        this._skillRows[i]._skillData = skills[i];
        this._skillRows[i].updateFromData();
      }
      for (const row of this._skillRows) {
        row.setManaState(manaData);
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
