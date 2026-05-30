/**
 * RewardOptionPanel — a single, reusable post-battle relic reward option.
 *
 * A TALL VERTICAL card backed by the `rewards_option_panel_vertical` art.
 * Content flows top-to-bottom, all centered:
 *
 *   ┌──────────────┐
 *   │              │
 *   │   [ icon ]   │   large, prominent, upper portion
 *   │              │
 *   │  Relic Name  │   centered
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
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';

// ── Tunable layout constants ───────────────────────────────
/** Icon size as a fraction of the card's WIDTH (square, contain-fit) */
const ICON_WIDTH_FRAC = 0.62;
/** Hard cap on icon size as a fraction of the card's height */
const ICON_MAX_HEIGHT_FRAC = 0.34;
/** Inner padding of the option card (clears the ornate frame art) */
const OPTION_PADDING = { top: 26, right: 22, bottom: 28, left: 22 };
/** Top margin above the icon, as a fraction of card height (pushes icon down from the frame) */
const ICON_TOP_MARGIN_FRAC = 0.04;
/** Gap between the icon and the name row (px) */
const ICON_TO_NAME_GAP = 18;
/** Vertical gap between stacked text rows (px) */
const TEXT_ROW_GAP = 2;
/** Horizontal inset of the description text from the card's content edges (px) */
const DESC_SIDE_PADDING = 18;

// ── Text styling (unchanged colors/typography from prior implementation) ──
const NAME_FONT_SIZE = 38;
const RARITY_FONT_SIZE = 24;
const DESC_FONT_SIZE = 22;
const NAME_COLOR = '#e8d8b0';
const DESC_COLOR = '#c0b890';

/** Rarity → label color. Future: may also drive borders/glow. */
const RARITY_COLORS = {
  starter: '#b8b8b8',
  common: '#c9c9c9',
  uncommon: '#6cc24a',
  rare: '#b06cff',
  legendary: '#ffb454',
};

// ── Divider (same color/thickness as before; horizontally inset for the card) ──
const DIVIDER_THICKNESS = 1;
const DIVIDER_COLOR = 'rgba(255, 255, 255, 0.22)';
const DIVIDER_MARGIN = { top: 8, bottom: 10, left: 14, right: 14 };

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
      backgroundAssetKey: 'rewards_option_panel_vertical',
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
      margin: { top: ICON_TO_NAME_GAP },
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

    // ── Divider ──
    this._divider = new UIContainer();
    this._divider.setStyle({
      background: DIVIDER_COLOR,
      height: DIVIDER_THICKNESS,
      margin: DIVIDER_MARGIN,
    });
    this.addChild(this._divider);

    // ── Description (centered, wrapped). Height measured each layout pass. ──
    this._descText = new UIText('');
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
   */
  setRelic(relicDef) {
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
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    this._rarityText.setStyle({
      text: label,
      color: RARITY_COLORS[rarity] || RARITY_COLORS.common,
    });

    this._descText.setStyle({ text: relicDef.description || '' });
  }

  /**
   * Size the icon from the card's current width, give it a top margin to sit
   * in the upper portion, then measure the wrapped description height — BEFORE
   * running the column layout — so the stacked rows lay out without overflow.
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
    this._icon.margin = { top: this.rect.h * ICON_TOP_MARGIN_FRAC };

    const pad = this._resolvePadding();
    const contentW = Math.max(10, this.rect.w - pad.left - pad.right);

    // Name & rarity span the full content width (centered, single-line).
    this._nameText.setStyle({ maxWidth: Math.floor(contentW) });
    this._rarityText.setStyle({ maxWidth: Math.floor(contentW) });

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
