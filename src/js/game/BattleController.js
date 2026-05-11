/**
 * BattleController — top-level orchestrator for match-3 battle gameplay.
 *
 * State machine:
 *   PLAYER_TURN → RESOLVING → ENEMY_TURN → RESOLVING → PLAYER_TURN ...
 *
 * Configurable timing via speedMultiplier (1.0 = normal, 2.0 = fast).
 */

import BoardModel from './BoardModel.js';
import MatchResolver from './MatchResolver.js';
import CombatLog from './CombatLog.js';
import EnemyAI from './EnemyAI.js';

/** @enum {string} */
export const BattleState = {
  PLAYER_TURN: 'PLAYER_TURN',
  ENEMY_TURN: 'ENEMY_TURN',
  RESOLVING: 'RESOLVING',
  SWAPPING: 'SWAPPING',
  TURN_INTRO: 'TURN_INTRO',
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

    /**
     * Pending screen-shake intensity (0-1). Set when damage is dealt,
     * read & cleared by BattleScene each frame via getState().
     * @type {number}
     */
    this._pendingShakeIntensity = 0;

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

    // Capture turn announcement and clear so scene spawns once per intro.
    const turnAnnouncement = this._turnAnnouncement;
    this._turnAnnouncement = null;

    return {
      state: this.state, activeSide: this.activeSide,
      playerState: this.playerState, enemyState: this.enemyState,
      board: this.board, log: this.log,
      pendingExtraTurn: this.pendingExtraTurn,
      extraTurnTriggerPos: triggerPos,
      matchTextTriggers,
      shakeIntensity,
      turnAnnouncement,
      gameOver: this.state === BattleState.GAME_OVER,
      winner: this._winner(),
      highlightCells: this.highlightCells,
      emptyCells: this.emptyCells,
      fallCells: this.fallCells,
      cascadePhase: this._cascadePhase,
      swapAnim: this.swapAnim,
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
    const analysis = this.resolver.analyzeMatches(this.board);
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
    this._spendCost(this.playerState, skill);
    this._applyEffect(skill, 'player');
    this.log.add(`${this.playerState.name} uses ${skill.name}.`);
    this._endTurn('player');
    return true;
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
    }

    for (const [color, count] of Object.entries(a.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana.`);
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

    const next = this.resolver.analyzeMatches(this.board);
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
          const analysis = this.resolver.analyzeMatches(this.board);
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
      this._endTurn('enemy');
      return;
    }

    const swap = this.enemyAI.findBestSwap(this.board);
    if (swap) {
      this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
      this.log.add(`${this.enemyState.name} swaps tiles.`);
      const analysis = this.resolver.analyzeMatches(this.board);
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
  _applyEffect(skill, side) {
    const src = side === 'player' ? this.playerState : this.enemyState;
    const tgt = side === 'player' ? this.enemyState : this.playerState;
    const name = (skill.name || '').toLowerCase();
    const desc = (skill.description || '').toLowerCase();

    // Extract numeric value from description (e.g. "Deal 5 damage" → 5)
    // Falls back to the source's attack stat if no number found.
    let baseAmount = src.attack || 1;
    const numMatch = skill.description && skill.description.match(/(\d+)/);
    if (numMatch) {
      baseAmount = parseInt(numMatch[1], 10);
    }

    if (desc.includes('gain') || desc.includes('armor') || desc.includes('block')
        || name.includes('defend') || name.includes('shield')) {
      src.armor += baseAmount;
      this.log.add(`${src.name} gains ${baseAmount} armor.`);
    } else if (desc.includes('damage') || name.includes('bash') || name.includes('slash')) {
      const r = this.resolver.applyDamage(tgt, baseAmount);
      this.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
      // Trigger screen shake scaled by damage % of target's max HP
      this._setShakeFromDamage(r.actualDamage, tgt.maxHp);
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
