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
    maxHp: 30,
    startingAttack: 2,
    startingMagic: 1,
    startingArmor: 0,
    startingMana: {
      red: 0,
      blue: 0,
      green: 5,
      yellow: 0,
      purple: 6,
    },
  },

  skills: ['summon_dead', 'oungan'],
  relics: ['poison_vial'],

  /**
   * Per-victory growth (AUTO-applied; stat picking is disabled — decision #36).
   * Witch Doctor = attrition/sustain: middling HP growth and MAGIC, which drives
   * its poison application (Poison Dart _25), Barrier, and mana economy. Both
   * axes grow every win.
   */
  growthPlan: { maxHp: 4, startingMagic: 1 },
};

export default witchDoctor;
