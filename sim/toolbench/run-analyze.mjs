/**
 * toolbench/run-analyze.mjs — PURE run-dataset analysis (BROWSER-SAFE).
 *
 * Extracted from runs.mjs (2026-07-08, Balance Bench v2 Phase 0): all the
 * RCT/health computations over an in-memory array of run records — no node:
 * imports, no printing. Consumers: runs.mjs `analyze` (JSONL → records →
 * here → console tables) and the browser bench's Runs tab (worker results →
 * here → DOM tables). One math, two frontends.
 *
 * Input records are the runOneRun() output shape (one per run), optionally
 * including a leading { type:'meta', ... } row (captured, skipped).
 */

import { CHARACTERS_BY_ID, SKILL_CATALOG, RELIC_CATALOG, FLOOR_COUNT } from './engine.mjs';
import { MANA_COLORS } from '../../src/js/game/TileTypes.js';

/** Two-sample binomial delta with SE. */
export function rctDelta(pickN, pickWins, ctlN, ctlWins) {
  if (!pickN || !ctlN) return null;
  const p1 = pickWins / pickN, p0 = ctlWins / ctlN;
  const se = Math.sqrt((p1 * (1 - p1)) / pickN + (p0 * (1 - p0)) / ctlN);
  return { d: p1 - p0, se, p1, p0 };
}

function bucket() { return { pickN: 0, pickSurv: 0, pickProg: 0, pickNext: 0, pickNextN: 0, ctlN: 0, ctlSurv: 0, ctlProg: 0, ctlNext: 0, ctlNextN: 0 }; }

function addToBucket(b, picked, fw) {
  if (picked) {
    b.pickN++; b.pickSurv += fw.surv; b.pickProg += fw.prog;
    if (fw.next != null) { b.pickNext += fw.next; b.pickNextN++; }
  } else {
    b.ctlN++; b.ctlSurv += fw.surv; b.ctlProg += fw.prog;
    if (fw.next != null) { b.ctlNext += fw.next; b.ctlNextN++; }
  }
}

/** The mana color a relic is mechanically tied to (spawn boost, mana gain,
 *  starting mana, attack-per-unspent, gain-mana reactor) — or null. */
export function relicColorOf(relic) {
  for (const ef of relic.effects || []) {
    const c = (ef.spawnRate && ef.spawnRate.tile)
      || (ef.manaGain && ef.manaGain.color)
      || (ef.startingMana && ef.startingMana.color)
      || (ef.attackPerMana && ef.attackPerMana.color)
      || (ef.gainMana && ef.gainMana.color)
      || (ef.condition && ef.condition.color);
    if (c && MANA_COLORS.includes(c)) return c;
  }
  return null;
}

const kitColorsCache = new Map();
export function kitColorsOf(characterId) {
  if (!kitColorsCache.has(characterId)) {
    const colors = new Set();
    for (const id of (CHARACTERS_BY_ID[characterId] || {}).skills || []) {
      const skill = SKILL_CATALOG[id];
      for (const col of Object.keys((skill && skill.cost) || {})) colors.add(col);
    }
    kitColorsCache.set(characterId, colors);
  }
  return kitColorsCache.get(characterId);
}

/**
 * Full analysis over run records. Returns the structured result (the same
 * object runs.mjs writes as *-analysis.json):
 * { meta, perChar, floorFights, enemies, relics, weaveTags, relicByCharacter,
 *   colorSynergy, pairs } — rows carry full (unrounded) values + SEs so any
 * frontend can format/round for display.
 */
