/**
 * Wraith — Act 3 minion. See act1/goblin.js for the full field docs.
 */
const wraith = {
  id: 'wraith',
  name: 'Wraith',
  aiBehavior: null,
  className: 'Minion',
  level: 7,

  act: 3,
  rarity: 'common',
  type: 'minion',

  hp: 44,
  maxHp: 44,
  attack: 3,
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin', // placeholder — reuses the goblin portrait until dedicated art exists
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['slash'],
  relics: ['goblin_totem'],
};

export default wraith;
