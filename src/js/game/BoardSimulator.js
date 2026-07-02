/**
 * BoardSimulator — pure, headless cascade prediction for AI and player hints.
 *
 * No rendering, no battle-state mutation, no timers. Given a board (and
 * optionally a candidate swap), it predicts what a move would actually
 * resolve into by running the SAME logic the battle uses (MatchResolver +
 * BoardModel gravity/refill) on a clone:
 *
 *   - the DETERMINISTIC outcome — matches + cascades formed purely by the
 *     tiles already on the board falling into place. Refill is skipped, so
 *     every number here is GUARANTEED regardless of tile RNG.
 *   - the EXPECTED outcome — Monte-Carlo sampled full resolutions (refill ON,
 *     using the board's real effective spawn weights, including relic
 *     spawn-rate boosts carried on the board clone). Averages capture the
 *     upside of lucky refills: bonus cascades, extra mana, surprise 4+
 *     matches. `extraTurnChance` is the fraction of samples that triggered an
 *     extra turn.
 *
 * Consumers:
 *   - MoveAdvisor (the general move-ranking AI — enemy-capable + player hints)
 *   - any future "preview what this swap does" UI
 *
 * Locked colors, wild (Thrall) substitution, inert (Disease) tiles and the
 * skull-damage attack scaling all behave exactly as in battle because the
 * simulation reuses BoardModel.clone() + MatchResolver verbatim.
 *
 * NOTE ON COST: a full `enumerateMoves` over an 8×8 board is on the order of
 * a few hundred cascade resolutions — fine as an on-demand, once-per-decision
 * computation (an enemy turn, a hint request), NOT something to run per frame.
 */

import MatchResolver from './MatchResolver.js';

/** Shared stateless resolver instance (analyzeMatches holds no state). */
const resolver = new MatchResolver();

/** Hard cap on cascade steps per resolution (mirrors MatchResolver.maxCascades). */
const MAX_CASCADE_STEPS = 30;

/** Default Monte-Carlo sample count for the expected (refill-aware) outcome. */
export const DEFAULT_SAMPLES = 4;

/** @returns {OutcomeTotals} a zeroed totals accumulator */
function emptyTotals() {
  return {
    mana: {},          // per-color mana gained
    manaTotal: 0,      // total mana across colors
    skullDamage: 0,    // raw skull damage (attacker-attack scaled, pre-mitigation)
    extraTurn: false,  // any step triggered a 4+ extra turn
    cascades: 0,       // resolution steps (1 = just the initial match)
    tilesDestroyed: 0, // total tiles cleared
    matches4Plus: 0,   // count of individual 4+ matches seen
  };
}

/**
 * Resolve a board IN PLACE until no matches remain, accumulating totals.
 * With `refill` false the top of each column stays empty after gravity, so
 * only cascades formed by existing tiles are counted (the guaranteed part).
 *
 * @param {import('./BoardModel.js').default} sim — a CLONE (will be mutated)
 * @param {{attack:number}} attacker — whose attack scales skull damage
 * @param {boolean} refill — spawn new tiles between steps (introduces RNG)
 * @returns {OutcomeTotals}
 */
export function resolveBoardInPlace(sim, attacker, refill) {
  const totals = emptyTotals();
  for (let step = 0; step < MAX_CASCADE_STEPS; step++) {
    const a = resolver.analyzeMatches(sim, attacker);
    if (!a) break;
    totals.cascades++;
    totals.skullDamage += a.skullDamage;
    totals.tilesDestroyed += a.tilesDestroyed;
    if (a.extraTurnTrigger) totals.extraTurn = true;
    for (const m of a.matches) {
      if (m.count >= 4) totals.matches4Plus++;
    }
    for (const [color, n] of Object.entries(a.mana)) {
      if (n > 0) {
        totals.mana[color] = (totals.mana[color] || 0) + n;
        totals.manaTotal += n;
      }
    }
    sim.removeTiles(a.positions);
    sim.applyGravity();
    if (refill) sim.refill();
  }
  return totals;
}

/**
 * Simulate a single candidate swap.
 *
 * @param {import('./BoardModel.js').default} board — the LIVE board (not mutated)
 * @param {{col1:number,row1:number,col2:number,row2:number}} swap
 * @param {{attack:number}} [attacker]
 * @param {{samples?:number}} [opts] — Monte-Carlo samples for the expected
 *   outcome; 0 = skip sampling (expected mirrors guaranteed)
 * @returns {SwapOutcome|null} null when the swap is not a legal move (no match)
 */
