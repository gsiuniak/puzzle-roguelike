/**
 * Mock character data — the single source of truth for gameplay definitions.
 *
 * Each character defines its immutable base stats, skills, mana, and portrait.
 * Character definitions are NEVER mutated during gameplay.
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

  skills: [
    {
      name: 'Bash',
      description: 'Deal 5 damage\nGain a turn',
      icon: 'skill_bash',
      sound: 'skill_bash',
      cost: { red: 7 },
      effects: [
        { effectType: 'damage', damage: { amount: 5 } },
        { effectType: 'extra_turn' }
      ],
    },
    {
      name: 'Defend',
      description: 'Gain 5 armor\nCreate 3 blue',
      icon: 'skill_defend',
      sound: 'skill_defend',
      cost: { blue: 5 },
      effects: [
        { effectType: 'armor', armor: { amount: 5 } },
        {
          effectType: 'create_tiles',
          createTiles: { amount: 3, type: 'blue' }
        }
      ],
    }
  ],
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

  skills: [
    {
      name: 'Fracture',
      description: 'Destroy 1 row\nCreate 5 purple',
      icon: 'skill_fracture',
      sound: 'skill_fracture',
      targeting: 'board_tile',
      area: 1,
      cost: { yellow: 5 },
      effects: [
        { effectType: 'destroy_tiles_row' },
        {
          effectType: 'create_tiles',
          createTiles: { amount: 5, type: 'purple' }
        }
      ],
    },
    {
      name: 'Explode',
      description: 'Destroy tiles in a 3x3 area',
      icon: 'skill_explode',
      sound: 'skill_explode',
      targeting: 'board_tile',
      area: { radius: 1 },
      cost: { purple: 8 },
      effects: [
        { effectType: 'destroy_tiles' }
      ],
    },
  ],
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

  skills: [
    {
      name: 'Summon Dead',
      description: 'Create 10 skulls',
      icon: 'skill_summon_dead',
      sound: 'skill_create_skull',
      cost: { purple: 4 },
      effects: [
        {
          effectType: 'create_tiles',
          createTiles: { amount: 10, type: 'skull' }
        }
      ],
    },
    {
      name: 'Oungan',
      description: 'Heal 5 HP\nCreate 5 green',
      icon: 'skill_oungan',
      sound: 'skill_oungan',
      cost: { green: 6 },
      effects: [
        {
          effectType: 'heal',
          heal: { amount: 5 }
        },
        {
          effectType: 'create_tiles',
          createTiles: { amount: 3, type: 'green' }
        }
      ],
    },
  ],
};

// Default export — Warrior for backward compatibility
const mockCharacter = warriorCharacter;

export { warriorCharacter, mageCharacter, witchDoctorCharacter };
export default mockCharacter;
