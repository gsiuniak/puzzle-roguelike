/**
 * toolbench/formula.mjs — the DETERMINISTIC formula policy (restored 2026-07-07).
 *
 * WHY THIS EXISTS: the engine-preview search policy (policy.mjs) evaluates
 * candidates through real previews that include refill randomness. Even with
 * common-random-number seeding, different actions consume different draws, so
 * every comparison carries noise — and over ~150 decisions/run the argmax
 * picks noise often enough to cost ~2.5× deployment strength (measured:
 * old-style deterministic evaluation ≈ 40% avg run survival vs ≈ 14-17% for
 * every preview-based variant, same weights/seeds). Deterministic evaluation
 * is noise-FREE: swaps via a no-refill settle ("guaranteed outcome"), casts
 * via per-effect formulas, and — the 2026-07-07 upgrade — TARGETED destroy/
 * convert casts via per-target no-refill simulation (each fracture row is a
 * candidate, evaluated exactly, zero randomness).
 *
 * Cast-hold falls out of castTempo/manaSpent: a cast happens only when its
 * formula value beats the best swap. DEFAULT_FORMULA_WEIGHTS is the CEM
 * training surface (train.mjs --evaluator formula).
 *
 * DETERMINISTIC CHAIN SEARCH (2026-07-07): when a candidate's settle triggers
 * an extra turn, the flat `extraTurn` weight is REPLACED by the discounted
 * value of the best FOLLOW-UP action, evaluated on the settled NO-REFILL
 * board with post-action mana (a strict, exactly-deterministic lower bound —
 * holes sit at the top after gravity, so fewer tiles ⇒ conservative). This is
 * character-agnostic tempo planning (4+ swap chains, inscription→fracture
 * combos, convert→reap loops); the flat weight still prices extra turns at
 * the search horizon. `makeFormulaPolicy(w, { chainDepth })`, default 1.
 */

import { readFileSync } from 'node:fs';
import MatchResolver, { calculateDestroyedSkullDamage } from '../../src/js/game/MatchResolver.js';
import { MANA_COLORS, isSkull, BOARD_COLS, BOARD_ROWS } from '../../src/js/game/TileTypes.js';
import { scaledBonus } from '../../src/js/data/scalingConfig.js';

const resolver = new MatchResolver();

export const DEFAULT_FORMULA_WEIGHTS = {
  skullDamage: 1.0, lethal: 30,
  manaNeeded: 0.8, manaOther: 0.15, denial: 0.2,
  extraTurn: 8, enablesCast: 2.5, tilesCleared: 0.05,
  dmg: 1.0, heal: 0.7, armor: 0.5, barrier: 0.45,
  gainAttack: 3.0, gainMagic: 2.5, gainMaxHp: 0.6,
  poisonStack: 1.6, drainMana: 0.3, gainMana: 0.6,
  statusTurn: 3.0, weakStatusTurn: 1.2,
  createTile: 0.5, skullTile: 0.9, lockTurn: 2.0, markPoint: 4.0, shuffleValue: 1.0,
  manaSpent: 0.55, castTempo: 1.5,
  /* banking / foresight (2026-07-07): */
  manaCloseness: 2.0,   // convex progress toward the best nearly-affordable skill
                        // (the last mana toward a cast is worth more than the first)
  lookaheadSelf: 0.4,   // × my best follow-up value on the settled board (root only)
  lookaheadOpp: 0.4,    // × opponent's best reply value on the settled board (penalty)
};
export const FORMULA_WEIGHT_KEYS = Object.keys(DEFAULT_FORMULA_WEIGHTS);

export function loadFormulaWeights(json) {
  const w = json && typeof json === 'object' ? (json.weights || json) : {};
  const out = {};
  for (const k of FORMULA_WEIGHT_KEYS) if (typeof w[k] === 'number' && Number.isFinite(w[k])) out[k] = w[k];
  return out;
}

/** The tracked WORKING champion weights (sim/toolbench/weights/) — the
 *  strongest verified player. `makeFormulaPolicy(loadChampionWeights())`. */
