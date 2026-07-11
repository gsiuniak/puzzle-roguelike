/**
 * Blight Warden — Act 1 minion. A fungal attrition fight: it hoards Green mana
 * for Blighted Growth (create 6 timed Fungal tiles + keep the turn), and its
 * Vampiric Roots heal it 1 HP per tile whenever ANYONE matches Green — and
 * Fungal tiles COUNT as Green, so clearing the blight feeds it. The player
 * races the Fungal timers (2 enemy turns, counted down on the tile): expired
 * blight explodes into a Skull and spreads 2 more Fungal tiles. See TILE_TYPES
 * (fungal_2/fungal_1) + BattleController._tickFungalTiles (decision #46).
 *
 * See act1/goblin.js for the full field documentation.
 */
const blightWarden = {
  id: 'blight_warden',
  name: 'Blight Warden',
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  // floors: derived from act1/index.js FLOOR_SPAWNS (placement is edited there)

  hp: 12, // floor-1-equivalent baseline (MapScene scales maxHp by depth) — low on purpose; Vampiric Roots is its real HP pool
  maxHp: 12,
  attack: 1,
  armor: 0,
  // No starting mana — it builds Green from board matches to fund Blighted Growth.
  mana: { red: 0, blue: 0, green: 8, yellow: 0, purple: 0 },
  portrait: 'blight_warden', // maps to 'portrait_blight_warden' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['blighted_growth'],
  relics: ['vampiric_roots'],
};

export default blightWarden;
