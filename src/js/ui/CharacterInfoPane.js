import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import VideoPortrait from './VideoPortrait.js';
import UIText from './UIText.js';
import UIProgressBar from './UIProgressBar.js';
import UIOrb from './UIOrb.js';
import { getStatusDef, STATUS_KIND } from '../data/statusEffects.js';

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
// with a decorative flourish (`character_pane_flair`, sliced from the
// ui_spritesheet_character_pane sheet — a horizontally-symmetric flourish, so
// the same sprite is used for both the player and enemy panes). When the name
// wraps to two lines there's no room, so the flair is suppressed. The flair is
// drawn manually in render() (not a layout child) so it occupies the freed band
// without affecting layout. Tune freely.
const FLAIR_HEIGHT = 26;            // drawn height of the flourish
const FLAIR_TOP_OFFSET = NAME_LINE_HEIGHT + 4; // band start, below the 1st name line
const FLAIR_SIDE_INSET = 2;         // horizontal inset from the name block edge

// ── Status-effect overlays ──────────────────────────────
// Active buffs/debuffs (from state.statuses) are drawn OVER the portrait in
// render(). Buffs and debuffs use DIFFERENT art shapes — buffs are tall ornate
// crests, debuffs are wide crossed-blade "X" overlays — so each gets its own
// position/scale so they sit correctly. Display model = "one big + count":
// the most-recent buff and most-recent debuff render as large overlays at their
// anchor; any additional statuses render as a small row of mini-badges. Every
// value here is a free knob — tweak to taste.
//
// Anchors are expressed relative to the portrait rect: SCALE multiplies the
// portrait WIDTH to get each big overlay's drawn width (height follows the
// sprite's own aspect, so the wide debuff X stays wide); OFFSET nudges the
// overlay center from the portrait center (px, design space; +y = down).
const STATUS_BUFF_SCALE   = 0.98;
const STATUS_BUFF_OFFSET  = { x: 0, y: 5 };
const STATUS_DEBUFF_SCALE = 0.96;
const STATUS_DEBUFF_OFFSET = { x: 0, y: 0 };

// Mini-badges for the "+N more" statuses, laid out in a centered row anchored
// to the portrait's bottom edge.
const STATUS_MINI_SIZE   = 38;     // square size of each mini badge
const STATUS_MINI_GAP    = 4;      // horizontal gap between badges
const STATUS_MINI_OFFSET = { x: 0, y: -6 }; // row center offset from portrait bottom

