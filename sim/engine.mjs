/**
 * sim/engine.mjs — the headless battle engine.
 *
 * runBattle(playerDef, enemyDef, seed, opts) plays out a single fight as a
 * sequence of abstract "turns" and returns a metrics record. No board grid,
 * no animation — turns are resolved instantly using the economy model in
 * model.mjs plus the game's real damage formulas.
 *
 * Combatant definition shape (plain data, JSON-cloneable):
 *   {
 *     name, maxHp, attack, armor,
 *     mana: { red, blue, ... },          // starting mana (optional)
 *     skills: [ Skill ],                 // see SKILL shape below
 *     passives: [ Passive ],             // see PASSIVE shape below
 *     policy: 'auto' | 'skull' | 'skill' // board-targeting bias (default 'auto')
 *   }
 *
 * Skill shape (sim format — mirrors the catalog but flattened):
 *   { id, name, cost: { color: amount }, effects: [ Effect ] }
 *   Effect: { type, amount?, color?, count? }
 *     supported types: damage | skull_damage | armor | heal | gain_mana |
 *                      drain_mana | gain_attack | create_tiles | destroy_row |
 *                      extra_turn
 *
 * Passive shape (sim format — one trigger+effect per entry):
 *   { trigger, ...Effect, condition? }
 *     triggers: onBattleStart | onTurnStart | onMatch4Plus | onTakeDamage |
 *               onDealDamage | onGainMana | onIncomingDamage
 *     condition (optional): { color?, minCount? }
 *
 * Supported subset is documented in sim/README.md §"Fidelity".
 */

import {
  MANA_COLORS, ECONOMY, makeRng, drawBoardAction,
  destroyedSkullDamage, applyDamage,
} from './model.mjs';

// ── combatant construction ──────────────────────────────────────────────────
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
    // Deep-clone skills/passives so per-battle mutation never leaks across runs.
    skills: JSON.parse(JSON.stringify(def.skills || [])),
    passives: JSON.parse(JSON.stringify(def.passives || [])),
    policy: def.policy || 'auto',
    // metrics
    _dmgDealt: 0, _dmgTaken: 0, _actions: 0, _skillCasts: 0, _skullGroups: 0,
  };
  // Static onBattleStart modifiers (attack buffs, starting-mana grants).
  for (const p of c.passives) {
    if (p.trigger !== 'onBattleStart') continue;
    if ((p.type || p.effect) === 'modify_stat' && p.stat === 'attack') c.attack += p.amount || 0;
    if ((p.type || p.effect) === 'grant_starting_mana') c.mana[p.color] = (c.mana[p.color] || 0) + (p.amount || 0);
  }
  return c;
}

const eff = (e) => e.type || e.effect; // effects use `type`, passives may use `effect`

// ── damage routing (so passives fire uniformly, like BattleController._applyDamage) ─
function dealDamage(attacker, defender, amount, battle) {
  let amt = amount;
  // onIncomingDamage reductions (e.g. Evil Eye)
  for (const p of defender.passives) {
    if (p.trigger === 'onIncomingDamage' && eff(p) === 'reduce_damage') {
      amt = Math.max(0, amt - (p.amount || 0));
    }
  }
  const r = applyDamage(defender, amt);
  if (r.actualDamage > 0) {
    attacker._dmgDealt += r.actualDamage;
    defender._dmgTaken += r.actualDamage;
    // Depth guard: reflect/echo passives (thorns) can chain damage→passive→
    // damage. Cap the chain so two reflectors can't loop forever.
    battle._ddepth = (battle._ddepth || 0) + 1;
    if (battle._ddepth <= 4) {
      firePassives(defender, 'onTakeDamage', battle);
      firePassives(attacker, 'onDealDamage', battle);
    }
    battle._ddepth--;
  }
  return r;
}

