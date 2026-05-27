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
 */

const RELIC_CATALOG = {
  family_crest: {
    id: 'family_crest',
    name: 'Family Crest',
    description: 'When you take damage, gain 1 red mana.',
    icon: 'relic_family_crest',
    effects: [
      {
        trigger: 'onTakeDamage',
        effectType: 'gain_mana',
        gainMana: { color: 'red', amount: 1 },
      },
    ],
  },

  unstable_catalyst: {
    id: 'unstable_catalyst',
    name: 'Unstable Catalyst',
    description: 'Explode tiles in radius 1 when matching 4+ tiles.',
    icon: 'relic_unstable_catalyst',
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
