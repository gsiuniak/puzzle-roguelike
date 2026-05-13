/**
 * CharacterSelectScene — character selection screen between TitleScreen and BattleScene.
 *
 * Responsibilities:
 *   - Load available characters from characterSelectDefinitions
 *   - Render selected character splash background (cover, cross-fade on change)
 *   - Render character info panel (name, class, health, mana orbs, starting skills)
 *   - Render heroes portrait row (click to select)
 *   - Render Choose Hero button (hover/normal states)
 *   - Handle mouse click / keyboard input
 *   - Transition to BattleScene with selected character
 *
 * All rendering is data-driven from characterSelectDefinitions and mockCharacter data.
 * Layout uses manual positioning for the top-level areas (info panel, heroes, button)
 * and flexbox for internal content within each area. This avoids the auto-height
 * limitation of the custom flexbox system.
 */

import UIPanel from '../ui/UIPanel.js';
import UIContainer from '../ui/UIContainer.js';
import UIImage from '../ui/UIImage.js';
import UIText from '../ui/UIText.js';
import AudioManager from '../audio/AudioManager.js';
import characterSelectDefinitions from '../data/characterSelectDefinitions.js';
import mockEnemy from '../data/mockEnemy.js';
import BattleController from '../game/BattleController.js';
import BattleScene from '../ui/BattleScene.js';
import AuraStrandsEffect from '../ui/AuraStrandsEffect.js';

/** Duration of the cross-fade transition between splash backgrounds (ms) */
const CROSS_FADE_DURATION = 400;

const MANA_ORDER = ['red', 'blue', 'green', 'yellow', 'purple'];

export default class CharacterSelectScene extends UIPanel {
  constructor() {
    super();

    // ── Scene self-config ──────────────────────────────
    this.direction = 'column';
    this.gap = 0;
    this.padding = 0;

    // ── Character definitions (only enabled) ────────────
    this._definitions = characterSelectDefinitions
      .filter(d => d.enabled)
      .sort((a, b) => a.order - b.order);

    if (this._definitions.length === 0) {
      console.error('CharacterSelectScene: no enabled character definitions found.');
    }

    /** @type {number} index into _definitions */
    this._selectedIndex = 0;

    // ── Cross-fade state ───────────────────────────────
    /** @type {string|null} previous splash asset key */
    this._prevSplashKey = null;
    /** @type {string|null} current splash asset key */
    this._currSplashKey = null;
    /** @type {number} 0→1 fade progress */
    this._crossFadeAlpha = 1.0;

    // ── Child element references ───────────────────────
    /** @type {UIContainer|null} */
    this._infoPanel = null;
    /** @type {UIContainer|null} */
    this._heroesRow = null;
    /** @type {UIImage|null} */
    this._chooseButton = null;
    /** @type {UIContainer|null} */
    this._btnContainer = null;
    /** @type {UIImage[]} portrait images in heroes row */
    this._portraitImages = [];

    // ── Aura effect ────────────────────────────────────
    /** @type {AuraStrandsEffect} */
    this._auraEffect = new AuraStrandsEffect();

    // ── Hover state ────────────────────────────────────
    /** @type {boolean} */
    this._buttonHovered = false;

    // ── Input handler references (for cleanup) ─────────
    /** @type {Function|null} */
    this._onMouseDown = null;
    /** @type {Function|null} */
    this._onMouseMove = null;
    /** @type {Function|null} */
    this._onKeyDown = null;

    // ── Shared service references ──────────────────────
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = null;
    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;

    // ── Build UI ───────────────────────────────────────
    this._buildScene();
    this._updateInfoPanel();
  }

  // ═══════════════════════════════════════════════════════
  // Scene construction
  // ═══════════════════════════════════════════════════════

