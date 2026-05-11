/**
 * BattleController — top-level orchestrator for match-3 battle gameplay.
 *
 * State machine:
 *   PLAYER_TURN → RESOLVING → ENEMY_TURN → RESOLVING → PLAYER_TURN ...
 *
 * Cascade sub-phases (RESOLVING state):
 *   SHOW_MATCH (400ms) → REMOVE (200ms) → FALL (350ms) → next step or finish
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
  GAME_OVER: 'GAME_OVER',
};

const CascadePhase = {
  SHOW_MATCH: 'SHOW_MATCH',
  REMOVE: 'REMOVE',
  FALL: 'FALL',
};

const PHASE_MS = { SHOW_MATCH: 400, REMOVE: 200, FALL: 350 };
const ENEMY_DELAY_MS = 400;

export default class BattleController {
  constructor(playerData, enemyData) {
    this.board = new BoardModel();
    this.resolver = new MatchResolver();
    this.log = new CombatLog();

    this.playerState = this._cloneState(playerData);
    this.enemyState = this._cloneState(enemyData);

    this.enemyAI = null;

    /** @type {BattleState} */
    this.state = BattleState.PLAYER_TURN;
    this.pendingExtraTurn = false;
    this.activeSide = 'player';

    // Cascade step-by-step
    /** @type {string|null} */
    this._cascadePhase = null;
    this._phaseTimer = 0;
    /** @type {import('./MatchResolver.js').MatchAnalysis|null} */
    this._analysis = null;
    this._allSteps = [];
    this._extraTurnEarned = false;

    // Visual state for BoardPlaceholder
    /** @type {Array<{col:number, row:number}>} */
    this.highlightCells = [];
    /** @type {Array<{col:number, row:number}>} */
    this.emptyCells = [];
    /** @type {Array<{col:number, row:number, startRow:number, startCol:number}>} */
    this.fallCells = [];

    // Enemy turn
    this._enemyTimer = 0;
    this._enemyFired = false;

    // Callbacks
    this.onStateChange = null;

    // Init
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

  // ── Public API ────────────────────────────────────────

  getState() {
    return {
      state: this.state, activeSide: this.activeSide,
      playerState: this.playerState, enemyState: this.enemyState,
      board: this.board, log: this.log,
      pendingExtraTurn: this.pendingExtraTurn,
      gameOver: this.state === BattleState.GAME_OVER,
      winner: this._winner(),
      highlightCells: this.highlightCells,
      emptyCells: this.emptyCells,
      fallCells: this.fallCells,
      cascadePhase: this._cascadePhase,
    };
  }

  getTurnLabel() {
    switch (this.state) {
      case BattleState.PLAYER_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Player Turn';
      case BattleState.ENEMY_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Enemy Turn';
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

  tryPlayerSwap(col1, row1, col2, row2) {
    if (this.state !== BattleState.PLAYER_TURN) return false;
    if (!this.board.isAdjacent(col1, row1, col2, row2)) return false;
    if (!this.board.get(col1, row1) || !this.board.get(col2, row2)) return false;

    this.board.swap(col1, row1, col2, row2);

    const analysis = this.resolver.analyzeMatches(this.board);
    if (!analysis) {
      this.board.swap(col1, row1, col2, row2);
      this.log.add('No match. Swap cancelled.');
      return false;
    }

    this.log.add('Match found!');
    this._beginResolving('player', analysis);
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

  /** @private */
  _beginResolving(side, firstAnalysis) {
    this.state = BattleState.RESOLVING;
    this.activeSide = side;
    this._allSteps = [];
    this._extraTurnEarned = false;
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];

    this._enterShowMatch(firstAnalysis);
  }

  /** @private Enter SHOW_MATCH phase with analysis result */
  _enterShowMatch(analysis) {
    this._analysis = analysis;
    this._allSteps.push(analysis);

    if (analysis.extraTurnTrigger) this._extraTurnEarned = true;

    // Log matches
    const activeName = this._activeState().name;
    for (const m of analysis.matches) {
      const tn = m.typeId.charAt(0).toUpperCase() + m.typeId.slice(1);
      const sh = m.isShape ? ' (L/T shape)' : '';
      if (m.typeId === 'skull') {
        this.log.add(`Skull match: ${m.count} tiles${sh} — ${analysis.skullDamage} damage incoming!`);
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

  /** @private Apply rewards (mana + skull damage) and remove tiles */
  _doRemove() {
    const a = this._analysis;
    const activeState = this._activeState();
    const targetState = this._opponentState();

    // Apply skull damage
    if (a.skullDamage > 0) {
      const r = this.resolver.applyDamage(targetState, a.skullDamage);
      this.log.add(`Skull damage: ${r.actualDamage} dealt.`);
    }

    // Apply mana
    for (const [color, count] of Object.entries(a.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana.`);
      }
    }

    // Remove tiles from board
    this.board.removeTiles(a.positions);

    this.highlightCells = [];
    this.emptyCells = [...a.positions];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.REMOVE;
    this._phaseTimer = 0;
  }

  /** @private Apply gravity, refill, capture fall data */
  _doFall() {
    // Snapshot before gravity
    const preGravityGrid = this.board.grid.map(col => [...col]);

    this.board.applyGravity();
    this.board.refill();

    const animations = this.board.generateFallAnimations(preGravityGrid);

    this.emptyCells = [];
    this.fallCells = animations;
    this._cascadePhase = CascadePhase.FALL;
    this._phaseTimer = 0;
  }

  /** @private Check for next cascade or finish */
  _finishStep() {
    this.fallCells = [];
    this._cascadePhase = null;

    // Try next cascade
    const next = this.resolver.analyzeMatches(this.board);
    if (next) {
      this._enterShowMatch(next);
    } else {
      this._finishResolving();
    }
  }

  /** @private */
  _finishResolving() {
    const totalDestroyed = this._allSteps.reduce((s, a) => s + a.tilesDestroyed, 0);
    if (this._allSteps.length > 0) {
      this.log.add(`${totalDestroyed} tiles destroyed across ${this._allSteps.length} cascade(s).`);
    }

    if (this._extraTurnEarned) {
      this.pendingExtraTurn = true;
      this.log.add(`${this._activeState().name} gets an extra turn!`);
    }

    this._analysis = null;
    this._allSteps = [];
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];

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

  /** @private */
  _endTurn(side) {
    this.pendingExtraTurn = false;
    this.log.nextTurn();
    if (side === 'player') {
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
    // Cascade sub-phases
    if (this.state === BattleState.RESOLVING && this._cascadePhase) {
      this._phaseTimer += dt;

      if (this._cascadePhase === CascadePhase.SHOW_MATCH && this._phaseTimer >= PHASE_MS.SHOW_MATCH) {
        this._doRemove();
      } else if (this._cascadePhase === CascadePhase.REMOVE && this._phaseTimer >= PHASE_MS.REMOVE) {
        this._doFall();
      } else if (this._cascadePhase === CascadePhase.FALL && this._phaseTimer >= PHASE_MS.FALL) {
        this._finishStep();
      }
    }

    // Enemy turn delay
    if (this.state === BattleState.ENEMY_TURN && !this._enemyFired) {
      this._enemyTimer += dt;
      if (this._enemyTimer >= ENEMY_DELAY_MS) {
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
        this._beginResolving('enemy', analysis);
      } else {
        // Shouldn't happen if AI picked a valid swap, but handle gracefully
        this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
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

    if (desc.includes('gain') || desc.includes('armor') || desc.includes('block')
        || name.includes('defend') || name.includes('shield')) {
      src.armor += 5;
      this.log.add(`${src.name} gains 5 armor.`);
    } else if (desc.includes('damage') || name.includes('bash') || name.includes('slash')) {
      const r = this.resolver.applyDamage(tgt, 5);
      this.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
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
