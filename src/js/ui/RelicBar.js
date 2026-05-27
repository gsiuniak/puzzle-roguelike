import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';

// ── Tunable layout constants ─────────────────────────────
// These are the per-bar internals; the BattleScene owns the bar's
// outer height/margins so the layout offset stays in one place.
// No background or border — relics float over the battle background.
const BAR_PADDING = { top: 30, right: 0, bottom: 0, left: 0 };
const ICON_SIZE = 50;
const ICON_GAP = 8;

/**
 * RelicBar — thin, passive horizontal strip that displays collected relics
 * as small icons (Slay-the-Spire style).
 *
 * Not interactive: relic icons just "sit" in the bar. Hover/click tooltips
 * can be wired up later without changing the bar's layout or BattleScene
 * call sites.
 *
 * Usage:
 *   const bar = new RelicBar(assetManager);
 *   bar.setRelics(playerState.relics);   // safe to call every frame
 */
export default class RelicBar extends UIContainer {
  constructor(assetManager = null) {
    super();

    this._assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'row';
    this.alignItems = 'center';
    this.justifyContent = 'start';
    this.gap = ICON_GAP;
    this.padding = BAR_PADDING;

    /** Last set of relic ids — used to skip rebuilds when unchanged. */
    this._lastRelicSignature = '';
    /** @type {UIImage[]} */
    this._iconImages = [];
  }

  setAssetManager(am) {
    this._assetManager = am;
    for (const img of this._iconImages) img.assetManager = am;
  }

  /**
   * Replace the displayed relics. Idempotent: rebuilds children only when
   * the relic id list actually changes, so it's safe to call every frame.
   * @param {Array<{id:string, icon?:string}>} relics
   */
  setRelics(relics) {
    const list = Array.isArray(relics) ? relics : [];
    const signature = list.map(r => (r && r.id) || '').join('|');
    if (signature === this._lastRelicSignature) return;
    this._lastRelicSignature = signature;

    this.clearChildren();
    this._iconImages = [];

    for (const relic of list) {
      if (!relic) continue;
      const iconKey = relic.icon || 'placeholder';
      const img = new UIImage(iconKey, this._assetManager);
      img.setStyle({
        width: ICON_SIZE,
        height: ICON_SIZE,
        fitMode: 'contain',
        alignSelfV: 'center',
      });
      this._iconImages.push(img);
      this.addChild(img);
    }
  }

  /** Passive display — never absorb input. */
  hitTest() {
    return null;
  }
}
