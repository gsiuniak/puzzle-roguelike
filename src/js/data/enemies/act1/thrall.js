/**
 * Thrall — Act 1 basic minion. A simple servant that builds red mana via
 * board swaps and then ramps its attack while clawing the player with Claw.
 *
 * Uses the standard EnemyAI (no aiBehavior): with no starting mana it builds
 * red through swaps, then casts Claw (3 red) once it can afford it.
 *
 * See act1/goblin.js for the full field documentation.
 */
const thrall = {
  id: 'thrall',
  name: 'Thrall',
  aiBehavior: null, // standard AI

  className: 'Minion',
  level: 1,

  // ── Categorization ──
  act: 1,
  rarity: 'common',
  type: 'minion',

  // ── Spawn placement ──
  floors: [2, 4, 5],

  hp: 15, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 20→22 (measured 95-99% player win — band 85-95%)
  maxHp: 15,
  attack: 1,
  armor: 0,
  // No starting mana — the AI builds red via swaps to afford Claw.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'thrall', // maps to 'portrait_thrall' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['claw'],
  relics: [],
};

export default thrall;
