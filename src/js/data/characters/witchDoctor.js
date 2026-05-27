/**
 * Witch Doctor — Kalfou, dark ritualist.
 *
 * Character definitions are immutable. Skills and relics are referenced
 * by ID and resolved via the catalogs in data/skills and data/relics.
 */

const witchDoctor = {
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
  relics: ['evil_eye'],
};

export default witchDoctor;
