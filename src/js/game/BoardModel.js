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

import { getRandomTileType, getDefaultSpawnWeights, isSkull, isInert, isWild, BOARD_COLS, BOARD_ROWS } from './TileTypes.js';

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

    /**
     * @type {Object<string, number>} per-tile spawn-rate boosts in
     * PERCENTAGE POINTS (e.g. { red: 10 } → +10% red spawn chance).
     * Sourced from spawn-rate relics (Group A). See getEffectiveWeights().
     */
    this.spawnRateBoosts = {};

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

  /**
   * Set per-tile spawn-rate boosts (in percentage points). Each boosted
   * tile's final spawn chance becomes its base chance + the boost; the
   * remaining probability is redistributed across the non-boosted tiles in
   * proportion to their base rates, so non-boosted tiles keep their relative
   * ratios. Skull effectively absorbs any leftover via the proportional
   * redistribution so the distribution always sums to ~100%.
   *
   * @param {Object<string, number>} boosts - e.g. { red: 10, skull: 10 }
   */
  setSpawnRateBoosts(boosts) {
    this.spawnRateBoosts = { ...(boosts || {}) };
  }

  getEffectiveWeights() {
    const weights = { ...this.spawnWeights };
    for (const [color, mod] of Object.entries(this.weightModifiers)) {
      weights[color] = Math.max(0, (weights[color] || 0) + mod);
    }

    const boosts = this.spawnRateBoosts;
    if (!boosts || Object.keys(boosts).length === 0) {
      return weights;
    }

    // Convert base weights to percentages (the defaults already sum to 100,
    // but weightModifiers may have changed the total — normalize to be safe).
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (total <= 0) return weights;
    const pct = {};
    for (const [id, w] of Object.entries(weights)) pct[id] = (w / total) * 100;

    // Boosted tiles: base% + boost (points). Track their combined share so
    // the rest can split whatever budget remains up to 100%.
    const result = {};
    const boostedIds = new Set();
    let boostedSum = 0;
    for (const [id, amt] of Object.entries(boosts)) {
      if (pct[id] === undefined || !(amt > 0)) continue;
      result[id] = pct[id] + amt;
      boostedSum += result[id];
      boostedIds.add(id);
    }

    // Non-boosted tiles share the remaining budget proportional to base %.
    const restBaseSum = Object.entries(pct)
      .filter(([id]) => !boostedIds.has(id))
      .reduce((sum, [, p]) => sum + p, 0);
    const remaining = Math.max(0, 100 - boostedSum);
    for (const [id, p] of Object.entries(pct)) {
      if (boostedIds.has(id)) continue;
      result[id] = restBaseSum > 0 ? (p / restBaseSum) * remaining : 0;
    }

    return result;
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
   * Scan a single line (row or column) for matchable runs of 3+, WILD-AWARE.
   *
   * A wild tile (Thrall) stands in for any concrete COLOR/SKULL type, so for
   * each such type `c` present on the line we find maximal consecutive runs
   * whose every cell is either `c` or a wild. A run is only emitted when it is
   * 3+ long AND contains at least one concrete `c` (a pure-wild run has no host
   * type and never matches on its own). Because the scan repeats per type, a
   * single wild that bridges two colors can legitimately belong to a run of
   * each — the caller (findAllConnectedMatches) keeps differently-typed matches
   * separate.
   *
   * Inert types (Disease) still match as same-type runs (3+ identical tiles in
   * a line) so existing clutter-clearing behavior is preserved, but wilds do
   * NOT substitute for inert tiles — a Thrall never completes a Disease match.
   *
   * @private
   * @param {Array<string|null>} line - tile ids along the line (null = empty)
   * @returns {Array<{ typeId: string, idxs: number[] }>} runs by line index
   */
  _scanLineRuns(line) {
    const L = line.length;
    const runs = [];

    // Concrete matchable types present (skip empty + wild tiles; inert tiles
    // are included but only ever match as themselves — see allowWild below).
    const colors = new Set();
    for (const t of line) {
      if (t && !isWild(t)) colors.add(t);
    }

    for (const c of colors) {
      const allowWild = !isInert(c); // wilds never substitute for inert tiles
      let i = 0;
      while (i < L) {
        const cell = line[i];
        if (cell === c || (allowWild && isWild(cell))) {
          let j = i;
          let hasConcrete = false;
          while (j < L && (line[j] === c || (allowWild && isWild(line[j])))) {
            if (line[j] === c) hasConcrete = true;
            j++;
          }
          if (j - i >= 3 && hasConcrete) {
            const idxs = [];
            for (let k = i; k < j; k++) idxs.push(k);
            runs.push({ typeId: c, idxs });
          }
          i = j;
        } else {
          i++;
        }
      }
    }

    return runs;
  }

  /**
   * Find all simple horizontal and vertical matches (3+ in a line), wild-aware.
   * Each run is a separate match (horizontal and vertical runs are NOT merged
   * here — see findAllConnectedMatches for shape merging). Consumers of this
   * method only need match existence / position membership, so overlapping
   * positions across a horizontal and a vertical run are reported independently.
   * @returns {Array<{typeId: string, positions: Array<{col:number, row:number}>, count: number}>}
   */
  findAllMatches() {
    const matches = [];

    // Horizontal — one line per row.
    for (let y = 0; y < this.rows; y++) {
      const line = [];
      for (let x = 0; x < this.cols; x++) line.push(this.grid[x][y]);
      for (const run of this._scanLineRuns(line)) {
        const positions = run.idxs.map((x) => ({ col: x, row: y }));
        matches.push({ typeId: run.typeId, positions, count: positions.length });
      }
    }

    // Vertical — one line per column.
    for (let x = 0; x < this.cols; x++) {
      const line = this.grid[x];
      for (const run of this._scanLineRuns(line)) {
        const positions = run.idxs.map((y) => ({ col: x, row: y }));
        matches.push({ typeId: run.typeId, positions, count: positions.length });
      }
    }

    return matches;
  }

  /**
   * Would placing `typeId` at (col, row) make that cell part of a match?
   * Wild-aware (uses findAllMatches). Temporarily stamps the tile, checks
   * membership, then restores the original cell. Used for safe Thrall spawning.
   * @param {number} col @param {number} row @param {string} typeId
   * @returns {boolean}
   */
  positionCreatesMatch(col, row, typeId) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const prev = this.grid[col][row];
    this.grid[col][row] = typeId;
    const matches = this.findAllMatches();
    this.grid[col][row] = prev;
    for (const m of matches) {
      for (const p of m.positions) {
        if (p.col === col && p.row === row) return true;
      }
    }
    return false;
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
    // Step 1: Find all raw horizontal and vertical runs (wild-aware).
    const rawRuns = [];

    // Horizontal — one line per row.
    for (let y = 0; y < this.rows; y++) {
      const line = [];
      for (let x = 0; x < this.cols; x++) line.push(this.grid[x][y]);
      for (const run of this._scanLineRuns(line)) {
        const positions = run.idxs.map((x) => ({ col: x, row: y }));
        rawRuns.push({ typeId: run.typeId, positions, isHorizontal: true });
      }
    }

    // Vertical — one line per column.
    for (let x = 0; x < this.cols; x++) {
      for (const run of this._scanLineRuns(this.grid[x])) {
        const positions = run.idxs.map((y) => ({ col: x, row: y }));
        rawRuns.push({ typeId: run.typeId, positions, isHorizontal: false });
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
    clone.spawnRateBoosts = { ...this.spawnRateBoosts };
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

  // ── CREATE_TILES helpers ────────────────────────────

  /**
   * Get all board positions whose tile is NOT of the given type.
   * Excludes empty (null) cells.
   * @param {string} typeId - the tile type to exclude
   * @returns {Array<{col:number, row:number}>}
   */
  getTilesNotOfType(typeId) {
    const positions = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const tile = this.grid[x][y];
        if (tile !== null && tile !== typeId) {
          positions.push({ col: x, row: y });
        }
      }
    }
    return positions;
  }

  /**
   * Get all board positions whose tile IS of the given type.
   * @param {string} typeId - the tile type to match
   * @returns {Array<{col:number, row:number}>}
   */
  getTilesOfType(typeId) {
    const positions = [];
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (this.grid[x][y] === typeId) {
          positions.push({ col: x, row: y });
        }
      }
    }
    return positions;
  }

  /**
   * Randomly select up to `amount` tiles from an array using Fisher-Yates sampling.
   * Returns a new array; does not mutate the input.
   * @param {Array<{col:number, row:number}>} tiles
   * @param {number} amount
   * @returns {Array<{col:number, row:number}>}
   */
  static pickRandomTiles(tiles, amount) {
    if (tiles.length === 0) return [];
    const n = Math.min(amount, tiles.length);
    // Fisher-Yates partial shuffle
    const copy = [...tiles];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  /**
   * Convert the given positions to the specified tile type in-place.
   * Silently skips out-of-bounds or null positions.
   * @param {Array<{col:number, row:number}>} positions
   * @param {string} typeId - new tile type
   * @returns {number} count of tiles actually converted
   */
  convertTilesToType(positions, typeId) {
    let count = 0;
    for (const pos of positions) {
      if (pos.col >= 0 && pos.col < this.cols && pos.row >= 0 && pos.row < this.rows) {
        if (this.grid[pos.col][pos.row] !== null) {
          this.grid[pos.col][pos.row] = typeId;
          count++;
        }
      }
    }
    return count;
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
