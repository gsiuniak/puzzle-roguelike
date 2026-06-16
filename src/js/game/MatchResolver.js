/**
 * MatchResolver — pure logic for resolving board matches.
 *
 * Provides:
 *   - analyzeMatches() — find matches and calculate rewards (does NOT modify board)
 *   - applyDamage() — static helper for armor→block→HP damage
 *   - resolveDestroyedTileRewards() — shared reward computation for any tile destruction
 *   - calculateSkullDamage() — centralised skull damage (match vs destroyed)
 *   - calculateMatchedSkullDamage() — skull match formula
 *   - calculateDestroyedSkullDamage() — non-match destruction formula
 *
 * BattleController drives the visual phases and applies board modifications
 * (removeTiles, gravity, refill) at the appropriate times.
 */

import { isSkull, isInert, isMana } from './TileTypes.js';

/**
 * Skill effect type constants.
 * Used by skill definitions and BattleController routing.
 * @enum {string}
 */
export const SKILL_EFFECT_TYPES = {
  DAMAGE: 'damage',
  ARMOR: 'armor',
  DESTROY_TILES: 'destroy_tiles',
  DESTROY_TILES_ROW: 'destroy_tiles_row',
  // Column mirror of DESTROY_TILES_ROW: destroys full columns centered on the
  // targeted column. Skill-level `area` is a number = how many columns.
  // (Synthesized "destroy + column" skills.)
  DESTROY_TILES_COLUMN: 'destroy_tiles_column',
  CREATE_TILES: 'create_tiles',
  CONVERT_TILE: 'convert_tile',
  CONVERT_TILES_BY_TYPE: 'convert_tiles_by_type',
  HEAL: 'heal',
  EXTRA_TURN: 'extra_turn',
  // Permanently increases the caster's attack for the rest of the battle
  // (e.g. Chokeweed's "Encroach"). Resolved in BattleController._resolveEffect;
  // shares semantics with EffectResolver's gain_attack used by relics.
  GAIN_ATTACK: 'gain_attack',
  // Caster sets its own HP to 0 (e.g. Goblin Sapper's "Boom Baby!"). Resolved
  // in BattleController._resolveEffect; the subsequent _checkGameOver ends the
  // battle. Pair after a DAMAGE effect for a "deal damage then die" skill.
  SELF_DESTRUCT: 'self_destruct',
  // Removes mana from the OPPONENT (Lord Malakor's "Soul Burn"). Payload
  // drainMana: { amount, color? } — omit color to drain every color. Resolved
  // in BattleController._resolveEffect.
  DRAIN_MANA: 'drain_mana',
  // Grants the CASTER mana. Payload gainMana: { color, amount }. Resolved in
  // BattleController._resolveEffect; gated by Enfeebled, fires onGainMana so
  // mana-reactor relics see it. (Synthesized "gain" skills.)
  GAIN_MANA: 'gain_mana',
  // Silences the OPPONENT for N of their upcoming turns (blocks skill casting).
  // Payload silence: { turns }. Resolved in BattleController._resolveEffect;
  // enforced in tryPlayerSkill. (Lord Malakor's "Soul Burn".)
  SILENCE: 'silence',
  // Forces the OPPONENT's attack to a fixed value for N of their upcoming turns,
  // then restores it (Lord Malakor's "Exsanguinate"). Payload setAttack:
  // { value, turns }. Resolved in BattleController._resolveEffect.
  // NOTE: SILENCE and SET_ATTACK are legacy aliases — both now route through the
  // unified status system (apply_status: 'silenced' / 'crippled'). Prefer
  // APPLY_STATUS for new skills.
  SET_ATTACK: 'set_attack',
  // Applies a named status effect (buff/debuff) from data/statusEffects.js to
  // the caster or opponent for N turn cycles. Payload applyStatus:
  // { id, target:'self'|'opponent', turns, attackValue? }. Resolved in
  // BattleController._resolveEffect → _applyStatus. This is the general,
  // data-driven way to apply any status (Silence, Bleed, Intangible, …).
  APPLY_STATUS: 'apply_status',
  // Randomizes the whole board into a fresh no-match arrangement (synthesized
  // "shuffle" skills — always paired with an extra turn). Resolved in
  // BattleController._resolveEffect → _executeShuffle; non-cascade.
  SHUFFLE: 'shuffle',
};

/**
 * Skull damage source constants.
 * @enum {string}
 */
export const SKULL_DAMAGE_SOURCE = {
  MATCH: 'match',
  DESTROYED: 'destroyed',
};

