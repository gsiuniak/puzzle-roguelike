/**
 * sim/board.mjs — a real (headless) 8×8 match-3 board.
 *
 * Faithful port of src/js/game/BoardModel.js + the TileTypes spawn weights.
 * No rendering — this is the actual grid logic so the AI can evaluate concrete
 * swaps (real matches, shapes, cascades) rather than an abstract economy model.
 *
 * KEEP IN SYNC with src/js/game/BoardModel.js / TileTypes.js if those change.
 */

export const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
export const ALL_TYPES = [...COLORS, 'skull'];
// spawn weights from TileTypes.js: colors 16 each, skull 20 (total 100).
const SPAWN_WEIGHTS = { red: 16, blue: 16, green: 16, yellow: 16, purple: 16, skull: 20 };

export const isSkull = (id) => id === 'skull';

/**
 * Effective spawn weights given per-tile percentage-point boosts
 * (mirror of BoardModel.getEffectiveWeights — boosted tile gets base%+boost,
 * remainder redistributed proportionally).
 */
export function effectiveWeights(boosts = {}) {
  const base = { ...SPAWN_WEIGHTS };
  if (!boosts || Object.keys(boosts).length === 0) return base;
  const total = Object.values(base).reduce((s, w) => s + w, 0);
  const pct = {};
  for (const [id, w] of Object.entries(base)) pct[id] = (w / total) * 100;
  const result = {};
  const boosted = new Set();
  let boostedSum = 0;
  for (const [id, amt] of Object.entries(boosts)) {
    if (pct[id] === undefined || !(amt > 0)) continue;
    result[id] = pct[id] + amt; boostedSum += result[id]; boosted.add(id);
  }
  const restBase = Object.entries(pct).filter(([id]) => !boosted.has(id)).reduce((s, [, p]) => s + p, 0);
  const remaining = Math.max(0, 100 - boostedSum);
  for (const [id, p] of Object.entries(pct)) {
    if (boosted.has(id)) continue;
    result[id] = restBase > 0 ? (p / restBase) * remaining : 0;
  }
  return result;
}

