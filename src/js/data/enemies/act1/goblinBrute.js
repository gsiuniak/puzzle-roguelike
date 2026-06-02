/**
 * Goblin Brute — Act 1 elite. Tougher minion with an enemy-only attack relic.
 * See act1/goblin.js for the full field documentation.
 */
const goblinBrute = {
  id: 'goblin_brute',
  name: 'Goblin Brute',
  aiBehavior: null,
  className: 'Elite',
  level: 2,

  act: 1,
  rarity: 'uncommon',
  type: 'elite',

  // Elite nodes never appear before depth 4 (floor 5), per MapGenerator.
  floors: [5, 6, 7, 8, 9],

  hp: 34,
  maxHp: 34,
  attack: 2,
  armor: 1,
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

export default goblinBrute;