export const CHAMPION_WEIGHTS_PATH = new URL('./weights/formula-champion.json', import.meta.url);
export function loadChampionWeights() {
  return loadFormulaWeights(JSON.parse(readFileSync(CHAMPION_WEIGHTS_PATH, 'utf8')));
}

const STRONG_STATUS = new Set(['silenced', 'crippled', 'intangible', 'frozen']);
const oppPool = (opp) => Math.max(1, opp.hp) + (opp.armor || 0) + (opp.barrier || 0) + (opp.block || 0);

const costColorsOf = (c) => {
  const m = {};
  for (const s of c.skills || []) for (const col of Object.keys(s.cost || {})) m[col] = (m[col] || 0) + s.cost[col];
  return m;
};

/** Deterministic cascade settle on a caller-owned clone — refill OFF. */
export function settleBoard(board, attacker, maxSteps = 12) {
  const out = { mana: {}, skullDamage: 0, extraTurn: false, tiles: 0 };
  for (let step = 0; step < maxSteps; step++) {
    const a = resolver.analyzeMatches(board, attacker);
    if (!a) break;
    for (const [c, n] of Object.entries(a.mana)) out.mana[c] = (out.mana[c] || 0) + n;
    out.skullDamage += a.skullDamage;
    if (a.extraTurnTrigger) out.extraTurn = true;
    out.tiles += a.positions.length;
    board.removeTiles(a.positions);
    board.applyGravity();
  }
  return out;
}

function manaValue(gained, myColors, oppColors, w) {
  let v = 0;
  for (const [col, n] of Object.entries(gained)) {
    if (n <= 0) continue;
    v += n * (myColors[col] ? w.manaNeeded : w.manaOther);
    if (oppColors[col]) v += n * w.denial;
  }
  return v;
}

/**
 * BANKING #2 — convex affordability progress: 1 − (missing/total), squared, for
 * the BEST-funded not-yet-affordable skill (max, not sum — rewards committing
 * to one plan over spreading). The last mana toward a cast is worth more than
 * the first, so the policy visibly saves toward specific skills.
 */
function bestCloseness(c, mana) {
  let best = 0;
  for (const skill of c.skills || []) {
    const cost = skill.cost || {};
    let missing = 0, total = 0;
    for (const [col, amt] of Object.entries(cost)) {
      total += amt;
      missing += Math.max(0, amt - (mana[col] || 0));
    }
    if (total > 0 && missing > 0) {
      const closeness = 1 - missing / total;
      if (closeness * closeness > best) best = closeness * closeness;
    }
  }
  return best;
}

/** Mana map after applying a delta ({color: ±n}) to c's pool. */
function manaAfter(c, delta) {
  const m = { ...c.mana };
  for (const [col, n] of Object.entries(delta || {})) m[col] = Math.max(0, (m[col] || 0) + n);
  return m;
}

/**
 * BANKING #3 — dynamic-attack (Cestus family) delta from a mana change:
 * spending banked mana of a rule color LOSES attack; gaining it earns attack.
 */
function dynAtkDelta(c, delta) {
  if (!c.dynAtkRules || !c.dynAtkRules.length) return 0;
  let d = 0;
  for (const r of c.dynAtkRules) {
    const before = Math.floor((c.mana[r.color] || 0) / r.per) * r.amount;
    const after = Math.floor(Math.max(0, (c.mana[r.color] || 0) + ((delta || {})[r.color] || 0)) / r.per) * r.amount;
    d += after - before;
  }
  return d;
}

function enablesNewCast(c, gained) {
  for (const skill of c.skills || []) {
    const cost = skill.cost || {};
    if (!Object.keys(cost).length) continue;
    let now = true, after = true;
    for (const [col, amt] of Object.entries(cost)) {
      if ((c.mana[col] || 0) < amt) now = false;
      if ((c.mana[col] || 0) + (gained[col] || 0) < amt) after = false;
    }
    if (!now && after) return true;
  }
  return false;
}

