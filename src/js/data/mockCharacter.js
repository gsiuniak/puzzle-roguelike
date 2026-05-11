/**
 * Mock character data — the single source of truth for the character pane.
 *
 * Change any value here and call characterPane.updateFromData() (or setCharacterData())
 * to see it reflected immediately in the UI. No display values are hardcoded in renderers.
 */

const mockCharacter = {
  name: 'Thorgrim',
  className: 'Warrior',
  level: 32,
  hp: 1250,
  maxHp: 1250,
  attack: 245,
  armor: 180,
  mana: {
    red: 12,
    blue: 8,
    green: 14,
    yellow: 10,
    purple: 6,
  },
  portrait: 'warrior', // maps to 'portrait_warrior' asset key
  skills: [
    {
      name: 'Whirlwind',
      description: 'Deal heavy damage to all enemies.',
      icon: 'skill_slash',
      cost: { red: 8, yellow: 4 },
    },
    {
      name: 'Shield Bash',
      description: 'Deal damage and apply Stun to one enemy.',
      icon: 'skill_bash',
      cost: { blue: 6 },
    },
    {
      name: 'Battle Roar',
      description: 'Increase Attack and Armor for 3 turns.',
      icon: 'battle_roar', // no matching asset → placeholder
      cost: { green: 8, yellow: 4 },
    },
    {
      name: 'Earthshaker',
      description: 'Deal damage to all enemies and reduce Armor.',
      icon: 'skill_bash',
      cost: { red: 10, purple: 6 },
    },
    {
      name: "Champion's Resolve",
      description: 'Heal and grant Barrier.',
      icon: 'skill_defend',
      cost: { green: 6, blue: 6, yellow: 6 },
    },
  ],
};

export default mockCharacter;
