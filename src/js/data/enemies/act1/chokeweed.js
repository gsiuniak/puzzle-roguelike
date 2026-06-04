/**
 * Chokeweed — Act 1 minion. A creeping plant that only ever Encroaches:
 * each turn it casts the free Encroach skill (gain +1 Attack, end turn), so
 * its threat ramps over time. Its Briarthorn relic deals damage equal to its
 * (growing) attack at the start of each of its turns, and Chokeweed Sap turns
 * 2 Skulls into Green on turn start to deny skull ammo.
 *
 * See act1/goblin.js for the full field documentation.
 */
const chokeweed = {
  id: 'chokeweed',
  name: 'Chokeweed',
  aiBehavior: 'chokeweed', // custom AI — see enemyAiOverrides.js
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  floors: [3, 4, 5, 7, 8, 9],

  hp: 16, // floor-1-equivalent baseline (MapScene scales maxHp by depth)
  maxHp: 16,
  attack: 2,
  armor: 0,
  // No starting mana — Encroach is free, so it never needs any.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'chokeweed', // maps to 'portrait_chokeweed' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['encroach'],
  relics: ['briarthorn', 'chokeweed_sap'],
};

export default chokeweed;
