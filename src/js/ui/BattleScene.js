import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import CharacterPane from './CharacterPane.js';
import BoardPlaceholder from './BoardPlaceholder.js';
import UIText from './UIText.js';
import FloatingImageEffect from './FloatingImageEffect.js';

/**
 * BattleScene — full battle layout with three columns.
 *
 * Structure:
 *   BattleScene (column, UIPanel with battle_background_default)
 *     MainRow (row, flexGrow=1)
 *       PlayerPane   (CharacterPane, ~24% width)
 *       CenterColumn (column, flexGrow=1)
 *         TurnLabel  (dynamic: "Player Turn" / "Enemy Turn" / etc.)
 *         BoardPlaceholder (square, flexGrow=1)
 *         CombatLogContainer (scrollable log area)
 *       EnemyPane    (CharacterPane, ~24% width)
 *
 * BattleScene now accepts a BattleController reference and updates
 * character panes, turn label, and combat log from real game state.
 * Also manages floating image effects (e.g., "Extra Turn" feedback).
 */
export default class BattleScene extends UIPanel {
  /**
   * @param {object} playerData  - mock player data
   * @param {object} enemyData   - mock enemy data
   * @param {object} assetManager - AssetManager instance
   * @param {import('../game/BattleController.js').default} [battleController]
   */
  constructor(playerData = null, enemyData = null, assetManager = null, battleController = null) {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.gap = 0;
    this.padding = 0;

    this._playerData = playerData;
    this._enemyData = enemyData;
    this._assetManager = assetManager;

    // UIPanel background image
    this.assetManager = assetManager;
    this.backgroundAssetKey = 'battle_background_default';

    /** @type {import('../game/BattleController.js').default|null} */
    this._battleController = battleController;

    // Child references
    this._playerPane = null;
    this._enemyPane = null;
    this._board = null;
    this._turnLabel = null;
    this._combatLogContainer = null;
    this._combatLogText = null;

    // ── Floating image effects ──
    /** @type {FloatingImageEffect[]} */
    this._floatingEffects = [];

    // ── Screen shake state ──
    /** Current shake intensity (0 = none) */
    this._shakeIntensity = 0;
    /** Elapsed time since shake began (ms) */
    this._shakeElapsed = 0;
    /** Total shake duration (ms) */
    this._shakeDuration = 300;
    /** Base amplitude as fraction of canvas width (e.g. 0.04 = 4 %) */
    this._shakeBaseAmplitude = 0.04;

    if (playerData || enemyData) {
      this.buildHierarchy();
    }
  }

  /** Set or update battle controller reference */
  setBattleController(controller) {
    this._battleController = controller;
    if (controller && this._board) {
      this._board.setBoardModel(controller.board);
    }
  }

