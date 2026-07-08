/**
 * toolbench/ui/store.mjs — shared config + custom content + AI specs.
 *
 * One mutable store for the whole bench: the player build, the enemy config,
 * the AI selection per side, and the Designer's custom content (REUSES the v1
 * toolbench localStorage key, so existing customs carry over). Views read
 * `store.cfg`, mutate through their forms, and call `store.emit()` — Bench
 * subscribes for auto-weigh.
 */

import {
  SKILL_CATALOG, RELIC_CATALOG, ENEMY_RELIC_CATALOG, CHARACTERS_BY_ID, ALL_ENEMIES,
} from '../engine.mjs';
import { FORMULA_WEIGHT_KEYS, CHAMPION_WEIGHTS_PATH, loadFormulaWeights } from '../formula.mjs';

/* ── custom content (same key as toolbench v1 — content carries over) ── */
const LS_CUSTOMS = 'gems-toolbench-customs-v1';
export const customs = (() => { try { return JSON.parse(localStorage.getItem(LS_CUSTOMS)) || {}; } catch { return {}; } })();
customs.enemies = customs.enemies || []; customs.skills = customs.skills || []; customs.relics = customs.relics || [];
export function saveCustoms() { localStorage.setItem(LS_CUSTOMS, JSON.stringify(customs)); }
export const allEnemyDefs = () => [...ALL_ENEMIES, ...customs.enemies];
export const findEnemyDef = (id) => allEnemyDefs().find((d) => d.id === id);
export const customSkillById = (id) => customs.skills.find((s) => s.id === id);
export const customRelicById = (id) => customs.relics.find((r) => r.id === id);

/* ── shared bench config (persisted) ── */
const LS_CFG = 'gems-bench-cfg-v1';
const DEFAULT_CFG = {
  player: {
    characterId: 'warrior', victories: 2,
    statDelta: { maxHp: 0, attack: 0, magic: 0, armor: 0 },
    relicIds: [], customSkillIds: [], customRelicIds: [],
    wovenSkillIdx: [],           // indexes into store.wovenSkills
  },
  enemy: { id: 'goblin', floor: 3, hpOverride: null, attackOverride: null },
  ai: { player: 'hard', enemy: 'builtin' },
  battles: 400,
  bothBrackets: true,
  autoWeigh: false,
};

function loadCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CFG));
    if (!saved) return structuredClone(DEFAULT_CFG);
    // merge shallowly per section so new fields get defaults
    const cfg = structuredClone(DEFAULT_CFG);
    for (const k of Object.keys(cfg)) {
      if (saved[k] == null) continue;
      cfg[k] = typeof cfg[k] === 'object' && !Array.isArray(cfg[k]) ? { ...cfg[k], ...saved[k] } : saved[k];
    }
    // auto-weigh is a per-SESSION opt-in — nothing runs until the user hits
    // Weigh (or ticks the box); a persisted "on" never carries over.
    cfg.autoWeigh = false;
    return cfg;
  } catch { return structuredClone(DEFAULT_CFG); }
}

/* ── AI (policy spec) registry ── */
export const AI_CHOICES = [
  { key: 'hard', label: 'Hard — champion formula', desc: 'trained deterministic policy (weights/formula-champion.json)' },
  { key: 'simple', label: 'Simple — shipped greedy', desc: 'the game\'s built-in AI (struggling-player bracket)' },
  { key: 'custom', label: 'Custom weights…', desc: 'paste/upload a weights JSON (formula or value keys, auto-detected)' },
  { key: 'value', label: 'Value-search (experimental)', desc: 'preview-search stack — measured ~2.5× weaker deployment; slow' },
];
export const ENEMY_AI_CHOICES = [
  { key: 'builtin', label: 'Built-in — as shipped', desc: 'the enemy\'s real AI (incl. custom behaviors like Malakor)' },
  ...AI_CHOICES,
];

export const champion = { weights: null, provenance: null, error: null };
export const custom = { weights: null, kind: null, name: null, warning: null };

