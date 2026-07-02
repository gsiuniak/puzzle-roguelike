import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import VideoPortrait from './VideoPortrait.js';
import UIText from './UIText.js';
import UIProgressBar from './UIProgressBar.js';
import UIOrb from './UIOrb.js';
import { getStatusDef, STATUS_KIND } from '../data/statusEffects.js';

// ── Tunable layout constants ─────────────────────────────
// Tuned for the wide-viewport battle side column (~465px pane width) and the
// 2026-07 `character_pane_panel` art (852×623, aspect ≈1.37 — taller than the
// old frame; NATURAL_HEIGHT ≈ column width / 1.37 keeps the frame art
// unstretched at the current column width).
const PANE_PADDING = { top: 24, right: 16, bottom: 16, left: 16 };
// THREE major rows (mock layout):
//   Row 1 (header) = [floating portrait | info column (name / tag / flair / stats)]
//   Row 2          = full-width centered mana-orb row (bigger orbs)
//   Row 3          = full-width HP bar framed by the authored overlay art
// The portrait occupies a fixed-width SLOT in the header but is DRAWN manually
// (in render()), oversized by PORTRAIT_OVERHANG, so it "floats" past the
// pane's TOP edge and bleeds DOWN into the mana row.
const PORTRAIT_SLOT_WIDTH = 160;  // layout width reserved for the portrait
// top: how far the portrait rect extends above the slot (max top poke past the
// pane's outer edge = top − PANE_PADDING.top). bottom: how far it extends
// BELOW the header row — i.e. how deep the art bleeds into the mana row
// (portraits are authored with fading lower edges so the bleed dissipates into
// the panel instead of hard-clipping). bleedIn: widening toward the INFO
// COLUMN only — the art is anchored flush to the panel-side edge of the slot
// (left on player, right on enemy; via imageAlignH), so it can NEVER hang out
// the pane's side; any extra width bleeds inward over the slot gap.
// Behavior vs art aspect (w:h), with rect = (slot.w+bleedIn) × (slot.h+top+bottom):
//   narrower than the rect → full height, maximum top poke;
//   slightly wider → width-limited, progressively smaller poke;
//   much wider (square-ish) → fits inside the header, no poke.
// Keep `bottom` SMALL — the portrait draws ON TOP of the pane's children, so a
// deep bottom bleed covers the mana orbs beneath it (the left orbs vanish).
// ~20px reaches just past the header edge so the art's faded hem dissolves
// into the mana row without hiding the orbs.
const PORTRAIT_OVERHANG = { top: 56, bleedIn: 30, bottom: 20 };
const HEADER_HEIGHT = 158;        // top-row height (sized to fit the info column)
const HEADER_GAP = 4;
const OUTER_GAP = 6; // column gap between the three major rows

// Info-column padding: generous on the side FACING the portrait (player left,
// enemy right — mirrored in buildHierarchy), small on the outer side. TOP
// padding pushes the whole name/tag/flair/stats stack down into the header
// band (mock rhythm).
const INFO_PAD_TOP = 26;
const INFO_PAD_PORTRAIT_SIDE = 24;
const INFO_PAD_OUTER = 10;
const INFO_ROW_GAP = 2;

const NAME_FONT_SIZE = 34;
// The name is CENTERED in the info column (both panes — this also keeps the
// mirrored enemy name off the panel border). A long name AUTO-SHRINKS its font
// (down to NAME_MIN_FONT_SIZE) to stay on ONE line (_fitNameFont), so every
// pane keeps the same name → tag → flair → stats rhythm. lineHeight stays
// NAME_LINE_HEIGHT regardless of the fitted size, so the rows below never
// shift. Wrapping remains only as a last resort (a name still too wide at the
// minimum size — it will overlap the tag line, so keep NAME_MIN_FONT_SIZE low).
// NOTE: UIText.maxWidth doubles as the flex MAX-WIDTH clamp in UIContainer's
// layout (UIText defaults it to 0 = "no wrap", which the container reads as
// "max width 0" → a ZERO-WIDTH rect, so centered text draws piled on the
// column's left edge). EVERY centered UIText in this pane must set maxWidth.
const NAME_MAX_WIDTH = 205;
const NAME_MIN_FONT_SIZE = 20;
const NAME_LINE_HEIGHT = 36;
const NAME_BLOCK_HEIGHT = 38;     // ONE line — tag/flair/stats rows follow

