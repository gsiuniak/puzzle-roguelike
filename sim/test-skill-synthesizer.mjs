/**
 * test-skill-synthesizer.mjs — unit tests for the weave skill synthesizer
 * (src/js/data/skillSynthesizer.js). Pure logic, no canvas — runs under node:
 *
 *   node sim/test-skill-synthesizer.mjs
 *
 * Covers: special combo rules (red+convert+green), tag consumption, CHOICE-
 * DRIVEN wasted tags (redundant/incompatible picks contribute nothing + carry a
 * reason — no injection), hidden value rolls landing inside their tables,
 * CONTINUOUS mana costs split across colors, targeting shapes, effect ordering
 * (extra_turn last), status mapping, and a 500-bag random sweep validating every
 * emitted skill against the battle-side effect-type registry.
 */

import { synthesize } from '../src/js/data/skillSynthesizer.js';
import { SKILL_EFFECT_TYPES } from '../src/js/game/MatchResolver.js';
import { SKILL_WEAVE_TAGS } from '../src/js/data/skillWeaveTags.js';
import { TAG_VALUE_TABLES, MANA_COST_CONFIG } from '../src/js/data/weaveConfig.js';
import { DAMAGE_SCALING_PRESETS } from '../src/js/data/scalingConfig.js';
import { getStatusDef } from '../src/js/data/statusEffects.js';

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const VALID_EFFECT_TYPES = new Set(Object.values(SKILL_EFFECT_TYPES));
const COST_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
const MIN_COST = MANA_COST_CONFIG.min;         // total across all colors
const MAX_COST = MANA_COST_CONFIG.max;         // total across all colors
const MAX_COLORS = MANA_COST_CONFIG.maxColors;

function tableKeys(tagId) {
  return Object.keys(TAG_VALUE_TABLES[tagId] || {}).map(Number);
}

// ── 1. Special combo: red + convert + green → convert all red into green ──
{
  const r = synthesize(['red', 'convert', 'green']);
  const fx = r.skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('convert_tiles_by_type emitted', !!fx, JSON.stringify(r.skill.effects));
  if (fx) {
    eq('converts FROM first element', fx.convertByType.from, 'red');
    eq('converts TO second element', fx.convertByType.to, 'green');
  }
  eq('all three tags used', r.unusedTags.length, 0);
  check('cost color is a valid mana color', COST_COLORS.includes(Object.keys(r.skill.cost)[0]));
}

// ── 1b. Convert is by-type by DEFAULT; targeted only with an explicit shape ──
{
  const one = synthesize(['convert', 'green']);
  const fx = one.skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('single-element convert is by-type', !!fx, JSON.stringify(one.skill.effects));
  if (fx) {
    eq('single type is the DESTINATION (last type)', fx.convertByType.to, 'green');
    // Source is rolled at synthesis from colors + skull (≠ destination).
    check('source is a different tile type',
      fx.convertByType.from !== 'green' && (COST_COLORS.includes(fx.convertByType.from) || fx.convertByType.from === 'skull'));
  }

  const none = synthesize(['convert', 'physical']);
  const nfx = none.skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('element-less convert still by-type (rolled colors)', !!nfx);
  if (nfx) check('rolled from ≠ to', nfx.convertByType.from !== nfx.convertByType.to);

  const tiled = synthesize(['convert', 'tile', 'green']);
  check('convert + tile shape → targeted single convert',
    tiled.skill.effects.some((e) => e.effectType === 'convert_tile'), JSON.stringify(tiled.skill.effects));
  eq('targeted convert radius 0', tiled.skill.area.radius, 0);
}

