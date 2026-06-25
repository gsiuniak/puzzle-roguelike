/**
 * Warrior — Thorgrim, stalwart defender.
 *
 * Character definitions are immutable. Skills and relics are referenced
 * by ID and resolved via the catalogs in data/skills and data/relics.
 *
 * See data/characters/index.js for the character lookup API.
 */

const warrior = {
  id: 'warrior',
  name: 'Thorgrim',
  className: 'Warrior',
  description: 'A stalwart defender who wields shield and blade with equal mastery. His indomitable will turns the tide of any battle.',
  level: 1,
  portrait: 'warrior', // maps to 'portrait_warrior' asset key

  /** Immutable base stats — never modified during a run */
  baseStats: {
    maxHp: 30,
    startingAttack: 1,
    startingMagic: 1,
    startingArmor: 0,
    startingMana: {
      red: 110,
      blue: 115,
      green: 0,
      yellow: 0,
      purple: 0,
    },
  },

  /** Skill IDs — resolved via skillCatalog at battle-state creation */
  skills: ['bash', 'defend'],

  /** Starting relic IDs — resolved via relicCatalog at battle-state creation */
  relics: ['family_crest'],

  /**
   * Per-victory growth (AUTO-applied; stat picking is disabled — decision #36).
   * Keys are applyRunModifier statModifier paths. Warrior = tanky bruiser: the
   * heaviest HP growth in the cast, plus steady Attack (its skull/Bash damage
   * scales with Attack). Both axes grow every win, so HP is never the lone pick.
   */
  growthPlan: { maxHp: 5, startingAttack: 1 },
};

export default warrior;
