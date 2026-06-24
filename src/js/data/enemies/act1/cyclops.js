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
  floors: [5, 6, 7, 8, 9],

  hp: 18, // floor-1-equivalent baseline (MapScene scales maxHp by depth); brute (tough normal)
  maxHp: 18,
  attack: 3,
  armor: 1,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 }, // starting red toward Smash
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
