/**
 * toolbench/policy.mjs — featurized VALUE POLICY for the engine's policy seam.
 *
 * A policy for `new Battle(p, e, { playerPolicy/enemyPolicy })` that evaluates
 * EVERY candidate action (each affordable cast + each legal swap) with one
 * shared linear value function over hand-designed features, and plays argmax.
 *
 * Why linear-over-features (not a net, not deep search):
 *   - the WEIGHTS are the interpretable balance model — training them tells
 *     you what an extra turn / a skull point / a mana of a needed color is
 *     actually worth (the re-scoring signal);
 *   - skills are featurized BY THEIR EFFECTS, not by id, so the same policy
 *     evaluates woven/synthesized skills it has never seen;
 *   - cast-hold falls out naturally: a cast happens only when its estimated
 *     value beats the best swap (fixes greedy's "cast whenever affordable"
 *     artifacts — Encroach spam, Defend-over-swap, 3-match Inscription).
 *
 * Swap evaluation uses a DETERMINISTIC settle (cascade with refill OFF, same
 * philosophy as src BoardSimulator's "guaranteed" outcome): what the swap
 * certainly yields regardless of refill luck.
 *
 * WEIGHTS: `DEFAULT_VALUE_WEIGHTS` is the hand-seeded personality and the
 * TRAINING SURFACE — train.mjs optimizes exactly this vector (CEM self-play).
 * All estimates share the currency "≈1 point of damage".
 */

import MatchResolver, { calculateDestroyedSkullDamage } from '../../src/js/game/MatchResolver.js';
import { MANA_COLORS, isSkull } from '../../src/js/game/TileTypes.js';
import { scaledBonus } from '../../src/js/data/scalingConfig.js';

const resolver = new MatchResolver();

export const DEFAULT_VALUE_WEIGHTS = {
  /* board outcomes (per point / per event) */
  skullDamage: 1.0,     // skull damage dealt to the opponent
  lethal: 30,           // this action kills (through armor+barrier+block)
  manaNeeded: 0.8,      // +1 mana of a color my skills cost
  manaOther: 0.15,      // +1 mana of any other color
  denial: 0.2,          // +1 mana of a color the OPPONENT's skills cost
  extraTurn: 8,         // the action retains the turn
  enablesCast: 2.5,     // a previously unaffordable skill becomes affordable
  tilesCleared: 0.05,   // board churn (cascade potential)
  /* skill effects (per point, effect-featurized — works for woven skills) */
  dmg: 1.0,             // direct damage (capped vs opp's effective pool)
  heal: 0.7,            // effective healing (capped by missing HP)
  armor: 0.5,
  barrier: 0.45,
  gainAttack: 3.0,      // permanent +1 attack (ramp)
  gainMagic: 2.5,
  gainMaxHp: 0.6,
  poisonStack: 1.6,
  drainMana: 0.3,       // per mana actually drainable from the opponent
  gainMana: 0.6,        // per mana granted by the skill itself
  statusTurn: 3.0,      // strong status (silence/cripple/intangible/frozen) per turn
  weakStatusTurn: 1.2,  // other statuses per turn
  createTile: 0.5,      // per tile created/converted toward a useful type
  skullTile: 0.9,       // per SKULL tile created (ambient damage potential)
  lockTurn: 2.0,        // per turn of a color lock
  markPoint: 4.0,       // per +1x of a mark multiplier
  shuffleValue: 1.0,
  /* action costs */
  manaSpent: 0.55,      // opportunity cost per mana spent on a cast (subtracted)
  castTempo: 1.5,       // flat tempo cost of casting instead of swapping (subtracted)
};

export const WEIGHT_KEYS = Object.keys(DEFAULT_VALUE_WEIGHTS);

const STRONG_STATUS = new Set(['silenced', 'crippled', 'intangible', 'frozen']);

/** Deterministic cascade settle on a (caller-owned) board clone — refill OFF. */
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

const costColorsOf = (combatant) => {
  const m = {};
  for (const s of combatant.skills || []) {
    for (const [col, amt] of Object.entries(s.cost || {})) m[col] = (m[col] || 0) + amt;
  }
  return m;
};

const oppPool = (opp) => Math.max(1, opp.hp) + (opp.armor || 0) + (opp.barrier || 0) + (opp.block || 0);

/** Would gaining `gained` mana make a currently unaffordable skill affordable? */
function enablesNewCast(c, gained) {
  for (const skill of c.skills || []) {
    const cost = skill.cost || {};
    if (!Object.keys(cost).length) continue;
    let affordableNow = true, affordableAfter = true;
    for (const [col, amt] of Object.entries(cost)) {
      if ((c.mana[col] || 0) < amt) affordableNow = false;
      if ((c.mana[col] || 0) + (gained[col] || 0) < amt) affordableAfter = false;
    }
    if (!affordableNow && affordableAfter) return true;
  }
  return false;
}

