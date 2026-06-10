import UIElement from './UIElement.js';
import { isWild } from '../game/TileTypes.js';

/**
 * Wild-tile (Thrall) animated rainbow border.
 *
 * A thin multicolor frame drawn ON TOP of the wild tile's edge (the base tile
 * art is untouched) so wild tiles read instantly as "match-anything". The five
 * mana colors are expressed as HSL hues so saturation/brightness are tunable in
 * one place. All numeric sizes are fractions of the cell size, so the border
 * scales with the board without changing tile size or layout.
 *
 * Tweak everything here — nothing else needs to change to retune the look.
 */
const WILD_BORDER_CONFIG = {
  enabled: true,
  // 'cycle'  → colors rotate smoothly around the frame (conic gradient).
  // 'scroll' → a multicolor gradient flows diagonally across the frame.
  mode: 'cycle',
  thicknessFrac: 0.055,     // border line thickness, fraction of cell size
  minThickness: 1.5,        // px floor so it stays visible on small boards
  insetFrac: 0.015,         // gap from the cell edge (keeps the line on the tile edge)
  cornerRadiusFrac: 0.17,   // rounded-corner radius, fraction of cell size
  opacity: 0.95,            // overall border opacity (0–1)
  saturation: 95,           // HSL saturation % of the rainbow colors
  lightness: 58,            // HSL lightness % of the rainbow colors
  cycleSpeedDeg: 55,        // 'cycle': degrees/sec the colors rotate (loops continuously)
  scrollSpeed: 0.18,        // 'scroll': gradient offsets/sec (loops at 1.0)
  glowIntensity: 1.0,       // bloom strength multiplier (0 = no glow)
  glowBlurFrac: 0.07,       // bloom spread, fraction of cell size
  glowLayers: 2,            // # of additive bloom strokes (more = softer/heavier)
  pulseSpeed: 0.5,          // glow "breathing" cycles/sec
  pulseAmount: 0.5,         // 0 = steady glow, 1 = full breathing range
};

/**
 * The five mana colors as HSL hues, in spectral order so the rotation reads as
 * a smooth rainbow: red → yellow → green → blue → purple. Saturation/lightness
 * come from WILD_BORDER_CONFIG.
 */
const WILD_BORDER_HUES = [0, 55, 120, 220, 285];

