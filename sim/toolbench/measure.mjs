/**
 * toolbench/measure.mjs — PAIRED-BATCH measurement math (BROWSER-SAFE, pure).
 *
 * Extracted from trainer.mjs (2026-07-08, Balance Bench v2 Phase 0) so the
 * browser bench and the CLI sweeps compute ΔWin/CI/eqHP through the SAME code
 * path — numbers agree by construction.
 *
 * Methodology (docs/balance-power-model.md §6): two arms of battles on COMMON
 * RANDOM NUMBERS (same seed per pair, rng.mjs) — the paired win/loss
 * differences isolate the variant's effect, cutting the sample size needed to
 * resolve a few-pp delta by ~an order of magnitude vs independent batches.
 * eqHP converts ΔWin into "equivalent max-HP points" via the locally measured
 * win-per-HP slope — a currency that doesn't saturate near 0%/100% win.
 */

/** maxHp delta used to measure the local win/HP slope. */
export const HP_SLOPE_DELTA = 10;
/** Below 0.15pp/HP the frame is saturated — eqHP unreliable there. */
export const MIN_SLOPE = 0.0015;
/** Doc §6.1 reference progression (growth victories ≈ floors × this). */
export const WINS_PER_FLOOR = 0.7;

/**
 * Paired stats between two same-seed arms of Battle results
 * (arrays of `Battle.run()` outputs: { playerWon, turns, playerCasts, ... }).
 */
export function pairedStats(base, varr) {
  const n = base.length;
  let dSum = 0, d2Sum = 0, wB = 0, wV = 0, tB = 0, tV = 0, casts = 0, castsB = 0;
  for (let i = 0; i < n; i++) {
    const b = base[i].playerWon ? 1 : 0;
    const v = varr[i].playerWon ? 1 : 0;
    const d = v - b;
    dSum += d; d2Sum += d * d; wB += b; wV += v;
    tB += base[i].turns; tV += varr[i].turns;
    casts += varr[i].playerCasts; castsB += base[i].playerCasts;
  }
  const dWin = dSum / n;
  const varD = n > 1 ? (d2Sum - n * dWin * dWin) / (n - 1) : 0;
  const se = Math.sqrt(Math.max(0, varD) / n);
  return {
    n, winBase: wB / n, winVar: wV / n,
    dWin, ci95: 1.96 * se,
    dTurns: (tV - tB) / n,
    castsPerFight: casts / n,
    dCasts: (casts - castsB) / n,  // ≈0 → the added item never actually fired
  };
}

/** Combine per-frame ΔWin into an eqHP using frames whose slope is usable.
 *  `frameResults` = pairedStats outputs; `slopes` = [{ slope }] aligned. */
export function eqHpFrom(frameResults, slopes) {
  let dSum = 0, sSum = 0, used = 0;
  for (let i = 0; i < frameResults.length; i++) {
    if (slopes[i].slope >= MIN_SLOPE) { dSum += frameResults[i].dWin; sSum += slopes[i].slope; used++; }
  }
  if (!used) return null;
  return (dSum / used) / (sSum / used);
}

/** Wilson 95% interval for a plain (unpaired) win proportion — the bench's
 *  single-arm confidence wedge. Returns { lo, hi }. */
export function wilson95(wins, n) {
  if (!n) return { lo: 0, hi: 1 };
  const z = 1.96, p = wins / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}
