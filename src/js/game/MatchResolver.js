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
  // Direct damage to the opponent. Payload damage: { amount?, perSkull?,
  // perArmor?, scaling?, leech? } — `amount` omitted falls back to the
  // caster's attack; `perSkull` adds N per Skull tile on the board at cast;
  // `perArmor` adds N per point of the CASTER's current armor at cast
  // (Deadstop — armor is read, not consumed; contrast CONSUME); `scaling`
  // adds a floored Attack/Magic bonus; `leech` heals the caster a fraction
  // of damage dealt (decision #40).
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
  // Destroys tiles of a given type board-wide (non-targeted). Payload
  // destroyByType: { type, amount? } — omit `amount` to destroy ALL of that
  // type, or set it to destroy up to N random ones. Routes through the same
  // destroy/cascade path as destroy_tiles (mana + skull damage as normal).
  // Synthesized by the weave grammar: `skull + destroy` (destroy N Skulls) and
  // `destroy + all + <color>` (destroy all of that color). Resolved in
  // BattleController._resolveEffect.
  DESTROY_TILES_BY_TYPE: 'destroy_tiles_by_type',
  HEAL: 'heal',
  // A one-round magic shield: adds to the caster's `barrier` pool, which absorbs
  // incoming damage like armor (see MatchResolver.applyDamage) but expires at the
  // caster's next turn start. Payload barrier: { amount, scaling? } — scales with
  // Magic (twice as effectively as armor scales with Attack). Resolved in
  // BattleController._resolveEffect (and EffectResolver for relics). See decision #38.
  BARRIER: 'barrier',
  // Permanently raises the caster's MAX HP (does NOT heal — pair with a HEAL
  // effect to also fill the new space). Payload gainMaxHp: { amount }. Resolved
  // in BattleController._resolveEffect (e.g. the Sanguine Phoenix's Blood Gorge).
  GAIN_MAX_HP: 'gain_max_hp',
  EXTRA_TURN: 'extra_turn',
  // Permanently increases the caster's attack for the rest of the battle
  // (e.g. Chokeweed's "Encroach"). Resolved in BattleController._resolveEffect;
  // shares semantics with EffectResolver's gain_attack used by relics.
  GAIN_ATTACK: 'gain_attack',
  // Permanently increases the caster's MAGIC for the rest of the battle (the
  // counterpart to GAIN_ATTACK — the woven `magic` tag). Payload
  // gainMagic: { amount }. Resolved in BattleController._resolveEffect.
  GAIN_MAGIC: 'gain_magic',
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
  // Applies POISON stacks to the opponent. Payload poison: { amount, scaling?,
  // target? } — application scales with Magic (Poison Dart uses _50). Poison is
  // a numeric stack pool on the combatant (state.poison): at the end of the
  // applier's turn it deals damage equal to the stack count (armor-piercing),
  // then the stacks are halved. Resolved in BattleController._resolveEffect (skill
  // path) and _handlePassiveBoardEffect (relic path, e.g. Poison Vial). See
  // BattleController._applyPoison / _tickPoison.
  APPLY_POISON: 'apply_poison',
  // Convert the caster's OTHER mana into a destination color (a battery for next
  // turn). Payload transmuteMana: { color, amount }. Resolved in
  // BattleController._resolveEffect; the woven `transmute` action. See decision #40.
  TRANSMUTE_MANA: 'transmute_mana',
  // Spend a built-up POOL for damage = floor(poolSize / divisor) — 1 damage per
  // `divisor` units (capped at 1 per 2 = ½ damage/mana). Payload consume:
  // { resource:'mana'|'armor'|'barrier', color?, divisor } — 'mana' with a color
  // eats leftover mana of that color (no color = all leftover mana); 'armor'/
  // 'barrier' eat that shield pool (a Shield Bash). No stat scaling. Damage routes
  // through _applyDamage. Resolved in BattleController._resolveEffect. See decision #40.
  CONSUME: 'consume',
  // Arm a one-time damage MULTIPLIER on the caster's NEXT damage instance
  // (state.mark), consumed in _applyDamage. Payload mark: { multiplier } (×2, or
  // ×3 with Greater). Persists until consumed (no timer). Resolved in
  // BattleController._resolveEffect. See decision #40.
  MARK: 'mark',
  // Lock all tiles of a color: unmatchable + unmovable (for BOTH sides) for N
  // turns. Payload lockColor: { color?, turns } — omit color to lock the
  // opponent's most-abundant color at cast. Board-state (BoardModel.lockColor);
  // ticks down each turn start. Resolved in BattleController._resolveEffect. See decision #40.
  LOCK_COLOR: 'lock_color',
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
 * Per-SKULL attack scaling (fixed 2026-06-23, see docs/balance-combat-math.md
 * §1.1). The Attack bonus is applied to EVERY skull in the match, not once per
 * match. The old `N + max(0, A - 1)` added the bonus a single time regardless of
 * size, which made many small skull matches strictly better than one big one at
 * high Attack (e.g. A=10: two 3-matches = 24 vs one 6-match = 15) — directly
 * fighting the 4+ extra-turn incentive. This was unintended.
 *
 * Formula: round(N × (1 + max(0, A − 1) / 3))
 *   At N = 3 this reproduces the OLD values exactly, so the common 3-match is
 *   unchanged; only larger matches are corrected to scale linearly with N.
 *
 * Examples:
 *   1 attack, 3 skulls → 3    1 attack, 6 skulls → 6
 *   2 attack, 3 skulls → 4    4 attack, 6 skulls → 12
 *   10 attack, 3 skulls → 12  10 attack, 6 skulls → 24  (was 15)
 *
 * @param {{ attack: number }} attacker - combatant with attack stat
 * @param {number} skullCount - number of skulls in the match group
 * @returns {number}
 */
