/**
 * RewardOptionPanel — a single, reusable post-battle relic reward option.
 *
 * A horizontal two-column card backed by the `rewards_option_panel` art:
 *
 *   [ relic icon ] | Relic Name
 *                  | Rarity
 *                  | ────────────────  (divider)
 *                  | Multiline description...
 *
 * It is a real container (UIPanel) — not a flat image — so it owns its icon
 * and text children and can carry hover/selection state. Data-driven via
 * setRelic(relicDef); every visible value comes from the relic definition.
 *
 * Layout notes:
 *   - The icon is sized from the card's height each layout pass so all rows
 *     stay visually consistent regardless of how the parent distributes space.
 *   - The description wraps to its column width (set after layout each frame).
 *   - The divider is a thin full-width container between rarity and desc.
 *
 * Hit-testing returns the panel itself (children don't intercept) so the
 * RewardOverlay can map a hit straight to the option index.
 */

import UIPanel from './UIPanel.js';
import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import UIText from './UIText.js';

// ── Tunable layout constants ───────────────────────────────
/** Icon size as a fraction of the option card's height */
const ICON_HEIGHT_FRAC = 0.6;
/** Hard cap on icon width as a fraction of the card's width */
const ICON_MAX_WIDTH_FRAC = 0.24;
/** Inner padding of the option card */
const OPTION_PADDING = { top: 10, right: 18, bottom: 10, left: 16 };
/** Gap between the icon column and the text column */
const COLUMN_GAP = 14;
/** Vertical gap between stacked text rows */
const TEXT_ROW_GAP = 2;

// ── Text styling ───────────────────────────────────────────
const NAME_FONT_SIZE = 22;
const RARITY_FONT_SIZE = 15;
const DESC_FONT_SIZE = 16;
const NAME_COLOR = '#f1e6cb';
const DESC_COLOR = '#cdcdcd';

/** Rarity → label color. Future: may also drive borders/glow. */
const RARITY_COLORS = {
  starter: '#b8b8b8',
  common: '#c9c9c9',
  uncommon: '#6cc24a',
  rare: '#b06cff',
  legendary: '#ffb454',
};

// ── Divider ────────────────────────────────────────────────
const DIVIDER_THICKNESS = 1;
const DIVIDER_COLOR = 'rgba(255, 255, 255, 0.22)';
const DIVIDER_MARGIN = { top: 5, bottom: 6 };

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
      backgroundAssetKey: 'rewards_option_panel',
      assetManager: this._assetManager,
      direction: 'row',
      alignItems: 'center',
      gap: COLUMN_GAP,
      padding: OPTION_PADDING,
    });

    // ── Left column: relic icon ──
    this._icon = new UIImage('', this._assetManager);
    this._icon.setStyle({
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
      alignSelfV: 'center',
    });
    this.addChild(this._icon);

    // ── Right column: stacked text content ──
    this._textCol = new UIContainer();
    this._textCol.setStyle({
      direction: 'column',
      alignItems: 'stretch',
      justifyContent: 'start',
      flexGrow: 1,
      gap: TEXT_ROW_GAP,
    });
    this.addChild(this._textCol);

    this._nameText = new UIText('');
    this._nameText.setStyle({
      fontSize: NAME_FONT_SIZE,
      bold: true,
      color: NAME_COLOR,
      alignH: 'left',
      alignV: 'center',
      height: Math.round(NAME_FONT_SIZE * 1.3),
    });
    this._textCol.addChild(this._nameText);

    this._rarityText = new UIText('');
    this._rarityText.setStyle({
      fontSize: RARITY_FONT_SIZE,
      color: RARITY_COLORS.common,
      alignH: 'left',
      alignV: 'center',
      height: Math.round(RARITY_FONT_SIZE * 1.35),
    });
    this._textCol.addChild(this._rarityText);

    this._divider = new UIContainer();
    this._divider.setStyle({
      background: DIVIDER_COLOR,
      height: DIVIDER_THICKNESS,
      margin: DIVIDER_MARGIN,
    });
    this._textCol.addChild(this._divider);

    this._descText = new UIText('');
    this._descText.setStyle({
      fontSize: DESC_FONT_SIZE,
      color: DESC_COLOR,
      alignH: 'left',
      alignV: 'top',
      flexGrow: 1,
      lineHeight: Math.round(DESC_FONT_SIZE * 1.3),
    });
    this._textCol.addChild(this._descText);

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
   * Size the icon from the card's current dimensions, run the standard
   * row layout, then constrain the description's wrap width to its column.
   */
  layoutChildren() {
    const iconSize = Math.max(
      8,
      Math.min(this.rect.h * ICON_HEIGHT_FRAC, this.rect.w * ICON_MAX_WIDTH_FRAC),
    );
    this._icon.width = iconSize;
    this._icon.height = iconSize;

    super.layoutChildren();

    // Wrap the description to whatever width its column ended up with.
    if (this._descText) {
      const w = Math.floor(this._descText.rect.w);
      if (w > 0 && this._descText.maxWidth !== w) {
        this._descText.setStyle({ maxWidth: w });
      }
    }
  }

  /** Children never intercept hits — the card is the click target. */
  hitTest(x, y) {
    if (!this.visible) return null;
    return this.rect.containsPoint(x, y) ? this : null;
  }
}
