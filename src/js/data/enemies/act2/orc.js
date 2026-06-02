/**
 * Orc — Act 2 minion. See act1/goblin.js for the full field docs.
 */
const orc = {
  id: 'orc',
  name: 'Orc',
  aiBehavior: null,
  className: 'Minion',
  level: 4,

  act: 2,
  rarity: 'common',
  type: 'minion',

  hp: 30,
  maxHp: 30,
  attack: 2,
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin', // placeholder — reuses the goblin portrait until dedicated art exists
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['slash'],
  relics: ['cracked_fang'],
};

export default orc;
