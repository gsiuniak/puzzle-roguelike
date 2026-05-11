import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import CharacterPane from './CharacterPane.js';
import BoardPlaceholder from './BoardPlaceholder.js';
import UIText from './UIText.js';

/**
 * BattleScene — full battle layout with three columns.
 *
 * Structure:
 *   BattleScene (column, UIPanel with battle_background_default)
 *     MainRow (row, flexGrow=1)
 *       PlayerPane   (CharacterPane, ~25% width)
 *       CenterColumn (column, flexGrow=1)
 *         TurnLabel
 *         BoardPlaceholder (square, flexGrow=1)
 *         CombatLogPlaceholder
 *       EnemyPane    (CharacterPane, ~25% width)
 *
 * Both character panes use the SAME CharacterPane component.
 * The only difference is the data object passed in.
 */
export default class BattleScene extends UIPanel {
  /**
   * @param {object} playerData  - mock player data
   * @param {object} enemyData   - mock enemy data
   * @param {object} assetManager - AssetManager instance
   */
  constructor(playerData = null, enemyData = null, assetManager = null) {
    super();
    this.direction = 'column';
    this.gap = 0;
    this.padding = 0;

    this._playerData = playerData;
    this._enemyData = enemyData;
    this._assetManager = assetManager;

    // UIPanel background image support — fills empty area with ambiance
    this.assetManager = assetManager;
    this.backgroundAssetKey = 'battle_background_default';

    // Child references
    this._playerPane = null;
    this._enemyPane = null;
    this._board = null;
    this._turnLabel = null;

    if (playerData || enemyData) {
      this.buildHierarchy();
    }
  }

  buildHierarchy() {
    // ── Main row: three columns ──────────────────────
    const mainRow = new UIContainer();
    mainRow.direction = 'row';
    mainRow.gap = 10;
    mainRow.alignItems = 'stretch';
    mainRow.flexGrow = 1;
    mainRow.padding = { top: 12, right: 12, bottom: 12, left: 12 };

    // ── LEFT: Player CharacterPane ───────────────────
    this._playerPane = new CharacterPane(this._playerData, this._assetManager);
    this._playerPane.setStyle({
      widthPercent: 0.25,
      minWidth: 300,
      maxWidth: 440,
      backgroundAssetKey: 'character_pane_background',
      borderColor: '#554422',
      borderWidth: 2,
      cornerRadius: 8,
      padding: { top: 14, right: 16, bottom: 16, left: 16 },
      gap: 10,
    });
    mainRow.addChild(this._playerPane);

    // ── CENTER: board + turn label + combat log ─────
    const centerCol = new UIContainer();
    centerCol.direction = 'column';
    centerCol.gap = 6;
    centerCol.flexGrow = 1;
    centerCol.alignItems = 'center';
    centerCol.justifyContent = 'center';

    // Turn label
    this._turnLabel = new UIText('Player Turn');
    this._turnLabel.setStyle({
      fontSize: 16,
      color: '#e0d070',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 22,
      margin: { top: 2, bottom: 0 },
    });
    centerCol.addChild(this._turnLabel);

    // Board placeholder — fills available center space
    this._board = new BoardPlaceholder(this._assetManager);
    this._board.setStyle({
      flexGrow: 1,
      minWidth: 280,
      minHeight: 280,
      margin: { top: 4, right: 8, bottom: 4, left: 8 },
    });
    centerCol.addChild(this._board);

    // Combat log placeholder
    const combatLog = new UIContainer();
    combatLog.setStyle({
      background: 'rgba(0,0,0,0.35)',
      borderColor: '#443322',
      borderWidth: 1,
      cornerRadius: 4,
      height: 56,
      padding: 6,
      margin: { top: 2, bottom: 2 },
    });
    const logText = new UIText('Combat log — future area');
    logText.setStyle({
      fontSize: 12,
      color: '#777777',
      italic: true,
      alignH: 'center',
      alignV: 'center',
    });
    combatLog.addChild(logText);
    centerCol.addChild(combatLog);

    mainRow.addChild(centerCol);

    // ── RIGHT: Enemy CharacterPane ───────────────────
    this._enemyPane = new CharacterPane(this._enemyData, this._assetManager);
    this._enemyPane.setStyle({
      widthPercent: 0.25,
      minWidth: 300,
      maxWidth: 440,
      backgroundAssetKey: 'character_pane_background',
      borderColor: '#554422',
      borderWidth: 2,
      cornerRadius: 8,
      padding: { top: 14, right: 16, bottom: 16, left: 16 },
      gap: 10,
    });
    mainRow.addChild(this._enemyPane);

    this.addChild(mainRow);
  }

  // ── data updates ────────────────────────────────────

  setPlayerData(data) {
    this._playerData = data;
    if (this._playerPane) this._playerPane.setCharacterData(data);
  }

  setEnemyData(data) {
    this._enemyData = data;
    if (this._enemyPane) this._enemyPane.setCharacterData(data);
  }

  updateFromData() {
    if (this._playerPane) this._playerPane.updateFromData();
    if (this._enemyPane) this._enemyPane.updateFromData();
  }

  // ── asset mgmt ──────────────────────────────────────

  setAssetManager(am) {
    this._assetManager = am;
    if (this._playerPane) this._playerPane.setAssetManager(am);
    if (this._enemyPane) this._enemyPane.setAssetManager(am);
    if (this._board) this._board.setAssetManager(am);
  }

  // ── style passthrough ───────────────────────────────

  setStyle(props) {
    super.setStyle(props);
    // Propagate debug to children
    if (props.debug !== undefined) {
      this._setDebugRecursive(props.debug);
    }
  }

  _setDebugRecursive(enabled) {
    // Applied externally via setDebugRecursive in main.js
  }
}
