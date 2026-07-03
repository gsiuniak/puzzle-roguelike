/**
 * toolbench/analytic.mjs — fast analytic (DEV) scoring for the Balance Toolbench.
 *
 * This is the SCREENING layer (docs/balance-power-model.md §5): it prices
 * skills, relics and enemies on one damage-equivalent scale so outliers pop
 * instantly. The simulation (engine.mjs) is the ground truth; use this to rank
 * and to sanity-check, not to ship numbers.
 *
 * All constants live in CAL (exported, mutable via the UI's Calibration panel).
 */

import { scaledBonus } from '../../src/js/data/scalingConfig.js';
import { calculateMatchedSkullDamage, calculateDestroyedSkullDamage } from '../../src/js/game/MatchResolver.js';
import { ENEMY_HP_FLOOR_MULT, ENEMY_ATTACK_FLOOR_BONUS, MAGIC_MANA_PER_POINT } from './engine.mjs';

/* ── calibration [MODEL] — every number here is a tunable assumption ──────── */
export const CAL_DEFAULT = {
  // value equivalences (DEV per unit)
  DEV_damage: 1.0,
  DEV_armor: 0.9,
  DEV_barrier: 0.9,
  DEV_heal: 0.9,
  DEV_poisonStack: 1.4,     // ~2× raw over the halving tail, discounted for absorption/fight end
  DEV_tile: 0.5,            // a created color tile = deferred mana
  DEV_skullTile: 0.5,       // a skull placed on the board (ammo; opponent can reap it too)
  DEV_attack_perm: 6.0,     // permanent +1 attack, mid-length fight
  DEV_magic_perm: 5.0,
  DEV_maxHp: 0.5,
  DEV_statusTurn: 4.0,      // one turn of a strong status (silence/cripple) on the opponent
  V_mana: 2.8,              // DEV a point of mana buys via the best skill it funds
  econEff: 0.35,            // fraction of granted/drained mana that converts to real value
  V_turn_floor: 4.0,        // extra-turn value floor (real value = own per-turn output)
  // play model (measured anchors — see §7 of the doc; re-measure in Matchup Lab)
  skullMatchPerTurn: 0.30,
  colorMatchPerTurn: 0.85,
  match4PerTurn: 0.20,
  Nskull: 3.3,
  fightTurns: 7,
  takeHitsPerTurn: 1.0,
  dealEventsPerTurn: 2.0,
  colorGainPerTurn: 0.35,   // gain-events of ONE specific color per turn
  standingMana: 4,          // avg unspent mana of one color (Cestus-group pricing)
  spawnPPValue: 0.10,       // DEV/turn of +1 percentage point spawn chance of a wanted tile
  winsPerFloor: 0.7,        // victories per floor climbed (map fight density)
  E_SKULLS: 13.3, E_COLOR: 10.7, E_DISEASE: 3,
  // bands
  vpmBand: [2.5, 3.5],
  dmgPerManaMin: 1.6, dmgPerManaStrong: 2.5,
  fightBands: { minion: [6, 10], elite: [12, 18], boss: [20, 30] },
  winBands: { minion: [0.85, 0.95], elite: [0.65, 0.8], boss: [0.45, 0.65] },
  burstShareMax: { minion: 0.45, elite: 0.6, boss: 0.6 },
};
export const CAL = { ...CAL_DEFAULT };
export function resetCal() { Object.assign(CAL, CAL_DEFAULT); }

const totalCost = (skill) => Object.values(skill.cost || {}).reduce((a, b) => a + b, 0);

/** own per-turn output ≈ value of an extra turn (never a flat constant) */
export function extraTurnValue(stats, cal = CAL) {
  const skullDev = cal.skullMatchPerTurn * calculateMatchedSkullDamage(stats, cal.Nskull) * cal.DEV_damage;
  const manaDev = cal.colorMatchPerTurn * (3.2 + Math.floor((stats.magic || 0) / MAGIC_MANA_PER_POINT)) * cal.V_mana * cal.econEff;
  return Math.max(cal.V_turn_floor, skullDev + manaDev);
}

/* ── skill pricing ─────────────────────────────────────────────────────────── */

