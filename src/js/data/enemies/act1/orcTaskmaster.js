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
  rarity: 'common',
  type: 'elite',
  floors: [5, 6, 7, 8, 9], // elite nodes never appear before depth 4 (floor 5)

  hp: 28, // floor-1-equivalent elite baseline (MapScene scales maxHp by depth)
  maxHp: 28,
  attack: 3,
  armor: 0,
  mana: { red: 4, blue: 0, green: 0, yellow: 0, purple: 0 }, // starting red toward Charge
  portrait: 'orc_taskmaster', // maps to 'portrait_orc_taskmaster' asset key
  music: {
    trackKey: 'battle_theme_act_1_elite',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['charge', 'frenzy'],
  relics: [],
};

export default orcTaskmaster;
