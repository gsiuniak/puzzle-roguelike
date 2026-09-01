/**
 * Mage — Shylana, arcane master.
 *
 * Character definitions are immutable. Skills and relics are referenced
 * by ID and resolved via the catalogs in data/skills and data/relics.
 */

const mage = {
  id: 'mage',
  name: 'Shylana',
  className: 'Mage',
  description: 'A master of the arcane arts, channeling raw magical energy into devastating spells that reshape the battlefield.',
  level: 1,
  portrait: 'mage', // maps to 'portrait_mage' asset key

  /** Immutable base stats — never modified during a run */
  baseStats: {
    maxHp: 24222,
    startingAttack: 1,
    startingMagic: 1,
    startingArmor: 0,
    startingMana: {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 3,
      purple: 3,
    },
  },

  skills: ['fracture', 'arcane_inscription'],
  relics: ['unstable_catalyst'],

  /**
   * Per-victory growth (AUTO-applied; stat picking is disabled — decision #36).
   * Mage = glass cannon: leaner HP growth, scaling on MAGIC — its single best
   * stat (it scales Fracture at _150 AND prints +⌊M/3⌋ mana per matched color,
   * so it is both damage and economy). See docs/balance-combat-math.md §3.5.
   */
  growthPlan: { maxHp: 4, startingMagic: 1, startingAttack: 0.334 },
};

export default mage;
