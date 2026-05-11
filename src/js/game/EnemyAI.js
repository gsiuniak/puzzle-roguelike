/**
 * EnemyAI — enemy decision-making with tiered priority scoring.
 *
 * Evaluates possible swaps on a cloned board and picks the best move.
 * Priority order:
 *   1. Match 4+ tiles (extra turn)
 *   2. Deal maximum damage (skull matches first, then damaging skills)
 *   3. Match colors for mana the enemy needs for its own skills
 *   4. Match colors for mana the player needs (contest / deprive)
 *
 * Also checks if enemy can use a skill before making a board move,
 * preferring damaging skills over defensive ones.
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
   * Prefers damaging skills over defensive/buff skills.
   * @returns {object|null} skill definition or null
   */
  findBestSkill() {
    let bestSkill = null;
    let bestScore = -1;

    for (const skill of (this.enemyState.skills || [])) {
      if (!this._canAfford(skill)) continue;

      // Score the skill: damaging skills get higher priority
      let skillScore = 0;
      if (this._isDamagingSkill(skill)) {
        skillScore = 100 + this._extractSkillDamage(skill) * 10;
      } else {
        skillScore = 10; // Defensive/buff skills are low priority
      }

      if (skillScore > bestScore) {
        bestScore = skillScore;
        bestSkill = skill;
      }
    }

    return bestSkill;
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
   *
   * Priority tier system:
   *   Tier 1 (base 2000): Any 4+ match → extra turn
   *   Tier 2 (base 150):  Skull matches → damage dealt
   *   Tier 3 (base 15):   Mana colors the enemy needs for skills
   *   Tier 4 (base 5):    Mana colors the player needs (contest)
   *
   * @param {import('./BoardModel.js').default} board
   * @returns {number}
   * @private
   */
  _scoreBoard(board) {
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return -1;

    let score = 0;
    let hasExtraTurn = false;
    let has4PlusMatch = false;
    const enemySkillManaGained = {};

    // Track mana relevant to enemy skills
    for (const color of Object.keys(this.enemySkillColors)) {
      enemySkillManaGained[color] = 0;
    }

    // ── First pass: check for ANY 4+ match (Priority 1) ──
    for (const match of matches) {
      if (match.count >= 4) {
        has4PlusMatch = true;
        hasExtraTurn = true;
        break;
      }
    }

    // PRIORITY 1: Extra turn from 4+ match — dominates all other considerations.
    // No combination of smaller matches should ever outscore a 4+ match.
    if (has4PlusMatch) {
      score += 2000;
    }

    // ── Second pass: compute match value by tier ──
    for (const match of matches) {
      const count = match.count;

      if (isSkull(match.typeId)) {
        // PRIORITY 2a: Skull matches deal damage to the player
        const damage = Math.min(count, 25);
        score += damage * 50; // Strong weighting to prefer skulls over mana
        if (count >= 4) hasExtraTurn = true;
      } else {
        // Base mana value
        score += count * 5;

        // PRIORITY 3: Mana for enemy's own skills
        if (enemySkillManaGained[match.typeId] !== undefined) {
          enemySkillManaGained[match.typeId] += count;
          score += count * 15;
        }

        // PRIORITY 4: Contest player's skill colors (deny them mana)
        if (this.playerSkillColors[match.typeId]) {
          score += count * 5;
        }

        if (count >= 4) hasExtraTurn = true;
      }

      // Shape bonus (L/T/cross) — these are harder to create, reward them
      if (match.isShape) {
        score += 50;
      }
    }

    // ── PRIORITY 2b: Skill affordability (damage through skills) ──
    // Check if this swap enables the enemy to cast a skill next turn
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
      if (canAfford) {
        // Damaging skills are valued higher than defensive/buff skills
        if (this._isDamagingSkill(skill)) {
          const dmg = this._extractSkillDamage(skill);
          score += 150 + dmg * 20;
        } else {
          score += 50;
        }
      }
    }

    // Extra turn bonus for 5+ matches that also weren't caught as 4+
    if (hasExtraTurn && !has4PlusMatch) {
      score += 300;
    }

    // Total tile count bonus (more tiles = more cascade potential)
    const totalTiles = matches.reduce((s, m) => s + m.count, 0);
    if (totalTiles >= 5) score += 30;
    if (totalTiles >= 8) score += 60;

    return score;
  }

  /**
   * Check whether a skill deals damage (as opposed to buffing/healing).
   * @param {object} skill
   * @returns {boolean}
   * @private
   */
  _isDamagingSkill(skill) {
    const desc = (skill.description || '').toLowerCase();
    const name = (skill.name || '').toLowerCase();
    return desc.includes('damage')
      || name.includes('bash')
      || name.includes('slash')
      || name.includes('strike')
      || name.includes('attack');
  }

  /**
   * Extract numeric damage value from a skill's description.
   * Falls back to a default of 5 if no number is found.
   * @param {object} skill
   * @returns {number}
   * @private
   */
  _extractSkillDamage(skill) {
    const numMatch = skill.description && skill.description.match(/(\d+)/);
    return numMatch ? parseInt(numMatch[1], 10) : 5;
  }
}
