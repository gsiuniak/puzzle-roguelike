/**
 * RewardOptionPanel — a single, reusable post-battle relic reward option.
 *
 * A TALL VERTICAL card backed by the per-rarity `relics_pane_panel_<rarity>`
 * art (each rarity tier has its own frame with matching baked gem/trim color).
 * Content flows top-to-bottom, all centered:
 *
 *   ┌──────────────┐
 *   │ ┌──────────┐ │
 *   │ │  [icon]  │ │   centered inside the art's dark INSET frame
 *   │ └──────────┘ │
 *   │  Relic Name  │   centered, below the inset frame
 *   │    Rarity    │   centered, rarity-colored
 *   │  ──────────  │   divider
 *   │ Multiline    │   centered, wrapped description
 *   │ description  │
 *   └──────────────┘
 *
 * It is a real container (UIPanel) — not a flat image — so it owns its icon
 * and text children and can carry hover/selection state. Data-driven via
 * setRelic(relicDef); every visible value comes from the relic definition.
 *
 * Layout notes:
 *   - The icon is sized from the card's WIDTH each layout pass so all cards
 *     stay visually consistent regardless of how the parent distributes space.
 *   - The description's wrapped height is measured each layout pass and used
 *     as a fixed height so text doesn't overflow the card.
 *
 * Hit-testing returns the panel itself (children don't intercept) so the
 * RewardOverlay can map a hit straight to the option index.
 */

import UIPanel from './UIPanel.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';
import KeywordText from './KeywordText.js';
import { resolveDynamicText } from '../data/scalingConfig.js';

// ── Tunable layout constants ───────────────────────────────
/** Icon size as a fraction of the card's WIDTH (square, contain-fit) */
const ICON_WIDTH_FRAC = 0.62;
/** Hard cap on icon size as a fraction of the card's height */
const ICON_MAX_HEIGHT_FRAC = 0.34;
/** Inner padding of the option card (clears the ornate frame art) */
const OPTION_PADDING = { top: 26, right: 22, bottom: 28, left: 22 };

// ── Art geometry (fractions of the card height, measured from the
//    `relics_pane_panel_common` art, 450×784: the inner ornate frame's
//    trim sits at y≈49 / y≈385 — all four rarity panels share the layout) ──
/** Top edge of the dark inset area inside the inner ornate frame */
const INSET_TOP_FRAC = 48 / 780;
/** Bottom edge of the dark inset area */
const INSET_BOTTOM_FRAC = 383 / 780;
/**
 * Where the text block (name/rarity/divider/description) starts — just below
 * the inset frame's bottom corner flourishes (which hang to ~y≈405/780).
 */
const TEXT_TOP_FRAC = 0.53;
/** Vertical gap between stacked text rows (px) */
const TEXT_ROW_GAP = 2;
/** Horizontal inset of the description text from the card's content edges (px) */
const DESC_SIDE_PADDING = 18;

// ── Text styling (unchanged colors/typography from prior implementation) ──
const NAME_FONT_SIZE = 43;
const RARITY_FONT_SIZE = 27;
const DESC_FONT_SIZE = 26;
const NAME_COLOR = '#e8d8b0';
const DESC_COLOR = '#c0b890';

// ── Per-rarity panel art (each tier has its own frame) ────
const PANEL_ASSET_BY_RARITY = {
  common: 'relics_pane_panel_common',
  uncommon: 'relics_pane_panel_uncommon',
  rare: 'relics_pane_panel_rare',
  legendary: 'relics_pane_panel_legendary',
};
/** Panel used for rarities without dedicated art (e.g. starter) */
export const PANEL_ASSET_FALLBACK = 'relics_pane_panel_common';

/** Rarity → label color. Future: may also drive borders/glow. */
const RARITY_COLORS = {
  starter: '#b8b8b8',
  common: '#c9c9c9',
  uncommon: '#6cc24a',
  rare: '#b06cff',
  legendary: '#ffb454',
};

// ── Divider (rarity-specific ornate image: reward_divider_<rarity>.png) ──
/** Margin around the divider image (horizontally inset from the card edges) */
const DIVIDER_MARGIN = { top: 8, bottom: 10, left: 14, right: 14 };
/** Rarities that have a dedicated divider asset; others fall back to common */
const DIVIDER_RARITIES = new Set(['common', 'uncommon', 'rare', 'legendary']);
/** Fallback width/height ratio if the divider image isn't loaded yet at layout time */
const DIVIDER_FALLBACK_ASPECT = 12;

