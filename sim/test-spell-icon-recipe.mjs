/**
 * test-spell-icon-recipe.mjs — unit tests for the spell-icon layer SELECTION
 * (src/js/icons/spellIconRecipe.js → resolveIconPlan). Pure logic, no canvas —
 * runs under node:
 *
 *   node sim/test-spell-icon-recipe.mjs
 *
 * Covers base-color choice from mana cost (dominant / tie-break / fallback),
 * major+minor effect ranking, the verb-less default subject, border resolution,
 * deterministic variant selection, and signature determinism.
 *
 * Sprite naming (matches the authored sheets): base orbs `<color>_base[_n]`,
 * effect foregrounds `foreground_<tag>[_n]`, border `icon_border_2`.
 */

import { resolveIconPlan, hashString } from '../src/js/icons/spellIconRecipe.js';

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Fake AssetManager: isLoaded/get answer from a fixed key set. */
function fakeAM(keys) {
  const set = new Set(keys);
  return {
    isLoaded: (k) => set.has(k),
    get: (k) => (set.has(k) ? { width: 178, height: 178 } : null),
  };
}

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'skull'];
const EFFECTS = [
  'damage', 'armor', 'create', 'destroy', 'convert', 'shuffle', 'heal', 'drain', 'attack', 'explode',
  'row', 'column', 'area', 'tile', 'extra_turn', 'wild',
  'silence', 'cripple', 'enfeeble', 'brittle', 'intangible', 'berserk', 'bleed', 'frozen', 'barrier',
];
/** A full, single-variant sheet: every base color + effect + the border. */
const FULL = fakeAM([
  ...COLORS.map((c) => `${c}_base`),
  ...EFFECTS.map((t) => `foreground_${t}`),
  'icon_border_2',
]);

// ── 1. Base color = dominant mana color from cost ──
{
  const p = resolveIconPlan(['red', 'damage'], { red: 7 }, 'a', FULL);
  eq('cost color → base', p.baseKey, 'red_base');
  eq('action → major effect', p.majorKey, 'foreground_damage');
  eq('lone effect → no minor', p.minorKey, null);
  eq('border is icon_border_2', p.borderKey, 'icon_border_2');
  eq('color recorded', p.color, 'red');
}

// ── 2. Multi-color cost → highest amount wins ──
{
  const p = resolveIconPlan(['blue', 'green', 'create'], { blue: 3, green: 8 }, 'b', FULL);
  eq('dominant (green) base', p.baseKey, 'green_base');
}

// ── 3. Tied cost → broken by an element tag the spell carries ──
{
  const p = resolveIconPlan(['purple', 'damage'], { red: 5, purple: 5 }, 'c', FULL);
  eq('tie broken by element tag', p.color, 'purple');
}

// ── 4. No usable cost → first element tag, else neutral (skull base) ──
{
  const p = resolveIconPlan(['yellow', 'attack'], {}, 'd', FULL);
  eq('no cost → element fallback', p.baseKey, 'yellow_base');
  const p2 = resolveIconPlan(['damage'], null, 'e', FULL);
  eq('no cost, no element → skull base', p2.baseKey, 'skull_base');
}

// ── 5. Major/minor ranking: action is major, shape/status is minor ──
{
  const p = resolveIconPlan(['red', 'explode', 'area'], { red: 6 }, 'f', FULL);
  eq('highest-priority action is major', p.majorKey, 'foreground_explode');
  eq('shape becomes minor', p.minorKey, 'foreground_area');
  // two actions: higher one major, the other minor
  const p2 = resolveIconPlan(['damage', 'heal'], { red: 5 }, 'g', FULL);
  eq('damage outranks heal (major)', p2.majorTag, 'damage');
  eq('heal is minor', p2.minorTag, 'heal');
}

// ── 6. Elements never become effect layers ──
{
  const p = resolveIconPlan(['red', 'blue', 'damage'], { red: 5 }, 'h', FULL);
  eq('only the action is the effect', p.majorTag, 'damage');
  eq('no minor from elements', p.minorTag, null);
}

// ── 7. Verb-less bag → default subject so every icon has one ──
{
  const p = resolveIconPlan(['red', 'blue'], { red: 5 }, 'i', FULL);
  eq('default effect subject', p.majorTag, 'damage');
  eq('no minor', p.minorKey, null);
}

// ── 8. Missing effect sprite → fall through to the next available tag ──
{
  const am = fakeAM(['red_base', 'foreground_area', 'icon_border_2']); // no 'explode' sprite
  const p = resolveIconPlan(['red', 'explode', 'area'], { red: 5 }, 'j', am);
  eq('missing major falls through to area', p.majorTag, 'area');
  eq('no further effect → no minor', p.minorKey, null);
}

// ── 9. Border absent → borderKey null (graceful) ──
{
  const am = fakeAM(['red_base', 'foreground_damage']); // no border
  const p = resolveIconPlan(['red', 'damage'], { red: 5 }, 'k', am);
  eq('no border sprite → null', p.borderKey, null);
}

// ── 10. Base color fallback to neutral (skull) when the color has no orb ──
{
  const am = fakeAM(['skull_base', 'foreground_damage', 'icon_border_2']); // no red orb
  const p = resolveIconPlan(['red', 'damage'], { red: 5 }, 'l', am);
  eq('missing color base → skull', p.baseKey, 'skull_base');
}

// ── 11. Variant discovery: pick is within the authored set and deterministic ──
{
  const am = fakeAM([
    'red_base_1', 'red_base_2', 'red_base_3',
    'foreground_damage_1', 'icon_border_2',
  ]);
  const a = resolveIconPlan(['red', 'damage'], { red: 5 }, 'variant', am);
  const b = resolveIconPlan(['red', 'damage'], { red: 5 }, 'variant', am);
  check('variant in authored set', ['red_base_1', 'red_base_2', 'red_base_3'].includes(a.baseKey), a.baseKey);
  eq('effect variant resolved', a.majorKey, 'foreground_damage_1');
  eq('same spell → same variant', a.baseKey, b.baseKey);
}

// ── 12. Determinism: identical inputs → identical signature ──
{
  const a = resolveIconPlan(['yellow', 'damage', 'row'], { yellow: 6 }, 'spell_x', FULL);
  const b = resolveIconPlan(['yellow', 'damage', 'row'], { yellow: 6 }, 'spell_x', FULL);
  eq('two calls → identical signature', a.signature, b.signature);
  // signature distinguishes different layer stacks
  const c = resolveIconPlan(['blue', 'damage', 'row'], { blue: 6 }, 'spell_x', FULL);
  check('different base → different signature', a.signature !== c.signature);
}

// ── 13. hashString is a stable uint32 ──
{
  const h = hashString('red|damage');
  check('hash is uint32', (h >>> 0) === h && h >= 0);
  eq('hash deterministic', hashString('red|damage'), h);
}

// ── 14. No AssetManager → bare-prefix keys (still renderable) ──
{
  const p = resolveIconPlan(['red', 'damage'], { red: 5 }, 'noam');
  eq('no AM → bare base prefix', p.baseKey, 'red_base');
  eq('no AM → bare effect prefix', p.majorKey, 'foreground_damage');
  eq('no AM → border key assumed', p.borderKey, 'icon_border_2');
}

console.log(failed === 0
  ? `✓ spell-icon recipe tests: ${passed} checks passed`
  : `✗ spell-icon recipe tests: ${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
