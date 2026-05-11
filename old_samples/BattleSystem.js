/**
 * BattleSystem module.
 * Manages turn order, state machine, event dispatching, and combat flow.
 */

import { Board, BOARD_WIDTH, BOARD_HEIGHT } from './Board.js';
import { MatchResolver } from './MatchResolver.js';
import { Combatant } from './Combatant.js';
import { getClassById } from './data/classes.js';
import { getEnemyById } from './data/enemies.js';
import { getSkillEffect } from './data/skills.js';

/**
 * Battle states for the state machine.
 */
export const BattleState = {
  IDLE: 'IDLE',
  PLAYER_ACTION: 'PLAYER_ACTION',
  BOARD_RESOLVING: 'BOARD_RESOLVING',
  ENEMY_ACTION: 'ENEMY_ACTION',
  GAME_OVER: 'GAME_OVER',
};

/**
 * Simple event bus (pub/sub).
 */
class EventBus {
  constructor() {
    this.listeners = {};
  }

  /**
   * Register a listener for an event.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function.
   */
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  /**
   * Emit an event.
   * @param {string} event
   * @param {Object} data
   */
  emit(event, data = {}) {
    if (this.listeners[event]) {
      for (const callback of this.listeners[event]) {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error in event listener for '${event}':`, e);
        }
      }
    }
  }
}

/**
 * BattleSystem - manages the battle flow, turns, and events.
 */
export class BattleSystem {
  /**
   * @param {string} playerClassId - Class ID (e.g., 'warrior').
   * @param {string} enemyId - Enemy ID (e.g., 'goblin').
   */
  constructor(playerClassId = 'warrior', enemyId = 'goblin') {
    this.eventBus = new EventBus();

    // Create combatants
    const playerClass = getClassById(playerClassId);
    const enemyDef = getEnemyById(enemyId);

    this.player = new Combatant({
      id: playerClass.id,
      name: playerClass.name,
      subtitle: playerClass.subtitle || '',
      side: 'player',
      hp: playerClass.baseHp,
      maxHp: playerClass.maxHp,
      attack: playerClass.attack || 0,
      armor: playerClass.armor || 0,
      portraitUrl: playerClass.portraitUrl || '',
      attackIconUrl: playerClass.attackIconUrl || '',
      armorIconUrl: playerClass.armorIconUrl || '',
      manaPools: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
      skills: playerClass.skills,
    });

    this.enemy = new Combatant({
      id: enemyDef.id,
      name: enemyDef.name,
      subtitle: enemyDef.subtitle || '',
      side: 'enemy',
      hp: enemyDef.baseHp,
      maxHp: enemyDef.maxHp,
      attack: enemyDef.attack || 0,
      armor: enemyDef.armor || 0,
      portraitUrl: enemyDef.portraitUrl || '',
      attackIconUrl: enemyDef.attackIconUrl || '',
      armorIconUrl: enemyDef.armorIconUrl || '',
      manaPools: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
      skills: enemyDef.skills,
    });

    // Create board and resolver
    this.board = new Board(BOARD_WIDTH, BOARD_HEIGHT);
    this.board.initialize();
    this.matchResolver = new MatchResolver(this);

    // State
    this.state = BattleState.IDLE;
    this.currentSide = 'player'; // 'player' or 'enemy'
    this.combatLog = [];
    this.maxLogEntries = 50;

    // Animation state
    this.animating = false;
    this.animationDelay = 300; // ms between cascade steps

    // Extra turn tracking
    this.pendingExtraTurn = false;
  }

  // ---- Event Bus Methods ----

  /**
   * Register event listener.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    return this.eventBus.on(event, callback);
  }

  /**
   * Emit event.
   * @param {string} event
   * @param {Object} data
   */
  emit(event, data) {
    this.eventBus.emit(event, data);
  }

  /**
   * Add a combat log entry.
   * @param {string} message
   */
  addLog(message) {
    this.combatLog.push(message);
    if (this.combatLog.length > this.maxLogEntries) {
      this.combatLog.shift();
    }
    this.emit('combatLog', { message });
  }

  getLog() {
    return [...this.combatLog];
  }

  // ---- State Machine ----

  /**
   * Start the battle.
   */
  start() {
    this.state = BattleState.PLAYER_ACTION;
    this.currentSide = 'player';
    this.addLog('Battle started! Your turn.');
    this.emit('turnStart', { side: 'player' });
  }

  /**
   * Switch to player action state.
   */
  startPlayerTurn() {
    this.state = BattleState.PLAYER_ACTION;
    this.currentSide = 'player';
    this.animating = false;
    this.addLog('--- Your turn ---');
    this.emit('turnStart', { side: 'player' });
  }

  /**
   * Switch to enemy action state.
   */
  startEnemyTurn() {
    this.state = BattleState.ENEMY_ACTION;
    this.currentSide = 'enemy';
    this.animating = false;
    this.addLog(`--- ${this.enemy.name}'s turn ---`);
    this.emit('turnStart', { side: 'enemy' });
  }

  /**
   * Grant an extra turn to the given side.
   * @param {string} side
   */
  grantExtraTurn(side) {
    this.pendingExtraTurn = true;
    this.currentSide = side;
  }

  /**
   * Check if game is over.
   * @returns {boolean}
   */
  checkGameOver() {
    if (!this.player.isAlive()) {
      this.state = BattleState.GAME_OVER;
      this.emit('gameOver', { winner: 'enemy' });
      this.addLog('You have been defeated...');
      return true;
    }
    if (!this.enemy.isAlive()) {
      this.state = BattleState.GAME_OVER;
      this.emit('gameOver', { winner: 'player' });
      this.addLog('Victory! The Goblin has been slain!');
      return true;
    }
    return false;
  }

  // ---- Player Actions ----

  /**
   * Player attempts to swap two tiles.
   * @param {number} col1
   * @param {number} row1
   * @param {number} col2
   * @param {number} row2
   * @returns {boolean} True if the swap was valid and executed.
   */
  playerSwap(col1, row1, col2, row2) {
    if (this.state !== BattleState.PLAYER_ACTION) return false;
    if (!this.board.isAdjacent(col1, row1, col2, row2)) return false;

    const tile1 = this.board.get(col1, row1);
    const tile2 = this.board.get(col2, row2);
    if (!tile1 || !tile2) return false;

    // Perform the swap
    this.board.swap(col1, row1, col2, row2);

    // Check for connected matches (merges overlapping horizontal/vertical runs into shapes)
    const matches = this.board.findAllConnectedMatches();

    if (matches.length === 0) {
      // Invalid swap: swap back
      this.board.swap(col1, row1, col2, row2);
      this.addLog('No match. Swap cancelled.');
      return false;
    }

    // Valid swap: resolve
    this.animating = true;
    this.state = BattleState.BOARD_RESOLVING;
    this.emit('swap', { from: { col: col1, row: row1 }, to: { col: col2, row: row2 } });

    // Resolve matches with async animation timing
    setTimeout(async () => {
      const result = await this.matchResolver.resolve(this.board, this.player, this.enemy);

      if (this.checkGameOver()) return;

      if (result.extraTurn) {
        // Player gets extra turn - reset animating state
        this.animating = false;
        this.state = BattleState.PLAYER_ACTION;
        this.addLog('You get an extra turn!');
        this.emit('turnStart', { side: 'player' });
      } else {
        // Board is settled, end turn
        this.animating = false;
        this.pendingExtraTurn = false;
        this.startEnemyTurn();
      }
    }, this.animationDelay);

    return true;
  }

  /**
   * Player uses a skill.
   * @param {string} skillId
   * @returns {boolean} True if the skill was used.
   */
  playerUseSkill(skillId) {
    if (this.state !== BattleState.PLAYER_ACTION) return false;

    const skillDef = this.player.skills.find(s => s.id === skillId);
    if (!skillDef) return false;
    if (!this.player.canAffordSkill(skillDef)) return false;

    // Spend mana using multi-mana format
    if (skillDef.manaCosts && Array.isArray(skillDef.manaCosts)) {
      this.player.spendManaForSkill(skillDef.manaCosts);
    } else if (skillDef.costColor && skillDef.costAmount !== undefined) {
      // Legacy single-cost format
      this.player.spendMana(skillDef.costColor, skillDef.costAmount);
    }

    // Execute effect
    const effect = getSkillEffect(skillId);
    effect(this.player, this.enemy, this);

    this.emit('skillCast', { side: 'player', skillId });
    this.addLog(`${this.player.name} uses ${skillDef.name}.`);

    // End player turn after skill
    this.pendingExtraTurn = false;
    setTimeout(() => this.startEnemyTurn(), this.animationDelay);

    return true;
  }

  // ---- Enemy Actions ----

  /**
   * Execute the enemy's action (called by Game when in ENEMY_ACTION state).
   * @param {Function} callback - Called when AI action is complete.
   */
  executeEnemyAction(callback) {
    if (this.state !== BattleState.ENEMY_ACTION) {
      callback();
      return;
    }

    // Import EnemyAI lazily to avoid circular dependency issues
    import('./EnemyAI.js').then(({ EnemyAI }) => {
      const ai = new EnemyAI(this.enemy, this.player, this.board, this);

      // First, check if AI wants to use a skill
      const skillChoice = ai.findBestSkill();
      if (skillChoice) {
        const skillDef = this.enemy.skills.find(s => s.id === skillChoice.id);
        // Spend mana using multi-mana format if available
        if (skillDef.manaCosts && Array.isArray(skillDef.manaCosts)) {
          this.enemy.spendManaForSkill(skillDef.manaCosts);
        } else if (skillDef.costColor && skillDef.costAmount !== undefined) {
          // Legacy single-cost format
          this.enemy.spendMana(skillDef.costColor, skillDef.costAmount);
        }
        const effect = getSkillEffect(skillChoice.id);
        effect(this.enemy, this.player, this);
        this.emit('skillCast', { side: 'enemy', skillId: skillChoice.id });
        this.addLog(`${this.enemy.name} uses ${skillDef.name}.`);

        setTimeout(() => {
          this._endEnemyTurn(callback);
        }, this.animationDelay);
        return;
      }

      // AI chooses a swap
      const swapChoice = ai.findBestSwap();
      if (swapChoice) {
        // Perform the swap
        this.board.swap(swapChoice.col1, swapChoice.row1, swapChoice.col2, swapChoice.row2);
        this.animating = true;
        this.state = BattleState.BOARD_RESOLVING;

        // Emit enemy swap event with target tile for visual cursor
        this.emit('enemySwap', {
          from: { col: swapChoice.col1, row: swapChoice.row1 },
          to: { col: swapChoice.col2, row: swapChoice.row2 },
          targetTile: swapChoice.targetTile,
        });

        setTimeout(async () => {
          const result = await this.matchResolver.resolve(this.board, this.enemy, this.player);

          if (this.checkGameOver()) {
            callback();
            return;
          }

          if (result.extraTurn) {
            // AI gets extra turn - reset state back to ENEMY_ACTION
            this.animating = false;
            this.state = BattleState.ENEMY_ACTION;
            this.addLog(`${this.enemy.name} gets an extra turn!`);
            this.emit('turnStart', { side: 'enemy' });
            setTimeout(() => this.executeEnemyAction(callback), this.animationDelay);
          } else {
            this._endEnemyTurn(callback);
          }
        }, this.animationDelay);
        return;
      }

      // No valid move: reshuffle
      this.addLog('Board reshuffled - no valid moves.');
      this.board.reshuffle();
      this._endEnemyTurn(callback);
    });
  }

  /**
   * End the enemy turn and start player's turn.
   * @param {Function} callback
   */
  _endEnemyTurn(callback) {
    // Clear enemy block (expires after enemy action)
    this.enemy.block = 0;

    this.pendingExtraTurn = false;
    setTimeout(() => {
      if (this.checkGameOver()) {
        callback();
        return;
      }
      this.startPlayerTurn();
      callback();
    }, this.animationDelay);
  }

  /**
   * Clear enemy block (called when player attacks).
   */
  clearEnemyBlock() {
    this.enemy.block = 0;
  }

  /**
   * Clear player block (called after enemy action window).
   */
  clearPlayerBlock() {
    this.player.block = 0;
  }

  /**
   * Reset the battle for a new game.
   */
  reset() {
    this.player.reset();
    this.enemy.reset();
    this.board.initialize();
    this.combatLog = [];
    this.pendingExtraTurn = false;
    this.animating = false;
    this.state = BattleState.IDLE;
  }
}
