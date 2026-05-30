/**
 * relicCatalog.js — central registry of all relics in the game.
 *
 * Relics grant passive abilities that automatically trigger on battle/game
 * events (see systems/TriggerTypes.js for the list of supported triggers).
 *
 * Each relic is keyed by a unique `id`. Characters and enemies reference
 * relics by ID rather than embedding full definitions, so:
 *   - relic numbers can be tuned in one place
 *   - relics can be shared between characters/enemies
 *   - new relics don't require touching every character file
 *
 * Adding a new relic:
 *   1. Add a new entry below with a unique `id`.
 *   2. Reference the id from a character/enemy definition: `relics: ['family_crest']`.
 *   3. Register the icon asset key in main.js ASSET_MAP.
 *
 * Relic shape:
 * {
 *   id:          string         — unique identifier (kebab/snake_case)
 *   name:        string         — display name
 *   description: string         — UI tooltip / description
 *   icon:        string         — AssetManager key for the icon
 *   rarity:      string         — RELIC_RARITY value (starter|common|uncommon|rare|legendary)
 *   area?:       any            — reserved for future area-based relics
 *   effects: [
 *     {
 *       trigger:     string     — TRIGGER_TYPES key (e.g. 'onTakeDamage')
 *       effectType:  string     — EFFECT_TYPES key (e.g. 'gain_mana')
 *       <effect data fields>    — type-specific payload, e.g. gainMana: { color, amount }
 *     }, ...
 *   ]
 * }
 *
 * Each effect carries its own trigger, so a single relic can mix several
 * trigger→effect pairs (e.g. "on damage taken: gain mana; on turn start:
 * deal 1 damage").
 *
 * ── Static-modifier relics ──────────────────────────────────────────────
 * Some relics are persistent passive modifiers rather than event reactions
 * (e.g. "+3 attack", "+10% red spawn rate", "+1 red mana per match"). These
 * use the `onBattleStart` trigger and one of the static-modifier effect
 * types, aggregated once at battle setup by
 * BattleController._initStaticModifiers():
 *   modify_stat        — { modifyStat: { stat, amount } }   (e.g. attack +3)
 *   modify_spawn_rate  — { spawnRate: { tile, amount } }    (percentage points)
 *   modify_mana_gain   — { manaGain: { color, amount } }    (bonus mana per match)
 *   modify_skull_damage— { skullDamage: { amount } }        (bonus matched-skull dmg)
 * These do NOT flow through EffectResolver (they need board / reward access).
 */

/**
 * Relic rarity tiers. Used for reward pools / drop weighting and UI framing.
 * @enum {string}
 */
export const RELIC_RARITY = {
  STARTER:   'starter',
  COMMON:    'common',
  UNCOMMON:  'uncommon',
  RARE:      'rare',
  LEGENDARY: 'legendary',
};

