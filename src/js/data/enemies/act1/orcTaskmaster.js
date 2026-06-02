/**
 * Orc Taskmaster — Act 1 elite. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const orcTaskmaster = {
  id: 'orc_taskmaster',
  name: 'Orc Taskmaster',
  aiBehavior: null,
  className: 'Elite',
  level: 3,

  act: 1,
  rarity: 'uncommon',
  type: 'elite',
  floors: [5, 6, 7, 8, 9], // elite nodes never appear before depth 4 (floor 5)

  hp: 50,
  maxHp: 50,
  attack: 4,
  armor: 50,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'orc_taskmaster', // maps to 'portrait_orc_taskmaster' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['slash'],
  relics: ['cracked_fang'],
};

export default orcTaskmaster;
