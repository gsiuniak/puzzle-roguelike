/**
 * sim/run-power.mjs — power-progression runner.
 *
 * Runs many progressions, averages the mock character's POWER (EHP × DPT) per
 * floor, and turns it into enemy stat budgets + a Chokeweed-style "check" per
 * floor. The end goal: "give me a floor → here's the player's power and a fair
 * enemy stat spread."
 *
 * Usage:
 *   node sim/run-power.mjs                 # 200 runs, seed 12345, 10 floors
 *   node sim/run-power.mjs --runs 500 --floors 10
 *
 * Writes sim/out/power.json and prints tables.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runProgression } from './progression.mjs';
import { enemyBudgets, chokeweedCheck, ROLE_TARGETS, POWER_CFG } from './power.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}
const RUNS = parseInt(arg('runs', '200'), 10);
const SEED = parseInt(arg('seed', '12345'), 10);
const FLOORS = parseInt(arg('floors', '10'), 10);
const OUT = arg('out', 'sim/out/power.json');

const seedFor = (i) => (SEED + Math.imul(i, 0x9e3779b1)) >>> 0;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round1 = (x) => Math.round(x * 10) / 10;
function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
const median = (a) => pct(a, 50);

console.log(`[power] runs=${RUNS} seed=${SEED} floors=${FLOORS}  (EHP metronome=${POWER_CFG.EHP_METRONOME_DMG}/round, DPT window=${POWER_CFG.DPT_WINDOW})`);

// run all progressions; collect per-floor rows
const byFloor = Array.from({ length: FLOORS }, () => []);
for (let i = 0; i < RUNS; i++) {
  const rows = runProgression(seedFor(i), FLOORS);
  rows.forEach((r, idx) => byFloor[idx].push(r));
}

const floors = byFloor.map((rows, idx) => {
  const f = idx + 1;
  // Budget against the MEDIAN build (robust to the sustain-relic right-skew that
  // drags the mean up). Mean kept in output for reference.
  const dpt = round1(median(rows.map((r) => r.dpt)));
  const ehp = Math.round(median(rows.map((r) => r.ehp)));
  const powerVals = rows.map((r) => r.power);
  const player = { dpt, ehp };
  return {
    floor: f,
    attack: round1(mean(rows.map((r) => r.attack))),
    maxHp: Math.round(mean(rows.map((r) => r.maxHp))),
    player,
    power: { median: median(powerVals), mean: Math.round(mean(powerVals)), p10: pct(powerVals, 10), p90: pct(powerVals, 90) },
    budgets: enemyBudgets(player),
    chokeweed: chokeweedCheck(player),
  };
});

// ── print ─────────────────────────────────────────────────────────────────
console.log(`\n=== Player power per floor (mock: growth + random relics) ===`);
console.log(`  (DPT/EHP/Power are MEDIAN builds; power p10-p90 shows relic-RNG spread)`);
console.log(`  floor  atk  maxHP   DPT    EHP   POWER (p10-p90)`);
for (const fl of floors) {
  console.log(
    `  ${String(fl.floor).padStart(5)}  ${String(fl.attack).padStart(3)}  ${String(fl.maxHp).padStart(5)}  ` +
    `${String(fl.player.dpt).padStart(4)}  ${String(fl.player.ehp).padStart(5)}  ` +
    `${String(fl.power.median).padStart(5)} (${fl.power.p10}-${fl.power.p90})`
  );
}

console.log(`\n=== Enemy stat budgets per floor (HP / DPT [≈attack]) ===`);
console.log(`  normal=${ROLE_TARGETS.normal.turns}t/${ROLE_TARGETS.normal.lossFrac}EHP  ` +
  `elite=${ROLE_TARGETS.elite.turns}t/${ROLE_TARGETS.elite.lossFrac}EHP  boss=${ROLE_TARGETS.boss.turns}t/${ROLE_TARGETS.boss.lossFrac}EHP`);
console.log(`  floor |        normal        |         elite        |          boss`);
for (const fl of floors) {
  const b = fl.budgets;
  const cell = (x) => `HP ${String(x.hp).padStart(3)}  dmg ${String(x.dpt).padStart(4)} (atk~${x.attackApprox})`;
  console.log(`  ${String(fl.floor).padStart(5)} | ${cell(b.normal)} | ${cell(b.elite)} | ${cell(b.boss)}`);
}

console.log(`\n=== Chokeweed-style "scaling check" per floor (no board interaction) ===`);
console.log(`  A race: kill it (its HP) before its ramping attack drains you.`);
console.log(`  floor   HP   startAtk  ramp/turn   (killable ~${8}t, lethal ~${11}t if you stall)`);
for (const fl of floors) {
  const c = fl.chokeweed;
  console.log(`  ${String(fl.floor).padStart(5)}  ${String(c.hp).padStart(3)}   ${String(c.startAttack).padStart(6)}     +${c.ramp}/turn   (kill≤${c.killTurns}t / die~${c.dieTurns}t)`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ meta: { seed: SEED, runs: RUNS, floors: FLOORS, powerCfg: POWER_CFG, roleTargets: ROLE_TARGETS }, floors }, null, 2));
console.log(`\n[power] wrote ${OUT}`);
