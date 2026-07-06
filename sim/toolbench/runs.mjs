#!/usr/bin/env node
/**
 * toolbench/runs.mjs — FULL-RUN self-play measurement (the "randomized trial"
 * layer on top of engine.simulateRun).
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
 * construction). Weave training nodes do the same per TAG (random pick per
 * draft round through the REAL synthesizer), so woven-skill power is measured
 * in context too.
 *
 * The player starts with ONLY the character's kit (per design); enemies always
 * use their authored kits. Runs are seeded (rng.mjs) → reproducible; every
 * line carries its seed so any death can be replayed.
 *
 * Usage (node, repo root):
 *   node sim/toolbench/runs.mjs simulate [--n 1000] [--chars a,b|all]
 *     [--policy greedy|value] [--weights <trained.json>] [--fightChance 0.75]
 *     [--weaveChance 0.35] [--out <file.jsonl>]
 *   node sim/toolbench/runs.mjs analyze [--log <runs-*.jsonl | newest>] [--min 25]
 *
 * Output: JSONL (one run per line, meta header first) in sim/toolbench/reports/.
 * The analyzer prints + writes: survival/death-floor health metrics, per-relic
 * and per-weave-tag RCT deltas (Δsurvival, Δprogress, Δnext-fight-win), and an
 * EXPLORATORY relic-pair interaction scan.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  simulateRun, CHARACTERS_BY_ID, SKILL_CATALOG, FLOOR_COUNT,
} from './engine.mjs';
import { makeValuePolicy, loadWeights } from './policy.mjs';
import { hashSeed, withSeededRandom } from './rng.mjs';
import { drawTagsForRound } from '../../src/js/data/skillWeaveTags.js';
import { rollRoundsPerWeave, rollTagsPerRound } from '../../src/js/data/weaveConfig.js';
import { synthesize } from '../../src/js/data/skillSynthesizer.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pp = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp`;

/* ═══════════════════════════════ simulate ══════════════════════════════════ */

/** The character's affinity colors = colors appearing in its kit skills' costs
 *  (mirrors what SkillWeaveScene passes to the synthesizer). */
function affinityColorsFor(characterId) {
  const def = CHARACTERS_BY_ID[characterId];
  const colors = new Set();
  for (const id of def.skills || []) {
    const skill = SKILL_CATALOG[id];
    for (const col of Object.keys((skill && skill.cost) || {})) colors.add(col);
  }
  return [...colors];
}

/** Random-of-offered weave draft through the REAL roll tables + synthesizer.
 *  Records one event per draft round: { floor, round, offered, picked }. */
function makeWeaveHook(characterId, weaveEvents) {
  const affinityColors = affinityColorsFor(characterId);
  return {
    makeSkill({ floor }) {
      const rounds = rollRoundsPerWeave();
      const recipe = [];
      const events = [];
      for (let r = 0; r < rounds; r++) {
        const options = drawTagsForRound({ roundIndex: r, chosen: recipe, count: rollTagsPerRound() });
        if (!options.length) break;
        const picked = options[Math.floor(Math.random() * options.length)];
        events.push({ floor, round: r, offered: options, picked });
        recipe.push(picked);
      }
      if (!recipe.length) return null;
      // synthesize() logs each woven skill — mute it for bulk runs
      const origLog = console.log;
      let synthesis;
      console.log = () => {};
      try { synthesis = synthesize(recipe, { affinityColors }); } finally { console.log = origLog; }
      if (!synthesis || !synthesis.skill) return null;
      weaveEvents.push(...events);
      return { skill: synthesis.skill, meta: { recipe, name: synthesis.skill.name } };
    },
  };
}

