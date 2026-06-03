/**
 * sim/model.mjs — shared primitives for the headless sim.
 *
 * Just the seedable RNG and faithful mirrors of the game's numeric formulas
 * (src/js/game/MatchResolver.js). The board itself lives in board.mjs and the
 * battle/AI in engine.mjs.
 *
 * (The earlier ABSTRACT economy model — assumed tiles/turn, focus fraction,
 * 4+ rate — has been retired: the real-board sim now MEASURES those instead of
 * assuming them. See sim/README.md.)
 */

// ── seedable RNG (mulberry32) — deterministic & reproducible ────────────────
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── faithful numeric-formula mirrors of src/js/game/MatchResolver.js ─────────

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
