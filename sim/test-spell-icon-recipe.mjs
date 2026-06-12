/**
 * test-spell-icon-recipe.mjs — unit tests for the spell-icon keyword resolution
 * (src/js/icons/spellIconRecipe.js). Pure logic, no canvas — runs under node:
 *
 *   node sim/test-spell-icon-recipe.mjs
 *
 * Covers the coherence guarantees: slot-conflict demotion, dual-element rim
 * behavior, overlay cap, empty/unknown keyword handling, rarity → rim mapping,
 * and determinism (choices seed-independent; seed run-dependent).
 */

import {
  resolveRecipe,
  recipeKey,
  deriveIconSeed,
  KEYWORD_ICON_ROLES,
  PALETTE_IDS,
  GLYPH_IDS,
  OVERLAY_IDS,
  RIM_IDS,
} from '../src/js/icons/spellIconRecipe.js';

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const RUN = 'run_1234567890';

// ── 1. Basic mapping: element → palette, action → glyph ──
{
  const r = resolveRecipe(['red', 'damage'], 'spell_a', RUN);
  eq('red → fire palette', r.palette, 'fire');
  eq('damage → strike glyph', r.glyph, 'strike');
  eq('no secondary element', r.secondaryPalette, null);
  eq('no overlays', r.overlays.length, 0);
  eq('common keywords → iron rim', r.rim, 'iron');
  eq('fire → clouds bg', r.bgStyle, 'clouds');
}

// ── 2. Defaults: empty / unknown keywords never fail ──
{
  const r = resolveRecipe([], 'spell_b', RUN);
  eq('empty → arcane palette', r.palette, 'arcane');
  eq('empty → orb glyph', r.glyph, 'orb');
  const r2 = resolveRecipe(['nonsense_keyword', 'also_unknown'], 'spell_c', RUN);
  eq('unknown → arcane palette', r2.palette, 'arcane');
  eq('unknown → orb glyph', r2.glyph, 'orb');
  eq('unknown → no overlays', r2.overlays.length, 0);
  const r3 = resolveRecipe(null, 'spell_b2', RUN);
  eq('null keywords → orb glyph', r3.glyph, 'orb');
}

// ── 3. Dual element: second element only tints the rim (secondaryPalette) ──
{
  const r = resolveRecipe(['red', 'blue', 'damage'], 'spell_d', RUN);
  eq('first element wins body', r.palette, 'fire');
  eq('second element → secondary only', r.secondaryPalette, 'ice');
  // third element ignored
  const r2 = resolveRecipe(['red', 'blue', 'green'], 'spell_e', RUN);
  eq('third element ignored (palette)', r2.palette, 'fire');
  eq('third element ignored (secondary)', r2.secondaryPalette, 'ice');
}

// ── 4. Skull outranks colors (priority 32 > 30) regardless of input order ──
{
  const r = resolveRecipe(['red', 'skull'], 'spell_f', RUN);
  eq('skull wins the body palette', r.palette, 'bone');
  eq('red demotes to secondary', r.secondaryPalette, 'fire');
  eq('bone → ridged bg', r.bgStyle, 'ridged');
}

// ── 5. Form slot conflict: losing action demotes to its overlay ──
{
  // explode (26) beats damage (25); damage demotes to sparks
  const r = resolveRecipe(['damage', 'explode'], 'spell_g', RUN);
  eq('explode wins glyph', r.glyph, 'burst');
  check('damage demoted to sparks overlay', r.overlays.includes('sparks'), JSON.stringify(r.overlays));
}

// ── 6. Overlay cap: never more than 2, priority order wins ──
{
  // wild(28) + extra_turn(27) + lock(18) + random(14) → wild + sparks only
  const r = resolveRecipe(['wild', 'extra_turn', 'lock', 'random', 'red', 'damage'], 'spell_h', RUN);
  check('≤2 overlays', r.overlays.length <= 2, JSON.stringify(r.overlays));
  eq('highest-priority overlay first', r.overlays[0], 'wild');
  eq('second overlay', r.overlays[1], 'sparks');
}

