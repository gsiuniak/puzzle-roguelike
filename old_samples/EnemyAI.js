/**
 * EnemyAI module.
 * Evaluates possible moves and chooses the best action for the enemy.
 */

import { isSkull } from './Tile.js';

/**
 * EnemyAI evaluates board state and chooses the best action.
 */
export class EnemyAI {
  /**
   * @param {import('./Combatant.js').Combatant} enemy - The enemy combatant.
   * @param {import('./Combatant.js').Combatant} player - The player combatant.
   * @param {import('./Board.js').Board} board - The game board.
   * @param {import('./BattleSystem.js').BattleSystem} battleSystem - The battle system.
   */
  constructor(enemy, player, board, battleSystem) {
    this.enemy = enemy;
    this.player = player;
    this.board = board;
    this.battleSystem = battleSystem;

    // Analyze player's skill costs to determine which colors to contest
    this._analyzePlayerSkills();
  }

  /**
   * Analyze player skills to determine which mana colors are most valuable to them.
   * @private
   */
  _analyzePlayerSkills() {
    this.playerColorValues = {}; // { color: totalCost }
    this.playerSkills = this.player.getSkills();

    for (const skill of this.playerSkills) {
      // Support multi-mana format (manaCosts array) and legacy format
      if (skill.manaCosts && Array.isArray(skill.manaCosts)) {
        for (const cost of skill.manaCosts) {
          if (!this.playerColorValues[cost.color]) {
            this.playerColorValues[cost.color] = 0;
          }
          this.playerColorValues[cost.color] += cost.amount;
        }
      } else if (skill.costColor) {
        // Legacy single-cost format
        if (!this.playerColorValues[skill.costColor]) {
          this.playerColorValues[skill.costColor] = 0;
        }
        this.playerColorValues[skill.costColor] += skill.costAmount || 0;
      }
    }

    // Sort colors by total cost (most valuable first)
    this.playerColorPriority = Object.entries(this.playerColorValues)
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);
  }

  /**
   * Find the best skill the enemy can afford.
   * @returns {Object|null} Skill definition or null.
   */
  findBestSkill() {
    for (const skill of this.enemy.skills) {
      if (this.enemy.canAffordSkill(skill)) {
        return skill;
      }
    }
    return null;
  }

  /**
   * Find the best swap for the enemy.
   * @returns {Object|null} Swap choice {col1, row1, col2, row2, score, targetCol, targetRow} or null.
   */
  findBestSwap() {
    const swaps = this.board.getValidSwaps();
    if (swaps.length === 0) return null;

    let bestSwap = null;
    let bestScore = -Infinity;

    for (const swap of swaps) {
      // Track which positions contain the SWAPPED tile instances (not just types).
      // tile1 moves from (col1, row1) to (col2, row2)
      // tile2 moves from (col2, row2) to (col1, row1)
      const tile1Col = swap.col1, tile1Row = swap.row1; // original pos of tile1
      const tile2Col = swap.col2, tile2Row = swap.row2; // original pos of tile2
      // After swap: tile1 is at (tile2Col, tile2Row), tile2 is at (tile1Col, tile1Row)

      // Simulate the swap on a cloned board
      const clone = this.board.clone();
      clone.swap(swap.col1, swap.row1, swap.col2, swap.row2);

      // Run match resolution on the clone
      const score = this._scoreSwap(clone);

      if (score > bestScore) {
        bestScore = score;
        // Find a target tile that is NOT one of the swapped tile instances.
        // The swapped tiles end up at positions (tile1Col, tile1Row) and (tile2Col, tile2Row)
        // (these are the final positions after swap since both positions are in the match).
        // We want a tile that was NOT moved by the swap.
        const matches = clone.findAllConnectedMatches();
        let targetTile = null;

        if (matches.length > 0) {
          // Collect all positions in the match
          const allMatchPositions = new Set();
          for (const match of matches) {
            for (const pos of match.positions) {
              allMatchPositions.add(`${pos.col},${pos.row}`);
            }
          }

          // The swap affects exactly 2 positions: swap.col1,swap.row1 and swap.col2,swap.row2
          // Find a matched tile at a position that wasn't one of the swap positions
          const swapPos1 = `${swap.col1},${swap.row1}`;
          const swapPos2 = `${swap.col2},${swap.row2}`;

          for (const match of matches) {
            for (const pos of match.positions) {
              const key = `${pos.col},${pos.row}`;
              if (key !== swapPos1 && key !== swapPos2) {
                targetTile = { col: pos.col, row: pos.row };
                break;
              }
            }
            if (targetTile) break;
          }
        }

        bestSwap = { ...swap, score, targetTile };
      }
    }

    return bestSwap;
  }

  /**
   * Score a board state after a simulated swap.
   * Higher score = better for the enemy.
   * @param {import('./Board.js').Board} board
   * @returns {number}
   * @private
   */
  _scoreSwap(board) {
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return -1; // No match = bad

    let score = 0;
    let hasExtraTurn = false;
    let enemyRedMana = 0;
    let enemySkullMatches = 0;
    let enemySkillMana = {}; // Track mana relevant to enemy skills

    // Initialize enemy skill mana tracking (support multi-mana format)
    for (const skill of this.enemy.skills) {
      if (skill.manaCosts && Array.isArray(skill.manaCosts)) {
        for (const cost of skill.manaCosts) {
          enemySkillMana[cost.color] = 0;
        }
      } else if (skill.costColor) {
        // Legacy format
        enemySkillMana[skill.costColor] = 0;
      }
    }

    // Priority: check if ANY match is 4+ tiles first
    let hasAny4PlusMatch = false;
    for (const match of matches) {
      if (match.count >= 4) {
        hasAny4PlusMatch = true;
        break;
      }
    }

    // Massive priority bonus: finding ANY 4+ match is extremely important
    if (hasAny4PlusMatch) {
      score += 500;
    }

    for (const match of matches) {
      const count = match.count;

      if (isSkull(match.typeId)) {
        // Skull matches deal damage - very good!
        const damage = Math.min(count, 5);
        score += damage * 35;
        if (count >= 4) hasExtraTurn = true;
        enemySkullMatches++;
      } else {
        // Mana matches
        score += count * 8;

        // Track mana for enemy's own skills
        if (enemySkillMana[match.typeId] !== undefined) {
          enemySkillMana[match.typeId] += count;
          // Mana for enemy's own skills is very valuable
          score += count * 20;
        }

        // Red mana is still valuable (Slash costs red)
        if (match.typeId === 'red') {
          enemyRedMana += count;
        }

        // Contesting player's skill colors is moderately valuable
        if (this.playerColorValues[match.typeId]) {
          score += count * 10;
        }

        if (count >= 4) hasExtraTurn = true;
      }
    }

    // Bonus for being able to use any enemy skill (support multi-mana format)
    for (const skill of this.enemy.skills) {
      if (skill.manaCosts && Array.isArray(skill.manaCosts)) {
        // Multi-mana: check all costs can be afforded
        let canAfford = true;
        for (const cost of skill.manaCosts) {
          if ((enemySkillMana[cost.color] || 0) < cost.amount) {
            canAfford = false;
            break;
          }
        }
        if (canAfford) {
          score += 250;
        }
      } else if (skill.costColor) {
        // Legacy format
        if ((enemySkillMana[skill.costColor] || 0) >= skill.costAmount) {
          score += 250;
        }
      }
    }

    // Bonus for extra turn (only if not already counted in priority)
    if (hasExtraTurn && !hasAny4PlusMatch) {
      score += 200;
    }

    // Bonus for skull damage
    score += enemySkullMatches * 25;

    // Small bonus for larger matches
    const totalMatchTiles = matches.reduce((sum, m) => sum + m.count, 0);
    if (totalMatchTiles >= 5) {
      score += 50;
    }

    return score;
  }
}
