/**
 * sim/engine.mjs — headless battle on a REAL board with a greedy "smart" AI.
 *
 * No rendering. Each turn the active side evaluates every legal swap on the
 * actual 8×8 grid, scores the resulting matches (damage / mana-toward-skill /
 * match-4 extra-turn / shape), and plays the best one — or casts a skill when
 * that scores higher. The real cascade then resolves (gravity + random refill),
 * granting mana/skull damage per step, exactly like the game.
 *
 * Because decisions are made on the real board, the economy constants the old
 * abstract model ASSUMED (skull matches/turn `m`, 4+ rate, cascade depth, mana/
 * turn) are instead MEASURED and reported back — that's the point.
 *
 * Combatant def: { name, maxHp, attack, armor, mana?, skills?, passives? }
 * Skill (sim): { id, name, cost:{color:amt}, effects:[{type, amount?, color?, count?}] }
 *   effect types: damage | armor | heal | gain_mana | gain_attack | extra_turn |
 *                 create_tiles | destroy_row
 * Passive (sim): { trigger, type, amount?, color?, stat?, condition? }
 */

import { Board, COLORS, isSkull } from './board.mjs';
import { makeRng, matchedSkullDamage, destroyedSkullDamage, applyDamage } from './model.mjs';

// ── AI / valuation weights (tunable knobs — these shape "smart") ─────────────
export const AI = {
  EXTRA_TURN_VALUE: 4.0,  // HPe an extra turn is worth (≈ one average action)
  SHAPE_BONUS: 0.5,       // small bonus for L/T/cross shapes
  TILE_BONUS: 0.1,        // per-tile nudge → prefer bigger clears (cascade potential)
  BASE_MANA_VALUE: 0.05,  // HPe per mana of a color you can't currently use
  HEAL_HP_THRESHOLD: 0.6, // only value a heal skill when below this HP fraction
  MAX_EXTRA_TURN_CHAIN: 5,
};

const eff = (e) => e.type || e.effect;
const totalCost = (s) => Object.values(s.cost || {}).reduce((a, b) => a + b, 0);
const isDamageSkill = (s) => (s.effects || []).some((e) => eff(e) === 'damage');
const canAfford = (c, s) => Object.entries(s.cost || {}).every(([col, amt]) => (c.mana[col] || 0) >= amt);
const spend = (c, s) => { for (const [col, amt] of Object.entries(s.cost || {})) c.mana[col] -= amt; };

function makeCombatant(def, side) {
  const c = {
    side,
    name: def.name || side,
    maxHp: def.maxHp ?? def.hp ?? 30,
    hp: def.maxHp ?? def.hp ?? 30,
    attack: def.attack ?? 1,
    armor: def.armor ?? 0,
    block: 0,
    mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0, ...(def.mana || {}) },
    skills: JSON.parse(JSON.stringify(def.skills || [])),
    passives: JSON.parse(JSON.stringify(def.passives || [])),
    // metrics
    _dmgDealt: 0, _dmgTaken: 0, _actions: 0, _skillCasts: 0, _skullGroups: 0,
    _fourPlus: 0, _cascadeSteps: 0, _tilesCleared: 0, _manaGained: 0,
  };
  for (const p of c.passives) {
    if (p.trigger !== 'onBattleStart') continue;
    if (eff(p) === 'modify_stat' && p.stat === 'attack') c.attack += p.amount || 0;
    if (eff(p) === 'grant_starting_mana') c.mana[p.color] = (c.mana[p.color] || 0) + (p.amount || 0);
  }
  return c;
}

// ── skill valuation (HPe) ─────────────────────────────────────────────────────
function skillValue(skill, side) {
  let v = 0;
  for (const e of skill.effects || []) {
    switch (eff(e)) {
      case 'damage': v += e.amount ?? side.attack; break;
      case 'extra_turn': v += AI.EXTRA_TURN_VALUE; break;
      case 'armor': case 'heal': v += (e.amount || 0) * 0.8; break;
      case 'create_tiles': v += (e.count || 0) * 0.5; break;
      case 'gain_attack': v += (e.amount || 0) * 2; break;
      case 'destroy_row': v += 5; break;
      default: break;
    }
  }
  return v;
}

// Value of actually casting now (heal only counts when hurt & restoring).
function skillCastValue(skill, side) {
  let v = 0;
  for (const e of skill.effects || []) {
    if (eff(e) === 'heal') {
      if (side.hp < side.maxHp * AI.HEAL_HP_THRESHOLD) v += Math.min(e.amount || 0, side.maxHp - side.hp) * 0.8;
    } else {
      switch (eff(e)) {
        case 'damage': v += e.amount ?? side.attack; break;
        case 'extra_turn': v += AI.EXTRA_TURN_VALUE; break;
        case 'armor': v += (e.amount || 0) * 0.8; break;
        case 'create_tiles': v += (e.count || 0) * 0.5; break;
        case 'gain_attack': v += (e.amount || 0) * 2; break;
        case 'destroy_row': v += 5; break;
        default: break;
      }
    }
  }
  return v;
}

