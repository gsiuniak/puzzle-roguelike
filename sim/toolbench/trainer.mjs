#!/usr/bin/env node
/**
 * toolbench/trainer.mjs — MEASURED ("revealed") power harness.
 *
 * Implements docs/balance-power-model.md §6's #1 authority — sim uplift — as an
 * automated, catalog-wide A/B sweep on the headless engine:
 *
 *   For every skill/relic: paired Monte-Carlo batches of full battles,
 *   baseline kit vs kit+item, across a reference gauntlet (floors × the spawn
 *   table's median enemy), under COMMON RANDOM NUMBERS (rng.mjs) so the paired
 *   win/loss differences isolate the item's effect.
 *
 * Reported per item:
 *   ΔWin   — paired win-rate uplift (± 95% CI from the paired differences)
 *   eqHP   — equivalent HP: ΔWin ÷ the locally measured (host,frame) HP slope,
 *            i.e. "this item is worth as much as +N maxHp" (a stable currency
 *            that doesn't saturate the way ΔWin does near 0%/100%)
 *   analytic — analytic.mjs V/mana + band alongside, with a RANK-DISAGREEMENT
 *            flag (UNDER-SCORED / OVER-SCORED) where measured and analytic
 *            orderings diverge — the "Arcane Inscription detector".
 *
 * Usage (node, repo root):
 *   node sim/toolbench/trainer.mjs skills [opts]     player-skill uplift sweep
 *   node sim/toolbench/trainer.mjs relics [opts]     player-relic uplift sweep
 *   node sim/toolbench/trainer.mjs stats  [opts]     stat exchange curves (+1 atk/mag/HP)
 *   node sim/toolbench/trainer.mjs all    [opts]     all three
 * Options:
 *   --n <int>          paired battles per (item, host, frame)   [default 240, quick 80]
 *   --quick            small fast pass (n=80, floors 2,6, hosts=owner)
 *   --floors 2,5,8     gauntlet floors (>=7 fights the elite frame)
 *   --hosts a,b        character ids, or "owner" (each skill on its kit owner,
 *                      off-kit skills on all characters)        [default: all]
 *   --skills a,b       filter to specific skill ids
 *   --relics a,b       filter to specific relic ids
 *   --out <path>       report JSON path [default sim/toolbench/reports/<cmd>-<stamp>.json]
 *
 * Notes:
 *   - Measured power is only as honest as the play policy. This harness uses
 *     the engine's greedy policy (now with convert-hold + best-convert-spot);
 *     a trained policy plugs into the same seam later (Battle opts.playerPolicy).
 *   - Baselines are cached per (host, kit, frame) and every arm shares the same
 *     seed stream, so all items are measured on the SAME boards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Battle, makePlayerCombatant, makeEnemyCombatant,
  SKILL_CATALOG, RELIC_CATALOG, CHARACTERS_BY_ID, ALL_ENEMIES,
  hpMultForFloor,
} from './engine.mjs';
import { skillSummary, relicDEVPerFight } from './analytic.mjs';
import { hashSeed, withSeededRandom } from './rng.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const line = (s) => process.stdout.write(s + '\n');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pp = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp`;
const HP_SLOPE_DELTA = 10;      // maxHp delta used to measure the local win/HP slope
const MIN_SLOPE = 0.0015;       // below 0.15pp/HP the frame is saturated — eqHP unreliable
const WINS_PER_FLOOR = 0.7;     // doc §6.1 reference progression

/* ═════════════════════════ frames (reference gauntlet) ═════════════════════ */

/** Median-HP eligible enemy for (floor, type) — the doc's "spawn table median". */
function refEnemyFor(floor, type) {
  let pool = ALL_ENEMIES.filter((d) => (d.floors || []).includes(floor) && d.type === type);
  if (!pool.length) pool = ALL_ENEMIES.filter((d) => (d.floors || []).includes(floor) && d.type !== 'boss');
  if (!pool.length) pool = ALL_ENEMIES.filter((d) => d.type === 'minion');
  const scored = pool
    .map((d) => ({ d, hp: ((d.hp != null ? d.hp : d.maxHp) || 1) * hpMultForFloor(floor) }))
    .sort((a, b) => a.hp - b.hp || a.d.id.localeCompare(b.d.id));
  return scored[Math.floor((scored.length - 1) / 2)].d;
}

