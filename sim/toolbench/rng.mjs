/**
 * toolbench/rng.mjs — seeded RNG utilities for reproducible / PAIRED batches.
 *
 * The game code (BoardModel refill, engine pick/rint) draws from the global
 * Math.random, so the only way to seed a battle without touching src/ is to
 * temporarily swap Math.random for a seeded PRNG. `withSeededRandom` does that
 * swap-run-restore around a synchronous fn (the whole Battle ctor + run() must
 * happen inside the callback).
 *
 * Why: COMMON RANDOM NUMBERS. Running a baseline battle and a variant battle
 * on the SAME seed gives them identical board init + refills up to the point
 * where their decisions diverge, so the paired win/loss difference isolates
 * the variant's effect. This cuts the sample size needed to resolve a few-pp
 * win-rate delta by roughly an order of magnitude vs independent batches.
 *
 * NEVER leave the swap installed across async boundaries — fn must be sync.
 */

/** mulberry32 — small, fast, decent-quality 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the stringified parts → 32-bit seed. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Run `fn` with Math.random replaced by a seeded PRNG; always restores.
 * Returns fn's result. `fn` MUST be synchronous.
 */
export function withSeededRandom(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