// ── Class tag line (e.g. "Arcane Mage" / "Minion") ──────
// Centered directly under the name. Data-driven from `className` (present on
// both player battle state and enemy defs); an optional `classColor` on the
// data overrides TAG_COLOR.
const TAG_FONT_SIZE = 19;
const TAG_HEIGHT = 24;
const TAG_COLOR = '#a678d8';

// ── Name flair ──────────────────────────────────────────
// The decorative flourish (`character_pane_flair`, a horizontally-symmetric
// divider from the character-pane sheet — same sprite both panes) is a REAL
// layout child of the info column, sitting between the tag line and the stats
// row (the old "fill the freed second name line" manual-draw hack is gone —
// the new layout gives the flair its own band, always shown).
const FLAIR_HEIGHT = 20;            // drawn height of the flourish
const FLAIR_MARGIN = { top: 2, bottom: 4 };
const FLAIR_SIDE_INSET = 6;         // horizontal inset from the info column edges

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

// Poison stack count — PLACEHOLDER: a small green number near the portrait's
// top edge while the combatant has poison stacks. See decision #39.
const POISON_BADGE_FONT   = 28;
const POISON_BADGE_COLOR  = '#7cc63f';
const POISON_BADGE_STROKE = '#0a2208';
const POISON_BADGE_OFFSET = { x: 0, y: 20 }; // from portrait top-center, downward

const HEALTH_BAR_HEIGHT = 40;
const HEALTH_LABEL_FONT_SIZE = 20;
// The HP bar is the pane's BOTTOM row, spanning the panel width. The authored
// ornate frame (`character_pane_health_bar_overlay`, transparent center) is
// drawn OVER the bar in render(): overlay width = bar width / (1 − 2·INSET_X)
// so the fill sits inset within the frame's opening, height follows the art's
// own aspect. The margins/side inset leave room for the frame's overhang.
const HEALTH_ROW_MARGIN_TOP = 10;
const HEALTH_ROW_MARGIN_BOTTOM = 20;
const HEALTH_BAR_SIDE_INSET = 26;
const HEALTH_OVERLAY_KEY = 'character_pane_health_bar_overlay';
const HEALTH_OVERLAY_INSET_X = 0.03; // bar inset within the overlay (fraction of overlay width)
// Authored fill art for the bar (UIProgressBar.fillAssetKey — stretched to the
// full bar, revealed to the filled fraction; solid fillColor is the fallback).
const HEALTH_FILL_KEY = 'character_pane_health_bar_fill';

// ── Armor badge (shield + "+N" beside the centered HP label) ──
// The armor VALUE shows here (always exact, even when the blue bar overlay is
// capped at the full bar width); the overlay itself lives on UIProgressBar.
const ARMOR_BADGE_GAP = 8;          // gap from the HP label to the badge
const ARMOR_BADGE_ICON_FRAC = 0.66; // shield icon height as a fraction of bar height
const ARMOR_BADGE_ICON_GAP = 3;     // gap between shield and "+N"
const ARMOR_BADGE_FONT = 18;
const ARMOR_BADGE_COLOR = '#bcdcff'; // light blue, matches the bar's armor overlay
const BARRIER_BADGE_COLOR = '#d6b8ff'; // light purple, matches the bar's barrier overlay
const BARRIER_BADGE_ICON = 'icon_barrier'; // sprite in ui_spritesheet_character_pane
const STATS_HEIGHT = 22;
const STAT_ICON_SIZE = 28;
const STAT_VALUE_FONT_SIZE = 22;
// Each stat group (icon + value) gets a FIXED width — without it the groups
// flex-fill the whole row and drift far apart (the old "attack way left,
// magic way right" look). Width fits a 3-digit value.
const STAT_VALUE_WIDTH = 44;
const STAT_GROUP_GAP = 4;   // icon ↔ value, inside a group
const STAT_GROUP_WIDTH = STAT_ICON_SIZE + STAT_GROUP_GAP + STAT_VALUE_WIDTH;
const STATS_ROW_GAP = 16;   // between the attack and magic groups