/** Value of the mana bundle `gained` for combatant c (needed/other/denial). */
function manaValue(gained, myColors, oppColors, w) {
  let v = 0;
  for (const [col, n] of Object.entries(gained)) {
    if (n <= 0) continue;
    v += n * (myColors[col] ? w.manaNeeded : w.manaOther);
    if (oppColors[col]) v += n * w.denial;
  }
  return v;
}

/** Estimate the value of casting `skill` right now (effect-featurized). */
export function estimateCastValue(battle, c, skill, w) {
  const opp = battle.other(c);
  const board = battle.board;
  const myColors = costColorsOf(c);
  const oppColors = costColorsOf(opp);
  let v = 0;
  let dmgTotal = 0;
  for (const ef of skill.effects || []) {
    switch (ef.effectType) {
      case 'damage': {
        const d = ef.damage || {};
        const skulls = d.perSkull ? board.getTilesOfType('skull').length : 0;
        const amt = (d.amount == null ? c.attack : d.amount) + (d.perSkull || 0) * skulls + scaledBonus(d.scaling, c);
        const eff = Math.min(amt, oppPool(opp));
        dmgTotal += eff;
        v += eff * w.dmg;
        if (d.leech) v += Math.floor(eff * d.leech) * w.heal * (c.hp < c.maxHp ? 1 : 0);
        break;
      }
      case 'heal': {
        const h = ef.heal || {};
        const amt = (h.amount || 0) + scaledBonus(h.scaling, c);
        v += Math.min(amt, c.maxHp - c.hp) * w.heal;
        break;
      }
      case 'armor': { const a = ef.armor || {}; v += ((a.amount || 0) + scaledBonus(a.scaling, c)) * w.armor; break; }
      case 'barrier': { const b = ef.barrier || {}; v += ((b.amount || 0) + scaledBonus(b.scaling, c)) * w.barrier; break; }
      case 'extra_turn': v += w.extraTurn; break;
      case 'gain_attack': v += ((ef.gainAttack && ef.gainAttack.amount) || 1) * w.gainAttack; break;
      case 'gain_magic': v += ((ef.gainMagic && ef.gainMagic.amount) || 1) * w.gainMagic; break;
      case 'gain_max_hp': v += ((ef.gainMaxHp && ef.gainMaxHp.amount) || 0) * w.gainMaxHp; break;
      case 'apply_poison': {
        const p = ef.poison || {};
        const skulls = p.perSkull ? board.getTilesOfType('skull').length : 0;
        const stacks = (p.amount || 0) + Math.min(p.perSkull ? skulls * p.perSkull : 0, skulls) + scaledBonus(p.scaling, c);
        v += stacks * w.poisonStack;
        break;
      }
      case 'drain_mana': {
        const d = ef.drainMana || {};
        let drained = 0;
        for (const col of d.color ? [d.color] : MANA_COLORS) drained += Math.min(opp.mana[col] || 0, d.amount || 0);
        v += drained * w.drainMana;
        break;
      }
      case 'gain_mana': {
        const g = ef.gainMana || {};
        if (g.color) v += (g.amount || 0) * (myColors[g.color] ? w.manaNeeded : w.gainMana);
        break;
      }
      case 'silence': v += (((ef.silence && ef.silence.turns) || 1)) * w.statusTurn; break;
      case 'set_attack': v += (((ef.setAttack && ef.setAttack.turns) || 1)) * w.statusTurn; break;
      case 'apply_status': {
        const s = ef.applyStatus || {};
        v += (s.turns || 1) * (STRONG_STATUS.has(s.id) ? w.statusTurn : w.weakStatusTurn);
        break;
      }
      case 'create_tiles': {
        const ct = ef.createTiles || {};
        const n = ct.amount || 1;
        if (ct.type === 'skull') v += n * w.skullTile;
        else v += n * w.createTile * (myColors[ct.type] ? 1.5 : 1);
        break;
      }
      case 'convert_tile': {
        // simulate: only worth casting when it completes a match; 4+ = extra turn
        const type = (ef.convertTile && ef.convertTile.type) || 'red';
        const spot = battle._bestConvertSpot(c, type);
        if (spot) {
          const clone = board.clone();
          clone.convertTilesToType([{ col: spot.col, row: spot.row }], type);
          const s = settleBoard(clone, c);
          v += s.skullDamage * w.skullDamage + manaValue(s.mana, myColors, oppColors, w) + s.tiles * w.tilesCleared;
          if (s.extraTurn) v += w.extraTurn;
          dmgTotal += s.skullDamage;
        }
        break;
      }
      case 'convert_tiles_by_type': {
        const cb = ef.convertByType || {};
        const n = board.getTilesOfType(cb.from || '').length;
        if ((cb.to || 'skull') === 'skull') v += n * w.skullTile;
        else v += n * w.createTile * (myColors[cb.to] ? 1.5 : 1);
        break;
      }
      case 'destroy_tiles_row': case 'destroy_tiles_column': {
        const lineLen = 8;
        let bestSkulls = 0; // engine auto-targets the most-skull line
        const horizontal = ef.effectType === 'destroy_tiles_row';
        for (let i = 0; i < 8; i++) {
          let s = 0;
          for (let j = 0; j < 8; j++) {
            const t = horizontal ? board.get(j, i) : board.get(i, j);
            if (t && isSkull(t)) s++;
          }
          bestSkulls = Math.max(bestSkulls, s);
        }
        const dmg = calculateDestroyedSkullDamage(c, bestSkulls);
        dmgTotal += dmg;
        v += dmg * w.skullDamage + (lineLen - bestSkulls) * w.manaOther + lineLen * w.tilesCleared;
        break;
      }
      case 'destroy_tiles': {
        const r = (skill.area && skill.area.radius != null) ? skill.area.radius : 1;
        const size = (2 * r + 1) ** 2;
        let bestSkulls = 0;
        for (let col = 0; col < 8; col++) for (let row = 0; row < 8; row++) {
          let s = 0;
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            const t = board.get(col + dx, row + dy);
            if (t && isSkull(t)) s++;
          }
          bestSkulls = Math.max(bestSkulls, s);
        }
        const dmg = calculateDestroyedSkullDamage(c, bestSkulls);
        dmgTotal += dmg;
        v += dmg * w.skullDamage + Math.max(0, size - bestSkulls) * w.manaOther + size * w.tilesCleared;
        break;
      }
      case 'destroy_tiles_by_type': {
        const db = ef.destroyByType || {};
        let n = board.getTilesOfType(db.type || 'skull').length;
        if (db.amount != null) n = Math.min(n, db.amount);
        if ((db.type || 'skull') === 'skull') {
          const dmg = calculateDestroyedSkullDamage(c, n);
          dmgTotal += dmg;
          v += dmg * w.skullDamage;
        } else v += n * w.manaOther;
        break;
      }
      case 'transmute_mana': {
        const t = ef.transmuteMana || {};
        v += (t.amount || 0) * (myColors[t.color] ? w.manaNeeded - w.manaOther : 0);
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
        v += dmg * w.dmg - pool * w.manaOther; // spends the pool
        break;
      }
      case 'mark': v += (((ef.mark && ef.mark.multiplier) || 2) - 1) * w.markPoint; break;
      case 'lock_color': v += Math.max(2, (ef.lockColor && ef.lockColor.turns) || 2) * w.lockTurn; break;
      case 'shuffle': v += w.shuffleValue; break;
      case 'self_destruct': v -= 1e6; break;
      default: break;
    }
  }
  if (dmgTotal >= oppPool(opp)) v += w.lethal;
  const costTotal = Object.values(skill.cost || {}).reduce((a, b) => a + b, 0);
  return v - costTotal * w.manaSpent - w.castTempo;
}

