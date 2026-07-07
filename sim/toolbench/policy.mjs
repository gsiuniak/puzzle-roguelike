/**
 * toolbench/policy.mjs — SEARCH POLICY over simulated action previews.
 *
 * Architecture (the chess-engine split — nothing about "what's good" is
 * hard-coded here):
 *   - enumerateActions(): the MOVE GENERATOR. Pure rules: every legal swap,
 *     every affordable cast, and — crucially — every TARGET of a targeted
 *     skill as its own candidate (each fracture row, each inscription spot).
 *     This is what lets a policy *see* "destroy the in-between row to line up
 *     a 4+", instead of being stuck with the engine's auto-target.
 *   - previewAction(): the SIMULATOR. Applies the action on a disposable
 *     clone of the battle THROUGH THE REAL ENGINE — cascades, refill, relic
 *     passives, statuses all fire — so the policy sees actual consequences,
 *     not formula estimates.
 *   - the EVALUATOR judges the previewed afterstate. Pluggable + trained:
 *       makeDeltaEvaluator(weights) — scores the before→after DELTAS with a
 *         weight vector; DEFAULT_VALUE_WEIGHTS is the CEM training surface
 *         (train.mjs learns these from win rates — hand-seeded, not hand-held).
 *       learn.mjs supplies a fully learned V(afterstate) evaluator.
 *   - EXTRA-TURN CHAIN SEARCH: when a previewed action retains the turn, the
 *     policy recursively evaluates the best FOLLOW-UP on the preview (depth-
 *     limited, discounted) — inscription→4+→keep turn→fracture becomes one
 *     scored plan.
 *
 * makeValuePolicy(weights, opts) is the delta-evaluator search policy (the
 * name every other tool imports); old trained-weights JSONs still load
 * (loadWeights filters to known keys).
 */

import { MANA_COLORS } from '../../src/js/game/TileTypes.js';
import MatchResolver from '../../src/js/game/MatchResolver.js';
import { withSeededRandom } from './rng.mjs';

const resolver = new MatchResolver();
const BIG = 1e9;
const CHAIN_DISCOUNT = 0.9;
const SWAP_BEAM = 12; // fully preview at most this many swaps (cheap-settle prefilter)

/** Fast combatant clone for previews: deep-copies MUTABLE battle state, shares
 *  immutable defs (skills/relics are never mutated mid-battle by the engine). */
function cloneCombatant(c) {
  return {
    ...c,
    mana: { ...c.mana },
    statuses: (c.statuses || []).map((s) => ({ ...s })),
    dealt: { ...c.dealt },
  };
}

/* ═══════════════════ the training surface (delta weights) ══════════════════ */

export const DEFAULT_VALUE_WEIGHTS = {
  /* observed before→after deltas (all in ~"1 point of damage" currency) */
  dmg: 1.0,             // damage dealt to the opponent's pool (hp+armor+barrier+block)
  selfLoss: 1.0,        // own pool lost (self-damage / retaliation seen in preview)
  lethal: 30,           // the preview kills the opponent
  heal: 0.7,            // own HP recovered
  armor: 0.5,           // own armor gained
  barrier: 0.45,
  gainAttack: 3.0,      // permanent attack gained (ramp)
  gainMagic: 2.5,
  gainMaxHp: 0.6,
  poisonStack: 1.6,     // poison added to the opponent (minus poison taken)
  manaNeeded: 0.8,      // +1 mana of a color my skills cost
  manaOther: 0.15,
  manaSpent: 0.4,       // mana leaving my pool (cast costs — opportunity cost)
  denial: 0.2,          // opponent mana removed
  enablesCast: 2.5,     // a previously unaffordable skill becomes affordable
  statusTurn: 3.0,      // strong status turns applied to the opponent
  weakStatusTurn: 1.2,
  markPoint: 4.0,       // mark multiplier armed
  lockTurn: 2.0,
  createTile: 0.5,      // board gained tiles of colors I need (deferred mana)
  skullTile: 0.7,       // board gained skulls (ammo — for either side)
  extraTurn: 8,         // retained turn at the search HORIZON (unchained leaf)
  castTempo: 1.5,       // flat cost of casting instead of swapping
};

