#!/usr/bin/env node
/**
 * toolbench/runs.mjs — FULL-RUN self-play measurement (the "randomized trial"
 * layer on top of engine.simulateRun) — CLI FRONTEND.
 *
 * The simulation core (runOneRun, the random-of-offered weave draft) lives in
 * run-core.mjs and the analysis math in run-analyze.mjs — both BROWSER-SAFE
 * and shared with the Balance Bench (sim/balance-bench.html). This file owns
 * the node-side concerns: arg parsing, the worker pool fan-out, JSONL I/O,
 * and console report formatting. (Split 2026-07-08, Balance Bench v2 Phase 0.)
 *
 * WHY RUNS, NOT BATTLES: per-battle uplift under-rates ramp/economy items
 * (a relic acquired on floor 3 pays rent for 7 more floors) and misses
 * interactions (Cestus × starting mana). The run is the real unit of power.
 *
 * WHY RANDOM-OF-OFFERED: rewards are generated exactly like the game
 * (rarity-weighted 3 options, no dupes) but the AI picks UNIFORMLY AT RANDOM
 * among them — realistic exposure, zero selection bias. Every reward node is
 * therefore a randomized controlled trial: per item, compare forward outcomes
 * when it was PICKED vs when it was OFFERED-BUT-NOT-PICKED (same contexts by
 * construction). Weave training nodes do the same per TAG.
 *
 * Usage (node, repo root):
 *   node sim/toolbench/runs.mjs simulate [--n 1000] [--chars a,b|all]
 *     [--policy greedy|value] [--weights <trained.json>]
 *     [--formula <weights.json> | --champion]
 *     [--learned <learned-value.json>] [--fightChance 0.75]
 *     [--weaves 2] [--out <file.jsonl>]
 *   node sim/toolbench/runs.mjs analyze [--log <runs-*.jsonl | newest>] [--min 25]
 *
 * Output: JSONL (one run per line, meta header first) in sim/toolbench/reports/.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CHARACTERS_BY_ID } from './engine.mjs';
import { loadWeights } from './policy.mjs';
import { hashSeed } from './rng.mjs';
import { analyzeRuns } from './run-analyze.mjs';

// Re-exported for back-compat (learn.mjs and older scripts import from here).
export { affinityColorsFor, makeRandomWovenSkill, makeWeaveHook, runOneRun } from './run-core.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pp = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp`;

/* ═══════════════════════════════ simulate ══════════════════════════════════ */