/**
 * Price ONE effect in DEV for an owner with `stats`. Returns { dev, dmg, note }
 * (dmg = raw damage contribution, for the dmg/mana threshold check).
 */
export function effectDEV(ef, stats, cal = CAL) {
  const s = stats;
  switch (ef.effectType) {
    case 'damage': {
      const d = ef.damage || {};
      const amt = (d.amount == null ? (s.attack || 1) : d.amount)
        + (d.perSkull || 0) * cal.E_SKULLS + scaledBonus(d.scaling, s);
      return { dev: amt * cal.DEV_damage, dmg: amt };
    }
    case 'heal': { const h = ef.heal || {}; const amt = (h.amount || 0) + scaledBonus(h.scaling, s); return { dev: amt * cal.DEV_heal, dmg: 0 }; }
    case 'armor': { const a = ef.armor || {}; const amt = (a.amount || 0) + scaledBonus(a.scaling, s); return { dev: amt * cal.DEV_armor, dmg: 0 }; }
    case 'barrier': { const b = ef.barrier || {}; const amt = (b.amount || 0) + scaledBonus(b.scaling, s); return { dev: amt * cal.DEV_barrier, dmg: 0 }; }
    case 'apply_poison': {
      const p = ef.poison || {};
      const amt = (p.amount || 0) + (p.perSkull ? Math.min(cal.E_SKULLS * p.perSkull, cal.E_SKULLS) : 0) + scaledBonus(p.scaling, s);
      return { dev: amt * cal.DEV_poisonStack, dmg: amt * 1.4 };
    }
    case 'extra_turn': return { dev: extraTurnValue(s, cal), dmg: 0 };
    case 'gain_attack': return { dev: ((ef.gainAttack && ef.gainAttack.amount) || 1) * cal.DEV_attack_perm, dmg: 0 };
    case 'gain_magic': return { dev: ((ef.gainMagic && ef.gainMagic.amount) || 1) * cal.DEV_magic_perm, dmg: 0 };
    case 'gain_max_hp': return { dev: ((ef.gainMaxHp && ef.gainMaxHp.amount) || 0) * cal.DEV_maxHp, dmg: 0 };
    case 'gain_mana': return { dev: ((ef.gainMana && ef.gainMana.amount) || 0) * cal.V_mana * cal.econEff, dmg: 0 };
    case 'drain_mana': {
      const d = ef.drainMana || {};
      const breadth = d.color ? 1 : 2.5; // "every color" mostly drains the colors they actually bank
      return { dev: (d.amount || 0) * breadth * cal.V_mana * cal.econEff, dmg: 0 };
    }
    case 'transmute_mana': return { dev: ((ef.transmuteMana && ef.transmuteMana.amount) || 0) * cal.V_mana * cal.econEff * 0.5, dmg: 0 };
    case 'create_tiles': {
      const ct = ef.createTiles || {};
      if (ct.type === 'skull') {
        const per = cal.DEV_skullTile * (1 + Math.max(0, (s.attack || 1) - 1) / 3);
        return { dev: (ct.amount || 0) * per, dmg: (ct.amount || 0) * per * 0.6 };
      }
      return { dev: (ct.amount || 0) * cal.DEV_tile, dmg: 0 };
    }
    case 'convert_tile': return { dev: 1.0 + cal.DEV_tile, dmg: 0, note: 'match enabler' };
    case 'convert_tiles_by_type': {
      const cb = ef.convertByType || {};
      const n = cb.from === 'skull' ? cal.E_SKULLS : (cb.from === 'disease' ? cal.E_DISEASE : cal.E_COLOR);
      if (cb.to === 'skull') {
        const per = cal.DEV_skullTile * (1 + Math.max(0, (s.attack || 1) - 1) / 3);
        return { dev: n * per, dmg: n * per * 0.6, note: `≈${n.toFixed(1)} tiles` };
      }
      return { dev: n * cal.DEV_tile, dmg: 0, note: `≈${n.toFixed(1)} tiles` };
    }
    case 'destroy_tiles_row':
    case 'destroy_tiles_column': {
      const lines = typeof ef._lines === 'number' ? ef._lines : 1;
      return destroyDEV(8 * lines, s, cal);
    }
    case 'destroy_tiles': return destroyDEV(9, s, cal); // 3×3 default
    case 'destroy_tiles_by_type': {
      const db = ef.destroyByType || {};
      const n = db.amount != null ? db.amount : (db.type === 'skull' ? cal.E_SKULLS : cal.E_COLOR);
      if (db.type === 'skull') {
        const dmg = calculateDestroyedSkullDamage(s, n);
        return { dev: dmg * cal.DEV_damage, dmg };
      }
      return { dev: n * cal.V_mana * cal.econEff * 0.5, dmg: 0 };
    }
    case 'silence': return { dev: ((ef.silence && ef.silence.turns) || 1) * cal.DEV_statusTurn, dmg: 0 };
    case 'set_attack': return { dev: ((ef.setAttack && ef.setAttack.turns) || 1) * cal.DEV_statusTurn, dmg: 0 };
    case 'apply_status': {
      const st = ef.applyStatus || {};
      const strong = ['silenced', 'crippled', 'intangible', 'frozen'].includes(st.id);
      return { dev: (st.turns || 1) * (strong ? cal.DEV_statusTurn : cal.DEV_statusTurn * 0.6), dmg: 0 };
    }
    case 'shuffle': return { dev: 1, dmg: 0 };
    case 'self_destruct': return { dev: 0, dmg: 0, note: 'suicide — value is the paired nuke' };
    case 'mark': return { dev: (((ef.mark && ef.mark.multiplier) || 2) - 1) * 5, dmg: 0, note: 'assumes ~5 dmg next hit' };
    case 'lock_color': return { dev: ((ef.lockColor && ef.lockColor.turns) || 2) * 2.5, dmg: 0 };
    case 'consume': return { dev: cal.standingMana * 2.5 / Math.max(2, (ef.consume && ef.consume.divisor) || 2), dmg: 0, note: 'pool-dependent' };
    case 'echo_damage': return { dev: 0, dmg: 0, note: 'multiplier — see relic pricing' };
    case 'reduce_damage': return { dev: 0, dmg: 0, note: 'see relic pricing' };
    default: return { dev: 0, dmg: 0, note: `unmodeled: ${ef.effectType}` };
  }
}

