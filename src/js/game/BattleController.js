/**
 * BattleController — top-level orchestrator for match-3 battle gameplay.
 *
 * State machine:
 *   PLAYER_TURN → RESOLVING → ENEMY_TURN → RESOLVING → PLAYER_TURN ...
 *   PLAYER_TURN → TARGETING → RESOLVING → ...
 *
 * Configurable timing via speedMultiplier (1.0 = normal, 2.0 = fast).
 */

import BoardModel from './BoardModel.js';
import MatchResolver, { SKILL_EFFECT_TYPES } from './MatchResolver.js';
import CombatLog from './CombatLog.js';
import EnemyAI from './EnemyAI.js';
import { TILE_TYPES } from './TileTypes.js';

/** @enum {string} */
export const BattleState = {
  PLAYER_TURN: 'PLAYER_TURN',
  ENEMY_TURN: 'ENEMY_TURN',
  RESOLVING: 'RESOLVING',
  SWAPPING: 'SWAPPING',
  TURN_INTRO: 'TURN_INTRO',
  TARGETING: 'TARGETING',
  GAME_OVER: 'GAME_OVER',
};

const CascadePhase = {
  SHOW_MATCH: 'SHOW_MATCH',
  REMOVE: 'REMOVE',
  FALL: 'FALL',
};

/** Base durations in ms (scaled by speedMultiplier) */
const BASE_PHASE_MS = { SHOW_MATCH: 400, REMOVE: 200, FALL: 350 };
const ENEMY_BASE_DELAY = 400;
const SWAP_BASE_DURATION = 120;
/** Turn intro animation delay in ms (NOT scaled — presentation timing) */
const TURN_INTRO_DURATION = 600;

export default class BattleController {
  constructor(playerData, enemyData) {
    this.board = new BoardModel();
    this.resolver = new MatchResolver();
    this.log = new CombatLog();

    this.playerState = this._cloneState(playerData);
    this.enemyState = this._cloneState(enemyData);

    this.enemyAI = null;

    /** @type {BattleState} */
    this.state = BattleState.TURN_INTRO;
    this.pendingExtraTurn = false;
    this.activeSide = 'player';

    /** Set when entering TURN_INTRO so the scene spawns an announcement effect.
     *  'player' | 'enemy' | null — read & cleared by getState(). */
    this._turnAnnouncement = 'player';
    /** Persists the target side through the intro so _completeTurnIntro
     *  can transition correctly even after the scene clears _turnAnnouncement.
     *  'player' | 'enemy' | null — NOT cleared by getState(). */
    this._nextTurnSide = 'player';
    /** Timer for TURN_INTRO delay before transitioning to the actual turn. */
    this._turnIntroTimer = 0;

    /**
     * Board position (col, row) of the swap that triggered the current
     * resolution cascade. Used as origin for extra-turn visual effects.
     * @type {{col:number, row:number}|null}
     */
    this._swapTriggerPos = null;

    /**
     * Set when a 4+ match is found during resolution. The scene
     * reads and clears this each frame to spawn visual effects.
     * Updated for every cascade step that contains a 4+ match.
     * @type {{col:number, row:number}|null}
     */
    this.extraTurnTriggerPos = null;

    /**
     * Accumulated per-match floating text triggers for the current
     * cascade step. Each entry: { typeId, count, position: {col, row} }.
     * The scene reads and clears this each frame to spawn "+3"/"+4"/etc
     * floating text effects for every match found.
     * Updated for every cascade step.
     * @type {Array<{typeId:string, count:number, position:{col:number, row:number}}>}
     */
    this._matchTextTriggers = [];

    /**
     * Speed multiplier for all animation timing.
     * 1.0 = normal, 2.0 = fast, 0.5 = slow.
     * Scales phase durations, enemy delay, and swap duration.
     */
    this.speedMultiplier = 1.5;

    // ── Cascade step-by-step ──
    this._cascadePhase = null;
    this._phaseTimer = 0;
    /** @type {import('./MatchResolver.js').MatchAnalysis|null} */
    this._analysis = null;
    this._allSteps = [];
    this._extraTurnEarned = false;

    /**
     * Positions that were empty (removed) in the previous cascade step.
     * Saved before gravity so we can compute the "cause" position for
     * cascade 4+ match effects by intersecting with new match positions.
     * @type {Array<{col:number, row:number}>|null}
     */
    this._previousEmptyCells = null;

    // ── Visual state (exposed for BoardPlaceholder) ──
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];

    // ── Swap animation ──
    /** @type {{from:{col:number,row:number},to:{col:number,row:number},progress:number,duration:number,valid:boolean}|null} */
    this.swapAnim = null;

    // ── Targeting state (for skills like Explode!) ──
    /** @type {object|null} skill being targeted (copy of skill def) */
    this._targetingSkill = null;
    /** @type {{col:number, row:number}|null} hovered cell during targeting */
    this._targetHoverCell = null;
    /** @type {Array<{col:number, row:number}>} cells in targeting overlay */
    this._targetingOverlayCells = [];

    /** @type {Array<{col:number, row:number}>} tiles destroyed by skill (for REMOVE phase visual) */
    this._skillDestroyedPositions = [];