// HPe value of +1 mana of each color, driven by the best damage skill's ratio.
function manaValueTable(side) {
  const table = {};
  for (const c of COLORS) table[c] = AI.BASE_MANA_VALUE;
  let best = null, bestRatio = 0;
  for (const sk of side.skills || []) {
    if (!isDamageSkill(sk)) continue;
    const cost = totalCost(sk);
    if (cost <= 0) continue;
    const ratio = skillValue(sk, side) / cost;
    if (ratio > bestRatio) { bestRatio = ratio; best = sk; }
  }
  if (best) for (const col of Object.keys(best.cost)) table[col] = Math.max(table[col], bestRatio);
  return table;
}

function scoreMatches(matches, side, manaVals) {
  if (!matches.length) return -Infinity;
  let score = 0, has4 = false, tiles = 0;
  for (const m of matches) {
    tiles += m.count;
    if (m.count >= 4) has4 = true;
    if (isSkull(m.typeId)) score += matchedSkullDamage(side.attack, m.count);
    else score += m.count * (manaVals[m.typeId] ?? AI.BASE_MANA_VALUE);
    if (m.isShape) score += AI.SHAPE_BONUS;
  }
  if (has4) score += AI.EXTRA_TURN_VALUE;
  score += tiles * AI.TILE_BONUS;
  return score;
}

// ── damage routing (passives fire uniformly) ─────────────────────────────────
function dealDamage(attacker, defender, amount, battle) {
  let amt = amount;
  for (const p of defender.passives) {
    if (p.trigger === 'onIncomingDamage' && eff(p) === 'reduce_damage') amt = Math.max(0, amt - (p.amount || 0));
  }
  const r = applyDamage(defender, amt);
  if (r.actualDamage > 0) {
    attacker._dmgDealt += r.actualDamage;
    defender._dmgTaken += r.actualDamage;
    battle._ddepth = (battle._ddepth || 0) + 1;
    if (battle._ddepth <= 4) {
      firePassives(defender, 'onTakeDamage', battle);
      firePassives(attacker, 'onDealDamage', battle);
    }
    battle._ddepth--;
  }
  return r;
}

function passesCondition(cond, ctx) {
  if (!cond) return true;
  if (cond.color != null && ctx.color !== cond.color) return false;
  if (cond.minCount != null && !(ctx.count >= cond.minCount)) return false;
  return true;
}

function firePassives(owner, trigger, battle, ctx = {}) {
  const opp = owner.side === 'player' ? battle.enemy : battle.player;
  for (const p of owner.passives) {
    if (p.trigger !== trigger) continue;
    if (!passesCondition(p.condition, ctx)) continue;
    switch (eff(p)) {
      case 'damage': dealDamage(owner, opp, p.amount ?? owner.attack, battle); break;
      case 'armor': owner.armor += p.amount || 0; break;
      case 'heal': owner.hp = Math.min(owner.maxHp, owner.hp + (p.amount || 0)); break;
      case 'gain_mana': owner.mana[p.color] = (owner.mana[p.color] || 0) + (p.amount || 0); break;
      case 'gain_attack': owner.attack += p.amount || 0; break;
      case 'drain_mana': { const cols = p.color ? [p.color] : COLORS; for (const col of cols) opp.mana[col] = Math.max(0, (opp.mana[col] || 0) - (p.amount || 1)); break; }
      default: break; // reduce_damage handled in dealDamage; board passives not modeled here
    }
  }
}

// ── cascade resolution (real board) ──────────────────────────────────────────
function resolveCascades(board, side, opp, battle) {
  let extraTurn = false, steps = 0;
  while (steps < 60) {
    const matches = board.findAllConnectedMatches();
    if (!matches.length) break;
    steps++;
    let any4 = false;
    for (const m of matches) {
      side._tilesCleared += m.count;
      if (isSkull(m.typeId)) {
        side._skullGroups += 1;
        dealDamage(side, opp, matchedSkullDamage(side.attack, m.count), battle);
      } else {
        side.mana[m.typeId] = (side.mana[m.typeId] || 0) + m.count;
        side._manaGained += m.count;
        firePassives(side, 'onGainMana', battle, { color: m.typeId, amount: m.count });
      }
      if (m.count >= 4) any4 = true;
    }
    if (any4) { extraTurn = true; side._fourPlus += 1; firePassives(side, 'onMatch4Plus', battle, { count: 4 }); }
    const positions = [];
    for (const m of matches) for (const p of m.positions) positions.push(p);
    board.removeTiles(positions);
    board.applyGravity();
    board.refill();
    if (opp.hp <= 0) break;
  }
  side._cascadeSteps += steps;
  return { extraTurn };
}

