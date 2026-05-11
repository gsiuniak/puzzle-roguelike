/**
 * Mock enemy combatant data — goblin opponent.
 *
 * Same structure as mockCharacter.js so the CharacterPane
 * can render it dynamically without any hardcoded logic.
 */
const mockEnemy = {
  name: 'Goblin',
  className: 'Minion',
  level: 5,
  hp: 800,
  maxHp: 800,
  attack: 45,
  armor: 20,
  mana: {
    red: 3,
    blue: 0,
    green: 5,
    yellow: 1,
    purple: 0,
  },
  portrait: 'goblin', // maps to 'portrait_goblin' asset key
  skills: [
    {
      name: 'Slash',
      description: 'Deal 5 damage.',
      icon: 'skill_slash',
      cost: { red: 5 },
    },
  ],
};

export default mockEnemy;
