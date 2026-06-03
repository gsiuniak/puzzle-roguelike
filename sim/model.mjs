/**
 * sim/model.mjs — math-only model of the gems battle economy.
 *
 * This is NOT the game. Nothing is rendered, no 8×8 grid is simulated, and the
 * real BattleController is never touched. Instead we model the *economy* of a
 * turn probabilistically (how many tiles a swap clears, how they split between
 * mana and skull damage, how often a 4+ grants an extra turn) and apply the
 * game's actual numeric formulas on top.
 *
 * Every constant here is a TUNABLE KNOB. They are the estimates from
 * docs/balance-scaling-research.md §16 ("The board economy"). The whole point
 * of the simulator is to let you vary these (and the stats/skills) and read the
 * resulting win-rate / turns / DPT distributions back out.
 *
 * The numeric formulas (skull damage, armor→block→HP) are faithful mirrors of
 * src/js/game/MatchResolver.js. If you change those in the game, mirror them
 * here too (they are intentionally duplicated to keep the sim dependency-free).
 */

export const MANA_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];

// ───────────────────────────────────────────────────────────────────────────
// Economy constants (the knobs). See research doc §16.
// ───────────────────────────────────────────────────────────────────────────
export const ECONOMY = {
  // Board composition — from src/js/game/TileTypes.js spawn weights
  // (5 colors @ 16% each, skull @ 20%). Used for incidental tile splitting.
  SKULL_BOARD_SHARE: 0.20,

  // Per-action (one swap) tile yield. Base match-size distribution BEFORE
  // cascades. Tune so the mean ≈ 3.5 and P(≥4) ≈ 0.30–0.40.
  MATCH_SIZE_DIST: [[3, 0.65], [4, 0.22], [5, 0.09], [6, 0.04]],

  // Chance a clear cascades into one more small match, and its size.
  CASCADE_CHANCE: 0.40,
  CASCADE_SIZE: 3,

  // Fraction of cleared tiles the player can steer toward their chosen
  // resource (their skill color, or skulls). The rest is incidental.
  FOCUS_FRACTION: 0.60,

  // Tiles per skull match group, for turning loose skull tiles into matches
  // (the (attack−1) bonus is per group, so grouping matters).
  SKULL_GROUP_SIZE: 3,

  // Bound on consecutive extra-turn chains in one turn.
  MAX_EXTRA_TURN_CHAIN: 5,

  // Skill-effect approximations:
  CREATE_TILE_MANA_FACTOR: 0.7, // a created tile ≈ 0.7 mana realized when later matched
  DESTROY_ROW_TILES: 8,         // a destroyed row ≈ 8 tiles for reward purposes

  // Hard cap on rounds so a stalemate can't loop forever.
  MAX_ROUNDS: 300,
};

// ───────────────────────────────────────────────────────────────────────────
// Seedable RNG (mulberry32) — deterministic & reproducible for re-analysis.
// ───────────────────────────────────────────────────────────────────────────
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleDist(rng, dist) {
  let r = rng();
  for (const [val, p] of dist) {
    r -= p;
    if (r <= 0) return val;
  }
  return dist[dist.length - 1][0];
}

// ───────────────────────────────────────────────────────────────────────────
// Faithful numeric-formula mirrors of src/js/game/MatchResolver.js
// ───────────────────────────────────────────────────────────────────────────

/** Matched skull group: skullCount + max(0, attack−1). (MatchResolver.js:66) */
export function matchedSkullDamage(attack, skullCount) {
  return skullCount + Math.max(0, attack - 1);
}

/** Destroyed (non-match) skulls: skullCount × (1 + floor(attack/3)). (MatchResolver.js:87) */
export function destroyedSkullDamage(attack, skullCount) {
  return skullCount * (1 + Math.floor(attack / 3));
}

/**
 * Apply damage respecting armor → block → HP. Mutates target {hp, armor, block}.
 * Mirror of MatchResolver.applyDamage (MatchResolver.js:173).
 * @returns {{ actualDamage:number, blocked:number, armorDamage:number }}
 */
export function applyDamage(target, amount) {
  let remaining = amount;
  let blocked = 0;
  let armorDamage = 0;
  if (target.armor > 0) {
    armorDamage = Math.min(target.armor, remaining);
    target.armor -= armorDamage;
    remaining -= armorDamage;
  }
  if (target.block > 0) {
    blocked = Math.min(target.block, remaining);
    target.block -= blocked;
    remaining -= blocked;
  }
  target.hp = Math.max(0, target.hp - remaining);
  return { actualDamage: amount - blocked, blocked, armorDamage };
}

/**
 * Draw one board action's raw yield.
 * @returns {{ tiles:number, fourPlus:boolean }}
 */
export function drawBoardAction(rng, econ = ECONOMY) {
  const base = sampleDist(rng, econ.MATCH_SIZE_DIST);
  let tiles = base;
  const fourPlus = base >= 4;
  if (rng() < econ.CASCADE_CHANCE) tiles += econ.CASCADE_SIZE;
  return { tiles, fourPlus };
}
