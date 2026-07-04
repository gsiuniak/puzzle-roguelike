/**
 * CharacterSelectScene — character selection screen between TitleScreen and BattleScene.
 *
 * Responsibilities:
 *   - Load available characters from characterSelectDefinitions
 *   - Render selected character splash background (cover, cross-fade on change)
 *   - Render character info panel (name, class, health, mana orbs, starting skills, starting relic)
 *   - Render heroes portrait row (click to select)
 *   - Render Choose Hero button (hover/normal states)
 *   - Handle mouse click / keyboard input
 *   - Transition to BattleScene with selected character
 *
 * All rendering is data-driven from characterSelectDefinitions and data/characters.
 * Layout uses manual positioning for the top-level areas (info panel, heroes, button)
 * and flexbox for internal content within each area. This avoids the auto-height
 * limitation of the custom flexbox system.
 */

import UIPanel from '../ui/UIPanel.js';
import UIContainer from '../ui/UIContainer.js';
import UIImage from '../ui/UIImage.js';
import UIText from '../ui/UIText.js';
import KeywordText from '../ui/KeywordText.js';
import TooltipManager from '../systems/TooltipManager.js';
import AudioManager from '../audio/AudioManager.js';
import characterSelectDefinitions from '../data/characterSelectDefinitions.js';
import { goblin } from '../data/enemies/index.js';
import BattleController from '../game/BattleController.js';
import BattleScene from '../ui/BattleScene.js';
import AuraStrandsEffect from '../ui/AuraStrandsEffect.js';
import { createRunState } from '../data/runState.js';
import { createPlayerBattleState } from '../data/playerStats.js';
import { resolveSkillIds } from '../data/skills/skillCatalog.js';
import { resolveRelicIds } from '../data/relics/relicCatalog.js';
import { resolveEnemyRelicIds } from '../data/relics/enemyRelicCatalog.js';

/** Duration of the cross-fade transition between splash backgrounds (ms) */
const CROSS_FADE_DURATION = 400;

/**
 * How quickly the UI (info panel, heroes, button, aura) fades out once a hero
 * with a `splashVideo` is confirmed, leaving only the full-canvas video (ms).
 */
const UI_FADE_OUT_DURATION = 350;

/**
 * How long BEFORE the choose-hero video's end to kick off the scene cross-fade,
 * so the fade-to-next-scene completes roughly as the video finishes (ms).
 * Should be ≥ the fadeToScene duration used below.
 */
const CHOOSE_VIDEO_CROSSFADE_LEAD = 700;

/** Safety bail-out if the video never reports a usable duration / 'ended' (ms). */
const CHOOSE_VIDEO_MAX_DURATION = 30000;

/**
 * Brief fade-in of the choose-hero video over the static splash (ms). The
 * video is drawn ON TOP of the splash, so ramping its alpha 0→1 reads as the
 * splash art fading out into the video — masking any small framing/color
 * inconsistencies between the splash and the video's first frames.
 * 0 = instant swap (old behavior).
 *
 * The video is held PAUSED on its first frame for the whole fade (a static
 * splash blended with a static frame) and playback only starts once the fade
 * completes — blending the splash with already-moving video reads as
 * ghosting/smearing instead of a dissolve.
 */
const CHOOSE_VIDEO_FADE_IN_MS = 0;

/**
 * Safety: if the intro video never becomes paintable (readyState < 2) within
 * this window, start playback anyway so the normal ended/error fallbacks can
 * drive the scene transition (ms).
 */
const CHOOSE_VIDEO_PLAY_FALLBACK_MS = 1000;

const MANA_ORDER = ['red', 'blue', 'green', 'yellow', 'purple'];

/**
 * Horizontal center of the floating UI block, as a fraction of canvas width.
 * The character splash art occupies the RIGHT side of the screen, so the
 * info / heroes / button block floats on the LEFT — centered around this
 * fraction — with no containing panel behind it.
 */
const LEFT_BLOCK_CENTER_FRAC = 0.36;

/**
 * Vertical spacing of the centered block, as fractions of canvas height.
 * The block (info panel → heroes row → choose button) is vertically centered,
 * then the heroes row + button are lifted by BLOCK_Y_LIFT_FRAC so the bottom
 * of the screen breathes, while the info panel gets its own smaller
 * PANEL_Y_LIFT_FRAC so it stays near the true center (lifting it as far as
 * the portraits reads worse). The heroes row sits tighter under the panel
 * (GAP_PANEL_HEROES_FRAC) and the choose button gets clearer separation
 * (GAP_HEROES_BUTTON_FRAC).
 */
const GAP_PANEL_HEROES_FRAC = 0.01;
const GAP_HEROES_BUTTON_FRAC = 0.032;
const BLOCK_Y_LIFT_FRAC = 0.015;
const PANEL_Y_LIFT_FRAC = 0.005;

/**
 * Left-side readability scrim: a subtle black gradient over the splash that is
 * darkest at the left edge and fades to fully transparent by
 * LEFT_OVERLAY_FADE_END_FRAC across the screen, lifting the floating left-side
 * text off the artwork. Set LEFT_OVERLAY_ALPHA to 0 to disable.
 */