    /**
     * Tiles destroyed in the current cascade step. Captured BEFORE
     * removeTiles() so the scene can spawn matching-color particle bursts.
     * Each entry: { col, row, typeId }.
     * Read & cleared by BattleScene via getState().
     * @type {Array<{col:number, row:number, typeId:string}>|null}
     */
    this._destroyedTilesThisStep = null;

    /**
     * Tiles converted by a CREATE_TILES skill effect.
     * Each entry: { col, row, typeId } where typeId is the new tile type.
     * Read & cleared by BattleScene via getState() so it can spawn
     * a conversion shimmer effect on each converted tile.
     * @type {Array<{col:number, row:number, typeId:string}>|null}
     */
    this._convertedTilePositions = null;

    /**
     * Pending screen-shake intensity (0-1). Set when damage is dealt,
     * read & cleared by BattleScene each frame via getState().
     * @type {number}
     */
    this._pendingShakeIntensity = 0;

    /**
     * Counter for skull damage events during resolution. The scene
     * reads and clears this each frame to play skull_damage SFX.
     * Using a counter instead of a boolean so rapid cascade events
     * are not lost between getState() calls.
     * @type {number}
     */
    this._skullDamageCount = 0;

    /**
     * Pending skill resolve sound key. Set when a skill actually resolves
     * (not on button click). The scene reads and clears this each frame.
     * If the skill has no `sound` field, remains null (no error).
     * @type {string|null}
     */
    this._pendingSkillSound = null;

    // ── Enemy turn ──
    this._enemyTimer = 0;
    this._enemyFired = false;

    // ── Callbacks ──
    this.onStateChange = null;

