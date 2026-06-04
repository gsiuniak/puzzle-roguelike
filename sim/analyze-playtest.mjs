/**
 * sim/analyze-playtest.mjs — analyze recorded real-play metrics.
 *
 * Reads sim/out/playtest.jsonl (appended by sim/serve.mjs while playing with the
 * ?metrics flag) and prints per-floor and per-enemy aggregates, plus a side-by-side
 * with the sim's predictions if sim/out/power.json exists.
 *
 * Usage: node sim/analyze-playtest.mjs [path/to/playtest.jsonl]
 */

import { readFileSync, existsSync } from 'node:fs';

const path = process.argv[2] || 'sim/out/playtest.jsonl';
if (!existsSync(path)) {
  console.error(`No metrics file at ${path}. Play with ?metrics first (see sim/serve.mjs).`);
  process.exit(1);
}

const rows = readFileSync(path, 'utf8').split('\n')
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.kind === 'battle');

if (rows.length === 0) { console.log('No battle records yet.'); process.exit(0); }

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const pctNum = (x) => `${Math.round(x * 100)}%`;

function agg(list) {
  const wins = list.filter((r) => r.result === 'victory');
  const turns = list.map((r) => r.turns).filter((x) => typeof x === 'number');
  const hpFracOnWin = wins.map((r) => (r.playerMaxHp ? r.playerHp / r.playerMaxHp : 0));
  // implied player DPT on wins = enemy HP killed / turns
  const dptOnWin = wins.map((r) => (r.turns ? r.enemyMaxHp / r.turns : 0)).filter((x) => x > 0);
  return {
    n: list.length,
    winRate: list.length ? wins.length / list.length : 0,
    turns: r1(mean(turns)),
    hpLeftOnWin: mean(hpFracOnWin),
    impliedDpt: r1(mean(dptOnWin)),
  };
}

const sessions = new Set(rows.map((r) => r.session)).size;
console.log(`\n=== Playtest metrics: ${rows.length} battles, ${sessions} session(s) ===`);

// ── overall ──
const overall = agg(rows);
console.log(`\nOverall: ${pctNum(overall.winRate)} win  |  ${overall.turns} turns avg  |  ${pctNum(overall.hpLeftOnWin)} HP left on win`);

// ── by character ──
console.log(`\nBy character:`);
console.log(`  ${'character'.padEnd(16)}  n   win%   turns   hpLeftOnWin   maxFloor`);
const byChar = {};
for (const r of rows) (byChar[r.characterId || r.characterName || '?'] ||= []).push(r);
for (const id of Object.keys(byChar).sort()) {
  const list = byChar[id];
  const a = agg(list);
  const name = (list.find((r) => r.characterName) || {}).characterName || id;
  const maxFloor = Math.max(0, ...list.map((r) => r.floor || 0));
  console.log(
    `  ${String(name).padEnd(16)}  ${String(a.n).padStart(2)}  ${pctNum(a.winRate).padStart(5)}  ` +
    `${String(a.turns).padStart(6)}  ${pctNum(a.hpLeftOnWin).padStart(11)}  ${String(maxFloor).padStart(8)}`
  );
}

// ── by floor ──
console.log(`\nBy floor:`);
console.log(`  floor   n   win%   turns   hpLeftOnWin   impliedDPT`);
const byFloor = {};
for (const r of rows) (byFloor[r.floor] ||= []).push(r);
for (const f of Object.keys(byFloor).map(Number).sort((a, b) => a - b)) {
  const a = agg(byFloor[f]);
  console.log(
    `  ${String(f).padStart(5)}  ${String(a.n).padStart(2)}  ${pctNum(a.winRate).padStart(5)}  ` +
    `${String(a.turns).padStart(6)}  ${pctNum(a.hpLeftOnWin).padStart(11)}  ${String(a.impliedDpt).padStart(10)}`
  );
}

// ── by enemy ──
console.log(`\nBy enemy:`);
console.log(`  ${'enemy'.padEnd(20)}  n   win%   turns   hpLeftOnWin`);
const byEnemy = {};
for (const r of rows) (byEnemy[r.enemyId || r.enemyName || '?'] ||= []).push(r);
for (const id of Object.keys(byEnemy).sort()) {
  const a = agg(byEnemy[id]);
  console.log(
    `  ${String(id).padEnd(20)}  ${String(a.n).padStart(2)}  ${pctNum(a.winRate).padStart(5)}  ` +
    `${String(a.turns).padStart(6)}  ${pctNum(a.hpLeftOnWin).padStart(11)}`
  );
}

// ── vs sim prediction ──
if (existsSync('sim/out/power.json')) {
  const power = JSON.parse(readFileSync('sim/out/power.json', 'utf8'));
  console.log(`\nReal vs sim-predicted player DPT (by floor):`);
  console.log(`  floor   real DPT   sim DPT`);
  for (const f of Object.keys(byFloor).map(Number).sort((a, b) => a - b)) {
    const a = agg(byFloor[f]);
    const sim = power.floors.find((x) => x.floor === f);
    console.log(`  ${String(f).padStart(5)}   ${String(a.impliedDpt).padStart(8)}   ${String(sim ? sim.player.dpt : '—').padStart(7)}`);
  }
  console.log(`  (real DPT = enemyHP/turns on wins; rough, but should track the sim curve.)`);
}

console.log(`\n  Target pacing: normal 6-10 turns, elite 12-18, boss 20-30. Aim ~60-80% win on normal.`);
