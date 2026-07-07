/**
 * toolbench/features.mjs — GENERIC battle-state featurizer for the learned
 * value function (learn.mjs).
 *
 * Design rule: every feature DESCRIBES the state (rules-derived facts — HP,
 * mana, board composition, affordability distances, who moves next). None
 * encodes a value judgment ("skull damage is good", "extra turns are worth 8")
 * — that is exactly what the learner must discover from outcomes. This is the
 * "plays without knowing why" contract.
 *
 * All features are roughly [0,1]-normalized so a plain logistic regression
 * trains well without per-feature scaling.
 *
 * Perspective: featurize(battle, self, opp, selfToMove) — the SAME state is
 * featurized from either side's perspective; `selfToMove` (1/0) says whose
 * action comes next (this is how the learner can discover tempo/extra-turn
 * value on its own: an action that retains the turn leads to a state with
 * selfToMove=1).
 */

import { MANA_COLORS } from '../../src/js/game/TileTypes.js';
import STATUS_EFFECTS from '../../src/js/data/statusEffects.js';

const STATUS_IDS = Object.keys(STATUS_EFFECTS);
const TILE_KINDS = [...MANA_COLORS, 'skull', 'disease', 'wild', 'thrall'];

export const FEATURE_NAMES = (() => {
  const names = [
    'selfToMove',
    'selfHpFrac', 'oppHpFrac', 'hpFracDelta',
    'selfArmor', 'selfBarrier', 'oppArmor', 'oppBarrier',
    'selfAttack', 'selfMagic', 'oppAttack', 'oppMagic',
    'selfPoison', 'oppPoison', 'selfMark', 'oppMark',
    'selfManaTotal', 'oppManaTotal',
    'selfAffordable', 'oppAffordable',
    'selfMinMissingFrac', 'oppMinMissingFrac',
    'turnCycles', 'validSwaps', 'lockedColors',
  ];
  for (const col of MANA_COLORS) names.push(`selfMana_${col}`);
  for (const kind of TILE_KINDS) names.push(`board_${kind}`);
  for (const id of STATUS_IDS) { names.push(`selfSt_${id}`, `oppSt_${id}`); }
  return names;
})();

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Stable tile-id → plane index for the SPATIAL board encoding (Phase B).
 *  Index 9 = empty/unknown. Order is part of the model contract — do not
 *  reorder without retraining. */
export const TILE_INDEX = ['red', 'blue', 'green', 'yellow', 'purple', 'skull', 'disease', 'wild', 'thrall'];
export const TILE_PLANES = TILE_INDEX.length + 1; // + empty/other

/** 8×8 board as 64 small ints (row-major), for spatial models. */
export function boardTensor(battle) {
  const board = battle.board;
  const out = new Array(board.cols * board.rows);
  let i = 0;
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      const t = board.get(col, row);
      const idx = t ? TILE_INDEX.indexOf(t) : -1;
      out[i++] = idx >= 0 ? idx : TILE_INDEX.length;
    }
  }
  return out;
}

/** affordability facts for a combatant: [affordableCount/4, minMissingFrac] */
function affordability(c) {
  let affordable = 0;
  let minMissing = 1;
  for (const skill of c.skills || []) {
    const cost = skill.cost || {};
    const entries = Object.entries(cost);
    if (!entries.length) { affordable++; minMissing = 0; continue; }
    let missing = 0, total = 0;
    for (const [col, amt] of entries) {
      total += amt;
      missing += Math.max(0, amt - (c.mana[col] || 0));
    }
    if (missing === 0) { affordable++; minMissing = 0; }
    else minMissing = Math.min(minMissing, missing / Math.max(1, total));
  }
  return [clamp01(affordable / 4), clamp01(minMissing)];
}

/**
 * @param {Battle} battle — engine Battle (or a preview of one)
 * @param {object} self / @param {object} opp — the two combatants
 * @param {number} selfToMove — 1 if `self` acts next, else 0
 * @returns {number[]} aligned with FEATURE_NAMES
 */
export function featurize(battle, self, opp, selfToMove) {
  const board = battle.board;
  const cells = (board.cols || 8) * (board.rows || 8);
  const manaTotal = (c) => MANA_COLORS.reduce((a, col) => a + (c.mana[col] || 0), 0);
  const [selfAfford, selfMinMiss] = affordability(self);
  const [oppAfford, oppMinMiss] = affordability(opp);
  const out = [
    selfToMove ? 1 : 0,
    clamp01(Math.max(0, self.hp) / Math.max(1, self.maxHp)),
    clamp01(Math.max(0, opp.hp) / Math.max(1, opp.maxHp)),
    clamp01(0.5 + (self.hp / Math.max(1, self.maxHp) - opp.hp / Math.max(1, opp.maxHp)) / 2),
    clamp01((self.armor || 0) / 20), clamp01((self.barrier || 0) / 20),
    clamp01((opp.armor || 0) / 20), clamp01((opp.barrier || 0) / 20),
    clamp01((self.attack || 0) / 12), clamp01((self.magic || 0) / 12),
    clamp01((opp.attack || 0) / 12), clamp01((opp.magic || 0) / 12),
    clamp01((self.poison || 0) / 12), clamp01((opp.poison || 0) / 12),
    clamp01((self.mark || 0) / 3), clamp01((opp.mark || 0) / 3),
    clamp01(manaTotal(self) / 30), clamp01(manaTotal(opp) / 30),
    selfAfford, oppAfford,
    selfMinMiss, oppMinMiss,
    clamp01((battle.turnCycles || 0) / 40),
    clamp01(board.getValidSwaps().length / 30),
    clamp01([...MANA_COLORS, 'skull'].filter((c) => board.isColorLocked && board.isColorLocked(c)).length / 6),
  ];
  for (const col of MANA_COLORS) out.push(clamp01((self.mana[col] || 0) / 12));
  for (const kind of TILE_KINDS) out.push(clamp01(board.getTilesOfType(kind).length / cells));
  for (const id of STATUS_IDS) {
    out.push(self.statuses && self.statuses.some((s) => s.id === id) ? 1 : 0);
    out.push(opp.statuses && opp.statuses.some((s) => s.id === id) ? 1 : 0);
  }
  return out;
}