// Mana bar — its OWN full-width padded row between the header and the HP bar
// (row 2 of the mock, moved OUT of the info column). UIOrb scales its orb +
// amount plate to the rect, so sizing is purely these constants. The orb
// CIRCLE diameter = min(width, height·0.65). The orbs cluster CENTERED
// (justifyContent 'center' + MANA_ROW_GAP) instead of spreading edge-to-edge;
// MANA_PLATE_SCALE keeps the count plate NARROWER than the circle (at UIOrb's
// default 1.1 adjacent plates touch and read as clutter).
const MANA_ROW_HEIGHT = 92;
const MANA_ROW_PADDING = { top: 8, bottom: 4 };
const MANA_ROW_GAP = 14;
const MANA_ORB_WIDTH = 58;
const MANA_ORB_HEIGHT = 80;
const MANA_PLATE_SCALE = 0.95;
const MANA_FONT_SIZE = 17;

/**
 * Natural height of the pane = paddings + the three major rows (header,
 * mana row, HP-bar row) + the column gaps between them. Locks the pane height
 * so it doesn't stretch inside its column. ≈372 at the current constants —
 * deliberately TALLER than the panel art's native aspect at the ~440px
 * wide-viewport column (≈322), so the content breathes; the frame art
 * stretches ~15% vertically, which the mostly-dark texture tolerates.
 */
const NATURAL_HEIGHT =
  PANE_PADDING.top + PANE_PADDING.bottom +
  HEADER_HEIGHT +
  OUTER_GAP + MANA_ROW_HEIGHT +
  OUTER_GAP + HEALTH_ROW_MARGIN_TOP + HEALTH_BAR_HEIGHT + HEALTH_ROW_MARGIN_BOTTOM;

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};
const MANA_ORDER = ['red', 'blue', 'green', 'yellow', 'purple'];

