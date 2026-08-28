/**
 * TileTypes — data-driven tile type definitions.
 *
 * Central source of truth for tile colors, spawn weights, damage config,
 * particle colors, and type-checking helpers.
 *
 * Extend this object to add new tile types (e.g., bomb tiles, wildcards).
 */

/**
 * @type {Object<string, { id: string, isSkull: boolean, isInert?: boolean, isWild?: boolean, color: string, particleColor: string, spawnWeight: number }>}
 *
 * `isInert` tiles (Disease) are special: they never spawn naturally
 * (spawnWeight 0) and are only ever placed by effects. Matching/destroying
 * them does nothing except remove them — they award no mana and deal no
 * damage (see MatchResolver). They are neither a mana color nor a skull.
 *
 * `isWild` tiles (Thrall) are also effect-only (spawnWeight 0) but behave as a
 * "match anything" joker: in match detection a wild stands in for whatever
 * concrete neighbour it lines up with (Red + Thrall + Red = a Red match, Skull
 * + Thrall + Skull = a Skull match). Wild matching lives in BoardModel; a wild
 * that is destroyed WITHOUT a host (e.g. by a raw destroy effect) awards nothing
 * — it is neither a mana color nor a skull on its own.
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
  // Wild tiles — never spawn (weight 0), placed only by effects. Both match as
  // any adjacent concrete type (see BoardModel wild-aware detection); they
  // differ only in ART + provenance:
  //   WILD   — the STANDARD wild tile (player-woven "wild" skills etc.)
  //   THRALL — Lord Malakor's wild tile (Baron's Signet / Usurper's Heart)
  WILD:   { id: 'wild',   isSkull: false, isWild: true, color: '#c9a84c', particleColor: '#ffe28a', spawnWeight: 0 },
  THRALL: { id: 'thrall', isSkull: false, isWild: true, color: '#b0392f', particleColor: '#e2452f', spawnWeight: 0 },
  // SANGUINE_EGG — the Sanguine Phoenix's wild tile (its Sanguine Egg relic seeds
  // them on death). Like every wild it matches as any adjacent concrete type, so
  // the player WANTS to clear them: clearing all eggs within one turn wins, while
  // any egg left at the deadline destroys them and revives the boss.
  SANGUINE_EGG: { id: 'sanguine_egg', isSkull: false, isWild: true, color: '#a01a2a', particleColor: '#e23a4a', spawnWeight: 0 },
  // FUNGAL tiles (the Blight Warden's Blighted Growth) — effect-only (weight 0),
  // GREEN-AFFINE: in match detection they count as Green (matchable with Green
  // tiles or other Fungal tiles — see BoardModel._scanLineRuns; a match that
  // contains them resolves as a GREEN match, awarding green mana per tile).
  // The remaining turn timer is encoded in the TYPE ID (fungal_2 → fungal_1 →
  // explode) so it rides gravity/swap/clone for free; BattleController
  // ._tickFungalTiles ages them at each ENEMY turn start and EXPLODES expired
  // ones into a Skull + 2 fresh fungal_2 tiles. `isInert` keeps a raw
  // (non-match) destroy from awarding anything — the green-class matching above
  // bypasses inert semantics because 'fungal_*' is never its own scan class.
  FUNGAL_2: { id: 'fungal_2', isSkull: false, isInert: true, isFungal: true, fungalTimer: 2, color: '#5a8a3a', particleColor: '#7ec850', spawnWeight: 0 },
  FUNGAL_1: { id: 'fungal_1', isSkull: false, isInert: true, isFungal: true, fungalTimer: 1, color: '#5a8a3a', particleColor: '#7ec850', spawnWeight: 0 },
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
 * Lowercase-id lookup table for the hot predicates below. The predicates run
 * inside the board render loop (128+ calls/frame) and the sim's match scans —
 * the old `typeId?.toUpperCase()` allocated a string per call. Board type ids
 * are always lowercase; the uppercase path remains as a fallback for any
 * mixed-case caller.
 */
const TYPE_BY_ID = {};
for (const t of Object.values(TILE_TYPES)) TYPE_BY_ID[t.id] = t;

/** Resolve a type id to its definition without allocating on the hot path. */
function defOf(typeId) {
  if (typeId == null) return undefined;
  return TYPE_BY_ID[typeId] || TILE_TYPES[String(typeId).toUpperCase()];
}

/**
 * Check if a tile type is a skull.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isSkull(typeId) {
  return defOf(typeId)?.isSkull ?? false;
}

/**
 * Check if a tile type is inert (Disease) — neither mana nor skull.
 * Inert tiles award nothing when destroyed.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isInert(typeId) {
  return defOf(typeId)?.isInert ?? false;
}

/**
 * Check if a tile type is wild (Thrall) — matches as any concrete type.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isWild(typeId) {
  return defOf(typeId)?.isWild ?? false;
}

/**
 * Check if a tile type is a Fungal blight tile (fungal_2 / fungal_1) — the
 * Blight Warden's timed tiles. Green-affine for matching; see TILE_TYPES doc.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isFungal(typeId) {
  return defOf(typeId)?.isFungal ?? false;
}

/**
 * Remaining turn timer of a Fungal tile type (0 for non-fungal types).
 * @param {string} typeId
 * @returns {number}
 */
export function fungalTimer(typeId) {
  return defOf(typeId)?.fungalTimer ?? 0;
}

/**
 * Check if a tile type is a mana color (not a skull, not inert, not wild).
 * Fungal tiles are inert here (a raw destroy awards nothing) — their green
 * mana comes only through green-class MATCHES.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isMana(typeId) {
  const d = defOf(typeId);
  // Unknown ids historically read as mana (all three flags absent) — preserved.
  return d ? !(d.isSkull || d.isInert || d.isWild) : true;
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
 * Build a reusable weighted sampler over `weights`. Filters/sums ONCE; each
 * call then makes exactly one Math.random() roll (the same roll-per-tile
 * contract as getRandomTileType, so seeded sim batches stay comparable) and
 * walks the precomputed entries. BoardModel.refill uses this so a 30-tile
 * refill costs one table build instead of ~14 array allocations per tile.
 * @param {Object<string, number>} weights - Effective weights per type ID
 * @returns {() => string}
 */
export function makeWeightedSampler(weights) {
  const ids = [];
  const ws = [];
  let total = 0;
  for (const id in weights) {
    const w = weights[id];
    if (w > 0) {
      ids.push(id);
      ws.push(w);
      total += w;
    }
  }
  if (ids.length === 0) return () => 'red'; // same fallback as getRandomTileType
  return () => {
    let roll = Math.random() * total;
    for (let i = 0; i < ids.length; i++) {
      roll -= ws[i];
      if (roll <= 0) return ids[i];
    }
    return ids[ids.length - 1];
  };
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