/**
 * Calculate skull damage for a matched skull group.
 *
 * Formula: matchedSkullCount + max(0, attack - 1)
 *
 * Examples:
 *   1 attack, 3 skulls → 3 damage
 *   2 attack, 3 skulls → 4 damage
 *   10 attack, 3 skulls → 12 damage
 *
 * @param {{ attack: number }} attacker - combatant with attack stat
 * @param {number} skullCount - number of skulls in the match group
 * @returns {number}
 */
export function calculateMatchedSkullDamage(attacker, skullCount) {
  const attack = (attacker && typeof attacker.attack === 'number') ? attacker.attack : 1;
  return skullCount + Math.max(0, attack - 1);
}

/**
 * Calculate damage for skulls destroyed by non-match effects
 * (Explode, destroy_tiles, destroy_tiles_row, etc.).
 *
 * Formula: skullCount * (1 + floor(attack / 3))
 *
 * Examples:
 *   1 attack → 1 damage per skull
 *   3 attack → 2 damage per skull
 *   6 attack → 3 damage per skull
 *   9 attack → 4 damage per skull
 *
 * @param {{ attack: number }} attacker - combatant with attack stat
 * @param {number} skullCount - number of skull tiles destroyed
 * @returns {number}
 */
export function calculateDestroyedSkullDamage(attacker, skullCount) {
  const attack = (attacker && typeof attacker.attack === 'number') ? attacker.attack : 1;
  return skullCount * (1 + Math.floor(attack / 3));
}

/**
 * Centralised skull damage calculation — routes to the correct formula
 * based on destruction source.
 *
 * @param {{ attacker: { attack: number }, skullCount: number, source: 'match'|'destroyed' }} params
 * @returns {number}
 */
export function calculateSkullDamage({ attacker, skullCount, source }) {
  if (source === SKULL_DAMAGE_SOURCE.MATCH) {
    return calculateMatchedSkullDamage(attacker, skullCount);
  }
  return calculateDestroyedSkullDamage(attacker, skullCount);
}

export default class MatchResolver {
  constructor() {
    this.maxCascades = 50;
  }

  /**
   * Analyze the board for matches. Does NOT modify the board or combatant states.
   * Returns all information needed to process rewards and drive visual phases.
   *
   * @param {import('./BoardModel.js').default} board
   * @param {{ attack: number }} [attacker] - combatant whose attack stat scales skull damage (defaults to { attack: 1 })
   * @returns {MatchAnalysis|null} null if no matches found
   */
  analyzeMatches(board, attacker) {
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

      // Inert tiles (Disease) are removed but award no mana and no skull
      // damage — matching them "does nothing except get rid of them". A 4+
      // match still grants an extra turn, like any other big match.
      if (isInert(match.typeId)) {
        if (count >= 4) cascadeExtraTurn = true;
        continue;
      }

      if (isSkull(match.typeId)) {
        const damage = calculateMatchedSkullDamage(attacker || { attack: 1 }, count);
        cascadeSkullDamage += damage;
        if (count >= 4) cascadeExtraTurn = true;
      } else {
        mergedMana[match.typeId] = (mergedMana[match.typeId] || 0) + count;
        if (count >= 4) cascadeExtraTurn = true;
      }

      if (match.isShape && count >= 4) {
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

  /**
   * Compute rewards for destroying a set of tiles, regardless of source
   * (match, skill, cascade, explode, etc.). Does NOT mutate board or states.
   *
   * Each destroyed colored gem grants 1 mana of its color to the active combatant.
   * Each destroyed skull deals damage based on the attacker's Attack stat
   * using the non-match destruction formula: skullCount * (1 + floor(attack / 3)).
   *
   * @param {import('./BoardModel.js').default} board
   * @param {Array<{col:number, row:number}>} positions
   * @param {{ attack: number }} [attacker] - combatant whose attack stat scales skull damage (defaults to { attack: 1 })
   * @returns {{ mana: Object<string,number>, skullDamage: number, tilesDestroyed: number }}
   */
  resolveDestroyedTileRewards(board, positions, attacker) {
    const mana = {};
    let skullCount = 0;

    for (const pos of positions) {
      const tileId = board.get(pos.col, pos.row);
      if (!tileId) continue;
      if (isSkull(tileId)) {
        skullCount++;
      } else if (isMana(tileId)) {
        // Only mana colors award mana on destruction. Inert (Disease) and wild
        // (Thrall) tiles destroyed without a host award nothing.
        mana[tileId] = (mana[tileId] || 0) + 1;
      }
    }

    const skullDamage = calculateDestroyedSkullDamage(attacker || { attack: 1 }, skullCount);

    return { mana, skullDamage, tilesDestroyed: positions.length };
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
