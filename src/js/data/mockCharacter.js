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
      description: 'Deal 5 damage',
      icon: 'skill_bash',
      sound: 'skill_bash',
      cost: { red: 5 },
    },
    {
      name: 'Defend',
      description: 'Gain 5 armor',
      icon: 'skill_defend',
      sound: 'skill_defend',
      cost: { blue: 5 },
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
      description: 'Destroy 1 row',
      icon: 'skill_fracture',
      sound: 'skill_fracture',
      effectType: 'destroy_tiles_row',
      targeting: 'board_tile',
      area: 1,
      cost: { yellow: 5 },
    },
    {
      name: 'Explode',
      description: 'Destroy tiles in a 3x3 area',
      icon: 'skill_explode',
      sound: 'skill_explode',
      effectType: 'destroy_tiles',
      targeting: 'board_tile',
      area: { radius: 1 },
      cost: { purple: 8 },
    },
  ],
};

// Default export — Warrior for backward compatibility
const mockCharacter = warriorCharacter;

export { warriorCharacter, mageCharacter };
export default mockCharacter;
