/**
 * Mock enemy combatant data — goblin opponent.
 *
 * Same structure as mockCharacter.js so the CharacterPane
 * can render it dynamically without any hardcoded logic.
 */
const mockEnemy = {
  name: 'Goblin',
  className: 'Minion',
  level: 1,
  hp: 18,
  maxHp: 18,
  attack: 1,
  armor: 0,
  mana: {
    red: 5,
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
    },
  ],
};

export default mockEnemy;