    // ── Init ──
    this.board.initialize();
    this.log.add('Battle begins! Your turn.');
  }

  _cloneState(d) {
    return {
      name: d.name, className: d.className, level: d.level,
      hp: d.hp, maxHp: d.maxHp, attack: d.attack, armor: d.armor, block: 0,
      mana: d.mana ? { ...d.mana } : {},
      portrait: d.portrait || '',
      skills: (d.skills || []).map(s => ({ ...s })),
    };
  }

  // ── Timing Helpers ────────────────────────────────────

  _phaseMs(phase) { return BASE_PHASE_MS[phase] / this.speedMultiplier; }
  _enemyDelay()    { return ENEMY_BASE_DELAY / this.speedMultiplier; }
  _swapDuration()  { return SWAP_BASE_DURATION / this.speedMultiplier; }

  // ── Public API ────────────────────────────────────────

  getState() {
    // Capture extraTurnTriggerPos and clear it so scene only
    // spawns one effect per trigger.
    const triggerPos = this.extraTurnTriggerPos;
    this.extraTurnTriggerPos = null;

    // Capture match text triggers and clear so scene spawns once per step.
    const matchTextTriggers = this._matchTextTriggers;
    this._matchTextTriggers = [];

    // Capture shakeIntensity and clear it so scene only
    // triggers one shake per damage event.
    const shakeIntensity = this._pendingShakeIntensity;
    this._pendingShakeIntensity = 0;

    // Capture skull damage count and clear so scene plays SFX.
    const skullDamageDealt = this._skullDamageCount > 0;
    this._skullDamageCount = 0;

    // Capture turn announcement and clear so scene spawns once per intro.
    const turnAnnouncement = this._turnAnnouncement;
    this._turnAnnouncement = null;

    // Capture destroyed tile info and clear so scene spawns
    // particle bursts once per destruction step.
    const destroyedTiles = this._destroyedTilesThisStep;
    this._destroyedTilesThisStep = null;

    // Capture converted tile info and clear so scene spawns
    // conversion shimmer effects once per CREATE_TILES resolution.
    const convertedTiles = this._convertedTilePositions;
    this._convertedTilePositions = null;

    // Capture pending skill resolve sound and clear so scene
    // plays it once per skill resolution.
    const pendingSkillSound = this._pendingSkillSound;
    this._pendingSkillSound = null;

    return {
      state: this.state, activeSide: this.activeSide,
      playerState: this.playerState, enemyState: this.enemyState,
      board: this.board, log: this.log,
      pendingExtraTurn: this.pendingExtraTurn,
      extraTurnTriggerPos: triggerPos,
      matchTextTriggers,
      shakeIntensity,
      skullDamageDealt,
      turnAnnouncement,
      destroyedTiles,
      convertedTiles,
      pendingSkillSound,
      gameOver: this.state === BattleState.GAME_OVER,
      winner: this._winner(),
      highlightCells: this.highlightCells,
      emptyCells: this.emptyCells,
      fallCells: this.fallCells,
      cascadePhase: this._cascadePhase,
      swapAnim: this.swapAnim,
      targetingActive: this.state === BattleState.TARGETING,
      targetingOverlayCells: this._targetingOverlayCells || [],
      targetingSkill: this._targetingSkill,
    };
  }

  getTurnLabel() {
    switch (this.state) {
      case BattleState.PLAYER_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Player Turn';
      case BattleState.ENEMY_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Enemy Turn';
      case BattleState.TURN_INTRO:
        return this._turnAnnouncement === 'player' ? 'Player Turn' : 'Enemy Turn';
      case BattleState.TARGETING:
        return 'Select a board tile...';
      case BattleState.SWAPPING:
        return 'Swapping...';
      case BattleState.RESOLVING:
        return this._cascadePhase === CascadePhase.SHOW_MATCH ? 'Match!'
          : this._cascadePhase === CascadePhase.REMOVE ? 'Clearing...'
          : this._cascadePhase === CascadePhase.FALL ? 'Falling...'
          : 'Resolving Board';
      case BattleState.GAME_OVER:
        return this._winner() === 'player' ? 'Victory!' : 'Defeat';
      default: return '';
    }
  }

  _winner() {
    if (this.playerState.hp <= 0) return 'enemy';
    if (this.enemyState.hp <= 0) return 'player';
    return null;
  }

  // ── Player Actions ────────────────────────────────────

  /**
   * Initiate a swap with animation.
   * The actual logical swap and match check happen after the animation completes.
   */
  tryPlayerSwap(col1, row1, col2, row2) {
    if (this.state !== BattleState.PLAYER_TURN) return false;
    if (!this.board.isAdjacent(col1, row1, col2, row2)) return false;
    if (!this.board.get(col1, row1) || !this.board.get(col2, row2)) return false;

    // Do pre-check: would this swap create a match?
    this.board.swap(col1, row1, col2, row2);
    const analysis = this.resolver.analyzeMatches(this.board, this.playerState);
    const valid = analysis !== null;
    this.board.swap(col1, row1, col2, row2); // revert

    // Start swap animation
    this.state = BattleState.SWAPPING;
    this.swapAnim = {
      from: { col: col1, row: row1 },
      to: { col: col2, row: row2 },
      progress: 0,
      duration: this._swapDuration(),
      valid,
    };

    if (!valid) {
      this.log.add('No match. Swap cancelled.');
    }
    return true;
  }

  tryPlayerSkill(skill) {
    if (this.state !== BattleState.PLAYER_TURN || !skill) return false;
    if (!this._affordable(this.playerState, skill)) {
      this.log.add(`Not enough mana for ${skill.name}.`);
      return false;
    }

    const effectType = skill.effectType || this._inferEffectType(skill);

    // Skills that require board targeting enter TARGETING state first
    if (skill.targeting === 'board_tile') {
      this.state = BattleState.TARGETING;
      this._targetingSkill = { ...skill, effectType };
      this._targetHoverCell = null;
      this._targetingOverlayCells = [];
      this.log.add(`Select a board tile for ${skill.name}...`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }

    // Instant-effect skills: spend cost and apply immediately
    this._spendCost(this.playerState, skill);
    this._applyEffect(skill, 'player', effectType);
    this.log.add(`${this.playerState.name} uses ${skill.name}.`);

    // Record resolve sound for immediate skills
    this._setSkillSound(skill);

    // If _applyEffect entered a cascade (e.g. CREATE_TILES), let it resolve
    if (this.state === BattleState.RESOLVING) return true;

    // Check for game over before proceeding to next turn
    if (this._checkGameOver()) return true;
    this._endTurn('player');
    return true;
  }

  /**
   * Infer the effect type from skill description/name for legacy skills
   * that don't have an explicit effectType field.
   * @param {object} skill
   * @returns {string} SKILL_EFFECT_TYPES value
   */
  _inferEffectType(skill) {
    const desc = (skill.description || '').toLowerCase();
    const name = (skill.name || '').toLowerCase();
    if (desc.includes('gain') || desc.includes('armor') || desc.includes('block')
        || name.includes('defend') || name.includes('shield')) {
      return SKILL_EFFECT_TYPES.ARMOR;
    }
    // Default: damage
    return SKILL_EFFECT_TYPES.DAMAGE;
  }

  /**
   * Enter targeting mode for board-targeted skills.
   * Called when player clicks a skill with targeting: 'board_tile'.
   * @param {object} skill
   */
  enterTargeting(skill) {
    this.state = BattleState.TARGETING;
    this._targetingSkill = { ...skill };
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Update the hovered cell during TARGETING state.
   * Called each frame from main.js mousemove handler.
   * @param {number|null} col
   * @param {number|null} row
   */
  setTargetHover(col, row) {
    if (this.state !== BattleState.TARGETING) return;
    this._targetHoverCell = col != null && row != null ? { col, row } : null;
    this._targetingOverlayCells = this._computeTargetingArea(col, row);
  }

  /**
   * Handle a board tile click during TARGETING state.
   * @param {number} col
   * @param {number} row
   * @returns {boolean} true if targeting was resolved
   */
  tryTargetTile(col, row) {
    if (this.state !== BattleState.TARGETING || !this._targetingSkill) return false;

    const skill = this._targetingSkill;
    const effectType = skill.effectType || SKILL_EFFECT_TYPES.DESTROY_TILES;

    // Spend the cost
    this._spendCost(this.playerState, skill);
    this.log.add(`${this.playerState.name} uses ${skill.name}.`);

    // Compute affected tiles
    const area = this._computeTargetingArea(col, row);

    // Clear targeting state
    this._targetingSkill = null;
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];

    // Record resolve sound for targeted skills
    this._setSkillSound(skill);

    // Execute based on effect type
    if (effectType === SKILL_EFFECT_TYPES.DESTROY_TILES || effectType === SKILL_EFFECT_TYPES.DESTROY_TILES_ROW) {
      this._executeDestroyTiles(area, col, row, skill.name);
    }

    return true;
  }

  /**
   * Cancel board targeting and return to PLAYER_TURN.
   * No skill resolve sound is played — the skill was not executed.
   */
  cancelTargeting() {
    if (this.state !== BattleState.TARGETING) return false;
    this._targetingSkill = null;
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];
    this.state = BattleState.PLAYER_TURN;
    this.log.add('Targeting cancelled.');
    if (this.onStateChange) this.onStateChange();
    return true;
  }

  /**
   * Compute the affected area for a board-targeted skill.
   * Radius 1 = 3x3 area centered on (col, row), clamped to board bounds.
   * @param {number|null} col center column
   * @param {number|null} row center row
   * @returns {Array<{col:number, row:number}>}
   */
  _computeTargetingArea(col, row) {
    if (col == null || row == null) return [];
    const skill = this._targetingSkill;
    if (!skill || !skill.area) return [];

    // Row-based targeting (DESTROY_TILES_ROW): area is a number (1, 3, 5, ...)
    // representing the total number of rows affected centered on the hovered row.
    if (typeof skill.area === 'number') {
      return this._computeRowArea(col, row, skill.area);
    }

    // Radius-based targeting (DESTROY_TILES): area.radius defines a square
    const radius = skill.area.radius || 0;
    const cells = [];
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && c < this.board.cols && r >= 0 && r < this.board.rows) {
          // Only include cells that have a tile
          if (this.board.get(c, r)) {
            cells.push({ col: c, row: r });
          }
        }
      }
    }
    return cells;
  }

  /**
   * Compute the affected tiles for a row-based destruction skill.
   * areaCount rows are affected, centered on centerRow, spanning all columns.
   * @param {number} centerCol - center column (for hover position context, unused for row area)
   * @param {number} centerRow - center row
   * @param {number} areaCount - number of rows to affect (1, 3, 5, ...)
   * @returns {Array<{col:number, row:number}>}
   */
  _computeRowArea(centerCol, centerRow, areaCount) {
    const halfSpan = Math.floor(areaCount / 2);
    const cells = [];
    for (let r = centerRow - halfSpan; r <= centerRow + halfSpan; r++) {
      if (r < 0 || r >= this.board.rows) continue;
      for (let c = 0; c < this.board.cols; c++) {
        if (this.board.get(c, r)) {
          cells.push({ col: c, row: r });
        }
      }
    }
    return cells;
  }

  /**
   * Execute a DESTROY_TILES effect on the given positions.
   * Awards tile rewards (mana/skull damage), removes tiles, then enters
   * the standard board collapse → refill → cascade resolution flow.
   * @param {Array<{col:number, row:number}>} positions
   * @param {number} centerCol - center of explosion (for log message)
   * @param {number} centerRow - center of explosion (for log message)
   */
  _executeDestroyTiles(positions, centerCol, centerRow, skillName = 'Skill') {
    const activeState = this._activeState();
    const targetState = this._opponentState();

    // 1. Compute tile rewards using shared path
    const rewards = this.resolver.resolveDestroyedTileRewards(this.board, positions, activeState);

    // 2. Award mana from colored gems
    for (const [color, count] of Object.entries(rewards.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana from destroyed gems.`);
      }
    }

    // 3. Deal skull damage
    if (rewards.skullDamage > 0) {
      const r = this.resolver.applyDamage(targetState, rewards.skullDamage);
      this.log.add(`Destroyed skulls deal ${r.actualDamage} damage to ${targetState.name}.`);
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      // Check for immediate game over — don't enter cascade if target died
      if (this._checkGameOver()) return;
    }

    // 4. Capture tile types BEFORE removal for particle burst effects
    this._destroyedTilesThisStep = [];
    for (const pos of positions) {
      const typeId = this.board.get(pos.col, pos.row);
      if (typeId) {
        this._destroyedTilesThisStep.push({ col: pos.col, row: pos.row, typeId });
      }
    }

    // 5. Remove tiles from board
    const removedCount = this.board.removeTiles(positions);
    this.log.add(`${removedCount} tiles destroyed by ${skillName}!`);

    // 6. Enter RESOLVING directly at REMOVE phase (skip SHOW_MATCH — no match to highlight)
    this.state = BattleState.RESOLVING;
    this.activeSide = 'player';
    this._allSteps = [];
    this._extraTurnEarned = false;
    this.pendingExtraTurn = false;
    this._matchTextTriggers = [];
    this._previousEmptyCells = null;
    this._swapTriggerPos = null;

    // Create a synthetic analysis entry for _allSteps tracking
    this._analysis = null;
    this._allSteps.push({
      matches: [],
      positions: [...positions],
      mana: rewards.mana,
      skullDamage: rewards.skullDamage,
      extraTurnTrigger: false,
      tilesDestroyed: removedCount,
    });

    // Show empty cells as the REMOVE phase visual
    this.highlightCells = [];
    this.emptyCells = [...positions];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.REMOVE;
    this._phaseTimer = 0;
  }

  /**
   * Execute a CREATE_TILES effect: convert random non-target tiles into
   * the requested type. Does NOT award mana or deal damage.
   * After conversion, checks for matches and enters RESOLVING if any found.
   * @param {object} skill - skill definition with createTiles: { amount, type }
   * @param {string} side - 'player' or 'enemy'
   */
  _executeCreateTiles(skill, side) {
    const createTiles = skill.createTiles;
    if (!createTiles || typeof createTiles.amount !== 'number' || !createTiles.type) {
      console.warn('[CREATE_TILES] Missing or invalid createTiles config on skill:', skill.name);
      return;
    }

    const targetType = createTiles.type;
    const amount = createTiles.amount;

    // Validate the target type exists
    if (!TILE_TYPES[targetType.toUpperCase()]) {
      console.warn(`[CREATE_TILES] Unknown target tile type: "${targetType}". Skipping.`);
      return;
    }

    // 1. Find tiles NOT already of the target type
    const candidates = this.board.getTilesNotOfType(targetType);

    if (candidates.length === 0) {
      this.log.add(`No tiles to convert for ${skill.name} — board is all ${targetType}.`);
      return;
    }

    // 2. Randomly select up to `amount`
    const selected = BoardModel.pickRandomTiles(candidates, amount);

    // 3. Convert the selected tiles
    const convertedCount = this.board.convertTilesToType(selected, targetType);
    this.log.add(`${skill.name} converts ${convertedCount} tiles to ${targetType}.`);

    // 4. Capture converted positions for visual feedback (BEFORE _beginResolving clears highlightCells)
    this._convertedTilePositions = [];
    for (const pos of selected.slice(0, convertedCount)) {
      this._convertedTilePositions.push({ col: pos.col, row: pos.row, typeId: targetType });
    }

    // 5. Check if conversion created any matches
    const activeState = side === 'player' ? this.playerState : this.enemyState;
    const analysis = this.resolver.analyzeMatches(this.board, activeState);
    if (analysis) {
      // Save swap trigger pos for cascade effects; null since no swap occurred
      this._swapTriggerPos = null;
      this._beginResolving(side, analysis);
    }
  }

  // ── Resolution ────────────────────────────────────────

  _beginResolving(side, firstAnalysis) {
    this.state = BattleState.RESOLVING;
    this.activeSide = side;
    this._allSteps = [];
    this._extraTurnEarned = false;
    this.pendingExtraTurn = false;
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._matchTextTriggers = [];
    this._previousEmptyCells = null;

    if (firstAnalysis) {
      // Log initial match
      this.log.add('Match found!');
      this._enterShowMatch(firstAnalysis);
    } else {
      // Try to find first match
      this._finishStep();
    }
  }

  _enterShowMatch(analysis) {
    this._analysis = analysis;
    this._allSteps.push(analysis);
    if (analysis.extraTurnTrigger) {
      this._extraTurnEarned = true;
      // Compute the "cause" position for the 4+ match floating effect.
      // For the initial swap step: _swapTriggerPos was computed by
      // _computeSwapCausePos which finds which swapped tile landed in
      // the 4+ group (handles both click-order scenarios correctly).
      // For cascade steps: find which match position overlaps with
      // the previously-empty cells (the tile that fell into place).
      let causePos = null;
      if (this._previousEmptyCells && this._previousEmptyCells.length > 0) {
        // Cascade step — find overlap between new match and old empty cells
        causePos = this._findCascadeCausePos(analysis, this._previousEmptyCells);
      }
      if (!causePos && this._swapTriggerPos) {
        causePos = { col: this._swapTriggerPos.col, row: this._swapTriggerPos.row };
      }
      // Fallback: use first match position
      if (!causePos && analysis.positions.length > 0) {
        causePos = { col: analysis.positions[0].col, row: analysis.positions[0].row };
      }
      this.extraTurnTriggerPos = causePos;
    }

    // Generate floating text triggers for every match (3+ tiles).
    // Each match gets a "+N" text effect at its first position.
    for (const match of analysis.matches) {
      if (match.positions.length > 0) {
        this._matchTextTriggers.push({
          typeId: match.typeId,
          count: match.count,
          position: { col: match.positions[0].col, row: match.positions[0].row },
        });
      }
    }

    const activeName = this._activeState().name;
    for (const m of analysis.matches) {
      const tn = m.typeId.charAt(0).toUpperCase() + m.typeId.slice(1);
      const sh = m.isShape ? ' (L/T shape)' : '';
      if (m.typeId === 'skull') {
        this.log.add(`Skull match: ${m.count} tiles${sh} — damage incoming!`);
      } else {
        this.log.add(`${tn} match: ${m.count} tiles${sh} — +${m.count} mana.`);
      }
    }

    this.highlightCells = [...analysis.positions];
    this.emptyCells = [];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.SHOW_MATCH;
    this._phaseTimer = 0;
  }

  /**
   * After a swap, determine which of the two swapped positions is part of
   * a 4+ match (the tile that "caused" the extra turn). Falls back to 'to'
   * for non-extra-turn swaps, or the first match position.
   * @param {{col:number, row:number}} from - swap source
   * @param {{col:number, row:number}} to - swap destination
   * @param {import('./MatchResolver.js').MatchAnalysis|null} analysis
   * @returns {{col:number, row:number}|null}
   */
  _computeSwapCausePos(from, to, analysis) {
    if (!analysis) return null;

    // If this step triggers an extra turn (4+ match), find which of the
    // two swapped tiles landed in a 4+ connected group.
    if (analysis.extraTurnTrigger) {
      for (const match of analysis.matches) {
        if (match.count >= 4 || (match.isShape && match.count >= 4)) {
          const matchSet = new Set(match.positions.map(p => `${p.col},${p.row}`));
          // Check 'from' first — the tile originally at 'to' lands here
          if (matchSet.has(`${from.col},${from.row}`)) {
            return { col: from.col, row: from.row };
          }
          // Check 'to' — the tile originally at 'from' lands here
          if (matchSet.has(`${to.col},${to.row}`)) {
            return { col: to.col, row: to.row };
          }
        }
      }
    }

    // Fallback for non-extra-turn matches: use the first position in the
    // analysis that overlaps with either swapped cell.
    const analysisSet = new Set(analysis.positions.map(p => `${p.col},${p.row}`));
    if (analysisSet.has(`${from.col},${from.row}`)) {
      return { col: from.col, row: from.row };
    }
    if (analysisSet.has(`${to.col},${to.row}`)) {
      return { col: to.col, row: to.row };
    }

    // Absolute fallback: first match position
    if (analysis.positions.length > 0) {
      return { col: analysis.positions[0].col, row: analysis.positions[0].row };
    }
    return { col: to.col, row: to.row };
  }

  /**
   * Find a position in the new match that overlaps with the previously
   * empty (removed) cells — this is where a falling tile "caused" the
   * cascade match. Returns null if no overlap found.
   * @param {import('./MatchResolver.js').MatchAnalysis} analysis
   * @param {Array<{col:number, row:number}>} previousEmpty
   * @returns {{col:number, row:number}|null}
   */
  _findCascadeCausePos(analysis, previousEmpty) {
    const prevSet = new Set(previousEmpty.map(p => `${p.col},${p.row}`));
    for (const pos of analysis.positions) {
      if (prevSet.has(`${pos.col},${pos.row}`)) {
        return { col: pos.col, row: pos.row };
      }
    }
    return null;
  }

  _doRemove() {
    const a = this._analysis;
    const activeState = this._activeState();
    const targetState = this._opponentState();

    if (a.skullDamage > 0) {
      const r = this.resolver.applyDamage(targetState, a.skullDamage);
      this.log.add(`Skull damage: ${r.actualDamage} dealt.`);
      // Trigger screen shake scaled by damage % of target's max HP
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      // Check for immediate game over — stop cascade if target died
      if (this._checkGameOver()) return;
    }

    for (const [color, count] of Object.entries(a.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana.`);
      }
    }

    // Capture tile types BEFORE removal so the scene can spawn
    // matching-color particle bursts for every destroyed tile.
    this._destroyedTilesThisStep = [];
    for (const pos of a.positions) {
      const typeId = this.board.get(pos.col, pos.row);
      if (typeId) {
        this._destroyedTilesThisStep.push({ col: pos.col, row: pos.row, typeId });
      }
    }

    this.board.removeTiles(a.positions);
    this.highlightCells = [];
    this.emptyCells = [...a.positions];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.REMOVE;
    this._phaseTimer = 0;
  }

  _doFall() {
    // Save the empty cells before clearing — needed by _enterShowMatch
    // to compute the "cause" position for cascade 4+ match effects.
    this._previousEmptyCells = [...this.emptyCells];

    const preGravityGrid = this.board.grid.map(col => [...col]);
    this.board.applyGravity();
    this.board.refill();
    const animations = this.board.generateFallAnimations(preGravityGrid);

    this.emptyCells = [];
    this.fallCells = animations;
    this._cascadePhase = CascadePhase.FALL;
    this._phaseTimer = 0;
  }

  _finishStep() {
    this.fallCells = [];
    this._cascadePhase = null;

    const next = this.resolver.analyzeMatches(this.board, this._activeState());
    if (next) {
      this._enterShowMatch(next);
    } else {
      this._finishResolving();
    }
  }

  _finishResolving() {
    const totalDestroyed = this._allSteps.reduce((s, a) => s + a.tilesDestroyed, 0);
    if (this._allSteps.length > 0) {
      this.log.add(`${totalDestroyed} tiles destroyed across ${this._allSteps.length} cascade(s).`);
    }

    if (this._extraTurnEarned) {
      this.pendingExtraTurn = true;
      // extraTurnTriggerPos was already set in _enterShowMatch — the
      // scene is already animating the effect concurrently with cascades.
      this.log.add(`${this._activeState().name} gets an extra turn!`);
    }

    this._analysis = null;
    this._allSteps = [];
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._previousEmptyCells = null;

    if (this._checkGameOver()) return;

    if (this.pendingExtraTurn) {
      this._phaseTimer = 0;
      this._enemyFired = false;
      if (this.activeSide === 'player') {
        this.state = BattleState.PLAYER_TURN;
        this.log.add('--- Extra Turn (Player) ---');
      } else {
        this.state = BattleState.ENEMY_TURN;
        this._enemyTimer = 0;
        this.log.add('--- Extra Turn (Enemy) ---');
      }
    } else {
      this._endTurn(this.activeSide);
    }
    if (this.onStateChange) this.onStateChange();
  }

  _endTurn(side) {
    this.pendingExtraTurn = false;
    this._swapTriggerPos = null;
    // Enter turn-intro animation before the actual turn begins.
    // The scene reads _turnAnnouncement to spawn the appropriate
    // floating image effect (Player Turn / Enemy Turn).
    const nextSide = side === 'player' ? 'enemy' : 'player';
    this.state = BattleState.TURN_INTRO;
    this._turnAnnouncement = nextSide;
    this._nextTurnSide = nextSide;
    this._turnIntroTimer = 0;
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Called when the TURN_INTRO delay expires. Transitions to the
   * actual turn state (PLAYER_TURN or ENEMY_TURN).
   */
  _completeTurnIntro() {
    // Use _nextTurnSide which persists through getState() clearing
    const side = (this._nextTurnSide === 'player' || this._nextTurnSide === 'enemy')
      ? this._nextTurnSide : 'player';

    this.log.nextTurn();
    if (side === 'enemy') {
      this.state = BattleState.ENEMY_TURN;
      this.activeSide = 'enemy';
      this._enemyTimer = 0;
      this._enemyFired = false;
      this.log.add(`--- ${this.enemyState.name}'s Turn ---`);
    } else {
      this.enemyState.block = 0;
      this.playerState.block = 0;
      this.state = BattleState.PLAYER_TURN;
      this.activeSide = 'player';
      this.log.add('--- Your Turn ---');
    }
    if (this.onStateChange) this.onStateChange();
  }

  _activeState() {
    return this.activeSide === 'player' ? this.playerState : this.enemyState;
  }
  _opponentState() {
    return this.activeSide === 'player' ? this.enemyState : this.playerState;
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    // ── Swap animation ──
    if (this.state === BattleState.SWAPPING && this.swapAnim) {
      this.swapAnim.progress += dt / this.swapAnim.duration;
      if (this.swapAnim.progress >= 1) {
        this.swapAnim.progress = 1;
        // Perform the logical swap
        const { from, to, valid } = this.swapAnim;
        this.board.swap(from.col, from.row, to.col, to.row);
        this.swapAnim = null;

        if (valid) {
          const analysis = this.resolver.analyzeMatches(this.board, this.playerState);
          // Determine which swapped position caused the 4+ match
          this._swapTriggerPos = this._computeSwapCausePos(from, to, analysis);
          this._beginResolving('player', analysis);
        } else {
          // Revert after animation
          this.board.swap(from.col, from.row, to.col, to.row);
          this._swapTriggerPos = null;
          this.state = BattleState.PLAYER_TURN;
        }
      }
      return; // Don't process other states during swap animation
    }

    // ── Cascade sub-phases ──
    if (this.state === BattleState.RESOLVING && this._cascadePhase) {
      this._phaseTimer += dt;
      const phaseMs = this._phaseMs(this._cascadePhase);

      if (this._cascadePhase === CascadePhase.SHOW_MATCH && this._phaseTimer >= phaseMs) {
        this._doRemove();
      } else if (this._cascadePhase === CascadePhase.REMOVE && this._phaseTimer >= phaseMs) {
        this._doFall();
      } else if (this._cascadePhase === CascadePhase.FALL && this._phaseTimer >= phaseMs) {
        this._finishStep();
      }
    }

    // ── Turn intro delay ──
    if (this.state === BattleState.TURN_INTRO) {
      this._turnIntroTimer += dt;
      if (this._turnIntroTimer >= TURN_INTRO_DURATION) {
        this._completeTurnIntro();
      }
    }

    // ── Enemy turn delay ──
    if (this.state === BattleState.ENEMY_TURN && !this._enemyFired) {
      this._enemyTimer += dt;
      if (this._enemyTimer >= this._enemyDelay()) {
        this._enemyFired = true;
        this._doEnemyTurn();
      }
    }
  }

  // ── Enemy ─────────────────────────────────────────────

  _doEnemyTurn() {
    this.enemyAI = new EnemyAI(this.enemyState, this.playerState);

    const skill = this.enemyAI.findBestSkill();
    if (skill) {
      this._spendCost(this.enemyState, skill);
      this._applyEffect(skill, 'enemy');
      this.log.add(`${this.enemyState.name} uses ${skill.name}.`);

      // Record resolve sound for enemy skills
      this._setSkillSound(skill);

      // If _applyEffect entered a cascade (e.g. CREATE_TILES), let it resolve
      if (this.state === BattleState.RESOLVING) return;

      // Check for game over before proceeding to next turn
      if (this._checkGameOver()) return;
      this._endTurn('enemy');
      return;
    }

    const swap = this.enemyAI.findBestSwap(this.board);
    if (swap) {
      this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
      this.log.add(`${this.enemyState.name} swaps tiles.`);
      const analysis = this.resolver.analyzeMatches(this.board, this.enemyState);
      if (analysis) {
        // Determine which swapped position caused the 4+ match
        const from = { col: swap.col1, row: swap.row1 };
        const to = { col: swap.col2, row: swap.row2 };
        this._swapTriggerPos = this._computeSwapCausePos(from, to, analysis);
        this._beginResolving('enemy', analysis);
      } else {
        this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
        this._swapTriggerPos = null;
        this.log.add('No valid match. Board reshuffled.');
        this.board.reshuffle();
        this._endTurn('enemy');
      }
      return;
    }

    this.log.add('No valid moves. Board reshuffled.');
    this.board.reshuffle();
    this._endTurn('enemy');
  }

  // ── Skill Helpers ────────────────────────────────────

  /**
   * Record the skill's resolve sound key so the scene can play it.
   * Safe to call with any skill — if skill.sound is missing, this is a no-op.
   * @param {object} skill
   */
  _setSkillSound(skill) {
    if (skill && typeof skill.sound === 'string' && skill.sound.length > 0) {
      this._pendingSkillSound = skill.sound;
    }
  }

  _affordable(state, skill) {
    if (!skill.cost) return true;
    for (const [c, a] of Object.entries(skill.cost)) {
      if ((state.mana[c] || 0) < a) return false;
    }
    return true;
  }
  _spendCost(state, skill) {
    if (!skill.cost) return;
    for (const [c, a] of Object.entries(skill.cost)) {
      state.mana[c] = Math.max(0, (state.mana[c] || 0) - a);
    }
  }
  _applyEffect(skill, side, effectType) {
    const src = side === 'player' ? this.playerState : this.enemyState;
    const tgt = side === 'player' ? this.enemyState : this.playerState;

    // Determine effect type: explicit param → skill field → inference
    const type = effectType || skill.effectType || this._inferEffectType(skill);

    switch (type) {
      case SKILL_EFFECT_TYPES.ARMOR: {
        // Extract numeric value from description (e.g. "Gain 5 armor" → 5)
        let amount = src.attack || 1;
        const numMatch = skill.description && skill.description.match(/(\d+)/);
        if (numMatch) {
          amount = parseInt(numMatch[1], 10);
        }
        src.armor += amount;
        this.log.add(`${src.name} gains ${amount} armor.`);
        break;
      }

      case SKILL_EFFECT_TYPES.CREATE_TILES:
        this._executeCreateTiles(skill, side);
        break;

      case SKILL_EFFECT_TYPES.HEAL: {
        const healAmount = (skill.heal && typeof skill.heal.amount === 'number')
          ? skill.heal.amount
          : 0;
        if (healAmount <= 0) {
          this.log.add(`${skill.name} has no heal amount configured.`);
          break;
        }
        const beforeHp = src.hp;
        src.hp = Math.min(src.maxHp, src.hp + healAmount);
        const actualHeal = src.hp - beforeHp;
        this.log.add(`${src.name} heals for ${actualHeal} HP.`);
        break;
      }

      case SKILL_EFFECT_TYPES.DAMAGE:
      default: {
        // Extract numeric value from description (e.g. "Deal 5 damage" → 5)
        // Falls back to the source's attack stat if no number found.
        let baseAmount = src.attack || 1;
        const numMatch = skill.description && skill.description.match(/(\d+)/);
        if (numMatch) {
          baseAmount = parseInt(numMatch[1], 10);
        }
        const r = this.resolver.applyDamage(tgt, baseAmount);
        this.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
        // Trigger screen shake scaled by damage % of target's max HP
        this._setShakeFromDamage(r.actualDamage, tgt.maxHp);
        break;
      }
    }
  }

  // ── Game Over ────────────────────────────────────────

  _checkGameOver() {
    if (this.playerState.hp <= 0) {
      this.state = BattleState.GAME_OVER;
      this.log.add(`${this.playerState.name} has been defeated...`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    if (this.enemyState.hp <= 0) {
      this.state = BattleState.GAME_OVER;
      this.log.add(`Victory! ${this.enemyState.name} has been slain!`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    return false;
  }

  // ── Screen Shake ──────────────────────────────────────

  /**
   * Compute screen-shake intensity from damage dealt and set the
   * pending shake value. Scales linearly from 0 at 0% to 1.0 at
   * 20%+ of the target's max HP.
   * @param {number} actualDamage
   * @param {number} targetMaxHp
   */
  _setShakeFromDamage(actualDamage, targetMaxHp) {
    if (!targetMaxHp || actualDamage <= 0) return;
    const percent = actualDamage / targetMaxHp;
    const intensity = Math.min(1.0, percent / 0.20);
    // Keep the highest intensity if multiple damage events occur
    // before the scene reads it.
    if (intensity > this._pendingShakeIntensity) {
      this._pendingShakeIntensity = intensity;
    }
  }

  // ── Board Position ────────────────────────────────────

  screenToBoard(px, py, boardW, boardH) {
    const cw = boardW / this.board.cols;
    const ch = boardH / this.board.rows;
    const col = Math.floor(px / cw);
    const row = Math.floor(py / ch);
    if (col < 0 || col >= this.board.cols || row < 0 || row >= this.board.rows) return null;
    return { col, row };
  }
}