/**
 * Shared offscreen 2D context for measuring the wrapped description height
 * during layout (UIText.measureText needs a ctx). Lazily created; null in
 * non-DOM environments (tests) where layout falls back to a single-line height.
 */
let _measureCtx = null;
function getMeasureCtx() {
  if (_measureCtx) return _measureCtx;
  if (typeof document === 'undefined') return null;
  _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

export default class RewardOptionPanel extends UIPanel {
  /**
   * @param {import('../engine/AssetManager.js').default} assetManager
   */
  constructor(assetManager) {
    super();
    this._assetManager = assetManager || null;
    /** @type {object|null} the relic definition currently displayed */
    this._relic = null;

    this.setStyle({
      backgroundAssetKey: PANEL_ASSET_FALLBACK,
      assetManager: this._assetManager,
      direction: 'column',
      alignItems: 'stretch',
      justifyContent: 'start',
      gap: TEXT_ROW_GAP,
      padding: OPTION_PADDING,
    });

    // ── Icon (top, large, centered) ──
    this._icon = new UIImage('', this._assetManager);
    this._icon.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      alignSelfH: 'center',
    });
    this.addChild(this._icon);

    // ── Name (centered) ──
    this._nameText = new UIText('');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      bold: true,
      color: NAME_COLOR,
      alignH: 'center',
      alignV: 'center',
      height: Math.round(NAME_FONT_SIZE * 1.3),
    });
    this.addChild(this._nameText);

    // ── Rarity (centered, beneath name) ──
    this._rarityText = new UIText('');
    this._rarityText.setStyle({
      fontSize: RARITY_FONT_SIZE,
      color: RARITY_COLORS.common,
      alignH: 'center',
      alignV: 'center',
      height: Math.round(RARITY_FONT_SIZE * 1.35),
    });
    this.addChild(this._rarityText);

    // ── Divider (rarity-specific ornate image; height set in layoutChildren) ──
    this._divider = new UIImage('reward_divider_common', this._assetManager);
    this._divider.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      margin: DIVIDER_MARGIN,
    });
    this.addChild(this._divider);

    // ── Description (centered, wrapped). Height measured each layout pass. ──
    // KeywordText so [[Keyword]] markup renders bracket-free and color-coded.
    this._descText = new KeywordText('');
    this._descText.setStyle({
      fontSize: DESC_FONT_SIZE,
      color: DESC_COLOR,
      alignH: 'center',
      alignV: 'top',
      height: Math.round(DESC_FONT_SIZE * 1.3),
      lineHeight: Math.round(DESC_FONT_SIZE * 1.4),
    });
    this.addChild(this._descText);

    this.userData = { relic: null };
  }

  /** @returns {object|null} the relic definition currently displayed */
  get relic() {
    return this._relic;
  }

  /**
   * Populate this card from a relic definition. Pass null to hide the card.
   * @param {object|null} relicDef — relic from relicCatalog (name/rarity/icon/description)
   * @param {{attack?:number, magic?:number}|null} [ownerStats] — the player's
   *   current stats, used to resolve the description's `<<n>>` dynamic damage
   *   values so the card shows the relic's REAL (stat-scaled) numbers, not the base.
   */
  setRelic(relicDef, ownerStats = null) {
    this._relic = relicDef || null;
    this.userData.relic = this._relic;

    if (!relicDef) {
      this.visible = false;
      return;
    }
    this.visible = true;

    this._icon.assetKey = relicDef.icon || 'placeholder';
    this._nameText.setStyle({ text: relicDef.name || 'Unknown Relic' });

    const rarity = relicDef.rarity || 'common';

    // Each rarity tier has its own panel frame art.
    this.backgroundAssetKey = PANEL_ASSET_BY_RARITY[rarity] || PANEL_ASSET_FALLBACK;

    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    this._rarityText.setStyle({
      text: label,
      color: RARITY_COLORS[rarity] || RARITY_COLORS.common,
    });

    // Divider image matches the relic's rarity (fallback to common).
    this._divider.assetKey = DIVIDER_RARITIES.has(rarity)
      ? `reward_divider_${rarity}`
      : 'reward_divider_common';

    // Resolve `<<n>>` dynamic damage values against the player's current stats
    // so e.g. Thorned Rose shows its real Attack-scaled damage, not the base.
    const desc = resolveDynamicText(relicDef.description || '', relicDef.effects, ownerStats);
    this._descText.setStyle({ text: desc });
  }

  /**
   * Size the icon from the card's current width and center it inside the
   * art's dark inset frame (INSET_TOP_FRAC..INSET_BOTTOM_FRAC), push the text
   * block below the inset (TEXT_TOP_FRAC), then measure the wrapped
   * description height — BEFORE running the column layout — so the stacked
   * rows lay out without overflow. The anchoring is done purely via top
   * margins so the normal column flow still owns the layout.
   *
   * IMPORTANT: every text row must be given an explicit `maxWidth` here. The
   * column layout clamps each child's width to `Math.min(child.maxWidth, …)`,
   * and `UIText` defaults `maxWidth` to 0 ("single line, no wrap") — which the
   * layout would read as a 0-px width cap, collapsing the row and making
   * `alignH:'center'` center the text on the card's left edge. Setting maxWidth
   * to the available width both gives the row full width (so centering works)
   * and acts as the wrap width (short names/rarity never wrap).
   */
  layoutChildren() {
    const iconSize = Math.max(
      8,
      Math.min(this.rect.w * ICON_WIDTH_FRAC, this.rect.h * ICON_MAX_HEIGHT_FRAC),
    );
    this._icon.width = iconSize;
    this._icon.height = iconSize;

    const pad = this._resolvePadding();

    // Center the icon vertically inside the art's dark inset frame.
    const insetCenterY = this.rect.h * (INSET_TOP_FRAC + INSET_BOTTOM_FRAC) / 2;
    this._icon.margin = { top: Math.max(0, insetCenterY - iconSize / 2 - pad.top) };

    // Start the text block (name onward) just below the inset frame,
    // regardless of where the icon's bottom edge landed.
    const iconBottomY = insetCenterY + iconSize / 2;
    this._nameText.margin = {
      top: Math.max(0, this.rect.h * TEXT_TOP_FRAC - iconBottomY - TEXT_ROW_GAP),
    };
    const contentW = Math.max(10, this.rect.w - pad.left - pad.right);

    // Name & rarity span the full content width (centered, single-line).
    this._nameText.setStyle({ maxWidth: Math.floor(contentW) });
    this._rarityText.setStyle({ maxWidth: Math.floor(contentW) });

    // Divider: span the inset width at the image's natural aspect, so its
    // height (a fixed row in the column layout) matches the scaled art and
    // leaves no extra vertical gap. 'contain' then fills the width exactly.
    const dMargin = this._divider._resolveMargin();
    const dividerW = Math.max(2, contentW - dMargin.left - dMargin.right);
    const dividerImg = this._assetManager ? this._assetManager.get(this._divider.assetKey) : null;
    const dividerAspect = (dividerImg && dividerImg.width && dividerImg.height)
      ? dividerImg.width / dividerImg.height
      : DIVIDER_FALLBACK_ASPECT;
    this._divider.height = Math.max(2, Math.round(dividerW / dividerAspect));

    // Description is inset from both card edges, wraps to the narrower width.
    const descWrapW = Math.max(10, contentW - DESC_SIDE_PADDING * 2);
    this._descText.margin = { left: DESC_SIDE_PADDING, right: DESC_SIDE_PADDING };
    this._descText.setStyle({ maxWidth: Math.floor(descWrapW) });

    const ctx = getMeasureCtx();
    if (ctx) {
      const measured = this._descText.measureText(ctx);
      this._descText.height = Math.max(DESC_FONT_SIZE, Math.ceil(measured.height));
    } else {
      this._descText.height = Math.ceil(DESC_FONT_SIZE * 1.3);
    }

    super.layoutChildren();
  }

  /** Children never intercept hits — the card is the click target. */
  hitTest(x, y) {
    if (!this.visible) return null;
    return this.rect.containsPoint(x, y) ? this : null;
  }
}
