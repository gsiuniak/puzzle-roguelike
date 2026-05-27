import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import CharacterInfoPane from './CharacterInfoPane.js';
import SkillsPane from './SkillsPane.js';
import RelicBar from './RelicBar.js';
import BattleBoardPanel from './BattleBoardPanel.js';
import CombatLogPanel from './CombatLogPanel.js';
import BoardPlaceholder from './BoardPlaceholder.js';
import UIText from './UIText.js';
import FloatingImageEffect from './FloatingImageEffect.js';
import FloatingTextEffect from './FloatingTextEffect.js';
import TileParticleEffect from './TileParticleEffect.js';
import ScreenShake from './ScreenShake.js';
import RewardOverlay from './RewardOverlay.js';
import { BattleState } from '../game/BattleController.js';
import { getTileType } from '../game/TileTypes.js';
import { syncBattleResultsToRunState } from '../data/playerStats.js';
import { ENABLE_PERSISTENT_BATTLE_MUSIC, DEFAULT_BATTLE_MUSIC_KEY } from '../audio/BattleMusicConfig.js';

// ── Tunable layout constants ─────────────────────────────
const MAIN_ROW_MAX_WIDTH = 1820;
// Horizontal gap between the side columns and the central board panel.
// Negative = the column rects overlap, which pulls the visible side
// panels tighter against the board frame (since each side panel image
// has its own transparent inner margin).
const MAIN_ROW_GAP = -30;
// Vertical padding around the main row. Smaller top/bottom = the board
// frame can stretch to a taller square.
const MAIN_ROW_PADDING = { top: 8, right: 0, bottom: 8, left: 0 };

// Width of each side (player/enemy) column. Reduce to bring the
// visible panel art closer to the board frame; the side panel
// images include some transparent inner margin so the column rect
// is typically larger than the visible art.
const SIDE_COL_WIDTH = 420;
const SIDE_COL_MIN_WIDTH = 440;
const SIDE_COL_MAX_WIDTH = 440;
const SIDE_COL_GAP = 8;

// Fixed width for the center (board + combat log) column. Should be
// roughly equal to the available vertical space for the board frame
// (canvas height minus padding minus combat log height) so the
// `BattleBoardPanel` square fills the column with minimal slack on
// either side. If this is larger than the available height, you get
// empty space inside the center column between the board frame and
// the side columns.
//
// Design height 1080 - main row top/bottom padding (40) - combat log
// (80) - center column gap (8) ≈ 952 → 940 leaves a small breathing
// margin. Reduce to pull side panels even closer.
const CENTER_COL_WIDTH = 1080;
const CENTER_COL_GAP = 8;
// Height of the combat log strip below the board. Bump this to make
// the log strip taller; reduce to give the board more vertical room.
const COMBAT_LOG_HEIGHT = 80;

// ── Relic bar (thin passive strip at the very top) ────────
// The bar must span from the LEFT edge of the player panel to the RIGHT
// edge of the enemy panel. Because MAIN_ROW_GAP is negative the side
// columns overflow MainRow's maxWidth, so we derive the bar's width from
// the actual column extent rather than MAIN_ROW_MAX_WIDTH.
// Its total vertical footprint = RELIC_BAR_TOP_MARGIN + RELIC_BAR_HEIGHT.
const RELIC_BAR_HEIGHT = 42;
const RELIC_BAR_TOP_MARGIN = 5;
const RELIC_BAR_WIDTH =
  SIDE_COL_WIDTH + MAIN_ROW_GAP + CENTER_COL_WIDTH + MAIN_ROW_GAP + SIDE_COL_WIDTH;

