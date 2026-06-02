/**
 * Goblin Warlord — Act 1 boss. See act1/goblin.js for the full field docs.
 */
const goblinWarlord = {
  id: 'goblin_warlord',
  name: 'Goblin Warlord',
  aiBehavior: null,
  className: 'Boss',
  level: 3,

  act: 1,
  rarity: 'rare',
  type: 'boss',

  // Boss occupies the final floor only (depth 9 → floor 10).
  floors: [10],

  hp: 60,
  maxHp: 60,
  attack: 3,
  armor: 2,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin', // placeholder — reuses the goblin portrait until dedicated art exists
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: false,
    isSpecialTrack: true,
  },

  skills: ['slash'],
  relics: ['cursed_idol'],
};

export default goblinWarlord;
