/**
 * weaveConfig.js — tunable RNG tables for the "Weave a Power" (Skill Weave)
 * synthesis system.
 *
 * This is the SINGLE place to retune the randomness of the weave. Everything
 * here is data + a couple of pure helpers; no game logic. Three layers of RNG
 * are configured:
 *
 *   1. TAG RARITY   — how likely each rarity tier is to appear in a draw.
 *   2. WEAVE SHAPE  — how many ROUNDS a weave has, and how many TAGS each round
 *                     offers.
 *   3. HIDDEN VALUES — per-tag "high-roll" tables (e.g. a `create` tag rolls a
 *                     count between 3 and 12). Resolved at synthesis time.
 *
 * IMPORTANT: every weight table here is a set of *relative weights* — they do
 * NOT need to sum to 100. They are normalized at pick time (a weight's chance ≈
 * its weight ÷ the summed weights of the candidates). This means you can tweak a
 * single number without rebalancing the rest, and a table like `{2:70,3:30,4:10}`
 * (which sums to 110) behaves exactly as intended.
 *
 * Consumed by skillWeaveTags.js (rarity-weighted draws) and skillSynthesizer.js
 * (hidden value rolls).
 */

// ═══════════════════════════════════════════════════════════
// 1. Tag rarity
// ═══════════════════════════════════════════════════════════

/** Canonical rarity tiers. Each tag in the catalog carries one of these. */
export const TAG_RARITY = Object.freeze({
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  LEGENDARY: 'legendary',
});

/**
 * Relative draw weight per rarity. A tag's chance of being picked for an option
 * slot is its rarity weight ÷ the summed weight of all eligible candidates, so
 * rarer tags surface less often. Baseline ≈ 60 / 25 / 10 / 5.
 */
export const RARITY_WEIGHTS = Object.freeze({
  [TAG_RARITY.COMMON]: 60,
  [TAG_RARITY.UNCOMMON]: 25,
  [TAG_RARITY.RARE]: 10,
  [TAG_RARITY.LEGENDARY]: 5,
});

/**
 * Draw-weight multiplier applied to ELEMENT (color) tags that match the player's
 * affinity — the colors of their character's starting skills (e.g. Warrior →
 * red/blue, Mage → purple/yellow). A SLIGHT nudge so woven skills lean toward
 * the colors the player already builds around, without locking the others out.
 */
export const COLOR_AFFINITY_WEIGHT = 1.6;

// ═══════════════════════════════════════════════════════════
// 2. Weave shape (rounds per weave, tags per round)
// ═══════════════════════════════════════════════════════════

/**
 * How many ROUNDS a single weave runs (each round = one committed tag = one
 * recipe slot). Rolled once when the weave starts. Baseline ≈ 70 / 30 / 10.
 */
export const ROUNDS_PER_WEAVE_WEIGHTS = Object.freeze({
  // 2: 70,
  3: 60,
  4: 30,
});

/**
 * How many TAG OPTIONS a round offers (the player still picks exactly one).
 * Rolled independently for each round. Baseline ≈ 50 / 35 / 15.
 */
export const TAGS_PER_ROUND_WEIGHTS = Object.freeze({
  // 2: 20,
  3: 60,
  4: 40,
});

// ═══════════════════════════════════════════════════════════
// 3. Hidden per-tag value tables ("high-rolling")
// ═══════════════════════════════════════════════════════════

/**
 * Hidden value roll tables, keyed by tag id. When a tag with an entry here is
 * synthesized, its magnitude is rolled from this table (value → relative
 * weight) instead of being a fixed 1. This is what lets e.g. `create` produce
 * anywhere from 3 to 12 tiles, with big rolls being rare.
 *
 * Tune freely — add a tag id with its own {value: weight} map to give it a
 * hidden roll; a tag absent from this table has no hidden value (magnitude 1).
 */
// Base-damage roll shared by the two damage tags (`physical` / `magical`) and
// the internal `damage` fallback. The stat-SCALING multiplier rides on top of
// this base (see DAMAGE_SCALING_WEIGHTS) and is what makes the spell grow.
const DAMAGE_ROLL = { 4: 18, 5: 22, 6: 20, 7: 14, 8: 10, 9: 7, 10: 5, 11: 2.5, 12: 1.5 };