const LEFT_OVERLAY_ALPHA = 0.65;
const LEFT_OVERLAY_HOLD_FRAC = 0.45;
const LEFT_OVERLAY_FADE_END_FRAC = 0.75;

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

    // ── Tooltips (inline keyword tooltips on skill/relic descriptions) ──
    /** @type {TooltipManager|null} */
    this._tooltipManager = null;
    /** @type {KeywordText[]} description elements with inline [[keyword]] markup */
    this._keywordDescs = [];

    // ── Hover state ────────────────────────────────────
    /** @type {boolean} */
    this._buttonHovered = false;

    // ── Choose-hero splash video intro ─────────────────
    // When a hero with a `splashVideo` is confirmed, the UI fades out while a
    // full-canvas video plays; the scene cross-fades to the next scene as the
    // video nears its end. The <video>s are off-DOM (not AssetManager entries).
    //
    // ALL heroes' intro videos are preloaded into a pool on enter and primed
    // (first frame decoded via a muted play→pause) so any hero plays instantly
    // with no buffering/decode stall — see _preloadAllVideos / _primeVideo.
    /** @type {Map<string, HTMLVideoElement>} preloaded intro videos keyed by src */
    this._videoPool = new Map();
    /** @type {HTMLVideoElement|null} the active intro video during a choose transition */
    this._video = null;
    /** @type {string|null} src of the active intro video */
    this._videoSrc = null;
    /** @type {boolean} true while the choose-hero video intro is playing */
    this._choosingActive = false;
    /** @type {object|null} the definition being transitioned into */
    this._chosenDef = null;
    /** @type {number} ms elapsed since the intro started */
    this._chooseElapsed = 0;
    /** @type {boolean} guard so the scene transition is started exactly once */
    this._chooseTransitionStarted = false;
    /** @type {number} 1→0 fade applied to all UI during the video intro */
    this._uiFadeAlpha = 1;
    /** @type {number} ms the intro video has been drawable — drives its fade-in over the splash */
    this._videoFadeMs = 0;
    /** @type {boolean} true once play() has been issued for the intro video */
    this._videoPlayStarted = false;

    // ── UI fill scale ──────────────────────────────────
    // Multiplier applied to all UI sizes so the layout fills more of the
    // physical screen on aspect ratios that pillarbox/letterbox the design
    // viewport (e.g. mobile landscape). Recomputed each layout pass.
    /** @type {number} */
    this._uiScale = 1;

    // ── Input handler references (for cleanup) ─────────
    /** @type {Function|null} */
    this._onMouseDown = null;
    /** @type {Function|null} */
    this._onMouseMove = null;
    /** @type {Function|null} */
    this._onMouseUp = null;
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
    const S = this._uiScale;

    // ── Info panel (positioned manually in layoutChildren) ──
    // Narrower, card-like proportions with generous balanced padding
    // and clear section separation to match the mock's visual rhythm.
    this._infoPanel = new UIContainer();
    this._infoPanel.direction = 'column';
    this._infoPanel.alignItems = 'center';
    this._infoPanel.gap = 10 * S;
    this._infoPanel.padding = { top: 32 * S, right: 44 * S, bottom: 48 * S, left: 44 * S };
    this._infoPanel.smoothing = true;
    this.addChild(this._infoPanel);

    // ── Heroes row (positioned manually in layoutChildren) ──
    this._heroesRow = new UIContainer();
    this._heroesRow.direction = 'row';
    this._heroesRow.justifyContent = 'center';
    this._heroesRow.alignItems = 'center';
    this._heroesRow.gap = 24 * S;
    this.addChild(this._heroesRow);

    // ── Build portrait images ──────────────────────────
    this._portraitImages = [];
    for (let i = 0; i < this._definitions.length; i++) {
      const def = this._definitions[i];
      const portrait = new UIImage(`character_select_portrait_${def.id}`, null); // assetManager set in onEnter
      portrait.setStyle({
        width: 150 * S,
        height: 150 * S,
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
      width: 320 * S,
      height: 80 * S,
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
   *   "Starting Skills" (with flairs) → Skill blocks →
   *   "Starting Relic" (with flairs) → centered relic block [if any]
   *
   * Every child has an explicit height so flexbox produces a deterministic
   * total panel height for vertical centering in layoutChildren().
   */
  _updateInfoPanel() {
    const panel = this._infoPanel;
    if (!panel) return;

    panel.clearChildren();
    // Rebuilt from scratch each time — drop stale keyword desc references.
    this._keywordDescs = [];

    const def = this._getSelectedDef();
    if (!def) return;

    const cd = def.characterData;
    const am = this._assetManager;
    const S = this._uiScale;

    // Sync container's own padding/gap to the current scale so the panel
    // body grows with the rest of the UI when scale changes.
    panel.gap = 10 * S;
    panel.padding = { top: 32 * S, right: 44 * S, bottom: 48 * S, left: 44 * S };

    // ── Character Name — large, dominant, the visual anchor ─
    const nameText = new UIText(cd.name || '');
    nameText.setStyle({
      fontSize: 42 * S,
      color: '#e8d8b0',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 48 * S,
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlur: 4,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      margin: { top: 20 * S }
    });
    panel.addChild(nameText);

    // ── Class row: [flair] ClassName [flair] ────────────
    const classRow = new UIContainer();
    classRow.direction = 'row';
    classRow.justifyContent = 'center';
    classRow.alignItems = 'center';
    classRow.gap = 14 * S;
    classRow.height = 28 * S;

    const flairL = new UIImage('character_select_flair_left', am);
    flairL.setStyle({ width: 100 * S, height: 24 * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    classRow.addChild(flairL);

    const classText = new UIText(cd.className || '');
    classText.setStyle({
      fontSize: 22 * S,
      color: '#ccaa77',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: 120 * S,
      height: 26 * S,
      margin: { left: 95 * S, right: 95 * S }
    });
    classRow.addChild(classText);

    const flairR = new UIImage('character_select_flair_right', am);
    flairR.setStyle({ width: 100 * S, height: 24 * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    classRow.addChild(flairR);
    panel.addChild(classRow);

    // ── Character description — centered, readable ──────
    const descText = new KeywordText(cd.description || '');
    descText.setStyle({
      fontSize: 18 * S,
      color: '#b0a880',
      alignH: 'center',
      alignV: 'center',
      height: 60 * S,
      maxWidth: 560 * S,
    });
    panel.addChild(descText);
    this._keywordDescs.push(descText);

    // ── Divider ─────────────────────────────────────────
    const divider1 = new UIImage('character_select_divider', am);
    divider1.setStyle({ widthPercent: 0.78, height: 15 * S, fitMode: 'stretch' });
    panel.addChild(divider1);

    // ── Health + mana single centered row ───────────────
    // Mock: "Health and mana sit in a single elegant centered row.
    //        Icons are evenly spaced. Values align visually with icons.
    //        Everything sits on the same baseline."
    const statManaRow = new UIContainer();
    statManaRow.direction = 'row';
    statManaRow.justifyContent = 'center';
    statManaRow.alignItems = 'center';
    statManaRow.gap = 12 * S;
    statManaRow.height = 25 * S;

    // Heart icon + health value group
    const heartIcon = new UIImage('character_select_heart', am);
    heartIcon.setStyle({ width: 22 * S, height: 22 * S, fitMode: 'contain' });
    statManaRow.addChild(heartIcon);

    const baseStats = cd.baseStats || {};
    const healthText = new UIText(`${baseStats.maxHp ?? 0} / ${baseStats.maxHp ?? 0}`);
    healthText.setStyle({
      fontSize: 18 * S,
      color: '#ff6666',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      width: 80 * S,
      height: 26 * S,
      margin: { right: 50 * S }
    });
    statManaRow.addChild(healthText);

    // Spacer between health and mana groups
    const spacer = new UIContainer();
    spacer.width = 14 * S;
    spacer.height = 1;
    statManaRow.addChild(spacer);

    // Mana groups: icon + count, evenly spaced, same baseline
    const manaData = cd.baseStats ? cd.baseStats.startingMana : {};
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
      manaGroup.gap = 4 * S;
      manaGroup.width = 50 * S;

      const symbol = new UIImage(`mana_${mc.key}`, am);
      symbol.setStyle({ width: 22 * S, height: 22 * S, fitMode: 'contain', margin: { right: 3 * S } });
      manaGroup.addChild(symbol);

      const countText = new UIText(String(manaData[mc.key] ?? 0));
      countText.setStyle({
        fontSize: 14 * S,
        color: '#b0a880',
        bold: true,
        alignH: 'left',
        alignV: 'center',
        width: 30 * S,
        height: 22 * S,
        shadowColor: 'rgba(0,0,0,0.7)',
        shadowBlur: 2,
        shadowOffsetX: 1,
        shadowOffsetY: 1,
        margin: { right: 10 * S }
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
    skillsTitleRow.gap = 12 * S;
    skillsTitleRow.height = 24 * S;

    const sFlairL = new UIImage('character_select_flair_left', am);
    sFlairL.setStyle({ width: 200 * S, height: 18 * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    skillsTitleRow.addChild(sFlairL);

    const skillsTitle = new UIText('Starting Skills');
    skillsTitle.setStyle({
      fontSize: 20 * S,
      color: '#ccaa77',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: 150 * S,
      height: 22 * S,
      margin: { left: 90 * S, right: 90 * S }
    });
    skillsTitleRow.addChild(skillsTitle);

    const sFlairR = new UIImage('character_select_flair_right', am);
    sFlairR.setStyle({ width: 200 * S, height: 18 * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    skillsTitleRow.addChild(sFlairR);
    panel.addChild(skillsTitleRow);

    // ── Skills blocks row ──────────────────────────────
    // characterData.skills are skill ID strings — resolve via the
    // catalog so the blocks see full objects (name, description, icon).
    const skills = resolveSkillIds(cd.skills || []);
    const skillsRow = new UIContainer();
    skillsRow.direction = 'row';
    skillsRow.justifyContent = 'center';
    skillsRow.alignItems = 'center';
    skillsRow.gap = 30 * S;
    skillsRow.height = 90 * S;
    skillsRow.margin = { top: -5 * S };

    for (const skillData of skills) {
      const skillBlock = this._buildSkillBlock(skillData, am);
      skillsRow.addChild(skillBlock);
    }
    panel.addChild(skillsRow);

    // ── "Starting Relic" section (only if the character has relics) ──
    const relics = resolveRelicIds(cd.relics || []);
    if (relics.length > 0) {
      // Title row with flairs — mirrors the Starting Skills header style.
      const relicsTitleRow = new UIContainer();
      relicsTitleRow.direction = 'row';
      relicsTitleRow.justifyContent = 'center';
      relicsTitleRow.alignItems = 'center';
      relicsTitleRow.gap = 12 * S;
      relicsTitleRow.height = 24 * S;

      const rFlairL = new UIImage('character_select_flair_left', am);
      rFlairL.setStyle({ width: 200 * S, height: 18 * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
      relicsTitleRow.addChild(rFlairL);

      const relicsTitle = new UIText('Starting Relic');
      relicsTitle.setStyle({
        fontSize: 20 * S,
        color: '#ccaa77',
        bold: true,
        alignH: 'center',
        alignV: 'center',
        width: 150 * S,
        height: 22 * S,
        margin: { left: 90 * S, right: 90 * S }
      });
      relicsTitleRow.addChild(relicsTitle);

      const rFlairR = new UIImage('character_select_flair_right', am);
      rFlairR.setStyle({ width: 200 * S, height: 18 * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
      relicsTitleRow.addChild(rFlairR);
      panel.addChild(relicsTitleRow);

      // Single centered relic block — wider than a skill block since
      // only ever one relic occupies the row, so it can spread out and
      // let the description breathe on a single line.
      const relicsRow = new UIContainer();
      relicsRow.direction = 'row';
      relicsRow.justifyContent = 'center';
      relicsRow.alignItems = 'center';
      relicsRow.height = 90 * S;
      relicsRow.margin = { top: -5 * S };

      const relicBlock = this._buildRelicBlock(relics[0], am);
      relicsRow.addChild(relicBlock);
      panel.addChild(relicsRow);
    }

    // Re-register the rebuilt description elements as keyword tooltip sources.
    this._registerKeywordTooltips();
  }

  /**
   * Register every collected description KeywordText as an inline keyword
   * tooltip source on the scene's TooltipManager (clears the previous set
   * first, since the panel is rebuilt each selection change).
   */
  _registerKeywordTooltips() {
    const tm = this._tooltipManager;
    if (!tm) return;
    tm.clearKeywordSources();
    const opts = { scale: 1.0, padding: 22, offset: 16, hitPadding: 7 };
    for (const kt of this._keywordDescs) tm.attachKeywordSource(kt, opts);
  }

  /**
   * Build a single skill block (icon + name + description) for the info panel.
   * Larger, breathable composition that matches the mock's visual weight.
   * @param {object} skillData - { name, description, icon }
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildSkillBlock(skillData, am) {
    const S = this._uiScale;
    const block = new UIContainer();
    block.direction = 'row';
    block.alignItems = 'center';
    block.gap = 12 * S;
    block.width = 240 * S;
    block.height = 80 * S;

    // Column 1: Skill icon
    const iconKey = skillData.icon || 'placeholder';
    const icon = new UIImage(iconKey, am);
    icon.setStyle({ width: 80 * S, height: 80 * S, fitMode: 'contain' });
    block.addChild(icon);

    // Column 2: Name + Description in their own rows
    const textCol = new UIContainer();
    textCol.direction = 'column';
    textCol.justifyContent = 'center';
    textCol.alignItems = 'start';
    textCol.gap = 4 * S;

    const nameText = new UIText(skillData.name || '');
    nameText.setStyle({
      fontSize: 18 * S,
      color: '#e8d8b0',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 8 * S,
      margin: { bottom: 5 * S, top: 20 * S }
    });
    textCol.addChild(nameText);

    const descText = new KeywordText(skillData.description || '');
    descText.setStyle({
      fontSize: 14 * S,
      color: '#c0b890',
      alignH: 'left',
      alignV: 'top',
      height: 50 * S,
      maxWidth: 150 * S,
    });
    textCol.addChild(descText);
    this._keywordDescs.push(descText);

    block.addChild(textCol);

    return block;
  }

  /**
   * Build the single relic block (icon + name + description) for the
   * Starting Relic row. Wider than a skill block so the description has
   * room to breathe on one line — there's only ever one relic, so the
   * block can spread across most of the panel's content width.
   * @param {object} relicData - { name, description, icon }
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildRelicBlock(relicData, am) {
    const S = this._uiScale;
    // Center the icon+text pair WITHIN the block (block.justifyContent =
    // 'center'). Without this, textCol's implicit flexGrow:1 stretches it to
    // fill the block, leaving the icon anchored to the left edge — which
    // made the relic look left-aligned even though the block itself was
    // centered in the row. textCol now has a fixed width and explicit
    // flexGrow:0 so the icon+textCol stays compact and slack distributes
    // evenly on both sides.
    const TEXT_COL_WIDTH = 300 * S;
    const block = new UIContainer();
    block.direction = 'row';
    block.justifyContent = 'center';
    block.alignItems = 'center';
    block.gap = 16 * S;
    block.width = 460 * S;
    block.height = 80 * S;

    const iconKey = relicData.icon || 'placeholder';
    const icon = new UIImage(iconKey, am);
    icon.setStyle({ width: 80 * S, height: 80 * S, fitMode: 'contain' });
    block.addChild(icon);

    const textCol = new UIContainer();
    textCol.direction = 'column';
    textCol.justifyContent = 'center';
    textCol.alignItems = 'start';
    textCol.gap = 4 * S;
    textCol.width = TEXT_COL_WIDTH;
    textCol.flexGrow = 0;

    const nameText = new UIText(relicData.name || '');
    nameText.setStyle({
      fontSize: 18 * S,
      color: '#e8d8b0',
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: 8 * S,
      margin: { bottom: 5 * S, top: 20 * S }
    });
    textCol.addChild(nameText);

    const descText = new KeywordText(relicData.description || '');
    descText.setStyle({
      fontSize: 14 * S,
      color: '#c0b890',
      alignH: 'left',
      alignV: 'top',
      height: 50 * S,
      maxWidth: TEXT_COL_WIDTH,
    });
    textCol.addChild(descText);
    this._keywordDescs.push(descText);

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

    // ── 0. Sync UI scale to the current physical viewport ───
    // On aspect ratios that pillarbox/letterbox the design viewport
    // (e.g. mobile landscape, 21:9 ultrawide), scale UI elements up so
    // they fill a similar share of the physical screen as on a 16:9 display.
    const newScale = this._computeUIScale();
    if (Math.abs(newScale - this._uiScale) > 0.005) {
      this._uiScale = newScale;
      this._applyUIScaleToFixedElements();
      this._updateInfoPanel();
    }

    const S = this._uiScale;
    const panel = this._infoPanel;
    const heroes = this._heroesRow;

    // ── 1. Compute info panel dimensions ─────────────────
    // Wider card proportions to match the updated character_select_info_panel
    // asset's aspect ratio. ~50–60% of canvas width, clamped to 640–780px.
    let panelW = 700 * S;
    let panelH = 200 * S;

    if (panel) {
      panelW = Math.min(780 * S, Math.max(640 * S, W * 0.55 * S));

      // Do a trial layout with generous height so child rects are computed
      panel.rect.x = 0;
      panel.rect.y = 0;
      panel.rect.w = panelW;
      panel.rect.h = 600 * S;
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
    const heroesW = this._definitions.length * 124 * S;
    const heroesH = 110 * S;
    const btnW = 240 * S;
    const btnH = 70 * S;
    const gapPanelHeroes = Math.floor(H * GAP_PANEL_HEROES_FRAC);
    const gapHeroesBtn = Math.floor(H * GAP_HEROES_BUTTON_FRAC);

    // ── 3. Center the entire block vertically ───────────
    // The heroes row + button chain lifts by BLOCK_Y_LIFT_FRAC; the info
    // panel lifts by its own smaller PANEL_Y_LIFT_FRAC (see constants).
    const totalBlockH = panelH + gapPanelHeroes + heroesH + gapHeroesBtn + btnH;
    const baseStartY = Math.max(0, Math.floor((H - totalBlockH) / 2));
    const startY = Math.max(0, baseStartY - Math.floor(H * BLOCK_Y_LIFT_FRAC));
    const panelY = Math.max(0, baseStartY - Math.floor(H * PANEL_Y_LIFT_FRAC));

    // ── 4. Position elements ────────────────────────────
    // The info content floats on the LEFT of the splash (opposite the character
    // art), centered around LEFT_BLOCK_CENTER_FRAC. The heroes portrait row and
    // the Choose Hero button stay centered mid-screen.
    const blockCenterX = Math.floor(W * LEFT_BLOCK_CENTER_FRAC);

    if (panel) {
      panel.rect.x = Math.floor(blockCenterX - panelW / 2);
      panel.rect.y = panelY;
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
  // UI scale (aspect-aware fill)
  // ═══════════════════════════════════════════════════════

  /**
   * Compute a UI multiplier based on how much the physical canvas aspect
   * differs from the design viewport aspect. When the physical viewport is
   * pillarboxed (wider) or letterboxed (taller) than the design rect, UI
   * elements get scaled up so they fill a similar share of the screen as
   * they do on a 16:9 display.
   *
   * Capped at 1.5× to keep the layout from outgrowing the design viewport
   * vertically on extreme aspect ratios.
   *
   * @returns {number}
   */
  _computeUIScale() {
    const app = this._sceneManager ? this._sceneManager._app : null;
    if (!app || !app.cssWidth || !app.cssHeight) return 1;

    const designAspect = app.designWidth / app.designHeight;
    const cssAspect = app.cssWidth / app.cssHeight;
    const ratio = cssAspect > designAspect
      ? cssAspect / designAspect
      : designAspect / cssAspect;

    return Math.min(1.5, Math.max(1.3, ratio));
  }

  /**
   * Re-apply size styles to the long-lived UI elements created in
   * _buildScene (portraits, choose-hero button, heroes row gap) so they
   * track the current _uiScale. Inner info-panel elements are rebuilt
   * separately via _updateInfoPanel().
   */
  _applyUIScaleToFixedElements() {
    const S = this._uiScale;

    if (this._heroesRow) {
      this._heroesRow.gap = 24 * S;
    }

    for (const portrait of this._portraitImages) {
      portrait.setStyle({ width: 130 * S, height: 130 * S });
    }

    if (this._chooseButton) {
      this._chooseButton.setStyle({ width: 320 * S, height: 80 * S });
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

    // All hero intro videos are preloaded into the pool up front (see
    // _preloadAllVideos in onEnter), so the newly selected hero is already
    // buffered + primed and needs no per-selection work here.
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

    // Reset the choose-hero video intro (the scene instance is reused across
    // runs, e.g. after a defeat returns here).
    this._choosingActive = false;
    this._chosenDef = null;
    this._chooseElapsed = 0;
    this._chooseTransitionStarted = false;
    this._uiFadeAlpha = 1;
    this._videoFadeMs = 0;
    this._videoPlayStarted = false;
    // Preload + prime EVERY hero's intro video so whichever hero is confirmed
    // plays instantly with no buffering/decode stall.
    this._preloadAllVideos();

    // Initialize aura color to selected character
    if (def && def.auraColor) {
      const ac = def.auraColor;
      this._auraEffect.setColorInstant(ac.r, ac.g, ac.b);
    }

    // Propagate assetManager to all UIImage children
    this._propagateAssetManager(this);

    // ── Tooltip manager (created once; reused across re-entries) ──
    // Created BEFORE _updateInfoPanel so the rebuilt description elements can
    // register their inline keyword spans as tooltip sources.
    if (!this._tooltipManager) {
      this._tooltipManager = new TooltipManager({
        input: sm._input,
        app: sm._app,
        assetManager: this._assetManager,
      });
    }
    this._tooltipManager.clear();
    this._tooltipManager.setEnabled(true);

    // Rebuild info panel now that assetManager is available
    this._updateInfoPanel();

    // ── Music ──────────────────────────────────────────
    AudioManager.playMusic('main_theme', { fadeIn: 600 });

    // ── Wire input ──────────────────────────────────────
    const input = sm._input;
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onMouseUp = (x, y) => this._handleMouseUp(x, y);
    this._onKeyDown = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.on('mouseup', this._onMouseUp);
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
    if (this._onMouseUp) {
      input.off('mouseup', this._onMouseUp);
      this._onMouseUp = null;
    }
    if (this._tooltipManager) {
      this._tooltipManager.clear();
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }

    // Release all preloaded intro videos (the transition to the next scene is
    // already underway by the time this fires).
    this._destroyVideoPool();
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
    // Once a hero is confirmed and the intro video is playing, ignore input.
    if (this._choosingActive) return;

    if (this._tooltipManager) this._tooltipManager.onMouseDown(x, y);

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
  _handleMouseUp(x, y) {
    if (this._tooltipManager) this._tooltipManager.onMouseUp(x, y);
  }

  /** @param {number} x @param {number} y */
  _handleMouseMove(x, y) {
    if (this._tooltipManager) this._tooltipManager.onMouseMove(x, y);

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
    // Lock out navigation/confirm while the intro video is playing.
    if (this._choosingActive) return;

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
    // Ignore re-confirms while an intro video is already playing.
    if (this._choosingActive) return;

    const def = this._getSelectedDef();
    if (!def) return;

    const sm = this._sceneManager;
    if (!sm) return;

    // Play confirm sound
    AudioManager.playSfx('character_select_confirm');

    // If this hero has a full-canvas intro video, fade the UI out and play it;
    // the scene transition is deferred until the video nears its end.
    if (def.splashVideo) {
      this._beginChooseIntro(def);
      return;
    }

    // Otherwise transition immediately (existing behavior).
    this._performSceneTransition(def);
  }

  /**
   * Begin the choose-hero intro: fade the UI out (driven in update) and play
   * the hero's full-canvas video. The actual scene transition is started later
   * by _maybeStartChooseTransition() once the video nears its end (or on
   * end/error/timeout).
   * @param {object} def
   */
  _beginChooseIntro(def) {
    this._choosingActive = true;
    this._chosenDef = def;
    this._chooseElapsed = 0;
    this._chooseTransitionStarted = false;
    this._videoFadeMs = 0;

    // Grab the (already preloaded + primed) pooled video for this hero.
    const video = this._ensurePooledVideo(def.splashVideo);
    this._video = video;
    this._videoSrc = def.splashVideo;
    if (!video) {
      // No video element (build/preload failed) — just transition.
      this._startChooseTransition();
      return;
    }

    // The pooled video may still be mid-prime (playing muted) — make sure it
    // sits paused on frame 0 for the fade.
    try { video.pause(); } catch (e) { /* ignore */ }
    try { video.currentTime = 0; } catch (e) { /* ignore */ }
    // Hold the video paused on its first frame while it fades in over the
    // splash; playback starts from _updateChooseIntro once the fade completes
    // (blending the splash with already-moving video reads as ghosting).
    this._videoPlayStarted = false;
    if (CHOOSE_VIDEO_FADE_IN_MS <= 0) this._startVideoPlayback();
  }

  /**
   * Issue play() on the intro video exactly once (deferred until its fade-in
   * over the splash completes). Autoplay block / decode failure falls back to
   * an immediate scene transition.
   */
  _startVideoPlayback() {
    if (this._videoPlayStarted) return;
    this._videoPlayStarted = true;
    const video = this._video;
    if (!video) return;
    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => this._startChooseTransition());
    }
  }

  /**
   * Perform the run-state setup and fade to the next scene. Extracted from
   * _chooseHero so it can run either immediately (no video) or deferred (after
   * the intro video).
   * @param {object} def
   */
  _performSceneTransition(def) {
    const sm = this._sceneManager;
    if (!sm) return;

    // Create run state from the immutable character definition.
    // This preserves baseStats as the immutable template and initializes
    // statModifiers to zero — ready for run progression.
    const runState = createRunState(def.characterData);

    // Set up MapScene for this run
    const mapScene = sm._scenes['MapScene'];
    if (mapScene) {
      // Fully reset map/traversal state so this run starts clean — without
      // this, a prior run that ended in defeat (which bypasses the normal
      // return-to-map flow) leaves stale traversal state and the new run
      // would reuse the old map/position. (setRunState below replaces HP/stats.)
      if (mapScene.resetForNewRun) mapScene.resetForNewRun();

      // Generate a fresh seed for this run
      mapScene.setSeed('run_' + Date.now());
      mapScene.setRunState(runState, def.characterData);

      // Fade transition to map scene
      sm.fadeToScene('MapScene', 500);
    } else {
      // Fallback: direct to battle (shouldn't happen if MapScene is registered)
      console.warn('MapScene not found, falling back to direct BattleScene');
      const enemyClone = JSON.parse(JSON.stringify(goblin));
      enemyClone.skills = resolveSkillIds(enemyClone.skills || []);
      enemyClone.relics = resolveEnemyRelicIds(enemyClone.relics || []);
      const playerBattleState = createPlayerBattleState(def.characterData, runState);
      const battleController = new BattleController(playerBattleState, enemyClone);
      const battleScene = new BattleScene(
        playerBattleState,
        enemyClone,
        this._assetManager,
        battleController
      );
      battleScene.setAudioManager(sm.audioManager);
      sm.registerScene('BattleScene', battleScene);
      sm.fadeToScene('BattleScene', 500);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Choose-hero intro video
  // ═══════════════════════════════════════════════════════

  /**
   * Preload + prime EVERY enabled hero's `splashVideo` into the pool so that
   * whichever hero is confirmed, its intro video plays the instant `play()` is
   * called — no network buffering or first-frame decode stall. Idempotent.
   */
  _preloadAllVideos() {
    for (const def of this._definitions) {
      const src = def && def.splashVideo;
      if (src) this._ensurePooledVideo(src);
    }
  }

  /**
   * Ensure the off-DOM <video> for `src` exists in the pool (building + kicking
   * off its load on first request) and return it. Re-calling for an already
   * pooled src returns the existing element.
   * @param {string} src
   * @returns {HTMLVideoElement|null}
   */
  _ensurePooledVideo(src) {
    if (!src) return null;
    let video = this._videoPool.get(src);
    if (video) return video;
    video = this._buildVideo(src);
    this._videoPool.set(src, video);
    try { video.load(); } catch (e) { /* ignore */ }
    return video;
  }

  /**
   * Create the off-DOM <video> for `src` and wire its listeners. Plays muted so
   * autoplay is allowed; the character-select music keeps playing underneath.
   * Listeners are stashed on the element (`_csListeners`) for teardown.
   * @param {string} src
   * @returns {HTMLVideoElement}
   */
  _buildVideo(src) {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;
    video.loop = false;
    video.preload = 'auto';

    // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
    // intrinsic video size so the cover-fit math works for the <video>.
    const onMeta = () => {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    };
    // The video ending / failing is a hard cue to finish (no-op until the intro
    // is actually active; _startChooseTransition guards on _choosingActive).
    const onEnded = () => this._startChooseTransition();
    const onError = () => this._startChooseTransition();
    // Once the first frame is available, prime the decoder so playback starts
    // with zero stall when this hero is chosen.
    const onLoadedData = () => this._primeVideo(video);

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);
    video._csListeners = { onMeta, onEnded, onError, onLoadedData };

    return video;
  }

  /**
   * Warm a pooled video's decode pipeline by briefly play→pause-ing it (muted,
   * so this is allowed without a gesture and is inaudible), then rewinding to
   * frame 0. This forces the first frame to decode ahead of time so the real
   * `play()` on confirm has no buffering/decode hitch. Runs once per video and
   * never disturbs the video that's actively playing the intro.
   * @param {HTMLVideoElement} video
   */
  _primeVideo(video) {
    if (video._csPrimed) return;
    if (this._choosingActive && this._video === video) return; // it's live — leave it
    video._csPrimed = true;

    const settle = () => {
      if (this._choosingActive && this._video === video) return; // became live mid-prime
      try { video.pause(); } catch (e) { /* ignore */ }
      try { video.currentTime = 0; } catch (e) { /* ignore */ }
    };
    const p = video.play();
    if (p && typeof p.then === 'function') p.then(settle).catch(() => { /* ignore */ });
    else settle();
  }

  /** Stop, unwire, and release a single pooled <video> element. */
  _destroyPooledVideo(video) {
    if (!video) return;
    const L = video._csListeners;
    if (L) {
      video.removeEventListener('loadedmetadata', L.onMeta);
      video.removeEventListener('ended', L.onEnded);
      video.removeEventListener('error', L.onError);
      video.removeEventListener('loadeddata', L.onLoadedData);
    }
    video._csListeners = null;
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
  }

  /** Release every pooled intro video. */
  _destroyVideoPool() {
    for (const video of this._videoPool.values()) this._destroyPooledVideo(video);
    this._videoPool.clear();
    this._video = null;
    this._videoSrc = null;
  }

  /**
   * Start the deferred scene transition exactly once. Called when the intro
   * video nears its end, ends, errors, or the safety timeout elapses.
   */
  _startChooseTransition() {
    if (!this._choosingActive || this._chooseTransitionStarted) return;
    this._chooseTransitionStarted = true;
    this._performSceneTransition(this._chosenDef);
  }

  /**
   * Drive the intro each frame: advance the elapsed timer and trigger the scene
   * cross-fade once the video is within CHOOSE_VIDEO_CROSSFADE_LEAD of its end
   * (or the safety timeout elapses).
   * @param {number} dt
   */
  _updateChooseIntro(dt) {
    this._chooseElapsed += dt;
    // Fade the UI out quickly so only the video remains.
    this._uiFadeAlpha = Math.max(0, this._uiFadeAlpha - dt / UI_FADE_OUT_DURATION);
    // Advance the video's fade-in over the splash, but only once its first
    // frame is actually paintable — so the fade always starts from the frame
    // the video appears, never mid-ramp after a buffering stall. The video
    // stays paused on that first frame until the fade completes, then plays.
    if (this._video && this._video.readyState >= 2) {
      this._videoFadeMs += dt;
      if (this._videoFadeMs >= CHOOSE_VIDEO_FADE_IN_MS) this._startVideoPlayback();
    } else if (this._chooseElapsed >= CHOOSE_VIDEO_PLAY_FALLBACK_MS) {
      // Never became paintable — play anyway so the ended/error fallbacks
      // (and the duration-based near-end check below) still drive the exit.
      this._startVideoPlayback();
    }

    if (this._chooseTransitionStarted) return;

    const v = this._video;
    let nearEnd = false;
    if (v && isFinite(v.duration) && v.duration > 0) {
      const remainingMs = (v.duration - v.currentTime) * 1000;
      nearEnd = remainingMs <= CHOOSE_VIDEO_CROSSFADE_LEAD;
    }

    if (nearEnd || this._chooseElapsed >= CHOOSE_VIDEO_MAX_DURATION) {
      this._startChooseTransition();
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

    // Advance tooltip hold-timer / state
    if (this._tooltipManager) this._tooltipManager.update(dt);

    // Advance the choose-hero video intro (UI fade-out + deferred transition)
    if (this._choosingActive) this._updateChooseIntro(dt);

    super.update(dt);
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  /**
   * Paint the character splash cross-fade across the entire physical canvas.
   * Called by SceneManager before the design-space viewport clip, so the
   * splash fills the letterbox/pillarbox bars. UI (info panel, heroes row,
   * button) is still drawn inside the design viewport via render().
   */
  renderBackground(_ctx) {
    const am = this._assetManager;
    const app = this._sceneManager && this._sceneManager._app;
    if (!am || !app) return;

    // Previous splash (cross-fade out)
    if (this._prevSplashKey && this._crossFadeAlpha < 1.0) {
      const prevImg = am.get(this._prevSplashKey);
      if (prevImg) app.drawFullCanvasImage(prevImg, 1.0 - this._crossFadeAlpha);
    }

    // Current splash (cross-fade in)
    if (this._currSplashKey) {
      const currImg = am.get(this._currSplashKey);
      if (currImg) app.drawFullCanvasImage(currImg, Math.min(1.0, this._crossFadeAlpha));
    }

    // Subtle dark scrim fading from the left edge to ~66% across, to lift the
    // floating left-side text off the splash. Drawn over the splash but under
    // the UI; fades out alongside the UI during the choose-hero intro.
    if (LEFT_OVERLAY_ALPHA > 0 && this._uiFadeAlpha > 0.001) {
      const a = LEFT_OVERLAY_ALPHA * this._uiFadeAlpha;
      app.fillFullCanvasHGradient([
        { at: 0, color: `rgba(0,0,0,${a})` },
        { at: LEFT_OVERLAY_HOLD_FRAC, color: `rgba(0,0,0,${a})` },
        { at: LEFT_OVERLAY_FADE_END_FRAC, color: 'rgba(0,0,0,0)' },
      ]);
    }

    // Choose-hero intro video, drawn full-canvas on top of the splash with the
    // same cover-fit framing (the video matches the splash resolution). The
    // splash underneath covers any gap until the first frame is decodable,
    // then the video fades in over CHOOSE_VIDEO_FADE_IN_MS (reading as the
    // splash fading out into the video) to mask small art inconsistencies.
    if (this._choosingActive && this._video && this._video.readyState >= 2) {
      const alpha = CHOOSE_VIDEO_FADE_IN_MS > 0
        ? Math.min(1.0, this._videoFadeMs / CHOOSE_VIDEO_FADE_IN_MS)
        : 1.0;
      app.drawFullCanvasImage(this._video, alpha);
    }
  }

  /** No in-viewport background — splashes are drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}

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
          // Factor in the choose-hero UI fade (this method sets its own
          // globalAlpha, overwriting the outer fade applied in render()).
          ctx.globalAlpha = 0.92 * this._uiFadeAlpha;
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

    // During the choose-hero intro the UI fades out, leaving only the
    // full-canvas video (drawn in renderBackground). Once fully faded, skip the
    // UI entirely. The fade is applied as an outer globalAlpha that multiplies
    // through every UI element (none of them overwrite globalAlpha except the
    // info-panel background, which factors _uiFadeAlpha in explicitly).
    const uiAlpha = this._uiFadeAlpha;
    if (uiAlpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = uiAlpha;

    // 2. Draw animated aura strands (over splash, under all UI)
    this._auraEffect.render(ctx, this.rect);

    // 3. Info panel contents now float directly on the splash (no containing
    //    panel background) — _drawInfoPanelBackground is intentionally not called.

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

    // ── Tooltips (drawn last so they sit above all UI) ──
    if (this._tooltipManager) {
      this._tooltipManager.render(ctx);
    }

    ctx.restore(); // end the choose-hero UI fade

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }
}
