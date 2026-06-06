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
  type: 'elite', // (was a duplicate minion/elite key — cleaned up)
  floors: [5, 6, 7, 8, 9], // elite nodes never appear before depth 4 (floor 5)

  hp: 26, // floor-1-equivalent elite baseline (MapScene scales maxHp by depth); +armor 10
  maxHp: 26,
  attack: 3, // caster elite — low attack; its threat is skull-flooding (doomsong), not hits
  armor: 10,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 4 }, // starting purple toward doomsong
  portrait: 'shadow_weaver', // maps to 'portrait_shadow_weaver' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  // Weaves death: floods the board with skulls (doomsong), then the AI matches
  // them for damage. cursed_idol punishes the player's own 4+ matches.
  skills: ['slash', 'doomsong'],
  relics: ['cursed_idol'],
};

export default shadowWeaver;
