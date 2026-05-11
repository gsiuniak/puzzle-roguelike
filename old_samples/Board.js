/**
 * Board module.
 * Manages the 2D grid of tiles, swap operations, match detection,
 * gravity, refill, and board cloning for AI simulation.
 */

import { getRandomTileType, TILE_TYPE_IDS, SPAWN_WEIGHTS } from './data/tileTypes.js';

/**
 * Board dimensions (easy to resize/configure).
 */
export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;

/**
 * Board class - stores tile type IDs in a 2D grid.
 * Grid is accessed as grid[col][row], where col is x (0..WIDTH-1) and row is y (0..HEIGHT-1).
 */
export class Board {
  /**
   * @param {number} width - Board width in tiles.
   * @param {number} height - Board height in tiles.
   * @param {Object} spawnWeights - Weights for tile type selection.
   */
  constructor(width = BOARD_WIDTH, height = BOARD_HEIGHT, spawnWeights = { ...SPAWN_WEIGHTS }) {
    this.width = width;
    this.height = height;
    this.spawnWeights = spawnWeights;
    // 2D grid: grid[col][row] = tile type ID string or null (empty)
    this.grid = [];
    for (let x = 0; x < this.width; x++) {
      this.grid[x] = new Array(this.height).fill(null);
    }
    // Track spawn weight modifiers (applied on top of base weights)
    this.weightModifiers = {};
  }

  /**
   * Set spawn weight modifiers. Used by future passive abilities.
   * Modifiers are additive: positive increases weight, negative decreases.
   * Minimum weight per type is 0.
   * @param {Object.<string, number>} modifiers - { red: 5, skull: -3, ... }
   */
  setSpawnWeightModifiers(modifiers) {
    this.weightModifiers = { ...modifiers };
  }

  /**
   * Get effective spawn weights including modifiers.
   * @returns {Object.<string, number>}
   */
  getEffectiveWeights() {
    const weights = { ...this.spawnWeights };
    for (const [color, mod] of Object.entries(this.weightModifiers)) {
      weights[color] = Math.max(0, (weights[color] || 0) + mod);
    }
    return weights;
  }

  /**
   * Get tile at position.
   * @param {number} col
   * @param {number} row
   * @returns {string|null} Tile type ID or null if empty.
   */
  get(col, row) {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return this.grid[col][row];
  }

  /**
   * Set tile at position.
   * @param {number} col
   * @param {number} row
   * @param {string} typeId - Tile type ID.
   */
  set(col, row, typeId) {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return;
    this.grid[col][row] = typeId;
  }

  /**
   * Swap two tiles. Does NOT check for matches.
   * @param {number} col1
   * @param {number} row1
   * @param {number} col2
   * @param {number} row2
   */
  swap(col1, row1, col2, row2) {
    const temp = this.grid[col1][row1];
    this.grid[col1][row1] = this.grid[col2][row2];
    this.grid[col2][row2] = temp;
  }

  /**
   * Check if two positions are adjacent (horizontally or vertically).
   * @param {number} col1
   * @param {number} row1
   * @param {number} col2
   * @param {number} row2
   * @returns {boolean}
   */
  isAdjacent(col1, row1, col2, row2) {
    const dCol = Math.abs(col1 - col2);
    const dRow = Math.abs(row1 - row2);
    return (dCol === 1 && dRow === 0) || (dCol === 0 && dRow === 1);
  }

