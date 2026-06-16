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
  // 2: 70,
  3: 80,
  4: 20,
});

/**
 * How many TAG OPTIONS a round offers (the player still picks exactly one).
 * Rolled independently for each round. Baseline ≈ 50 / 35 / 15.
 */
export const TAGS_PER_ROUND_WEIGHTS = Object.freeze({
  2: 20,
  3: 60,
  4: 20,
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

  // ── Action magnitudes ──
  // `deal N damage` / `gain N armor` / `heal N HP` — mid rolls common.
  damage: { 4: 18, 5: 22, 6: 20, 7: 14, 8: 10, 9: 7, 10: 5, 11: 2.5, 12: 1.5 },
  armor:  { 4: 18, 5: 22, 6: 20, 7: 14, 8: 10, 9: 7, 10: 5, 11: 2.5, 12: 1.5 },
  heal:   { 4: 16, 5: 20, 6: 20, 7: 15, 8: 11, 9: 8, 10: 5, 11: 3, 12: 2 },
  // `gain N mana` of a color.
  gain:   { 3: 25, 4: 25, 5: 20, 6: 14, 7: 9, 8: 7 },
  // `drain N mana` from the opponent (drains EVERY color when un-elemented,
  // so the table stays modest).
  drain:  { 2: 30, 3: 30, 4: 22, 5: 12, 6: 6 },
  // `gain N attack` — permanent for the battle, so the rolls are small.
  attack: { 1: 55, 2: 33, 3: 12 },

  // ── Status durations (turn cycles) ──
  silence:    { 2: 50, 3: 35, 4: 15 },
  cripple:    { 2: 50, 3: 35, 4: 15 },
  enfeeble:   { 2: 50, 3: 35, 4: 15 },
  brittle:    { 2: 45, 3: 38, 4: 17 },
  bleed:      { 2: 45, 3: 35, 4: 20 },
  frozen:     { 2: 50, 3: 35, 4: 15 },
  intangible: { 1: 60, 2: 30, 3: 10 },
  berserk:    { 2: 55, 3: 33, 4: 12 },
  barrier:    { 2: 45, 3: 35, 4: 20 },
});

// ═══════════════════════════════════════════════════════════
// 4. Tag injection ("the weave surges")
// ═══════════════════════════════════════════════════════════

/**
 * Chance (0–100, %) for each tag-INJECTION rule in the synthesizer. Injection
 * is the anti-"inert tag" mechanism: instead of a picked tag doing nothing, the
 * weave conjures a complementary effect the player didn't pick. Tune each rule
 * independently; 0 disables a rule (the tag goes inert instead).
 */
export const INJECTION_CONFIG = Object.freeze({
  /** `wild` with no `create` → conjures Thrall tiles anyway. */
  wildCreates: 100,
  /** A shape with no destroyer/converter → injects a destroy of that shape. */
  orphanShapeDestroys: 100,
  /** `random` with nothing to randomize → a chaotic surge of rolled mana. */
  orphanRandomGains: 100,
  /** An element consumed by nothing (not even the cost) → conjures its tiles. */
  unusedElementCreates: 90,
  /** A 2nd targeted action (targeting slot taken) → vents as direct damage. */
  ventedActionDamages: 100,
  /** A PURE damage spell (every effect is damage) → surges an Extra Turn. */
  pureDamageExtraTurn: 75,
});

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
  actionAffinity: 30,
  anyColor: 4,
});

// ═══════════════════════════════════════════════════════════
// 6. Mana cost rolls (synthesized-skill costs)
// ═══════════════════════════════════════════════════════════

/**
 * Synthesized-skill mana cost configuration.
 *
 * A spell's cost is rolled from a FLOOR..CEILING band. The base band is
 * 5..8; every POWER threshold the spell's computed power score passes raises
 * BOTH the floor and the ceiling by 1, so stronger spells cost more while
 * keeping the same roll spread.
 *
 * `spreadWeights` sets the relative chance of each offset WITHIN the band
 * (key 0 = the floor, key (ceiling−floor) = the ceiling) — tweak any single
 * number to bias rolls cheap or expensive.
 */
export const MANA_COST_CONFIG = Object.freeze({
  baseFloor: 5,
  baseCeiling: 8,
  /** Power score thresholds; each one passed → +1 floor AND +1 ceiling. */
  powerTierThresholds: Object.freeze([14, 22, 32]),
  /** Offset-from-floor → relative weight (cheap rolls slightly favored). */
  spreadWeights: Object.freeze({ 0: 30, 1: 30, 2: 25, 3: 15 }),
});

/**
 * Roll a synthesized skill's mana cost from its power score.
 * @param {number} power — the synthesizer's computed power score
 * @returns {{ cost: number, floor: number, ceiling: number, tier: number }}
 */
export function rollManaCost(power = 0) {
  const cfg = MANA_COST_CONFIG;
  let tier = 0;
  for (const t of cfg.powerTierThresholds) if (power >= t) tier++;
  const floor = cfg.baseFloor + tier;
  const ceiling = cfg.baseCeiling + tier;
  const bandWidth = ceiling - floor;
  const entries = [];
  for (let off = 0; off <= bandWidth; off++) {
    entries.push([off, cfg.spreadWeights[off] != null ? cfg.spreadWeights[off] : 1]);
  }
  const off = pickWeightedEntry(entries);
  const cost = floor + (off == null ? 0 : Number(off));
  return { cost, floor, ceiling, tier };
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