async function cmdSimulate(args) {
  const n = parseInt(args.n, 10) || 1000;
  const allChars = Object.keys(CHARACTERS_BY_ID);
  const chars = !args.chars || args.chars === 'all'
    ? allChars : String(args.chars).split(',').filter((c) => allChars.includes(c));
  const fightChance = args.fightChance != null ? Number(args.fightChance) : 0.75;
  // design target: ~2 weaves per act → 2 pre-sampled training floors per run
  // (a training node replaces that floor's fight, like a real map path)
  const weaveFloors = args.weaves != null ? parseInt(args.weaves, 10) : 2;
  // policy travels as a serializable SPEC (resolved inside each pool worker)
  let policyTag = 'greedy', policySpec = null, playerPolicy = null;
  if (args.formula || args.champion) {
    const { loadFormulaWeights } = await import('./formula.mjs');
    const { loadChampionWeights } = await import('./weights-node.mjs');
    if (args.formula === true || args.champion) {
      // bare --formula / --champion → the tracked WORKING champion weights
      policySpec = { kind: 'formula', weights: loadChampionWeights() };
      policyTag = 'formula:champion';
    } else {
      policySpec = { kind: 'formula', weights: loadFormulaWeights(JSON.parse(fs.readFileSync(String(args.formula), 'utf8'))) };
      policyTag = `formula:${path.basename(String(args.formula))}`;
    }
  } else if (args.learned) {
    // dynamic import — learn.mjs imports runs.mjs (makeRandomWovenSkill), so a
    // static import here would be a module cycle
    const { loadModel } = await import('./learn.mjs');
    policySpec = { kind: 'learned', model: loadModel(String(args.learned)) };
    policyTag = `learned:${path.basename(String(args.learned))}`;
  } else if (args.policy === 'value' || args.weights) {
    let weights = {};
    if (args.weights) {
      weights = loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8')));
      policyTag = `value:${path.basename(String(args.weights))}`;
    } else policyTag = 'value';
    policySpec = { kind: 'value', weights };
  }
  playerPolicy = policySpec != null;
  const dir = path.join(DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = args.out ? String(args.out) : path.join(dir, `runs-${stamp}.jsonl`);
  const out = fs.createWriteStream(file);
  out.write(JSON.stringify({ type: 'meta', date: new Date().toISOString(), n, chars, policy: policyTag, fightChance, weaveFloors }) + '\n');
  const { getPool } = await import('./pool.mjs');
  const pool = getPool();
  // --seedNs <str> selects an INDEPENDENT seed set (default 'gems-runs') — a
  // fresh, non-overlapping sample to confirm a result isn't a lucky seed set
  const seedNs = args.seedNs ? `gems-runs:${args.seedNs}` : 'gems-runs';
  line(`simulate: ${n} runs × ${chars.join(',')} policy=${policyTag} fightChance=${fightChance} weaveFloors=${weaveFloors} seedNs=${seedNs} workers=${pool.size}`);
  const t0 = Date.now();
  // fully seeded per-task → pool scheduling cannot change any result
  const tasks = [];
  for (const characterId of chars) {
    for (let i = 0; i < n; i++) {
      tasks.push({
        type: 'run',
        opts: { seed: hashSeed(seedNs, characterId, i), characterId, fightChance, weaveFloors },
        playerPolicy: playerPolicy ? 'p' : null,
      });
    }
  }
  const context = { policies: { p: policySpec } };
  const results = await pool.map(tasks, {
    context,
    onProgress: (done, totalN) => { if (done % 500 === 0) line(`  ...${done}/${totalN} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)`); },
  });
  const survivedBy = {};
  for (const rec of results) {
    survivedBy[rec.characterId] = (survivedBy[rec.characterId] || 0) + (rec.survived ? 1 : 0);
    out.write(JSON.stringify({ policy: policyTag, ...rec }) + '\n');
  }
  for (const characterId of chars) line(`  ${characterId.padEnd(13)} survival=${pct((survivedBy[characterId] || 0) / n)}`);
  await new Promise((resolve) => out.end(resolve));
  line(`log → ${path.relative(process.cwd(), file)} (${results.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return file;
}

/* ═══════════════════════════════ analyze ═══════════════════════════════════ */

async function cmdAnalyze(args) {
  const dir = path.join(DIR, 'reports');
  let file = args.log ? String(args.log) : null;
  if (!file && fs.existsSync(dir)) {
    const cands = fs.readdirSync(dir).filter((f) => f.startsWith('runs-') && f.endsWith('.jsonl')).sort();
    if (cands.length) file = path.join(dir, cands[cands.length - 1]);
  }
  if (!file || !fs.existsSync(file)) { line('analyze: no runs-*.jsonl found — run `runs.mjs simulate` first'); process.exitCode = 1; return; }
  const minN = parseInt(args.min, 10) || 25;
  line(`analyze: ${path.relative(process.cwd(), file)} (min events per arm: ${minN})`);

  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    records.push(JSON.parse(raw));
  }
  const res = analyzeRuns(records, { minN });

  /* ── health metrics ── */
  line('\n== run health ==');
  for (const [charId, cs] of Object.entries(res.perChar)) {
    const hist = Object.entries(cs.deaths).sort((a, b) => a[0] - b[0])
      .map(([f, k]) => `f${f}:${(k / cs.runs * 100).toFixed(0)}%`).join(' ');
    line(`  ${charId.padEnd(13)} runs=${cs.runs} survival=${pct(cs.survived / cs.runs).padStart(6)} meanWins=${(cs.victories / cs.runs).toFixed(1)} deaths[ ${hist} ]`);
  }
  line('  per-floor fight win rates:');
  const floorKeys = Object.keys(res.floorFights).sort((a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]));
  line('    ' + floorKeys.map((k) => `${k.replace('|', ' ')}=${pct(res.floorFights[k].wins / res.floorFights[k].n, 0)}`).join('  '));
  line('  deaths by enemy (fatal-fight avg turns; win rate over ALL encounters):');
  for (const e of res.enemies.filter((x) => x.deaths > 0)) {
    const floors = Object.entries(e.deathFloors).sort((a, b) => Number(a[0]) - Number(b[0])).map(([f, k]) => `f${f}:${k}`).join(' ');
    line(`    ${e.id.padEnd(22)} deaths=${String(e.deaths).padStart(4)} (${pct(e.deathShare, 0).padStart(4)} of deaths) avgTurns=${e.avgDeathTurns.toFixed(1).padStart(5)} fights=${String(e.n).padStart(5)} win=${pct(e.winRate, 0).padStart(4)} [ ${floors} ]`);
  }
  if (!res.enemies.some((x) => x.deaths > 0)) line('    (no deaths in this dataset)');

  /* ── per-item RCT tables ── */
  const table = (name, rows) => {
    line(`\n== ${name} (picked vs offered-not-picked; forward outcomes from the event floor) ==`);
    for (const r of rows) {
      const sig = Math.abs(r.dSurv) > 2 * r.seSurv ? '*' : ' ';
      line(`  ${sig} ${r.id.padEnd(22)} n=${String(r.n).padStart(5)} ΔSurv=${pp(r.dSurv).padStart(7)}±${(r.seSurv * 100).toFixed(1)} ΔFloors=${(r.dProg >= 0 ? '+' : '') + r.dProg.toFixed(2)} ΔNextWin=${r.dNext != null ? pp(r.dNext) : 'n/a'}`);
    }
  };
  table('relic power (run-context RCT)', res.relics);
  table('weave-tag power (run-context RCT)', res.weaveTags);

  /* ── per-character divergence ── */
  line('\n== relic power BY CHARACTER (only relics whose per-char ΔSurv spread > 10pp) ==');
  for (const row of res.relicByCharacter) {
    line(`    ${row.id.padEnd(22)} ` + Object.entries(row.per).map(([c, r]) => `${c}=${pp(r.d)}±${(r.se * 100).toFixed(0)}`).join('  '));
  }
  if (!res.relicByCharacter.length) line('    (none exceed the spread threshold at this sample size)');

  /* ── color-synergy conditional ── */
  line('\n== color-linked relics: ΔSurv WITH color in build (kit/wovens) vs WITHOUT ==');
  for (const r of res.colorSynergy) {
    line(`    ${r.id.padEnd(18)} (${r.color.padEnd(6)}) with=${r.withColor ? `${pp(r.withColor.d)}±${(r.withColor.se * 100).toFixed(0)} (n=${r.withColor.n})` : '   n/a'}  without=${r.without ? `${pp(r.without.d)}±${(r.without.se * 100).toFixed(0)} (n=${r.without.n})` : '   n/a'}`);
  }
  if (!res.colorSynergy.length) line('    (insufficient events per arm — raise --n)');

  /* ── exploratory pair interactions ── */
  line('\n== relic pair interactions (EXPLORATORY — reached-f6 cohort, survivorship-prone) ==');
  for (const r of res.pairs.slice(0, 12)) {
    line(`    ${(r.a + ' + ' + r.b).padEnd(42)} n=${String(r.n).padStart(4)} synergy=${pp(r.synergy)}`);
  }
  if (!res.pairs.length) line('    (not enough co-occurrence data — raise --n)');

  const outFile = file.replace(/\.jsonl$/, '-analysis.json');
  fs.writeFileSync(outFile, JSON.stringify({
    meta: res.meta, perChar: res.perChar, floorFights: res.floorFights, enemies: res.enemies,
    relics: res.relics, weaveTags: res.weaveTags,
    relicByCharacter: res.relicByCharacter, colorSynergy: res.colorSynergy,
    pairs: res.pairs.slice(0, 50),
  }, null, 2));
  line(`\nanalysis → ${path.relative(process.cwd(), outFile)}`);
}

/* ═══════════════════════════════════ main ══════════════════════════════════ */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { args[a.slice(2)] = next; i++; }
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'simulate';
  if (cmd === 'simulate') {
    const file = await cmdSimulate(args);
    if (args.analyze) await cmdAnalyze({ log: file, min: args.min });
  } else if (cmd === 'analyze') {
    await cmdAnalyze(args);
  } else {
    line(`unknown command "${cmd}" — use simulate | analyze`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
