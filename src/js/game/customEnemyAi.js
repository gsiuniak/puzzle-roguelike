/**
 * customEnemyAi.js — dispatch/orchestration for enemy AI overrides.
 *
 * Provides:
 *   - getEnemyAiHandler(aiBehavior) — look up a custom handler by key
 *   - chooseEnemyAction(enemyState, context) — full dispatch with fallback
 *
 * Used by BattleController._doEnemyTurn() to try custom AI before
 * falling through to the standard EnemyAI.
 */

import enemyAiOverrides from './enemyAiOverrides.js';
import EnemyAI from './EnemyAI.js';

/**
 * Look up a custom AI handler for the given behavior key.
 *
 * @param {string|null|undefined} aiBehavior — key from enemy definition
 * @returns {function|null} the handler function, or null if none exists
 */
export function getEnemyAiHandler(aiBehavior) {
  if (!aiBehavior) return null;

  const handler = enemyAiOverrides[aiBehavior];
  if (!handler) {
    console.warn(
      `[CustomEnemyAI] No handler registered for aiBehavior key: "${aiBehavior}". ` +
      `Falling back to standard AI.`
    );
    return null;
  }

  return handler;
}

/**
 * Try to get an action from a custom AI handler, falling back to null
 * (which signals "use standard AI").
 *
 * @param {object} enemyState — the enemy's combat state (must include aiBehavior)
 * @param {object} context
 * @param {object} context.enemy   — enemy combat state
 * @param {object} context.player  — player combat state
 * @param {object} context.board   — BoardModel instance
 * @param {object} context.battleState — BattleController instance
 * @returns {object|null} action intent or null (use standard AI)
 */
export function chooseEnemyAction(enemyState, context) {
  const { aiBehavior } = enemyState;

  // No custom behavior specified → standard AI
  if (!aiBehavior) {
    return null;
  }

  const handler = getEnemyAiHandler(aiBehavior);
  if (!handler) {
    // getEnemyAiHandler already logged a warning
    return null;
  }

  // Build a standardAI helper so custom handlers can optionally delegate
  // to the default decision-making without duplicating EnemyAI logic.
  const standardAI = {
    findBestSkill: () => {
      const ai = new EnemyAI(enemyState, context.player);
      return ai.findBestSkill();
    },
    findBestSwap: (board) => {
      const ai = new EnemyAI(enemyState, context.player);
      return ai.findBestSwap(board);
    },
  };

  const handlerContext = {
    ...context,
    standardAI,
  };

  try {
    const result = handler(handlerContext);

    if (result) {
      if (typeof window !== 'undefined' && window.__DEBUG_MODE) {
        console.log(
          `[CustomEnemyAI] Custom AI "${aiBehavior}" returned action:`,
          result.action,
          result.skill ? `(skill: ${result.skill.name})` : '',
          result.swap ? `(swap: ${result.swap.col1},${result.swap.row1} <-> ${result.swap.col2},${result.swap.row2})` : ''
        );
      }
      return result;
    }

    // Handler returned null/undefined — fallback to standard AI
    if (typeof window !== 'undefined' && window.__DEBUG_MODE) {
      console.log(
        `[CustomEnemyAI] Custom AI "${aiBehavior}" returned null — falling back to standard AI.`
      );
    }
    return null;
  } catch (err) {
    console.error(
      `[CustomEnemyAI] Error in custom AI handler "${aiBehavior}":`,
      err
    );
    // Fall back to standard AI on error
    return null;
  }
}
