/**
 * Mock enemy combatant data — goblin opponent.
 *
 * Same structure as mockCharacter.js so the CharacterPane
 * can render it dynamically without any hardcoded logic.
 *
 * Skills and relics are referenced by ID — the full definitions live in
 * `data/skills/skillCatalog.js` and `data/relics/relicCatalog.js`. They are
 * resolved at battle creation (see MapScene._transitionToBattle).
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
 *   For normal/default battles:
 *     music: { trackKey: 'battle_theme', persistAfterBattle: true, isSpecialTrack: false }
 *
 *   For boss/elite/special encounters:
 *     music: { trackKey: 'boss_theme', persistAfterBattle: false, isSpecialTrack: true }
 *
 *   When music is undefined/null, the default normal battle music is used.
 */
const mockEnemy = {
  name: 'Goblin',
  aiBehavior: null, // uses standard AI (no custom override)
  className: 'Minion',
  level: 1,
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

  /** Starting relic IDs — resolved via relicCatalog at battle creation */
  relics: [],
};

export default mockEnemy;
