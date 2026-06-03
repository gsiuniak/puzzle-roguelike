/**
 * sim/analyze.mjs — starter processor for a results file.
 *
 * Reads sim/out/results.json and derives the things we actually care about:
 *   - per-sweep marginal value (Δ win rate and Δ turns per unit of the varied stat)
 *   - an HP↔Attack exchange estimate (how many Max HP equals +1 Attack, by
 *     matching win rate across the two sweeps)
 *
 * This is intentionally simple and deterministic — it's the seed for the
 * "have an agent process that file later" step. An agent can read the same
 * JSON and reason more richly (curve shape, diminishing returns, per-archetype
 * differences, skill value vs cost trade-offs, etc.).
 *
 * Usage: node sim/analyze.mjs [path/to/results.json]
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'sim/out/results.json';
const data = JSON.parse(readFileSync(path, 'utf8'));

const round2 = (x) => Math.round(x * 100) / 100;

console.log(`\n=== Scenario pacing (target turns: normal 6-10, elite 12-18, boss 20-30) ===`);
for (const s of data.scenarios) {
  const a = s.aggregates;
  console.log(
    `${s.name.padEnd(26)} win=${(a.winRate * 100).toFixed(0)}%  ` +
    `turns ${a.playerActions.median} [${a.playerActions.p10}-${a.playerActions.p90}]  ` +
    `hpLeftOnWin=${(a.playerHpFracOnWin * 100).toFixed(0)}%`
  );
}

console.log(`\n=== Sweep marginal values (per +1 of the varied quantity) ===`);
const sweepByName = {};
for (const sw of data.sweeps) {
  sweepByName[sw.name] = sw;
  console.log(`\n${sw.name} — ${sw.note}`);
  console.log(`  ${sw.varying.padEnd(16)}  winRate  turns  hpLeftOnWin   Δwin/unit  Δturns/unit`);
  for (let i = 0; i < sw.points.length; i++) {
    const p = sw.points[i];
    const a = p.aggregates;
    let dWin = '', dTurns = '';
    if (i > 0) {
      const prev = sw.points[i - 1];
      const dv = p.value - prev.value || 1;
      dWin = round2((a.winRate - prev.aggregates.winRate) / dv);
      dTurns = round2((a.playerActions.mean - prev.aggregates.playerActions.mean) / dv);
    }
    console.log(
      `  ${String(p.value).padEnd(16)}  ${(a.winRate * 100).toFixed(0).padStart(5)}%  ` +
      `${String(a.playerActions.median).padStart(5)}  ${(a.playerHpFracOnWin * 100).toFixed(0).padStart(9)}%  ` +
      `${String(dWin).padStart(10)}  ${String(dTurns).padStart(11)}`
    );
  }
}

// ── HP ↔ Attack exchange estimate (match win rate or turns-to-kill) ──────────
// Uses the two floor5 sweeps if present: for each attack value, find the maxHp
// that yields the same win rate, then report the HP-per-attack-point ratio.
function interpHpForWinRate(hpSweep, targetWin) {
  const pts = hpSweep.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const wa = a.aggregates.winRate, wb = b.aggregates.winRate;
    if ((wa <= targetWin && wb >= targetWin) || (wa >= targetWin && wb <= targetWin)) {
      const t = wb === wa ? 0 : (targetWin - wa) / (wb - wa);
      return a.value + t * (b.value - a.value);
    }
  }
  return null;
}

const atk = sweepByName['attack_value_vs_floor5'];
const hp = sweepByName['maxhp_value_vs_floor5'];
if (atk && hp) {
  console.log(`\n=== HP ↔ Attack exchange (equal win rate vs floor5) ===`);
  console.log(`  Attack  winRate  equiv MaxHP   HP per +1 Attack (vs base)`);
  const base = atk.points[0];
  for (const p of atk.points) {
    const equivHp = interpHpForWinRate(hp, p.aggregates.winRate);
    let perPoint = '';
    if (equivHp != null) {
      const baseHp = interpHpForWinRate(hp, base.aggregates.winRate);
      const dAtk = p.value - base.value;
      if (baseHp != null && dAtk > 0) perPoint = round2((equivHp - baseHp) / dAtk);
    }
    console.log(
      `  ${String(p.value).padStart(6)}  ${(p.aggregates.winRate * 100).toFixed(0).padStart(6)}%  ` +
      `${equivHp == null ? '   (off-scale)' : round2(equivHp).toString().padStart(11)}  ${String(perPoint).padStart(12)}`
    );
  }
  console.log(`\n  Interpretation: "HP per +1 Attack" is the fight-length-dependent`);
  console.log(`  exchange rate from research §11.1. Compare floor5 vs boss sweeps —`);
  console.log(`  the boss number should be higher (attack worth more in long fights).`);
}