/**
 * BattleScene — battle layout with three compact columns.
 *
 * Structure:
 *   BattleScene (column, UIPanel with battle_background_default)
 *     RelicBar (thin passive strip at the very top, player relics only)
 *     MainRow (row, flexGrow=1, maxWidth=MAIN_ROW_MAX_WIDTH)
 *       PlayerColumn  (column, fixed-narrow)
 *         CharacterInfoPane (compact portrait + stats + mana)
 *         SkillsPane        (2x3 grid; locked fillers)
 *       CenterColumn  (column, flexGrow=1)
 *         TurnLabel (hidden — preserved for state/data binding only)
 *         BattleBoardPanel  (background asset + BoardPlaceholder child)
 *         CombatLogPanel
 *       EnemyColumn   (mirror of PlayerColumn)
 *
 * BattleScene accepts a BattleController reference and updates character
 * info panes, skill affordability, and the combat log from real game state.
 * The old top-of-board turn-status text element is retained (and still
 * updated) but hidden — its logic is preserved so it can later be routed
 * into CombatLogPanel.
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

    // Background is drawn at the CanvasApp level (cover-fit across the
    // entire physical canvas, eliminating letterbox/pillarbox bars).
    // The UIPanel's own backgroundAssetKey is intentionally left null
    // so we don't double-render the bg over the design rect.
    this.assetManager = assetManager;
    this.backgroundAssetKey = null;
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
    this._playerSkillsPane = null;
    this._enemySkillsPane = null;
    /** @type {RelicBar|null} */
    this._relicBar = null;
    this._board = null;
    this._boardPanel = null;
    /** Retained for backwards-compat: the old visible turn label is hidden
     *  in the new layout but the text element + data binding are preserved
     *  so the underlying logic still works and the message can later be
     *  surfaced in CombatLogPanel. */
    this._turnLabel = null;
    this._combatLogPanel = null;
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

    /** Delay after game over before showing reward overlay (ms) */
    this._gameOverDelay = 400;
    /** Timer tracking elapsed time in game over state */
    this._gameOverTimer = 0;
    /** Whether the reward overlay has been shown after game over */
    this._rewardOverlayShown = false;

    /**
     * Callback invoked when the battle ends. Set by MapScene before
     * entering battle so BattleScene does not need map internals.
     * Signature: (result: { result: string, nodeId: string }) => void
     * @type {Function|null}
     */
    this._onBattleComplete = null;

    // ── Map overlay (toggled with 'm' key, animated via MapView) ──
    /** @type {import('../map/MapView.js').default|null} shared MapView borrowed from MapScene */
    this._mapView = null;

    // ── Reward overlay (post-battle reward screen) ──
    /** @type {RewardOverlay|null} */
    this._rewardOverlay = null;

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
    // ── Top: thin passive relic bar (player relics, Slay-the-Spire style) ──
    // Width matches the full side-panel-to-side-panel extent so the bar
    // sits flush against the player panel's left edge and the enemy
    // panel's right edge.
    //
    // The negative bottom margin cancels the bar's height in the vertical
    // flex calculation so MainRow keeps the full canvas height. That matters
    // because BattleBoardPanel renders as a centered Math.min(w,h) square —
    // any vertical space the bar steals from MainRow would shrink the board
    // square and push the side panels away from it horizontally.
    this._relicBar = new RelicBar(this._assetManager);
    this._relicBar.setStyle({
      height: RELIC_BAR_HEIGHT,
      width: RELIC_BAR_WIDTH,
      margin: {
        top: RELIC_BAR_TOP_MARGIN,
        bottom: -(RELIC_BAR_HEIGHT + RELIC_BAR_TOP_MARGIN),
      },
    });
    this.addChild(this._relicBar);

    // ── Main row: three columns, centered ──
    const mainRow = new UIContainer();
    mainRow.direction = 'row';
    mainRow.gap = MAIN_ROW_GAP;
    mainRow.alignItems = 'stretch';
    mainRow.justifyContent = 'center';
    mainRow.flexGrow = 1;
    mainRow.maxWidth = MAIN_ROW_MAX_WIDTH;
    mainRow.padding = MAIN_ROW_PADDING;

    // ── LEFT: compact stacked player column ───────────
    const playerCol = this._buildSideColumn('player');
    mainRow.addChild(playerCol);

    // ── CENTER: hidden turn label + board panel + combat log ──
    // Fixed width (no flexGrow) so the side columns cluster snug
    // against the board frame thanks to mainRow.justifyContent='center'.
    const centerCol = new UIContainer();
    centerCol.direction = 'column';
    centerCol.gap = CENTER_COL_GAP;
    centerCol.width = CENTER_COL_WIDTH;
    centerCol.alignItems = 'stretch';

    // Turn label — KEPT for state/data binding compatibility but
    // hidden from the visible layout. Its text is still updated by
    // updateFromController() so future logic can route it elsewhere
    // (e.g. into CombatLogPanel) without re-introducing scaffolding.
    this._turnLabel = new UIText('Player Turn');
    this._turnLabel.setStyle({
      fontSize: 18,
      color: '#e0d070',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 0,
      visible: false,
    });
    centerCol.addChild(this._turnLabel);

    // Board panel — wraps the existing BoardPlaceholder.
    this._boardPanel = new BattleBoardPanel(this._assetManager);
    this._boardPanel.flexGrow = 1;

    const boardModel = this._battleController ? this._battleController.board : null;
    this._board = new BoardPlaceholder(this._assetManager, boardModel);
    this._board.setStyle({
      flexGrow: 1,
      minWidth: 280,
      minHeight: 280,
    });
    this._boardPanel.addChild(this._board);
    centerCol.addChild(this._boardPanel);

    // Combat log panel
    this._combatLogPanel = new CombatLogPanel(this._assetManager);
    this._combatLogPanel.setStyle({ height: COMBAT_LOG_HEIGHT, margin: { right: 40, left: 40 } });
    this._combatLogText = this._combatLogPanel.textElement;
    // centerCol.addChild(this._combatLogPanel);

    mainRow.addChild(centerCol);

    // ── RIGHT: compact stacked enemy column ───────────
    const enemyCol = this._buildSideColumn('enemy');
    mainRow.addChild(enemyCol);

    this.addChild(mainRow);
  }

  /**
   * Build a compact stacked side column (character info + skills).
   * Relics are no longer rendered per-side — see the top-of-screen RelicBar.
   * @param {'player'|'enemy'} side
   * @returns {UIContainer}
   */
  _buildSideColumn(side) {
    const col = new UIContainer();
    col.direction = 'column';
    col.gap = SIDE_COL_GAP;
    col.alignItems = 'stretch';
    col.width = SIDE_COL_WIDTH;
    col.minWidth = SIDE_COL_MIN_WIDTH;
    col.maxWidth = SIDE_COL_MAX_WIDTH;
    col.margin = { top: 30 };

    const isPlayer = side === 'player';
    const data    = isPlayer ? this._playerData : this._enemyData;
    const skills  = (data && data.skills) || [];

    // 1) Compact character info pane (portrait + stats + mana)
    const infoPane = new CharacterInfoPane(data, this._assetManager);
    if (isPlayer) this._playerPane = infoPane; else this._enemyPane = infoPane;
    col.addChild(infoPane);

    // 2) Skills pane (2x3 grid; remaining slots = locked placeholders showing skills_locked_icon)
    const skillsPane = new SkillsPane(skills, this._assetManager);
    if (isPlayer) this._playerSkillsPane = skillsPane;
    else          this._enemySkillsPane  = skillsPane;
    skillsPane.flexGrow = 0;
    col.addChild(skillsPane);

    return col;
  }

  // ── Scene lifecycle ──────────────────────────────────

  /**
   * Called by SceneManager when this scene becomes active.
   * Wires all battle-specific input handlers.
   */
  onEnter() {
    const input = this._sceneManager._input;
    if (!input) return;

    // ── Full-canvas background (covers letterbox/pillarbox bars) ──
    const bgImg = this._assetManager
      ? this._assetManager.get('battle_background_default')
      : null;
    if (this._sceneManager._app && this._sceneManager._app.setBackgroundImage) {
      this._sceneManager._app.setBackgroundImage(bgImg);
    }

    // Reset drag/swap state
    this._selectedCell = null;
    this._hoveredCell = null;
    this._dragStartCell = null;

    // ── Borrow MapView from MapScene for 'm' overlay ──
    // Ensure overlay starts closed (MapView.resetOverlay was already
    // called by the previous onExit or initial construction).
    const mapScene = this._sceneManager._scenes['MapScene'];
    if (mapScene && mapScene._mapView) {
      this._mapView = mapScene._mapView;
    } else {
      this._mapView = null;
    }

    // ── Reward overlay (post-battle reward screen) ──
    // Created once per battle scene instance; reset on each entry.
    if (!this._rewardOverlay) {
      const assetManager = this._assetManager;
      this._rewardOverlay = new RewardOverlay({
        assetManager,
        onDismiss: () => this._returnToMap(),
      });
    }
    this._rewardOverlay.reset();
    this._rewardOverlayShown = false;

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

    // Wire skill click callbacks on the new SkillsPane
    if (this._playerSkillsPane && this._battleController) {
      this._playerSkillsPane.onSkillClick = (skill) => {
        this._battleController.tryPlayerSkill(skill);
      };
    }
  }

  /**
   * Called by SceneManager when this scene is about to be left.
   * Removes all battle input handlers.
   */
  onExit() {
    // ── Clear the full-canvas background hook so other scenes get
    //    the default black-bar behavior back.
    if (this._sceneManager && this._sceneManager._app && this._sceneManager._app.setBackgroundImage) {
      this._sceneManager._app.setBackgroundImage(null);
    }

    // Force-close the map overlay if it was open/animating
    if (this._mapView) {
      this._mapView.resetOverlay();
    }

    // Reset reward overlay (ensure clean state on next entry)
    if (this._rewardOverlay) {
      this._rewardOverlay.reset();
    }

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
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      this._rewardOverlay.handleMouseDown(x, y);
      return;
    }
    if (this._mapView && this._mapView.isOverlayActive()) return;
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
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      this._rewardOverlay.handleMouseMove(x, y);
      return;
    }
    if (this._mapView && this._mapView.isOverlayActive()) return;
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
    if (this._playerSkillsPane) {
      for (const btn of this._playerSkillsPane.skillButtons) {
        btn._hovered = (hit === btn && btn.onClick && this._canAct());
      }
    }
  }

  _handleMouseUp(x, y) {
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    const board = this._board;
    if (!board || !this._dragStartCell || !this._canAct() || this._isTargeting()) {
      this._selectedCell = null;
      this._dragStartCell = null;
      if (board) board.selectedCell = null;
      return;
    }

    // ── Direction-based swap ──────────────────────────
    // Use the drag vector (from the start cell's center to the release point)
    // rather than which cell the release point landed in. This is much more
    // forgiving for touch: a finger lifted slightly off the target cell, or
    // released past it, still produces the intended swap. The dominant axis
    // of the drag picks the orthogonal neighbor.
    const metrics = board.getCellMetrics();
    const startCx = metrics.offsetX + (this._dragStartCell.col + 0.5) * metrics.cellSize;
    const startCy = metrics.offsetY + (this._dragStartCell.row + 0.5) * metrics.cellSize;
    const dx = x - startCx;
    const dy = y - startCy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    // Threshold = 1/3 of a tile — enough to reject taps but lenient on swipes.
    const threshold = metrics.cellSize * 0.33;

    if (Math.max(adx, ady) >= threshold) {
      let targetCol = this._dragStartCell.col;
      let targetRow = this._dragStartCell.row;
      if (adx >= ady) {
        targetCol += dx > 0 ? 1 : -1;
      } else {
        targetRow += dy > 0 ? 1 : -1;
      }
      if (targetCol >= 0 && targetCol < board.cols
          && targetRow >= 0 && targetRow < board.rows) {
        this._battleController.tryPlayerSwap(
          this._dragStartCell.col, this._dragStartCell.row,
          targetCol, targetRow
        );
      }
    }

    this._selectedCell = null;
    this._dragStartCell = null;
    if (board) board.selectedCell = null;
  }

  _handleContextMenu(e) {
    e.preventDefault();
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._isTargeting()) {
      this._battleController.cancelTargeting();
    }
  }

  _handleKeyDown(e) {
    // ── Reward overlay: ESC dismisses, blocks all other input ──
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      if (e.key === 'Escape') {
        this._rewardOverlay.dismiss();
      }
      return;
    }

    // ── Debug: instant win with 'K' key ──
    if ((e.key === 'k' || e.key === 'K') && window.__DEBUG_MODE) {
      this._debugWinBattle();
      return;
    }

    // ── Map overlay toggle ('m') ──
    if (e.key === 'm' || e.key === 'M') {
      if (this._mapView) {
        const state = this._mapView.getOverlayState();
        if (state === 'closed') {
          this._mapView.openOverlay();
          if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_open');
        } else if (state === 'open') {
          this._mapView.closeOverlay();
          if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_close');
        }
        // If animating (opening/closing), ignore to avoid restarting.
      }
      return;
    }

    // ── When map overlay is active, Escape hides it ──
    if (this._mapView && this._mapView.isOverlayActive()) {
      if (e.key === 'Escape') {
        this._mapView.closeOverlay();
        if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_close');
      }
      return;
    }

    // ── Normal battle key handling ──
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

    // ── Spawn tile conversion shimmer effects ──
    if (state.convertedTiles && state.convertedTiles.length > 0 && this._board) {
      for (const ct of state.convertedTiles) {
        this._spawnTileConvertParticles(ct);
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
    if (this._playerSkillsPane && state.playerState && state.playerState.mana) {
      this._playerSkillsPane.setManaState(state.playerState.mana);
    }
    // Update top relic bar from player relics (no-op when unchanged)
    if (this._relicBar && state.playerState) {
      this._relicBar.setRelics(state.playerState.relics || []);
    }

    // Update enemy pane from real state
    if (this._enemyPane && state.enemyState) {
      this._enemyPane.updateFromState(state.enemyState);
    }
    if (this._enemySkillsPane && state.enemyState && state.enemyState.mana) {
      this._enemySkillsPane.setManaState(state.enemyState.mana);
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

  /**
   * Spawn a shimmer/pop conversion effect for a tile changed by CREATE_TILES.
   * Uses an inward particle burst (smaller, directed inward) with the new
   * tile type's color to visually communicate "this tile transformed."
   * @param {{col:number, row:number, typeId:string}} convertedTile
   */
  _spawnTileConvertParticles(convertedTile) {
    const screen = this._cellToScreen(convertedTile);
    if (!screen) return;

    const tileType = getTileType(convertedTile.typeId);
    const metrics = this._board.getCellMetrics();
    // Slightly larger base size for conversion shimmer
    const baseSize = Math.max(2, Math.min(6, metrics.cellSize * 0.07));

    const effect = new TileParticleEffect(
      screen.x, screen.y,
      tileType.particleColor,
      baseSize,
      {
        particleCount: 8,
        sparkCount: 4,
        minLife: 200,
        maxLife: 400,
        minSpeed: metrics.cellSize * 0.04,
        maxSpeed: metrics.cellSize * 0.25,
        gravity: metrics.cellSize * -0.02,  // slight upward drift for "magic" feel
      }
    );

    this._particleEffects.push(effect);
  }

  // ── Update (override) ───────────────────────────────

  update(dt) {
    // ── Advance map overlay animation ──
    if (this._mapView) {
      this._mapView.updateOverlayAnimation(dt);
    }

    // ── Update reward overlay animation (placeholder for future transitions) ──
    if (this._rewardOverlay) {
      this._rewardOverlay.update(dt);
    }

    // Update game logic first (battle state machine, AI, etc.)
    if (this._battleController) {
      this._battleController.update(dt);
    }

    // Sync UI state from game state
    this.updateFromController();

    // ── Detect game over and show reward overlay ──
    if (this._battleController && this._battleController.state === BattleState.GAME_OVER) {
      this._gameOverTimer += dt;
      if (this._gameOverTimer >= this._gameOverDelay && !this._rewardOverlayShown) {
        this._rewardOverlayShown = true;
        if (this._rewardOverlay) {
          this._rewardOverlay.show();
        }
      }
    }

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

  /**
   * Paint full-canvas overlays that sit on top of the battle UI and must
   * cover the letterbox/pillarbox bars. Called by SceneManager after the
   * design-space viewport clip is closed.
   *
   * - Map overlay ('m' key): dark backdrop full-canvas + map panel in
   *   design space (via MapView.renderOverlay).
   * - Reward overlay (post-battle): rewards_background_splash full-canvas +
   *   reward panel in design space (via RewardOverlay.render).
   */
  renderForeground(ctx) {
    const sm = this._sceneManager;
    if (!sm) return;
    const w = sm._app.width;
    const h = sm._app.height;

    if (this._mapView && this._mapView.isOverlayActive()) {
      this._mapView.renderOverlay(ctx, w, h, 16, sm._app);
    }

    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      const am = this._assetManager;
      const splash = am ? am.get('rewards_background_splash') : null;
      if (splash) {
        sm._app.drawFullCanvasImage(splash, this._rewardOverlay.getEntranceAlpha());
      }
      this._rewardOverlay.render(ctx, w, h);
    }
  }

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

    // Map overlay and reward overlay are rendered by renderForeground()
    // so their full-canvas backdrops/splashes cover the letterbox bars.
  }


  // ── data updates ────────────────────────────────────

  setPlayerData(data) {
    this._playerData = data;
    if (this._playerPane) this._playerPane.setCharacterData(data);
    if (this._playerSkillsPane) this._playerSkillsPane.setSkills((data && data.skills) || []);
    // Re-wire skill click after rebuild
    if (this._playerSkillsPane && this._battleController) {
      this._playerSkillsPane.onSkillClick = (skill) => {
        this._battleController.tryPlayerSkill(skill);
      };
    }
  }

  setEnemyData(data) {
    this._enemyData = data;
    if (this._enemyPane) this._enemyPane.setCharacterData(data);
    if (this._enemySkillsPane) this._enemySkillsPane.setSkills((data && data.skills) || []);
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

  /** @returns {CharacterInfoPane|null} */
  getPlayerPane() {
    return this._playerPane;
  }

  /** @returns {CharacterInfoPane|null} */
  getEnemyPane() {
    return this._enemyPane;
  }

  // ── asset mgmt ──────────────────────────────────────

  setAssetManager(am) {
    this._assetManager = am;
    if (this._playerPane) this._playerPane.setAssetManager(am);
    if (this._enemyPane) this._enemyPane.setAssetManager(am);
    if (this._playerSkillsPane) this._playerSkillsPane.setAssetManager(am);
    if (this._enemySkillsPane)  this._enemySkillsPane.setAssetManager(am);
    if (this._relicBar) this._relicBar.setAssetManager(am);
    if (this._boardPanel) this._boardPanel.setAssetManager(am);
    if (this._combatLogPanel) this._combatLogPanel.assetManager = am;
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
   *
   * When ENABLE_PERSISTENT_BATTLE_MUSIC is true:
   *   - Uses the AudioManager battle music lifecycle API.
   *   - Normal battle music persists across scenes (battle → rewards → map).
   *   - Special encounter music stops after battle.
   *
   * When ENABLE_PERSISTENT_BATTLE_MUSIC is false:
   *   - Original behavior: music stops on GAME_OVER, restarts each battle.
   *
   * @param {string} currentState — BattleState enum value
   */
  _updateMusicFromState(currentState) {
    if (!this._audioManager) return;

    // No-op if state hasn't changed
    if (currentState === this._previousBattleState) return;
    this._previousBattleState = currentState;

    if (ENABLE_PERSISTENT_BATTLE_MUSIC) {
      this._updateMusicFromState_persistent(currentState);
    } else {
      this._updateMusicFromState_original(currentState);
    }
  }

  /**
   * Original music behavior (ENABLE_PERSISTENT_BATTLE_MUSIC = false).
   * Music stops on GAME_OVER, restarts fresh each battle.
   * @param {string} currentState
   */
  _updateMusicFromState_original(currentState) {
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

  /**
   * Persistent music behavior (ENABLE_PERSISTENT_BATTLE_MUSIC = true).
   * Normal battle music continues across scenes; special music stops after battle.
   * @param {string} currentState
   */
  _updateMusicFromState_persistent(currentState) {
    const music = this._getMusicInfo();

    switch (currentState) {
      case BattleState.PLAYER_TURN:
      case BattleState.ENEMY_TURN:
        // Start/restore battle music via lifecycle API
        this._audioManager.startBattleMusic(music.trackKey, music.isSpecialTrack);
        break;

      case BattleState.GAME_OVER:
        // End battle — stop special music, or dim normal music
        this._audioManager.onBattleEnd(music.isSpecialTrack);
        break;

      default:
        // TURN_INTRO, RESOLVING, SWAPPING, TARGETING — no music change
        break;
    }
  }

  /**
   * Resolve music metadata for the current battle.
   * Reads from userData.music (set by MapScene) with a fallback to the default.
   * @returns {{ trackKey: string, isSpecialTrack: boolean }}
   */
  _getMusicInfo() {
    const music = (this.userData && this.userData.music) || {};
    return {
      trackKey: music.trackKey || DEFAULT_BATTLE_MUSIC_KEY,
      isSpecialTrack: music.isSpecialTrack || false,
    };
  }

  /**
   * Transition back to the MapScene after battle ends.
   * Called when the reward overlay is dismissed (via onDismiss callback).
   * Calls _onBattleComplete so the map/run controller can update
   * node completion and reachability before the scene switch.
   */
  _returnToMap() {
    const sm = this._sceneManager;
    if (!sm) return;

    const mapData = this.userData || {};
    const mapScene = sm._scenes['MapScene'];

    // Determine battle result
    const winner = this._battleController
      ? this._battleController._winner()
      : (this._enemyData && this._enemyData.hp <= 0 ? 'player' : 'enemy');
    const nodeId = mapData.nodeId || null;

    // Report battle completion to the run/map controller
    // This allows MapScene to mark the node as completed and update
    // reachability before the scene transition completes.
    if (this._onBattleComplete) {
      this._onBattleComplete({
        result: winner === 'player' ? 'victory' : 'defeat',
        nodeId,
      });
    }

    // Restore map state if available
    if (mapScene && mapData) {
      // Restore seed
      if (mapData.mapSeed) {
        mapScene.setSeed(mapData.mapSeed);
      }
      // Sync battle results back to run state (persistent HP)
      if (mapData.runState && this._battleController) {
        syncBattleResultsToRunState(mapData.runState, this._battleController.playerState);
        // Apply post-battle healing
        this._applyPostBattleHealing(mapData.runState, this._battleController.playerState);
        mapScene.setRunState(mapData.runState, null);
      }
    }

    // Fade transition back to MapScene
    sm.fadeToScene('MapScene', 200);

    console.log(`[BattleScene] Returning to MapScene (result: ${winner}, node: ${nodeId}).`);
  }

  /**
   * Debug: instantly win the current battle.
   * Only callable when DEBUG_MODE is true (checked in _handleKeyDown).
   * Sets enemy HP to 0, triggers GAME_OVER, and lets the normal
   * game-over → reward overlay → return-to-map flow handle the rest.
   */
  _debugWinBattle() {
    if (!this._battleController) return;

    // Only allow if battle is active (not already game over)
    if (this._battleController.state === BattleState.GAME_OVER) return;

    console.log('[BattleScene] DEBUG: Instantly winning battle via K key.');

    // Force enemy HP to 0
    this._battleController.enemyState.hp = 0;

    // Trigger game over check
    this._battleController._checkGameOver();

    // Add log message so it's visible what happened
    if (this._battleController.log) {
      this._battleController.log.add('[DEBUG] Battle force-won via K key.');
    }
  }

  /**
   * Apply post-battle healing to the run state's currentHp.
   * Heals 0% of max effective HP after a battle — HP persists as-is
   * between battles. Healing comes from in-battle skills (e.g. Oungan)
   * and rest-site nodes on the map.
   * @param {object} runState — player run state (mutated in place)
   * @param {object} playerBattleState — player state from the concluded battle
   */
  _applyPostBattleHealing(runState, playerBattleState) {
    if (!runState || !playerBattleState) return;
    const healPct = 0.0;
    const healAmount = Math.floor(playerBattleState.maxHp * healPct);
    if (healAmount > 0) {
      runState.currentHp = Math.min(playerBattleState.maxHp, runState.currentHp + healAmount);
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