function destroyDEV(nTiles, stats, cal) {
  const nSkull = nTiles * (20 / 96);
  const dmg = calculateDestroyedSkullDamage(stats, nSkull);
  const manaDev = (nTiles - nSkull) * cal.V_mana * cal.econEff * (10.7 / 13); // destroyed colors grant mana (partly off-color)
  return { dev: dmg * cal.DEV_damage + manaDev, dmg };
}

/** Full skill summary at reference stats. */
export function skillSummary(skill, stats = { attack: 5, magic: 5 }, cal = CAL) {
  const cost = totalCost(skill);
  let dev = 0, dmg = 0;
  const notes = [];
  for (const ef of skill.effects || []) {
    const r = effectDEV(ef, stats, cal);
    dev += r.dev; dmg += r.dmg;
    if (r.note) notes.push(r.note);
  }
  const vpm = cost > 0 ? dev / cost : Infinity;
  const dpm = cost > 0 ? dmg / cost : Infinity;
  let band = 'in band';
  if (cost > 0) {
    if (vpm < cal.vpmBand[0] * 0.8) band = 'weak';
    else if (vpm < cal.vpmBand[0]) band = 'low';
    else if (vpm > cal.vpmBand[1] * 1.3) band = 'must-pick';
    else if (vpm > cal.vpmBand[1]) band = 'high';
  } else band = 'free';
  return { id: skill.id, name: skill.name, cost, dev, vpm, dmg, dpm, band, notes };
}

/* ── synthesizer-style pricing (what WOULD the weave charge for this skill?) ──
   Mirrors skillSynthesizer's POWER table + weaveConfig cost model (K = 1.7,
   clamp 3..15). Useful to cross-check an authored skill's cost against the
   game's own pricing rubric. */