export function simulateSwap(board, swap, attacker = { attack: 1 }, opts = {}) {
  const samples = (typeof opts.samples === 'number') ? opts.samples : DEFAULT_SAMPLES;

  // Validity check on a throwaway clone: the swap must produce an immediate match.
  const swapped = board.clone();
  swapped.swap(swap.col1, swap.row1, swap.col2, swap.row2);
  if (!resolver.analyzeMatches(swapped, attacker)) return null;

  // Deterministic pass — no refill, so everything counted is guaranteed.
  const settled = swapped.clone();
  const guaranteed = resolveBoardInPlace(settled, attacker, false);

  // Monte-Carlo pass — full resolutions with refill, averaged.
  let expected;
  if (samples > 0) {
    const acc = emptyTotals();
    let extraTurnHits = 0;
    for (let s = 0; s < samples; s++) {
      const run = resolveBoardInPlace(swapped.clone(), attacker, true);
      acc.manaTotal += run.manaTotal;
      acc.skullDamage += run.skullDamage;
      acc.cascades += run.cascades;
      acc.tilesDestroyed += run.tilesDestroyed;
      acc.matches4Plus += run.matches4Plus;
      if (run.extraTurn) extraTurnHits++;
      for (const [color, n] of Object.entries(run.mana)) {
        acc.mana[color] = (acc.mana[color] || 0) + n;
      }
    }
    for (const color of Object.keys(acc.mana)) acc.mana[color] /= samples;
    expected = {
      mana: acc.mana,
      manaTotal: acc.manaTotal / samples,
      skullDamage: acc.skullDamage / samples,
      cascades: acc.cascades / samples,
      tilesDestroyed: acc.tilesDestroyed / samples,
      matches4Plus: acc.matches4Plus / samples,
      extraTurnChance: extraTurnHits / samples,
    };
  } else {
    expected = {
      mana: { ...guaranteed.mana },
      manaTotal: guaranteed.manaTotal,
      skullDamage: guaranteed.skullDamage,
      cascades: guaranteed.cascades,
      tilesDestroyed: guaranteed.tilesDestroyed,
      matches4Plus: guaranteed.matches4Plus,
      extraTurnChance: guaranteed.extraTurn ? 1 : 0,
    };
  }

  return {
    swap,
    guaranteed,
    expected,
    // The deterministic post-move board (holes where refill tiles would land).
    // Useful for opponent-reply lookahead: everything on it is certain.
    settledBoard: settled,
  };
}

/**
 * Enumerate every legal move (valid swap that produces a match) with its
 * simulated outcome. Convenience wrapper for AI / hint consumers.
 *
 * @param {import('./BoardModel.js').default} board — the LIVE board (not mutated)
 * @param {{attack:number}} [attacker]
 * @param {{samples?:number}} [opts]
 * @returns {Array<SwapOutcome>}
 */
export function enumerateMoves(board, attacker = { attack: 1 }, opts = {}) {
  const outcomes = [];
  for (const swap of board.getValidSwaps()) {
    const outcome = simulateSwap(board, swap, attacker, opts);
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * @typedef {Object} OutcomeTotals
 * @property {Object<string,number>} mana — mana gained per color
 * @property {number} manaTotal
 * @property {number} skullDamage — raw (pre-mitigation) skull damage
 * @property {boolean} extraTurn — any step triggered an extra turn
 * @property {number} cascades — resolution steps
 * @property {number} tilesDestroyed
 * @property {number} matches4Plus
 */

/**
 * @typedef {Object} SwapOutcome
 * @property {{col1:number,row1:number,col2:number,row2:number}} swap
 * @property {OutcomeTotals} guaranteed — deterministic (no-refill) outcome
 * @property {{mana:Object<string,number>, manaTotal:number, skullDamage:number,
 *   cascades:number, tilesDestroyed:number, matches4Plus:number,
 *   extraTurnChance:number}} expected — Monte-Carlo averaged outcome
 * @property {import('./BoardModel.js').default} settledBoard — deterministic
 *   post-move board (unfilled holes)
 */
