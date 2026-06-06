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

  hp: 24, // floor-1-equivalent elite baseline (MapScene scales maxHp by depth); +armor 10
  maxHp: 24,
  attack: 3,
  armor: 10,
  mana: { red: 0, blue: 4, green: 0, yellow: 0, purple: 0 }, // starting blue toward Frenzy
  portrait: 'stone_gargoyle', // maps to 'portrait_stone_gargoyle' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  // Stone wall: Frenzy stacks armor (+ an extra turn) and Goblin Totem adds armor
  // each turn — a defense check the player must out-damage. (was Slash-only.)
  skills: ['slash', 'frenzy'],
  relics: ['goblin_totem'],
};

export default stoneGargoyle;
