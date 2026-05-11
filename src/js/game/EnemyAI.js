/**
 * EnemyAI — enemy decision-making with prioritised board evaluation.
 *
 * Evaluates possible swaps on a cloned board and picks the best move.
 *
 * Priority order (strict):
 *   1. Matching 4+ tiles → extra turn (massive bonus, dominates all)
 *   2. Dealing damage — skull matches first, then mana that enables damage skills
 *   3. Matching colors to gain mana for the enemy's own skills
 *   4. Matching colors to deny mana the player needs (lowest priority)
 *
 * Also checks if enemy can use a skill before making a board move,
 * preferring damage-dealing skills over defensive ones.
 */

import { isSkull, SKULL_DAMAGE_CONFIG } from './TileTypes.js';

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
   * Find the best affordable skill, preferring damage-dealing skills.
   * @returns {object|null} skill definition or null
   */
  findBestSkill() {
    let bestSkill = null;
    let bestIsDamage = false;

    for (const skill of (this.enemyState.skills || [])) {
      if (!this._canAfford(skill)) continue;

      const isDamage = this._isDamageSkill(skill);

      // Prefer damage skills; if same category, first found wins
      if (!bestSkill || (isDamage && !bestIsDamage)) {
        bestSkill = skill;
        bestIsDamage = isDamage;
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
   * Check whether a skill deals damage (as opposed to buffing / defending).
   * @param {object} skill
   * @returns {boolean}
   * @private
   */
  _isDamageSkill(skill) {
    const desc = (skill.description || '').toLowerCase();
    const name = (skill.name || '').toLowerCase();
    return desc.includes('damage')
        || name.includes('bash')
        || name.includes('slash')
        || name.includes('strike')
        || name.includes('attack');
  }

  /**
   * Score a board state after a simulated swap.
   *
   * Priority weights (higher = better for the enemy):
   *   1. Any 4+ match .......................... +10000  (extra turn dominates)
   *   2a. Skull damage ......................... +100 per point
   *   2b. Skill affordable (damage skill) ...... +200
   *   2c. Skill affordable (defensive skill) ... +120
   *   3.  Enemy skill mana colors .............. +12 per tile
   *   4.  Player skill mana colors (contest) ... +4 per tile
   *   Base mana value .......................... +5 per tile
   *   Shape bonus .............................. +15
   *
   * @param {import('./BoardModel.js').default} board
   * @returns {number}
   * @private
   */
  _scoreBoard(board) {
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return -1;

    let score = 0;
    const enemySkillManaGained = {};

    // Track mana relevant to enemy skills
    for (const color of Object.keys(this.enemySkillColors)) {
      enemySkillManaGained[color] = 0;
    }

    // ── Priority 1: extra turn from 4+ matches ──────────
    let has4PlusMatch = false;
    for (const match of matches) {
      if (match.count >= 4) {
        has4PlusMatch = true;
        break;
      }
    }

    if (has4PlusMatch) {
      // Massive bonus so ANY 4+ match beats any set of 3-matches
      score += 10000;
    }

    // ── Per-match scoring ──────────────────────────────
    for (const match of matches) {
      const count = match.count;

      if (isSkull(match.typeId)) {
        // Priority 2a: skull matches deal direct damage
        const damage = Math.min(count, SKULL_DAMAGE_CONFIG.maxDamage);
        score += damage * 100;
      } else {
        // Base mana value
        score += count * 5;

        // Priority 3: mana for enemy's own skills
        if (enemySkillManaGained[match.typeId] !== undefined) {
          enemySkillManaGained[match.typeId] += count;
          score += count * 12;
        }

        // Priority 4: contesting player's skill colors (lowest)
        if (this.playerSkillColors[match.typeId]) {
          score += count * 4;
        }
      }

      // Shape bonus (L/T/cross) — minor
      if (match.isShape) {
        score += 15;
      }
    }

    // ── Priority 2b: skill affordability after match ──
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
        // Damage skills are worth more than defensive skills
        score += this._isDamageSkill(skill) ? 200 : 120;
      }
    }

    // ── Cascade size bonus ─────────────────────────────
    const totalTiles = matches.reduce((s, m) => s + m.count, 0);
    if (totalTiles >= 5) score += 25;
    if (totalTiles >= 8) score += 40;

    return score;
  }
}