/** Value of a settle outcome for combatant c (shared by swaps + board casts). */
function settleValue(s, c, opp, w, myColors, oppColors) {
  let v = s.skullDamage * w.skullDamage + manaValue(s.mana, myColors, oppColors, w) + s.tiles * w.tilesCleared;
  if (s.extraTurn) v += w.extraTurn;
  if (s.skullDamage >= oppPool(opp)) v += w.lethal;
  if (enablesNewCast(c, s.mana)) v += w.enablesCast;
  return v;
}

const CHAIN_DISCOUNT = 0.9;

/**
 * Discounted value of the best FOLLOW-UP action after an extra-turn trigger:
 * shadow battle on the settled (no-refill) board, combatant with post-action
 * mana (cost spent, settle gains added). Returns null when unavailable
 * (depth exhausted / follow-up evaluation failed on the holey board) —
 * callers then fall back to the flat extraTurn weight.
 */
function chainValue(battle, c, settledBoard, manaGains, costMap, w, depth) {
  if (depth <= 0) return null;
  try {
    const c2 = { ...c, mana: { ...c.mana } };
    if (costMap) for (const [col, amt] of Object.entries(costMap)) c2.mana[col] = Math.max(0, (c2.mana[col] || 0) - amt);
    for (const [col, n] of Object.entries(manaGains || {})) c2.mana[col] = (c2.mana[col] || 0) + n;
    const shadow = Object.create(Object.getPrototypeOf(battle));
    Object.assign(shadow, battle);
    shadow.board = settledBoard;
    if (c === battle.p) shadow.p = c2; else shadow.e = c2;
    const r = bestActionValue(shadow, c2, w, depth - 1);
    return r.action ? CHAIN_DISCOUNT * Math.max(0, r.value) : 0;
  } catch {
    return null; // holey-board edge case — conservative fallback
  }
}

/** Deterministic value of a swap: no-refill settle of the post-swap board.
 *  An extra-turn settle chains into the best follow-up (depth > 0). */
export function evaluateSwapFormula(battle, c, sw, w, myColors, oppColors, depth = 0) {
  const opp = battle.other(c);
  const clone = battle.board.clone();
  clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
  const s = settleBoard(clone, c);
  if (s.tiles === 0) return -Infinity;
  let v = settleValue(s, c, opp, w, myColors, oppColors);
  // banking: convex progress toward the best nearly-affordable skill + Cestus-family attack delta
  v += w.manaCloseness * (bestCloseness(c, manaAfter(c, s.mana)) - bestCloseness(c, c.mana));
  v += dynAtkDelta(c, s.mana) * w.gainAttack;
  if (s.extraTurn) {
    const cb = chainValue(battle, c, clone, s.mana, null, w, depth);
    if (cb != null) v += Math.max(0, cb - w.extraTurn); // upside-only: settle is a lower bound, the flat weight the trained average
  }
  return v;
}

/** Positions of a row/column/area on the live board. */
function targetPositions(board, kind, target, radius = 1) {
  const out = [];
  if (kind === 'row') {
    for (let col = 0; col < BOARD_COLS; col++) if (!board.isEmpty(col, target.row)) out.push({ col, row: target.row });
  } else if (kind === 'column') {
    for (let row = 0; row < BOARD_ROWS; row++) if (!board.isEmpty(target.col, row)) out.push({ col: target.col, row });
  } else {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      const col = target.col + dx, row = target.row + dy;
      if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS && !board.isEmpty(col, row)) out.push({ col, row });
    }
  }
  return out;
}

/** Deterministic value of destroying `positions`: real destroyed-tile rewards
 *  + the no-refill cascade that follows (+ chain into the follow-up on an
 *  extra-turn trigger). */