/** Value of a swap: deterministic settle of the post-swap board. */
export function evaluateSwapValue(battle, c, sw, w) {
  const opp = battle.other(c);
  const myColors = costColorsOf(c);
  const oppColors = costColorsOf(opp);
  const clone = battle.board.clone();
  clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
  const s = settleBoard(clone, c);
  if (s.tiles === 0) return -Infinity; // not a match-making swap
  let v = s.skullDamage * w.skullDamage
    + manaValue(s.mana, myColors, oppColors, w)
    + s.tiles * w.tilesCleared;
  if (s.extraTurn) v += w.extraTurn;
  if (s.skullDamage >= oppPool(opp)) v += w.lethal;
  if (enablesNewCast(c, s.mana)) v += w.enablesCast;
  return v;
}

/**
 * Build a policy for the Battle seam. Plays argmax over all casts + swaps.
 * Returns null (→ engine greedy fallback, incl. reshuffle) when no candidate.
 */
export function makeValuePolicy(weights = {}) {
  const w = { ...DEFAULT_VALUE_WEIGHTS, ...weights };
  return (battle, c) => {
    let best = null, bestVal = -Infinity;
    if (!battle._hasStatus(c, 'silenced')) {
      for (const skill of c.skills || []) {
        if (!battle.canAfford(c, skill)) continue;
        const v = estimateCastValue(battle, c, skill, w);
        if (v > bestVal) { bestVal = v; best = { type: 'cast', skill }; }
      }
    }
    for (const sw of battle.board.getValidSwaps()) {
      const v = evaluateSwapValue(battle, c, sw, w);
      if (v > bestVal) { bestVal = v; best = { type: 'swap', swap: sw }; }
    }
    return best;
  };
}

/** Load weights from a trainer/train.mjs JSON report ({weights} or bare map). */
export function loadWeights(json) {
  const w = json && typeof json === 'object' ? (json.weights || json) : {};
  const out = {};
  for (const k of WEIGHT_KEYS) if (typeof w[k] === 'number' && Number.isFinite(w[k])) out[k] = w[k];
  return out;
}