// ── atomic effect application (shared by skills and passives) ────────────────
function applyAtomic(e, owner, opp, battle, ctx = {}) {
  switch (eff(e)) {
    case 'damage':
      dealDamage(owner, opp, (e.amount ?? owner.attack), battle);
      return {};
    case 'skull_damage': // modeled stand-in for convert/summon-skull payoff
      dealDamage(owner, opp, destroyedSkullDamage(owner.attack, e.count ?? 0), battle);
      return {};
    case 'armor':
      owner.armor += e.amount ?? 0;
      return {};
    case 'heal':
      owner.hp = Math.min(owner.maxHp, owner.hp + (e.amount ?? 0));
      return {};
    case 'gain_mana':
      owner.mana[e.color] = (owner.mana[e.color] || 0) + (e.amount ?? 0);
      return {};
    case 'drain_mana': {
      const cols = e.color ? [e.color] : MANA_COLORS;
      for (const col of cols) opp.mana[col] = Math.max(0, (opp.mana[col] || 0) - (e.amount ?? 1));
      return {};
    }
    case 'gain_attack':
      owner.attack += e.amount ?? 0;
      return {};
    case 'create_tiles':
      owner.mana[e.color] = (owner.mana[e.color] || 0) +
        Math.round((e.count ?? 0) * battle.econ.CREATE_TILE_MANA_FACTOR);
      return {};
    case 'destroy_row': {
      const tiles = battle.econ.DESTROY_ROW_TILES;
      const skulls = Math.round(tiles * battle.econ.SKULL_BOARD_SHARE);
      dealDamage(owner, opp, destroyedSkullDamage(owner.attack, skulls), battle);
      const per = (tiles - skulls) / 5;
      for (const col of MANA_COLORS) owner.mana[col] += per;
      return {};
    }
    case 'extra_turn':
      return { extraTurn: true };
    default:
      return {};
  }
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
    applyAtomic(p, owner, opp, battle, ctx);
  }
}

// ── policy helpers ───────────────────────────────────────────────────────────
const isDamageSkill = (s) => (s.effects || []).some((e) => eff(e) === 'damage');
function canAfford(c, s) {
  for (const [col, amt] of Object.entries(s.cost || {})) if ((c.mana[col] || 0) < amt) return false;
  return true;
}
function spend(c, s) {
  for (const [col, amt] of Object.entries(s.cost || {})) c.mana[col] -= amt;
}
function skillDamage(s) {
  return (s.effects || []).filter((e) => eff(e) === 'damage').reduce((sum, e) => sum + (e.amount || 0), 0);
}
function primaryColor(s) {
  let best = null, bestAmt = -1;
  for (const [col, amt] of Object.entries(s.cost || {})) if (amt > bestAmt) { best = col; bestAmt = amt; }
  return best;
}

/** Choose a skill to cast this action, or null to make a board move instead. */
function chooseSkill(c) {
  const affordable = (c.skills || []).filter((s) => canAfford(c, s));
  if (affordable.length === 0) return null;
  // 1. best affordable damage skill
  const dmg = affordable.filter(isDamageSkill).sort((a, b) => skillDamage(b) - skillDamage(a));
  if (dmg.length) return dmg[0];
  // 2. heal if hurt
  const heal = affordable.find((s) => (s.effects || []).some((e) => eff(e) === 'heal'));
  if (heal && c.hp < c.maxHp * 0.5) return heal;
  // NOTE: free self-buff skills (e.g. Encroach: gain_attack, ends turn) are
  // deliberately NOT auto-cast here — for a player that just skips dealing
  // damage every turn. Ramp-buff usage needs a dedicated policy (future work);
  // until then, drive attack ramps via the `gain_attack` passive trigger.
  return null;
}

/** Decide which resource a board swap should target: a color id or 'skull'. */
function chooseTarget(c) {
  if (c.policy === 'skull') return 'skull';
  if (c.policy === 'skill') {
    const s = (c.skills || []).find((sk) => !canAfford(c, sk) && primaryColor(sk));
    if (s) return primaryColor(s);
  }
  // 'auto': build toward the cheapest unaffordable damage skill, else go skull.
  for (const s of (c.skills || []).filter(isDamageSkill)) {
    if (!canAfford(c, s)) { const col = primaryColor(s); if (col) return col; }
  }
  return 'skull';
}