// ── 2. Hidden rolls land inside their tables; cost inside the band ──
{
  for (let i = 0; i < 40; i++) {
    const r = synthesize(['red', 'physical']);
    const fx = r.skill.effects.find((e) => e.effectType === 'damage');
    if (!tableKeys('physical').includes(fx.damage.amount)) {
      check('damage roll inside its table', false, String(fx.damage.amount));
      break;
    }
    const cost = Object.values(r.skill.cost).reduce((a, b) => a + b, 0);
    if (cost < MIN_COST || cost > MAX_COST) {
      check('cost inside the global band', false, String(cost));
      break;
    }
    if (i === 39) { check('damage rolls inside table (40x)', true); check('costs inside band (40x)', true); }
  }
}

// ── 3. create + wild → standard WILD tiles (not Malakor's Thrall) ──
{
  const r = synthesize(['create', 'wild']);
  const fx = r.skill.effects.find((e) => e.effectType === 'create_tiles');
  check('create_tiles emitted', !!fx);
  if (fx) eq('wild + create → wild tiles', fx.createTiles.type, 'wild');
  check('wild consumed', r.usedTags.includes('wild'));
  check('create count from table', tableKeys('create').includes(fx.createTiles.amount), String(fx.createTiles.amount));
}

// ── 4. Choice-driven downsides (NO injection — wasted picks contribute nothing) ──
{
  // wild FLOORS to creating Wild tiles (never fizzles) — so it's used, not wasted.
  const wild = synthesize(['physical', 'wild']);
  const wfx = wild.skill.effects.find((e) => e.effectType === 'create_tiles');
  check('wild floors to creating Wild tiles', !!wfx && wfx.createTiles.type === 'wild', JSON.stringify(wild.skill.effects));
  check('wild is used (floored), not wasted', wild.usedTags.includes('wild') && !wild.unusedTags.includes('wild'));

  // orphan shape → WASTED (no free destroy), with a reason.
  const orphan = synthesize(['red', 'row']);
  check('orphan row makes no destruction',
    !orphan.skill.effects.some((e) => e.effectType === 'destroy_tiles_row'), JSON.stringify(orphan.skill.effects));
  check('row is wasted (unused)', orphan.unusedTags.includes('row'));
  check('wasted row carries a reason', !!orphan.wastedReasons.row);
  check('element red still pays the cost (used)', orphan.usedTags.includes('red'));

  // pure damage → NO free extra turn anymore (just a cheap damage spell).
  let etCount = 0;
  for (let i = 0; i < 40; i++) {
    if (synthesize(['physical']).skill.effects.some((e) => e.effectType === 'extra_turn')) etCount++;
  }
  eq('pure damage never surges an extra turn', etCount, 0);

  // Two elements → both become COST colors (split), neither wasted, no create.
  const two = synthesize(['physical', 'red', 'blue']);
  const colors = Object.keys(two.skill.cost);
  check('both elements become cost colors', colors.includes('red') && colors.includes('blue'), JSON.stringify(two.skill.cost));
  check('no element conjures tiles', !two.skill.effects.some((e) => e.effectType === 'create_tiles'));
  eq('no elements wasted when they pay the cost', two.unusedTags.length, 0);
}

// ── 4b. `random` is a wildcard — ALWAYS pulls a bonus, never wasted ──
{
  let everWasted = false;
  for (let i = 0; i < 80 && !everWasted; i++) {
    if (synthesize(['physical', 'random']).unusedTags.includes('random')) everWasted = true;
  }
  check('random is never wasted', !everWasted);

  // Even a random-only bag yields a valid, castable skill with random consumed.
  let ok = true;
  for (let i = 0; i < 60 && ok; i++) {
    const r = synthesize(['random']);
    if (!r.skill.effects.length) ok = false;
    if (r.unusedTags.includes('random')) ok = false;
    if (r.skill.effects.some((e) => !VALID_EFFECT_TYPES.has(e.effectType))) ok = false;
  }
  check('random-only bag always yields a valid skill (random used)', ok);
}

