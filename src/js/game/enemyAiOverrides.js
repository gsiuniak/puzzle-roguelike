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

/**
 * Score a (simulated) post-swap board for Lord Malakor's priorities.
 *
 * Malakor wins through skulls and the Desecrate engine, so his board ranking is
 * NOT the standard AI's. Strict tiers, each weighted above the max realistic
 * total of the tier below it:
 *
 *   4+ match (extra turn) > match skulls (damage) > match Purple (Desecrate
 *   fuel) > match the non-Purple skill color he's CLOSEST to affording
 *
 * The last tier implements the "don't collect any color — collect the color
 * you're close to casting with" rule: each Yellow/Blue/Red match is weighted by
 * how much of that color he already has (capped at the 7 cost). Green mana funds
 * nothing for him, so Green/other matches earn only the baseline. Returns -1
 * when the swap makes no match.
 *
 * @param {import('./BoardModel.js').default} board — cloned, post-swap board
 * @param {object} mana — Malakor's current mana pools
 * @returns {number}
 */
function scoreMalakorBoard(board, mana) {
  const matches = board.findAllConnectedMatches();
  if (matches.length === 0) return -1;

  const SKILL_COST = 7; // every Malakor skill costs 7 of one color
  let has4Plus = false;
  let skull = 0;
  let purple = 0;
  let progress = 0; // closeness-weighted Yellow/Blue/Red (skill colors)
  let total = 0;

  for (const match of matches) {
    if (match.count >= 4) has4Plus = true;
    total += match.count;
    const t = match.typeId;
    if (isSkull(t)) {
      skull += match.count;
    } else if (t === 'purple') {
      purple += match.count;
    } else if (t === 'yellow' || t === 'blue' || t === 'red') {
      // Closer to the 7 cost → higher score. +1 so a from-zero match still ranks.
      const have = Math.min(mana[t] || 0, SKILL_COST);
      progress += match.count * (have + 1);
    }
    // Green (and anything else) gives no progression value — Green mana is wasted.
  }

  let score = total; // baseline so any match beats "no match" (-1)
  if (has4Plus) score += 1_000_000; // extra turn dominates
  score += skull * 10_000;          // primary: skull damage
  score += purple * 1_000;          // primary: fuel Desecrate
  score += progress * 10;           // collect the color closest to a cast
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

  // ── Chokeweed ───────────────────────────────────────────
  // Only ever casts its free Encroach (gain +1 attack, end turn). If it
  // somehow can't (e.g. the skill is removed in a future variant), returns
  // null to fall back to the standard EnemyAI.
  chokeweed: ({ enemy }) => {
    const encroach = (enemy.skills || []).find((s) => s.id === 'encroach');
    if (canAfford(encroach, enemy.mana || {})) {
      return { action: 'skill', skill: encroach };
    }
    return null;
  },

  // ── Lord Malakor (Act 1 boss) ───────────────────────────
  // His Heart of the Usurper relic now feeds him 2 of every mana each turn, and
  // every skill grants an extra turn ("Gain a turn"), so he chains skills down a
  // fixed priority until he runs out of affordable casts, then matches the board.
  // Cast priority (strict): Desecrate > Harvest > Soul Burn > Exsanguinate.
  //   1) Desecrate (3 purple) when there's Green to convert — the skull engine.
  //   2) Harvest  (3 yellow) when there are Skulls to recycle into Purple.
  //   3) Soul Burn (3 blue)  — drain 5 of every enemy mana.
  //   4) Exsanguinate (3 red) — cripple the enemy's attack.
  //   5) Otherwise match the board via scoreMalakorBoard: skulls > Purple >
  //      the skill color he's closest to affording.
  // (Convert skills gate on having tiles to convert so a cast is never wasted;
  // the cripples gate on affordability only. Extra turns don't refill mana, so
  // the chain always terminates.)
  malakor: ({ enemy, board }) => {
    const mana = enemy.mana || {};
    const skills = enemy.skills || [];
    const byId = (id) => skills.find((s) => s.id === id);

    const desecrate = byId('desecrate');
    const harvest = byId('harvest');
    const soulBurn = byId('soul_burn');
    const exsanguinate = byId('exsanguinate');

    const greenCount = board.getTilesOfType('green').length;
    const skullCount = board.getTilesOfType('skull').length;

    // 1) Desecrate — manufacture skulls from Green.
    if (canAfford(desecrate, mana) && greenCount > 0) {
      return { action: 'skill', skill: desecrate };
    }

    // 2) Harvest — recycle Skulls into Purple (Desecrate fuel).
    if (canAfford(harvest, mana) && skullCount > 0) {
      return { action: 'skill', skill: harvest };
    }

    // 3) Soul Burn — drain enemy mana.
    if (canAfford(soulBurn, mana)) return { action: 'skill', skill: soulBurn };

    // 4) Exsanguinate — cripple enemy attack.
    if (canAfford(exsanguinate, mana)) return { action: 'skill', skill: exsanguinate };

    // 5) Board matching, ranked by Malakor's custom priorities.
    const swaps = board.getValidSwaps();
    if (swaps.length === 0) return null; // no moves → let standard AI reshuffle

    let bestSwap = null;
    let bestScore = -Infinity;
    for (const sw of swaps) {
      const clone = board.clone();
      clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      const score = scoreMalakorBoard(clone, mana);
      if (score > bestScore) {
        bestScore = score;
        bestSwap = sw;
      }
    }

    return bestSwap ? { action: 'swap', swap: bestSwap } : null;
  },
};

export default enemyAiOverrides;