  _buildScene() {
    // ── Info panel (positioned manually in layoutChildren) ──
    // Narrower, card-like proportions with generous balanced padding
    // and clear section separation to match the mock's visual rhythm.
    this._infoPanel = new UIContainer();
    this._infoPanel.direction = 'column';
    this._infoPanel.alignItems = 'center';
    this._infoPanel.gap = 10;
    this._infoPanel.padding = { top: 32, right: 44, bottom: 48, left: 44 };
    this._infoPanel.smoothing = true;
    this.addChild(this._infoPanel);

    // ── Heroes row (positioned manually in layoutChildren) ──
    this._heroesRow = new UIContainer();
    this._heroesRow.direction = 'row';
    this._heroesRow.justifyContent = 'center';
    this._heroesRow.alignItems = 'center';
    this._heroesRow.gap = 24;
    this.addChild(this._heroesRow);

    // ── Build portrait images ──────────────────────────
    this._portraitImages = [];
    for (let i = 0; i < this._definitions.length; i++) {
      const def = this._definitions[i];
      const portrait = new UIImage(`character_select_portrait_${def.id}`, null); // assetManager set in onEnter
      portrait.setStyle({
        width: 150,
        height: 150,
        fitMode: 'contain',
        imageAlignH: 'center',
        imageAlignV: 'center',
      });
      portrait.userData = { index: i, defId: def.id };
      this._portraitImages.push(portrait);
      this._heroesRow.addChild(portrait);
    }

    // ── Choose Hero button (positioned manually in layoutChildren) ──
    this._btnContainer = new UIContainer();
    this._btnContainer.direction = 'row';
    this._btnContainer.justifyContent = 'center';
    this._btnContainer.alignItems = 'center';

    this._chooseButton = new UIImage('character_select_choose_hero_button', null);
    this._chooseButton.setStyle({
      width: 320,
      height: 80,
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
    });
    this._chooseButton.userData = { isButton: true };
    this._btnContainer.addChild(this._chooseButton);
    this.addChild(this._btnContainer);
  }

