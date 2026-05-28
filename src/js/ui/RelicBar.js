import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';

// ── Tunable layout constants ─────────────────────────────
// These are the per-bar internals; the BattleScene owns the bar's
// outer width/height/margins so the layout offset stays in one place.
// No background or border — relics float over the battle background.
const BAR_PADDING = { top: 40, right: 42, bottom: 0, left: 0 };
const ICON_SIZE = 60;
const ICON_GAP = 10;

// Tooltip layout for relic icons. Tweak here, not at call sites.
const TOOLTIP_SCALE   = 1.0;
const TOOLTIP_OFFSET  = 16;
const TOOLTIP_PADDING = 22;
// Extra design-px around the 50×50 icon that still triggers the tooltip.
// Makes the icon comfortably tappable on phones without enlarging the art.
const TOOLTIP_HIT_PADDING = 12;

/**
 * RelicBar — thin, passive vertical column that displays collected relics
 * as small icons (Slay-the-Spire style).
 *
 * Sits to the left of the player character panel. Icons stack from the top
 * downward; the column has no background or border so the icons appear to
 * "float" against the battle background.
 *
 * Not interactive for clicks (hitTest returns null), but each icon registers
 * a tooltip with the supplied TooltipManager showing the relic's name and
 * description. The manager owns hover/touch-hold input handling — RelicBar
 * just keeps attachments in sync with the current relic list.
 *
 * Usage:
 *   const col = new RelicBar(assetManager);
 *   col.setTooltipManager(tooltipManager); // optional
 *   col.setRelics(playerState.relics);     // safe to call every frame
 */
export default class RelicBar extends UIContainer {
  constructor(assetManager = null, tooltipManager = null) {
    super();

    this._assetManager = assetManager;
    this._tooltipManager = tooltipManager;
    this.smoothing = true;

    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'start';
    this.gap = ICON_GAP;
    this.padding = BAR_PADDING;

    /** Last set of relic ids — used to skip rebuilds when unchanged. */
    this._lastRelicSignature = '';
    /** Cached last relic list — used to re-build when the tooltip manager changes. */
    this._lastRelics = [];
    /** @type {UIImage[]} */
    this._iconImages = [];
  }

  setAssetManager(am) {
    this._assetManager = am;
    for (const img of this._iconImages) img.assetManager = am;
  }

  /**
   * Set the TooltipManager used to register per-icon tooltips. Always
   * triggers a rebuild so attachments are re-registered even when the same
   * manager reference is passed in — BattleScene reuses one manager across
   * battles and calls `clear()` between them, so a no-op short-circuit
   * would leave the icons without tooltips on subsequent entries.
   * @param {import('../systems/TooltipManager.js').default|null} tm
   */
  setTooltipManager(tm) {
    if (this._tooltipManager && this._tooltipManager !== tm) {
      for (const img of this._iconImages) this._tooltipManager.detach(img);
    }
    this._tooltipManager = tm;
    this._rebuild();
  }

  /**
   * Replace the displayed relics. Idempotent: rebuilds children only when
   * the relic id list actually changes, so it's safe to call every frame.
   * @param {Array<{id:string, name?:string, description?:string, icon?:string}>} relics
   */
  setRelics(relics) {
    const list = Array.isArray(relics) ? relics : [];
    const signature = list.map(r => (r && r.id) || '').join('|');
    if (signature === this._lastRelicSignature) return;
    this._lastRelicSignature = signature;
    this._lastRelics = list;
    this._rebuild();
  }

  /**
   * Rebuild the icon list (and tooltip attachments) from the cached
   * `_lastRelics`. Called both when relics change and when the
   * TooltipManager reference changes.
   */
  _rebuild() {
    if (this._tooltipManager) {
      for (const img of this._iconImages) this._tooltipManager.detach(img);
    }

    this.clearChildren();
    this._iconImages = [];

    for (const relic of this._lastRelics) {
      if (!relic) continue;
      const iconKey = relic.icon || 'placeholder';
      const img = new UIImage(iconKey, this._assetManager);
      img.setStyle({
        width: ICON_SIZE,
        height: ICON_SIZE,
        fitMode: 'contain',
        alignSelfH: 'center',
      });
      this._iconImages.push(img);
      this.addChild(img);

      if (this._tooltipManager && (relic.description || relic.name)) {
        this._tooltipManager.attach(img, {
          title: relic.name || '',
          text: relic.description || '',
          scale: TOOLTIP_SCALE,
          offset: TOOLTIP_OFFSET,
          padding: TOOLTIP_PADDING,
          hitPadding: TOOLTIP_HIT_PADDING,
        });
      }
    }
  }

  /** Passive display — never absorb input. */
  hitTest() {
    return null;
  }
}
