/**
 * EnemyAI — simple enemy decision-making.
 *
 * Evaluates possible swaps on a cloned board and picks the best move.
 * Priority: skull matches > mana for own skills > larger matches > any valid.
 *
 * Also checks if enemy can use a skill before making a board move.
 */

import { isSkull } from './TileTypes.js';

export default class EnemyAI {
  /**
   * @param {object} enemyState - { mana: {...}, skills: [...], ... }
   * @param {object} playerState  - { skills: [...], ... } (for contesting)
   */
  constructor(enemyState, playerState) {
    this.enemyState = enemyState;
    this.playerState = playerState;

    // Analyze which mana colors the enemy's skills need
    this.enemySkillColors = {};
    for (const skill of (enemyState.skills || [])) {
      if (skill.cost) {
        for (const color of Object.keys(skill.cost)) {
          this.enemySkillColors[color] = (this.enemySkillColors[color] || 0)
            + (skill.cost[color] || 0);
        }
      }
    }

    // Analyze which mana colors the player's skills need (for contesting)
    this.playerSkillColors = {};
    for (const skill of (playerState.skills || [])) {
      if (skill.cost) {
        for (const color of Object.keys(skill.cost)) {
          this.playerSkillColors[color] = (this.playerSkillColors[color] || 0)
            + (skill.cost[color] || 0);
        }
      }
    }
  }

  /**
   * Check if the enemy can afford any skill right now.
   * @returns {object|null} skill definition or null
   */
  findBestSkill() {
    for (const skill of (this.enemyState.skills || [])) {
      if (this._canAfford(skill)) {
        return skill;
      }
    }
    return null;
  }

  /**
   * Find the best swap for the enemy.
   * @param {import('./BoardModel.js').default} board
   * @returns {object|null} { col1, row1, col2, row2 } or null
   */
  findBestSwap(board) {
    const swaps = board.getValidSwaps();
    if (swaps.length === 0) return null;

    let bestSwap = null;
    let bestScore = -Infinity;

    for (const sw of swaps) {
      const clone = board.clone();
      clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);

      const score = this._scoreBoard(clone);

      if (score > bestScore) {
        bestScore = score;
        bestSwap = sw;
      }
    }

    return bestSwap;
  }

  /** @private */
  _canAfford(skill) {
    if (!skill.cost) return true;
    const mana = this.enemyState.mana || {};
    for (const [color, amount] of Object.entries(skill.cost)) {
      if ((mana[color] || 0) < amount) return false;
    }
    return true;
  }

  /**
   * Score a board state after a simulated swap.
   * Higher score = better for the enemy.
   * @param {import('./BoardModel.js').default} board
   * @returns {number}
   * @private
   */
  _scoreBoard(board) {
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return -1;

    let score = 0;
    let hasExtraTurn = false;
    const enemySkillManaGained = {};

    // Track mana relevant to enemy skills
    for (const color of Object.keys(this.enemySkillColors)) {
      enemySkillManaGained[color] = 0;
    }

    for (const match of matches) {
      const count = match.count;

      if (isSkull(match.typeId)) {
        // Skull matches deal damage — very good
        const damage = Math.min(count, 25);
        score += damage * 35;
        if (count >= 5) hasExtraTurn = true;
      } else {
        // Mana tiles
        score += count * 8;

        // Mana for enemy's own skills is extra valuable
        if (enemySkillManaGained[match.typeId] !== undefined) {
          enemySkillManaGained[match.typeId] += count;
          score += count * 20;
        }

        // Contesting player's skill colors
        if (this.playerSkillColors[match.typeId]) {
          score += count * 10;
        }

        if (count >= 5) hasExtraTurn = true;
      }

      // Shape bonus (L/T/cross)
      if (match.isShape) {
        score += 30;
      }
    }

    // Bonus for being able to use a skill after this match
    for (const skill of (this.enemyState.skills || [])) {
      if (!skill.cost) continue;
      let canAfford = true;
      for (const [color, amount] of Object.entries(skill.cost)) {
        const current = this.enemyState.mana[color] || 0;
        const gained = enemySkillManaGained[color] || 0;
        if (current + gained < amount) {
          canAfford = false;
          break;
        }
      }
      if (canAfford) score += 250;
    }

    if (hasExtraTurn) score += 500;

    // Total tile count bonus
    const totalTiles = matches.reduce((s, m) => s + m.count, 0);
    if (totalTiles >= 5) score += 50;
    if (totalTiles >= 8) score += 100;

    return score;
  }
}
