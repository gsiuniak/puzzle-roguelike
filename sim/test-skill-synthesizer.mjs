/**
 * test-skill-synthesizer.mjs — unit tests for the weave skill synthesizer
 * (src/js/data/skillSynthesizer.js). Pure logic, no canvas — runs under node:
 *
 *   node sim/test-skill-synthesizer.mjs
 *
 * Covers: special combo rules (red+convert+green), tag consumption / inert
 * tags, hidden value rolls landing inside their tables, randomized mana costs
 * inside the power-tiered band, targeting shapes, effect ordering (extra_turn
 * last), status mapping, and a 500-bag random sweep validating every emitted
 * skill against the battle-side effect-type registry.
 */

import { synthesize } from '../src/js/data/skillSynthesizer.js';
import { SKILL_EFFECT_TYPES } from '../src/js/game/MatchResolver.js';
import { SKILL_WEAVE_TAGS } from '../src/js/data/skillWeaveTags.js';
import { TAG_VALUE_TABLES, MANA_COST_CONFIG } from '../src/js/data/weaveConfig.js';
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
const MAX_COST = MANA_COST_CONFIG.baseCeiling + MANA_COST_CONFIG.powerTierThresholds.length;

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
    eq('single element is the DESTINATION', fx.convertByType.to, 'green');
    check('source is a different color', fx.convertByType.from !== 'green' && COST_COLORS.includes(fx.convertByType.from));
  }

  const none = synthesize(['convert', 'damage']);
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
    const r = synthesize(['red', 'damage']);
    const fx = r.skill.effects.find((e) => e.effectType === 'damage');
    if (!tableKeys('damage').includes(fx.damage.amount)) {
      check('damage roll inside its table', false, String(fx.damage.amount));
      break;
    }
    const cost = Object.values(r.skill.cost)[0];
    if (cost < MANA_COST_CONFIG.baseFloor || cost > MAX_COST) {
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

// ── 4. Injection rules ("the weave surges") ──
{
  // lock → injects Frozen on the enemy (no longer inert)
  const lock = synthesize(['damage', 'lock']);
  const lfx = lock.skill.effects.find((e) => e.effectType === 'apply_status' && e.applyStatus.id === 'frozen');
  check('lock injects Frozen', !!lfx, JSON.stringify(lock.skill.effects));
  check('lock counts as used', lock.usedTags.includes('lock'));
  check('frozen reported as injected', lock.injectedTags.includes('frozen'));

  // wild without create → conjures Wild tiles anyway
  const wild = synthesize(['damage', 'wild']);
  const wfx = wild.skill.effects.find((e) => e.effectType === 'create_tiles');
  check('wild injects wild-tile creation', !!wfx && wfx.createTiles.type === 'wild', JSON.stringify(wild.skill.effects));
  check('wild counts as used', wild.usedTags.includes('wild'));

  // orphan shape → injects a destroy of that shape
  const orphan = synthesize(['red', 'row']);
  check('orphan row injects row destruction',
    orphan.skill.effects.some((e) => e.effectType === 'destroy_tiles_row'), JSON.stringify(orphan.skill.effects));
  eq('injected destroy claims targeting', orphan.skill.targeting, 'board_tile');
  check('row counts as used', orphan.usedTags.includes('row'));

  // pure damage → surges an extra turn at least sometimes (75% default)
  let surgedCount = 0;
  for (let i = 0; i < 40; i++) {
    const r = synthesize(['damage']);
    const et = r.skill.effects.map((e) => e.effectType);
    if (et.includes('extra_turn')) {
      surgedCount++;
      eq('surged extra_turn is last', et[et.length - 1], 'extra_turn');
    }
  }
  check('pure damage surges extra turns sometimes', surgedCount > 0);

  // unconsumed element → conjures its tiles (statistical: 2 elements + damage)
  let createSeen = 0;
  for (let i = 0; i < 30; i++) {
    const r = synthesize(['damage', 'red', 'blue']);
    if (r.skill.effects.some((e) => e.effectType === 'create_tiles')) createSeen++;
  }
  check('unconsumed elements conjure tiles', createSeen > 0);
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

  // Only ONE action claims targeting; the second destroyer VENTS as damage.
  const both = synthesize(['destroy', 'explode', 'row']);
  const targeted = both.skill.effects.filter((e) =>
    ['destroy_tiles', 'destroy_tiles_row', 'destroy_tiles_column', 'convert_tile'].includes(e.effectType));
  eq('only one targeted effect', targeted.length, 1);
  check('losing destroyer vents as damage',
    both.skill.effects.some((e) => e.effectType === 'damage'), JSON.stringify(both.skill.effects));
  check('vented damage reported as injected', both.injectedTags.includes('damage'));
}

// ── 5b. Name variety + soft cost color ──
{
  const names = new Set();
  for (let i = 0; i < 60; i++) names.add(synthesize(['red', 'damage', 'frozen']).skill.name);
  check('names vary (>8 distinct in 60)', names.size > 8, `got ${names.size}`);

  const colors = new Set();
  for (let i = 0; i < 60; i++) colors.add(Object.keys(synthesize(['blue', 'damage']).skill.cost)[0]);
  check('element usually influences cost color', colors.has('blue'));
  check('cost color is NOT a hard rule', colors.size > 1, [...colors].join(','));
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
  const deb = synthesize(['damage', 'silence']);
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

// ── 8. gain + element → that color's mana; skull never a cost color ──
{
  const r = synthesize(['gain', 'blue']);
  const fx = r.skill.effects.find((e) => e.effectType === 'gain_mana');
  check('gain_mana emitted', !!fx);
  if (fx) eq('gain uses the element color', fx.gainMana.color, 'blue');

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
    else {
      if (s.name.length > 20) problems.push(`name too long: "${s.name}"`);
      if (/\bthe\b/i.test(s.name)) problems.push(`name contains "the": "${s.name}"`);
    }
    if (!s.description) problems.push('no description');
    if (!s.sound) problems.push('no sound');
    if (!s.effects.length) problems.push('no effects');
    if (s.effects.some((e) => !VALID_EFFECT_TYPES.has(e.effectType))) problems.push('invalid effect type');
    for (const e of s.effects) {
      if (e.effectType === 'apply_status' && !getStatusDef(e.applyStatus.id)) problems.push(`bad status ${e.applyStatus.id}`);
    }
    const costEntries = Object.entries(s.cost || {});
    if (costEntries.length !== 1) problems.push('cost must be one color');
    else {
      const [color, amount] = costEntries[0];
      if (!COST_COLORS.includes(color)) problems.push(`bad cost color ${color}`);
      if (amount < MANA_COST_CONFIG.baseFloor || amount > MAX_COST) problems.push(`cost ${amount} out of band`);
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