export function analyzeRuns(records, { minN = 25 } = {}) {
  let meta = null;
  const perChar = {}; // characterId → { runs, survived, victories, deaths: {floor: n} }
  const floorFights = {}; // floor|type → { n, wins }
  const enemyStats = new Map(); // enemyId → { name, n, wins, turnsSum, deaths, deathTurnsSum, deathFloors: {floor: n} }
  const relicStats = new Map();     // id → bucket
  const relicCharStats = new Map(); // `id|characterId` → bucket
  const relicCondStats = new Map(); // `id|synergy` / `id|off` → bucket (color-linked relics)
  const tagStats = new Map();       // tag → bucket
  const runsForPairs = [];          // { relics, reachedF6, survived } for the exploratory pair scan
  const relicColor = new Map(Object.values(RELIC_CATALOG).map((r) => [r.id, relicColorOf(r)]));

  for (const rec of records) {
    if (!rec || rec.type === 'meta') { if (rec) meta = rec; continue; }
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
      const eid = f.enemyId || '?';
      let es = enemyStats.get(eid);
      if (!es) enemyStats.set(eid, es = { id: eid, name: f.enemyName || eid, n: 0, wins: 0, turnsSum: 0, deaths: 0, deathTurnsSum: 0, deathFloors: {} });
      es.n++; if (f.won) es.wins++; es.turnsSum += f.turns || 0;
    }
    // a dead run's LAST fight is the killer (the run stops on the first loss)
    const fatal = fightsByFloor[fightsByFloor.length - 1];
    if (!rec.survived && fatal && !fatal.won) {
      const es = enemyStats.get(fatal.enemyId || '?');
      es.deaths++; es.deathTurnsSum += fatal.turns || 0;
      es.deathFloors[fatal.floor] = (es.deathFloors[fatal.floor] || 0) + 1;
    }
    // forward outcomes for an event at floor `fl`: survival, floors progressed, next-fight result
    const forward = (fl) => {
      const next = fightsByFloor.find((f) => f.floor > fl);
      return { surv: rec.survived ? 1 : 0, prog: Math.max(0, endFloor - fl), next: next ? (next.won ? 1 : 0) : null };
    };
    // colors present in the player's BUILD before floor f: kit skill costs +
    // any weave recipe (color tags) acquired at an earlier training floor
    const kitColors = kitColorsOf(rec.characterId);
    const trainings = rec.floors.filter((f) => f.type === 'training' && f.weave && f.weave.recipe);
    const buildHasColor = (color, fl) => kitColors.has(color)
      || trainings.some((t) => t.floor < fl && t.weave.recipe.includes(color));
    const bucketOf = (map, key) => {
      if (!map.has(key)) map.set(key, bucket());
      return map.get(key);
    };
    for (const ev of rec.rewards || []) {
      const fw = forward(ev.floor);
      for (const id of ev.offered) {
        const picked = id === ev.picked;
        addToBucket(bucketOf(relicStats, id), picked, fw);
        addToBucket(bucketOf(relicCharStats, `${id}|${rec.characterId}`), picked, fw);
        const color = relicColor.get(id);
        if (color) {
          addToBucket(bucketOf(relicCondStats, `${id}|${buildHasColor(color, ev.floor) ? 'synergy' : 'off'}`), picked, fw);
        }
      }
    }
    for (const ev of rec.weaveEvents || []) {
      const fw = forward(ev.floor);
      for (const tag of ev.offered) {
        addToBucket(bucketOf(tagStats, tag), tag === ev.picked, fw);
      }
    }
    const reachedF6 = rec.survived || rec.deathFloor > 6;
    runsForPairs.push({ relics: rec.relics || [], reachedF6, survived: rec.survived ? 1 : 0 });
  }

  /* ── deaths by enemy (which fights end runs, where, and how fast) ── */
  const totalDeaths = [...enemyStats.values()].reduce((a, es) => a + es.deaths, 0);
  const enemyRows = [...enemyStats.values()].map((es) => ({
    id: es.id, name: es.name, n: es.n,
    winRate: es.n ? es.wins / es.n : 0,
    avgTurns: es.n ? es.turnsSum / es.n : 0,           // all fights vs this enemy
    deaths: es.deaths,
    deathShare: totalDeaths ? es.deaths / totalDeaths : 0,
    avgDeathTurns: es.deaths ? es.deathTurnsSum / es.deaths : null, // fatal fights only
    deathFloors: es.deathFloors,                        // {floor: count}
  })).sort((a, b) => b.deaths - a.deaths || a.winRate - b.winRate);

  /* ── per-item RCT rows ── */
  const tableRows = (stats) => {
    const rows = [];
    for (const [id, b] of stats.entries()) {
      if (b.pickN < minN || b.ctlN < minN) continue;
      const surv = rctDelta(b.pickN, b.pickSurv, b.ctlN, b.ctlSurv);
      const next = rctDelta(b.pickNextN, b.pickNext, b.ctlNextN, b.ctlNext);
      const dProg = b.pickProg / b.pickN - b.ctlProg / b.ctlN;
      rows.push({ id, n: b.pickN, dSurv: surv.d, seSurv: surv.se, survPick: surv.p1, dProg, dNext: next ? next.d : null });
    }
    rows.sort((a, b) => b.dSurv - a.dSurv);
    return rows;
  };
  const relicRows = tableRows(relicStats);
  const tagRows = tableRows(tagStats);

  /* ── per-character divergence (is a relic char-specific?) ── */
  const charRows = [];
  const charIds = Object.keys(perChar);
  for (const [id] of relicStats.entries()) {
    const per = {};
    for (const charId of charIds) {
      const b = relicCharStats.get(`${id}|${charId}`);
      if (!b || b.pickN < minN || b.ctlN < minN) continue;
      per[charId] = rctDelta(b.pickN, b.pickSurv, b.ctlN, b.ctlSurv);
    }
    const ds = Object.values(per).map((r) => r.d);
    if (ds.length >= 2 && Math.max(...ds) - Math.min(...ds) > 0.10) {
      charRows.push({ id, per });
    }
  }

  /* ── color-synergy conditional (the "flint question") ── */
  const condRows = [];
  for (const [id, color] of relicColor.entries()) {
    if (!color) continue;
    const syn = relicCondStats.get(`${id}|synergy`);
    const off = relicCondStats.get(`${id}|off`);
    const dSyn = syn && syn.pickN >= minN && syn.ctlN >= minN ? rctDelta(syn.pickN, syn.pickSurv, syn.ctlN, syn.ctlSurv) : null;
    const dOff = off && off.pickN >= minN && off.ctlN >= minN ? rctDelta(off.pickN, off.pickSurv, off.ctlN, off.ctlSurv) : null;
    if (!dSyn && !dOff) continue;
    condRows.push({
      id, color,
      withColor: dSyn ? { d: dSyn.d, se: dSyn.se, n: syn.pickN } : null,
      without: dOff ? { d: dOff.d, se: dOff.se, n: off.pickN } : null,
    });
  }

  /* ── exploratory pair interactions (top relics, reached-floor-6 cohort) ── */
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

  return {
    meta, perChar, floorFights, enemies: enemyRows,
    relics: relicRows, weaveTags: tagRows,
    relicByCharacter: charRows, colorSynergy: condRows,
    pairs: pairRows,
  };
}