  /**
   * Rebuild the info panel contents for the currently selected character.
   *
   * Structure mirrors the mock's intentional top-to-bottom scan:
   *   Name → Class (with flairs) → Description →
   *   Divider → Health & Mana (single row) → Divider →
   *   "Starting Skills" (with flairs) → Skill blocks
   *
   * Every child has an explicit height so flexbox produces a deterministic
   * total panel height for vertical centering in layoutChildren().
   */
  _updateInfoPanel() {
    const panel = this._infoPanel;
    if (!panel) return;

    panel.clearChildren();

    const def = this._getSelectedDef();
    if (!def) return;

    const cd = def.characterData;
    const am = this._assetManager;

    // ── Character Name — large, dominant, the visual anchor ─
    const nameText = new UIText(cd.name || '');
    nameText.setStyle({
      fontSize: 42,
      color: '#e8d8b0',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 48,
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlur: 4,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      margin: { top: 20 }
    });
    panel.addChild(nameText);

    // ── Class row: [flair] ClassName [flair] ────────────
    const classRow = new UIContainer();
    classRow.direction = 'row';
    classRow.justifyContent = 'center';
    classRow.alignItems = 'center';
    classRow.gap = 14;
    classRow.height = 28;

    const flairL = new UIImage('character_select_flair_left', am);
    flairL.setStyle({ width: 100, height: 24, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    classRow.addChild(flairL);

    const classText = new UIText(cd.className || '');
    classText.setStyle({
      fontSize: 22,
      color: '#ccaa77',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: 120,
      height: 26,
      margin: { left: 65, right: 65 }
    });
    classRow.addChild(classText);

    const flairR = new UIImage('character_select_flair_right', am);
    flairR.setStyle({ width: 100, height: 24, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    classRow.addChild(flairR);
    panel.addChild(classRow);

    // ── Character description — centered, readable ──────
    const descText = new UIText(cd.description || '');
    descText.setStyle({
      fontSize: 15,
      color: '#b0a880',
      alignH: 'center',
      alignV: 'center',
      height: 60,
      maxWidth: 400,
    });
    panel.addChild(descText);

    // ── Divider ─────────────────────────────────────────
    const divider1 = new UIImage('character_select_divider', am);
    divider1.setStyle({ widthPercent: 0.78, height: 15, fitMode: 'stretch' });
    panel.addChild(divider1);

    // ── Health + mana single centered row ───────────────
    // Mock: "Health and mana sit in a single elegant centered row.
    //        Icons are evenly spaced. Values align visually with icons.
    //        Everything sits on the same baseline."
    const statManaRow = new UIContainer();
    statManaRow.direction = 'row';
    statManaRow.justifyContent = 'center';
    statManaRow.alignItems = 'center';
    statManaRow.gap = 12;
    statManaRow.height = 25;

    // Heart icon + health value group
    const heartIcon = new UIImage('character_select_heart', am);
    heartIcon.setStyle({ width: 22, height: 22, fitMode: 'contain' });
    statManaRow.addChild(heartIcon);

    const healthText = new UIText(`${cd.hp ?? 0} / ${cd.maxHp ?? 0}`);
    healthText.setStyle({
      fontSize: 18,
      color: '#ff6666',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      width: 80,
      height: 26,
      margin: { right: 50 }
    });
    statManaRow.addChild(healthText);

    // Spacer between health and mana groups
    const spacer = new UIContainer();
    spacer.width = 14;
    spacer.height = 1;
    statManaRow.addChild(spacer);

    // Mana groups: icon + count, evenly spaced, same baseline
    const manaData = cd.mana || {};
    const MANA_COLORS = [
      { key: 'red',    color: '#ff5555' },
      { key: 'blue',   color: '#5599ff' },
      { key: 'green',  color: '#55cc55' },
      { key: 'yellow', color: '#dddd44' },
      { key: 'purple', color: '#cc55cc' },
    ];

    for (const mc of MANA_COLORS) {
      const manaGroup = new UIContainer();
      manaGroup.direction = 'row';
      manaGroup.alignItems = 'center';
      manaGroup.gap = 4;
      manaGroup.width = 50;

      const symbol = new UIImage(`mana_${mc.key}`, am);
      symbol.setStyle({ width: 22, height: 22, fitMode: 'contain', margin: { right: 3 } });
      manaGroup.addChild(symbol);

      const countText = new UIText(String(manaData[mc.key] ?? 0));
      countText.setStyle({
        fontSize: 14,
        color: '#b0a880',
        bold: true,
        alignH: 'left',
        alignV: 'center',
        width: 30,
        height: 22,
        shadowColor: 'rgba(0,0,0,0.7)',
        shadowBlur: 2,
        shadowOffsetX: 1,
        shadowOffsetY: 1,
        margin: { right: 10 }
      });
      manaGroup.addChild(countText);

      statManaRow.addChild(manaGroup);
    }
    panel.addChild(statManaRow);

    // ── Divider ─────────────────────────────────────────
    // const divider2 = new UIImage('character_select_divider', am);
    // divider2.setStyle({ widthPercent: 0.78, height: 8, fitMode: 'stretch' });
    // panel.addChild(divider2);

    // ── "Starting Skills" title row with flairs ─────────
    const skillsTitleRow = new UIContainer();
    skillsTitleRow.direction = 'row';
    skillsTitleRow.justifyContent = 'center';
    skillsTitleRow.alignItems = 'center';
    skillsTitleRow.gap = 12;
    skillsTitleRow.height = 24;

    const sFlairL = new UIImage('character_select_flair_left', am);
    sFlairL.setStyle({ width: 200, height: 18, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    skillsTitleRow.addChild(sFlairL);

    const skillsTitle = new UIText('Starting Skills');
    skillsTitle.setStyle({
      fontSize: 16,
      color: '#ccaa77',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: 150,
      height: 22,
      margin: { left: 60, right: 60 }
    });
    skillsTitleRow.addChild(skillsTitle);

    const sFlairR = new UIImage('character_select_flair_right', am);
    sFlairR.setStyle({ width: 200, height: 18, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    skillsTitleRow.addChild(sFlairR);
    panel.addChild(skillsTitleRow);

    // ── Skills blocks row ──────────────────────────────
    const skills = cd.skills || [];
    const skillsRow = new UIContainer();
    skillsRow.direction = 'row';
    skillsRow.justifyContent = 'center';
    skillsRow.alignItems = 'center';
    skillsRow.gap = 36;
    skillsRow.height = 90;
    skillsRow.margin = { top: -5 };

    for (const skillData of skills) {
      const skillBlock = this._buildSkillBlock(skillData, am);
      skillsRow.addChild(skillBlock);
    }
    panel.addChild(skillsRow);
  }

  /**
   * Build a single skill block (icon + name + description) for the info panel.
   * Larger, breathable composition that matches the mock's visual weight.
   * @param {object} skillData - { name, description, icon }
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildSkillBlock(skillData, am) {
    const block = new UIContainer();
    block.direction = 'row';
    block.alignItems = 'center';
    block.gap = 12;
    block.width = 180;
    block.height = 80;

    // Column 1: Skill icon
    const iconKey = skillData.icon || 'placeholder';
    const icon = new UIImage(iconKey, am);
    icon.setStyle({ width: 80, height: 80, fitMode: 'contain' });
    block.addChild(icon);

    // Column 2: Name + Description in their own rows
    const textCol = new UIContainer();
    textCol.direction = 'column';
    textCol.justifyContent = 'center';
    textCol.alignItems = 'start';
    textCol.gap = 4;

    const nameText = new UIText(skillData.name || '');
    nameText.setStyle({
      fontSize: 16,
      color: '#e8d8b0',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 8,
      margin: { bottom: 5, top: 20 }
    });
    textCol.addChild(nameText);

    const descText = new UIText(skillData.description || '');
    descText.setStyle({
      fontSize: 12,
      color: '#c0b890',
      alignH: 'left',
      alignV: 'top',
      height: 50,
      maxWidth: 100,
    });
    textCol.addChild(descText);

    block.addChild(textCol);

    return block;
  }

  // ═══════════════════════════════════════════════════════
  // Layout (override — manual positioning)
  // ═══════════════════════════════════════════════════════

  /**
   * Manual layout: compute the info panel height from its children, then
   * center the entire block (panel + heroes + button) vertically in the
   * canvas. This avoids the auto-height limitation of the flexbox system.
   *
   * The panel uses a narrow, card-like width (≈38% of canvas) to create
   * the compact, centered "card" feel from the mock rather than a wide,
   * flattened strip.
   */
  layoutChildren() {
    const W = this.rect.w;
    const H = this.rect.h;
    if (W <= 0 || H <= 0) return;

    const panel = this._infoPanel;
    const heroes = this._heroesRow;

    // ── 1. Compute info panel dimensions ─────────────────
    // Narrow card proportions: 38–54% of canvas width, clamped to 420–540px
    let panelW = 500;
    let panelH = 200;

    if (panel) {
      panelW = Math.min(540, Math.max(420, W * 0.42));

      // Do a trial layout with generous height so child rects are computed
      panel.rect.x = 0;
      panel.rect.y = 0;
      panel.rect.w = panelW;
      panel.rect.h = 600;
      panel.layoutChildren();

      // Sum actual child heights
      const pad = panel._resolvePadding();
      let contentH = pad.top + pad.bottom;
      const visibleKids = panel.children.filter(c => c.visible);
      for (const kid of visibleKids) {
        contentH += kid.rect.h;
      }
      contentH += panel.gap * Math.max(0, visibleKids.length - 1);
      panelH = Math.ceil(contentH);
    }

    // ── 2. Fixed heights for heroes row and button ──────
    const heroesW = this._definitions.length * 124;
    const heroesH = 130;
    const btnW = 240;
    const btnH = 70;
    const gapPanelHeroes = Math.floor(H * 0.025);
    const gapHeroesBtn = Math.floor(H * 0.02);

    // ── 3. Center the entire block vertically ───────────
    const totalBlockH = panelH + gapPanelHeroes + heroesH + gapHeroesBtn + btnH;
    const startY = Math.max(0, Math.floor((H - totalBlockH) / 2));

    // ── 4. Position elements ────────────────────────────
    if (panel) {
      panel.rect.x = Math.floor((W - panelW) / 2);
      panel.rect.y = startY;
      panel.rect.w = panelW;
      panel.rect.h = panelH;
      panel.layoutChildren();
    }

    if (heroes) {
      heroes.rect.x = Math.floor((W - heroesW) / 2);
      heroes.rect.y = startY + panelH + gapPanelHeroes;
      heroes.rect.w = heroesW;
      heroes.rect.h = heroesH;
      heroes.layoutChildren();
    }

    if (this._btnContainer) {
      this._btnContainer.rect.x = Math.floor((W - btnW) / 2);
      this._btnContainer.rect.y = startY + panelH + gapPanelHeroes + heroesH + gapHeroesBtn;
      this._btnContainer.rect.w = btnW;
      this._btnContainer.rect.h = btnH;
      this._btnContainer.layoutChildren();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════

  /** @returns {object|undefined} the currently selected definition */
  _getSelectedDef() {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._definitions.length) {
      return this._definitions[0];
    }
    return this._definitions[this._selectedIndex];
  }

  /**
   * Change the selected character index.
   * Triggers cross-fade and info panel rebuild.
   * @param {number} newIndex
   */
  _selectIndex(newIndex) {
    if (newIndex < 0 || newIndex >= this._definitions.length) return;
    if (newIndex === this._selectedIndex) return;

    // Play character pick sound
    AudioManager.playSfx('character_select_pick');

    // Start cross-fade from current to new splash
    const prevDef = this._getSelectedDef();
    this._prevSplashKey = prevDef ? prevDef.splashKey : null;
    this._selectedIndex = newIndex;
    const newDef = this._getSelectedDef();
    this._currSplashKey = newDef ? newDef.splashKey : null;
    this._crossFadeAlpha = 0;

    // Transition aura color to new character
    if (newDef && newDef.auraColor) {
      const ac = newDef.auraColor;
      this._auraEffect.setTargetColor(ac.r, ac.g, ac.b);
    }

    // Rebuild info panel for new character
    this._updateInfoPanel();
  }

  // ═══════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════

  /** Called by SceneManager when this scene becomes active */
  onEnter() {
    const sm = this._sceneManager;
    if (!sm) return;

    this._assetManager = sm.assetManager;

    // Initialize splash to the first selected character
    const def = this._getSelectedDef();
    this._currSplashKey = def ? def.splashKey : null;
    this._prevSplashKey = null;
    this._crossFadeAlpha = 1.0;
    this._buttonHovered = false;

    // Initialize aura color to selected character
    if (def && def.auraColor) {
      const ac = def.auraColor;
      this._auraEffect.setColorInstant(ac.r, ac.g, ac.b);
    }

    // Propagate assetManager to all UIImage children
    this._propagateAssetManager(this);

    // Rebuild info panel now that assetManager is available
    this._updateInfoPanel();

    // ── Music ──────────────────────────────────────────
    AudioManager.playMusic('main_theme', { fadeIn: 600 });

    // ── Wire input ──────────────────────────────────────
    const input = sm._input;
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onKeyDown = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.canvas.addEventListener('keydown', this._onKeyDown);
    input.canvas.focus();
  }

  /** Called by SceneManager when this scene is being left */
  onExit() {
    const sm = this._sceneManager;
    if (!sm) return;

    // ── Stop music ────────────────────────────────────
    AudioManager.stopMusic(300);

    const input = sm._input;
    if (this._onMouseDown) {
      input.off('mousedown', this._onMouseDown);
      this._onMouseDown = null;
    }
    if (this._onMouseMove) {
      input.off('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
  }

  /** Recursively set assetManager on all UIImage children */
  _propagateAssetManager(element) {
    if (element.assetManager === null && element instanceof UIImage) {
      element.assetManager = this._assetManager;
    }
    for (const child of element.children) {
      this._propagateAssetManager(child);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Input
  // ═══════════════════════════════════════════════════════

  /** @param {number} x @param {number} y */
  _handleMouseDown(x, y) {
    const hit = this.hitTest(x, y);
    if (!hit) return;

    const ud = hit.userData;

    // Portrait click
    if (ud && ud.index !== undefined) {
      this._selectIndex(ud.index);
      return;
    }

    // Choose Hero button click
    if (ud && ud.isButton) {
      this._chooseHero();
      return;
    }
  }

  /** @param {number} x @param {number} y */
  _handleMouseMove(x, y) {
    const hit = this.hitTest(x, y);
    const ud = hit ? hit.userData : null;

    const newHover = !!(ud && ud.isButton);
    if (newHover !== this._buttonHovered) {
      this._buttonHovered = newHover;
      if (this._chooseButton) {
        this._chooseButton.assetKey = newHover
          ? 'character_select_choose_hero_button_hover'
          : 'character_select_choose_hero_button';
      }
    }
  }

  /** @param {KeyboardEvent} e */
  _handleKeyDown(e) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this._selectPrev();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this._selectNext();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this._chooseHero();
        break;
    }
  }

  _selectPrev() {
    const newIdx = this._selectedIndex - 1;
    if (newIdx >= 0) this._selectIndex(newIdx);
  }

  _selectNext() {
    const newIdx = this._selectedIndex + 1;
    if (newIdx < this._definitions.length) this._selectIndex(newIdx);
  }

  // ═══════════════════════════════════════════════════════
  // Battle transition
  // ═══════════════════════════════════════════════════════

  _chooseHero() {
    const def = this._getSelectedDef();
    if (!def) return;

    const sm = this._sceneManager;
    if (!sm) return;

    // Play confirm sound
    AudioManager.playSfx('character_select_confirm');

    // Deep-clone character data so runtime state does not mutate the definition
    const playerClone = JSON.parse(JSON.stringify(def.characterData));

    // Set up MapScene for this run
    const mapScene = sm._scenes['MapScene'];
    if (mapScene) {
      // Generate a fresh seed for this run
      mapScene.setSeed('run_' + Date.now());
      mapScene.setPlayerData(playerClone);

      // Switch to map scene
      sm.switchTo('MapScene');
    } else {
      // Fallback: direct to battle (shouldn't happen if MapScene is registered)
      console.warn('MapScene not found, falling back to direct BattleScene');
      const enemyClone = JSON.parse(JSON.stringify(mockEnemy));
      const battleController = new BattleController(playerClone, enemyClone);
      const battleScene = new BattleScene(
        playerClone,
        enemyClone,
        this._assetManager,
        battleController
      );
      battleScene.setAudioManager(sm.audioManager);
      sm.registerScene('BattleScene', battleScene);
      sm.switchTo('BattleScene');
    }
  }

  // ═══════════════════════════════════════════════════════
  // Update
  // ═══════════════════════════════════════════════════════

  /** @param {number} dt — delta time in ms */
  update(dt) {
    // Advance cross-fade
    if (this._crossFadeAlpha < 1.0) {
      this._crossFadeAlpha = Math.min(1.0, this._crossFadeAlpha + dt / CROSS_FADE_DURATION);
    }

    // Advance aura animation
    this._auraEffect.update(dt);

    super.update(dt);
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  /**
   * Override renderSelf to draw only the character splash backgrounds.
   * The info panel background is drawn separately in render() so the aura
   * can layer correctly between splash and UI.
   */
  renderSelf(ctx) {
    const am = this._assetManager;
    if (!am) return;

    const r = this.rect;
    if (r.w <= 0 || r.h <= 0) return;

    // ── Draw previous splash (cross-fade out) ──────────
    if (this._prevSplashKey && this._crossFadeAlpha < 1.0) {
      const prevImg = am.get(this._prevSplashKey);
      if (prevImg) {
        this._drawCoverImage(ctx, prevImg, r, 1.0 - this._crossFadeAlpha);
      }
    }

    // ── Draw current splash (cross-fade in) ────────────
    if (this._currSplashKey) {
      const currImg = am.get(this._currSplashKey);
      if (currImg) {
        this._drawCoverImage(ctx, currImg, r, Math.min(1.0, this._crossFadeAlpha));
      }
    }
  }

  /**
   * Draw the info panel background image. Called from render() after the
   * aura so the panel sits above the aura but below panel children text/icons.
   */
  _drawInfoPanelBackground(ctx) {
    const am = this._assetManager;
    if (!am) return;

    if (this._infoPanel) {
      const panelImg = am.get('character_select_info_panel');
      if (panelImg) {
        const pr = this._infoPanel.rect;
        if (pr.w > 0 && pr.h > 0) {
          ctx.save();
          ctx.globalAlpha = 0.92;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            panelImg,
            Math.floor(pr.x), Math.floor(pr.y),
            Math.ceil(pr.w), Math.ceil(pr.h)
          );
          ctx.restore();
        }
      }
    }
  }

  /**
   * Draw an image in "cover" mode within the given rect, preserving aspect ratio
   * and cropping excess. Applies globalAlpha for cross-fading.
   */
  _drawCoverImage(ctx, img, rect, alpha = 1.0) {
    if (!img || img.width <= 0 || img.height <= 0) return;

    const scaleX = rect.w / img.width;
    const scaleY = rect.h / img.height;
    const scale = Math.max(scaleX, scaleY);

    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = rect.x + (rect.w - drawW) / 2;
    const drawY = rect.y + (rect.h - drawH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  /**
   * Override render to draw selected-portrait highlight after children render.
   */
  render(ctx) {
    if (!this.visible) return;

    // 1. Draw character splash backgrounds
    this.renderSelf(ctx);

    // 2. Draw animated aura strands (over splash, under all UI)
    this._auraEffect.render(ctx, this.rect);

    // 3. Draw info panel background (over aura, under panel text/icons)
    this._drawInfoPanelBackground(ctx);

    // 4. Draw children (info panel contents, heroes row, button)
    this.renderChildren(ctx);

    // ── Selected portrait highlight ────────────────────
    if (this._selectedIndex >= 0 && this._selectedIndex < this._portraitImages.length) {
      const portrait = this._portraitImages[this._selectedIndex];
      const pr = portrait.rect;
      const margin = 4;

      ctx.save();
      // Golden highlight border
      ctx.strokeStyle = '#e8c850';
      ctx.lineWidth = 3;
      ctx.strokeRect(pr.x - margin, pr.y - margin, pr.w + margin * 2, pr.h + margin * 2);
      // Subtle glow
      ctx.strokeStyle = 'rgba(232, 200, 80, 0.3)';
      ctx.lineWidth = 6;
      ctx.strokeRect(pr.x - margin - 2, pr.y - margin - 2, pr.w + margin * 2 + 4, pr.h + margin * 2 + 4);
      ctx.restore();
    }

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }
}
