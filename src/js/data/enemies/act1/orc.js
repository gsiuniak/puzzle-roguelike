/**
 * Orc — Act 1 minion. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const orc = {
  id: 'orc',
  name: 'Orc',
  aiBehavior: null,
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  floors: [1, 2, 3],

  hp: 24,
  maxHp: 24,
  attack: 2, // was 3 — attack 3 on floors 1-3 is too lethal for an early player (sim §4)
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'orc', // maps to 'portrait_orc' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: [],
  relics: [],
};

export default orc;
