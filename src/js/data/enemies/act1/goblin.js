/**
 * Goblin — Act 1 basic minion encounter.
 *
 * Enemy definitions share the combatant shape used by characters
 * (skills/relics referenced by ID, resolved via the catalogs at battle
 * creation time). See data/enemies/index.js for the enemy lookup/spawn API.
 *
 * === Categorization fields ===
 *   act    — 1 | 2 | 3        which act this enemy belongs to (drives spawn pool by depth)
 *   rarity — 'common' | 'uncommon' | 'rare'   weighting within an act+type pool
 *   type   — 'minion' | 'elite' | 'boss'      matched against the map node type
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

  hp: 18,
  maxHp: 18,
  attack: 1,
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
  relics: ['goblin_totem'],
};

export default goblin;