export const TAG_VALUE_TABLES = Object.freeze({
  // `create N tiles` — small rolls common, a 12 is a jackpot.
  create: { 3: 18, 4: 26, 5: 16, 6: 13, 7: 10, 8: 7, 9: 5, 10: 3, 11: 1.5, 12: 0.5 },

  // ── Action magnitudes ──
  // `deal N physical/magical` — mid rolls common (same base for both types; the
  // damage TYPE only changes which stat it scales with + the keyword shown).
  physical: DAMAGE_ROLL,
  magical:  DAMAGE_ROLL,
  damage:   DAMAGE_ROLL, // internal fallback (verb-less bag / random safety)
  armor:  { 4: 18, 5: 22, 6: 20, 7: 14, 8: 10, 9: 7, 10: 5, 11: 2.5, 12: 1.5 },
  heal:   { 4: 16, 5: 20, 6: 20, 7: 15, 8: 11, 9: 8, 10: 5, 11: 3, 12: 2 },
  // `gain N mana` of a color.
  gain:   { 3: 25, 4: 25, 5: 20, 6: 14, 7: 9, 8: 7 },
  // `drain N mana` from the opponent (drains EVERY color when un-elemented,
  // so the table stays modest).
  drain:  { 2: 0, 3: 40, 4: 32, 5: 12, 6: 6 },
  // `gain N attack` — permanent for the battle, so the rolls are small.
  attack: { 1: 55, 2: 33, 3: 12 },

  // ── Status durations (turn cycles) ──
  silence:    { 2: 50, 3: 35, 4: 15 },
  cripple:    { 2: 50, 3: 35, 4: 15 },
  enfeeble:   { 2: 50, 3: 35, 4: 15 },
  brittle:    { 2: 45, 3: 38, 4: 17 },
  bleed:      { 2: 45, 3: 35, 4: 20 },
  frozen:     { 2: 50, 3: 35, 4: 15 },
  intangible: { 1: 80, 2: 20, 3: 0  },
  berserk:    { 2: 55, 3: 33, 4: 12 },
  barrier:    { 2: 45, 3: 35, 4: 20 },
});

// ═══════════════════════════════════════════════════════════
// 4. Downsides are CHOICE-DRIVEN (no random injection)
// ═══════════════════════════════════════════════════════════
//
// The old "the weave surges" INJECTION_CONFIG is GONE. Previously a tag with
// nothing to attach to (an orphan shape, `wild` without `create`, an unused
// element, a 2nd targeted action) was rescued by injecting a free complementary
// effect — which both removed the intended "sometimes a bad result" texture and
// silently inflated power. Now those redundant/incompatible picks DETERMINISTIC-
// ALLY contribute nothing (pure opportunity cost) and are surfaced to the player
// with a reason on the result screen — a "bad weave" you could have avoided, not
// a dice roll. The rule + reason strings live in skillSynthesizer.js
// (`wastedReasons`); there is no probability table to tune here.

// ═══════════════════════════════════════════════════════════
// 5. Cost color weights (synthesized-skill cost color)
// ═══════════════════════════════════════════════════════════

/**
 * Relative weights for ROLLING a synthesized skill's cost COLOR. Elements in
 * the bag and the primary action's affinity color INFLUENCE the color without
 * dictating it: every mana color gets `anyColor` baseline weight, the bag's
 * first element adds `firstElement`, later elements add `otherElement`, and
 * the primary action's affinity color adds `actionAffinity` (weights stack
 * when they land on the same color).
 */
export const COST_COLOR_WEIGHTS = Object.freeze({
  firstElement: 60,
  otherElement: 25,
  actionAffinity: 20,
  anyColor: 15,
  // Added to each of the CHARACTER's affinity colors (their starting-skill
  // colors) in the fallback cost-color roll — so a woven spell's cost leans
  // toward the colors the character actually generates. Strong enough to usually
  // win, but not absolute. (Only the fallback path; an explicitly woven element
  // still dictates its own cost color.)
  characterAffinity: 50,
});

