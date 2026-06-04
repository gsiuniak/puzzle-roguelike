/**
 * Stone Gargoyle — Act 1 elite (defensive). See act1/goblin.js for field docs.
 * Placeholder stats — tune freely.
 */
const stoneGargoyle = {
  id: 'stone_gargoyle',
  name: 'Stone Gargoyle',
  aiBehavior: null,
  className: 'Elite',
  level: 3,

  act: 1,
  rarity: 'rare',
  type: 'elite',
  floors: [5, 6, 7, 8, 9], // elite nodes never appear before depth 4 (floor 5)

  hp: 45,
  maxHp: 45, // fix: was hp 60 / maxHp 40 (inconsistent). +10 armor ≈ 55 EHP.
  attack: 3,
  armor: 10,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'stone_gargoyle', // maps to 'portrait_stone_gargoyle' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['slash'],
  relics: ['goblin_totem'],
};

export default stoneGargoyle;
