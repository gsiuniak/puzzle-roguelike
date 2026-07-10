/**
 * Acolyte — Act 1 minion. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const acolyte = {
  id: 'acolyte',
  name: 'Acolyte',
  aiBehavior: null,
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  // floors: derived from act1/index.js FLOOR_SPAWNS (placement is edited there)

  hp: 9, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 18→21 (measured 97-99% player win — band 85-95%)
  maxHp: 9,
  attack: 2, // 2026-07-06: 1→2 — threat, not HP, was the gap (player win stuck at 97-99%)
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 5 }, // starting purple so it can summon (doomsong)
  portrait: 'acolyte', // maps to 'portrait_acolyte' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['doomsong'],
  relics: [],
};

export default acolyte;