export const WEIGHT_KEYS = Object.keys(DEFAULT_VALUE_WEIGHTS);

/** Load a weights map from a train.mjs JSON ({weights} or bare), known keys only. */
export function loadWeights(json) {
  const w = json && typeof json === 'object' ? (json.weights || json) : {};
  const out = {};
  for (const k of WEIGHT_KEYS) if (typeof w[k] === 'number' && Number.isFinite(w[k])) out[k] = w[k];
  return out;
}

/* ═══════════════════════ preview (the simulator) ═══════════════════════════ */

/** Disposable copy of a Battle sharing its prototype — engine methods run on
 *  cloned combatants + board without touching the real battle. */
export function previewBattle(battle) {
  const b = Object.create(Object.getPrototypeOf(battle));
  Object.assign(b, battle);
  b.p = cloneCombatant(battle.p);
  b.e = cloneCombatant(battle.e);
  b.board = battle.board.clone();
  b.log = null;
  b.opts = { ...battle.opts, playerPolicy: null, enemyPolicy: null };
  return b;
}

/** Apply `action` for side `c` on a preview. Returns { preview, self, opp, extraTurn }.
 *  `seed` (optional): run the application under a seeded RNG — the search
 *  passes the SAME seed to every candidate at a decision node (common random
 *  numbers), so refill luck can't decide the argmax (the optimizer's-curse
 *  fix: a single noisy sample per candidate systematically favors lucky
 *  previews; identical streams make the comparison fair). */
export function previewAction(battle, c, action, seed = null) {
  const apply = () => {
    const b = previewBattle(battle);
    const self = c === battle.p ? b.p : b.e;
    const opp = c === battle.p ? b.e : b.p;
    let extraTurn = false;
    if (action.type === 'cast') extraTurn = b._castSkill(self, action.skill, action.target || null);
    else if (action.type === 'swap') extraTurn = b._performSwap(self, action.swap);
    return { preview: b, self, opp, extraTurn };
  };
  return seed == null ? apply() : withSeededRandom(seed >>> 0, apply);
}

/* ═══════════════════ move generator (pure rules, no judgment) ══════════════ */

const AREA_CENTERS = (() => {
  const out = [];
  for (const col of [1, 3, 5, 6]) for (const row of [1, 3, 5, 6]) out.push({ col, row });
  return out;
})();

/** Candidate targets for a skill's first targeted effect (empty = untargeted). */
export function enumerateTargets(battle, c, skill) {
  for (const ef of skill.effects || []) {
    switch (ef.effectType) {
      case 'destroy_tiles_row': {
        const out = [];
        for (let row = 0; row < battle.board.rows; row++) out.push({ col: 0, row });
        return out;
      }
      case 'destroy_tiles_column': {
        const out = [];
        for (let col = 0; col < battle.board.cols; col++) out.push({ col, row: 0 });
        return out;
      }
      case 'destroy_tiles': return AREA_CENTERS;
      case 'convert_tile': {
        const type = (ef.convertTile && ef.convertTile.type) || 'red';
        const out = [];
        for (const p of battle.board.getTilesNotOfType(type)) {
          if (battle.board.positionCreatesMatch(p.col, p.row, type)) out.push({ col: p.col, row: p.row });
          if (out.length >= 12) break;
        }
        return out; // may be empty → single untargeted candidate (engine picks)
      }
      default: break;
    }
  }
  return [];
}

/** Cheap deterministic settle (no refill, board-only) used ONLY as a WIDE
 *  prefilter beam over swaps — full engine previews are too expensive for all
 *  ~25 valid swaps × chain depth. Every extra-turn-triggering swap always
 *  survives the beam; judgment still happens in the evaluator. */
function quickSwapScore(battle, c, sw) {
  const clone = battle.board.clone();
  clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
  let score = 0;
  for (let step = 0; step < 6; step++) {
    const a = resolver.analyzeMatches(clone, c);
    if (!a) break;
    score += a.skullDamage * 2 + a.positions.length * 0.3;
    for (const n of Object.values(a.mana)) score += n * 0.5;
    if (a.extraTurnTrigger) score += 1000; // never beam out a turn-retainer
    clone.removeTiles(a.positions);
    clone.applyGravity();
  }
  return score;
}

