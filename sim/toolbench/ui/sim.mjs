/**
 * toolbench/ui/sim.mjs — measurement primitives on top of the worker pool.
 *
 * Thin, seed-disciplined helpers the views share. Semantics mirror trainer.mjs:
 * every comparison is PAIRED on common seeds (same seed → same board init +
 * refills up to divergence), eqHP converts ΔWin through a locally measured
 * win-per-HP slope, and baseline arms are cached per config signature so a
 * relic table / weave measure never re-runs an arm it already has.
 */

import { getPool, makeToken } from './pool.mjs';
import { pairedStats, HP_SLOPE_DELTA } from '../measure.mjs';

export { makeToken };

const CHUNK_BY_AI = { simple: 25, hard: 4, value: 2, custom: 4 };

export function seedsFor(ns, n, offset = 0) {
  // FNV-1a inline (hashSeed) is in rng.mjs but tiny — reimplement to avoid
  // pulling rng into the main thread namespace where someone might be tempted
  // to call withSeededRandom outside a worker.
  const hash = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = hash(`${ns}|${i + offset}`);
  return out;
}

/**
 * One arm of battles: player/enemy specs + seeds → Battle results (seed order).
 * cfg: { player, enemy:{id|def,floor,overrides}, seeds, playerSpec, enemySpec,
 *        battleOpts, chunk, onProgress, token }
 */
export async function runBattleArm(cfg) {
  const pool = getPool();
  const chunk = cfg.chunk || 12;
  const policies = {};
  if (cfg.playerSpec) policies.p = cfg.playerSpec;
  if (cfg.enemySpec) policies.e = cfg.enemySpec;
  const tasks = [];
  for (let i = 0; i < cfg.seeds.length; i += chunk) {
    tasks.push({
      type: 'battles',
      seeds: cfg.seeds.slice(i, i + chunk),
      player: cfg.player,
      enemy: cfg.enemy,
      playerPolicy: cfg.playerSpec ? 'p' : null,
      enemyPolicy: cfg.enemySpec ? 'e' : null,
      battleOpts: cfg.battleOpts || {},
    });
  }
  const chunks = await pool.map(tasks, {
    context: { policies },
    onProgress: cfg.onProgress && ((done, total) => cfg.onProgress(done / total)),
    token: cfg.token,
  });
  return chunks.flat();
}

/** Sensible chunk size for a policy choice key ('simple'|'hard'|...). */
export function chunkFor(aiKey) { return CHUNK_BY_AI[aiKey] || 8; }

/**
 * Paired A/B: run base and variant arms on the SAME seeds → pairedStats.
 * Progress spans both arms (0..1).
 */
export async function runPaired({ base, variant, seeds, onProgress, token }) {
  const half = (f, lo) => onProgress && onProgress(lo + f / 2);
  const baseResults = base.results || await runBattleArm({ ...base, seeds, onProgress: (f) => half(f, 0), token });
  const varResults = await runBattleArm({ ...variant, seeds, onProgress: (f) => half(f, 0.5), token });
  return { stats: pairedStats(baseResults, varResults), baseResults, varResults };
}

/* ── baseline/slope caches (per session) ── */
const armCache = new Map();
const slopeCache = new Map();

export function armCacheKey({ player, enemy, spec, seedsNs, n }) {
  return JSON.stringify({ player, enemy: { id: enemy.id || (enemy.def && enemy.def.id), floor: enemy.floor, ov: enemy.overrides || null }, spec, seedsNs, n });
}

/** Cached baseline arm (results array) for a config. */
export async function baselineArm(key, runFn) {
  if (!armCache.has(key)) armCache.set(key, await runFn());
  return armCache.get(key);
}

/**
 * Measured win-per-HP slope at (player build, enemy, AI): paired ±HP_SLOPE_DELTA
 * probe. Returns { slope, winBase }. Cached per signature.
 */
export async function hpSlope({ key, player, enemy, playerSpec, enemySpec, seeds, chunk, onProgress, token }) {
  if (slopeCache.has(key)) return slopeCache.get(key);
  const base = await baselineArm(key + '|base', () =>
    runBattleArm({ player, enemy, playerSpec, enemySpec, seeds, chunk, onProgress: onProgress && ((f) => onProgress(f / 2)), token }));
  const bumped = {
    ...player,
    statDelta: { ...(player.statDelta || {}), maxHp: ((player.statDelta && player.statDelta.maxHp) || 0) + HP_SLOPE_DELTA },
  };
  const varr = await runBattleArm({ player: bumped, enemy, playerSpec, enemySpec, seeds, chunk, onProgress: onProgress && ((f) => onProgress(0.5 + f / 2)), token });
  const s = pairedStats(base, varr);
  const out = { slope: s.dWin / HP_SLOPE_DELTA, winBase: s.winBase };
  slopeCache.set(key, out);
  return out;
}

/** Full seeded runs through run-core in the workers. */
export async function runRuns({ characterId, n, seedNs = 'gems-bench-runs', fightChance = 0.75, weaveFloors = 2, playerSpec = null, onProgress, token }) {
  const pool = getPool();
  const seeds = seedsFor(`${seedNs}|${characterId}`, n);
  const tasks = seeds.map((seed) => ({
    type: 'run',
    opts: { seed, characterId, fightChance, weaveFloors },
    playerPolicy: playerSpec ? 'p' : null,
  }));
  return pool.map(tasks, {
    context: { policies: playerSpec ? { p: playerSpec } : {} },
    onProgress: onProgress && ((done, total) => onProgress(done / total)),
    token,
  });
}

export function clearMeasureCaches() { armCache.clear(); slopeCache.clear(); }

/** Convenience: one arm → engine aggregate(). */
export async function runAgg(cfg) {
  const { aggregate } = await import('../engine.mjs');
  return aggregate(await runBattleArm(cfg));
}