// ── 4c. Reading grammar: tags read as a sentence; order-tolerant; last = dest ──
{
  // convert: LAST type = destination, preceding = source.
  const c = synthesize(['convert', 'yellow', 'red']).skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('convert: last type is destination', c && c.convertByType.to === 'red' && c.convertByType.from === 'yellow', JSON.stringify(c));

  // Order-tolerant: verb position is irrelevant — same source→dest.
  const c2 = synthesize(['red', 'convert', 'yellow']).skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('convert is order-tolerant (verb anywhere)', c2 && c2.convertByType.from === 'red' && c2.convertByType.to === 'yellow', JSON.stringify(c2));

  // change is targeted single-tile → destination = last type (incl. WILD — the headline fix).
  const cw = synthesize(['change', 'wild']);
  const cwf = cw.skill.effects.find((e) => e.effectType === 'convert_tile');
  check('change + wild → change a tile INTO wild', cwf && cwf.convertTile.type === 'wild', JSON.stringify(cw.skill.effects));
  check('change+wild does not waste wild', !cw.unusedTags.includes('wild'));

  // change + all → promoted to a MASS by-type conversion (yellow → red).
  const ca = synthesize(['change', 'all', 'yellow', 'red']);
  const caf = ca.skill.effects.find((e) => e.effectType === 'convert_tiles_by_type');
  check('change + all → mass convert', !!caf && caf.convertByType.to === 'red' && caf.convertByType.from === 'yellow', JSON.stringify(ca.skill.effects));
  check('all consumed by change+all', !ca.unusedTags.includes('all'));

  // skull + damage → per-Skull scaling damage.
  let sawPerSkull = false;
  for (let i = 0; i < 20 && !sawPerSkull; i++) {
    const d = synthesize(['skull', 'physical']).skill.effects.find((e) => e.effectType === 'damage');
    if (d && typeof d.damage.perSkull === 'number' && d.damage.perSkull > 0) sawPerSkull = true;
  }
  check('skull + damage → per-Skull damage', sawPerSkull);

  // skull + destroy (no shape) → destroy N Skull tiles.
  const sd = synthesize(['skull', 'destroy']).skill.effects.find((e) => e.effectType === 'destroy_tiles_by_type');
  check('skull + destroy → destroy N skulls', sd && sd.destroyByType.type === 'skull' && typeof sd.destroyByType.amount === 'number', JSON.stringify(sd));

  // destroy + all + color → board-wide color wipe (no amount = all).
  const da = synthesize(['destroy', 'all', 'red']).skill.effects.find((e) => e.effectType === 'destroy_tiles_by_type');
  check('destroy + all + color → wipe all of that color', da && da.destroyByType.type === 'red' && da.destroyByType.amount === undefined, JSON.stringify(da));
}

// ── 5. Targeting shapes ──
{
  const row = synthesize(['destroy', 'row']);
  eq('destroy+row → board targeting', row.skill.targeting, 'board_tile');
  eq('row area is numeric', row.skill.area, 1);
  check('destroy_tiles_row emitted', row.skill.effects.some((e) => e.effectType === 'destroy_tiles_row'));

  const col = synthesize(['destroy', 'column']);
  check('destroy_tiles_column emitted', col.skill.effects.some((e) => e.effectType === 'destroy_tiles_column'));

  const tile = synthesize(['destroy', 'tile']);
  eq('destroy+tile → radius 0', tile.skill.area.radius, 0);

  const wide = synthesize(['explode', 'area']);
  eq('explode+area → radius 2', wide.skill.area.radius, 2);
  check('area consumed by explode', wide.usedTags.includes('area'));

  const plain = synthesize(['explode']);
  eq('explode alone → radius 1', plain.skill.area.radius, 1);

  // Only ONE action claims targeting; the second destroyer is WASTED (a
  // choice-driven downside), NOT vented into free damage.
  const both = synthesize(['destroy', 'explode', 'row']);
  const targeted = both.skill.effects.filter((e) =>
    ['destroy_tiles', 'destroy_tiles_row', 'destroy_tiles_column', 'convert_tile'].includes(e.effectType));
  eq('only one targeted effect', targeted.length, 1);
  check('losing destroyer is wasted',
    both.unusedTags.includes('explode') || both.unusedTags.includes('destroy'), JSON.stringify(both.unusedTags));
  check('no free vented damage', !both.skill.effects.some((e) => e.effectType === 'damage'), JSON.stringify(both.skill.effects));
}