export const SYNTH_POWER = {
  perDamage: 0.5, perArmor: 0.45, perHeal: 0.4, perAttack: 2, perMagic: 2.5,
  perTileCreated: 1.1, extraTurn: 8, perPoisonStack: 1.0, perManaGained: 0.5, perManaDrained: 0.4,
};
export function synthCostEstimate(skill, stats = { attack: 5, magic: 5 }) {
  let power = 0;
  for (const ef of skill.effects || []) {
    switch (ef.effectType) {
      case 'damage': {
        const d = ef.damage || {};
        power += ((d.amount || 0) + scaledBonus(d.scaling, stats)) * SYNTH_POWER.perDamage
          + (d.perSkull || 0) * 13 * 0.35;
        break;
      }
      case 'heal': power += (((ef.heal && ef.heal.amount) || 0) + scaledBonus(ef.heal && ef.heal.scaling, stats)) * SYNTH_POWER.perHeal; break;
      case 'armor': power += (((ef.armor && ef.armor.amount) || 0) + scaledBonus(ef.armor && ef.armor.scaling, stats)) * SYNTH_POWER.perArmor; break;
      case 'barrier': power += (((ef.barrier && ef.barrier.amount) || 0) + scaledBonus(ef.barrier && ef.barrier.scaling, stats)) * SYNTH_POWER.perArmor; break;
      case 'gain_attack': power += ((ef.gainAttack && ef.gainAttack.amount) || 1) * SYNTH_POWER.perAttack; break;
      case 'gain_magic': power += ((ef.gainMagic && ef.gainMagic.amount) || 1) * SYNTH_POWER.perMagic; break;
      case 'create_tiles': power += ((ef.createTiles && ef.createTiles.amount) || 0) * SYNTH_POWER.perTileCreated; break;
      case 'convert_tiles_by_type': power += 10 * SYNTH_POWER.perTileCreated * 0.8; break;
      case 'convert_tile': power += 1.5; break;
      case 'destroy_tiles_row': case 'destroy_tiles_column': case 'destroy_tiles': power += 5; break;
      case 'destroy_tiles_by_type': power += 4; break;
      case 'extra_turn': power += SYNTH_POWER.extraTurn; break;
      case 'apply_poison': power += (((ef.poison && ef.poison.amount) || 0) + scaledBonus(ef.poison && ef.poison.scaling, stats)) * SYNTH_POWER.perPoisonStack; break;
      case 'gain_mana': power += ((ef.gainMana && ef.gainMana.amount) || 0) * SYNTH_POWER.perManaGained; break;
      case 'drain_mana': power += ((ef.drainMana && ef.drainMana.amount) || 0) * 2.5 * SYNTH_POWER.perManaDrained; break;
      case 'apply_status': case 'silence': case 'set_attack': power += 3; break;
      default: break;
    }
  }
  const cost = Math.max(3, Math.min(15, Math.round(power / 1.7)));
  return { power, suggestedCost: cost };
}

/* ── relic pricing ─────────────────────────────────────────────────────────── */

function triggerFreqPerFight(ef, cal) {
  const t = ef.trigger;
  const cond = ef.condition || {};
  switch (t) {
    case 'onBattleStart': return 1;
    case 'onTurnStart': case 'onTurnEnd': return cal.fightTurns;
    case 'onMatch4Plus': return cal.match4PerTurn * cal.fightTurns;
    case 'onTileMatchType': {
      if (cond.typeId === 'skull') return cal.skullMatchPerTurn * cal.fightTurns;
      if (cond.minCount >= 4) return cal.match4PerTurn * cal.fightTurns;
      return cal.colorMatchPerTurn * cal.fightTurns;
    }
    case 'onGainMana': return (cond.color ? cal.colorGainPerTurn : cal.colorMatchPerTurn) * cal.fightTurns;
    case 'onTakeDamage': return cal.takeHitsPerTurn * cal.fightTurns;
    case 'onIncomingDamage': return cal.takeHitsPerTurn * cal.fightTurns;
    case 'onDealDamage': return cal.dealEventsPerTurn * cal.fightTurns;
    case 'onTileCreated': return cal.dealEventsPerTurn * cal.fightTurns; // paired with a creator
    case 'onDeath': return 0.5;
    default: return 0;
  }
}

