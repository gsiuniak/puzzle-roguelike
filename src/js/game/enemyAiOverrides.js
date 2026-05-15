/**
 * enemyAiOverrides.js — centralized registry of custom enemy AI handlers.
 *
 * Each handler is keyed by an `aiBehavior` string that enemy definitions
 * reference. Handlers receive a context object with full battle state and
 * can return an action intent OR null/undefined to fall back to standard AI.
 *
 * === HANDLER SIGNATURE ===
 *
 * function handler(context) → action | null
 *
 *   context = {
 *     enemy,        // enemy state (hp, mana, skills, ...)
 *     player,       // player state
 *     board,        // BoardModel instance
 *     battleState,  // BattleController instance (for read-only queries)
 *     standardAI,   // { findBestSkill(), findBestSwap(board) } helper
 *   }
 *
 *   action = {
 *     action: 'skill',           // cast a skill
 *     skill: skillObject,
 *   }
 *   | {
 *     action: 'swap',            // make a board swap
 *     swap: { col1, row1, col2, row2 },
 *   }
 *   | {
 *     action: 'pass',            // do nothing, end turn
 *   }
 *   | null | undefined          // fall back to standard EnemyAI
 *
 * === EXAMPLE (commented) ===
 *
 *   necromancer: ({ enemy, player, board, standardAI }) => {
 *     // If enough purple mana and Summon Dead is available, cast it
 *     const summonDead = enemy.skills.find(s => s.name === 'Summon Dead');
 *     if (summonDead) {
 *       const cost = summonDead.cost || {};
 *       const mana = enemy.mana || {};
 *       const canAfford = Object.entries(cost).every(
 *         ([color, amt]) => (mana[color] || 0) >= amt
 *       );
 *       if (canAfford) return { action: 'skill', skill: summonDead };
 *     }
 *     // Fall back to standard AI
 *     return null;
 *   },
 *
 * === ADDING NEW BEHAVIORS ===
 *
 * 1. Add a handler to this registry with a unique key.
 * 2. Set `aiBehavior: "your_key"` on the enemy definition in mockEnemy.js
 *    (or wherever enemy data is defined).
 * 3. That's it — the system handles dispatch and fallback automatically.
 */

const enemyAiOverrides = {
  // ── Placeholder: no built-in overrides ──────────────────
  // Add custom handler entries here as needed, e.g.:
  //
  // necromancer: ({ enemy, player, board, standardAI }) => {
  //   return null; // fallback to standard AI
  // },
};

export default enemyAiOverrides;