function destroyValue(battle, c, positions, w, myColors, oppColors, depth = 0, costMap = null) {
  const opp = battle.other(c);
  const clone = battle.board.clone();
  const rw = resolver.resolveDestroyedTileRewards(clone, positions, c);
  clone.removeTiles(positions);
  clone.applyGravity();
  const s = settleBoard(clone, c);
  let v = (rw.skullDamage + s.skullDamage) * w.skullDamage
    + manaValue(rw.mana, myColors, oppColors, w)
    + manaValue(s.mana, myColors, oppColors, w)
    + (positions.length + s.tiles) * w.tilesCleared;
  if (s.extraTurn) {
    v += w.extraTurn;
    const gains = { ...s.mana };
    for (const [col, n] of Object.entries(rw.mana)) gains[col] = (gains[col] || 0) + n;
    const cb = chainValue(battle, c, clone, gains, costMap, w, depth);
    if (cb != null) v += Math.max(0, cb - w.extraTurn); // upside-only: settle is a lower bound, the flat weight the trained average
  }
  if (rw.skullDamage + s.skullDamage >= oppPool(opp)) v += w.lethal;
  return v;
}

/**
 * Formula value of casting `skill`. For board-shaping effects with a `target`
 * (row/column/area/convert spot) the board part is simulated DETERMINISTICALLY;
 * everything else is priced by per-effect formulas (the restored old evaluator).
 * Returns { value, target? }.
 */
