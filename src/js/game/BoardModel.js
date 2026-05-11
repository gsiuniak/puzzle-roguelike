/**
 * BoardModel — pure data/logic module for the match-3 grid.
 *
 * No rendering, no DOM, no canvas. Provides:
 *   - 8×8 grid storage (grid[col][row] = typeId string)
 *   - random initialization with no-match guarantee
 *   - adjacent swap
 *   - match detection (simple runs + Union-Find connected shape merging)
 *   - gravity (tiles fall downward)
 *   - refill (new tiles from top)
 *   - spawn weight modifiers (for future passives)
 *   - board cloning (for AI simulation)
 *   - fall animation data generation
 */

import { getRandomTileType, getDefaultSpawnWeights, isSkull, BOARD_COLS, BOARD_ROWS } from './TileTypes.js';

export default class BoardModel {
  /**
   * @param {number} [cols=8]
   * @param {number} [rows=8]
   */
  constructor(cols = BOARD_COLS, rows = BOARD_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.spawnWeights = getDefaultSpawnWeights();

    /** @type {Object<string, number>} additive weight modifiers */
    this.weightModifiers = {};

    /** @type {Array<Array<string|null>>} grid[col][row] = typeId or null */
    this.grid = [];
    for (let x = 0; x < this.cols; x++) {
      this.grid[x] = new Array(this.rows).fill(null);
    }
  }

  // ── Spawn Weights ────────────────────────────────────

  setSpawnWeightModifiers(modifiers) {
    this.weightModifiers = { ...modifiers };
  }

  getEffectiveWeights() {
    const weights = { ...this.spawnWeights };
    for (const [color, mod] of Object.entries(this.weightModifiers)) {
      weights[color] = Math.max(0, (weights[color] || 0) + mod);
    }
    return weights;
  }

  // ── Grid Access ──────────────────────────────────────

  /** @param {number} col @param {number} row @returns {string|null} */
  get(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.grid[col][row];
  }

