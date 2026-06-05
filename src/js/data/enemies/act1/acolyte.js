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

  hp: 18, // floor-1-equivalent baseline (MapScene scales maxHp by depth)
  maxHp: 18,
  attack: 1,
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 3 }, // starting purple so it can summon (doomsong)
  portrait: 'acolyte', // maps to 'portrait_acolyte' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['doomsong'],
  relics: [],
};

export default acolyte;
