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
  // floors: derived from act1/index.js FLOOR_SPAWNS (placement is edited there)

  hp: 14, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 16→20 (measured 99-100% player win — band 85-95%; more HP = more turns for its Encroach ramp to matter)
  maxHp: 14,
  attack: 5,
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
