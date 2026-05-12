import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import CharacterPane from './CharacterPane.js';
import BoardPlaceholder from './BoardPlaceholder.js';
import UIText from './UIText.js';
import FloatingImageEffect from './FloatingImageEffect.js';
import FloatingTextEffect from './FloatingTextEffect.js';
import TileParticleEffect from './TileParticleEffect.js';
import ScreenShake from './ScreenShake.js';
import { BattleState } from '../game/BattleController.js';
import { getTileType } from '../game/TileTypes.js';

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

    // UIPanel background image — large background benefits from smoothing
    this.assetManager = assetManager;
    this.backgroundAssetKey = 'battle_background_default';
    this.smoothing = true;

    /** @type {import('../game/BattleController.js').default|null} */
    this._battleController = battleController;

    /** @type {import('../audio/AudioManager.js').default|null} */
    this._audioManager = null;

    /** @type {import('../scenes/SceneManager.js').default|null} */
    this._sceneManager = null;

    /**
     * Track previous battle state so we only trigger music on transitions,
     * not every frame.
     * @type {string|null}
     */
    this._previousBattleState = null;

    /**
     * Suppress the very first "player turn" SFX that fires when the battle
     * boots (the TURN_INTRO for the first player turn is automatic, not
     * something the player should hear as a "new turn" announcement).
     * @type {boolean}
     */
    this._suppressFirstTurnSfx = true;

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

    // ── Tile destruction particle effects ──
    /** @type {TileParticleEffect[]} */
    this._particleEffects = [];

    // ── Screen shake ──
    /** @type {ScreenShake} */
    this._screenShake = new ScreenShake();

    // ── Board drag/swap input state ──
    /** @type {{col:number, row:number}|null} */
    this._selectedCell = null;
    /** @type {{col:number, row:number}|null} */
    this._hoveredCell = null;
    /** @type {{col:number, row:number}|null} */
    this._dragStartCell = null;

    // ── Bound input handlers (for cleanup) ──
    this._onMouseDown = null;
    this._onMouseMove = null;
    this._onMouseUp = null;
    this._onContextMenu = null;
    this._onKeyDown = null;

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
      minWidth: 400,
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

  // ── Scene lifecycle ──────────────────────────────────

  /**
   * Called by SceneManager when this scene becomes active.
   * Wires all battle-specific input handlers.
   */
  onEnter() {
    const input = this._sceneManager._input;
    if (!input) return;

    // Reset drag/swap state
    this._selectedCell = null;
    this._hoveredCell = null;
    this._dragStartCell = null;

    // Create bound handlers (stored for cleanup in onExit)
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onMouseUp   = (x, y) => this._handleMouseUp(x, y);
    this._onContextMenu = (e) => this._handleContextMenu(e);
    this._onKeyDown     = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.on('mouseup',   this._onMouseUp);

    input.canvas.addEventListener('contextmenu', this._onContextMenu);
    input.canvas.addEventListener('keydown', this._onKeyDown);
    input.canvas.setAttribute('tabindex', '0');
    input.canvas.style.outline = 'none';
    input.canvas.focus();

    // Wire skill click callbacks
    const playerPane = this._playerPane;
    if (playerPane && this._battleController) {
      playerPane.onSkillClick = (skill) => {
        this._battleController.tryPlayerSkill(skill);
      };
    }
  }

  /**
   * Called by SceneManager when this scene is about to be left.
   * Removes all battle input handlers.
   */
  onExit() {
    const input = this._sceneManager._input;
    if (!input) return;

    if (this._onMouseDown) {
      input.off('mousedown', this._onMouseDown);
      this._onMouseDown = null;
    }
    if (this._onMouseMove) {
      input.off('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onMouseUp) {
      input.off('mouseup', this._onMouseUp);
      this._onMouseUp = null;
    }
    if (this._onContextMenu) {
      input.canvas.removeEventListener('contextmenu', this._onContextMenu);
      this._onContextMenu = null;
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
  }

  // ── Input helpers ────────────────────────────────────

  /** Allow board input during PLAYER_TURN (swap) or TARGETING (target tile) */
  _canAct() {
    if (!this._battleController) return false;
    return this._battleController.state === BattleState.PLAYER_TURN
        || this._battleController.state === BattleState.TARGETING;
  }

  /** True when the game expects the player to act on the board */
  _isTargeting() {
    if (!this._battleController) return false;
    return this._battleController.state === BattleState.TARGETING;
  }

  // ── Input handlers ───────────────────────────────────

  _handleMouseDown(x, y) {
    const board = this._board;
    if (!board) return;

    if (this._isTargeting()) {
      const cell = board.screenToCell(x, y);
      if (cell) {
        this._battleController.tryTargetTile(cell.col, cell.row);
      }
      return;
    }

    if (!this._canAct()) return;
    const cell = board.screenToCell(x, y);
    if (cell) {
      this._selectedCell = cell;
      this._dragStartCell = cell;
      board.selectedCell = cell;
    } else {
      const hit = this.hitTest(x, y);
      if (hit && hit.onClick) {
        hit.onClick();
      }
      this._selectedCell = null;
      this._dragStartCell = null;
      if (board) board.selectedCell = null;
    }
  }

  _handleMouseMove(x, y) {
    const board = this._board;
    if (!board) return;

    if (this._isTargeting()) {
      const cell = board.screenToCell(x, y);
      if (cell) {
        this._battleController.setTargetHover(cell.col, cell.row);
      } else {
        this._battleController.setTargetHover(null, null);
      }
      board.hoveredCell = cell;
      return;
    }

    const cell = this._canAct() ? board.screenToCell(x, y) : null;
    // Play tile_hover SFX when hovering a new tile
    if (cell && this._audioManager) {
      const prev = this._hoveredCell;
      if (!prev || prev.col !== cell.col || prev.row !== cell.row) {
        this._audioManager.playSfx('sfx_tile_hover');
      }
    }
    this._hoveredCell = cell;
    board.hoveredCell = cell;

    const hit = this.hitTest(x, y);
    const playerPane = this._playerPane;
    if (playerPane) {
      for (const row of playerPane._skillRows) {
        row._hovered = (hit === row && row.onClick && this._canAct());
      }
    }
  }

  _handleMouseUp(x, y) {
    const board = this._board;
    if (!board || !this._selectedCell || !this._canAct() || this._isTargeting()) {
      this._selectedCell = null;
      this._dragStartCell = null;
      if (board) board.selectedCell = null;
      return;
    }

    const releaseCell = board.screenToCell(x, y);

    if (releaseCell && this._dragStartCell) {
      const dc = Math.abs(releaseCell.col - this._dragStartCell.col);
      const dr = Math.abs(releaseCell.row - this._dragStartCell.row);

      if ((dc === 1 && dr === 0) || (dc === 0 && dr === 1)) {
        this._battleController.tryPlayerSwap(
          this._dragStartCell.col, this._dragStartCell.row,
          releaseCell.col, releaseCell.row
        );
      }
    }

    this._selectedCell = null;
    this._dragStartCell = null;
    if (board) board.selectedCell = null;
  }

  _handleContextMenu(e) {
    e.preventDefault();
    if (this._isTargeting()) {
      this._battleController.cancelTargeting();
    }
  }

  _handleKeyDown(e) {
    if (e.key === 'Escape' && this._isTargeting()) {
      this._battleController.cancelTargeting();
    }
  }

  // ── Per-Frame Update from BattleController ──────────

  /**
   * Called each frame. Reads current game state and updates UI.
   */
  updateFromController() {
    if (!this._battleController) return;
    const state = this._battleController.getState();

    // ── Music state transitions (only on state change) ──
    this._updateMusicFromState(state.state);

    // ── Play SFX for turn announcement ──
    // Suppress the very first player-turn SFX (the battle boots into
    // PLAYER_TURN automatically; the player shouldn't hear a "new turn"
    // sound for it).
    if (state.turnAnnouncement && this._audioManager) {
      if (!this._suppressFirstTurnSfx) {
        this._audioManager.playSfx('sfx_new_turn');
      }
      this._suppressFirstTurnSfx = false;
    }

    // ── Spawn turn announcement effect ──
    if (state.turnAnnouncement && this._board && this._assetManager) {
      this._spawnTurnAnnouncementEffect(state.turnAnnouncement);
    }

    // ── Spawn extra turn effect ──
    if (state.extraTurnTriggerPos && this._board && this._assetManager) {
      this._spawnExtraTurnEffect(state.extraTurnTriggerPos);
      // Play extra_turn SFX at the time the animation pops up
      if (this._audioManager) {
        this._audioManager.playSfx('sfx_extra_turn');
      }
    }

    // ── Spawn match text effects for every 3+ match ──
    if (state.matchTextTriggers && state.matchTextTriggers.length > 0 && this._board) {
      for (const trigger of state.matchTextTriggers) {
        this._spawnMatchTextEffect(trigger);
      }
    }

    // ── Play skull damage SFX ──
    if (state.skullDamageDealt && this._audioManager) {
      this._audioManager.playSfx('sfx_skull_damage');
    }

    // ── Play skill resolve sound ──
    // This is set by BattleController only when a skill actually resolves
    // (not on button click, not on cancel). Safe no-op if skill has no sound.
    if (state.pendingSkillSound && this._audioManager) {
      this._audioManager.playSfx(state.pendingSkillSound);
    }

    // ── Trigger screen shake for damage ──
    if (state.shakeIntensity && state.shakeIntensity > 0) {
      this._screenShake.trigger(state.shakeIntensity);
    }

    // ── Spawn tile destruction particle bursts ──
    if (state.destroyedTiles && state.destroyedTiles.length > 0 && this._board) {
      // Play tile_destroy SFX once (not per-tile)
      if (this._audioManager) {
        this._audioManager.playSfx('sfx_tile_destroy');
      }
      for (const dt of state.destroyedTiles) {
        this._spawnTileDestroyParticles(dt);
      }
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
      this._board.targetingOverlayCells = state.targetingOverlayCells || [];
      // Pass particle effects to board for correct layering (below tiles)
      this._board.particleEffects = this._particleEffects;
    }
  }

  // ── Floating Image Effects ──────────────────────────

  /**
   * Get the center of the board area in screen coordinates.
   * Used for centered turn announcement effects.
   * @returns {{x:number, y:number}|null}
   */
  _getBoardCenter() {
    if (!this._board) return null;
    const r = this._board.rect;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /**
   * Spawn a centered turn announcement floating image effect.
   * @param {string} side - 'player' or 'enemy'
   */
  _spawnTurnAnnouncementEffect(side) {
    const assetKey = side === 'player'
      ? 'animated_text_player_turn'
      : 'animated_text_enemy_turn';
    const img = this._assetManager.get(assetKey);
    if (!img) return;

    const center = this._getBoardCenter();
    if (!center) return;

    const metrics = this._board.getCellMetrics();
    const targetWidth = metrics.cellSize * 5.0;
    const aspectRatio = img.width / img.height;
    const targetHeight = targetWidth / aspectRatio;

    const effect = new FloatingImageEffect(
      img,
      center.x,
      center.y,
      targetWidth,
      targetHeight,
      {
        growDuration: 150,
        settleDuration: 100,
        holdDuration: 250,
        fadeDuration: 100,
        overshoot: 1.15,
      }
    );

    this._floatingEffects.push(effect);
  }

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
   * Spawn a floating text effect showing the match count (e.g. "+3")
   * at the given board position, colored to match the tile type.
   * @param {{typeId:string, count:number, position:{col:number, row:number}}} trigger
   */
  _spawnMatchTextEffect(trigger) {
    const { typeId, count, position } = trigger;
    const screen = this._cellToScreen(position);
    if (!screen) return;

    const tileType = getTileType(typeId);
    const color = tileType.color;

    const text = `+${count}`;

    const effect = new FloatingTextEffect(text, color, screen.x, screen.y, {
      fontSize: 22,
      growDuration: 200,
      settleDuration: 100,
      holdDuration: 300,
      fadeDuration: 100,
      overshoot: 1.18,
    });

    this._floatingEffects.push(effect);
  }

  /**
   * Spawn a particle burst effect for a single destroyed tile.
   * Particle size scales with the board cell size for consistency.
   * @param {{col:number, row:number, typeId:string}} destroyedTile
   */
  _spawnTileDestroyParticles(destroyedTile) {
    const screen = this._cellToScreen(destroyedTile);
    if (!screen) return;

    const tileType = getTileType(destroyedTile.typeId);
    const metrics = this._board.getCellMetrics();
    // Base particle radius ~5% of cell size, clamped to 2-5px
    const baseSize = Math.max(2, Math.min(5, metrics.cellSize * 0.05));

    const effect = new TileParticleEffect(
      screen.x, screen.y,
      tileType.particleColor,
      baseSize,
      {
        particleCount: 12,
        sparkCount: 6,
        minLife: 250,
        maxLife: 500,
        minSpeed: metrics.cellSize * 0.12,
        maxSpeed: metrics.cellSize * 0.55,
        gravity: metrics.cellSize * 0.03,
      }
    );

    this._particleEffects.push(effect);
  }

  // ── Update (override) ───────────────────────────────

  update(dt) {
    // Update game logic first (battle state machine, AI, etc.)
    if (this._battleController) {
      this._battleController.update(dt);
    }

    // Sync UI state from game state
    this.updateFromController();

    // Update children (standard UI tree update)
    super.update(dt);

    // Update screen shake
    this._screenShake.update(dt);

    // Update floating effects, remove completed ones
    for (let i = this._floatingEffects.length - 1; i >= 0; i--) {
      this._floatingEffects[i].update(dt);
      if (this._floatingEffects[i].done) {
        this._floatingEffects.splice(i, 1);
      }
    }

    // Update particle effects, remove completed ones
    for (let i = this._particleEffects.length - 1; i >= 0; i--) {
      this._particleEffects[i].update(dt);
      if (this._particleEffects[i].done) {
        this._particleEffects.splice(i, 1);
      }
    }
  }

  // ── Render (override) ───────────────────────────────

  render(ctx) {
    // Apply screen shake offset
    const shake = this._screenShake.getOffset();
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.save();
      ctx.translate(shake.x, shake.y);
    }

    // Render standard UI (background, children, board with particles)
    super.render(ctx);

    // Render floating effects on top of everything
    for (const effect of this._floatingEffects) {
      effect.render(ctx);
    }

    // Restore context after shake offset
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.restore();
    }
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

  // ── Audio manager ───────────────────────────────────

  /**
   * Set the AudioManager reference so the scene can trigger music
   * based on battle state transitions.
   * @param {import('../audio/AudioManager.js').default} am
   */
  setAudioManager(am) {
    this._audioManager = am;
  }

  /**
   * React to battle state transitions for music playback.
   * Only fires on state *change*, not every frame.
   * @param {string} currentState — BattleState enum value
   */
  _updateMusicFromState(currentState) {
    if (!this._audioManager) return;

    // No-op if state hasn't changed
    if (currentState === this._previousBattleState) return;
    this._previousBattleState = currentState;

    switch (currentState) {
      case BattleState.PLAYER_TURN:
      case BattleState.ENEMY_TURN:
        // Ensure battle music is playing (fade in)
        this._audioManager.playMusic('battle_theme', { fadeIn: 600 });
        break;

      case BattleState.GAME_OVER:
        // Stop battle music with a short fade-out
        this._audioManager.stopMusic(400);
        break;

      default:
        // TURN_INTRO, RESOLVING, SWAPPING, TARGETING — no music change
        break;
    }
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