// Remaining-turn count, drawn CENTERED on each overlay's emblem (the buff
// crest's lower shield/gem; the debuff X's central badge). The emblem offsets
// are FRACTIONS of the overlay's own width/height measured from its center
// (+y = down), so the number tracks the emblem at any scale.
const STATUS_COUNT_SHOW  = true;
const STATUS_COUNT_FONT  = 18;
const STATUS_COUNT_COLOR = '#ffffff';
const STATUS_COUNT_STROKE = '#000000';
const STATUS_BUFF_COUNT_OFFSET   = { x: 0, y: 0.3 }; // on the buff crest's emblem (lower-center)
const STATUS_DEBUFF_COUNT_OFFSET = { x: 0, y: 0.24 }; // on the debuff X's central badge (center)

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
 *     [portrait] [name / class / hp bar / attack-magic-armor stats]
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

    /** 'player' | 'enemy' — retained for API compatibility / future use. */
    this._side = side;
    // Decorative flourish shown in the freed band under a single-line name.
    // Symmetric sprite from the character-pane sheet (same for both sides).
    // Drawn manually in render(), not added as a layout child.
    this._flair = new UIImage('character_pane_flair', assetManager);
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
    this._magicValue = null;
    this._armorValue = null;
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    // Active status effects (buffs/debuffs), refreshed from updateFromState().
    // Each entry is the live status object { id, kind, turns, ... }.
    this._statuses = [];

    if (characterData) {
      this.buildHierarchy();
    }
  }

  setCharacterData(data) {
    this._characterData = data;
    this._destroyPortraitVideo();
    this.clearChildren();
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    this.buildHierarchy();
  }

  /** Release a live video portrait (if any) so the <video> doesn't leak. */
  _destroyPortraitVideo() {
    if (this._portrait && typeof this._portrait.destroy === 'function') {
      this._portrait.destroy();
    }
  }

  /** Call when the owning scene exits, to stop/release any video portrait. */
  destroy() {
    this._destroyPortraitVideo();
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

    // Portrait — a live, white-keyed video when the data carries `portraitVideo`
    // (data-driven, mirrors enemy `introVideo`), otherwise the static sprite.
    // The video's near-white pixels are made transparent so the panel shows
    // through. Falls back to the static portrait sprite until frames decode.
    const portraitKey = cd.portrait ? `portrait_${cd.portrait}` : 'placeholder';
    if (cd.portraitVideo) {
      this._portrait = new VideoPortrait(cd.portraitVideo, portraitKey, this._assetManager);
    } else {
      this._portrait = new UIImage(portraitKey, this._assetManager);
    }
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

    // Stats row (attack | magic | armor)
    const statsRow = new UIContainer();
    statsRow.direction = 'row';
    statsRow.alignItems = 'center';
    statsRow.gap = 10;
    statsRow.padding = { right: 10 };
    statsRow.height = STATS_HEIGHT;

    statsRow.addChild(this._buildStatGroup('icon_attack', () => this._attackValue, (el) => { this._attackValue = el; }, cd.attack ?? 0));
    statsRow.addChild(this._buildStatGroup('icon_magic',  () => this._magicValue,  (el) => { this._magicValue = el;  }, cd.magic  ?? 0));
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
    if (!this.visible) return;

    // Status overlays sit ON TOP of the portrait — draw before the flair's
    // early-returns so they show regardless of name/flair state.
    this._renderStatusOverlays(ctx);

    if (!this._nameText || !this._flair) return;
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
    if (this._magicValue)  this._magicValue.text  = String(state.magic ?? 0);
    if (this._armorValue)  this._armorValue.text  = String(state.armor ?? 0);

    const manaData = state.mana || {};
    for (const color of Object.keys(this._manaOrbs)) {
      const orb = this._manaOrbs[color];
      if (orb) orb.count = manaData[color] ?? 0;
    }

    // Active status effects — drawn over the portrait in render().
    this._statuses = Array.isArray(state.statuses) ? state.statuses : [];
  }

  updateFromData() {
    if (this._characterData) this.updateFromState(this._characterData);
  }

  /**
   * Center of the portrait in design-space screen coordinates (the same space
   * BattleScene's floating effects render in). Returns null until the pane has
   * been laid out at least once. Used to anchor floating combat-stat text.
   * @returns {{x:number, y:number}|null}
   */
  getPortraitCenter() {
    const r = this._portrait && this._portrait.rect;
    if (!r || r.w <= 0) return null;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /**
   * Draw the active status-effect overlays over the portrait. Display model is
   * "one big + count": the most-recent buff and most-recent debuff render as
   * large overlays at their (separately tunable) anchors; any remaining
   * statuses render as a centered row of mini-badges below the portrait. See
   * the STATUS_* tunables at the top of this file.
   */
  _renderStatusOverlays(ctx) {
    const statuses = this._statuses;
    if (!statuses || statuses.length === 0) return;
    const p = this._portrait && this._portrait.rect;
    if (!p || p.w <= 0) return;
    const am = this._assetManager;
    if (!am) return;

    const buffs = [];
    const debuffs = [];
    for (const st of statuses) {
      const def = getStatusDef(st.id);
      if (!def) continue;
      (def.kind === STATUS_KIND.BUFF ? buffs : debuffs).push(st);
    }

    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;

    // Big overlays — most-recent (last applied) of each category.
    const bigBuff   = buffs.length   ? buffs[buffs.length - 1]     : null;
    const bigDebuff = debuffs.length ? debuffs[debuffs.length - 1] : null;
    if (bigBuff) {
      this._drawBigStatus(ctx, am, bigBuff,
        cx + STATUS_BUFF_OFFSET.x, cy + STATUS_BUFF_OFFSET.y, p.w * STATUS_BUFF_SCALE);
    }
    if (bigDebuff) {
      this._drawBigStatus(ctx, am, bigDebuff,
        cx + STATUS_DEBUFF_OFFSET.x, cy + STATUS_DEBUFF_OFFSET.y, p.w * STATUS_DEBUFF_SCALE);
    }

    // Mini-badges for everything else (additional buffs + debuffs), centered.
    const extras = statuses.filter(s => s !== bigBuff && s !== bigDebuff);
    if (extras.length > 0) {
      const totalW = extras.length * STATUS_MINI_SIZE + (extras.length - 1) * STATUS_MINI_GAP;
      let x = cx + STATUS_MINI_OFFSET.x - totalW / 2;
      const y = p.y + p.h + STATUS_MINI_OFFSET.y - STATUS_MINI_SIZE / 2;
      for (const st of extras) {
        this._drawStatusSprite(ctx, am, st.id, x, y, STATUS_MINI_SIZE, STATUS_MINI_SIZE);
        if (STATUS_COUNT_SHOW && st.turns > 0) {
          this._drawStatusCount(ctx, st.turns,
            x + STATUS_MINI_SIZE / 2, y + STATUS_MINI_SIZE / 2,
            Math.round(STATUS_COUNT_FONT * 0.8));
        }
        x += STATUS_MINI_SIZE + STATUS_MINI_GAP;
      }
    }
  }

  /** Draw one big overlay centered at (cx,cy); width=targetW, height by aspect. */
  _drawBigStatus(ctx, am, st, cx, cy, targetW) {
    const def = getStatusDef(st.id);
    if (!def) return;
    const img = am.get(def.icon);
    // Sliced sheet sprites are canvases (img.complete === undefined); only a
    // real, still-loading Image reports complete === false.
    if (!img || img.complete === false) return;
    const aspect = (img.width || 1) / (img.height || 1);
    const w = targetW;
    const h = w / aspect;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, x, y, w, h);
    ctx.imageSmoothingEnabled = prev;
    if (STATUS_COUNT_SHOW && st.turns > 0) {
      // Center the count on the overlay's emblem (per-kind fractional offset).
      const emblem = def.kind === STATUS_KIND.BUFF
        ? STATUS_BUFF_COUNT_OFFSET : STATUS_DEBUFF_COUNT_OFFSET;
      this._drawStatusCount(ctx, st.turns,
        cx + emblem.x * w, cy + emblem.y * h, STATUS_COUNT_FONT);
    }
  }

  /** Draw a status sprite contain-fit inside the box at (x,y,boxW,boxH). */
  _drawStatusSprite(ctx, am, id, x, y, boxW, boxH) {
    const def = getStatusDef(id);
    if (!def) return;
    const img = am.get(def.icon);
    if (!img || img.complete === false) return;
    const aspect = (img.width || 1) / (img.height || 1);
    let w = boxW, h = boxW / aspect;
    if (h > boxH) { h = boxH; w = boxH * aspect; }
    const dx = x + (boxW - w) / 2;
    const dy = y + (boxH - h) / 2;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, dx, dy, w, h);
    ctx.imageSmoothingEnabled = prev;
  }

  /** Draw a remaining-turn count number with an outline, centered at (x,y). */
  _drawStatusCount(ctx, n, x, y, fontSize) {
    ctx.save();
    ctx.font = `bold ${fontSize}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fontSize * 0.2);
    ctx.strokeStyle = STATUS_COUNT_STROKE;
    ctx.fillStyle = STATUS_COUNT_COLOR;
    const text = String(n);
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