function resolveFrames(floors) {
  return floors.map((floor) => {
    const type = floor >= 7 ? 'elite' : 'minion';
    const enemy = refEnemyFor(floor, type);
    return {
      floor, type,
      enemyId: enemy.id, enemyName: enemy.name,
      victories: Math.round((floor - 1) * WINS_PER_FLOOR),
    };
  });
}

/* ═══════════════════════ paired batches (common seeds) ═════════════════════ */

/** One arm: n battles on the frame's shared seed stream. */
function runArm(makePlayer, frame, n, battleOpts = {}) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const seed = hashSeed('gems-trainer', frame.floor, frame.enemyId, i);
    out[i] = withSeededRandom(seed, () =>
      new Battle(makePlayer(), makeEnemyCombatant(frame.enemyId, frame.floor), battleOpts).run());
  }
  return out;
}

/** Paired stats between two same-seed arms. */
function pairedStats(base, varr) {
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

/* Baseline arms are shared across every item on the same (host, kit, frame). */
const armCache = new Map();
function baselineArm(hostId, skillIds, frame, n, extraKey = '', makeOpts = {}) {
  const key = `${hostId}|${(skillIds || ['<kit>']).join(',')}|f${frame.floor}|${frame.enemyId}|n${n}|${extraKey}`;
  if (!armCache.has(key)) {
    armCache.set(key, runArm(
      () => makePlayerCombatant({ characterId: hostId, victories: frame.victories, skillIds, ...makeOpts }),
      frame, n));
  }
  return armCache.get(key);
}

/** win-fraction gained per +1 maxHp at (host, frame) — the eqHP denominator. */
const slopeCache = new Map();
function hpSlopeFor(hostId, frame, n) {
  const key = `${hostId}|f${frame.floor}|${frame.enemyId}|n${n}`;
  if (!slopeCache.has(key)) {
    const base = baselineArm(hostId, null, frame, n);
    const varr = runArm(
      () => makePlayerCombatant({ characterId: hostId, victories: frame.victories, statDelta: { maxHp: HP_SLOPE_DELTA } }),
      frame, n);
    const s = pairedStats(base, varr);
    slopeCache.set(key, { slope: s.dWin / HP_SLOPE_DELTA, winBase: s.winBase });
  }
  return slopeCache.get(key);
}

/** Combine per-frame ΔWin into an eqHP using frames whose slope is usable. */
function eqHpFrom(frameResults, slopes) {
  let dSum = 0, sSum = 0, used = 0;
  for (let i = 0; i < frameResults.length; i++) {
    if (slopes[i].slope >= MIN_SLOPE) { dSum += frameResults[i].dWin; sSum += slopes[i].slope; used++; }
  }
  if (!used) return null;
  return (dSum / used) / (sSum / used);
}

/* ═══════════════════════════════ skills sweep ══════════════════════════════ */

function skillOwner(skillId) {
  for (const def of Object.values(CHARACTERS_BY_ID)) {
    if ((def.skills || []).includes(skillId)) return def.id;
  }
  return null;
}

function hostStatsAt(hostId, frame) {
  const c = makePlayerCombatant({ characterId: hostId, victories: frame.victories });
  return { attack: c.attack, magic: c.magic };
}

function measureSkills(cfg) {
  const skills = Object.values(SKILL_CATALOG)
    .filter((s) => !cfg.skillFilter || cfg.skillFilter.includes(s.id));
  const items = [];
  for (const skill of skills) {
    const owner = skillOwner(skill.id);
    const hosts = cfg.hostsMode === 'owner' ? [owner || 'warrior']
      : (owner && !cfg.hosts.includes(owner) ? [...cfg.hosts, owner] : cfg.hosts);
    const costTotal = Object.values(skill.cost || {}).reduce((a, b) => a + b, 0);
    const perHost = {};
    for (const hostId of hosts) {
      const kit = (CHARACTERS_BY_ID[hostId].skills || []);
      const baseIds = kit.filter((id) => id !== skill.id);
      const varIds = [...baseIds, skill.id];
      const frameResults = [];
      const slopes = [];
      for (const frame of cfg.frames) {
        const base = baselineArm(hostId, baseIds.length === kit.length ? null : baseIds, frame, cfg.n);
        const varr = runArm(
          () => makePlayerCombatant({ characterId: hostId, victories: frame.victories, skillIds: varIds }),
          frame, cfg.n);
        const s = pairedStats(base, varr);
        frameResults.push({ floor: frame.floor, enemyId: frame.enemyId, ...s });
        slopes.push(hpSlopeFor(hostId, frame, cfg.n));
      }
      const dWinMean = frameResults.reduce((a, r) => a + r.dWin, 0) / frameResults.length;
      const ci95Mean = frameResults.reduce((a, r) => a + r.ci95, 0) / frameResults.length / Math.sqrt(frameResults.length);
      perHost[hostId] = {
        frames: frameResults, dWinMean, ci95Mean,
        eqHp: eqHpFrom(frameResults, slopes),
        castsPerFight: frameResults.reduce((a, r) => a + r.castsPerFight, 0) / frameResults.length,
        dCasts: frameResults.reduce((a, r) => a + r.dCasts, 0) / frameResults.length,
      };
    }
    const bestHost = Object.keys(perHost).sort((a, b) => perHost[b].dWinMean - perHost[a].dWinMean)[0];
    const best = perHost[bestHost];
    const midFrame = cfg.frames[Math.floor(cfg.frames.length / 2)];
    const analytic = skillSummary(skill, hostStatsAt(bestHost, midFrame));
    // if adding the skill never changed cast counts on ANY host, it never
    // fired (greedy always preferred an existing kit skill / couldn't fund it)
    const neverCast = Object.values(perHost).every((h) => Math.abs(h.dCasts) < 0.05);
    const item = {
      id: skill.id, name: skill.name, owner, costTotal, cost: skill.cost || {},
      perHost, bestHost,
      dWinBest: best.dWinMean, ci95Best: best.ci95Mean, eqHpBest: best.eqHp,
      eqHpPerMana: best.eqHp != null ? best.eqHp / Math.max(1, costTotal) : null,
      castsPerFight: best.castsPerFight, dCasts: best.dCasts, neverCast,
      analytic: { vpm: analytic.vpm, dev: analytic.dev, band: analytic.band },
    };
    items.push(item);
    line(`  ${skill.id.padEnd(24)} host=${String(bestHost).padEnd(13)} ΔWin=${pp(item.dWinBest).padStart(7)} ±${(item.ci95Best * 100).toFixed(1)} eqHP=${item.eqHpBest != null ? item.eqHpBest.toFixed(1).padStart(5) : '  n/a'} Δcasts=${item.dCasts >= 0 ? '+' : ''}${item.dCasts.toFixed(1)}${neverCast ? ' (NEVER CAST)' : ''} | analytic ${Number.isFinite(analytic.vpm) ? analytic.vpm.toFixed(1) : '∞'} (${analytic.band})`);
  }
  flagDisagreements(items,
    (i) => (i.dWinBest || 0) / Math.max(1, i.costTotal),
    (i) => (Number.isFinite(i.analytic.vpm) ? i.analytic.vpm : 99));
  return items;
}

/* ═══════════════════════════════ relics sweep ══════════════════════════════ */

function measureRelics(cfg) {
  const relics = Object.values(RELIC_CATALOG)
    .filter((r) => !cfg.relicFilter || cfg.relicFilter.includes(r.id));
  const items = [];
  for (const relic of relics) {
    const perHost = {};
    for (const hostId of (cfg.hostsMode === 'owner' ? ['warrior'] : cfg.hosts)) {
      if ((CHARACTERS_BY_ID[hostId].relics || []).includes(relic.id)) continue; // already a starter
      const frameResults = [];
      const slopes = [];
      for (const frame of cfg.frames) {
        const base = baselineArm(hostId, null, frame, cfg.n);
        const varr = runArm(
          () => makePlayerCombatant({ characterId: hostId, victories: frame.victories, relicIds: [relic.id] }),
          frame, cfg.n);
        const s = pairedStats(base, varr);
        frameResults.push({ floor: frame.floor, enemyId: frame.enemyId, ...s });
        slopes.push(hpSlopeFor(hostId, frame, cfg.n));
      }
      const dWinMean = frameResults.reduce((a, r) => a + r.dWin, 0) / frameResults.length;
      const ci95Mean = frameResults.reduce((a, r) => a + r.ci95, 0) / frameResults.length / Math.sqrt(frameResults.length);
      perHost[hostId] = { frames: frameResults, dWinMean, ci95Mean, eqHp: eqHpFrom(frameResults, slopes) };
    }
    if (!Object.keys(perHost).length) continue;
    const bestHost = Object.keys(perHost).sort((a, b) => perHost[b].dWinMean - perHost[a].dWinMean)[0];
    const best = perHost[bestHost];
    const midFrame = cfg.frames[Math.floor(cfg.frames.length / 2)];
    const analytic = relicDEVPerFight(relic, hostStatsAt(bestHost, midFrame));
    const item = {
      id: relic.id, name: relic.name, rarity: relic.rarity,
      perHost, bestHost,
      dWinBest: best.dWinMean, ci95Best: best.ci95Mean, eqHpBest: best.eqHp,
      analytic: { dev: analytic.dev, notes: analytic.notes },
    };
    items.push(item);
    line(`  ${relic.id.padEnd(24)} ${String(relic.rarity).padEnd(9)} host=${String(bestHost).padEnd(13)} ΔWin=${pp(item.dWinBest).padStart(7)} ±${(item.ci95Best * 100).toFixed(1)} eqHP=${item.eqHpBest != null ? item.eqHpBest.toFixed(1).padStart(5) : '  n/a'} | analytic DEV=${analytic.dev.toFixed(1)}`);
  }
  flagDisagreements(items, (i) => i.dWinBest || 0, (i) => i.analytic.dev);
  return items;
}

/* ═══════════════════════════════ stat curves ═══════════════════════════════ */

function measureStats(cfg) {
  const sweeps = { attack: [1, 2, 4], magic: [1, 2, 4], maxHp: [4, 8, 16] };
  const items = [];
  for (const hostId of cfg.hosts) {
    for (const frame of cfg.frames) {
      const base = baselineArm(hostId, null, frame, cfg.n);
      for (const [stat, deltas] of Object.entries(sweeps)) {
        const points = [];
        for (const delta of deltas) {
          const varr = runArm(
            () => makePlayerCombatant({ characterId: hostId, victories: frame.victories, statDelta: { [stat]: delta } }),
            frame, cfg.n);
          const s = pairedStats(base, varr);
          points.push({ delta, dWin: s.dWin, ci95: s.ci95, perPoint: s.dWin / delta });
        }
        items.push({ hostId, floor: frame.floor, enemyId: frame.enemyId, stat, winBase: pairedStats(base, base).winBase, points });
        line(`  ${hostId.padEnd(13)} f${String(frame.floor).padEnd(2)} +${stat.padEnd(6)} ` +
          points.map((p) => `+${p.delta}:${pp(p.dWin)}`).join('  '));
      }
    }
  }
  // exchange summary: +1 attack ≈ N maxHp (using the smallest deltas)
  for (const hostId of cfg.hosts) {
    for (const frame of cfg.frames) {
      const at = items.find((i) => i.hostId === hostId && i.floor === frame.floor && i.stat === 'attack');
      const hp = items.find((i) => i.hostId === hostId && i.floor === frame.floor && i.stat === 'maxHp');
      if (at && hp && hp.points[0].perPoint > 0) {
        line(`  exchange ${hostId} f${frame.floor}: +1 attack ≈ ${(at.points[0].perPoint / hp.points[0].perPoint).toFixed(1)} maxHp`);
      }
    }
  }
  return items;
}

/* ═════════════════════════ disagreement flags + report ═════════════════════ */

/** Rank items by measured vs analytic value; flag big rank divergences. */
function flagDisagreements(items, measuredOf, analyticOf) {
  if (items.length < 4) return;
  const rank = (arr, of) => {
    const sorted = [...arr].sort((a, b) => of(a) - of(b));
    const m = new Map(sorted.map((it, i) => [it.id, i / (sorted.length - 1)]));
    return (it) => m.get(it.id);
  };
  const rM = rank(items, measuredOf);
  const rA = rank(items, analyticOf);
  for (const it of items) {
    const d = rM(it) - rA(it);
    // never-cast skills measured 0 because they never FIRED — that's
    // "unmeasured under this policy", not "weak"; don't flag them
    const significant = !it.neverCast && Math.abs(it.dWinBest || 0) > (it.ci95Best || 0);
    it.rankGap = +d.toFixed(2);
    it.flag = significant && d > 0.35 ? 'UNDER-SCORED' : (significant && d < -0.35 ? 'OVER-SCORED' : null);
  }
  const flagged = items.filter((i) => i.flag);
  if (flagged.length) {
    line('\n  rank disagreements (measured vs analytic):');
    for (const it of flagged.sort((a, b) => Math.abs(b.rankGap) - Math.abs(a.rankGap))) {
      line(`    ${it.flag.padEnd(13)} ${it.id.padEnd(24)} measured ΔWin=${pp(it.dWinBest)} eqHP=${it.eqHpBest != null ? it.eqHpBest.toFixed(1) : 'n/a'} (rank gap ${it.rankGap})`);
    }
  }
}

function writeReport(kind, cfg, items, outPath) {
  const dir = path.join(DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = outPath || path.join(dir, `${kind}-${stamp}.json`);
  const payload = {
    kind,
    date: new Date().toISOString(),
    config: {
      n: cfg.n,
      frames: cfg.frames,
      hosts: cfg.hostsMode === 'owner' ? 'owner' : cfg.hosts,
      policy: 'greedy (engine default)',
    },
    hpSlopes: Object.fromEntries([...slopeCache.entries()].map(([k, v]) => [k, v])),
    items,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  line(`\nreport → ${path.relative(process.cwd(), file)}`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'skills';
  const quick = !!args.quick;
  const floors = String(args.floors || (quick ? '2,6' : '2,5,8')).split(',').map(Number).filter((f) => f >= 1 && f <= 10);
  const allHosts = Object.keys(CHARACTERS_BY_ID);
  const hostsMode = args.hosts === 'owner' || (quick && !args.hosts) ? 'owner' : 'list';
  const hosts = hostsMode === 'owner' ? allHosts
    : (args.hosts ? String(args.hosts).split(',').filter((h) => allHosts.includes(h)) : allHosts);
  const cfg = {
    n: parseInt(args.n, 10) || (quick ? 80 : 240),
    frames: resolveFrames(floors),
    hosts, hostsMode,
    skillFilter: args.skills ? String(args.skills).split(',') : null,
    relicFilter: args.relics ? String(args.relics).split(',') : null,
  };
  line(`trainer: cmd=${cmd} n=${cfg.n} frames=${cfg.frames.map((f) => `f${f.floor}:${f.enemyId}`).join(' ')} hosts=${hostsMode === 'owner' ? 'owner' : hosts.join(',')}`);
  const t0 = Date.now();
  const run = (kind, fn) => {
    line(`\n== ${kind} ==`);
    const items = fn(cfg);
    writeReport(kind, cfg, items, args.out && cmd !== 'all' ? String(args.out) : null);
  };
  if (cmd === 'skills' || cmd === 'all') run('skills', measureSkills);
  if (cmd === 'relics' || cmd === 'all') run('relics', measureRelics);
  if (cmd === 'stats' || cmd === 'all') run('stats', measureStats);
  if (!['skills', 'relics', 'stats', 'all'].includes(cmd)) {
    line(`unknown command "${cmd}" — use skills | relics | stats | all`);
    process.exitCode = 1;
    return;
  }
  line(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// run only as a CLI (stays importable for future tooling/tests)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