/** DEV a relic contributes over ONE fight for an owner with `stats`. */
export function relicDEVPerFight(relic, stats = { attack: 5, magic: 5 }, cal = CAL) {
  let dev = 0;
  const notes = [];
  for (const ef of relic.effects || []) {
    const freq = triggerFreqPerFight(ef, cal);
    switch (ef.effectType) {
      case 'modify_stat': {
        const m = ef.modifyStat || {};
        dev += (m.stat === 'attack' ? cal.DEV_attack_perm : 3) * (m.amount || 0);
        break;
      }
      case 'modify_spawn_rate': dev += ((ef.spawnRate && ef.spawnRate.amount) || 0) * cal.spawnPPValue * cal.fightTurns; break;
      case 'modify_mana_gain': dev += ((ef.manaGain && ef.manaGain.amount) || 0) * cal.V_mana * cal.econEff * (cal.colorMatchPerTurn / 5 + 0.1) * cal.fightTurns; break;
      case 'modify_skull_damage': dev += ((ef.skullDamage && ef.skullDamage.amount) || 0) * cal.skullMatchPerTurn * cal.fightTurns * cal.DEV_damage; break;
      case 'grant_starting_mana': dev += ((ef.startingMana && ef.startingMana.amount) || 0) * cal.V_mana * cal.econEff; break;
      case 'attack_per_unspent_mana': {
        const r = ef.attackPerMana || {};
        dev += Math.floor(cal.standingMana / (r.per || 3)) * (r.amount || 1) * cal.DEV_attack_perm;
        notes.push('dynamic — assumes ~standing mana; sim it');
        break;
      }
      case 'reduce_damage': dev += ((ef.reduceDamage && ef.reduceDamage.amount) || 0) * freq * cal.DEV_damage; break;
      case 'echo_damage': { dev += cal.fightTurns * 2.5 * cal.DEV_damage; notes.push('≈ doubles owner damage — sim it'); break; }
      case 'destroy_random_skulls': {
        const n = ((ef.destroySkulls && ef.destroySkulls.amount) || 1);
        dev += freq * calculateDestroyedSkullDamage(stats, n) * cal.DEV_damage;
        break;
      }
      case 'destroy_tiles_radius': dev += freq * destroyDEV(9, stats, cal).dev * 0.6; break;
      case 'destroy_random_row': dev += freq * destroyDEV(8, stats, cal).dev * 0.6; break;
      case 'harvest_tiles': { dev += cal.fightTurns * 1.5 * cal.DEV_attack_perm * 0.4; notes.push('thrall engine — sim it'); break; }
      case 'convert_random_tiles': dev += freq * ((ef.convertTiles && ef.convertTiles.amount) || 1) * cal.DEV_tile; break;
      case 'create_tiles': {
        const ct = ef.createTiles || {};
        const per = ct.type === 'skull' || ct.type === 'thrall' ? cal.DEV_skullTile : (ct.type === 'disease' ? 0.2 : cal.DEV_tile);
        dev += freq * (ct.amount || 1) * per;
        break;
      }
      case 'transform': notes.push('phase mechanic — sim only'); break;
      case 'apply_poison': { dev += freq * 1.5 * cal.DEV_poisonStack; notes.push('scales with skull dmg dealt — sim it'); break; }
      default: {
        const r = effectDEV(ef, stats, cal);
        dev += freq * r.dev;
        if (r.note) notes.push(r.note);
      }
    }
  }
  return { id: relic.id, name: relic.name, rarity: relic.rarity, dev, notes };
}

/** rarity band check: DEV/fight vs a rough per-rarity budget */
export const RARITY_DEV_BAND = { starter: [2, 8], common: [2, 7], uncommon: [4, 12], rare: [8, 22], legendary: [15, 60] };

/* ── enemy threat & budgeting ─────────────────────────────────────────────── */

export function scaleEnemy(def, floor) {
  const f = Math.max(1, Math.min(10, floor));
  const atkScale = typeof def.attackScale === 'number' ? def.attackScale : 1;
  return {
    hp: Math.round(((def.hp != null ? def.hp : def.maxHp) || 1) * ENEMY_HP_FLOOR_MULT[f - 1]),
    attack: (def.attack || 0) + Math.round(ENEMY_ATTACK_FLOOR_BONUS[f - 1] * atkScale),
    armor: def.armor || 0,
  };
}

