/**
 * Shadow Weaver — Act 1 minion (rare caster). See act1/goblin.js for field docs.
 * Placeholder stats — tune freely.
 */
const shadowWeaver = {
  id: 'shadow_weaver',
  name: 'Shadow Weaver',
  aiBehavior: null,
  className: 'Minion',
  level: 2,

  act: 1,
  rarity: 'rare',
  type: 'minion',
  type: 'elite',
  floors: [5, 6, 7, 8, 9], // elite nodes never appear before depth 4 (floor 5)

  hp: 60,
  maxHp: 60,
  attack: 5,
  armor: 10,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'shadow_weaver', // maps to 'portrait_shadow_weaver' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['slash'],
  relics: ['cursed_idol'],
};

export default shadowWeaver;