  buildHierarchy() {
    // ── Main row: three columns, centered ──
    const mainRow = new UIContainer();
    mainRow.direction = 'row';
    mainRow.gap = 10;
    mainRow.alignItems = 'stretch';
    mainRow.justifyContent = 'center';
    mainRow.flexGrow = 1;
    mainRow.maxWidth = 1600;
    mainRow.padding = { top: 12, right: 12, bottom: 12, left: 12 };

    // ── LEFT: Player CharacterPane ───────────────────
    this._playerPane = new CharacterPane(this._playerData, this._assetManager);
    this._playerPane.setStyle({
      widthPercent: 0.24,
      minWidth: 360,
      maxWidth: 440,
      backgroundAssetKey: 'character_pane_background',
      borderColor: '#1c1c1d',
      borderWidth: 2,
      cornerRadius: 8,
      padding: { top: 14, right: 16, bottom: 16, left: 16 },
      gap: 10,
    });
    mainRow.addChild(this._playerPane);

    // ── CENTER: turn label + board + combat log ──────
    const centerCol = new UIContainer();
    centerCol.direction = 'column';
    centerCol.gap = 6;
    centerCol.flexGrow = 1;

    // Turn label (dynamic)
    this._turnLabel = new UIText('Player Turn');
    this._turnLabel.setStyle({
      fontSize: 18,
      color: '#e0d070',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 26,
      margin: { top: 2, bottom: 0 },
    });
    centerCol.addChild(this._turnLabel);

    // Board placeholder — driven by BoardModel
    const boardModel = this._battleController ? this._battleController.board : null;
    this._board = new BoardPlaceholder(this._assetManager, boardModel);
    this._board.setStyle({
      flexGrow: 1,
      minWidth: 280,
      minHeight: 280,
      margin: { top: 4, right: 8, bottom: 4, left: 8 },
    });
    centerCol.addChild(this._board);

    // Combat log container
    this._combatLogContainer = new UIContainer();
    this._combatLogContainer.setStyle({
      background: 'rgba(0,0,0,0.45)',
      borderColor: '#1c1c1d',
      borderWidth: 1,
      cornerRadius: 4,
      height: 60,
      padding: 6,
      margin: { top: 2, bottom: 2 },
    });

    this._combatLogText = new UIText('Combat log...');
    this._combatLogText.setStyle({
      fontSize: 11,
      color: '#aaaaaa',
      alignH: 'left',
      alignV: 'center',
    });
    this._combatLogContainer.addChild(this._combatLogText);

    centerCol.addChild(this._combatLogContainer);
    mainRow.addChild(centerCol);

    // ── RIGHT: Enemy CharacterPane ───────────────────
    this._enemyPane = new CharacterPane(this._enemyData, this._assetManager);
    this._enemyPane.setStyle({
      widthPercent: 0.24,
      minWidth: 400,
      maxWidth: 440,
      backgroundAssetKey: 'character_pane_background',
      borderColor: '#1c1c1d',
      borderWidth: 2,
      cornerRadius: 8,
      padding: { top: 14, right: 16, bottom: 16, left: 16 },
      gap: 10,
    });
    mainRow.addChild(this._enemyPane);

    this.addChild(mainRow);
  }

  // ── Per-Frame Update from BattleController ──────────

  /**
   * Called each frame. Reads current game state and updates UI.
   */
  updateFromController() {
    if (!this._battleController) return;
    const state = this._battleController.getState();

    // ── Spawn extra turn effect ──
    if (state.extraTurnTriggerPos && this._board && this._assetManager) {
      this._spawnExtraTurnEffect(state.extraTurnTriggerPos);
    }

    // ── Trigger screen shake ──
    if (state.screenShake) {
      this._triggerShake(state.screenShake.intensity);
    }

    // Update turn label
    if (this._turnLabel) {
      this._turnLabel.text = this._battleController.getTurnLabel();
    }

    // Update player pane from real state
    if (this._playerPane && state.playerState) {
      this._playerPane.updateFromState(state.playerState);
    }

    // Update enemy pane from real state
    if (this._enemyPane && state.enemyState) {
      this._enemyPane.updateFromState(state.enemyState);
    }

    // Update combat log
    if (this._combatLogText && state.log) {
      const recent = state.log.getRecent(3);
      this._combatLogText.text = recent.map(e => e.message).join(' | ');
    }

    // Pass cascade visual state to board
    if (this._board) {
      this._board.highlightCells = state.highlightCells || [];
      this._board.emptyCells = state.emptyCells || [];
      this._board.fallCells = state.fallCells || [];
      this._board.swapAnim = state.swapAnim || null;
    }
  }

  // ── Floating Image Effects ──────────────────────────

  /**
   * Convert a board cell (col, row) to screen coordinates (center of cell).
   * @param {{col:number, row:number}} cellPos
   * @returns {{x:number, y:number}|null}
   */
  _cellToScreen(cellPos) {
    if (!this._board) return null;
    const metrics = this._board.getCellMetrics();
    return {
      x: metrics.offsetX + cellPos.col * metrics.cellSize + metrics.cellSize / 2,
      y: metrics.offsetY + cellPos.row * metrics.cellSize + metrics.cellSize / 2,
    };
  }