/**
 * Off-color cost SUBSIDY. When the fallback cost color rolls OFF the character's
 * affinity (a color they don't generate well), split the total so part is
 * charged in their primary affinity color instead — a 2-color cost that's easier
 * to fund. `affinityFraction` of the total moves to the affinity color (the
 * off-color keeps the rest); costs below `minTotal` stay single-color.
 */
export const COST_AFFINITY_SUBSIDY = Object.freeze({
  affinityFraction: 0.4,
  minTotal: 4,
});

/**
 * Cost-color SKEW for the two damage tags, applied ONLY when no element tag
 * dictates the cost color (the rollCostColor fallback — i.e. "without influence").
 * These relative weights are ADDED to each color's baseline so the cost color
 * gradients toward the type's flavor: Physical skews red→…→purple, Magical the
 * reverse. Tune the spread freely.
 */
export const DAMAGE_COLOR_SKEW = Object.freeze({
  physical: { red: 45, blue: 32, green: 22, yellow: 14, purple: 8 },
  magical:  { purple: 45, yellow: 32, green: 22, blue: 14, red: 8 },
});

// ═══════════════════════════════════════════════════════════
// 5b. Damage stat-scaling (woven damage tags) + the "Greater" qualifier
// ═══════════════════════════════════════════════════════════

/**
 * Relative draw weights for the damage SCALING multiplier a woven Physical/
 * Magical tag rolls. Keys MUST match DAMAGE_SCALING_PRESETS in scalingConfig.js
 * (_33 = ×1/3 … _300 = ×3). Bigger multipliers are rarer — a high roll is a
 * lucky score. Adjust freely to retune how punchy woven damage scales.
 */
export const DAMAGE_SCALING_WEIGHTS = Object.freeze({
  _33: 30, _50: 26, _100: 22, _150: 12, _200: 6, _250: 3, _300: 1.5,
});

/**
 * How a rolled scaling multiplier contributes to the spell's POWER (→ cost).
 * Cost rises with the multiplier but NOT strictly linearly: the contribution is
 * scaled by a random "cost luck" factor in [luckMin, luckMax], so a player can
 * occasionally land a big multiplier that comes in under-priced.
 *   estStat       — assumed Attack/Magic when power-costing the scaling mid-run
 *   perScaledPoint— POWER per estimated scaled-damage point (≈ POWER.perDamage)
 *   luckMin/luckMax — random discount window on the scaling's power
 */
export const DAMAGE_SCALING_POWER = Object.freeze({
  estStat: 4,
  perScaledPoint: 0.5,
  luckMin: 0.5,
  luckMax: 1.0,
});

/**
 * The "Greater" qualifier tag: a magnitude multiplier for any magnitude verb
 * (Create / Physical / Magical / Attack / Armor / Heal / Drain) — OR, if there's
 * no such verb to amplify, it widens an AREA destruction (3x3 → 5x5). Also has a
 * chance to SURGE (emit one extra synergistic effect). The magnitude boost is
 * always at least +1 so small gains (e.g. +1 Attack) still grow.
 *   damageMult  — multiply a damage/attack/armor/heal/drain base amount
 *   createMult  — multiply a create tag's tile count
 *   surgeChance — probability that consuming Greater also adds a synergy effect
 */
export const GREATER_CONFIG = Object.freeze({
  damageMult: 1.75,
  createMult: 1.6,
  surgeChance: 0.6,
});

// ═══════════════════════════════════════════════════════════
// 6. Mana cost rolls (synthesized-skill costs)
// ═══════════════════════════════════════════════════════════

