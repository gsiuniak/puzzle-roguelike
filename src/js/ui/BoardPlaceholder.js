import UIElement from './UIElement.js';

/**
 * BoardRenderer — renders the 8×8 match-3 grid from a BoardModel.
 *
 * Visual cascade states (set externally from BattleController):
 *   - highlightCells: matched tiles glow yellow (SHOW_MATCH phase)
 *   - emptyCells: dark overlay where tiles were removed (REMOVE phase)
 *   - fallCells: tiles animate from startRow to current row (FALL phase)
 */
export default class BoardPlaceholder extends UIElement {
  constructor(assetManager = null, boardModel = null) {
    super();
    this._assetManager = assetManager;
    this._boardModel = boardModel;
    this._placeholderGrid = null;

    // Input
    this.hoveredCell = null;
    this.selectedCell = null;

    // Cascade visual state
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._fallProgress = 0;
    this._fallDuration = 350; // should match BattleController.PHASE_MS.FALL

    if (!boardModel) this._generatePlaceholder();
  }

  setBoardModel(model) {
    this._boardModel = model;
    this._placeholderGrid = null;
  }

  get cols() { return this._boardModel ? this._boardModel.cols : 8; }
  get rows() { return this._boardModel ? this._boardModel.rows : 8; }

  _generatePlaceholder() {
    const types = ['red', 'blue', 'green', 'yellow', 'purple', 'skull'];
    this._placeholderGrid = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let c = 0; c < 8; c++) {
        row.push(types[Math.floor(Math.random() * types.length)]);
      }
      this._placeholderGrid.push(row);
    }
  }

  // ── Layout ────────────────────────────────────────────

  layoutSelf(available) {
    const size = Math.min(available.w, available.h);
    this.rect.x = available.x + (available.w - size) / 2;
    this.rect.y = available.y + (available.h - size) / 2;
    this.rect.w = size;
    this.rect.h = size;
  }

  // ── Cell Metrics ─────────────────────────────────────

  getTileAt(row, col) {
    if (this._boardModel) return this._boardModel.get(col, row);
    if (this._placeholderGrid && row >= 0 && row < this._placeholderGrid.length) {
      return this._placeholderGrid[row][col];
    }
    return null;
  }

  getCellMetrics() {
    const r = this.rect;
    const cw = r.w / this.cols;
    const ch = r.h / this.rows;
    const cs = Math.min(cw, ch);
    const ox = r.x + (r.w - cs * this.cols) / 2;
    const oy = r.y + (r.h - cs * this.rows) / 2;
    return { cellSize: cs, offsetX: ox, offsetY: oy };
  }

  screenToCell(px, py) {
    const { cellSize, offsetX, offsetY } = this.getCellMetrics();
    const col = Math.floor((px - offsetX) / cellSize);
    const row = Math.floor((py - offsetY) / cellSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { col, row };
  }

  // ── Update (animate fall) ─────────────────────────────

  update(dt) {
    if (this.fallCells.length > 0) {
      this._fallProgress = Math.min(1, this._fallProgress + dt / this._fallDuration);
    } else {
      this._fallProgress = 0;
    }
    super.update(dt);
  }

  // ── Render ───────────────────────────────────────────

  renderSelf(ctx) {
    const { cellSize, offsetX, offsetY } = this.getCellMetrics();

    const gridDark = this._assetManager ? this._assetManager.get('grid_dark') : null;
    const gridLight = this._assetManager ? this._assetManager.get('grid_light') : null;

    const fallbackColors = {
      red: '#cc3333', blue: '#3366cc', green: '#33aa33',
      yellow: '#cccc33', purple: '#9933cc', skull: '#555555',
    };

    const bgDark = '#2a2a1a';
    const bgLight = '#3a3a2a';

    // Build set of empty positions for quick lookup
    const emptySet = new Set(this.emptyCells.map(p => `${p.col},${p.row}`));

    // Build map of fall data: "col,row" → { startRow, startCol }
    const fallMap = {};
    for (const f of this.fallCells) {
      fallMap[`${f.col},${f.row}`] = f;
    }

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const key = `${col},${row}`;

        // Skip empty cells during REMOVE phase
        if (emptySet.has(key)) {
          // Render dark empty cell
          const x = offsetX + col * cellSize;
          const y = offsetY + row * cellSize;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(x, y, cellSize, cellSize);
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, cellSize, cellSize);
          continue;
        }

        const colorKey = this.getTileAt(row, col);
        if (!colorKey) continue;

        // Compute display position (animated for falling tiles)
        let displayX = offsetX + col * cellSize;
        let displayY = offsetY + row * cellSize;

        const fallData = fallMap[key];
        if (fallData && this._fallProgress < 1) {
          const startY = fallData.startRow >= 0
            ? offsetY + fallData.startRow * cellSize
            : offsetY - cellSize; // from above
          const startX = offsetX + fallData.startCol * cellSize;
          const t = this._fallProgress;
          // Ease-out quad for natural feel
          const ease = 1 - (1 - t) * (1 - t);
          displayX = startX + (displayX - startX) * ease;
          displayY = startY + (displayY - startY) * ease;
        }

        // Chessboard background
        const isDark = (row + col) % 2 === 0;
        const bgImg = isDark ? gridDark : gridLight;
        if (bgImg) {
          ctx.drawImage(bgImg, displayX, displayY, cellSize, cellSize);
        } else {
          ctx.fillStyle = isDark ? bgDark : bgLight;
          ctx.fillRect(displayX, displayY, cellSize, cellSize);
        }

        // Tile sprite
        const assetKey = `tile_${colorKey}`;
        const tileImg = this._assetManager ? this._assetManager.get(assetKey) : null;
        if (tileImg) {
          ctx.drawImage(tileImg, displayX, displayY, cellSize, cellSize);
        } else {
          ctx.fillStyle = fallbackColors[colorKey] || '#444';
          ctx.fillRect(displayX + 1, displayY + 1, cellSize - 2, cellSize - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(displayX + 1, displayY + 1, cellSize - 2, (cellSize - 2) * 0.3);
        }

        // Cell border
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(displayX, displayY, cellSize, cellSize);
      }
    }

    // ── Highlight overlay (SHOW_MATCH phase) ──
    for (const pos of this.highlightCells) {
      const hx = offsetX + pos.col * cellSize;
      const hy = offsetY + pos.row * cellSize;
      ctx.save();
      // Pulsing glow
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
      ctx.fillStyle = `rgba(255,255,100,${0.15 + pulse * 0.2})`;
      ctx.fillRect(hx, hy, cellSize, cellSize);
      ctx.strokeStyle = `rgba(255,255,50,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
      ctx.restore();
    }

    // ── Hover ── (hidden during cascade animations)
    const inCascade = this.highlightCells.length > 0 || this.emptyCells.length > 0 || this.fallCells.length > 0;
    if (this.hoveredCell && !inCascade) {
      const hx = offsetX + this.hoveredCell.col * cellSize;
      const hy = offsetY + this.hoveredCell.row * cellSize;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,200,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
      ctx.restore();
    }

    // ── Selection ──
    if (this.selectedCell) {
      const sx = offsetX + this.selectedCell.col * cellSize;
      const sy = offsetY + this.selectedCell.row * cellSize;
      ctx.save();
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx + 1, sy + 1, cellSize - 2, cellSize - 2);
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 8;
      ctx.strokeRect(sx + 1, sy + 1, cellSize - 2, cellSize - 2);
      ctx.restore();
    }
  }

  // ── Asset ─────────────────────────────────────────────

  setAssetManager(am) { this._assetManager = am; }

  setStyle(props) {
    super.setStyle(props);
    if ((props.cols !== undefined || props.rows !== undefined) && !this._boardModel) {
      this._generatePlaceholder();
    }
  }
}
