/**
 * Tile module.
 * Provides tile type lookup and tile position utilities.
 * Tile data is stored as simple string IDs in the Board.
 */

import { TILE_TYPES, TILE_TYPE_IDS } from './data/tileTypes.js';

/**
 * Get tile type object by ID.
 * @param {string} typeId
 * @returns {Object} Tile type definition.
 */
export function getTileType(typeId) {
  const type = TILE_TYPES[typeId.toUpperCase()];
  if (!type) throw new Error(`Unknown tile type: ${typeId}`);
  return type;
}

/**
 * Check if a tile type is a skull.
 * @param {string} typeId
 * @returns {boolean}
 */
export function isSkull(typeId) {
  return getTileType(typeId).isSkull;
}

/**
 * Check if a tile type is a mana color (not skull).
 * @param {string} typeId
 * @returns {boolean}
 */
export function isMana(typeId) {
  return !isSkull(typeId);
}

export { TILE_TYPES, TILE_TYPE_IDS };
