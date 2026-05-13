/**
 * Mock character data — the single source of truth for gameplay definitions.
 *
 * Each character defines its base stats, skills, mana, and portrait.
 * The Mage definition (previously commented out) is now fully enabled.
 *
 * Exports:
 *   warriorCharacter, mageCharacter — individual character definitions
 *   mockCharacter (default)         — Warrior for backward compatibility
 */

const warriorCharacter = {
  id: 'warrior',
  name: 'Thorgrim',
  className: 'Warrior',
  description: 'A stalwart defender who wields shield and blade with equal mastery. His indomitable will turns the tide of any battle.',
  level: 1,
  hp: 30,
  maxHp: 30,
  attack: 1,
  armor: 0,
  mana: {
    red: 0,
    blue: 5,
    green: 0,
    yellow: 0,
    purple: 0,
  },
  portrait: 'warrior', // maps to 'portrait_warrior' asset key
  skills: [
    {
      name: 'Bash',
      description: 'Deal 5 damage.\nGain a turn.',
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
      description: 'Gain 5 armor.\nCreate 3 blue tiles.',
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
  hp: 25,
  maxHp: 25,
  attack: 1,
  armor: 0,
  mana: {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 5,
    purple: 5,
  },
  portrait: 'mage', // maps to 'portrait_mage' asset key
  skills: [
    {
      name: 'Fracture',
      description: 'Destroy 1 row\nCreate 5 purple tiles',
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
  hp: 25,
  maxHp: 25,
  attack: 1,
  armor: 0,
  mana: {
    red: 0,
    blue: 0,
    green: 100,
    yellow: 0,
    purple: 4,
  },
  portrait: 'witch_doctor', // maps to 'portrait_witch_doctor' asset key
  skills: [
    {
      name: 'Summon Dead',
      description: 'Create 10 skull tiles',
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
      description: 'Heal 5 HP\nCreate 5 green tiles.',
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
