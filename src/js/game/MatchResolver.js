/**
 * MatchResolver — pure logic for resolving board matches.
 *
 * Provides:
 *   - analyzeMatches() — find matches and calculate rewards (does NOT modify board)
 *   - applyDamage() — static helper for armor→block→HP damage
 *
 * BattleController drives the visual phases and applies board modifications
 * (removeTiles, gravity, refill) at the appropriate times.
 */

import { isSkull, SKULL_DAMAGE_CONFIG } from './TileTypes.js';

export default class MatchResolver {
  constructor() {
    this.maxCascades = 50;
  }

  /**
   * Analyze the board for matches. Does NOT modify the board or combatant states.
   * Returns all information needed to process rewards and drive visual phases.
   *
   * @param {import('./BoardModel.js').default} board
   * @returns {MatchAnalysis|null} null if no matches found
   */
  analyzeMatches(board) {
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return null;

    const allPositions = new Set();
    const mergedMana = {};
    let cascadeSkullDamage = 0;
    let cascadeExtraTurn = false;

    for (const match of matches) {
      for (const pos of match.positions) {
        allPositions.add(`${pos.col},${pos.row}`);
      }

      const count = match.count;

      if (isSkull(match.typeId)) {
        const damage = Math.min(count, SKULL_DAMAGE_CONFIG.maxDamage)
          * SKULL_DAMAGE_CONFIG.baseMultiplier;
        cascadeSkullDamage += damage;
        if (count >= 5) cascadeExtraTurn = true;
      } else {
        mergedMana[match.typeId] = (mergedMana[match.typeId] || 0) + count;
        if (count >= 5) cascadeExtraTurn = true;
      }

      if (match.isShape && count >= 5) {
        cascadeExtraTurn = true;
      }
    }

    const positions = [];
    for (const key of allPositions) {
      const [col, row] = key.split(',').map(Number);
      positions.push({ col, row });
    }

    return {
      matches,
      positions,
      mana: mergedMana,
      skullDamage: cascadeSkullDamage,
      extraTurnTrigger: cascadeExtraTurn,
      tilesDestroyed: allPositions.size,
    };
  }

  /**
   * Apply damage respecting armor → block → HP.
   * Mutates the target state object.
   *
   * @param {object} target - { hp, armor, block }
   * @param {number} amount - raw damage amount
   * @returns {{ actualDamage: number, blocked: number, armorDamage: number }}
   */
  applyDamage(target, amount) {
    let remaining = amount;
    let blocked = 0;
    let armorDamage = 0;

    if (target.armor > 0) {
      armorDamage = Math.min(target.armor, remaining);
      target.armor -= armorDamage;
      remaining -= armorDamage;
    }

    if (target.block > 0) {
      blocked = Math.min(target.block, remaining);
      target.block -= blocked;
      remaining -= blocked;
    }

    const actualDamage = amount - blocked;
    target.hp = Math.max(0, target.hp - remaining);

    return { actualDamage, blocked, armorDamage };
  }
}

/**
 * @typedef {Object} MatchAnalysis
 * @property {Array} matches - raw match objects from findAllConnectedMatches()
 * @property {Array<{col:number, row:number}>} positions - all unique matched positions
 * @property {Object<string, number>} mana - mana gained per color this step
 * @property {number} skullDamage - raw skull damage this step
 * @property {boolean} extraTurnTrigger - whether this step triggers extra turn
 * @property {number} tilesDestroyed - count of unique positions
 */
