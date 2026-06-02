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
// Name wraps onto a second line when it's too wide (the class/level line was
// removed to free this vertical space). NAME_MAX_WIDTH ≈ the info column's
// inner width (side col 390 − pane padding − portrait − gaps). NAME_BLOCK_HEIGHT
// reserves room for up to two lines and roughly matches the old name+class
// block height, so the HP bar / stats below don't shift. Tune freely.
const NAME_MAX_WIDTH = 190;
const NAME_LINE_HEIGHT = 36;
const NAME_BLOCK_HEIGHT = 72;

// ── Name flair ──────────────────────────────────────────
// When the name fits on ONE line, the second-line space below it is filled
// with a decorative flourish (player pane → skill_flair_right, enemy →
// skill_flair_left). When the name wraps to two lines there's no room, so the
// flair is suppressed. The flair is drawn manually in render() (not a layout
// child) so it occupies the freed band without affecting layout. Tune freely.
const FLAIR_HEIGHT = 26;            // drawn height of the flourish
const FLAIR_TOP_OFFSET = NAME_LINE_HEIGHT + 4; // band start, below the 1st name line
const FLAIR_SIDE_INSET = 2;         // horizontal inset from the name block edge

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
  constructor(characterData = null, assetManager = null, side = 'player') {
    super();

    this._characterData = characterData;
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    /** 'player' | 'enemy' — selects the flair side. */
    this._side = side;
    // Decorative flourish shown in the freed band under a single-line name.
    // Player pane flares right; enemy pane flares left (mirror). Drawn
    // manually in render(), not added as a layout child.
    this._flair = new UIImage(
      side === 'enemy' ? 'skill_flair_left' : 'skill_flair_right',
      assetManager
    );
    // Stretch to fill the full band width (FLAIR_HEIGHT tall) rather than
    // scaling to native aspect and parking against one edge.
    this._flair.setStyle({
      fitMode: 'stretch',
      imageAlignV: 'center',
    });
    this._flair.smoothing = true;

    this.direction = 'column';
    this.gap = 6;
    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'character_pane_panel';
    // Lock height so the pane sizes to content instead of stretching.
    this.height = NATURAL_HEIGHT;

    // Refs for fast update
    this._portrait = null;
    this._nameText = null;
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
    if (this._flair) this._flair.assetManager = am;
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

    // Name — wraps onto a second line when too wide (class/level line removed).
    this._nameText = new UIText(cd.name || '');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      color: '#d0d0c4',
      bold: true,
      alignH: 'left',
      alignV: 'top',
      maxWidth: NAME_MAX_WIDTH,
      lineHeight: NAME_LINE_HEIGHT,
      height: NAME_BLOCK_HEIGHT,
    });
    info.addChild(this._nameText);

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

  /**
   * Draw the name flair after the normal children. The flourish fills the
   * freed second-line band ONLY when the name fits on a single line; when the
   * name wraps to two lines the band is occupied, so the flair is suppressed.
   * Drawn manually (not a layout child) so it never affects layout, and the
   * line-count check uses the render-time ctx (correct loaded-font metrics).
   */
  render(ctx) {
    super.render(ctx);
    if (!this.visible || !this._nameText || !this._flair) return;
    if (!this._nameText.text) return;

    // super.render already measured + cached the name's wrap this frame.
    const lines = this._nameText._getWrappedLines(ctx);
    if (lines.length !== 1) return; // two-line name → no flair

    const r = this._nameText.rect;
    if (!r || r.w <= 0) return;

    this._flair.rect.x = r.x + FLAIR_SIDE_INSET;
    this._flair.rect.y = r.y + FLAIR_TOP_OFFSET;
    this._flair.rect.w = Math.max(0, r.w - FLAIR_SIDE_INSET * 2);
    this._flair.rect.h = FLAIR_HEIGHT;
    this._flair.renderSelf(ctx);
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
