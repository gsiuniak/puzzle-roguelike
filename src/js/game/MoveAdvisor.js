/**
 * MoveAdvisor — GENERAL, side-agnostic move-ranking AI built on BoardSimulator.
 *
 * Answers "which swap should this combatant make?" by simulating every legal
 * move (deterministic cascades + refill-RNG expectation) and scoring the
 * outcomes against tunable objectives:
 *
 *   - extra turns (guaranteed 4+ matches, plus refill-lottery chance)
 *   - skull damage (with a dominant bonus for a guaranteed lethal)
 *   - mana the mover's own skills still NEED (vs. generic mana)
 *   - a skill becoming castable this move
 *   - DENYING mana colors the opponent's skills still need
 *   - cascade depth (board momentum)
 *   - a 1-ply opponent-reply lookahead: what does the settled (post-cascade)
 *     board hand the opponent next turn — their best guaranteed skull damage /
 *     4+ extra-turn setup / mana, with a huge penalty if it would be lethal.
 *     Lazily evaluated leader-first until the top move is covered, so the
 *     returned best move ALWAYS accounts for the opponent's reply.
 *
 * It is deliberately NOT wired into any enemy or UI by default:
 *   - enemies opt in via the `smart_matcher` aiBehavior override
 *     (enemyAiOverrides.js) — no enemy definition references it yet
 *   - the player hint comes from BattleController.getSuggestedMove()
 *
 * "Training" surface: DEFAULT_WEIGHTS is the whole personality of this AI.
 * Every objective is a named relative weight, so the AI can be tuned (or a
 * future offline harness can search the weight space) without code changes.
 * Callers may also pass a partial `weights` override per call.
 *
 * COST: one rankMoves call ≈ (legal moves × (1 + samples) cascade sims)
 * + (lookaheadTopK × opponent legal moves) sims. On-demand only — an enemy
 * decision or a hint request — never per frame.
 */

import { simulateSwap, enumerateMoves } from './BoardSimulator.js';

/**
 * Relative objective weights. All scores are sums of (weight × quantity), so
 * any single number can be tuned in isolation. See module header.
 */
export const DEFAULT_WEIGHTS = {
  // Turn economy
  extraTurnGuaranteed: 90,   // a certain extra turn (the mover acts again)
  extraTurnChance: 45,       // × probability of an RNG (refill) extra turn
  // Damage
  skullDamage: 10,           // per point of expected skull damage
  skullDamageGuaranteed: 4,  // ADDITIONAL per guaranteed point (certainty premium)
  lethal: 100000,            // guaranteed skull damage ≥ opponent's remaining pools
  // Mana economy
  manaBase: 1,               // per point of expected mana, any color
  manaNeeded: 5,             // ADDITIONAL per point of a color the mover's skills still need
  skillReady: 35,            // a previously uncastable skill becomes castable
  skillReadyDamage: 20,      // ADDITIONAL when that skill deals damage
  // Denial
  denyOpponent: 3,           // per point of a color the OPPONENT's skills still need
  // Board momentum
  cascade: 6,                // per expected cascade step beyond the first
  // Lookahead (1-ply): penalty × the opponent's best guaranteed reply value.
  // Full weight — what a move hands the opponent counts as much as what it
  // gains us (the "don't set up their 4+" rule).
  opponentReply: -1.0,
  // How the opponent's reply is valued (same units as above)
  replySkullDamage: 10,
  replyExtraTurn: 90,        // mirrors extraTurnGuaranteed — their extra turn is as bad as ours is good
  replyMana: 1.5,
  replyLethal: 100000,       // their guaranteed reply would KILL us — never suggest this
  // Moves that keep the turn (guaranteed extra turn) still get the reply
  // penalty, reduced: the player acts again first and can often defuse or
  // spend the setup, but the danger usually survives the extra move.
  replyAfterExtraTurnFactor: 0.5,
};

/**
 * Max opponent-reply evaluations per rankMoves call (the expensive term).
 * Evaluation is LAZY-converged (see rankMoves): the returned top move is
 * always evaluated, so this is a cost ceiling, not a coverage guarantee for
 * the tail of the ranking.
 */
const DEFAULT_LOOKAHEAD_TOP_K = 12;

/**
 * Per-color mana a combatant's skills still need beyond its current pools:
 * Σ over skills of max(0, cost − have). Colors with 0 need score as generic.
 * @param {object} state — combatant battle state ({ mana, skills })
 * @returns {Object<string, number>}
 */
