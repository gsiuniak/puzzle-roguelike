import UIElement from './UIElement.js';

/**
 * BoardPlaceholder — renders an 8×8 visual placeholder grid.
 *
 * Uses tile sprite images when available, falls back to colored squares.
 * No gameplay logic, no input, no matching — purely visual.
 *
 * Properties:
 *   cols / rows    - grid dimensions (default 8×8)
 *   _assetManager  - AssetManager for tile sprites
 *   _grid          - pre-generated 2D array of color keys
 */
export default class BoardPlaceholder extends UIElement {
  constructor(assetManager = null, cols = 8, rows = 8) {
    super();
    this.cols = cols;
    this.rows = rows;
    this._assetManager = assetManager;

    // Color palette for the 6 tile types
    this._tileTypes = ['red', 'blue', 'green', 'yellow', 'purple', 'skull'];
    this._grid = [];

    this.generateGrid();
  }

  /** Generate a random grid of tile colors */
  generateGrid() {
    this._grid = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        const idx = Math.floor(Math.random() * this._tileTypes.length);
        row.push(this._tileTypes[idx]);
      }
      this._grid.push(row);
    }
  }

  // ── layout: force square ─────────────────────────────

  /**
   * Override layoutSelf to keep the board square and centered
   * within the available space.
   */
  layoutSelf(available) {
    const size = Math.min(available.w, available.h);
    this.rect.x = available.x + (available.w - size) / 2;
    this.rect.y = available.y + (available.h - size) / 2;
    this.rect.w = size;
    this.rect.h = size;
  }

  // ── render ───────────────────────────────────────────

  renderSelf(ctx) {
    const r = this.rect;
    const cellW = r.w / this.cols;
    const cellH = r.h / this.rows;
    const cellSize = Math.min(cellW, cellH);

    // Center the grid within the square rect
    const gridW = cellSize * this.cols;
    const gridH = cellSize * this.rows;
    const offsetX = r.x + (r.w - gridW) / 2;
    const offsetY = r.y + (r.h - gridH) / 2;

    // Fallback color map for when tile images aren't loaded
    const fallbackColors = {
      red:    '#cc3333',
      blue:   '#3366cc',
      green:  '#33aa33',
      yellow: '#cccc33',
      purple: '#9933cc',
      skull:  '#555555',
    };

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = offsetX + col * cellSize;
        const y = offsetY + row * cellSize;
        const colorKey = this._grid[row][col];

        // Try tile sprite first
        const assetKey = `tile_${colorKey}`;
        const img = this._assetManager ? this._assetManager.get(assetKey) : null;

        if (img) {
          ctx.drawImage(img, x, y, cellSize, cellSize);
        } else {
          // Fallback: filled rectangle with a subtle inner border
          ctx.fillStyle = fallbackColors[colorKey] || '#444444';
          ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

          // Light inner highlight
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(x + 1, y + 1, cellSize - 2, (cellSize - 2) * 0.3);
        }

        // Cell border
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellSize, cellSize);
      }
    }
  }

  // ── asset mgmt ───────────────────────────────────────

  setAssetManager(am) {
    this._assetManager = am;
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.cols !== undefined) {
      this.cols = props.cols;
      this.generateGrid();
    }
    if (props.rows !== undefined) {
      this.rows = props.rows;
      this.generateGrid();
    }
  }
}
