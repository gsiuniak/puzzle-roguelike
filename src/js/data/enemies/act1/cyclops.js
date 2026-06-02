/**
 * Cyclops — Act 1 elite brute. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const cyclops = {
  id: 'cyclops',
  name: 'Cyclops',
  aiBehavior: null,
  className: 'Elite',
  level: 3,

  act: 1,
  rarity: 'uncommon',
  type: 'minion',
  floors: [3, 4, 5, 6, 7, 8, 9],

  hp: 45,
  maxHp: 45,
  attack: 3,
  armor: 1,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'cyclops', // maps to 'portrait_cyclops' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['boulder_throw', 'smash'],
  relics: [],
};

export default cyclops;