// ── 7. Overlay dedup: demoted form + modifier mapping to same overlay ──
{
  // explode wins glyph; destroy demotes to 'wild'; wild modifier also 'wild' → deduped
  const r = resolveRecipe(['explode', 'destroy', 'wild'], 'spell_i', RUN);
  const wildCount = r.overlays.filter((o) => o === 'wild').length;
  eq('no duplicate overlay ids', wildCount, 1);
}

// ── 8. Rarity → rim ──
{
  eq('uncommon (skull) → bronze', resolveRecipe(['skull'], 's', RUN).rim, 'bronze');
  eq('rare (convert) → gold', resolveRecipe(['red', 'convert'], 's', RUN).rim, 'gold');
  eq('legendary (wild) → arcane rim', resolveRecipe(['red', 'damage', 'wild'], 's', RUN).rim, 'arcane');
}

// ── 9. Determinism: same inputs → identical recipe; choices seed-independent ──
{
  const a = resolveRecipe(['yellow', 'damage', 'row'], 'spell_j', RUN);
  const b = resolveRecipe(['yellow', 'damage', 'row'], 'spell_j', RUN);
  eq('two calls → identical recipe', recipeKey(a), recipeKey(b));

  const otherRun = resolveRecipe(['yellow', 'damage', 'row'], 'spell_j', 'run_999');
  eq('different run → same palette', otherRun.palette, a.palette);
  eq('different run → same glyph', otherRun.glyph, a.glyph);
  eq('different run → same overlays', otherRun.overlays.join(','), a.overlays.join(','));
  check('different run → different seed', otherRun.seed !== a.seed);

  const otherSpell = resolveRecipe(['yellow', 'damage', 'row'], 'spell_k', RUN);
  check('different spellId → different seed', otherSpell.seed !== a.seed);
}

// ── 10. Seed derivation is order-insensitive on keywords (sorted) ──
{
  const s1 = deriveIconSeed(RUN, 'x', ['red', 'damage']);
  const s2 = deriveIconSeed(RUN, 'x', ['damage', 'red']);
  eq('keyword order does not change seed', s1, s2);
  check('seed is uint32', s1 >>> 0 === s1 && s1 >= 0);
}

// ── 11. Registry integrity: every payload id exists in the compositor id lists ──
{
  for (const [id, def] of Object.entries(KEYWORD_ICON_ROLES)) {
    if (def.palette) check(`${id}.palette valid`, PALETTE_IDS.includes(def.palette), def.palette);
    if (def.glyph) check(`${id}.glyph valid`, GLYPH_IDS.includes(def.glyph), def.glyph);
    if (def.overlay) check(`${id}.overlay valid`, OVERLAY_IDS.includes(def.overlay), def.overlay);
    if (def.demoteTo && def.demoteTo.overlay) {
      check(`${id}.demoteTo valid`, OVERLAY_IDS.includes(def.demoteTo.overlay), def.demoteTo.overlay);
    }
  }
}

// ── 12. Every weave-able combo resolves to valid ids (sweep all tag pairs) ──
{
  const ids = Object.keys(KEYWORD_ICON_ROLES);
  let ok = true;
  for (const a of ids) {
    for (const b of ids) {
      const r = resolveRecipe([a, b], `sweep_${a}_${b}`, RUN);
      if (!PALETTE_IDS.includes(r.palette) || !GLYPH_IDS.includes(r.glyph)
        || !RIM_IDS.includes(r.rim) || r.overlays.some((o) => !OVERLAY_IDS.includes(o))
        || r.overlays.length > 2) {
        ok = false;
        console.error(`  sweep failed for [${a}, ${b}]: ${recipeKey(r)}`);
      }
    }
  }
  check('all tag pairs resolve to valid recipes', ok);
}

console.log(failed === 0
  ? `✓ spell-icon recipe tests: ${passed} checks passed`
  : `✗ spell-icon recipe tests: ${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
