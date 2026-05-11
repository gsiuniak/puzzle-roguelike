/**
 * Mock character data — the single source of truth for the character pane.
 *
 * Change any value here and call characterPane.updateFromData() (or setCharacterData())
 * to see it reflected immediately in the UI. No display values are hardcoded in renderers.
 */

const mockCharacter = {
  name: 'Thorgrim',
  className: 'Warrior',
  level: 1,
  hp: 30,
  maxHp: 30,
  attack: 1,
  armor: 0,
  mana: {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
  },
  portrait: 'warrior', // maps to 'portrait_warrior' asset key
  skills: [
    {
      name: 'Bash',
      description: 'Deal 5 damage',
      icon: 'skill_slash',
      cost: { red: 5 },
    },
    {
      name: 'Shield Bash',
      description: 'Gain 5 armor.',
      icon: 'skill_defend',
      cost: { blue: 5 },
    },
    // {
    //   name: 'Battle Roar',
    //   description: 'Increase Attack and Armor for 3 turns.',
    //   icon: 'battle_roar', // no matching asset → placeholder
    //   cost: { green: 8, yellow: 4 },
    // },
    // {
    //   name: 'Earthshaker',
    //   description: 'Deal damage to all enemies and reduce Armor.',
    //   icon: 'skill_bash',
    //   cost: { red: 10, purple: 6 },
    // },
    // {
    //   name: "Champion's Resolve",
    //   description: 'Heal and grant Barrier.',
    //   icon: 'skill_defend',
    //   cost: { green: 6, blue: 6, yellow: 6 },
    // },
  ],
};

export default mockCharacter;
