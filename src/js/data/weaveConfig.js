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
  [TAG_RARITY.LEGENDARY]: 80 // 5,
});

// ═══════════════════════════════════════════════════════════
// 2. Weave shape (rounds per weave, tags per round)
// ═══════════════════════════════════════════════════════════

/**
 * How many ROUNDS a single weave runs (each round = one committed tag = one
 * recipe slot). Rolled once when the weave starts. Baseline ≈ 70 / 30 / 10.
 */
export const ROUNDS_PER_WEAVE_WEIGHTS = Object.freeze({
  2: 70,
  3: 30,
  4: 10,
});

/**
 * How many TAG OPTIONS a round offers (the player still picks exactly one).
 * Rolled independently for each round. Baseline ≈ 50 / 35 / 15.
 */
export const TAGS_PER_ROUND_WEIGHTS = Object.freeze({
  2: 50,
  3: 35,
  4: 15,
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
export const TAG_VALUE_TABLES = Object.freeze({
  // `create N tiles` — small rolls common, a 12 is a jackpot.
  create: { 3: 24, 4: 20, 5: 16, 6: 13, 7: 10, 8: 7, 9: 5, 10: 3, 11: 1.5, 12: 0.5 },
});

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
