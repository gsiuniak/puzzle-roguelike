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
 * 2. Set `aiBehavior: "your_key"` on the enemy definition in data/enemies/
 *    (or wherever enemy data is defined).
 * 3. That's it — the system handles dispatch and fallback automatically.
 */

import { isSkull } from './TileTypes.js';

/**
 * Whether the enemy can pay a skill's full mana cost from its current mana.
 * @param {object} skill
 * @param {object} mana — { red, blue, green, yellow, purple }
 * @returns {boolean}
 */
function canAfford(skill, mana) {
  if (!skill) return false;
  const cost = skill.cost || {};
  return Object.entries(cost).every(([color, amt]) => (mana[color] || 0) >= amt);
}

/**
 * Score a (simulated) post-swap board for the Goblin Sapper's priorities.
 *
 * The Sapper hoards mana to fuel Boom Baby! / Ignition, so its swap ranking
 * is NOT the standard AI's (which prizes skull damage). Strict tiers, each
 * weighted far above the max realistic total of the tier below it:
 *
 *   4+ match (extra turn) > match yellow > match red > match skulls > anything else
 *
 * Per-tile weights create that strict ordering while still rewarding bigger
 * matches and combos within a tier. Returns -1 when the swap makes no match.
 *
 * @param {import('./BoardModel.js').default} board — cloned, post-swap board
 * @returns {number}
 */
function scoreSapperBoard(board) {
  const matches = board.findAllConnectedMatches();
  if (matches.length === 0) return -1;

  let has4Plus = false;
  let yellow = 0;
  let red = 0;
  let skull = 0;
  let other = 0;

  for (const match of matches) {
    if (match.count >= 4) has4Plus = true;
    const t = match.typeId;
    if (t === 'yellow') yellow += match.count;
    else if (t === 'red') red += match.count;
    else if (isSkull(t)) skull += match.count;
    else other += match.count;
  }

  let score = 0;
  if (has4Plus) score += 1_000_000;   // priority 3: 4+ → extra turn, dominates
  score += yellow * 10_000;           // priority 5: feed Ignition (yellow)
  score += red * 1_000;               // priority 6: feed Boom Baby! (red)
  score += skull * 10;                // priority 7: skulls — deliberately low
  score += other * 1;                 // priority 8: anything else
  return score;
}

const enemyAiOverrides = {
  // ── Goblin Sapper ───────────────────────────────────────
  // Ignores skulls to bank red mana for Boom Baby!. Action preference:
  //   1) cast Boom Baby!  2) cast Ignition  3) match 4+
  //   5) match yellow     6) match red      7) match skulls   8) anything else
  // (Skill casts gate on affordability; the swap ranking handles 3–8.)
  goblin_sapper: ({ enemy, board }) => {
    const mana = enemy.mana || {};
    const skills = enemy.skills || [];
    const skillById = (id) => skills.find((s) => s.id === id);

    // 1) Boom Baby! — game-ending nuke, cast the instant it's affordable.
    const boomBaby = skillById('boom_baby');
    if (canAfford(boomBaby, mana)) return { action: 'skill', skill: boomBaby };

    // 2) Ignition — floods the board with red to fuel Boom Baby!.
    const ignition = skillById('ignition');
    if (canAfford(ignition, mana)) return { action: 'skill', skill: ignition };

    // 3–8) Board swap, ranked by the Sapper's custom priorities.
    const swaps = board.getValidSwaps();
    if (swaps.length === 0) return null; // no moves → let standard AI reshuffle

    let bestSwap = null;
    let bestScore = -Infinity;
    for (const sw of swaps) {
      const clone = board.clone();
      clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      const score = scoreSapperBoard(clone);
      if (score > bestScore) {
        bestScore = score;
        bestSwap = sw;
      }
    }

    return bestSwap ? { action: 'swap', swap: bestSwap } : null;
  },
};

export default enemyAiOverrides;