export function remainingSkillNeeds(state) {
  const needs = {};
  const mana = (state && state.mana) || {};
  for (const skill of (state && state.skills) || []) {
    if (!skill.cost) continue;
    for (const [color, amt] of Object.entries(skill.cost)) {
      const missing = Math.max(0, amt - (mana[color] || 0));
      if (missing > 0) needs[color] = (needs[color] || 0) + missing;
    }
  }
  return needs;
}

/** Whether a skill's effects include a damage-dealing effect. */
function isDamageSkill(skill) {
  return ((skill && skill.effects) || []).some(
    (e) => e.effectType === 'damage' || e.effectType === 'consume'
  );
}

/**
 * Whether `state` could afford `skill` given `extraMana` on top of its pools.
 * @param {object} state @param {object} skill @param {Object<string,number>} extraMana
 */
function affordableWith(state, skill, extraMana) {
  if (!skill.cost) return true;
  const mana = state.mana || {};
  for (const [color, amt] of Object.entries(skill.cost)) {
    if ((mana[color] || 0) + (extraMana[color] || 0) < amt) return false;
  }
  return true;
}

/** Total effective HP pool a lethal must chew through (hp + shields). */
function effectiveHpPool(state) {
  return (state.hp || 0) + (state.armor || 0) + (state.barrier || 0) + (state.block || 0);
}

/**
 * Value of the opponent's single best GUARANTEED reply on `board` — the
 * 1-ply lookahead term. Deterministic sims only (samples: 0): we charge the
 * mover for what the settled board CERTAINLY hands the opponent, not for
 * refill luck.
 * @param {import('./BoardModel.js').default} board
 * @param {object} opponent — combatant battle state
 * @param {object} w — resolved weights
 * @param {object|null} [defender] — the mover's state; when given, a reply
 *   whose guaranteed skull damage is lethal to them adds w.replyLethal
 * @returns {number} best reply value (0 when the opponent has no move)
 */
export function bestOpponentReplyValue(board, opponent, w = DEFAULT_WEIGHTS, defender = null) {
  let best = 0;
  for (const outcome of enumerateMoves(board, opponent, { samples: 0 })) {
    const g = outcome.guaranteed;
    let value = g.skullDamage * w.replySkullDamage
      + (g.extraTurn ? w.replyExtraTurn : 0)
      + g.manaTotal * w.replyMana;
    if (defender && g.skullDamage >= effectiveHpPool(defender)) value += w.replyLethal;
    if (value > best) best = value;
  }
  return best;
}

/**
 * Score one simulated outcome for `self` vs `opponent`. Pure — no board access.
 * Returns { score, breakdown } where breakdown maps objective → contribution
 * (for debugging / hint explanations).
 * @param {import('./BoardSimulator.js').SwapOutcome} outcome
 * @param {object} self @param {object} opponent
 * @param {object} w — resolved weights
 */
export function scoreOutcome(outcome, self, opponent, w) {
  const g = outcome.guaranteed;
  const e = outcome.expected;
  const breakdown = {};

  // Turn economy — a guaranteed extra turn, plus the refill-lottery chance
  // beyond it.
  breakdown.extraTurn = g.extraTurn
    ? w.extraTurnGuaranteed
    : e.extraTurnChance * w.extraTurnChance;

  // Damage — expected damage, with a certainty premium on the guaranteed part
  // and a dominant bonus when the guaranteed part alone is lethal.
  breakdown.skullDamage = e.skullDamage * w.skullDamage
    + g.skullDamage * w.skullDamageGuaranteed;
  breakdown.lethal = (opponent && g.skullDamage >= effectiveHpPool(opponent)) ? w.lethal : 0;

  // Mana economy — every expected point scores the base; points of a color
  // the mover's skills still NEED score extra (capped at the actual need so
  // overshoot doesn't inflate).
  const needs = remainingSkillNeeds(self);
  let manaScore = e.manaTotal * w.manaBase;
  for (const [color, gain] of Object.entries(e.mana)) {
    if (needs[color]) manaScore += Math.min(gain, needs[color]) * w.manaNeeded;
  }
  breakdown.mana = manaScore;

  // Skill readiness — a skill that was NOT castable but becomes castable with
  // this move's expected gains (rounded down per color, conservative).
  let readyScore = 0;
  const roundedGain = {};
  for (const [color, gain] of Object.entries(e.mana)) roundedGain[color] = Math.floor(gain);
  for (const skill of (self && self.skills) || []) {
    if (affordableWith(self, skill, {})) continue; // already castable
    if (affordableWith(self, skill, roundedGain)) {
      readyScore += w.skillReady + (isDamageSkill(skill) ? w.skillReadyDamage : 0);
    }
  }
  breakdown.skillReady = readyScore;

  // Denial — taking colors the opponent's skills still need (capped at their
  // actual need).
  const oppNeeds = remainingSkillNeeds(opponent);
  let denyScore = 0;
  for (const [color, gain] of Object.entries(e.mana)) {
    if (oppNeeds[color]) denyScore += Math.min(gain, oppNeeds[color]) * w.denyOpponent;
  }
  breakdown.deny = denyScore;

  // Board momentum — expected cascades beyond the first.
  breakdown.cascade = Math.max(0, e.cascades - 1) * w.cascade;

  let score = 0;
  for (const v of Object.values(breakdown)) score += v;
  return { score, breakdown };
}

