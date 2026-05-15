/**
 * Mock enemy combatant data — goblin opponent.
 *
 * Same structure as mockCharacter.js so the CharacterPane
 * can render it dynamically without any hardcoded logic.
 *
 * === aiBehavior ===
 * Optional key linking to a handler in enemyAiOverrides.js.
 *   - undefined / null / missing → uses standard EnemyAI
 *   - e.g. "necromancer" → looks up enemyAiOverrides.necromancer
 *   - If key is present but no handler exists → warns + falls back to standard AI
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
  skills: [
    {
      name: 'Slash',
      description: 'Deal 5 damage.',
      icon: 'skill_slash',
      sound: 'skill_slash',
      cost: { red: 5 },
      effects: [
        { effectType: 'damage', damage: { amount: 5 } }
      ],
    },
  ],
};

export default mockEnemy;