/**
 * CharacterInfoPane — compact character info panel (three major rows).
 *
 * Structure:
 *   Row 1 (header, two columns):
 *     [floating portrait] [name / class tag / flair / attack-magic stats]
 *   Row 2:
 *     [full-width centered mana orb x5]
 *   Row 3:
 *     [full-width HP bar, framed by the authored overlay art]
 *
 * The portrait is drawn manually (oversized past its layout slot) so it
 * "floats" above the pane frame and bleeds down into the mana row.
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
    // Decorative flourish between the class tag and the stats row — a REAL
    // layout child of the info column (added in buildHierarchy). Symmetric
    // sprite from the character-pane sheet (same for both sides). Stretched to
    // fill the band width rather than scaling to native aspect.
    this._flair = new UIImage('character_pane_flair', assetManager);
    this._flair.setStyle({
      fitMode: 'stretch',
      imageAlignV: 'center',
    });
    this._flair.smoothing = true;

    this.direction = 'column';
    this.gap = OUTER_GAP;
    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'character_pane_panel';
    // Lock height so the pane sizes to content instead of stretching.
    this.height = NATURAL_HEIGHT;

    // Refs for fast update
    this._portrait = null;
    this._portraitSlot = null;
    this._infoCol = null;
    this._nameText = null;
    this._tagText = null;
    // Cache key for the one-line name font fit (see _fitNameFont).
    this._nameFitFor = null;
    this._healthBar = null;
    this._attackValue = null;
    this._magicValue = null;
    this._armorValue = null;
    this._manaOrbs = { red: null, blue: null, green: null, yellow: null, purple: null };
    // Active status effects (buffs/debuffs), refreshed from updateFromState().
    // Each entry is the live status object { id, kind, turns, ... }.
    this._statuses = [];
    // Poison stack count (placeholder display), refreshed from updateFromState().
    this._poison = 0;

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
    if (this._healthBar) this._healthBar.assetManager = am;
    if (this._flair) this._flair.assetManager = am;
    for (const orb of Object.values(this._manaOrbs)) {
      if (orb) orb.assetManager = am;
    }
  }

  buildHierarchy() {
    const cd = this._characterData;
    if (!cd) return;

    // The enemy pane is MIRRORED: portrait on the RIGHT (overhanging right),
    // info column on the LEFT (the player pane keeps portrait-left). Only the
    // top row is mirrored — the full-width HP bar reads the same on both sides.
    const isEnemy = this._side === 'enemy';

    // ── Header row: portrait slot + info ──
    const header = new UIContainer();
    header.direction = 'row';
    header.gap = HEADER_GAP;
    header.alignItems = 'stretch';
    header.height = HEADER_HEIGHT;

    // Portrait SLOT — reserves layout space only. The portrait itself is drawn
    // manually in render() (_renderPortrait), oversized by PORTRAIT_OVERHANG,
    // so the art floats past the pane's top edge and outer side.
    const portraitSlot = new UIContainer();
    portraitSlot.width = PORTRAIT_SLOT_WIDTH;
    this._portraitSlot = portraitSlot;

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
    // Bottom-anchored contain fit, hugging the PANEL-SIDE edge of the slot
    // (left on player, right on the mirrored enemy) so the art never pokes out
    // the pane's side — extra width bleeds inward instead (see
    // PORTRAIT_OVERHANG). The rect is assigned each render from the slot.
    this._portrait.setStyle({
      fitMode: 'contain',
      imageAlignH: isEnemy ? 'right' : 'left',
      imageAlignV: 'bottom',
    });
    this._portrait.smoothing = true;

    // Info column — stacks name / class tag / flair / stats (mock row 1 col 2).
    const info = new UIContainer();
    info.direction = 'column';
    info.gap = INFO_ROW_GAP;
    info.flexGrow = 1;
    // Generous padding on the PORTRAIT side (breathing room off the floating
    // art), small padding on the outer side — mirrored on the enemy pane,
    // whose portrait sits on the right.
    info.padding = isEnemy
      ? { top: INFO_PAD_TOP, left: INFO_PAD_OUTER, right: INFO_PAD_PORTRAIT_SIDE }
      : { top: INFO_PAD_TOP, left: INFO_PAD_PORTRAIT_SIDE, right: INFO_PAD_OUTER };
    this._infoCol = info;

    // Name — CENTERED in the info column on both panes; a long name shrinks
    // its font to stay on one line (_fitNameFont, run at render time).
    this._nameFitFor = null; // fresh element starts at base size → refit
    this._nameText = new UIText(cd.name || '');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      color: '#d0d0c4',
      bold: true,
      alignH: 'center',
      alignSelfH: 'center',
      alignV: 'top',
      maxWidth: NAME_MAX_WIDTH,
      lineHeight: NAME_LINE_HEIGHT,
      height: NAME_BLOCK_HEIGHT,
    });
    info.addChild(this._nameText);

    // Class tag — centered under the name ("Arcane Mage", "Minion", …).
    // Data-driven; renders empty when the data carries no className.
    // maxWidth is REQUIRED: UIText defaults it to 0, which the container's
    // flex clamp reads as "max width 0" → a zero-width rect that piles the
    // centered text on the column's left edge (see the NAME_MAX_WIDTH note).
    this._tagText = new UIText(cd.className || '');
    this._tagText.setStyle({
      fontSize: TAG_FONT_SIZE,
      color: cd.classColor || TAG_COLOR,
      alignH: 'center',
      alignSelfH: 'center',
      alignV: 'top',
      maxWidth: NAME_MAX_WIDTH,
      height: TAG_HEIGHT,
    });
    info.addChild(this._tagText);

    // Flair — the ornate divider between the tag line and the stats row.
    this._flair.setStyle({
      height: FLAIR_HEIGHT,
      margin: {
        top: FLAIR_MARGIN.top,
        bottom: FLAIR_MARGIN.bottom,
        left: FLAIR_SIDE_INSET,
        right: FLAIR_SIDE_INSET,
      },
    });
    info.addChild(this._flair);

    // Stats row (attack | magic) — CENTERED under the flair, the two groups
    // sitting close together (fixed group widths — see STAT_GROUP_*).
    const statsRow = new UIContainer();
    statsRow.direction = 'row';
    statsRow.alignItems = 'center';
    statsRow.justifyContent = 'center';
    statsRow.gap = STATS_ROW_GAP;
    statsRow.height = STATS_HEIGHT;

    statsRow.addChild(this._buildStatGroup('icon_attack', () => this._attackValue, (el) => { this._attackValue = el; }, cd.attack ?? 0));
    statsRow.addChild(this._buildStatGroup('icon_magic',  () => this._magicValue,  (el) => { this._magicValue = el;  }, cd.magic  ?? 0));
    // Armor moved to the HP bar (blue overlay + shield "+N" badge), so it's no
    // longer shown in this row. (updateFromState guards on `this._armorValue`,
    // so leaving it unbuilt is safe.) Uncomment to restore the inline armor stat.
    // statsRow.addChild(this._buildStatGroup('icon_block',  () => this._armorValue,  (el) => { this._armorValue = el;  }, cd.armor  ?? 0));

    info.addChild(statsRow);

    // Portrait-left (player) vs portrait-right (enemy).
    if (isEnemy) {
      header.addChild(info);
      header.addChild(portraitSlot);
    } else {
      header.addChild(portraitSlot);
      header.addChild(info);
    }

    this.addChild(header);

    // ── Mana row (middle) — full-width, the 5 orbs clustered centered ──
    // Its own major row (mock row 2), so the orbs can be bigger than the old
    // info-column bar. The portrait's bottom overhang bleeds over its
    // portrait-side end (the art fades out, so the orbs stay readable).
    const manaRow = new UIContainer();
    manaRow.direction = 'row';
    manaRow.justifyContent = 'center';
    manaRow.alignItems = 'center';
    manaRow.gap = MANA_ROW_GAP;
    manaRow.height = MANA_ROW_HEIGHT;
    manaRow.padding = MANA_ROW_PADDING;

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
        plateScale: MANA_PLATE_SCALE,
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

    // ── HP bar row (bottom) ──
    // Spans the panel width, inset so the ornate overlay frame (drawn on top
    // in render() — _renderHealthOverlay) stays inside the pane. The frame art
    // provides the border, so the bar's own border is off.
    this._healthBar = new UIProgressBar();
    this._healthBar.setStyle({
      value: cd.hp ?? 0,
      maxValue: cd.maxHp ?? 100,
      fillColor: '#cc3333',
      backgroundColor: '#1a0e0e',
      label: `${cd.hp ?? 0} / ${cd.maxHp ?? 0}`,
      labelColor: '#ffffff',
      labelFontSize: HEALTH_LABEL_FONT_SIZE,
      fillAssetKey: HEALTH_FILL_KEY,
      assetManager: this._assetManager,
      borderWidth: 0,
      cornerRadius: 2,
      height: HEALTH_BAR_HEIGHT,
      margin: {
        top: HEALTH_ROW_MARGIN_TOP,
        bottom: HEALTH_ROW_MARGIN_BOTTOM,
        left: HEALTH_BAR_SIDE_INSET,
        right: HEALTH_BAR_SIDE_INSET,
      },
    });
    this.addChild(this._healthBar);
  }

  /**
   * Render the pane, then the manually-drawn layers: the floating portrait,
   * status overlays, the HP-bar frame art + shield badges, and the poison
   * badge. (The flair is a normal layout child now — no manual draw.)
   */
  render(ctx) {
    // Fit the name onto one line BEFORE the children draw this frame.
    this._fitNameFont(ctx);

    super.render(ctx);
    if (!this.visible) return;

    // Floating portrait — drawn manually (oversized past its layout slot) so
    // it can overhang the pane frame. Must come first: everything below
    // anchors to (or draws over) its rect.
    this._renderPortrait(ctx);

    // Status overlays sit ON TOP of the portrait.
    this._renderStatusOverlays(ctx);

    // Ornate frame art over the HP bar, then the shield badges on top of it
    // so they stay readable.
    this._renderHealthOverlay(ctx);
    this._renderShieldBadges(ctx);

    // Poison stack count near the portrait top (placeholder).
    this._renderPoisonBadge(ctx);
  }

  /**
   * Shrink the name's font size (from NAME_FONT_SIZE down to
   * NAME_MIN_FONT_SIZE) so the name fits NAME_MAX_WIDTH on a single line —
   * keeping the name → flair → stats rhythm identical for long names like
   * "Sanguine Phoenix" instead of wrapping into the flair band and jamming
   * the stats row. lineHeight is untouched, so nothing below the name moves.
   * Measured with the element's own font string; cached per text + font
   * availability (a re-measure fires once when the custom font finishes
   * loading, since fallback-serif metrics differ).
   */
  _fitNameFont(ctx) {
    const el = this._nameText;
    if (!el || !el.text) return;

    const fontsReady = (typeof document !== 'undefined' && document.fonts)
      ? (document.fonts.check('bold 12px "Marcellus SC"') ? 1 : 0)
      : 1;
    const key = `${el.text}|${fontsReady}`;
    if (this._nameFitFor === key) return;

    const prevSize = el.fontSize;
    el.fontSize = NAME_FONT_SIZE;
    ctx.save();
    ctx.font = el.getFontString();
    const w = ctx.measureText(el.text).width;
    ctx.restore();

    let size = NAME_FONT_SIZE;
    if (w > NAME_MAX_WIDTH) {
      size = Math.max(NAME_MIN_FONT_SIZE, Math.floor((NAME_FONT_SIZE * NAME_MAX_WIDTH) / w));
    }
    if (size !== prevSize) el.setStyle({ fontSize: size });
    else el.fontSize = prevSize;
    this._nameFitFor = key;
  }

  /**
   * Draw the floating portrait. Its rect = the layout slot extended UP by
   * PORTRAIT_OVERHANG.top (past the pane's top edge — the "floating" poke),
   * DOWN by PORTRAIT_OVERHANG.bottom (bleeding into the mana row — portraits
   * are authored with fading lower edges so the bleed dissipates), and
   * widened by bleedIn toward the INFO COLUMN only. The art itself is aligned
   * flush to the panel-side edge of the slot (imageAlignH left/right, set in
   * buildHierarchy), so it can never hang out the pane's side — a portrait
   * wider than the slot bleeds inward over the header gap instead. The rect is
   * written back onto the portrait element so getPortraitRect()/
   * getPortraitCenter() and the status overlays keep working unchanged.
   */
  _renderPortrait(ctx) {
    if (!this._portrait) return;
    const slot = this._portraitSlot && this._portraitSlot.rect;
    if (!slot || slot.w <= 0) return;

    const r = this._portrait.rect;
    r.w = slot.w + PORTRAIT_OVERHANG.bleedIn;
    // Anchor at the panel-side edge: player bleeds right, enemy bleeds left.
    r.x = this._side === 'enemy' ? slot.x + slot.w - r.w : slot.x;
    r.y = slot.y - PORTRAIT_OVERHANG.top;
    r.h = slot.h + PORTRAIT_OVERHANG.top + PORTRAIT_OVERHANG.bottom;

    // External opacity override (attack-animation hand-off: the portrait hides
    // while the flash plays and fades back in with its tail). Rect is still
    // computed above so getPortraitRect()/overlays keep working while hidden.
    const alpha = this._portraitAlpha != null ? this._portraitAlpha : 1;
    if (alpha <= 0) return;
    if (alpha >= 1) {
      this._portrait.renderSelf(ctx);
      return;
    }
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha ?? 1) * alpha;
    this._portrait.renderSelf(ctx);
    ctx.restore();
  }

  /**
   * Set the portrait's opacity multiplier (0..1, default 1). Used by
   * BattleScene to hide the portrait while an attack animation plays over it
   * and fade it back in as the animation's tail cross-fades out.
   */
  setPortraitAlpha(alpha) {
    this._portraitAlpha = Math.max(0, Math.min(1, alpha == null ? 1 : alpha));
  }

  /**
   * Draw the authored ornate frame (`character_pane_health_bar_overlay`,
   * transparent center) OVER the HP bar: width = bar width / (1 − 2·INSET_X)
   * so the fill sits inset within the frame's opening, height follows the
   * art's own aspect, centered on the bar.
   */
  _renderHealthOverlay(ctx) {
    const bar = this._healthBar && this._healthBar.rect;
    if (!bar || bar.w <= 0) return;
    const img = this._assetManager ? this._assetManager.get(HEALTH_OVERLAY_KEY) : null;
    // Sliced sheet sprites are canvases (complete === undefined); only a real,
    // still-loading Image reports complete === false.
    if (!img || img.complete === false || !img.width) return;

    const aspect = img.width / (img.height || 1);
    const w = bar.w / (1 - 2 * HEALTH_OVERLAY_INSET_X);
    const h = w / aspect;
    const x = bar.x + bar.w / 2 - w / 2;
    const y = bar.y + bar.h / 2 - h / 2;

    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, w, h);
    ctx.imageSmoothingEnabled = prev;
  }

  /**
   * PLACEHOLDER: draw the current poison stack count as a small green number
   * near the portrait's top edge. Hidden at 0 stacks. See decision #39.
   */
  _renderPoisonBadge(ctx) {
    if (!this._poison || this._poison <= 0) return;
    const r = this._portrait && this._portrait.rect;
    if (!r || r.w <= 0) return;

    const text = String(this._poison | 0);
    const x = r.x + r.w / 2 + POISON_BADGE_OFFSET.x;
    const y = r.y + POISON_BADGE_OFFSET.y;

    ctx.save();
    ctx.font = `bold ${POISON_BADGE_FONT}px "Marcellus SC", Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = POISON_BADGE_STROKE;
    ctx.fillStyle = POISON_BADGE_COLOR;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  _buildStatGroup(iconKey, getValueRef, setValueRef, initialValue) {
    // Fixed group + value widths: without them the value text (no width) goes
    // flex and the group swallows half the row, pushing the two stats apart.
    const group = new UIContainer();
    group.direction = 'row';
    group.gap = STAT_GROUP_GAP;
    group.alignItems = 'center';
    group.width = STAT_GROUP_WIDTH;

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
      width: STAT_VALUE_WIDTH,
      height: STAT_VALUE_FONT_SIZE + 4,
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
      // Armor renders as the blue overlay on the bar (UIProgressBar.armorValue);
      // the exact number shows in the shield badge beside the centered HP label
      // (see _renderArmorBadge), so the label itself is just "hp / maxHp".
      this._healthBar.armorValue = state.armor ?? 0;
      // Barrier renders as the purple overlay stacked beyond armor (its exact
      // value shows in the barrier badge beside the HP label). See decision #38.
      this._healthBar.barrierValue = state.barrier ?? 0;
      this._healthBar.label = `${state.hp ?? 0} / ${state.maxHp ?? 0}`;
    }

    // Class tag tracks the state (e.g. a mid-battle enemy transform rebuilds
    // the pane via setCharacterData, but this keeps it fresh regardless).
    if (this._tagText && state.className != null) this._tagText.text = state.className;

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
    // Poison stacks — drawn near the portrait top in render() (placeholder).
    this._poison = state.poison || 0;
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
   * The portrait's rect in design-space coordinates ({x,y,w,h}), or null until
   * laid out. Used to overlay effects (e.g. the warrior attack animation POC)
   * exactly over the portrait.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  getPortraitRect() {
    const r = this._portrait && this._portrait.rect;
    if (!r || r.w <= 0) return null;
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  /**
   * The health bar's rect in design-space coordinates ({x,y,w,h}), or null
   * until laid out. Used to anchor the accumulating damage counter over the
   * receiving side's health bar.
   * @returns {{x:number,y:number,w:number,h:number}|null}
   */
  getHealthBarRect() {
    const r = this._healthBar && this._healthBar.rect;
    if (!r || r.w <= 0) return null;
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  /**
   * Center of a mana orb (by color) in design-space coordinates — the
   * convergence point for incoming mana streams. Biased slightly upward toward
   * the orb symbol. Returns null until laid out.
   * @param {string} color - 'red'|'blue'|'green'|'yellow'|'purple'
   * @returns {{x:number, y:number}|null}
   */
  getManaOrbCenter(color) {
    const orb = this._manaOrbs[color];
    const r = orb && orb.rect;
    if (!r || r.w <= 0) return null;
    return { x: r.x + r.w / 2, y: r.y + r.h * 0.35 };
  }

  /** Give a mana orb a slight bobble (e.g. when its stream lands). */
  pulseManaOrb(color) {
    const orb = this._manaOrbs[color];
    if (orb && typeof orb.pulse === 'function') orb.pulse();
  }

  /**
   * Draw the shield badges ("🛡 +N") just to the right of the centered HP label:
   * armor (blue, icon_block) first, then barrier (purple, icon_barrier) stacked
   * to its right. Each shows the EXACT value (the bar overlays cap their visible
   * width at the full bar, so the numbers are the source of truth). Hidden at 0.
   * The whole group is clamped to stay inside the bar.
   */
  _renderShieldBadges(ctx) {
    const bar = this._healthBar && this._healthBar.rect;
    if (!bar || bar.w <= 0) return;
    const armor = this._healthBar.armorValue || 0;
    const barrier = this._healthBar.barrierValue || 0;

    const badges = [];
    if (armor > 0)   badges.push({ value: armor,   iconKey: 'icon_block',       color: ARMOR_BADGE_COLOR });
    if (barrier > 0) badges.push({ value: barrier, iconKey: BARRIER_BADGE_ICON, color: BARRIER_BADGE_COLOR });
    if (badges.length === 0) return;

    // Width of the centered "hp / maxHp" label, so the group sits beside it.
    ctx.save();
    ctx.font = `${HEALTH_LABEL_FONT_SIZE}px "Marcellus SC", Georgia, "Times New Roman", serif`;
    const labelW = ctx.measureText(this._healthBar.label || '').width;
    ctx.restore();

    const cy = bar.y + bar.h / 2;
    const iconBox = bar.h * ARMOR_BADGE_ICON_FRAC;

    ctx.save();
    ctx.font = `bold ${ARMOR_BADGE_FONT}px "Marcellus SC", Georgia, "Times New Roman", serif`;

    // Measure each badge (icon + "+N") and the total group width.
    let groupW = 0;
    for (const b of badges) {
      b.text = `+${b.value}`;
      b.textW = ctx.measureText(b.text).width;
      const icon = this._assetManager ? this._assetManager.get(b.iconKey) : null;
      b.icon = icon; b.iconW = 0; b.iconH = 0;
      if (icon && icon.complete !== false && icon.width) {
        const aspect = icon.width / icon.height;
        b.iconH = iconBox; b.iconW = iconBox * aspect;
        if (b.iconW > iconBox) { b.iconW = iconBox; b.iconH = iconBox / aspect; }
      }
      b.w = (b.iconW ? b.iconW + ARMOR_BADGE_ICON_GAP : 0) + b.textW;
      groupW += b.w;
    }
    groupW += ARMOR_BADGE_GAP * (badges.length - 1); // gaps between badges

    let x = bar.x + bar.w / 2 + labelW / 2 + ARMOR_BADGE_GAP;
    // Keep the whole group inside the bar.
    x = Math.min(x, bar.x + bar.w - groupW - 4);
    x = Math.max(x, bar.x + 4);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i];
      if (i > 0) x += ARMOR_BADGE_GAP;
      if (b.iconW) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.shadowColor = 'transparent';
        ctx.drawImage(b.icon, x, cy - b.iconH / 2, b.iconW, b.iconH);
        x += b.iconW + ARMOR_BADGE_ICON_GAP;
      }
      ctx.fillStyle = b.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 3;
      ctx.fillText(b.text, x, cy + 1);
      ctx.shadowColor = 'transparent';
      x += b.textW;
    }
    ctx.restore();
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