function castSkill(side, opp, skill, battle) {
  spend(side, skill);
  side._skillCasts += 1;
  let extraTurn = false, boardTouched = false;
  for (const e of skill.effects || []) {
    switch (eff(e)) {
      case 'damage': dealDamage(side, opp, e.amount ?? side.attack, battle); break;
      case 'armor': side.armor += e.amount || 0; break;
      case 'heal': side.hp = Math.min(side.maxHp, side.hp + (e.amount || 0)); break;
      case 'gain_mana': side.mana[e.color] = (side.mana[e.color] || 0) + (e.amount || 0); break;
      case 'gain_attack': side.attack += e.amount || 0; break;
      case 'extra_turn': extraTurn = true; break;
      case 'create_tiles': battle.board.convertRandomTiles(e.color, e.count || 0); boardTouched = true; break;
      case 'destroy_row': {
        const removed = battle.board.destroyRandomRow();
        let sk = 0;
        for (const id of removed) { if (isSkull(id)) sk++; else { side.mana[id] = (side.mana[id] || 0) + 1; side._manaGained++; } }
        if (sk > 0) dealDamage(side, opp, destroyedSkullDamage(side.attack, sk), battle);
        battle.board.applyGravity(); battle.board.refill(); boardTouched = true;
        break;
      }
      default: break;
    }
  }
  if (boardTouched) { const r = resolveCascades(battle.board, side, opp, battle); if (r.extraTurn) extraTurn = true; }
  return { extraTurn };
}

// ── the smart decision ───────────────────────────────────────────────────────
function chooseAction(side, opp, board) {
  const manaVals = manaValueTable(side);

  // best legal swap (scored on the real board; pruned by a cheap match test)
  const swaps = board.getValidSwaps();
  let bestSwap = null, bestSwapScore = -Infinity;
  for (const sw of swaps) {
    board.swap(sw.c1, sw.r1, sw.c2, sw.r2);
    if (board.hasMatchAt(sw.c1, sw.r1) || board.hasMatchAt(sw.c2, sw.r2)) {
      const s = scoreMatches(board.findAllConnectedMatches(), side, manaVals);
      if (s > bestSwapScore) { bestSwapScore = s; bestSwap = sw; }
    }
    board.swap(sw.c1, sw.r1, sw.c2, sw.r2); // undo
  }

  // best affordable skill (by cast value now)
  let bestSkill = null, bestSkillVal = 0;
  for (const sk of side.skills || []) {
    if (!canAfford(side, sk)) continue;
    const v = skillCastValue(sk, side);
    if (v > bestSkillVal) { bestSkillVal = v; bestSkill = sk; }
  }

  if (bestSkill && bestSkillVal >= bestSwapScore) return { type: 'skill', skill: bestSkill };
  if (bestSwap) return { type: 'swap', swap: bestSwap };
  return { type: 'reshuffle' };
}

function takeTurn(side, opp, battle) {
  firePassives(side, 'onTurnStart', battle);
  let chain = 0;
  while (side.hp > 0 && opp.hp > 0) {
    side._actions += 1;
    const action = chooseAction(side, opp, battle.board);
    let res = {};
    if (action.type === 'skill') res = castSkill(side, opp, action.skill, battle);
    else if (action.type === 'swap') { battle.board.swap(action.swap.c1, action.swap.r1, action.swap.c2, action.swap.r2); res = resolveCascades(battle.board, side, opp, battle); }
    else { battle.board.initialize(); } // no move: reshuffle, no reward
    if (res && res.extraTurn && chain < AI.MAX_EXTRA_TURN_CHAIN && side.hp > 0 && opp.hp > 0) { chain++; continue; }
    break;
  }
}

export function runBattle(playerDef, enemyDef, seed, opts = {}) {
  const rng = makeRng(seed);
  const player = makeCombatant(playerDef, 'player');
  const enemy = makeCombatant(enemyDef, 'enemy');
  const board = new Board(8, 8, rng);
  board.initialize();
  const battle = { player, enemy, board, rng };
  const maxRounds = opts.maxRounds ?? 200;
  const playerFirst = opts.playerFirst !== false;

  let round = 0;
  while (player.hp > 0 && enemy.hp > 0 && round < maxRounds) {
    if (playerFirst) {
      takeTurn(player, enemy, battle);
      if (enemy.hp <= 0) break;
      takeTurn(enemy, player, battle);
    } else {
      takeTurn(enemy, player, battle);
      if (player.hp <= 0) break;
      takeTurn(player, enemy, battle);
    }
    round++;
  }

  const winner = enemy.hp <= 0 && player.hp > 0 ? 'player' : player.hp <= 0 ? 'enemy' : 'draw';
  const a = Math.max(1, player._actions);
  return {
    winner,
    rounds: round,
    playerActions: player._actions,
    enemyActions: enemy._actions,
    playerHp: Math.max(0, player.hp),
    playerHpFrac: player.hp / player.maxHp,
    enemyHp: Math.max(0, enemy.hp),
    playerDmgDealt: player._dmgDealt,
    playerDmgTaken: player._dmgTaken,
    playerDPT: player._dmgDealt / a,
    playerSkillCasts: player._skillCasts,
    // EMERGENT economy metrics (measured, not assumed):
    skullGroupsPerAction: player._skullGroups / a,   // = m in the research doc
    fourPlusPerAction: player._fourPlus / a,          // extra-turn rate
    cascadeStepsPerAction: player._cascadeSteps / a,  // >1 ⇒ cascades happening
    manaPerAction: player._manaGained / a,
  };
}
