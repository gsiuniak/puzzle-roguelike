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

console.log(`\n=== MEASURED economy (replaces the assumed §16 constants) ===`);
console.log(`  ${'scenario'.padEnd(26)}  DPT   m(skull/turn)  4+/turn  cascade/action  mana/turn`);
for (const s of data.scenarios) {
  const a = s.aggregates;
  console.log(
    `  ${s.name.padEnd(26)}  ${String(a.playerDPT).padStart(4)}  ` +
    `${String(a.skullGroupsPerAction).padStart(11)}  ${String(a.fourPlusPerAction).padStart(7)}  ` +
    `${String(a.cascadeStepsPerAction).padStart(14)}  ${String(a.manaPerAction).padStart(8)}`
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

// ── Skill cost→damage ratio knee ──────────────────────────────────────────
// For each ratio sweep, find where the skill starts beating the "skull baseline"
// (the lowest-ratio point, where the AI ignores the skill and just matches skulls).
console.log(`\n=== Skill cost→damage ratio: where a skill beats the skull baseline ===`);
const ratioSweeps = data.sweeps.filter((s) => (s.varying || '').startsWith('ratio@'));
const kneeBy = {};
for (const sw of ratioSweeps) {
  const pts = sw.points;
  const baseline = pts[0].aggregates.winRate; // skill ignored ⇒ ≈ pure skulls
  let knee = null, strong = null;
  for (const p of pts) {
    if (knee === null && p.aggregates.winRate >= baseline + 0.10) knee = p.value;
    if (strong === null && p.aggregates.winRate >= baseline + 0.30) strong = p.value;
  }
  kneeBy[sw.varying] = { baseline, knee, strong };
  console.log(
    `  ${sw.varying.padEnd(14)} baseline ${(baseline * 100).toFixed(0)}% (ignored) | ` +
    `knee @ratio ${knee ?? '>max'} (worth building) | strong @ratio ${strong ?? '>max'}`
  );
}

// ── Turn-this-into-in-game-data tables ─────────────────────────────────────
console.log(`\n=== RECOMMENDED IN-GAME DATA (derived from THIS run) ===`);

const c5 = kneeBy['ratio@cost5'];
if (c5 && c5.knee) {
  const minR = c5.knee;
  const goodR = c5.strong ?? +(c5.knee + 1.0).toFixed(1);
  console.log(`\nSkill damage by mana cost (pure single-color damage skill):`);
  console.log(`  min worth-building ≈ ${minR} dmg/mana, recommended ≈ ${goodR} dmg/mana`);
  console.log(`  ${'cost'.padStart(4)}  ${'min dmg'.padStart(8)}  ${'good dmg'.padStart(8)}`);
  for (const cost of [3, 4, 5, 6, 8, 10]) {
    console.log(`  ${String(cost).padStart(4)}  ${String(Math.round(cost * minR)).padStart(8)}  ${String(Math.round(cost * goodR)).padStart(8)}`);
  }
  console.log(`  (skills that ALSO bundle extra_turn / utility can sit below 'min dmg' for equal value.)`);
} else {
  console.log(`\n(No ratio knee found in range — skill never clearly beats the skull baseline; widen the sweep.)`);
}

const pacing = data.sweeps.find((s) => s.name === 'enemy_hp_pacing');
if (pacing && pacing.points.length >= 2) {
  const pts = pacing.points
    .map((p) => ({ hp: p.value, turns: p.aggregates.playerActions.mean }))
    .sort((a, b) => a.hp - b.hp);
  // slope from the two lowest-HP (highest-win, cleanest) points, then invert
  const [p0, p1] = pts;
  const slope = (p1.turns - p0.turns) / (p1.hp - p0.hp || 1);
  const hpForTurns = (T) => Math.max(1, Math.round(p0.hp + (T - p0.turns) / (slope || 1)));
  const dpt = pacing.points[0].aggregates.playerDPT;
  console.log(`\nEnemy HP for target fight length (reference player DPT ≈ ${dpt}):`);
  console.log(`  normal (~8 turns):  ~${hpForTurns(8)} HP`);
  console.log(`  elite  (~14 turns): ~${hpForTurns(14)} HP`);
  console.log(`  boss   (~24 turns): ~${hpForTurns(24)} HP`);
  console.log(`  → rule: enemy HP ≈ playerDPT × targetTurns. For a build with DPT=D, scale by D/${dpt}.`);
}