/**
 * Rank every legal move for `self` on `board`, best first.
 *
 * @param {object} ctx
 * @param {import('./BoardModel.js').default} ctx.board — LIVE board (not mutated)
 * @param {object} ctx.self — the moving combatant's battle state
 * @param {object} [ctx.opponent] — the other combatant (enables denial/lethal/lookahead)
 * @param {object} [ctx.weights] — partial DEFAULT_WEIGHTS override
 * @param {number} [ctx.samples] — Monte-Carlo samples per move (default BoardSimulator's)
 * @param {boolean} [ctx.lookahead=true] — apply the opponent-reply penalty
 * @param {number} [ctx.lookaheadTopK] — max reply evaluations (cost ceiling;
 *   evaluation is lazy-converged so the returned top move is always covered)
 * @returns {Array<{swap, score, breakdown, outcome}>} sorted best → worst
 */
export function rankMoves({
  board,
  self,
  opponent = null,
  weights = null,
  samples,
  lookahead = true,
  lookaheadTopK = DEFAULT_LOOKAHEAD_TOP_K,
}) {
  const w = weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS;
  const simOpts = (typeof samples === 'number') ? { samples } : {};

  // Pass 1 — simulate + score every legal move.
  const ranked = [];
  for (const swap of board.getValidSwaps()) {
    const outcome = simulateSwap(board, swap, self, simOpts);
    if (!outcome) continue; // not a legal move (no match)
    const { score, breakdown } = scoreOutcome(outcome, self, opponent, w);
    ranked.push({ swap, score, breakdown, outcome });
  }
  ranked.sort((a, b) => b.score - a.score);

  // Pass 2 — opponent-reply lookahead, LAZY-CONVERGED (it's the expensive
  // term: each evaluation enumerates the opponent's moves on the settled
  // board). We repeatedly evaluate the CURRENT leader and re-sort, stopping
  // only when the leader has already been evaluated — so the returned best
  // move ALWAYS carries its reply penalty. (The old "penalize the pre-penalty
  // top-K then re-sort" let an unevaluated move float to #1 with an
  // optimistic score — exactly the "hint set up the enemy's 4+" bug.)
  // Moves that keep the turn (guaranteed extra turn) are penalized at a
  // reduced factor: the player moves again first, but the setup usually
  // survives their extra move.
  if (lookahead && opponent && ranked.length > 0) {
    let evals = 0;
    const maxEvals = Math.min(Math.max(1, lookaheadTopK), ranked.length);
    while (evals < maxEvals && !ranked[0]._replyEvaluated) {
      const entry = ranked[0];
      entry._replyEvaluated = true;
      evals++;
      const factor = entry.outcome.guaranteed.extraTurn ? w.replyAfterExtraTurnFactor : 1;
      if (factor > 0) {
        const replyValue = bestOpponentReplyValue(entry.outcome.settledBoard, opponent, w, self);
        const penalty = replyValue * w.opponentReply * factor;
        entry.breakdown.opponentReply = penalty;
        entry.score += penalty;
      }
      ranked.sort((a, b) => b.score - a.score);
    }
  }

  return ranked;
}

/**
 * The single best move for `self`, or null when no legal move exists.
 * @param {object} ctx — same shape as rankMoves
 * @returns {{swap, score, breakdown, outcome}|null}
 */
export function getBestMove(ctx) {
  const ranked = rankMoves(ctx);
  return ranked.length > 0 ? ranked[0] : null;
}