export class Board {
  constructor(cols = 8, rows = 8, rng = Math.random, boosts = {}) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.weights = effectiveWeights(boosts);
    this.grid = Array.from({ length: cols }, () => new Array(rows).fill(null));
  }

  randType() {
    const entries = Object.entries(this.weights).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng() * total;
    for (const [id, w] of entries) { roll -= w; if (roll <= 0) return id; }
    return entries[entries.length - 1][0];
  }

  get(c, r) { return (c < 0 || c >= this.cols || r < 0 || r >= this.rows) ? null : this.grid[c][r]; }
  set(c, r, v) { if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) this.grid[c][r] = v; }
  swap(c1, r1, c2, r2) { const t = this.grid[c1][r1]; this.grid[c1][r1] = this.grid[c2][r2]; this.grid[c2][r2] = t; }

  isAdjacent(c1, r1, c2, r2) {
    const dc = Math.abs(c1 - c2), dr = Math.abs(r1 - r2);
    return (dc === 1 && dr === 0) || (dc === 0 && dr === 1);
  }

  wouldCreateMatch(c, r, t) {
    let h = 1;
    for (let x = c - 1; x >= 0 && this.grid[x][r] === t; x--) h++;
    for (let x = c + 1; x < this.cols && this.grid[x][r] === t; x++) h++;
    if (h >= 3) return true;
    let v = 1;
    for (let y = r - 1; y >= 0 && this.grid[c][y] === t; y--) v++;
    for (let y = r + 1; y < this.rows && this.grid[c][y] === t; y++) v++;
    return v >= 3;
  }

  initialize() {
    for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) this.grid[x][y] = null;
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        let t, attempts = 0;
        do { t = this.randType(); attempts++; } while (this.wouldCreateMatch(x, y, t) && attempts < 50);
        this.grid[x][y] = t;
      }
    }
    // cleanup any residual matches
    for (let iter = 0; iter < 50; iter++) {
      const m = this.findAllConnectedMatches();
      if (!m.length) break;
      for (const match of m) for (const p of match.positions) this.grid[p.col][p.row] = null;
      for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) {
        if (this.grid[x][y] === null) {
          let t, a = 0;
          do { t = this.randType(); a++; } while (this.wouldCreateMatch(x, y, t) && a < 50);
          this.grid[x][y] = t;
        }
      }
    }
  }

  /** Cheap test: does the tile at (c,r) currently sit in a 3+ line? Used to prune swaps. */
  hasMatchAt(c, r) {
    const t = this.grid[c][r];
    if (!t) return false;
    let h = 1;
    for (let x = c - 1; x >= 0 && this.grid[x][r] === t; x--) h++;
    for (let x = c + 1; x < this.cols && this.grid[x][r] === t; x++) h++;
    if (h >= 3) return true;
    let v = 1;
    for (let y = r - 1; y >= 0 && this.grid[c][y] === t; y--) v++;
    for (let y = r + 1; y < this.rows && this.grid[c][y] === t; y++) v++;
    return v >= 3;
  }

  /** Port of BoardModel.findAllConnectedMatches (runs merged into shapes via union-find). */
  findAllConnectedMatches() {
    const rawRuns = [];
    for (let y = 0; y < this.rows; y++) {
      let x = 0;
      while (x < this.cols) {
        const t = this.grid[x][y];
        if (!t) { x++; continue; }
        let end = x;
        while (end + 1 < this.cols && this.grid[end + 1][y] === t) end++;
        if (end - x + 1 >= 3) { const pos = []; for (let i = x; i <= end; i++) pos.push({ col: i, row: y }); rawRuns.push({ typeId: t, positions: pos }); }
        x = end + 1;
      }
    }
    for (let x = 0; x < this.cols; x++) {
      let y = 0;
      while (y < this.rows) {
        const t = this.grid[x][y];
        if (!t) { y++; continue; }
        let end = y;
        while (end + 1 < this.rows && this.grid[x][end + 1] === t) end++;
        if (end - y + 1 >= 3) { const pos = []; for (let i = y; i <= end; i++) pos.push({ col: x, row: i }); rawRuns.push({ typeId: t, positions: pos }); }
        y = end + 1;
      }
    }
    if (!rawRuns.length) return [];
    const byType = new Map();
    for (const run of rawRuns) { if (!byType.has(run.typeId)) byType.set(run.typeId, []); byType.get(run.typeId).push(run); }
    const out = [];
    for (const [typeId, runs] of byType.entries()) {
      const n = runs.length;
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const setA = new Set(runs[i].positions.map((p) => `${p.col},${p.row}`));
        let shared = 0;
        for (const p of runs[j].positions) if (setA.has(`${p.col},${p.row}`)) shared++;
        if (shared === 1) union(i, j);
      }
      const groups = new Map();
      for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(runs[i]); }
      for (const [, groupRuns] of groups.entries()) {
        const uniq = new Set();
        for (const run of groupRuns) for (const p of run.positions) uniq.add(`${p.col},${p.row}`);
        const positions = Array.from(uniq).map((k) => { const [col, row] = k.split(',').map(Number); return { col, row }; });
        out.push({ typeId, positions, count: uniq.size, isShape: groupRuns.length > 1 });
      }
    }
    return out;
  }

  removeTiles(positions) { for (const p of positions) if (this.grid[p.col][p.row] != null) this.grid[p.col][p.row] = null; }

  applyGravity() {
    for (let x = 0; x < this.cols; x++) {
      let w = this.rows - 1;
      for (let y = this.rows - 1; y >= 0; y--) {
        if (this.grid[x][y] !== null) { this.grid[x][w] = this.grid[x][y]; if (w !== y) this.grid[x][y] = null; w--; }
      }
    }
  }

  refill() {
    for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) if (this.grid[x][y] === null) this.grid[x][y] = this.randType();
  }

  getValidSwaps() {
    const swaps = [];
    for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) {
      if (!this.grid[x][y]) continue;
      if (x + 1 < this.cols && this.grid[x + 1][y]) swaps.push({ c1: x, r1: y, c2: x + 1, r2: y });
      if (y + 1 < this.rows && this.grid[x][y + 1]) swaps.push({ c1: x, r1: y, c2: x, r2: y + 1 });
    }
    return swaps;
  }

  /** Convert up to `count` random tiles not already `type` into `type` (skill create_tiles). */
  convertRandomTiles(type, count) {
    const candidates = [];
    for (let x = 0; x < this.cols; x++) for (let y = 0; y < this.rows; y++) if (this.grid[x][y] != null && this.grid[x][y] !== type) candidates.push({ col: x, row: y });
    const n = Math.min(count, candidates.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(this.rng() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      this.grid[candidates[i].col][candidates[i].row] = type;
    }
  }

  /** Remove a random full row, returning its tile typeIds (for destroy_row rewards). */
  destroyRandomRow() {
    const row = Math.floor(this.rng() * this.rows);
    const removed = [];
    for (let x = 0; x < this.cols; x++) { if (this.grid[x][row] != null) { removed.push(this.grid[x][row]); this.grid[x][row] = null; } }
    return removed;
  }

  clone() {
    const b = new Board(this.cols, this.rows, this.rng);
    b.weights = this.weights;
    for (let x = 0; x < this.cols; x++) b.grid[x] = this.grid[x].slice();
    return b;
  }
}