export async function initChampion() {
  try {
    const res = await fetch(CHAMPION_WEIGHTS_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    champion.weights = loadFormulaWeights(json);
    const { weights: _w, ...meta } = json;
    champion.provenance = meta;
  } catch (err) {
    champion.error = String(err);
  }
}

/** Parse a user-supplied weights JSON: detect formula vs value keys. */
export function parseCustomWeights(json, name = 'custom') {
  const w = json && typeof json === 'object' ? (json.weights || json) : {};
  const keys = Object.keys(w).filter((k) => typeof w[k] === 'number');
  if (!keys.length) return { error: 'no numeric weight keys found' };
  const formulaHits = keys.filter((k) => FORMULA_WEIGHT_KEYS.includes(k)).length;
  const kind = formulaHits >= keys.length / 2 ? 'formula' : 'value';
  const unknown = kind === 'formula' ? keys.filter((k) => !FORMULA_WEIGHT_KEYS.includes(k)) : [];
  custom.weights = Object.fromEntries(keys.map((k) => [k, w[k]]));
  custom.kind = kind;
  custom.name = name;
  custom.warning = unknown.length ? `unknown formula keys ignored by the policy: ${unknown.join(', ')} (stale genome?)` : null;
  return { kind, warning: custom.warning };
}

/** AI choice key → serializable policy SPEC (null = greedy/builtin). */
export function specForChoice(key) {
  if (key === 'hard') return champion.weights ? { kind: 'formula', weights: champion.weights } : null;
  if (key === 'custom') return custom.weights ? { kind: custom.kind, weights: custom.weights } : null;
  if (key === 'value') return { kind: 'value', weights: {} };
  return null; // 'simple' | 'builtin'
}

/* ── woven skills (persisted — plain skill objects from the Weave tab) ── */
const LS_WOVEN = 'gems-bench-woven-v1';
function loadWoven() {
  try { return JSON.parse(localStorage.getItem(LS_WOVEN)) || []; } catch { return []; }
}

/* ── the store ── */
class Store {
  constructor() {
    this.cfg = loadCfg();
    this.wovenSkills = loadWoven(); // [{ skill, recipe }] — from the Weave tab
    // drop dangling loadout indexes (e.g. woven list edited elsewhere)
    this.cfg.player.wovenSkillIdx = (this.cfg.player.wovenSkillIdx || []).filter((i) => this.wovenSkills[i]);
    this._subs = new Set();
  }

  emit() {
    localStorage.setItem(LS_CFG, JSON.stringify(this.cfg));
    localStorage.setItem(LS_WOVEN, JSON.stringify(this.wovenSkills));
    for (const fn of this._subs) fn();
  }

  /** Remove a woven skill and re-point every stored loadout index. */
  removeWoven(idx) {
    this.wovenSkills.splice(idx, 1);
    const fix = (arr) => (arr || []).filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i));
    this.cfg.player.wovenSkillIdx = fix(this.cfg.player.wovenSkillIdx);
    this.emit();
  }

  onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }

  /** Serializable player payload for worker tasks, from a player-cfg section. */
  playerPayload(p = this.cfg.player) {
    return {
      characterId: p.characterId,
      victories: p.victories,
      statDelta: { ...p.statDelta },
      relicIds: [...(p.relicIds || [])],
      customSkills: [
        ...(p.customSkillIds || []).map(customSkillById).filter(Boolean),
        ...(p.wovenSkillIdx || []).map((i) => this.wovenSkills[i] && this.wovenSkills[i].skill).filter(Boolean),
      ],
      customRelics: (p.customRelicIds || []).map(customRelicById).filter(Boolean),
    };
  }

  /** Serializable enemy payload for worker tasks, from an enemy-cfg section. */
  enemyPayload(e = this.cfg.enemy) {
    const def = findEnemyDef(e.id) || ALL_ENEMIES[0];
    const overrides = {};
    if (e.hpOverride != null && e.hpOverride !== '') overrides.hp = Number(e.hpOverride);
    if (e.attackOverride != null && e.attackOverride !== '') overrides.attack = Number(e.attackOverride);
    // customs must travel as full defs (workers can't see localStorage)
    return def._custom
      ? { def, floor: e.floor, overrides }
      : { id: def.id, floor: e.floor, overrides };
  }

  aiSpec(side) { return specForChoice(this.cfg.ai[side]); }
  aiKey(side) { return this.cfg.ai[side]; }
}

export const store = new Store();
export { SKILL_CATALOG, RELIC_CATALOG, ENEMY_RELIC_CATALOG, CHARACTERS_BY_ID, ALL_ENEMIES };