export function evaluateCastFormula(battle, c, skill, w, myColors, oppColors, depth = 0) {
  const opp = battle.other(c);
  const board = battle.board;
  const cost = skill.cost || null;
  let best = null; // { value, target } for the targeted board effect (if any)
  let flat = 0;    // formula value of the non-targeted effects
  let dmgTotal = 0;
  let hasExtraTurnEffect = false;
  for (const ef of skill.effects || []) {
    switch (ef.effectType) {
      case 'damage': {
        const d = ef.damage || {};
        const skulls = d.perSkull ? board.getTilesOfType('skull').length : 0;
        const amt = (d.amount == null ? c.attack : d.amount) + (d.perSkull || 0) * skulls + scaledBonus(d.scaling, c);
        const eff = Math.min(amt, oppPool(opp));
        dmgTotal += eff;
        flat += eff * w.dmg;
        if (d.leech && c.hp < c.maxHp) flat += Math.floor(eff * d.leech) * w.heal;
        break;
      }
      case 'heal': {
        const h = ef.heal || {};
        flat += Math.min((h.amount || 0) + scaledBonus(h.scaling, c), c.maxHp - c.hp) * w.heal;
        break;
      }
      case 'armor': { const a = ef.armor || {}; flat += ((a.amount || 0) + scaledBonus(a.scaling, c)) * w.armor; break; }
      case 'barrier': { const b = ef.barrier || {}; flat += ((b.amount || 0) + scaledBonus(b.scaling, c)) * w.barrier; break; }
      case 'extra_turn': flat += w.extraTurn; hasExtraTurnEffect = true; break;
      case 'gain_attack': flat += ((ef.gainAttack && ef.gainAttack.amount) || 1) * w.gainAttack; break;
      case 'gain_magic': flat += ((ef.gainMagic && ef.gainMagic.amount) || 1) * w.gainMagic; break;
      case 'gain_max_hp': flat += ((ef.gainMaxHp && ef.gainMaxHp.amount) || 0) * w.gainMaxHp; break;
      case 'apply_poison': {
        const p = ef.poison || {};
        const skulls = p.perSkull ? board.getTilesOfType('skull').length : 0;
        flat += ((p.amount || 0) + Math.min(p.perSkull ? skulls * p.perSkull : 0, skulls) + scaledBonus(p.scaling, c)) * w.poisonStack;
        break;
      }
      case 'drain_mana': {
        const d = ef.drainMana || {};
        let drained = 0;
        for (const col of d.color ? [d.color] : MANA_COLORS) drained += Math.min(opp.mana[col] || 0, d.amount || 0);
        flat += drained * w.drainMana;
        break;
      }
      case 'gain_mana': {
        const g = ef.gainMana || {};
        if (g.color) flat += (g.amount || 0) * (myColors[g.color] ? w.manaNeeded : w.gainMana);
        break;
      }
      case 'silence': flat += (((ef.silence && ef.silence.turns) || 1)) * w.statusTurn; break;
      case 'set_attack': flat += (((ef.setAttack && ef.setAttack.turns) || 1)) * w.statusTurn; break;
      case 'apply_status': {
        const s = ef.applyStatus || {};
        flat += (s.turns || 1) * (STRONG_STATUS.has(s.id) ? w.statusTurn : w.weakStatusTurn);
        break;
      }
      case 'create_tiles': {
        const ct = ef.createTiles || {};
        const n = ct.amount || 1;
        flat += ct.type === 'skull' ? n * w.skullTile : n * w.createTile * (myColors[ct.type] ? 1.5 : 1);
        break;
      }
      case 'convert_tiles_by_type': {
        const cb = ef.convertByType || {};
        const n = board.getTilesOfType(cb.from || '').length;
        flat += (cb.to || 'skull') === 'skull' ? n * w.skullTile : n * w.createTile * (myColors[cb.to] ? 1.5 : 1);
        break;
      }
      case 'convert_tile': {
        // enumerate match-making spots — each settled deterministically
        const type = (ef.convertTile && ef.convertTile.type) || 'red';
        for (const p of board.getTilesNotOfType(type)) {
          if (!board.positionCreatesMatch(p.col, p.row, type)) continue;
          const clone = board.clone();
          clone.convertTilesToType([{ col: p.col, row: p.row }], type);
          const s = settleBoard(clone, c);
          let v = settleValue(s, c, opp, w, myColors, oppColors);
          if (s.extraTurn) {
            const cb = chainValue(battle, c, clone, s.mana, cost, w, depth);
            if (cb != null) v += Math.max(0, cb - w.extraTurn); // upside-only: settle is a lower bound, the flat weight the trained average
          }
          if (!best || v > best.value) best = { value: v, target: { col: p.col, row: p.row } };
        }
        break;
      }
      case 'destroy_tiles_row': {
        for (let row = 0; row < BOARD_ROWS; row++) {
          const v = destroyValue(battle, c, targetPositions(board, 'row', { row }), w, myColors, oppColors, depth, cost);
          if (!best || v > best.value) best = { value: v, target: { col: 0, row } };
        }
        break;
      }
      case 'destroy_tiles_column': {
        for (let col = 0; col < BOARD_COLS; col++) {
          const v = destroyValue(battle, c, targetPositions(board, 'column', { col }), w, myColors, oppColors, depth, cost);
          if (!best || v > best.value) best = { value: v, target: { col, row: 0 } };
        }
        break;
      }
      case 'destroy_tiles': {
        const r = (skill.area && skill.area.radius != null) ? skill.area.radius : 1;
        for (const col of [1, 3, 5, 6]) for (const row of [1, 3, 5, 6]) {
          const v = destroyValue(battle, c, targetPositions(board, 'area', { col, row }, r), w, myColors, oppColors, depth, cost);
          if (!best || v > best.value) best = { value: v, target: { col, row } };
        }
        break;
      }
      case 'destroy_tiles_by_type': {
        const db = ef.destroyByType || {};
        let n = board.getTilesOfType(db.type || 'skull').length;
        if (db.amount != null) n = Math.min(n, db.amount);
        if ((db.type || 'skull') === 'skull') {
          const dmg = calculateDestroyedSkullDamage(c, n);
          dmgTotal += dmg;
          flat += dmg * w.skullDamage;
        } else flat += n * w.manaOther;
        break;
      }
      case 'transmute_mana': {
        const t = ef.transmuteMana || {};
        flat += (t.amount || 0) * (myColors[t.color] ? w.manaNeeded - w.manaOther : 0);
        break;
      }
      case 'consume': {
        const cs = ef.consume || {};
        const div = Math.max(2, cs.divisor || 2);
        let pool = 0;
        if (cs.resource === 'armor') pool = c.armor;
        else if (cs.resource === 'barrier') pool = c.barrier;
        else if (cs.color) pool = c.mana[cs.color] || 0;
        else for (const col of MANA_COLORS) pool += c.mana[col] || 0;
        const dmg = Math.min(Math.floor(pool / div), oppPool(opp));
        dmgTotal += dmg;
        flat += dmg * w.dmg - pool * w.manaOther;
        break;
      }
      case 'mark': flat += (((ef.mark && ef.mark.multiplier) || 2) - 1) * w.markPoint; break;
      case 'lock_color': flat += Math.max(2, (ef.lockColor && ef.lockColor.turns) || 2) * w.lockTurn; break;
      case 'shuffle': flat += w.shuffleValue; break;
      case 'self_destruct': flat -= 1e6; break;
      default: break;
    }
  }
  if (dmgTotal >= oppPool(opp)) flat += w.lethal;
  // a pure extra-turn cast (no board-shaping target) chains from the CURRENT
  // board with post-cost mana
  if (hasExtraTurnEffect && depth > 0) {
    const cb = chainValue(battle, c, battle.board.clone(), null, cost, w, depth);
    if (cb != null) flat += Math.max(0, cb - w.extraTurn); // upside-only (see chainValue)
  }
  const costTotal = Object.values(skill.cost || {}).reduce((a, b) => a + b, 0);
  // banking: spending mana moves you AWAY from other casts (closeness delta is
  // usually negative here — the hold-vs-spend tension) and sheds Cestus-family attack
  const spendDelta = {};
  for (const [col, amt] of Object.entries(skill.cost || {})) spendDelta[col] = -amt;
  for (const ef of skill.effects || []) {
    if (ef.effectType === 'gain_mana' && ef.gainMana && ef.gainMana.color) {
      spendDelta[ef.gainMana.color] = (spendDelta[ef.gainMana.color] || 0) + (ef.gainMana.amount || 0);
    }
  }
  let base = flat - costTotal * w.manaSpent - w.castTempo;
  base += w.manaCloseness * (bestCloseness(c, manaAfter(c, spendDelta)) - bestCloseness(c, c.mana));
  base += dynAtkDelta(c, spendDelta) * w.gainAttack;
  return best ? { value: base + best.value, target: best.target } : { value: base };
}