export function calculateMatchedSkullDamage(attacker, skullCount) {
  const attack = (attacker && typeof attacker.attack === 'number') ? attacker.attack : 1;
  const perSkull = 1 + Math.max(0, attack - 1) / 3;
  return Math.round(skullCount * perSkull);
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

    // Numeric position keys (col*16+row, boards ≤8×8) — the old string keys
    // paid an encode→Set→split(',')→Number round trip per cascade step,
    // amplified inside every AI board simulation.
    const allPositions = new Set();
    const positions = [];
    const creditedPositions = new Set();
    const mergedMana = {};
    let cascadeSkullDamage = 0;
    let cascadeExtraTurn = false;

    for (const match of matches) {
      for (const pos of match.positions) {
        const key = pos.col * 16 + pos.row;
        if (!allPositions.has(key)) {
          allPositions.add(key);
          positions.push(pos);
        }
      }

      const count = match.count;

      // Inert tiles (Disease) are removed but award no mana and no skull
      // damage — matching them "does nothing except get rid of them". A 4+
      // match still grants an extra turn, like any other big match.
      // (They also never claim a shared wild's credit below — they'd award
      // nothing for it.)
      if (isInert(match.typeId)) {
        if (count >= 4) cascadeExtraTurn = true;
        continue;
      }

      // A wild tile can sit in SEVERAL overlapping matches at once (it
      // completes runs of different colors, or a color run AND a skull run).
      // Each tile pays out exactly once, to the first match that contains it
      // in scan order — otherwise a shared wild is credited per color and a
      // big multi-wild board inflates mana/skull damage. The raw run size
      // (`count`) still drives the 4+ extra-turn checks so overlap never
      // costs a legitimately-long run its extra turn.
      let creditCount = 0;
      for (const pos of match.positions) {
        const key = pos.col * 16 + pos.row;
        if (!creditedPositions.has(key)) {
          creditedPositions.add(key);
          creditCount++;
        }
      }

      if (isSkull(match.typeId)) {
        const damage = calculateMatchedSkullDamage(attacker || { attack: 1 }, creditCount);
        cascadeSkullDamage += damage;
        if (count >= 4) cascadeExtraTurn = true;
      } else {
        mergedMana[match.typeId] = (mergedMana[match.typeId] || 0) + creditCount;
        if (count >= 4) cascadeExtraTurn = true;
      }

      if (match.isShape && count >= 4) {
        cascadeExtraTurn = true;
      }
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
   * Apply damage respecting barrier → armor → block → HP.
   * Mutates the target state object.
   *
   * Barrier (a one-round magic shield) absorbs FIRST — it's the expiring
   * resource, so spending it before permanent armor preserves the armor. Like
   * armor, barrier-absorbed damage still counts toward `actualDamage` (the hit
   * "landed" for trigger/feedback purposes); only `block` fully negates.
   *
   * @param {object} target - { hp, barrier, armor, block }
   * @param {number} amount - raw damage amount
   * @returns {{ actualDamage: number, blocked: number, armorDamage: number, barrierDamage: number }}
   */
  applyDamage(target, amount) {
    let remaining = amount;
    let blocked = 0;
    let armorDamage = 0;
    let barrierDamage = 0;

    if (target.barrier > 0) {
      barrierDamage = Math.min(target.barrier, remaining);
      target.barrier -= barrierDamage;
      remaining -= barrierDamage;
    }

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

    return { actualDamage, blocked, armorDamage, barrierDamage };
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
