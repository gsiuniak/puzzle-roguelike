/**
 * TileTypes — data-driven tile type definitions.
 *
 * Central source of truth for tile colors, spawn weights, damage config,
 * particle colors, and type-checking helpers.
 *
 * Extend this object to add new tile types (e.g., bomb tiles, wildcards).
 */

/**
 * @type {Object<string, { id: string, isSkull: boolean, isInert?: boolean, color: string, particleColor: string, spawnWeight: number }>}
 *
 * `isInert` tiles (Disease) are special: they never spawn naturally
 * (spawnWeight 0) and are only ever placed by effects. Matching/destroying
 * them does nothing except remove them — they award no mana and deal no
 * damage (see MatchResolver). They are neither a mana color nor a skull.
 */
export const TILE_TYPES = {
  RED:    { id: 'red',    isSkull: false, color: '#cc3333', particleColor: '#E74C3C', spawnWeight: 16 },
  BLUE:   { id: 'blue',   isSkull: false, color: '#3366cc', particleColor: '#3498DB', spawnWeight: 16 },
  GREEN:  { id: 'green',  isSkull: false, color: '#33aa33', particleColor: '#2ECC71', spawnWeight: 16 },
  YELLOW: { id: 'yellow', isSkull: false, color: '#cccc33', particleColor: '#F1C40F', spawnWeight: 16 },
  PURPLE: { id: 'purple', isSkull: false, color: '#9933cc', particleColor: '#9B59B6', spawnWeight: 16 },
  SKULL:  { id: 'skull',  isSkull: true,  color: '#555555', particleColor: '#2C3E50', spawnWeight: 20 },
  // Inert tile — never spawns (weight 0), placed only by effects (Infected Tooth).
  DISEASE: { id: 'disease', isSkull: false, isInert: true, color: '#7d8a3a', particleColor: '#a4c639', spawnWeight: 0 },
};

/** Quick array of mana color IDs (non-skull) */
export const MANA_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];

/** All tile type IDs including skull */
export const ALL_TILE_IDS = ['red', 'blue', 'green', 'yellow', 'purple', 'skull'];

/** Skull damage config */
export const SKULL_DAMAGE_CONFIG = {
  baseMultiplier: 1,
  maxDamage: 25,
};

/** Board dimensions */
export const BOARD_COLS = 8;
export const BOARD_ROWS = 8;

/**
 * Get tile type definition by ID string.
 * @param {string} typeId
 * @returns {Object}
 */
export function getTileType(typeId) {
  const key = typeId.toUpperCase();
  if (!TILE_TYPES[key]) throw new Error(`Unknown tile type: ${typeId}`);
  return TILE_TYPES[key];
}

/**
 * Check if a tile type is a skull.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isSkull(typeId) {
  return TILE_TYPES[typeId?.toUpperCase()]?.isSkull ?? false;
}

/**
 * Check if a tile type is inert (Disease) — neither mana nor skull.
 * Inert tiles award nothing when destroyed.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isInert(typeId) {
  return TILE_TYPES[typeId?.toUpperCase()]?.isInert ?? false;
}

/**
 * Check if a tile type is a mana color (not a skull, not inert).
 * @param {string} typeId
 * @returns {boolean}
 */
export function isMana(typeId) {
  return !isSkull(typeId) && !isInert(typeId);
}

/**
 * Get random tile type ID weighted by spawn weights + modifiers.
 * @param {Object<string, number>} weights - Effective weights per type ID
 * @returns {string}
 */
export function getRandomTileType(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return 'red'; // fallback

  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [id, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/**
 * Get default spawn weights (base weights, no modifiers).
 * @returns {Object<string, number>}
 */
export function getDefaultSpawnWeights() {
  const weights = {};
  for (const type of Object.values(TILE_TYPES)) {
    weights[type.id] = type.spawnWeight;
  }
  return weights;
}
