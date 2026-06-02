/**
 * data/enemies/index.js — central registry + spawn selection for enemies.
 *
 * Enemies are organized into per-act subfolders (act1/, … future act2/act3/),
 * each with its own index that exports an array of that act's enemy
 * definitions. Only Act 1 exists today. This top-level module aggregates them
 * into:
 *   - ENEMIES_BY_ID — flat id → def lookup (getEnemyById)
 *   - query helpers  — getEnemiesByAct / getEnemiesByType / getEnemiesByRarity / getEnemiesForFloor
 *   - spawn selection — selectEnemyForNode({ depth, nodeType }) used by MapScene
 *
 * Categorization vocabulary (fields on every enemy def):
 *   act    — 1 | 2 | 3   thematic grouping ONLY (does not affect spawning)
 *   rarity — 'common' | 'uncommon' | 'rare'
 *   type   — 'minion' | 'elite' | 'boss'
 *   floors — number[]    1-indexed map floors the enemy may spawn on (THE
 *                        authoritative placement control). Floor 1 = the first
 *                        encounter (depth 0); floor 10 = the boss (depth 9).
 *
 * Spawning is driven by `floors` + `type`, NOT by act. See selectEnemyForNode.
 *
 * Adding a new enemy:
 *   1. Create a file in the appropriate actN/ folder that `export default`s
 *      the enemy definition (with act/rarity/type/floors/relics fields).
 *   2. Import + add it to that act's actN/index.js array.
 *   3. Register portrait/skill assets in main.js ASSET_MAP.
 *   4. Enemy relics are referenced by ID from the ENEMY-ONLY pool
 *      (data/relics/enemyRelicCatalog.js) and resolved via resolveEnemyRelicIds.
 */

import ACT1_ENEMIES, { goblin } from './act1/index.js';

/** Number of map depths (mirrors MapGenerator.DEPTH_COUNT). Floors are 1..FLOOR_COUNT. */
const FLOOR_COUNT = 10;

/** Enemies grouped by act number (1-indexed). Act 2/3 are not yet implemented. */
export const ENEMIES_BY_ACT = {
  1: ACT1_ENEMIES,
};

/** Flat list of every enemy definition across all acts. */
export const ALL_ENEMIES = [...ACT1_ENEMIES];

/** Flat id → definition map. */
const ENEMIES_BY_ID = ALL_ENEMIES.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

/**
 * Relative likelihood weights per rarity for the weighted spawn pick. Higher
 * rarity → lower weight, so rare enemies appear less often when several
 * candidates share the same floor + type pool.
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
 * All enemies belonging to a given act (1-indexed). Act is metadata only.
 * @param {number} act
 * @returns {object[]}
 */
export function getEnemiesByAct(act) {
  return ENEMIES_BY_ACT[act] ? [...ENEMIES_BY_ACT[act]] : [];
}

/**
 * All enemies of a given type ('minion' | 'elite' | 'boss').
 * @param {string} type
 * @returns {object[]}
 */
export function getEnemiesByType(type) {
  return ALL_ENEMIES.filter((e) => e.type === type);
}

/**
 * All enemies of a given rarity.
 * @param {string} rarity
 * @returns {object[]}
 */
export function getEnemiesByRarity(rarity) {
  return ALL_ENEMIES.filter((e) => e.rarity === rarity);
}

/**
 * All enemies eligible to spawn on a given (1-indexed) floor, optionally
 * filtered by enemy type. Inspect what an enemy's `floors` array allows.
 * @param {number} floor — 1-indexed map floor
 * @param {string} [type] — optional enemy type filter
 * @returns {object[]}
 */
export function getEnemiesForFloor(floor, type = null) {
  return ALL_ENEMIES.filter(
    (e) => Array.isArray(e.floors) && e.floors.includes(floor) && (type == null || e.type === type)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Spawn selection (map → enemy)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a 0-indexed map depth to a 1-indexed floor number.
 * @param {number} depth
 * @returns {number}
 */
export function floorForDepth(depth) {
  return (depth || 0) + 1;
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
 * Placement is driven by each enemy's `floors` list (1-indexed) and `type`:
 *   1. enemies whose `floors` includes this node's floor AND whose `type`
 *      matches the node's required type;
 *   2. fall back to any minion eligible for this floor (covers debug-routed
 *      non-combat nodes / floors lacking the exact type);
 *   3. fall back to the goblin (always-present default).
 * The final choice within a non-empty pool is rarity-weighted.
 *
 * Pass either `depth` (0-indexed, as MapScene has it) or `floor` (1-indexed);
 * `floor` wins if both are given.
 *
 * The returned object is a shared catalog reference — callers should clone it
 * (MapScene deep-clones before resolving skills/relics).
 *
 * @param {object} opts
 * @param {number} [opts.depth] — map node depth (0-indexed)
 * @param {number} [opts.floor] — map floor (1-indexed); overrides depth
 * @param {string} opts.nodeType — map node type ('battle'|'elite'|'boss'|…)
 * @param {() => number} [opts.rng=Math.random] — injectable RNG for testing
 * @returns {object} enemy definition
 */
export function selectEnemyForNode({ depth = 0, floor = null, nodeType = 'battle', rng = Math.random } = {}) {
  const targetFloor = floor != null ? floor : floorForDepth(depth);
  const wantType = enemyTypeForNodeType(nodeType);

  let pool = getEnemiesForFloor(targetFloor, wantType);
  if (!pool.length) {
    // Fall back to any minion eligible for this floor so the encounter spawns.
    pool = getEnemiesForFloor(targetFloor, 'minion');
  }

  return weightedPick(pool, rng) || goblin;
}

export { goblin, FLOOR_COUNT };
export default ENEMIES_BY_ID;
