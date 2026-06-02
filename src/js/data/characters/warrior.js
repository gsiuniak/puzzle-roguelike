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
    startingArmor: 0,
    startingMana: {
      red: 0,
      blue: 5,
      green: 0,
      yellow: 0,
      purple: 0,
    },
  },

  /** Skill IDs — resolved via skillCatalog at battle-state creation */
  skills: ['bash', 'defend'],

  /** Starting relic IDs — resolved via relicCatalog at battle-state creation */
  relics: ['family_crest'],
};

export default warrior;
