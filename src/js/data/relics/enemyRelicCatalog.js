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
    description: 'Gain +2 [[Attack]].',
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
    description: 'Gain 1 [[Armor]] at the start of each turn.',
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
    description: 'Deal 1 [[damage]] to the opponent when matching 4+ [[tiles]].',
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
    description: 'At the start of turn, deal [[damage]] equal to [[attack]].',
    icon: 'relic_briarthorn',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'damage' },
    ],
  },

  // Static spawn-rate modifier — aggregated at setup by _initStaticModifiers
  // (board-global). +15 percentage points of Yellow spawn chance.
  sulfur: {
    id: 'sulfur',
    name: 'Sulfur',
    description: 'Drastically increase chance of Yellow [[tiles]] appearing.',
    icon: 'relic_sulfur',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'yellow', amount: 15 } },
    ],
  },

  // Reactive damage echo — re-deals the damage just dealt. Routed through the
  // onBoardEffect path so BattleController can apply its reentrancy guard
  // (_echoDamageActive) and stop the echo from echoing itself forever.
  goresnout_collars: {
    id: 'goresnout_collars',
    name: 'Goresnout Collars',
    description: 'When dealing [[damage]], deal the same damage again.',
    icon: 'relic_goresnout_collars',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onDealDamage', effectType: 'echo_damage', echoDamage: { multiplier: 1 } },
    ],
  },

  // Turn-start Thrall engine — at the start of each of his turns Lord Malakor
  // seeds the board with 3 Thrall (wild) tiles. Board-touching, so it's handled
  // by BattleController._handlePassiveBoardEffect via the create_tiles path with
  // avoidMatches:true so the wilds don't immediately resolve into free matches.
  // Pairs with Baron's Signet, which harvests any Thralls the player leaves
  // behind. Fires onTurnStart (real turns only, not "Gain a turn" extras), so
  // the board doesn't flood unbounded. Tunables: createTiles.amount.
  heart_of_usurper: {
    id: 'heart_of_usurper',
    name: "Usurper's Heart",
    description: '[[Create]] 3 [[Thrall]] tiles at the start of turn.',
    icon: 'relic_heart_of_usurper',
    rarity: RELIC_RARITY.RARE,
    effects: [
      {
        trigger: 'onTurnStart',
        effectType: 'create_tiles',
        createTiles: { type: 'thrall', amount: 3, avoidMatches: true },
      },
    ],
  },

  // Turn-start Thrall harvest — counts every Thrall left on the board, grants
  // the owner +1 Attack per Thrall, then converts those Thralls into Skulls.
  // Board-touching, handled by BattleController._handlePassiveBoardEffect via the
  // harvest_tiles path (which also surfaces the red "tendril" harvest animation
  // and delays the boss's action until it plays). With Usurper's Heart this is
  // the boss's core engine: Thralls the player doesn't spend become permanent
  // Attack + Skull pressure. Tunables: harvestTiles.attackPer / toType /
  // tendrilColor; ordered BEFORE Usurper's Heart in the enemy def so it harvests
  // last turn's Thralls before fresh ones are seeded.
  barons_signet: {
    id: 'barons_signet',
    name: "Baron's Signet",
    description: '[[Harvest]] all Thrall [[tiles]]. Gain 1 [[Attack]] for each Thrall harvested, then turn those Thralls into [[Skulls]].',
    icon: 'relic_barons_signet',
    rarity: RELIC_RARITY.RARE,
    effects: [
      {
        trigger: 'onTurnStart',
        effectType: 'harvest_tiles',
        harvestTiles: { type: 'thrall', toType: 'skull', attackPer: 1, tendrilColor: '#d22a2a' },
      },
    ],
  },

  // Reactive board control — on dealing damage, create a Disease tile (an inert
  // tile that does nothing when matched). Board-touching, so it's handled by
  // BattleController._handlePassiveBoardEffect via the onBoardEffect path; the
  // creation dispatches onTileCreated so Severed Maxilla can react.
  infected_tooth: {
    id: 'infected_tooth',
    name: 'Infected Tooth',
    description: 'Create a Disease [[tile]] after dealing [[damage]].',
    icon: 'relic_infected_tooth',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      {
        trigger: 'onDealDamage',
        effectType: 'create_tiles',
        createTiles: { type: 'disease', amount: 1 },
      },
    ],
  },

  // Reactive attack growth — gains +1 Attack whenever a Disease tile is created
  // (pairs with Infected Tooth). Resolved via EffectResolver (gain_attack); the
  // onTileCreated condition gates it to Disease tiles specifically.
  severed_maxilla: {
    id: 'severed_maxilla',
    name: 'Severed Maxilla',
    description: 'Whenever a Disease [[tile]] is created, gain +1 [[Attack]].',
    icon: 'relic_severed_maxilla',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      {
        trigger: 'onTileCreated',
        condition: { typeId: 'disease' },
        effectType: 'gain_attack',
        gainAttack: { amount: 1 },
      },
    ],
  },

  // Turn-start board control — converts up to 2 random Skull tiles into Green
  // in place (no cascade). Board-touching, so it's handled by
  // BattleController._handlePassiveBoardEffect via the onBoardEffect path.
  chokeweed_sap: {
    id: 'chokeweed_sap',
    name: 'Chokeweed Sap',
    description: 'At the start of turn, change 2 [[Skulls]] into Green [[tiles]].',
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