// ── 5b. Name variety + soft cost color ──
{
  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(synthesize(['red', 'physical', 'frozen']).skill.name);
  check('names vary (>8 distinct in 60)', names.size > 8, `got ${names.size}`);

  // A single woven element now DETERMINISTICALLY sets the cost color (it pays
  // for the spell) — pick order / color choice is a real, legible decision.
  const colors = new Set();
  for (let i = 0; i < 60; i++) {
    const keys = Object.keys(synthesize(['blue', 'physical']).skill.cost);
    keys.forEach((k) => colors.add(k));
  }
  eq('single element pins the cost color', colors.size, 1);
  check('that color is the woven element', colors.has('blue'), [...colors].join(','));
}

// ── 5c. Damage TYPES scale + carry <<>> markup; Greater amplifies; cost skew ──
{
  // physical → Attack scaling; magical → Magic scaling. Multiplier from a preset.
  const SCALE_VALUES = new Set(Object.values(DAMAGE_SCALING_PRESETS));
  let physOk = true, magOk = true;
  for (let i = 0; i < 40; i++) {
    const p = synthesize(['physical']).skill.effects.find((e) => e.effectType === 'damage');
    if (!p || !p.damage.scaling || !(p.damage.scaling.attack > 0) || p.damage.scaling.magic) physOk = false;
    if (p && !SCALE_VALUES.has(p.damage.scaling.attack)) physOk = false;
    const m = synthesize(['magical']).skill.effects.find((e) => e.effectType === 'damage');
    if (!m || !m.damage.scaling || !(m.damage.scaling.magic > 0) || m.damage.scaling.attack) magOk = false;
    if (m && !SCALE_VALUES.has(m.damage.scaling.magic)) magOk = false;
  }
  check('physical damage scales with Attack (preset multiplier)', physOk);
  check('magical damage scales with Magic (preset multiplier)', magOk);

  // Healing scales with Magic at the _50 (×1/2) preset + carries <<n>> markup.
  let healOk = true;
  for (let i = 0; i < 30; i++) {
    const h = synthesize(['heal']).skill.effects.find((e) => e.effectType === 'heal');
    if (!h || !h.heal.scaling || h.heal.scaling.magic !== DAMAGE_SCALING_PRESETS._50) healOk = false;
  }
  check('woven heal scales with Magic at _50', healOk);
  const hd = synthesize(['heal']).skill.description;
  check('heal description has <<n>> + [[Heal]]', /<<\d+>>/.test(hd) && hd.includes('[[Heal]]'), hd);

  // Armor gain scales with Attack at the _33 (×1/3) preset + carries <<n>> markup.
  let armorOk = true;
  for (let i = 0; i < 30; i++) {
    const ar = synthesize(['armor']).skill.effects.find((e) => e.effectType === 'armor');
    if (!ar || !ar.armor.scaling || ar.armor.scaling.attack !== DAMAGE_SCALING_PRESETS._33) armorOk = false;
  }
  check('woven armor scales with Attack at _33', armorOk);
  const ad = synthesize(['armor']).skill.description;
  check('armor description has <<n>> + [[armor]]', /<<\d+>>/.test(ad) && ad.includes('[[armor]]'), ad);

  // Description carries the dynamic <<n>> value + the damage-type keyword.
  const pd = synthesize(['physical']).skill.description;
  check('physical description has <<n>> + [[phys]]', /<<\d+>>/.test(pd) && pd.includes('[[phys]]'), pd);
  const md = synthesize(['magical']).skill.description;
  check('magical description has <<n>> + [[mag]]', /<<\d+>>/.test(md) && md.includes('[[mag]]'), md);

  // Greater amplifies damage (avg amount with Greater clearly exceeds without).
  let withG = 0, noG = 0, N = 200;
  for (let i = 0; i < N; i++) {
    withG += synthesize(['physical', 'greater']).skill.effects.find((e) => e.effectType === 'damage').damage.amount;
    noG += synthesize(['physical']).skill.effects.find((e) => e.effectType === 'damage').damage.amount;
  }
  check('Greater multiplies damage amount', withG / N > noG / N * 1.2, `withG=${(withG/N).toFixed(1)} noG=${(noG/N).toFixed(1)}`);
  check('Greater is consumed by a damage tag', synthesize(['physical', 'greater']).usedTags.includes('greater'));

  // Greater also amplifies Attack gain (always at least +1).
  let aWithG = 0, aNoG = 0, M = 200;
  for (let i = 0; i < M; i++) {
    aWithG += synthesize(['attack', 'greater']).skill.effects.find((e) => e.effectType === 'gain_attack').gainAttack.amount;
    aNoG += synthesize(['attack']).skill.effects.find((e) => e.effectType === 'gain_attack').gainAttack.amount;
  }
  check('Greater amplifies Attack gain', aWithG / M > aNoG / M, `withG=${(aWithG/M).toFixed(2)} noG=${(aNoG/M).toFixed(2)}`);
  check('Greater consumed by Attack (not wasted)', synthesize(['attack', 'greater']).usedTags.includes('greater'));

  // Greater with NO magnitude verb to amplify → wasted with a reason.
  const gw = synthesize(['convert', 'greater']);
  check('Greater wasted when no magnitude verb', gw.unusedTags.includes('greater') && !!gw.wastedReasons.greater, JSON.stringify(gw.unusedTags));

  // Cost-color SKEW (no element → fallback): physical skews red-heavy, magical purple-heavy.
  const tally = (action) => {
    const c = { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 };
    for (let i = 0; i < 400; i++) {
      for (const k of Object.keys(synthesize([action]).skill.cost)) if (k in c) c[k]++;
    }
    return c;
  };
  const pc = tally('physical');
  check('physical cost skews toward red over purple', pc.red > pc.purple, JSON.stringify(pc));
  const mc = tally('magical');
  check('magical cost skews toward purple over red', mc.purple > mc.red, JSON.stringify(mc));
}

