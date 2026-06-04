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

  hp: 18, // floor-1-equivalent baseline (MapScene scales maxHp by depth); bruiser, above-avg
  maxHp: 18,
  attack: 3,
  armor: 0,
  mana: { red: 3, blue: 0, green: 0, yellow: 0, purple: 0 }, // starting red so the bruiser can Slash
  portrait: 'orc', // maps to 'portrait_orc' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  // Was a no-kit auto-attacker; give it a basic hit so it has an identity.
  skills: [],
  relics: [],
};

export default orc;
