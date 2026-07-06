/**
 * Goblin Sapper — Act 1 minion. See act1/goblin.js for the full field docs.
 * Placeholder stats — tune freely.
 */
const goblinSapper = {
  id: 'goblin_sapper',
  name: 'Goblin Sapper',
  aiBehavior: 'goblin_sapper', // custom AI — see enemyAiOverrides.js
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  floors: [3, 4, 5, 6, 7],

  hp: 9, // floor-1-equivalent baseline (MapScene scales maxHp by depth); frail bomber. 2026-07-06: 11→9 (measured 37-43% player win — the bomb race was near-unwinnable; pairs with sulfur 15→10)
  maxHp: 9,
  attack: 2,
  armor: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin_sapper', // maps to 'portrait_goblin_sapper' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['boom_baby', 'ignition'],
  relics: ['sulfur'],
};

export default goblinSapper;
