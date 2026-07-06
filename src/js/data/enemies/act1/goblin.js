/**
 * Goblin — Act 1 basic minion encounter.
 *
 * Enemy definitions share the combatant shape used by characters
 * (skills/relics referenced by ID, resolved via the catalogs at battle
 * creation time). See data/enemies/index.js for the enemy lookup/spawn API.
 *
 * === Categorization fields ===
 *   act    — 1 | 2 | 3        thematic grouping only (NOT used for spawn selection)
 *   rarity — 'common' | 'uncommon' | 'rare'   weighting within a floor+type pool
 *   type   — 'minion' | 'elite' | 'boss'      matched against the map node type
 *
 * === floors (spawn placement) ===
 *   floors — number[]   the map floors this enemy is eligible to appear on.
 *            Floors are 1-indexed: floor 1 = the first encounter, floor 10 =
 *            the boss (the map's 10 depths, 0-indexed internally, map to floors
 *            depth+1). selectEnemyForNode() filters candidates by
 *            `floors.includes(floor)` AND matching `type`, then rarity-weighted
 *            picks one. This is the authoritative control for WHERE an enemy
 *            shows up — `act` is just a label.
 *
 * === relics ===
 * Enemy relic IDs are drawn from the ENEMY-ONLY pool in
 * data/relics/enemyRelicCatalog.js (resolved with resolveEnemyRelicIds, NOT
 * the player resolveRelicIds). Once resolved they grant the enemy the same
 * passive benefit a player would get from a relic.
 *
 * === aiBehavior ===
 * Optional key linking to a handler in enemyAiOverrides.js.
 *   - undefined / null / missing → uses standard EnemyAI
 *   - e.g. "necromancer" → looks up enemyAiOverrides.necromancer
 *   - If key is present but no handler exists → warns + falls back to standard AI
 *
 * === music ===
 * Optional music metadata for the encounter.
 *   - trackKey: SoundConfig key for the battle music track (default: 'battle_theme')
 *   - persistAfterBattle: whether the track persists across scenes after battle ends
 *   - isSpecialTrack: when true, music stops after battle and does NOT carry into rewards/map
 *
 *   For boss/elite/special encounters:
 *     music: { trackKey: 'boss_theme', persistAfterBattle: false, isSpecialTrack: true }
 *
 *   When music is undefined/null, the default normal battle music is used.
 */
const goblin = {
  id: 'goblin',
  name: 'Goblin',
  aiBehavior: null, // uses standard AI (no custom override)
  className: 'Minion',
  level: 1,

  // ── Categorization ──
  act: 1,
  rarity: 'common',
  type: 'minion',

  // ── Spawn placement ──
  // Sole Act 1 minion for now, so it covers every battle floor. When more
  // Act 1 minions are added, split these floors between them.
  floors: [1, 2],

  hp: 17, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 14→17 (measured 100% player win — band 85-95%)
  maxHp: 17,
  attack: 2, // 2026-07-06: 1→2 — at attack 1 it couldn't threaten at all (HP buffs alone left player win at 100%)
  armor: 0,
  mana: {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
  },
  portrait: 'goblin', // maps to 'portrait_goblin' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  /** Skill IDs — resolved via skillCatalog at battle creation */
  skills: ['slash'],

  /** Enemy relic IDs — resolved via enemyRelicCatalog at battle creation */
  relics: [],
};

export default goblin;