const RELIC_CATALOG = {
  family_crest: {
    id: 'family_crest',
    name: 'Family Crest',
    description: 'When you take damage, gain 2 red mana.',
    icon: 'relic_family_crest',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      {
        trigger: 'onTakeDamage',
        effectType: 'gain_mana',
        gainMana: { color: 'red', amount: 2 },
      },
    ],
  },

  unstable_catalyst: {
    id: 'unstable_catalyst',
    name: 'Unstable Catalyst',
    description: 'Explode tiles in radius 1 when matching 4+ tiles.',
    icon: 'relic_unstable_catalyst',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      // Board-touching effect — handled by BattleController via the
      // PassiveSystem.onBoardEffect callback (EffectResolver ignores it).
      // The center of the explosion is the same position used to spawn
      // the "Extra Turn" animation (payload.centerPos on onMatch4Plus).
      {
        trigger: 'onMatch4Plus',
        effectType: 'destroy_tiles_radius',
        area: { radius: 1 },
      },
    ],
  },

  evil_eye: {
    id: 'evil_eye',
    name: 'Evil Eye',
    description: 'Reduce all damage taken by 1.',
    icon: 'relic_evil_eye',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      // Fires before damage is applied; mutates the mutable `amount`
      // field of the trigger payload via EffectResolver's reduce_damage.
      {
        trigger: 'onIncomingDamage',
        effectType: 'reduce_damage',
        reduceDamage: { amount: 1 },
      },
    ],
  },

  // ── Group A: spawn-rate relics ──────────────────────────────────────────
  // Each raises its tile's spawn chance by 10 percentage points. The board
  // redistributes the remaining probability across the other tiles in
  // proportion to their base rates (BoardModel.getEffectiveWeights).
  flint: {
    id: 'flint',
    name: 'Flint',
    description: 'Increase the chance of Red appearing.',
    icon: 'relic_flint',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'red', amount: 10 } },
    ],
  },

  dewstone: {
    id: 'dewstone',
    name: 'Dewstone',
    description: 'Increase the chance of Blue appearing.',
    icon: 'relic_dewstone',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'blue', amount: 10 } },
    ],
  },

  fossilized_fern: {
    id: 'fossilized_fern',
    name: 'Fossilized Fern',
    description: 'Increase the chance of Green appearing.',
    icon: 'relic_fossilized_fern',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'green', amount: 10 } },
    ],
  },

  copper_coil: {
    id: 'copper_coil',
    name: 'Copper Coil',
    description: 'Increase the chance of Yellow appearing.',
    icon: 'relic_copper_coil',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'yellow', amount: 10 } },
    ],
  },

  obsidian_shard: {
    id: 'obsidian_shard',
    name: 'Obsidian Shard',
    description: 'Increase the chance of Purple appearing.',
    icon: 'relic_obsidian_shard',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'purple', amount: 10 } },
    ],
  },

  catacomb_key: {
    id: 'catacomb_key',
    name: 'Catacomb Key',
    description: 'Increase the chance of Skull appearing.',
    icon: 'relic_catacomb_key',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'skull', amount: 10 } },
    ],
  },

  // ── Group B: mana-gain relics ───────────────────────────────────────────
  // Each grants +1 bonus mana of its color whenever that color is matched.
  bellows: {
    id: 'bellows',
    name: 'Bellows',
    description: 'Increase the mana gained from matching Red by 1.',
    icon: 'relic_bellows',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'red', amount: 1 } },
    ],
  },

  gourd_flask: {
    id: 'gourd_flask',
    name: 'Gourd Flask',
    description: 'Increase the mana gained from matching Blue by 1.',
    icon: 'relic_gourd_flask',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'blue', amount: 1 } },
    ],
  },

  pestle: {
    id: 'pestle',
    name: 'Pestle',
    description: 'Increase the mana gained from matching Green by 1.',
    icon: 'relic_pestle',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'green', amount: 1 } },
    ],
  },

  thimble: {
    id: 'thimble',
    name: 'Thimble',
    description: 'Increase the mana gained from matching Yellow by 1.',
    icon: 'relic_thimble',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'yellow', amount: 1 } },
    ],
  },

  astrolabe: {
    id: 'astrolabe',
    name: 'Astrolabe',
    description: 'Increase the mana gained from matching Purple by 1.',
    icon: 'relic_astrolabe',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'purple', amount: 1 } },
    ],
  },

  funerary_bell: {
    id: 'funerary_bell',
    name: 'Funerary Bell',
    description: 'Increases damage dealt when matching skulls by 2.',
    icon: 'relic_funerary_bell',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_skull_damage', skullDamage: { amount: 2 } },
    ],
  },

  // ── Individual relics ───────────────────────────────────────────────────
  prism: {
    id: 'prism',
    name: 'Prism',
    description: 'Gain 1 of each mana when matching 4+ tiles.',
    icon: 'relic_prism',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'red', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'blue', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'green', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'yellow', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'purple', amount: 1 } },
    ],
  },

  blighted_hook: {
    id: 'blighted_hook',
    name: 'Blighted Hook',
    description: 'Drain 1 of each mana from the opponent when matching 4+ tiles.',
    icon: 'relic_blighted_hook',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      // Removes mana from the opponent — the player does not gain it.
      { trigger: 'onMatch4Plus', effectType: 'drain_mana', drainMana: { amount: 1 } },
    ],
  },

  trebuchet: {
    id: 'trebuchet',
    name: 'Trebuchet',
    description: 'Deal 1 damage to the opponent when matching 4+ tiles.',
    icon: 'relic_trebuchet',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onMatch4Plus', effectType: 'damage', damage: { amount: 1 } },
    ],
  },

  claymore: {
    id: 'claymore',
    name: 'Claymore',
    description: 'Gain +3 Attack.',
    icon: 'relic_claymore',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_stat', modifyStat: { stat: 'attack', amount: 3 } },
    ],
  },

  aegis: {
    id: 'aegis',
    name: 'Aegis',
    description: 'Gain 1 Armor at the start of each turn.',
    icon: 'relic_aegis',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'armor', armor: { amount: 1 } },
    ],
  },

  thorned_rose: {
    id: 'thorned_rose',
    name: 'Thorned Rose',
    description: 'Deal 1 damage to the enemy whenever you take damage.',
    icon: 'relic_thorned_rose',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTakeDamage', effectType: 'damage', damage: { amount: 1 } },
    ],
  },

  alabaster_flask: {
    id: 'alabaster_flask',
    name: 'Alabaster Flask',
    description: 'Heal 1 HP at the start of each of your turns.',
    icon: 'relic_alabaster_flask',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'heal', heal: { amount: 1 } },
    ],
  },
};

/**
 * Look up a relic by ID.
 * Returns null and warns if not found.
 * @param {string} id
 * @returns {object|null}
 */
export function getRelicById(id) {
  const relic = RELIC_CATALOG[id];
  if (!relic) {
    console.warn(`[relicCatalog] Unknown relic id: "${id}".`);
    return null;
  }
  return relic;
}

/**
 * Resolve an array of relic IDs into full relic objects (shallow-cloned
 * so callers cannot accidentally mutate the catalog; effects array is
 * also cloned).
 *
 * Unknown IDs are skipped with a console warning.
 * @param {string[]} ids
 * @returns {object[]}
 */
export function resolveRelicIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const relic = getRelicById(id);
    if (relic) {
      out.push({
        ...relic,
        effects: (relic.effects || []).map(e => ({ ...e })),
      });
    }
  }
  return out;
}

export default RELIC_CATALOG;
