import UIPanel from './UIPanel.js';
import UIText from './UIText.js';

// ── Tunable layout constants ─────────────────────────────
const PANEL_PADDING = { top: 8, right: 14, bottom: 8, left: 14 };
const LOG_FONT_SIZE = 12;
const LOG_COLOR = '#cfc8a8';

/**
 * CombatLogPanel — compact panel under the board that displays
 * recent combat log messages. Structured to later host the old
 * "Player Turn / Enemy Turn" announcement text alongside log
 * messages (the BattleController already exposes that data).
 *
 * No dedicated background art asset exists yet, so this panel
 * falls back to a styled dark fill that visually matches the
 * mock placeholder.
 */
export default class CombatLogPanel extends UIPanel {
  constructor(assetManager = null) {
    super();
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'row';
    this.alignItems = 'center';
    this.padding = PANEL_PADDING;
    this.background = 'rgba(12, 11, 8, 0.78)';
    this.borderColor = '#2a2520';
    this.borderWidth = 1;
    this.cornerRadius = 4;
    // No asset for combat_log_panel yet — leave key null so we fall
    // back to the styled background/border. Future art can be wired
    // here without changing call sites.
    this.backgroundAssetKey = null;

    this._logText = new UIText('');
    this._logText.setStyle({
      fontSize: LOG_FONT_SIZE,
      color: LOG_COLOR,
      alignH: 'left',
      alignV: 'center',
      flexGrow: 1,
    });
    this.addChild(this._logText);
  }

  /** Update the displayed log line(s). Accepts a single string. */
  setText(text) {
    if (this._logText) this._logText.text = text || '';
  }

  /** Direct access to the text element so external code can style it if needed. */
  get textElement() { return this._logText; }
}
