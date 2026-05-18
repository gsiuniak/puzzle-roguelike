import UIPanel from './UIPanel.js';

const BTN_PADDING = 2;

/**
 * RelicButton — placeholder slot for a relic. Currently always renders the
 * `relics_locked_button` background and is non-interactive. Future relic
 * data can be added by extending this component to draw the actual relic
 * icon and toggle locked state.
 */
export default class RelicButton extends UIPanel {
  /**
   * @param {object|null} relicData - relic definition or null for locked
   * @param {object|null} assetManager
   * @param {object}      [opts]
   * @param {boolean}     [opts.locked=true]
   */
  constructor(relicData = null, assetManager = null, opts = {}) {
    super();

    this._relicData = relicData;
    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this._locked = opts.locked !== undefined ? opts.locked : true;

    this.padding = BTN_PADDING;
    this.backgroundAssetKey = this._locked ? 'relics_locked_button' : 'relics_locked_button';
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
  }

  /** Locked relic buttons are always pass-through for hit testing. */
  hitTest(x, y) {
    if (!this.visible) return null;
    if (this._locked) return null;
    if (!this.rect.containsPoint(x, y)) return null;
    return this;
  }
}