async function cmdSimulate(args) {
  const n = parseInt(args.n, 10) || 1000;
  const allChars = Object.keys(CHARACTERS_BY_ID);
  const chars = !args.chars || args.chars === 'all'
    ? allChars : String(args.chars).split(',').filter((c) => allChars.includes(c));
  const fightChance = args.fightChance != null ? Number(args.fightChance) : 0.75;
  const weaveChance = args.weaveChance != null ? Number(args.weaveChance) : 0.35;
  let policyTag = 'greedy', playerPolicy = null;
  if (args.policy === 'value' || args.weights) {
    let weights = {};
    if (args.weights) {
      weights = loadWeights(JSON.parse(fs.readFileSync(String(args.weights), 'utf8')));
      policyTag = `value:${path.basename(String(args.weights))}`;
    } else policyTag = 'value';
    playerPolicy = makeValuePolicy(weights);
  }
  const dir = path.join(DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = args.out ? String(args.out) : path.join(dir, `runs-${stamp}.jsonl`);
  const out = fs.createWriteStream(file);
  out.write(JSON.stringify({ type: 'meta', date: new Date().toISOString(), n, chars, policy: policyTag, fightChance, weaveChance }) + '\n');
  line(`simulate: ${n} runs × ${chars.join(',')} policy=${policyTag} fightChance=${fightChance} weaveChance=${weaveChance}`);
  const t0 = Date.now();
  let total = 0;
  for (const characterId of chars) {
    let survived = 0;
    for (let i = 0; i < n; i++) {
      const seed = hashSeed('gems-runs', characterId, i);
      const rewards = [];
      const weaveEvents = [];
      const run = withSeededRandom(seed, () => simulateRun({
        characterId,
        fightChance,
        relicPickPolicy: 'random',
        battleOpts: playerPolicy ? { playerPolicy } : {},
        onReward: (ev) => rewards.push(ev),
        weave: { chance: weaveChance, makeSkill: makeWeaveHook(characterId, weaveEvents).makeSkill },
      }));
      survived += run.survived ? 1 : 0;
      out.write(JSON.stringify({ seed, characterId, policy: policyTag, ...run, rewards, weaveEvents }) + '\n');
      total++;
      if (total % 250 === 0) line(`  ...${total} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    line(`  ${characterId.padEnd(13)} survival=${pct(survived / n)}`);
  }
  // the sync loop never yields, so the stream is still buffered — wait for
  // the actual flush before anyone (e.g. --analyze) reads the file
  await new Promise((resolve) => out.end(resolve));
  line(`log → ${path.relative(process.cwd(), file)} (${total} runs, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return file;
}

/* ═══════════════════════════════ analyze ═══════════════════════════════════ */

/** Two-sample binomial delta with SE. */
function rctDelta(pickN, pickWins, ctlN, ctlWins) {
  if (!pickN || !ctlN) return null;
  const p1 = pickWins / pickN, p0 = ctlWins / ctlN;
  const se = Math.sqrt((p1 * (1 - p1)) / pickN + (p0 * (1 - p0)) / ctlN);
  return { d: p1 - p0, se, p1, p0 };
}

function bucket() { return { pickN: 0, pickSurv: 0, pickProg: 0, pickNext: 0, pickNextN: 0, ctlN: 0, ctlSurv: 0, ctlProg: 0, ctlNext: 0, ctlNextN: 0 }; }

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

  let meta = null;
  const perChar = {}; // characterId → { runs, survived, victories, deaths: {floor: n} }
  const floorFights = {}; // floor|type → { n, wins }
  const relicStats = new Map(); // id → bucket
  const tagStats = new Map();   // tag → bucket
  const runsForPairs = [];      // { relics:Set, reachedF6, survived } for the exploratory pair scan

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    const rec = JSON.parse(raw);
    if (rec.type === 'meta') { meta = rec; continue; }
    const cs = (perChar[rec.characterId] = perChar[rec.characterId] || { runs: 0, survived: 0, victories: 0, deaths: {} });
    cs.runs++; cs.victories += rec.victories;
    if (rec.survived) cs.survived++;
    else cs.deaths[rec.deathFloor] = (cs.deaths[rec.deathFloor] || 0) + 1;
    const endFloor = rec.survived ? FLOOR_COUNT + 1 : rec.deathFloor;
    const fightsByFloor = [];
    for (const f of rec.floors) {
      if (f.type === 'skip' || f.type === 'training') continue;
      const key = `${f.floor}|${f.type}`;
      (floorFights[key] = floorFights[key] || { n: 0, wins: 0 }).n++;
      if (f.won) floorFights[key].wins++;
      fightsByFloor.push(f);
    }
    // forward outcomes for an event at floor `fl`: survival, floors progressed, next-fight result
    const forward = (fl) => {
      const next = fightsByFloor.find((f) => f.floor > fl);
      return { surv: rec.survived ? 1 : 0, prog: Math.max(0, endFloor - fl), next: next ? (next.won ? 1 : 0) : null };
    };
    for (const ev of rec.rewards || []) {
      const fw = forward(ev.floor);
      for (const id of ev.offered) {
        if (!relicStats.has(id)) relicStats.set(id, bucket());
        const b = relicStats.get(id);
        const picked = id === ev.picked;
        if (picked) {
          b.pickN++; b.pickSurv += fw.surv; b.pickProg += fw.prog;
          if (fw.next != null) { b.pickNext += fw.next; b.pickNextN++; }
        } else {
          b.ctlN++; b.ctlSurv += fw.surv; b.ctlProg += fw.prog;
          if (fw.next != null) { b.ctlNext += fw.next; b.ctlNextN++; }
        }
      }
    }
    for (const ev of rec.weaveEvents || []) {
      const fw = forward(ev.floor);
      for (const tag of ev.offered) {
        if (!tagStats.has(tag)) tagStats.set(tag, bucket());
        const b = tagStats.get(tag);
        if (tag === ev.picked) {
          b.pickN++; b.pickSurv += fw.surv; b.pickProg += fw.prog;
          if (fw.next != null) { b.pickNext += fw.next; b.pickNextN++; }
        } else {
          b.ctlN++; b.ctlSurv += fw.surv; b.ctlProg += fw.prog;
          if (fw.next != null) { b.ctlNext += fw.next; b.ctlNextN++; }
        }
      }
    }
    const reachedF6 = rec.survived || rec.deathFloor > 6;
    runsForPairs.push({ relics: rec.relics || [], reachedF6, survived: rec.survived ? 1 : 0 });
  }

  /* ── health metrics ── */
  line('\n== run health ==');
  for (const [charId, cs] of Object.entries(perChar)) {
    const hist = Object.entries(cs.deaths).sort((a, b) => a[0] - b[0])
      .map(([f, k]) => `f${f}:${(k / cs.runs * 100).toFixed(0)}%`).join(' ');
    line(`  ${charId.padEnd(13)} runs=${cs.runs} survival=${pct(cs.survived / cs.runs).padStart(6)} meanWins=${(cs.victories / cs.runs).toFixed(1)} deaths[ ${hist} ]`);
  }
  line('  per-floor fight win rates:');
  const floorKeys = Object.keys(floorFights).sort((a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]));
  line('    ' + floorKeys.map((k) => `${k.replace('|', ' ')}=${pct(floorFights[k].wins / floorFights[k].n, 0)}`).join('  '));

  /* ── per-item RCT tables ── */
  const table = (name, stats) => {
    line(`\n== ${name} (picked vs offered-not-picked; forward outcomes from the event floor) ==`);
    const rows = [];
    for (const [id, b] of stats.entries()) {
      if (b.pickN < minN || b.ctlN < minN) continue;
      const surv = rctDelta(b.pickN, b.pickSurv, b.ctlN, b.ctlSurv);
      const next = rctDelta(b.pickNextN, b.pickNext, b.ctlNextN, b.ctlNext);
      const dProg = b.pickProg / b.pickN - b.ctlProg / b.ctlN;
      rows.push({ id, n: b.pickN, dSurv: surv.d, seSurv: surv.se, survPick: surv.p1, dProg, dNext: next ? next.d : null });
    }
    rows.sort((a, b) => b.dSurv - a.dSurv);
    for (const r of rows) {
      const sig = Math.abs(r.dSurv) > 2 * r.seSurv ? '*' : ' ';
      line(`  ${sig} ${r.id.padEnd(22)} n=${String(r.n).padStart(5)} ΔSurv=${pp(r.dSurv).padStart(7)}±${(r.seSurv * 100).toFixed(1)} ΔFloors=${(r.dProg >= 0 ? '+' : '') + r.dProg.toFixed(2)} ΔNextWin=${r.dNext != null ? pp(r.dNext) : 'n/a'}`);
    }
    return rows;
  };
  const relicRows = table('relic power (run-context RCT)', relicStats);
  const tagRows = table('weave-tag power (run-context RCT)', tagStats);

  /* ── exploratory pair interactions (top relics, reached-floor-6 cohort) ── */
  line('\n== relic pair interactions (EXPLORATORY — reached-f6 cohort, survivorship-prone) ==');
  const cohort = runsForPairs.filter((r) => r.reachedF6);
  const base = cohort.length ? cohort.reduce((a, r) => a + r.survived, 0) / cohort.length : 0;
  const soloLift = new Map();
  const topIds = relicRows.slice(0, 20).map((r) => r.id);
  for (const id of topIds) {
    const withIt = cohort.filter((r) => r.relics.includes(id));
    if (withIt.length >= minN) soloLift.set(id, withIt.reduce((a, r) => a + r.survived, 0) / withIt.length - base);
  }
  const pairRows = [];
  for (let i = 0; i < topIds.length; i++) {
    for (let j = i + 1; j < topIds.length; j++) {
      const [a, b] = [topIds[i], topIds[j]];
      if (!soloLift.has(a) || !soloLift.has(b)) continue;
      const both = cohort.filter((r) => r.relics.includes(a) && r.relics.includes(b));
      if (both.length < minN) continue;
      const obs = both.reduce((s, r) => s + r.survived, 0) / both.length;
      const expected = base + soloLift.get(a) + soloLift.get(b);
      pairRows.push({ a, b, n: both.length, synergy: obs - expected });
    }
  }
  pairRows.sort((x, y) => Math.abs(y.synergy) - Math.abs(x.synergy));
  for (const r of pairRows.slice(0, 12)) {
    line(`    ${(r.a + ' + ' + r.b).padEnd(42)} n=${String(r.n).padStart(4)} synergy=${pp(r.synergy)}`);
  }
  if (!pairRows.length) line('    (not enough co-occurrence data — raise --n)');

  const outFile = file.replace(/\.jsonl$/, '-analysis.json');
  fs.writeFileSync(outFile, JSON.stringify({ meta, perChar, floorFights, relics: relicRows, weaveTags: tagRows, pairs: pairRows.slice(0, 50) }, null, 2));
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
