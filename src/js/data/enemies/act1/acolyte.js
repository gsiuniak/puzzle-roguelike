/**
 * Acolyte — Act 1 minion. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const acolyte = {
  id: 'acolyte',
  name: 'Acolyte',
  aiBehavior: null,
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  floors: [1, 2],

  hp: 20,
  maxHp: 20,
  attack: 1,
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'acolyte', // maps to 'portrait_acolyte' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['doomsong'],
  relics: ['goblin_totem'],
};

export default acolyte;