// ── 6. extra_turn is always the LAST effect (cascade ordering, decision #4) ──
{
  const r = synthesize(['create', 'green', 'extra_turn']);
  const fx = r.skill.effects;
  eq('extra_turn last', fx[fx.length - 1].effectType, 'extra_turn');
  check('create_tiles before extra_turn', fx.findIndex((e) => e.effectType === 'create_tiles') < fx.length - 1);
}

// ── 7. Status mapping: debuffs → opponent, buffs → self, valid catalog ids ──
{
  const deb = synthesize(['physical', 'silence']);
  const dfx = deb.skill.effects.find((e) => e.effectType === 'apply_status');
  check('silence emits apply_status', !!dfx);
  if (dfx) {
    eq('tag silence → status silenced', dfx.applyStatus.id, 'silenced');
    eq('debuff targets opponent', dfx.applyStatus.target, 'opponent');
    check('turns from table', tableKeys('silence').includes(dfx.applyStatus.turns));
  }
  const buf = synthesize(['armor', 'barrier']);
  const bfx = buf.skill.effects.find((e) => e.effectType === 'apply_status');
  if (bfx) eq('buff targets self', bfx.applyStatus.target, 'self');
}

// ── 8. shuffle → board shuffle ALWAYS paired with an extra turn ──
{
  const r = synthesize(['shuffle']);
  const sfx = r.skill.effects.find((e) => e.effectType === 'shuffle');
  check('shuffle effect emitted', !!sfx, JSON.stringify(r.skill.effects));
  const etx = r.skill.effects.filter((e) => e.effectType === 'extra_turn');
  eq('shuffle forces exactly one extra turn', etx.length, 1);
  check('shuffle counts as used', r.usedTags.includes('shuffle'));
  // Even paired with an explicit extra_turn tag, only ONE extra_turn is emitted.
  const r2 = synthesize(['shuffle', 'extra_turn']);
  eq('no duplicate extra turn', r2.skill.effects.filter((e) => e.effectType === 'extra_turn').length, 1);

  const sk = synthesize(['skull', 'create']);
  const cfx = sk.skill.effects.find((e) => e.effectType === 'create_tiles');
  if (cfx) eq('skull + create → skull tiles', cfx.createTiles.type, 'skull');
  check('skull is never the cost color', COST_COLORS.includes(Object.keys(sk.skill.cost)[0]),
    JSON.stringify(sk.skill.cost));
}