/**
 * Analytic threat snapshot of an enemy at a floor vs a reference player.
 * refPlayer: { dpt, maxHp } — measure dpt in the Matchup Lab for truth.
 */
export function enemyThreat(def, floor, refPlayer, cal = CAL) {
  const sc = scaleEnemy(def, floor);
  // worst plausible turn: 2 skull matches + best affordable damage skill
  const skullBurst = 2 * calculateMatchedSkullDamage({ attack: sc.attack }, cal.Nskull);
  let skillBurst = 0;
  for (const s of def._resolvedSkills || []) {
    for (const ef of s.effects || []) {
      if (ef.effectType === 'damage') {
        const d = ef.damage || {};
        const amt = (d.amount == null ? sc.attack : d.amount) + scaledBonus(d.scaling, { attack: sc.attack, magic: def.magic || 0 });
        skillBurst = Math.max(skillBurst, Math.min(amt, 60)); // cap boom_baby-style flags
      }
    }
  }
  const burst = skullBurst + skillBurst;
  const ttk = refPlayer && refPlayer.dpt > 0 ? (sc.hp + sc.armor) / refPlayer.dpt : null;
  const burstShare = refPlayer && refPlayer.maxHp > 0 ? burst / refPlayer.maxHp : null;
  return { ...sc, burst, skullBurst, skillBurst, ttk, burstShare };
}

/** Enemy HP budget: baseline hp such that scaled hp ≈ playerDPT × targetTurns */
export function budgetEnemyBaseHp(playerDPT, targetTurns, floor) {
  return Math.round((playerDPT * targetTurns) / ENEMY_HP_FLOOR_MULT[Math.max(1, Math.min(10, floor)) - 1]);
}
/** Enemy attack budget: baseline attack for a target burst share of player HP */
export function budgetEnemyBaseAttack(targetBurst, playerMaxHp, floor, cal = CAL) {
  // burst ≈ 2 skull matches: 2 × Nskull × (1 + (A−1)/3) = share × hp → solve A
  const dmgTarget = targetBurst * playerMaxHp;
  const perMatch = dmgTarget / 2;
  const A = 1 + 3 * (perMatch / cal.Nskull - 1);
  return Math.max(1, Math.round(A - ENEMY_ATTACK_FLOOR_BONUS[Math.max(1, Math.min(10, floor)) - 1]));
}

/* ── code-snippet exporters (paste-ready) ─────────────────────────────────── */

const j = (o, indent) => JSON.stringify(o, null, 2).replace(/"([a-zA-Z_$][a-zA-Z0-9_$]*)":/g, '$1:')
  .split('\n').map((l, i) => (i === 0 ? l : ' '.repeat(indent) + l)).join('\n');

export function enemySnippet(def) {
  const body = {
    id: def.id, name: def.name, act: def.act || 1, aiBehavior: def.aiBehavior || null,
    className: def.className || 'Minion', rarity: def.rarity || 'common', type: def.type || 'minion',
    floors: def.floors || [1], hp: def.hp, maxHp: def.hp, attack: def.attack,
    armor: def.armor || 0, mana: def.mana || { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
    skills: def.skills || [], relics: def.relics || [],
    portrait: def.portrait || def.id,
  };
  return `// src/js/data/enemies/act${body.act}/${def.id}.js — generated by the Balance Toolbench
const ${def.id} = ${j(body, 0)};

export default ${def.id};
// → add to act${body.act}/index.js and register portrait/skill assets in main.js ASSET_MAP`;
}

export function skillSnippet(skill) {
  const body = { ...skill };
  delete body._custom;
  return `// paste into src/js/data/skills/skillCatalog.js — generated by the Balance Toolbench
  ${skill.id}: ${j(body, 2)},
// → reference from a character/enemy def via skills: ['${skill.id}']; register icon/sound assets`;
}

export function relicSnippet(relic, pool = 'player') {
  const body = { ...relic };
  delete body._custom;
  const file = pool === 'enemy' ? 'enemyRelicCatalog.js' : 'relicCatalog.js';
  return `// paste into src/js/data/relics/${file} — generated by the Balance Toolbench
  ${relic.id}: ${j(body, 2)},
// → reference via relics: ['${relic.id}']; add the icon sprite to ui_spritesheet_relics`;
}