/** Every legal action for `c`: affordable casts × candidate targets + the
 *  beam-filtered swaps. */
export function enumerateActions(battle, c, { swapBeam = SWAP_BEAM } = {}) {
  const actions = [];
  if (!battle._hasStatus(c, 'silenced')) {
    for (const skill of c.skills || []) {
      if (!battle.canAfford(c, skill)) continue;
      const targets = enumerateTargets(battle, c, skill);
      if (targets.length) for (const target of targets) actions.push({ type: 'cast', skill, target });
      else actions.push({ type: 'cast', skill });
    }
  }
  let swaps = battle.board.getValidSwaps();
  if (swaps.length > swapBeam) {
    swaps = swaps
      .map((sw) => ({ sw, s: quickSwapScore(battle, c, sw) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, swapBeam)
      .map((x) => x.sw);
  }
  for (const sw of swaps) actions.push({ type: 'swap', swap: sw });
  return actions;
}

/* ═══════════════════ delta evaluator (CEM training surface) ════════════════ */

const pool = (x) => Math.max(0, x.hp) + (x.armor || 0) + (x.barrier || 0) + (x.block || 0);
const manaTotalOf = (c) => MANA_COLORS.reduce((a, col) => a + (c.mana[col] || 0), 0);
const statusTurnsOf = (c, strong) => (c.statuses || []).reduce((a, s) =>
  a + (STRONG_STATUS.has(s.id) === strong ? (s.turns || 1) : 0), 0);
const STRONG_STATUS = new Set(['silenced', 'crippled', 'intangible', 'frozen', 'reflecting']);

const costColorsOf = (c) => {
  const m = {};
  for (const s of c.skills || []) for (const col of Object.keys(s.cost || {})) m[col] = (m[col] || 0) + s.cost[col];
  return m;
};

function affordableCount(c) {
  let n = 0;
  for (const skill of c.skills || []) {
    let ok = true;
    for (const [col, amt] of Object.entries(skill.cost || {})) if ((c.mana[col] || 0) < amt) { ok = false; break; }
    if (ok) n++;
  }
  return n;
}

/**
 * Score the observable before→after deltas of a previewed action.
 * mode 'add' — chain search ADDS discounted follow-up value.
 */
export function makeDeltaEvaluator(weights = {}) {
  const w = { ...DEFAULT_VALUE_WEIGHTS, ...weights };
  const fn = (battle, c, opp, action, preview, self, pOpp, extraTurn, atHorizon) => {
    const myColors = costColorsOf(c);
    const oppColors = costColorsOf(opp);
    let v = 0;
    v += Math.max(0, pool(opp) - pool(pOpp)) * w.dmg;
    v -= Math.max(0, pool(c) - pool(self)) * w.selfLoss;
    v += Math.max(0, self.hp - c.hp) * w.heal;
    v += Math.max(0, (self.armor || 0) - (c.armor || 0)) * w.armor;
    v += Math.max(0, (self.barrier || 0) - (c.barrier || 0)) * w.barrier;
    v += ((self.attack || 0) - (c.attack || 0)) * w.gainAttack;
    v += ((self.magic || 0) - (c.magic || 0)) * w.gainMagic;
    v += Math.max(0, (self.maxHp || 0) - (c.maxHp || 0)) * w.gainMaxHp;
    v += (((pOpp.poison || 0) - (opp.poison || 0)) - ((self.poison || 0) - (c.poison || 0))) * w.poisonStack;
    for (const col of MANA_COLORS) {
      const d = (self.mana[col] || 0) - (c.mana[col] || 0);
      if (d > 0) v += d * (myColors[col] ? w.manaNeeded : w.manaOther);
      else if (d < 0) v += d * w.manaSpent; // d negative → subtracts
      const od = (opp.mana[col] || 0) - (pOpp.mana[col] || 0);
      if (od > 0) v += od * (oppColors[col] ? w.denial : w.denial * 0.5);
    }
    if (affordableCount(self) > affordableCount(c) && manaTotalOf(self) >= manaTotalOf(c)) v += w.enablesCast;
    v += Math.max(0, statusTurnsOf(pOpp, true) - statusTurnsOf(opp, true)) * w.statusTurn;
    v += Math.max(0, statusTurnsOf(pOpp, false) - statusTurnsOf(opp, false)) * w.weakStatusTurn;
    v += Math.max(0, (self.mark || 0) - (c.mark || 0)) * w.markPoint;
    const locked = (b) => [...MANA_COLORS, 'skull'].filter((col) => b.isColorLocked && b.isColorLocked(col)).length;
    v += Math.max(0, locked(preview.board) - locked(battle.board)) * w.lockTurn;
    // board composition shifts (create/convert effects observed generically)
    for (const col of MANA_COLORS) {
      const d = preview.board.getTilesOfType(col).length - battle.board.getTilesOfType(col).length;
      if (d > 0 && myColors[col]) v += d * w.createTile;
    }
    v += (preview.board.getTilesOfType('skull').length - battle.board.getTilesOfType('skull').length) * w.skullTile;
    if (extraTurn && atHorizon) v += w.extraTurn; // unchained leaf — chain search handles the rest
    if (action.type === 'cast') v -= w.castTempo;
    return v;
  };
  fn.mode = 'add';
  return fn;
}

/* ═══════════════════════════ the search policy ═════════════════════════════ */

/**
 * makeSearchPolicy(evaluator, { chainDepth }) — argmax over enumerated,
 * previewed actions; extra-turn actions recurse into the best follow-up.
 * evaluator(battle, c, opp, action, preview, self, pOpp, extraTurn, atHorizon)
 *   → scalar. evaluator.mode: 'add' (chain adds discounted follow-up — delta
 *   evaluators) | 'replace' (an afterstate V already encodes the future; chain
 *   REPLACES the leaf value with the deeper evaluation — learned-V).
 */
export function makeSearchPolicy(evaluator, { chainDepth = 1, swapBeam = 14, chainSwapBeam = 8, epsilon = 0 } = {}) {
  function bestValue(battle, c, depth, baseSeed) {
    const opp = battle.other(c);
    const actions = enumerateActions(battle, c, { swapBeam: depth === chainDepth ? swapBeam : chainSwapBeam });
    if (!actions.length) return { action: null, value: 0 };
    // ONE preview seed per decision node — every candidate sees the same
    // refill stream (common random numbers; see previewAction)
    const nodeSeed = (baseSeed ^ Math.imul(depth + 1, 0x9e3779b9)) >>> 0;
    let best = null, bestV = -Infinity;
    for (const action of actions) {
      const { preview, self, opp: pOpp, extraTurn } = previewAction(battle, c, action, nodeSeed);
      let v;
      if (pOpp.hp <= 0 && !pOpp.isEgg) v = BIG + Math.max(0, self.hp); // win — prefer healthier wins
      else if (self.hp <= 0) v = -BIG;
      else {
        const canChain = extraTurn && depth > 0;
        v = evaluator(battle, c, opp, action, preview, self, pOpp, extraTurn, !canChain);
        if (canChain) {
          const follow = bestValue(preview, self, depth - 1, nodeSeed);
          if (evaluator.mode === 'replace') v = follow.action ? follow.value : v;
          else v += CHAIN_DISCOUNT * Math.max(0, follow.value);
        }
      }
      if (v > bestV) { bestV = v; best = action; }
    }
    return { action: best, value: bestV };
  }
  return (battle, c) => {
    if (epsilon > 0 && Math.random() < epsilon) {
      const actions = enumerateActions(battle, c);
      return actions.length ? actions[Math.floor(Math.random() * actions.length)] : null;
    }
    const baseSeed = Math.floor(Math.random() * 0xffffffff); // ambient (battle-seeded) → deterministic
    return bestValue(battle, c, chainDepth, baseSeed).action; // null → engine greedy fallback (reshuffle)
  };
}

/** The standard trained policy: delta evaluator + chain search. */
export function makeValuePolicy(weights = {}, opts = {}) {
  return makeSearchPolicy(makeDeltaEvaluator(weights), opts);
}