// ── 9. Verb-less bag still produces a working skill (fallback) ──
{
  const r = synthesize(['red', 'row']);
  check('fallback emits at least one effect', r.skill.effects.length > 0);
  check('fallback effect is valid', r.skill.effects.every((e) => VALID_EFFECT_TYPES.has(e.effectType)));
}

// ── 10. Random sweep: every bag yields a valid, castable skill ──
{
  const TAG_IDS = Object.keys(SKILL_WEAVE_TAGS);
  let ok = true;
  for (let i = 0; i < 500 && ok; i++) {
    const n = 2 + Math.floor(Math.random() * 3);
    const pool = TAG_IDS.slice();
    const bag = [];
    for (let k = 0; k < n; k++) bag.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);

    const r = synthesize(bag);
    const s = r.skill;
    const problems = [];
    if (!s || typeof s.id !== 'string' || !s.id) problems.push('bad id');
    if (!s.name) problems.push('no name');
    else if (s.name.length > 38) problems.push(`name too long: "${s.name}"`); // NAME_MAX_LENGTH
    // (The old "name must not contain 'the'" assertion was dropped — several
    //  shipped TAG_SUFFIXES legitimately contain "the", e.g. "of the Deep".)
    if (!s.description) problems.push('no description');
    if (!s.sound) problems.push('no sound');
    if (!s.effects.length) problems.push('no effects');
    if (s.effects.some((e) => !VALID_EFFECT_TYPES.has(e.effectType))) problems.push('invalid effect type');
    for (const e of s.effects) {
      if (e.effectType === 'apply_status' && !getStatusDef(e.applyStatus.id)) problems.push(`bad status ${e.applyStatus.id}`);
    }
    const costEntries = Object.entries(s.cost || {});
    if (costEntries.length < 1 || costEntries.length > MAX_COLORS) {
      problems.push(`cost color count ${costEntries.length}`);
    } else {
      let costSum = 0;
      for (const [color, amount] of costEntries) {
        if (!COST_COLORS.includes(color)) problems.push(`bad cost color ${color}`);
        if (!(amount >= 1)) problems.push(`cost part ${amount} < 1`);
        costSum += amount;
      }
      if (costSum < MIN_COST || costSum > MAX_COST) problems.push(`cost total ${costSum} out of band`);
    }
    if (s.targeting && s.targeting !== 'board_tile') problems.push('bad targeting');
    if (s.targeting && !(typeof s.area === 'number' || (s.area && typeof s.area.radius === 'number'))) {
      problems.push('targeted skill without area');
    }
    const et = s.effects.map((e) => e.effectType);
    if (et.includes('extra_turn') && et[et.length - 1] !== 'extra_turn') problems.push('extra_turn not last');
    const tagSet = new Set([...r.usedTags, ...r.unusedTags]);
    if (tagSet.size !== bag.length || bag.some((t) => !tagSet.has(t))) problems.push('used/unused do not partition the bag');

    if (problems.length) {
      ok = false;
      check('random sweep', false, `[${bag.join(', ')}] → ${problems.join('; ')} :: ${JSON.stringify(s)}`);
    }
  }
  if (ok) check('500 random bags all synthesize valid skills', true);
}

console.log(failed === 0
  ? `✓ skill synthesizer tests: ${passed} checks passed`
  : `✗ skill synthesizer tests: ${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
