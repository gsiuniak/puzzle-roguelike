/**
 * Mock character data — the single source of truth for gameplay definitions.
 *
 * Each character defines its immutable base stats, skill IDs, relic IDs,
 * mana, and portrait. Character definitions are NEVER mutated during gameplay.
 *
 * Skills and relics are referenced by ID — the full definitions live in
 * `data/skills/skillCatalog.js` and `data/relics/relicCatalog.js`. They are
 * resolved into full objects at battle-state creation time
 * (see playerStats.createPlayerBattleState).
 *
 * Architecture:
 *   characterDefinition.baseStats = immutable template
 *   playerRunState.statModifiers  = persistent run-level progression
 *   effectiveStats = baseStats + statModifiers (resolved via playerStats.js)
 *   battleState    = fresh instance created from effectiveStats each battle
 *
 * Exports:
 *   warriorCharacter, mageCharacter, witchDoctorCharacter — individual definitions
 *   mockCharacter (default) — Warrior for backward compatibility
 */

const warriorCharacter = {
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

const mageCharacter = {
  id: 'mage',
  name: 'Shylana',
  className: 'Mage',
  description: 'A master of the arcane arts, channeling raw magical energy into devastating spells that reshape the battlefield.',
  level: 1,
  portrait: 'mage', // maps to 'portrait_mage' asset key

  /** Immutable base stats — never modified during a run */
  baseStats: {
    maxHp: 25,
    startingAttack: 1,
    startingArmor: 0,
    startingMana: {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 5,
      purple: 5,
    },
  },

  skills: ['fracture', 'explode'],
  relics: [],
};

const witchDoctorCharacter = {
  id: 'witch_doctor',
  name: 'Kalfou',
  className: 'Witch Doctor',
  description: 'A shadowy practitioner of forbidden arts, Kalfou commands the dead and mends wounds with dark rituals.',
  level: 1,
  portrait: 'witch_doctor', // maps to 'portrait_witch_doctor' asset key

  /** Immutable base stats — never modified during a run */
  baseStats: {
    maxHp: 25,
    startingAttack: 1,
    startingArmor: 0,
    startingMana: {
      red: 0,
      blue: 0,
      green: 3,
      yellow: 0,
      purple: 4,
    },
  },

  skills: ['summon_dead', 'oungan'],
  relics: [],
};

// Default export — Warrior for backward compatibility
const mockCharacter = warriorCharacter;

export { warriorCharacter, mageCharacter, witchDoctorCharacter };
export default mockCharacter;