// ── a single board action (swap) ─────────────────────────────────────────────
function boardAction(c, battle, rng) {
  const opp = c.side === 'player' ? battle.enemy : battle.player;
  const econ = battle.econ;
  const { tiles, fourPlus } = drawBoardAction(rng, econ);
  const target = chooseTarget(c);

  const focus = Math.round(tiles * econ.FOCUS_FRACTION);
  const incidental = tiles - focus;

  // Incidental skulls (board share) always trickle in regardless of target.
  let skullTiles = Math.round(incidental * econ.SKULL_BOARD_SHARE);
  const incidentalColorTiles = incidental - skullTiles;

  if (target === 'skull') {
    skullTiles += focus;
  } else {
    c.mana[target] = (c.mana[target] || 0) + focus;
    firePassives(c, 'onGainMana', battle, { color: target, amount: focus });
  }

  // Incidental colored mana spread evenly across the five colors.
  const perColor = incidentalColorTiles / 5;
  for (const col of MANA_COLORS) c.mana[col] = (c.mana[col] || 0) + perColor;

  // Skull damage: only tiles that form groups of ≥3 count; (attack−1) per group.
  if (skullTiles >= 3) {
    const groups = Math.floor(skullTiles / econ.SKULL_GROUP_SIZE);
    const inGroups = groups * econ.SKULL_GROUP_SIZE;
    const dmg = inGroups + groups * Math.max(0, c.attack - 1);
    c._skullGroups += groups;
    if (dmg > 0) dealDamage(c, opp, dmg, battle);
  }

  if (fourPlus) firePassives(c, 'onMatch4Plus', battle, { count: 4 });
  return { extraTurn: fourPlus };
}

// ── one full turn for a side (with extra-turn chaining) ──────────────────────
function takeTurn(c, battle, rng) {
  firePassives(c, 'onTurnStart', battle);
  let chain = 0;
  while (battle.player.hp > 0 && battle.enemy.hp > 0) {
    c._actions++;
    const skill = chooseSkill(c);
    let res;
    if (skill) {
      spend(c, skill);
      c._skillCasts++;
      const opp = c.side === 'player' ? battle.enemy : battle.player;
      res = {};
      for (const e of skill.effects || []) {
        const r = applyAtomic(e, c, opp, battle);
        if (r.extraTurn) res.extraTurn = true;
      }
    } else {
      res = boardAction(c, battle, rng);
    }
    if (res && res.extraTurn && chain < battle.econ.MAX_EXTRA_TURN_CHAIN) { chain++; continue; }
    break;
  }
}

// ── public: simulate one battle ──────────────────────────────────────────────
export function runBattle(playerDef, enemyDef, seed, opts = {}) {
  const rng = makeRng(seed);
  const player = makeCombatant(playerDef, 'player');
  const enemy = makeCombatant(enemyDef, 'enemy');
  const econ = { ...ECONOMY, ...(opts.econ || {}) };
  const battle = { player, enemy, econ };
  const playerFirst = opts.playerFirst !== false;

  let round = 0;
  while (player.hp > 0 && enemy.hp > 0 && round < econ.MAX_ROUNDS) {
    if (playerFirst) {
      takeTurn(player, battle, rng);
      if (enemy.hp <= 0) break;
      takeTurn(enemy, battle, rng);
    } else {
      takeTurn(enemy, battle, rng);
      if (player.hp <= 0) break;
      takeTurn(player, battle, rng);
    }
    round++;
  }

  const winner = enemy.hp <= 0 && player.hp > 0 ? 'player'
    : player.hp <= 0 ? 'enemy' : 'draw';

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
    playerDPT: player._dmgDealt / Math.max(1, player._actions),
    playerSkullGroups: player._skullGroups,
    playerSkullGroupsPerAction: player._skullGroups / Math.max(1, player._actions),
    playerSkillCasts: player._skillCasts,
  };
}