/**
 * Synthesized-skill mana cost configuration.
 *
 * Cost is CONTINUOUS in the spell's POWER score, not a tiered band:
 *
 *     total ≈ clamp(round(power / powerPerMana) + jitter, min, max)
 *
 * so a more powerful spell costs proportionally more, with no cheap ceiling for
 * a stacked spell to hide under (the old flat 4-tier band capped at ~11 and
 * badly undercut authored skills).
 *
 *  - `powerPerMana` (K) is the target POWER-PER-MANA ratio, CALIBRATED against
 *    the authored catalog skills so woven spells sit in the same band. Catalog
 *    skills run ~1.0–2.6 power/mana, averaging ~1.85 (Bash/Fracture 2.6, Summon
 *    Dead 2.0, Defend 1.7, Oungan 1.3, Arcane Inscription 1.0). K is set a touch
 *    BELOW that average → woven spells are slightly pricier than the average
 *    authored skill, fair given their flexibility + hidden high-rolls.
 *  - `min`/`max` clamp the TOTAL cost (summed across colors). A big spell should
 *    hurt — the ceiling is intentionally high.
 *  - `jitterWeights` is a small ± offset for texture (offset → relative weight).
 *  - `maxColors` caps how many colors a multi-element bag's cost is split across
 *    (see skillSynthesizer.buildCost).
 */
export const MANA_COST_CONFIG = Object.freeze({
  powerPerMana: 1.7,
  min: 3,
  max: 15,
  jitterWeights: Object.freeze({ '-1': 22, 0: 56, 1: 22 }),
  maxColors: 2,
});

/**
 * Compute a synthesized skill's TOTAL mana cost from its power score
 * (continuous, clamped, with a small jitter). The synthesizer then splits this
 * across the woven colors (skillSynthesizer.buildCost).
 * @param {number} power — the synthesizer's computed power score
 * @returns {number} total cost (summed across all colors)
 */
export function computeManaCostTotal(power = 0) {
  const cfg = MANA_COST_CONFIG;
  const base = Math.round(Math.max(0, power || 0) / cfg.powerPerMana);
  const jitter = Number(pickWeightedKey(cfg.jitterWeights)) || 0;
  return Math.max(cfg.min, Math.min(cfg.max, base + jitter));
}

// ═══════════════════════════════════════════════════════════
// Weighted-pick helpers (relative weights; normalized at pick time)
// ═══════════════════════════════════════════════════════════

/**
 * Pick one key from a {key: weight} map, weighted by relative weight. Returns
 * the chosen key as a STRING (object keys are strings). Returns null for an
 * empty/all-zero map.
 * @param {Object<string, number>} weightMap
 * @returns {string|null}
 */
export function pickWeightedKey(weightMap) {
  const entries = Object.entries(weightMap || {}).filter(([, w]) => w > 0);
  return pickWeightedEntry(entries);
}

/**
 * Pick one key from an array of [key, weight] entries, weighted by relative
 * weight. Returns null for an empty/all-zero list.
 * @param {Array<[any, number]>} entries
 * @returns {any}
 */
export function pickWeightedEntry(entries) {
  const list = (entries || []).filter(([, w]) => w > 0);
  if (!list.length) return null;
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [key, w] of list) {
    r -= w;
    if (r < 0) return key;
  }
  return list[list.length - 1][0]; // float-rounding fallback
}

/** Roll the number of rounds for a weave (2–4). */
export function rollRoundsPerWeave() {
  return Number(pickWeightedKey(ROUNDS_PER_WEAVE_WEIGHTS)) || 2;
}

/** Roll the number of tag options for a single round (2–4). */
export function rollTagsPerRound() {
  return Number(pickWeightedKey(TAGS_PER_ROUND_WEIGHTS)) || 2;
}

/**
 * Roll a damage SCALING preset KEY (weighted). The synthesizer maps the key to
 * its multiplier via DAMAGE_SCALING_PRESETS (scalingConfig.js). Falls back to
 * the modest `_33` (×1/3) preset.
 * @returns {string} a DAMAGE_SCALING_PRESETS key (e.g. '_100')
 */
export function rollDamageScalingPreset() {
  return pickWeightedKey(DAMAGE_SCALING_WEIGHTS) || '_33';
}

/**
 * Roll a tag's hidden value from TAG_VALUE_TABLES, or null if it has none.
 * @param {string} tagId
 * @returns {number|null}
 */
export function rollTagValue(tagId) {
  const table = TAG_VALUE_TABLES[tagId];
  if (!table) return null;
  const v = pickWeightedKey(table);
  return v == null ? null : Number(v);
}
