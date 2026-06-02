/**
 * data/enemies/index.js — central registry + spawn selection for enemies.
 *
 * Enemies are organized into per-act subfolders (act1/, act2/, act3/), each
 * with its own index that exports an array of that act's enemy definitions.
 * This top-level module aggregates them into:
 *   - ENEMIES_BY_ID — flat id → def lookup (getEnemyById)
 *   - query helpers  — getEnemiesByAct / getEnemiesByType / getEnemiesByRarity
 *   - spawn selection — selectEnemyForNode({ depth, nodeType }) used by MapScene
 *
 * Categorization vocabulary (fields on every enemy def):
 *   act    — 1 | 2 | 3
 *   rarity — 'common' | 'uncommon' | 'rare'
 *   type   — 'minion' | 'elite' | 'boss'
 *
 * Adding a new enemy:
 *   1. Create a file in the appropriate actN/ folder that `export default`s
 *      the enemy definition (with act/rarity/type/relics fields).
 *   2. Import + add it to that act's actN/index.js array.
 *   3. Register portrait/skill assets in main.js ASSET_MAP.
 *   4. Enemy relics are referenced by ID from the ENEMY-ONLY pool
 *      (data/relics/enemyRelicCatalog.js) and resolved via resolveEnemyRelicIds.
 */

import ACT1_ENEMIES, { goblin } from './act1/index.js';
import ACT2_ENEMIES from './act2/index.js';
import ACT3_ENEMIES from './act3/index.js';

/** Number of map depths (mirrors MapGenerator.DEPTH_COUNT). */
const DEPTH_COUNT = 10;
/** Number of acts the run is divided into. */
const ACT_COUNT = 3;

/** Enemies grouped by act number (1-indexed). */
export const ENEMIES_BY_ACT = {
  1: ACT1_ENEMIES,
  2: ACT2_ENEMIES,
  3: ACT3_ENEMIES,
};

/** Flat list of every enemy definition across all acts. */
export const ALL_ENEMIES = [...ACT1_ENEMIES, ...ACT2_ENEMIES, ...ACT3_ENEMIES];

/** Flat id → definition map. */
const ENEMIES_BY_ID = ALL_ENEMIES.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

/**
 * Relative likelihood weights per rarity for the weighted spawn pick. Higher
 * rarity → lower weight, so rare enemies appear less often when several
 * candidates share the same act + type pool.
 */
const RARITY_WEIGHT = {
  common: 100,
  uncommon: 40,
  rare: 15,
};

// ═══════════════════════════════════════════════════════════════════════════
// Lookup + query helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Look up an enemy definition by id.
 * Returns null (and warns) if no such enemy is registered.
 * @param {string} id
 * @returns {object|null}
 */
export function getEnemyById(id) {
  const def = ENEMIES_BY_ID[id];
  if (!def) {
    console.warn(`[enemies] Unknown enemy id: "${id}".`);
    return null;
  }
  return def;
}

/**
 * All enemies belonging to a given act (1-indexed).
 * @param {number} act
 * @returns {object[]}
 */
export function getEnemiesByAct(act) {
  return ENEMIES_BY_ACT[act] ? [...ENEMIES_BY_ACT[act]] : [];
}

/**
 * All enemies of a given type ('minion' | 'elite' | 'boss'), optionally
 * filtered to a single act.
 * @param {string} type
 * @param {number} [act] — optional act filter
 * @returns {object[]}
 */
export function getEnemiesByType(type, act = null) {
  return ALL_ENEMIES.filter((e) => e.type === type && (act == null || e.act === act));
}

/**
 * All enemies of a given rarity, optionally filtered to a single act.
 * @param {string} rarity
 * @param {number} [act] — optional act filter
 * @returns {object[]}
 */
export function getEnemiesByRarity(rarity, act = null) {
  return ALL_ENEMIES.filter((e) => e.rarity === rarity && (act == null || e.act === act));
}

// ═══════════════════════════════════════════════════════════════════════════
// Spawn selection (map → enemy)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map a map depth (0..DEPTH_COUNT-1) to an act number (1..ACT_COUNT) by
 * splitting the depths into ACT_COUNT contiguous bands. With the default
 * 10 depths / 3 acts this yields act 1 = depths 0–3, act 2 = 4–6, act 3 = 7–9.
 * @param {number} depth
 * @returns {number} act number, clamped to [1, ACT_COUNT]
 */
export function getActForDepth(depth) {
  const perAct = DEPTH_COUNT / ACT_COUNT;
  const act = Math.floor((depth || 0) / perAct) + 1;
  return Math.min(ACT_COUNT, Math.max(1, act));
}

/**
 * Map a map node type to the enemy type that should spawn there.
 * Non-combat nodes that get debug-routed to battle (rest/chest/training)
 * fall through to 'minion'.
 * @param {string} nodeType
 * @returns {string} enemy type
 */
export function enemyTypeForNodeType(nodeType) {
  switch (nodeType) {
    case 'boss':
      return 'boss';
    case 'elite':
      return 'elite';
    default:
      return 'minion';
  }
}

/**
 * Pick one enemy from a list, weighted by rarity. Falls back to a uniform
 * pick if no rarity weights are known.
 * @param {object[]} pool
 * @param {() => number} rng — returns a float in [0, 1)
 * @returns {object|null}
 */
function weightedPick(pool, rng) {
  if (!pool.length) return null;
  const weights = pool.map((e) => RARITY_WEIGHT[e.rarity] || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Choose the enemy definition to spawn for a given map node.
 *
 * Resolution order:
 *   1. enemies matching the node's act (from depth) AND its required type;
 *   2. fall back to any minion in that act;
 *   3. fall back to the goblin (always-present default).
 * The final choice within a non-empty pool is rarity-weighted.
 *
 * The returned object is a shared catalog reference — callers should clone it
 * (MapScene deep-clones before resolving skills/relics).
 *
 * @param {object} opts
 * @param {number} opts.depth — map node depth (0-indexed)
 * @param {string} opts.nodeType — map node type ('battle'|'elite'|'boss'|…)
 * @param {() => number} [opts.rng=Math.random] — injectable RNG for testing
 * @returns {object} enemy definition
 */
export function selectEnemyForNode({ depth = 0, nodeType = 'battle', rng = Math.random } = {}) {
  const act = getActForDepth(depth);
  const wantType = enemyTypeForNodeType(nodeType);

  let pool = ALL_ENEMIES.filter((e) => e.act === act && e.type === wantType);
  if (!pool.length) {
    // Fall back to any minion in this act so the encounter still spawns.
    pool = ALL_ENEMIES.filter((e) => e.act === act && e.type === 'minion');
  }

  return weightedPick(pool, rng) || goblin;
}

export { goblin };
export default ENEMIES_BY_ID;