  /** @param {number} col @param {number} row @param {string} typeId */
  set(col, row, typeId) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    this.grid[col][row] = typeId;
  }

  isEmpty(col, row) {
    return this.grid[col][row] === null;
  }

  // ── Swap ─────────────────────────────────────────────

  /**
   * Swap two tiles. Does NOT check adjacency or match validity.
   * @param {number} col1 @param {number} row1
   * @param {number} col2 @param {number} row2
   */
  swap(col1, row1, col2, row2) {
    const temp = this.grid[col1][row1];
    this.grid[col1][row1] = this.grid[col2][row2];
    this.grid[col2][row2] = temp;
  }

  isAdjacent(col1, row1, col2, row2) {
    const dCol = Math.abs(col1 - col2);
    const dRow = Math.abs(row1 - row2);
    return (dCol === 1 && dRow === 0) || (dCol === 0 && dRow === 1);
  }

  // ── Initialization ───────────────────────────────────

  /** Fill board with random tiles, guaranteeing no pre-existing matches. */
  initialize() {
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        this.grid[x][y] = null;
      }
    }
    this.weightModifiers = {};

    const weights = this.getEffectiveWeights();

    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        let typeId;
        let attempts = 0;
        do {
          typeId = getRandomTileType(weights);
          attempts++;
        } while (this.wouldCreateMatch(x, y, typeId) && attempts < 50);
        this.grid[x][y] = typeId;
      }
    }

    this._removeAllInitialMatches();
  }

  /**
   * Check if placing typeId at (col, row) would create a horizontal or vertical match of 3+.
   */
  wouldCreateMatch(col, row, typeId) {
    // Horizontal
    let hCount = 1;
    for (let x = col - 1; x >= 0 && this.grid[x][row] === typeId; x--) hCount++;
    for (let x = col + 1; x < this.cols && this.grid[x][row] === typeId; x++) hCount++;
    if (hCount >= 3) return true;

    // Vertical
    let vCount = 1;
    for (let y = row - 1; y >= 0 && this.grid[col][y] === typeId; y--) vCount++;
    for (let y = row + 1; y < this.rows && this.grid[col][y] === typeId; y++) vCount++;
    if (vCount >= 3) return true;

    return false;
  }

  /** @private Remove any remaining matches after initialization. */
  _removeAllInitialMatches() {
    const maxIterations = 100;
    for (let iter = 0; iter < maxIterations; iter++) {
      const matches = this.findAllMatches();
      if (matches.length === 0) break;

      const positionsToRemove = new Set();
      for (const match of matches) {
        for (const pos of match.positions) {
          positionsToRemove.add(`${pos.col},${pos.row}`);
        }
      }

      for (const key of positionsToRemove) {
        const [col, row] = key.split(',').map(Number);
        this.grid[col][row] = null;
      }

      const weights = this.getEffectiveWeights();
      for (const key of positionsToRemove) {
        const [col, row] = key.split(',').map(Number);
        let typeId;
        let attempts = 0;
        do {
          typeId = getRandomTileType(weights);
          attempts++;
        } while (this.wouldCreateMatch(col, row, typeId) && attempts < 50);
        this.grid[col][row] = typeId;
      }
    }
  }

  // ── Match Detection ──────────────────────────────────

  /**
   * Find all simple horizontal and vertical matches (3+ in a line).
   * Each run is a separate match.
   * @returns {Array<{typeId: string, positions: Array<{col:number, row:number}>, count: number}>}
   */
  findAllMatches() {
    const matched = new Set();
    const matches = [];

    // Horizontal
    for (let y = 0; y < this.rows; y++) {
      let x = 0;
      while (x < this.cols) {
        const tile = this.grid[x][y];
        if (!tile) { x++; continue; }
        let runEnd = x;
        while (runEnd + 1 < this.cols && this.grid[runEnd + 1][y] === tile) runEnd++;
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

    // Vertical
    for (let x = 0; x < this.cols; x++) {
      let y = 0;
      while (y < this.rows) {
        const tile = this.grid[x][y];
        if (!tile) { y++; continue; }
        let runEnd = y;
        while (runEnd + 1 < this.rows && this.grid[x][runEnd + 1] === tile) runEnd++;
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
   * Find all connected matches with Union-Find shape merging.
   *
   * Merges overlapping horizontal/vertical runs of the same type
   * that share exactly one tile into L-shapes, T-shapes, crosses, etc.
   * The match count is the number of unique tiles in the merged shape.
   *
   * @returns {Array<{typeId: string, positions: Array<{col:number, row:number}>, count: number, isShape: boolean}>}
   */
  findAllConnectedMatches() {
    // Step 1: Find all raw horizontal and vertical runs
    const rawRuns = [];

    // Horizontal
    for (let y = 0; y < this.rows; y++) {
      let x = 0;
      while (x < this.cols) {
        const tile = this.grid[x][y];
        if (!tile) { x++; continue; }
        let runEnd = x;
        while (runEnd + 1 < this.cols && this.grid[runEnd + 1][y] === tile) runEnd++;
        const runLength = runEnd - x + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = x; i <= runEnd; i++) positions.push({ col: i, row: y });
          rawRuns.push({ typeId: tile, positions, isHorizontal: true });
        }
        x = runEnd + 1;
      }
    }

    // Vertical
    for (let x = 0; x < this.cols; x++) {
      let y = 0;
      while (y < this.rows) {
        const tile = this.grid[x][y];
        if (!tile) { y++; continue; }
        let runEnd = y;
        while (runEnd + 1 < this.rows && this.grid[x][runEnd + 1] === tile) runEnd++;
        const runLength = runEnd - y + 1;
        if (runLength >= 3) {
          const positions = [];
          for (let i = y; i <= runEnd; i++) positions.push({ col: x, row: i });
          rawRuns.push({ typeId: tile, positions, isHorizontal: false });
        }
        y = runEnd + 1;
      }
    }

    if (rawRuns.length === 0) return [];

    // Step 2: Group runs by tile type
    const runsByType = new Map();
    for (const run of rawRuns) {
      if (!runsByType.has(run.typeId)) runsByType.set(run.typeId, []);
      runsByType.get(run.typeId).push(run);
    }

    // Step 3: Union-Find merge overlapping runs (share exactly 1 tile)
    const allConnectedMatches = [];

    for (const [typeId, runs] of runsByType.entries()) {
      const n = runs.length;
      const parent = Array.from({ length: n }, (_, i) => i);

      function find(i) {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
      }
      function union(a, b) {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      }

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const setA = new Set(runs[i].positions.map(p => `${p.col},${p.row}`));
          const setB = new Set(runs[j].positions.map(p => `${p.col},${p.row}`));
          let sharedCount = 0;
          for (const key of setA) {
            if (setB.has(key)) sharedCount++;
          }
          if (sharedCount === 1) union(i, j);
        }
      }

      // Group runs by root
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(runs[i]);
      }

      // Build merged matches
      for (const [, groupRuns] of groups.entries()) {
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
        const isShape = groupRuns.length > 1;

        allConnectedMatches.push({ typeId, positions, count, isShape });
      }
    }

    return allConnectedMatches;
  }

  // ── Tile Removal ─────────────────────────────────────

  /**
   * Remove tiles at the given positions (set to null).
   * @param {Array<{col: number, row: number}>} positions
   * @returns {number} count removed
   */
  removeTiles(positions) {
    let count = 0;
    for (const pos of positions) {
      if (!this.isEmpty(pos.col, pos.row)) {
        this.grid[pos.col][pos.row] = null;
        count++;
      }
    }
    return count;
  }

  // ── Gravity ──────────────────────────────────────────

  /**
   * Apply gravity: tiles fall downward to fill empty cells.
   * Compact non-null tiles to the bottom of each column.
   */
  applyGravity() {
    for (let x = 0; x < this.cols; x++) {
      let writeRow = this.rows - 1;
      for (let y = this.rows - 1; y >= 0; y--) {
        const tile = this.grid[x][y];
        if (tile !== null) {
          this.grid[x][writeRow] = tile;
          if (writeRow !== y) this.grid[x][y] = null;
          writeRow--;
        }
      }
    }
  }

  // ── Refill ───────────────────────────────────────────

  /** Fill all empty cells with random tiles using current spawn weights. */
  refill() {
    const weights = this.getEffectiveWeights();
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (this.grid[x][y] === null) {
          this.grid[x][y] = getRandomTileType(weights);
        }
      }
    }
  }

  // ── Fall Animation Data ──────────────────────────────

  /**
   * Generate animation data for gravity fall by comparing before/after grid.
   * @param {Array<Array<string|null>>} beforeGrid - grid state before gravity
   * @returns {Array<{col: number, row: number, startRow: number, startCol: number}>}
   */
  generateFallAnimations(beforeGrid) {
    const animations = [];

    for (let x = 0; x < this.cols; x++) {
      const oldTileCount = beforeGrid[x].filter(t => t !== null).length;
      const beforeOldTiles = [];
      for (let y = 0; y < this.rows; y++) {
        if (beforeGrid[x][y] !== null) {
          beforeOldTiles.push({ row: y, typeId: beforeGrid[x][y] });
        }
      }

      const afterOldTiles = [];
      const oldStartRow = this.rows - oldTileCount;
      for (let y = oldStartRow; y < this.rows; y++) {
        if (this.grid[x][y] !== null) {
          afterOldTiles.push({ row: y, typeId: this.grid[x][y] });
        }
      }

      // Old tiles falling
      for (let i = 0; i < beforeOldTiles.length; i++) {
        const beforeTile = beforeOldTiles[i];
        const afterTile = afterOldTiles[i];
        if (afterTile && beforeTile.row !== afterTile.row) {
          animations.push({
            col: x, row: afterTile.row,
            startRow: beforeTile.row, startCol: x,
          });
        }
      }

      // New tiles from above
      for (let y = 0; y < oldStartRow; y++) {
        animations.push({
          col: x, row: y,
          startRow: -1, startCol: x,
        });
      }
    }

    return animations;
  }

  // ── Clone ────────────────────────────────────────────

  /** Deep copy for AI simulation. */
  clone() {
    const clone = new BoardModel(this.cols, this.rows);
    clone.spawnWeights = { ...this.spawnWeights };
    clone.weightModifiers = { ...this.weightModifiers };
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        clone.grid[x][y] = this.grid[x][y];
      }
    }
    return clone;
  }

  // ── Valid Moves ──────────────────────────────────────

  /**
   * Get all valid adjacent swaps (right + down neighbors only).
   * @returns {Array<{col1: number, row1: number, col2: number, row2: number}>}
   */
  getValidSwaps() {
    const swaps = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (!this.grid[x][y]) continue;
        if (x + 1 < this.cols && this.grid[x + 1][y]) {
          swaps.push({ col1: x, row1: y, col2: x + 1, row2: y });
        }
        if (y + 1 < this.rows && this.grid[x][y + 1]) {
          swaps.push({ col1: x, row1: y, col2: x, row2: y + 1 });
        }
      }
    }
    return swaps;
  }

  /** Check if any swap would produce a match. */
  hasAnyValidMove() {
    const swaps = this.getValidSwaps();
    for (const sw of swaps) {
      this.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      const matches = this.findAllMatches();
      this.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      if (matches.length > 0) return true;
    }
    return false;
  }

  /** Reshuffle the entire board. */
  reshuffle() {
    this.initialize();
  }

  // ── Grid Snapshot ────────────────────────────────────

  /** Return a 2D array snapshot (rows × cols) for rendering. */
  getGridSnapshot() {
    const snapshot = [];
    for (let y = 0; y < this.rows; y++) {
      const row = [];
      for (let x = 0; x < this.cols; x++) {
        row.push(this.grid[x][y]);
      }
      snapshot.push(row);
    }
    return snapshot;
  }

  toJSON() {
    return this.grid.map(col => [...col]);
  }
}