/** Best action + value for combatant c (shared by the policy, the chain
 *  recursion, and the lookahead). `collect` (optional array) receives every
 *  scored candidate for root-level re-ranking. */
function bestActionValue(battle, c, w, depth, collect = null) {
  const opp = battle.other(c);
  const myColors = costColorsOf(c);
  const oppColors = costColorsOf(opp);
  let best = null, bestV = -Infinity;
  if (!battle._hasStatus(c, 'silenced')) {
    for (const skill of c.skills || []) {
      if (!battle.canAfford(c, skill)) continue;
      const r = evaluateCastFormula(battle, c, skill, w, myColors, oppColors, depth);
      const action = { type: 'cast', skill, target: r.target || undefined };
      if (collect) collect.push({ action, value: r.value });
      if (r.value > bestV) { bestV = r.value; best = action; }
    }
  }
  for (const sw of battle.board.getValidSwaps()) {
    const v = evaluateSwapFormula(battle, c, sw, w, myColors, oppColors, depth);
    const action = { type: 'swap', swap: sw };
    if (collect) collect.push({ action, value: v });
    if (v > bestV) { bestV = v; best = action; }
  }
  return { action: best, value: bestV };
}

const LOOKAHEAD_BEAM = 3;

/**
 * FORESIGHT #1 — deterministic shadow state after `action`: settled no-refill
 * board + updated mana (cost spent, settle gains added). Reports whether the
 * action retains the turn. Returns null on failure (holey-board edge cases).
 */