  /**
   * Initialize the board with random tiles, ensuring no pre-existing matches.
   */
  initialize() {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        this.grid[x][y] = null;
      }
    }
    this.weightModifiers = {};

    // Fill cell by cell, ensuring no match of 3+ is created
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        let typeId;
        let attempts = 0;
        do {
          typeId = getRandomTileType(this.getEffectiveWeights());
          attempts++;
          // If this creates a match of 3+, try again
        } while (this.wouldCreateMatch(x, y, typeId) && attempts < 50);
        // Fallback: if we can't avoid a match, just place it
        if (this.grid[x][y] === null) {
          typeId = getRandomTileType(this.getEffectiveWeights());
        }
        this.grid[x][y] = typeId;
      }
    }

    // Post-initialization cleanup: remove any remaining matches that slipped through
    this._removeAllInitialMatches();
  }

  /**
   * Check if placing a tile at (col, row) would create a match of 3+.
   * Only checks horizontal and vertical lines.
   * @param {number} col
   * @param {number} row
   * @param {string} typeId
   * @returns {boolean}
   */
  wouldCreateMatch(col, row, typeId) {
    // Check horizontal
    let hCount = 1;
    // Left
    for (let x = col - 1; x >= 0 && this.grid[x][row] === typeId; x--) hCount++;
    // Right
    for (let x = col + 1; x < this.width && this.grid[x][row] === typeId; x++) hCount++;
    if (hCount >= 3) return true;

    // Check vertical
    let vCount = 1;
    // Up
    for (let y = row - 1; y >= 0 && this.grid[col][y] === typeId; y--) vCount++;
    // Down
    for (let y = row + 1; y < this.height && this.grid[col][y] === typeId; y++) vCount++;
    if (vCount >= 3) return true;

    return false;
  }

  /**
   * Find all matches on the board.
   * Returns array of { typeId, positions: [{col, row}], count }.
   * @returns {Array<{typeId: string, positions: Array<{col:number, row:number}>, count: number}>}
   */
  findAllMatches() {
    const matched = new Set(); // "col,row" strings of matched tiles
    const matches = [];

    // Check horizontal runs
    for (let y = 0; y < this.height; y++) {
      let x = 0;
      while (x < this.width) {
        const tile = this.grid[x][y];
        if (!tile) { x++; continue; }
        let runEnd = x;
        while (runEnd + 1 < this.width && this.grid[runEnd + 1][y] === tile) {
          runEnd++;
        }
        const runLength = runEnd - x + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = x; i <= runEnd; i++) {
            matched.add(`${i},${y}`);
            positions.push({ col: i, row: y });
          }
          matches.push({ typeId: tile, positions, count: runLength });
        }
        x = runEnd + 1;
      }
    }

    // Check vertical runs
    for (let x = 0; x < this.width; x++) {
      let y = 0;
      while (y < this.height) {
        const tile = this.grid[x][y];
        if (!tile) { y++; continue; }
        let runEnd = y;
        while (runEnd + 1 < this.height && this.grid[x][runEnd + 1] === tile) {
          runEnd++;
        }
        const runLength = runEnd - y + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = y; i <= runEnd; i++) {
            const key = `${x},${i}`;
            if (!matched.has(key)) {
              matched.add(key);
              positions.push({ col: x, row: i });
            }
          }
          if (positions.length >= 3) {
            matches.push({ typeId: tile, positions, count: positions.length });
          }
        }
        y = runEnd + 1;
      }
    }

    return matches;
  }

  /**
   * Find all connected matches on the board.
   * Merges overlapping horizontal and vertical runs into connected shapes (L-shapes, T-shapes, crosses).
   * Two runs of the same tile type that share exactly one tile are merged into one connected shape.
   * The match size is the count of unique tiles in the connected shape.
   * @returns {Array<{typeId: string, positions: Array<{col:number, row:number}>, count: number, isShape: boolean}>}
   */
  findAllConnectedMatches() {
    // Step 1: Find all raw horizontal and vertical runs (3+ in a line)
    const rawRuns = [];

    // Horizontal runs
    for (let y = 0; y < this.height; y++) {
      let x = 0;
      while (x < this.width) {
        const tile = this.grid[x][y];
        if (!tile) { x++; continue; }
        let runEnd = x;
        while (runEnd + 1 < this.width && this.grid[runEnd + 1][y] === tile) {
          runEnd++;
        }
        const runLength = runEnd - x + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = x; i <= runEnd; i++) {
            positions.push({ col: i, row: y });
          }
          rawRuns.push({ typeId: tile, positions, isHorizontal: true });
        }
        x = runEnd + 1;
      }
    }

    // Vertical runs
    for (let x = 0; x < this.width; x++) {
      let y = 0;
      while (y < this.height) {
        const tile = this.grid[x][y];
        if (!tile) { y++; continue; }
        let runEnd = y;
        while (runEnd + 1 < this.height && this.grid[x][runEnd + 1] === tile) {
          runEnd++;
        }
        const runLength = runEnd - y + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = y; i <= runEnd; i++) {
            positions.push({ col: x, row: i });
          }
          rawRuns.push({ typeId: tile, positions, isHorizontal: false });
        }
        y = runEnd + 1;
      }
    }

    if (rawRuns.length === 0) return [];

    // Step 2: Group runs by tile type
    const runsByType = new Map();
    for (const run of rawRuns) {
      if (!runsByType.has(run.typeId)) {
        runsByType.set(run.typeId, []);
      }
      runsByType.get(run.typeId).push(run);
    }

    // Step 3: For each tile type, merge overlapping runs into connected shapes
    const allConnectedMatches = [];

    for (const [typeId, runs] of runsByType.entries()) {
      // Build adjacency: two runs are connected if they share exactly one tile
      const n = runs.length;
      const parent = Array.from({ length: n }, (_, i) => i);

      function find(i) {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
      }

      function union(a, b) {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootA] = rootB;
      }

      // Check if two runs share exactly one tile (intersection point)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const setA = new Set(runs[i].positions.map(p => `${p.col},${p.row}`));
          const setB = new Set(runs[j].positions.map(p => `${p.col},${p.row}`));
          let sharedCount = 0;
          for (const key of setA) {
            if (setB.has(key)) sharedCount++;
          }
          // Connected if they share exactly one tile (the intersection point)
          if (sharedCount === 1) {
            union(i, j);
          }
        }
      }

      // Group runs by their root
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(runs[i]);
      }

      // For each group, merge all positions into a unique set
      for (const [root, groupRuns] of groups.entries()) {
        const uniquePositions = new Set();
        for (const run of groupRuns) {
          for (const pos of run.positions) {
            uniquePositions.add(`${pos.col},${pos.row}`);
          }
        }

        const positions = Array.from(uniquePositions).map(key => {
          const [col, row] = key.split(',').map(Number);
          return { col, row };
        });

        const count = uniquePositions.size;
        const isShape = groupRuns.length > 1; // True if this is a merged shape (L, T, cross)

        allConnectedMatches.push({ typeId, positions, count, isShape });
      }
    }

    return allConnectedMatches;
  }

  /**
   * Remove tiles at the given positions.
   * @param {Array<{col: number, row: number}>} positions
   * @returns {number} Number of tiles removed.
   */
  removeTiles(positions) {
    let count = 0;
    for (const pos of positions) {
      if (this.get(pos.col, pos.row) !== null) {
        this.grid[pos.col][pos.row] = null;
        count++;
      }
    }
    return count;
  }

  /**
   * Apply gravity: tiles fall downward to fill empty cells.
   */
  applyGravity() {
    for (let x = 0; x < this.width; x++) {
      // For each column, compact non-null tiles to the bottom
      let writeRow = this.height - 1;
      for (let y = this.height - 1; y >= 0; y--) {
        const tile = this.grid[x][y];
        if (tile !== null) {
          this.grid[x][writeRow] = tile;
          if (writeRow !== y) {
            this.grid[x][y] = null;
          }
          writeRow--;
        }
      }
      // Fill remaining top cells with null
      for (let y = writeRow; y >= 0; y--) {
        this.grid[x][y] = null;
      }
    }
  }

  /**
   * Refill empty cells from the top with new random tiles.
   */
  refill() {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.grid[x][y] === null) {
          this.grid[x][y] = getRandomTileType(this.getEffectiveWeights());
        }
      }
    }
  }

  /**
   * Check if a cell is empty.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  isEmpty(col, row) {
    return this.grid[col][row] === null;
  }

  /**
   * Clone the board (deep copy of grid).
   * Used by AI for simulation.
   * @returns {Board}
   */
  clone() {
    const clone = new Board(this.width, this.height, this.spawnWeights);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        clone.grid[x][y] = this.grid[x][y];
      }
    }
    clone.weightModifiers = { ...this.weightModifiers };
    return clone;
  }

  /**
   * Get all valid adjacent swaps (swaps that could create matches).
   * Only checks right and down neighbors to avoid duplicates.
   * @returns {Array<{col1: number, row1: number, col2: number, row2: number}>}
   */
  getValidSwaps() {
    const swaps = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = this.grid[x][y];
        if (!tile) continue;
        // Check right neighbor
        if (x + 1 < this.width) {
          const right = this.grid[x + 1][y];
          if (right) {
            swaps.push({ col1: x, row1: y, col2: x + 1, row2: y });
          }
        }
        // Check down neighbor
        if (y + 1 < this.height) {
          const down = this.grid[x][y + 1];
          if (down) {
            swaps.push({ col1: x, row1: y, col2: x, row2: y + 1 });
          }
        }
      }
    }
    return swaps;
  }

  /**
   * Check if there are any valid moves (swaps that create matches).
   * @returns {boolean}
   */
  hasAnyValidMove() {
    const swaps = this.getValidSwaps();
    for (const swap of swaps) {
      this.swap(swap.col1, swap.row1, swap.col2, swap.row2);
      const matches = this.findAllMatches();
      this.swap(swap.col1, swap.row1, swap.col2, swap.row2);
      if (matches.length > 0) return true;
    }
    return false;
  }

  /**
   * Reshuffle the board: reinitialize with new random tiles.
   */
  reshuffle() {
    this.initialize();
  }

  /**
   * Remove all initial matches from the board (used after initialization).
   * Replaces matched tiles with new random tiles and repeats until no matches remain.
   * @private
   */
  _removeAllInitialMatches() {
    let maxIterations = 100; // Safety limit
    let iterations = 0;
    
    while (iterations < maxIterations) {
      iterations++;
      const matches = this.findAllMatches();
      if (matches.length === 0) break;

      // Collect all matched positions
      const positionsToRemove = new Set();
      for (const match of matches) {
        for (const pos of match.positions) {
          positionsToRemove.add(`${pos.col},${pos.row}`);
        }
      }

      // Remove matched tiles
      for (const key of positionsToRemove) {
        const [col, row] = key.split(',').map(Number);
        this.grid[col][row] = null;
      }

      // Fill empty cells, ensuring no new matches are created
      for (const key of positionsToRemove) {
        const [col, row] = key.split(',').map(Number);
        let typeId;
        let attempts = 0;
        do {
          typeId = getRandomTileType(this.getEffectiveWeights());
          attempts++;
        } while (this.wouldCreateMatch(col, row, typeId) && attempts < 50);
        this.grid[col][row] = typeId;
      }
    }
  }

  /**
   * Get the visual position of a tile for animation.
   * Tiles track their visual (interpolated) position separately from logical position.
   * @param {number} col - Logical column
   * @param {number} row - Logical row
   * @returns {{ x: number, y: number }} Visual position in tile coordinates
   */
  getVisualPosition(col, row) {
    // Default: visual position equals logical position
    return { x: col, y: row };
  }

  /**
   * Set animation data for a tile at logical position.
   * @param {number} col - Logical column
   * @param {number} row - Logical row
   * @param {number} startCol - Starting column (for animation)
   * @param {number} startRow - Starting row (for animation)
   * @param {number} endCol - Ending column (for animation)
   * @param {number} endRow - Ending row (for animation)
   */
  setTileAnimation(col, row, startCol, startRow, endCol, endRow) {
    if (!this.tileAnimations) {
      this.tileAnimations = {};
    }
    this.tileAnimations[`${col},${row}`] = {
      startCol, startRow, endCol, endRow
    };
  }

  /**
   * Get animation data for a tile.
   * @param {number} col
   * @param {number} row
   * @returns {{startCol: number, startRow: number, endCol: number, endRow: number}|null}
   */
  getTileAnimation(col, row) {
    if (!this.tileAnimations) return null;
    return this.tileAnimations[`${col},${row}`] || null;
  }

  /**
   * Clear all tile animations.
   */
  clearAnimations() {
    this.tileAnimations = {};
  }

  /**
    * Generate animation data for gravity fall.
    * Compares the grid before gravity (beforeGrid) with the current grid after gravity/refill.
    * Tracks which tiles moved downward and by how many cells.
    *
    * Key insight: after gravity+refill, the bottom N positions in each column contain
    * the old tiles (compacted), and the top (height - N) positions contain new tiles.
    * Old tiles preserve their relative order after compaction.
    *
    * @param {Array<Array<string|null>>} beforeGrid - The grid state before gravity was applied
    * @returns {Array<{col: number, row: number, startRow: number, startCol: number}>}
    */
   generateFallAnimations(beforeGrid) {
     const animations = [];
     
     for (let x = 0; x < this.width; x++) {
       // Count how many old tiles existed in this column before gravity
       const oldTileCount = beforeGrid[x].filter(t => t !== null).length;
       
       // Build list of old tiles from beforeGrid (preserving top-to-bottom order)
       const beforeOldTiles = [];
       for (let y = 0; y < this.height; y++) {
         if (beforeGrid[x][y] !== null) {
           beforeOldTiles.push({ row: y, typeId: beforeGrid[x][y] });
         }
       }
       
       // After gravity + refill:
       // - Old tiles are compacted to the bottom (rows height-oldTileCount to height-1)
       // - New tiles fill the top (rows 0 to height-oldTileCount-1)
       
       // Build list of old tiles from current grid (they're at the bottom now)
       const afterOldTiles = [];
       const oldStartRow = this.height - oldTileCount;
       for (let y = oldStartRow; y < this.height; y++) {
         if (this.grid[x][y] !== null) {
           afterOldTiles.push({ row: y, typeId: this.grid[x][y] });
         }
       }
       
       // Animate old tiles falling to their new positions
       for (let i = 0; i < beforeOldTiles.length; i++) {
         const beforeTile = beforeOldTiles[i];
         const afterTile = afterOldTiles[i];
         if (afterTile && beforeTile.row !== afterTile.row) {
           animations.push({
             col: x,
             row: afterTile.row,
             startRow: beforeTile.row,
             startCol: x
           });
         }
       }
       
       // Animate new tiles falling from above the board
       for (let y = 0; y < oldStartRow; y++) {
         animations.push({
           col: x,
           row: y,
           startRow: -1, // Indicates it came from above the board
           startCol: x
         });
       }
     }
     
     return animations;
   }

  /**
   * Get a flat representation of the board (for debugging).
   * @returns {Array<Array<string|null>>}
   */
  toJSON() {
    return this.grid.map(col => [...col]);
  }
}