  /**
   * Spawn an "Extra Turn" floating image effect from the given board position.
   * @param {{col:number, row:number}} cellPos
   */
  _spawnExtraTurnEffect(cellPos) {
    const img = this._assetManager.get('animated_text_extra_turn');
    if (!img) return;

    const screen = this._cellToScreen(cellPos);
    if (!screen) return;

    // Target size: 4.5 tile widths, maintain aspect ratio
    const metrics = this._board.getCellMetrics();
    const targetWidth = metrics.cellSize * 4.5;
    const aspectRatio = img.width / img.height;
    const targetHeight = targetWidth / aspectRatio;

    const effect = new FloatingImageEffect(
      img,
      screen.x,
      screen.y,
      targetWidth,
      targetHeight,
      {
        growDuration: 200,
        settleDuration: 100,
        holdDuration: 300,
        fadeDuration: 100,
        overshoot: 1.18,
      }
    );

    this._floatingEffects.push(effect);
  }

  /**
   * Begin (or intensify) the screen shake.
   * @param {number} intensity - 0..0.20 from BattleController
   */
  _triggerShake(intensity) {
    // Use the higher of current remaining intensity vs new trigger
    const currentRemaining = this._shakeIntensity * (1 - this._shakeElapsed / this._shakeDuration);
    const newIntensity = Math.max(currentRemaining, intensity);
    this._shakeIntensity = newIntensity;
    this._shakeElapsed = 0;
  }

  // ── Update (override) ───────────────────────────────

  update(dt) {
    // Update children (standard UI tree update)
    super.update(dt);

    // Update floating effects, remove completed ones
    for (let i = this._floatingEffects.length - 1; i >= 0; i--) {
      this._floatingEffects[i].update(dt);
      if (this._floatingEffects[i].done) {
        this._floatingEffects.splice(i, 1);
      }
    }

    // Decay screen shake
    if (this._shakeIntensity > 0) {
      this._shakeElapsed += dt;
      if (this._shakeElapsed >= this._shakeDuration) {
        this._shakeIntensity = 0;
        this._shakeElapsed = 0;
      }
    }
  }

  // ── Render (override) ───────────────────────────────

  render(ctx) {
    // Apply screen shake via canvas translation
    let shakeX = 0;
    let shakeY = 0;
    if (this._shakeIntensity > 0 && this._shakeElapsed < this._shakeDuration) {
      const progress = this._shakeElapsed / this._shakeDuration;
      // Intensity decays linearly over the duration
      const currentIntensity = this._shakeIntensity * (1 - progress);
      // Base amplitude scales with canvas width
      const canvasW = ctx.canvas.width;
      const maxOffset = canvasW * this._shakeBaseAmplitude * currentIntensity;
      // Deterministic pseudo-random per frame using elapsed time
      const seed = this._shakeElapsed * 0.037;
      shakeX = Math.sin(seed * 17.3) * maxOffset;
      shakeY = Math.cos(seed * 23.7) * maxOffset;
    }

    ctx.save();
    if (shakeX !== 0 || shakeY !== 0) {
      ctx.translate(shakeX, shakeY);
    }

    // Render standard UI (background, children)
    super.render(ctx);

    // Render floating effects on top of everything
    for (const effect of this._floatingEffects) {
      effect.render(ctx);
    }

    ctx.restore();
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

  // ── Board access ────────────────────────────────────

  /** @returns {BoardPlaceholder|null} */
  getBoard() {
    return this._board;
  }

  /** @returns {CharacterPane|null} */
  getPlayerPane() {
    return this._playerPane;
  }

  /** @returns {CharacterPane|null} */
  getEnemyPane() {
    return this._enemyPane;
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
    if (props.debug !== undefined) {
      this._setDebugRecursive(props.debug);
    }
  }

  _setDebugRecursive(enabled) {
    // Applied externally via setDebugRecursive in main.js
  }
}