function shadowAfter(battle, c, action) {
  try {
    let board = battle.board.clone();
    let gains = {};
    let extraTurn = false;
    if (action.type === 'swap') {
      board.swap(action.swap.col1, action.swap.row1, action.swap.col2, action.swap.row2);
      const s = settleBoard(board, c);
      gains = s.mana;
      extraTurn = s.extraTurn;
    } else {
      for (const ef of action.skill.effects || []) {
        if (ef.effectType === 'extra_turn') extraTurn = true;
        if (!action.target) continue;
        if (ef.effectType === 'convert_tile') {
          board.convertTilesToType([{ col: action.target.col, row: action.target.row }], (ef.convertTile && ef.convertTile.type) || 'red');
          const s = settleBoard(board, c);
          gains = s.mana;
          if (s.extraTurn) extraTurn = true;
          break;
        }
        if (ef.effectType === 'destroy_tiles_row' || ef.effectType === 'destroy_tiles_column' || ef.effectType === 'destroy_tiles') {
          const kind = ef.effectType === 'destroy_tiles_row' ? 'row' : (ef.effectType === 'destroy_tiles_column' ? 'column' : 'area');
          const r = (action.skill.area && action.skill.area.radius != null) ? action.skill.area.radius : 1;
          const positions = targetPositions(board, kind, action.target, r);
          const rw = resolver.resolveDestroyedTileRewards(board, positions, c);
          board.removeTiles(positions);
          board.applyGravity();
          const s = settleBoard(board, c);
          gains = { ...s.mana };
          for (const [col, n] of Object.entries(rw.mana)) gains[col] = (gains[col] || 0) + n;
          if (s.extraTurn) extraTurn = true;
          break;
        }
      }
      for (const [col, amt] of Object.entries(action.skill.cost || {})) gains[col] = (gains[col] || 0) - amt;
    }
    const c2 = { ...c, mana: manaAfter(c, gains) };
    const shadow = Object.create(Object.getPrototypeOf(battle));
    Object.assign(shadow, battle);
    shadow.board = board;
    if (c === battle.p) shadow.p = c2; else shadow.e = c2;
    return { shadow, self2: c2, opp2: c === battle.p ? shadow.e : shadow.p, extraTurn };
  } catch {
    return null;
  }
}

/**
 * The deterministic formula policy. chainDepth levels of extra-turn follow-up
 * planning (default 1) + root-level 1.5-PLY LOOKAHEAD: the top LOOKAHEAD_BEAM
 * candidates are re-ranked by my best FOLLOW-UP on the board they leave (this
 * is where banking/setup emerges — a loaded board scores higher than a small
 * cash-out) minus the OPPONENT's best reply on that same board. Both terms are
 * exact deterministic evaluations; extra-turn candidates skip it (the chain
 * bonus already covers their follow-up, and no opponent reply intervenes).
 */
export function makeFormulaPolicy(weights = {}, { chainDepth = 1, lookahead = true } = {}) {
  const w = { ...DEFAULT_FORMULA_WEIGHTS, ...weights };
  return (battle, c) => {
    if (!lookahead || (w.lookaheadSelf === 0 && w.lookaheadOpp === 0)) {
      return bestActionValue(battle, c, w, chainDepth).action;
    }
    const scored = [];
    bestActionValue(battle, c, w, chainDepth, scored);
    if (!scored.length) return null;
    scored.sort((a, b) => b.value - a.value);
    const K = Math.min(LOOKAHEAD_BEAM, scored.length);
    let best = null, bestV = -Infinity;
    for (let i = 0; i < scored.length; i++) {
      let v = scored[i].value;
      if (i < K && Number.isFinite(v)) {
        const sh = shadowAfter(battle, c, scored[i].action);
        if (sh && !sh.extraTurn) {
          const mine = bestActionValue(sh.shadow, sh.self2, w, 0).value;
          const theirs = bestActionValue(sh.shadow, sh.opp2, w, 0).value;
          if (Number.isFinite(mine)) v += w.lookaheadSelf * Math.max(0, mine);
          if (Number.isFinite(theirs)) v -= w.lookaheadOpp * Math.max(0, theirs);
        }
      }
      if (v > bestV) { bestV = v; best = scored[i].action; }
    }
    return best;
  };
}
