/**
 * enemyRelicCatalog.js — registry of ENEMY-ONLY relics.
 *
 * This is a sibling pool to the player relicCatalog.js. Enemy relics are
 * authored with the exact same shape as player relics (id / name / description
 * / icon / rarity / effects[] with per-effect trigger + effectType + payload),
 * and once resolved they flow through the IDENTICAL battle machinery: the
 * PassiveSystem dispatch + EffectResolver / BattleController board-effect path
 * treat an enemy's relics no differently from a player's. The ONLY difference
 * is the pool they're drawn from:
 *
 *   - Enemy definitions reference these ids via `relics: ['cracked_fang']`
 *     and resolve them with resolveEnemyRelicIds() (NOT resolveRelicIds).
 *   - Because this catalog is separate, enemy relics never leak into the
 *     player post-battle reward pool (relicRewards.js only reads relicCatalog).
 *
 * Rarity tiers are shared with the player catalog (RELIC_RARITY) so the
 * categorization vocabulary stays consistent across the game.
 *
 * Adding a new enemy relic:
 *   1. Add an entry below with a unique `id`.
 *   2. Reference the id from an enemy definition's `relics: [...]`.
 *   3. Ensure the `icon` key is registered in main.js ASSET_MAP (the seeded
 *      examples reuse existing player relic icon keys so no new art is needed;
 *      swap in dedicated art by registering a new key and pointing `icon` at it).
 *
 * See data/relics/relicCatalog.js for the full effect/trigger documentation —
 * the same effect types (modify_stat, armor, damage, gain_mana, …) and
 * triggers (onBattleStart, onTurnStart, onMatch4Plus, …) apply here.
 */

import { RELIC_RARITY } from './relicCatalog.js';

const ENEMY_RELIC_CATALOG = {
  // Static stat modifier — aggregated at setup by _initStaticModifiers.
  cracked_fang: {
    id: 'cracked_fang',
    name: 'Cracked Fang',
    description: 'Gain +2 Attack.',
    icon: 'relic_claymore', // placeholder art — reuses an existing icon key
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_stat', modifyStat: { stat: 'attack', amount: 2 } },
    ],
  },

  // Turn-start armor — resolved each turn via EffectResolver (armor).
  goblin_totem: {
    id: 'goblin_totem',
    name: 'Goblin Totem',
    description: 'Gain 1 Armor at the start of each turn.',
    icon: 'relic_aegis', // placeholder art — reuses an existing icon key
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'armor', armor: { amount: 1 } },
    ],
  },

  // Match-4+ reactive damage — resolved via EffectResolver (damage).
  cursed_idol: {
    id: 'cursed_idol',
    name: 'Cursed Idol',
    description: 'Deal 1 damage to the opponent when matching 4+ tiles.',
    icon: 'relic_trebuchet', // placeholder art — reuses an existing icon key
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onMatch4Plus', effectType: 'damage', damage: { amount: 1 } },
    ],
  },

  // Turn-start damage equal to the owner's attack — resolved via EffectResolver
  // (damage). Omitting `damage.amount` makes the resolver fall back to
  // caster.attack, so the hit scales as the owner's attack grows (e.g. Encroach).
  briarthorn: {
    id: 'briarthorn',
    name: 'Briarthorn',
    description: 'At the start of turn, deal damage equal to attack.',
    icon: 'relic_briarthorn',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'damage' },
    ],
  },

  // Reactive damage echo — re-deals the damage just dealt. Routed through the
  // onBoardEffect path so BattleController can apply its reentrancy guard
  // (_echoDamageActive) and stop the echo from echoing itself forever.
  goresnout_collars: {
    id: 'goresnout_collars',
    name: 'Goresnout Collars',
    description: 'When dealing damage, deal the same damage again.',
    icon: 'relic_goresnout_collars',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onDealDamage', effectType: 'echo_damage', echoDamage: { multiplier: 1 } },
    ],
  },

  // Turn-start board control — converts up to 2 random Skull tiles into Green
  // in place (no cascade). Board-touching, so it's handled by
  // BattleController._handlePassiveBoardEffect via the onBoardEffect path.
  chokeweed_sap: {
    id: 'chokeweed_sap',
    name: 'Chokeweed Sap',
    description: 'At the start of turn, change 2 Skulls into Green.',
    icon: 'relic_chokeweed_sap',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      {
        trigger: 'onTurnStart',
        effectType: 'convert_random_tiles',
        convertTiles: { from: 'skull', to: 'green', amount: 2 },
      },
    ],
  },
};

/**
 * Look up an enemy relic by ID.
 * Returns null and warns if not found.
 * @param {string} id
 * @returns {object|null}
 */
export function getEnemyRelicById(id) {
  const relic = ENEMY_RELIC_CATALOG[id];
  if (!relic) {
    console.warn(`[enemyRelicCatalog] Unknown enemy relic id: "${id}".`);
    return null;
  }
  return relic;
}

/**
 * Resolve an array of enemy relic IDs into full relic objects (shallow-cloned;
 * effects array also cloned) — mirror of relicCatalog.resolveRelicIds so the
 * resolved shape is interchangeable in BattleController/PassiveSystem.
 *
 * Unknown IDs are skipped with a console warning.
 * @param {string[]} ids
 * @returns {object[]}
 */
export function resolveEnemyRelicIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const relic = getEnemyRelicById(id);
    if (relic) {
      out.push({
        ...relic,
        effects: (relic.effects || []).map((e) => ({ ...e })),
      });
    }
  }
  return out;
}

export default ENEMY_RELIC_CATALOG;
