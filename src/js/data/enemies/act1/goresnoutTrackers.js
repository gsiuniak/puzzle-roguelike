/**
 * Goresnout Trackers — Act 1 minion. A sturdy hunting pack (high armor) that
 * uses the Hound skill to ramp its attack while chipping away at the player.
 * Its Goresnout Collars relic echoes every hit it lands (deals the same damage
 * again), so Hound's 2 damage effectively lands for 4.
 *
 * Uses the standard EnemyAI (no aiBehavior): it builds red mana via board
 * swaps, then casts Hound once it can afford the 3 red cost.
 *
 * See act1/goblin.js for the full field documentation.
 */
const goresnoutTrackers = {
  id: 'goresnout_trackers',
  name: 'Goresnout Trackers',
  aiBehavior: null, // standard AI
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'uncommon',
  type: 'minion',
  // floors: derived from act1/index.js FLOOR_SPAWNS (placement is edited there)

  hp: 14, // floor-1-equivalent baseline (MapScene scales maxHp by depth); +armor 10
  maxHp: 14,
  attack: 2,
  armor: 0,
  // No starting mana — the AI builds red via swaps to afford Hound.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goresnout_trackers', // maps to 'portrait_goresnout_trackers' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['hound'],
  relics: ['goresnout_collars'],
};

export default goresnoutTrackers;