/**
 * BoardRenderer — renders the 8×8 match-3 grid from a BoardModel.
 *
 * Visual cascade states (set externally from BattleController):
 *   - highlightCells: matched tiles glow yellow (SHOW_MATCH phase)
 *   - emptyCells: dark overlay where tiles were removed (REMOVE phase)
 *   - fallCells: tiles animate from startRow to current row (FALL phase)
 *
 * Wild (Thrall) tiles additionally get an animated rainbow border overlay
 * (see _drawWildBorder + WILD_BORDER_CONFIG) drawn on top of the tile art.
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

    // Particle effects (set by BattleScene each frame)
    /** @type {Array<import('./TileParticleEffect.js').default>} */
    this.particleEffects = [];

    // Targeting overlay (for skills like Explode!)
    /** @type {Array<{col:number, row:number}>} */
    this.targetingOverlayCells = [];
    this._fallProgress = 0;
    this._fallDuration = 350;

    // Swap animation state
    /** @type {{from:{col:number,row:number},to:{col:number,row:number},progress:number}|null} */
    this.swapAnim = null;

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
    // Board sprites are always crisp
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    const { cellSize, offsetX, offsetY } = this.getCellMetrics();
    // Round cell metrics to integers to avoid sub-pixel rendering
    const cs = Math.floor(cellSize);
    const ox = Math.floor(offsetX);
    const oy = Math.floor(offsetY);

    const gridDark = this._assetManager ? this._assetManager.get('grid_dark') : null;
    const gridLight = this._assetManager ? this._assetManager.get('grid_light') : null;

    const fallbackColors = {
      red: '#cc3333', blue: '#3366cc', green: '#33aa33',
      yellow: '#cccc33', purple: '#9933cc', skull: '#555555',
      disease: '#7d8a3a', thrall: '#b0392f',
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

    // Swap animation: skip rendering swapped tiles in their original positions
    const swapSkip = new Set();
    if (this.swapAnim) {
      swapSkip.add(`${this.swapAnim.from.col},${this.swapAnim.from.row}`);
      swapSkip.add(`${this.swapAnim.to.col},${this.swapAnim.to.row}`);
    }

    // ═══════════════════════════════════════════════════════
    // PASS 1: Draw all cell BACKGROUNDS (chessboard + dark empties)
    // ═══════════════════════════════════════════════════════
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const key = `${col},${row}`;
        const x = ox + col * cs;
        const y = oy + row * cs;
        const isDark = (row + col) % 2 === 0;

        if (emptySet.has(key)) {
          // Dark overlay for removed tiles
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(x, y, cs, cs);
        } else {
          // Chessboard background — stretch full source image into tile cell
          const bgImg = isDark ? gridDark : gridLight;
          if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, x, y, cs, cs);
          } else {
            ctx.fillStyle = isDark ? bgDark : bgLight;
            ctx.fillRect(x, y, cs, cs);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // PASS 2: PARTICLE EFFECTS (render below tiles, above bg)
    // ═══════════════════════════════════════════════════════
    if (this.particleEffects && this.particleEffects.length > 0) {
      ctx.save();
      // Additive blending for magical glow
      ctx.globalCompositeOperation = 'lighter';
      for (const effect of this.particleEffects) {
        effect.render(ctx);
      }
      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════
    // PASS 3: TILES + BORDERS + OVERLAYS
    // ═══════════════════════════════════════════════════════
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const key = `${col},${row}`;

        // Skip tiles being swap-animated (rendered separately at end)
        if (swapSkip.has(key)) continue;

        // Skip empty cells
        if (emptySet.has(key)) continue;

        const colorKey = this.getTileAt(row, col);
        if (!colorKey) continue;

        // Compute display position (animated for falling tiles)
        let displayX = ox + col * cs;
        let displayY = oy + row * cs;

        const fallData = fallMap[key];
        if (fallData && this._fallProgress < 1) {
          const startY = fallData.startRow >= 0
            ? oy + fallData.startRow * cs
            : oy - cs;
          const startX = ox + fallData.startCol * cs;
          const t = this._fallProgress;
          const ease = 1 - (1 - t) * (1 - t);
          displayX = Math.floor(startX + (displayX - startX) * ease);
          displayY = Math.floor(startY + (displayY - startY) * ease);
        }

        // Tile sprite
        const assetKey = `tile_${colorKey}`;
        const tileImg = this._assetManager ? this._assetManager.get(assetKey) : null;
        if (tileImg) {
          ctx.drawImage(tileImg, 0, 0, tileImg.width, tileImg.height, displayX, displayY, cs, cs);
        } else {
          ctx.fillStyle = fallbackColors[colorKey] || '#444';
          ctx.fillRect(displayX + 1, displayY + 1, cs - 2, cs - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(displayX + 1, displayY + 1, cs - 2, (cs - 2) * 0.3);
        }

        // Cell border
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(displayX, displayY, cs, cs);

        // Wild (Thrall) tiles: animated rainbow border overlay on the tile edge.
        // Follows the tile (incl. fall animation) since it uses displayX/displayY.
        if (isWild(colorKey)) {
          this._drawWildBorder(ctx, displayX, displayY, cs);
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // OVERLAYS (rendered above tiles)
    // ═══════════════════════════════════════════════════════

    // ── Highlight overlay (SHOW_MATCH phase) ──
    for (const pos of this.highlightCells) {
      const hx = ox + pos.col * cs;
      const hy = oy + pos.row * cs;
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
      ctx.fillStyle = `rgba(255,255,100,${0.15 + pulse * 0.2})`;
      ctx.fillRect(hx, hy, cs, cs);
      ctx.strokeStyle = `rgba(255,255,50,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(hx + 1, hy + 1, cs - 2, cs - 2);
      ctx.restore();
    }

    // ── Targeting overlay (skill targeting like Explode! 3x3) ──
    if (this.targetingOverlayCells && this.targetingOverlayCells.length > 0) {
      for (const pos of this.targetingOverlayCells) {
        const hx = ox + pos.col * cs;
        const hy = oy + pos.row * cs;
        ctx.save();
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
        ctx.shadowColor = `rgba(255, 255, 255, ${0.4 + pulse * 0.4})`;
        ctx.shadowBlur = 12 + (pulse * 8);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + pulse * 0.15})`;
        ctx.fillRect(hx, hy, cs, cs);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 3;
        ctx.strokeRect(hx, hy, cs, cs);
        ctx.restore();
      }
    }

    // ── Hover ── (hidden during cascade animations)
    const inCascade = this.highlightCells.length > 0 || this.emptyCells.length > 0 || this.fallCells.length > 0;
    if (this.hoveredCell && !inCascade && !(this.targetingOverlayCells && this.targetingOverlayCells.length > 0)) {
      const hx = ox + this.hoveredCell.col * cs;
      const hy = oy + this.hoveredCell.row * cs;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,200,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, cs - 2, cs - 2);
      ctx.restore();
    }

    // ── Selection ──
    if (this.selectedCell) {
      const sx = ox + this.selectedCell.col * cs;
      const sy = oy + this.selectedCell.row * cs;
      ctx.save();
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx + 1, sy + 1, cs - 2, cs - 2);
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 8;
      ctx.strokeRect(sx + 1, sy + 1, cs - 2, cs - 2);
      ctx.restore();
    }

    // ── Swap animation ──
    if (this.swapAnim) {
      const { from, to, progress } = this.swapAnim;
      const t = progress;
      const ease = 1 - (1 - t) * (1 - t);

      const fromType = this.getTileAt(from.row, from.col);
      const toType = this.getTileAt(to.row, to.col);

      const fromStartX = ox + from.col * cs;
      const fromStartY = oy + from.row * cs;
      const toStartX = ox + to.col * cs;
      const toStartY = oy + to.row * cs;

      const ax = Math.floor(fromStartX + (toStartX - fromStartX) * ease);
      const ay = Math.floor(fromStartY + (toStartY - fromStartY) * ease);
      const bx = Math.floor(toStartX + (fromStartX - toStartX) * ease);
      const by = Math.floor(toStartY + (fromStartY - toStartY) * ease);

      const drawTile = (x, y, typeKey) => {
        if (!typeKey) return;
        const assetKey = `tile_${typeKey}`;
        const tileImg = this._assetManager ? this._assetManager.get(assetKey) : null;
        if (tileImg) {
          ctx.drawImage(tileImg, 0, 0, tileImg.width, tileImg.height, x, y, cs, cs);
        } else {
          ctx.fillStyle = fallbackColors[typeKey] || '#444';
          ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(x + 1, y + 1, cs - 2, (cs - 2) * 0.3);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cs, cs);
        // Keep the wild rainbow border on Thrall tiles while they swap.
        if (isWild(typeKey)) this._drawWildBorder(ctx, x, y, cs);
      };

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      drawTile(ax, ay, fromType);
      drawTile(bx, by, toType);
      ctx.restore();
    }

    // Restore smoothing to previous state
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  // ── Wild (Thrall) rainbow border ──────────────────────

  /**
   * Draw the animated multicolor border for a wild (Thrall) tile, on top of
   * the existing tile art at (x, y) with side length `size`. Tunable entirely
   * via WILD_BORDER_CONFIG. Self-contained (own save/restore); never mutates
   * tile size or position. Animation is time-driven (Date.now()), matching the
   * other pulsing overlays in this renderer.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - tile top-left X (design space)
   * @param {number} y - tile top-left Y (design space)
   * @param {number} size - tile side length (px)
   */
  _drawWildBorder(ctx, x, y, size) {
    const cfg = WILD_BORDER_CONFIG;
    if (!cfg.enabled || size <= 0) return;

    const tSec = Date.now() / 1000;

    const thickness = Math.max(cfg.minThickness, cfg.thicknessFrac * size);
    const inset = cfg.insetFrac * size;
    const half = thickness / 2;

    // Border rect, inset so the stroke sits on the tile's outer edge.
    const bx = x + inset + half;
    const by = y + inset + half;
    const bw = size - 2 * (inset + half);
    if (bw <= 0) return;
    const r = Math.min(cfg.cornerRadiusFrac * size, bw / 2);
    const cx = x + size / 2;
    const cy = y + size / 2;

    const grad = this._makeWildGradient(ctx, cx, cy, bx, by, bw, tSec, cfg);

    // Soft "breathing" glow factor (0..1) → bloom spread.
    const pulse = 0.5 + 0.5 * Math.sin(tSec * cfg.pulseSpeed * Math.PI * 2);
    const pulseScale = 1 - cfg.pulseAmount * 0.5 + cfg.pulseAmount * pulse;
    const glow = cfg.glowBlurFrac * size * pulseScale;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 0;               // don't inherit any outer shadow (e.g. swap)
    ctx.shadowColor = 'transparent';

    // Additive bloom: a few faint, widening strokes that follow the gradient,
    // producing a colored halo without a single flat glow color.
    if (cfg.glowIntensity > 0 && cfg.glowLayers > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = cfg.glowLayers; i >= 1; i--) {
        const f = i / cfg.glowLayers;
        this._roundRectPath(ctx, bx, by, bw, bw, r);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = cfg.opacity * cfg.glowIntensity * 0.18 * f;
        ctx.lineWidth = thickness + glow * f;
        ctx.stroke();
      }
    }

    // Crisp core line on top.
    ctx.globalCompositeOperation = 'source-over';
    this._roundRectPath(ctx, bx, by, bw, bw, r);
    ctx.strokeStyle = grad;
    ctx.globalAlpha = cfg.opacity;
    ctx.lineWidth = thickness;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Build the rotating/scrolling rainbow gradient used by the wild border.
   * 'cycle' uses a conic gradient centered on the tile (colors rotate around
   * the frame); 'scroll' (and the conic-gradient fallback) uses a diagonal
   * linear gradient whose stops flow over time.
   * @private
   */
  _makeWildGradient(ctx, cx, cy, bx, by, bw, tSec, cfg) {
    const hues = WILD_BORDER_HUES;
    const n = hues.length;
    const color = (h) => `hsl(${h}, ${cfg.saturation}%, ${cfg.lightness}%)`;

    if (cfg.mode === 'cycle' && typeof ctx.createConicGradient === 'function') {
      const angle = tSec * cfg.cycleSpeedDeg * Math.PI / 180;
      const g = ctx.createConicGradient(angle, cx, cy);
      for (let i = 0; i <= n; i++) g.addColorStop(i / n, color(hues[i % n]));
      return g;
    }

    // 'scroll' mode (and fallback): diagonal linear gradient, stops shifted by
    // time. Two repeats of the hue cycle so it tiles seamlessly as it flows.
    const g = ctx.createLinearGradient(bx, by, bx + bw, by + bw);
    const offset = (tSec * cfg.scrollSpeed) % 1;
    const reps = 2;
    const total = n * reps;
    for (let i = 0; i <= total; i++) {
      const stop = i / total;
      const hue = hues[((i % n) + Math.round(offset * n)) % n];
      g.addColorStop(stop, color(hue));
    }
    return g;
  }

  /**
   * Trace a rounded-rectangle path (uses native ctx.roundRect when available,
   * else an arcTo fallback). Caller sets stroke/fill state and strokes/fills.
   * @private
   */
  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
