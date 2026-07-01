import UIElement from './UIElement.js';
import { isWild, isMana } from '../game/TileTypes.js';

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
  // DISABLED: superseded by the `wild_tile_border` image overlay
  // (_drawWildTileBorder). The animated rainbow-border code below is retained
  // (inert) for reference / future re-enable — flip this back to `true` AND
  // re-point the wild-tile call sites to `_drawWildBorder` to restore it.
  enabled: false,
  // 'cycle'  → colors rotate smoothly around the frame (conic gradient).
  // 'scroll' → a multicolor gradient flows diagonally across the frame.
  mode: 'cycle',
  thicknessFrac: 0.055,     // border line thickness, fraction of cell size
  minThickness: 1.5,        // px floor so it stays visible on small boards
  insetFrac: 0.015,         // gap from the cell edge (keeps the line on the tile edge)
  cornerRadiusFrac: 0.17,   // rounded-corner radius, fraction of cell size
  opacity: 0.8,            // overall border opacity (0–1)
  saturation: 95,           // HSL saturation % of the rainbow colors
  lightness: 58,            // HSL lightness % of the rainbow colors
  cycleSpeedDeg: 75,        // 'cycle': degrees/sec the colors rotate (loops continuously)
  scrollSpeed: 0.2,        // 'scroll': gradient offsets/sec (loops at 1.0)
  glowIntensity: 1.0,       // bloom strength multiplier (0 = no glow)
  glowBlurFrac: 0.07,       // bloom spread, fraction of cell size
  glowLayers: 2,            // # of additive bloom strokes (more = softer/heavier)
  pulseSpeed: 1,          // glow "breathing" cycles/sec
  pulseAmount: 1,         // 0 = steady glow, 1 = full breathing range
};

/**
 * Board-shuffle (SHUFFLE skill) fly-in animation tunables. After the model
 * reshuffles, every tile flies in from a random offset, scaling + fading up to
 * its cell. Distances/scales are in CELL-SIZE units so they're resolution
 * independent; per-tile start delays are staggered for a cascading reveal.
 */
const SHUFFLE_ANIM_DUR = 440;        // ms for a single tile to settle
const SHUFFLE_STAGGER = 180;         // ms spread of per-tile start delays
const SHUFFLE_MIN_DIST = 1.2;        // start offset (cell-size units)
const SHUFFLE_MAX_DIST = 3.6;
const SHUFFLE_MIN_START_SCALE = 0.22;
const SHUFFLE_MAX_START_SCALE = 0.45;

/**
 * The five mana colors as HSL hues, in spectral order so the rotation reads as
 * a smooth rainbow: red → yellow → green → blue → purple. Saturation/lightness
 * come from WILD_BORDER_CONFIG.
 */
const WILD_BORDER_HUES = [0, 55, 120, 220, 285];

/**
 * Wild (Thrall) tile overlay: the `wild_tile_border` frame image is drawn
 * centered over the tile, scaled slightly LARGER than the cell so it encompasses
 * the tile art (matches the reference mock). 1.0 = exact cell size.
 */
const WILD_TILE_BORDER_SCALE = 1.22;

/**
 * Subtle "flex" (breathing) animation for the wild-tile border: the frame's
 * scale gently oscillates around WILD_TILE_BORDER_SCALE so the overlay feels
 * alive. amplitude is a FRACTION of the base scale (0.04 = ±4%); speedHz is
 * full pulse cycles per second. Set amplitude to 0 to disable.
 */
const WILD_TILE_BORDER_FLEX = {
  amplitude: 0, // 0.045,
  speedHz: 0.7,
};

/**
 * Board "sleeping" idle glint/sheen.
 *
 * While the board is IDLE (no cascade / swap / shuffle / targeting), every few
 * seconds 1–2 random mana tiles get a brief diagonal sheen sweep so the board
 * feels alive at rest. Purely cosmetic — never touches the model or layout.
 *
 * Flip `enabled` to false to disable the whole effect (the update + render both
 * early-out, so a disabled glint costs nothing). All timings/look are tunable
 * here. Mana tiles only (skull/disease/wild are excluded via isMana).
 */
const IDLE_GLINT_CONFIG = {
  enabled: true,            // master flag — set false to disable idle glints
  intervalMinMs: 2200,      // min delay between glint bursts
  intervalMaxMs: 4800,      // max delay between glint bursts
  minTiles: 1,              // tiles glinted per burst (inclusive range)
  maxTiles: 2,
  durationMs: 850,          // length of a single tile's sheen sweep
  widthFrac: 0.42,          // sheen band width, fraction of cell size
  angleDeg: -35,            // sweep direction (degrees)
  maxAlpha: 0.45,           // peak sheen opacity (fades in then out)
};

/**
 * Match-4+ emphasis "flourish" (decision #42). When a 4+ match grants an extra
 * turn, the controller freezes the board for a brief beat (per-side duration) and
 * publishes `match4Flourish`. During that beat the whole board darkens and the
 * matched 4+ tiles are redrawn ON TOP, lit by a soft warm radial BLOOM (which
 * blends across the group) + a hot core, and the tile art itself is brightened,
 * before cascades continue. The beat length comes from the controller; the LOOK
 * is tuned here.
 */
const MATCH4_FLOURISH = {
  darkenAlpha: 0.62,       // peak darkness of the full-board overlay
  darkenRampFrac: 0.3,     // fraction of the beat spent fading the punch IN
  rampOutFrac: 0.4,        // fraction of the beat spent fading the punch OUT
  // Tiles are NOT scaled by default — a per-tile grow makes adjacent matched
  // tiles overlap. The "pop" comes from the bloom growing in instead. Raise
  // only if your tile art has enough internal padding to absorb it (>~0.1
  // overlaps neighbors).
  growScale: 0.0,
  // Additive radial bloom around each matched tile (overlapping radials blend
  // into one continuous warm glow across the whole matched group).
  bloomRadiusFrac: 1.25,   // outer bloom radius at peak, fraction of cell size
  bloomInnerFrac: 0.45,    // radius held near full-color before the falloff
  bloomAlpha: 0.9,         // peak bloom strength
  bloomStartScale: 0.55,   // bloom radius scale at env=0 → grows to 1 at peak
  // Hot white-ish core for the "brightest frame" pop.
  coreRadiusFrac: 0.62,    // core radius at peak, fraction of cell size
  coreAlpha: 0.4,          // peak core strength
  // Brighten the tile art itself (additive sprite-over-sprite — glows on the
  // tile SHAPE, not a boxy square).
  tileBrightenAlpha: 0.5,
};

/** Vivid per-type glow colors for the match-4 flourish (kept in sync as RGB). */
const MATCH4_GLOW_COLORS = {
  red: '255,90,74', blue: '90,155,255', green: '90,214,90', yellow: '255,206,74',
  purple: '197,107,255', skull: '220,220,220', thrall: '255,90,74', disease: '194,209,90',
};

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

    // Match-4+ emphasis flourish (set by BattleScene each frame; self-timed).
    /** @type {{cells:Array<{col:number,row:number}>, color:string, side:string, durationMs:number}|null} */
    this.match4Flourish = null;
    this._flourishRef = null;   // identity of the active flourish (reset detect)
    this._flourishTime = 0;     // ms elapsed since the current flourish started

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

    // Board-shuffle fly-in animation (purely cosmetic; the model is already
    // reshuffled). { time, offsets: Map<"col,row", {dx,dy,startScale,delay}> }
    this._shuffleAnim = null;

    // Idle "sleeping" glints (cosmetic sheen on resting mana tiles).
    /** @type {Array<{col:number,row:number,t:number}>} */
    this._idleGlints = [];
    this._glintTimer = this._rollGlintInterval();

    if (!boardModel) this._generatePlaceholder();
  }

  /**
   * Start the board-shuffle fly-in animation over the (already reshuffled)
   * board. Each occupied cell gets a random start offset/scale/delay so tiles
   * cascade into place. Idempotent-ish — a new call restarts the animation.
   */
  playShuffleAnimation() {
    const offsets = new Map();
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (!this.getTileAt(row, col)) continue;
        const angle = Math.random() * Math.PI * 2;
        const dist = SHUFFLE_MIN_DIST + Math.random() * (SHUFFLE_MAX_DIST - SHUFFLE_MIN_DIST);
        offsets.set(`${col},${row}`, {
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          startScale: SHUFFLE_MIN_START_SCALE + Math.random() * (SHUFFLE_MAX_START_SCALE - SHUFFLE_MIN_START_SCALE),
          delay: Math.random() * SHUFFLE_STAGGER,
        });
      }
    }
    this._shuffleAnim = { time: 0, offsets };
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
    if (this._shuffleAnim) {
      this._shuffleAnim.time += dt;
      if (this._shuffleAnim.time >= SHUFFLE_ANIM_DUR + SHUFFLE_STAGGER) {
        this._shuffleAnim = null;
      }
    }
    // Match-4+ emphasis flourish timer: reset when a new flourish appears
    // (reference change), advance while it's active, clear when gone.
    if (this.match4Flourish) {
      if (this.match4Flourish !== this._flourishRef) {
        this._flourishRef = this.match4Flourish;
        this._flourishTime = 0;
      } else {
        this._flourishTime += dt;
      }
    } else {
      this._flourishRef = null;
      this._flourishTime = 0;
    }
    this._updateIdleGlints(dt);
    super.update(dt);
  }

  // ── Idle "sleeping" glints ────────────────────────────

  /** Random delay (ms) until the next glint burst. @private */
  _rollGlintInterval() {
    const c = IDLE_GLINT_CONFIG;
    return c.intervalMinMs + Math.random() * (c.intervalMaxMs - c.intervalMinMs);
  }

  /** True when the board is at rest (nothing animating/targeting). @private */
  _isBoardIdle() {
    return this.highlightCells.length === 0
      && this.emptyCells.length === 0
      && this.fallCells.length === 0
      && !this.swapAnim
      && !this._shuffleAnim
      && !(this.targetingOverlayCells && this.targetingOverlayCells.length > 0);
  }

  /**
   * Advance active glints and, while the board is idle, periodically spawn a
   * new burst. Glints are cleared (and the timer reset) whenever the board is
   * animating, so the sheen only ever appears at rest. @private
   */
  _updateIdleGlints(dt) {
    if (!IDLE_GLINT_CONFIG.enabled) {
      if (this._idleGlints.length) this._idleGlints = [];
      return;
    }
    if (!this._isBoardIdle()) {
      if (this._idleGlints.length) this._idleGlints = [];
      this._glintTimer = this._rollGlintInterval();
      return;
    }
    if (this._idleGlints.length) {
      for (const g of this._idleGlints) g.t += dt;
      this._idleGlints = this._idleGlints.filter(g => g.t < IDLE_GLINT_CONFIG.durationMs);
    }
    this._glintTimer -= dt;
    if (this._glintTimer <= 0) {
      this._spawnIdleGlints();
      this._glintTimer = this._rollGlintInterval();
    }
  }

  /** Pick 1–2 random resting mana tiles to glint. @private */
  _spawnIdleGlints() {
    const c = IDLE_GLINT_CONFIG;
    const cells = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const t = this.getTileAt(row, col);
        if (t && isMana(t)) cells.push({ col, row });
      }
    }
    if (!cells.length) return;
    const active = new Set(this._idleGlints.map(g => `${g.col},${g.row}`));
    const n = c.minTiles + Math.floor(Math.random() * (c.maxTiles - c.minTiles + 1));
    for (let i = 0; i < n && cells.length; i++) {
      const cell = cells.splice(Math.floor(Math.random() * cells.length), 1)[0];
      const key = `${cell.col},${cell.row}`;
      if (active.has(key)) continue;
      active.add(key);
      this._idleGlints.push({ col: cell.col, row: cell.row, t: 0 });
    }
  }

  /**
   * Draw the active idle glints: a bright diagonal sheen band sweeping across
   * each glinting tile, clipped to the cell, additive, fading in then out.
   * @private
   */
  _renderIdleGlints(ctx, ox, oy, cs) {
    const c = IDLE_GLINT_CONFIG;
    if (!c.enabled || this._idleGlints.length === 0) return;
    for (const g of this._idleGlints) {
      const colorKey = this.getTileAt(g.row, g.col);
      if (!colorKey || !isMana(colorKey)) continue; // tile changed/cleared
      const p = g.t / c.durationMs;
      if (p < 0 || p >= 1) continue;
      const alpha = Math.sin(p * Math.PI) * c.maxAlpha; // fade in → out
      if (alpha <= 0) continue;

      const x = ox + g.col * cs;
      const y = oy + g.row * cs;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cs, cs);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.translate(x + cs / 2, y + cs / 2);
      ctx.rotate(c.angleDeg * Math.PI / 180);
      const diag = cs * 1.5;                 // covers the rotated cell fully
      const pos = -diag + p * 2 * diag;      // sweep position along local x
      const bandW = cs * c.widthFrac;
      const grad = ctx.createLinearGradient(pos - bandW, 0, pos + bandW, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-diag, -diag, diag * 2, diag * 2);
      ctx.restore();
    }
  }

  /**
   * Match-4+ emphasis flourish (decision #42): darken the whole board, lay down
   * a soft warm radial BLOOM behind the matched 4+ tiles (overlapping radials
   * blend into one continuous glow across the group), then redraw the tiles ON
   * TOP (crisp, in their cells — no overlap) with their art additively
   * brightened. Self-timed off `_flourishTime`; the controller holds SHOW_MATCH
   * open for the same beat so cascades don't continue yet.
   * @private
   */
  _renderMatch4Flourish(ctx, ox, oy, cs) {
    const f = this.match4Flourish;
    if (!f || !f.cells || f.cells.length === 0) return;

    const cfg = MATCH4_FLOURISH;
    const dur = f.durationMs > 0 ? f.durationMs : 100;
    const p = Math.max(0, Math.min(1, this._flourishTime / dur));

    // Envelope: a quick punch (fade in → brief hold → fade out) that lives
    // ENTIRELY within the freeze beat, so the normal highlighted board resumes
    // for the rest of SHOW_MATCH. Not a lingering dim — "just enough to register".
    const rampIn = cfg.darkenRampFrac;
    const rampOut = cfg.rampOutFrac;
    let env;
    if (p < rampIn) env = p / rampIn;
    else if (p > 1 - rampOut) env = (1 - p) / rampOut;
    else env = 1;
    if (env <= 0) return;

    const boardW = cs * this.cols;
    const boardH = cs * this.rows;

    // Precompute per-cell center + glow color once (reused across passes).
    const items = f.cells.map((pos) => {
      const colorKey = this.getTileAt(pos.row, pos.col) || f.color;
      return {
        colorKey,
        rgb: MATCH4_GLOW_COLORS[colorKey] || '255,255,255',
        cx: ox + pos.col * cs + cs / 2,
        cy: oy + pos.row * cs + cs / 2,
      };
    });

    ctx.save();

    // 1. Darken the entire board.
    ctx.fillStyle = `rgba(0,0,0,${env * cfg.darkenAlpha})`;
    ctx.fillRect(ox, oy, boardW, boardH);

    // 2. Additive warm BLOOM behind the tiles (grows in with env; overlapping
    //    radials merge into one soft glow across the matched group).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = cs * cfg.bloomRadiusFrac * (cfg.bloomStartScale + (1 - cfg.bloomStartScale) * env);
    for (const it of items) {
      const g = ctx.createRadialGradient(it.cx, it.cy, cs * 0.08, it.cx, it.cy, bloomR);
      g.addColorStop(0, `rgba(${it.rgb},${cfg.bloomAlpha * env})`);
      g.addColorStop(cfg.bloomInnerFrac, `rgba(${it.rgb},${cfg.bloomAlpha * env * 0.45})`);
      g.addColorStop(1, `rgba(${it.rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(it.cx - bloomR, it.cy - bloomR, bloomR * 2, bloomR * 2);
    }
    // Hot white-ish core for the "brightest frame" pop.
    const coreR = cs * cfg.coreRadiusFrac * env;
    if (coreR > 0) {
      for (const it of items) {
        const g = ctx.createRadialGradient(it.cx, it.cy, 0, it.cx, it.cy, coreR);
        g.addColorStop(0, `rgba(255,250,235,${cfg.coreAlpha * env})`);
        g.addColorStop(1, 'rgba(255,250,235,0)');
        ctx.fillStyle = g;
        ctx.fillRect(it.cx - coreR, it.cy - coreR, coreR * 2, coreR * 2);
      }
    }
    ctx.restore();

    // 3. Redraw the matched tiles on top (restores them from the darken) and
    //    brighten the art itself with an additive sprite-over-sprite pass.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const scale = 1 + cfg.growScale * env;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const drawCs = cs * scale;
      const dx = it.cx - drawCs / 2;
      const dy = it.cy - drawCs / 2;
      const img = this._assetManager ? this._assetManager.get(`tile_${it.colorKey}`) : null;
      if (img) {
        if (scale !== 1) ctx.imageSmoothingEnabled = true;  // smooth when scaled
        ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, drawCs, drawCs);
        ctx.imageSmoothingEnabled = prevSmoothing;
        // Additive brighten — glows on the tile SHAPE, not a boxy square.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = cfg.tileBrightenAlpha * env;
        ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, drawCs, drawCs);
        ctx.restore();
      } else {
        ctx.fillStyle = `rgb(${it.rgb})`;
        ctx.fillRect(dx, dy, drawCs, drawCs);
      }
      // Any wild frame overlay follows the tile.
      if (isWild(it.colorKey)) this._drawWildTileBorder(ctx, dx, dy, drawCs);
    }
    ctx.imageSmoothingEnabled = prevSmoothing;

    ctx.restore();
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
    // Wild (Thrall) borders are deferred to a pass AFTER all tiles are drawn —
    // the frame overhangs the cell, so drawing it inline would let later-drawn
    // neighbor tiles clip its right/bottom edge.
    const wildBorders = [];
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

        // Board-shuffle fly-in: offset/scale/fade each tile toward its cell.
        let drawX = displayX, drawY = displayY, drawCs = cs, tileAlpha = 1;
        const sa = this._shuffleAnim;
        if (sa) {
          const o = sa.offsets.get(key);
          if (o) {
            const local = Math.max(0, Math.min(1, (sa.time - o.delay) / SHUFFLE_ANIM_DUR));
            const e = 1 - Math.pow(1 - local, 3); // easeOutCubic
            const inv = 1 - e;
            drawCs = cs * (o.startScale + (1 - o.startScale) * e);
            const cx = displayX + cs / 2 + o.dx * cs * inv;
            const cy = displayY + cs / 2 + o.dy * cs * inv;
            drawX = cx - drawCs / 2;
            drawY = cy - drawCs / 2;
            tileAlpha = Math.max(0, Math.min(1, e * 1.4));
          }
        }

        const prevAlpha = ctx.globalAlpha;
        if (tileAlpha < 1) ctx.globalAlpha = prevAlpha * tileAlpha;

        // Tile sprite
        const assetKey = `tile_${colorKey}`;
        const tileImg = this._assetManager ? this._assetManager.get(assetKey) : null;
        if (tileImg) {
          ctx.drawImage(tileImg, 0, 0, tileImg.width, tileImg.height, drawX, drawY, drawCs, drawCs);
        } else {
          ctx.fillStyle = fallbackColors[colorKey] || '#444';
          ctx.fillRect(drawX + 1, drawY + 1, drawCs - 2, drawCs - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(drawX + 1, drawY + 1, drawCs - 2, (drawCs - 2) * 0.3);
        }

        // Cell border
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(drawX, drawY, drawCs, drawCs);

        if (tileAlpha < 1) ctx.globalAlpha = prevAlpha;

        // Wild (Thrall) tiles: `wild_tile_border` frame overlay (slightly larger
        // than the tile). Deferred to after the tile loop (see wildBorders).
        // Follows the tile (incl. fall + shuffle transform) via drawX/drawY/drawCs.
        if (isWild(colorKey)) {
          wildBorders.push({ x: drawX, y: drawY, cs: drawCs });
        }

        // Locked tiles (woven `lock`): the `locked_tile` frame overlay. Data-
        // driven off the board model so it appears/clears with the lock. See decision #40.
        if (this._boardModel && this._boardModel.isColorLocked(colorKey)) {
          const prevA = ctx.globalAlpha;
          if (tileAlpha < 1) ctx.globalAlpha = prevA * tileAlpha;
          this._drawLockedTileOverlay(ctx, drawX, drawY, drawCs, this._boardModel.getLockTurns(colorKey));
          if (tileAlpha < 1) ctx.globalAlpha = prevA;
        }
      }
    }

    // Wild-tile border pass — on top of all tiles so the overhanging frame
    // isn't clipped by neighbors.
    for (const b of wildBorders) {
      this._drawWildTileBorder(ctx, b.x, b.y, b.cs != null ? b.cs : cs);
    }

    // Idle "sleeping" glints — sheen sweep on resting mana tiles (only spawns
    // while the board is idle; see _updateIdleGlints).
    this._renderIdleGlints(ctx, ox, oy, cs);

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

    // ── Match-4+ emphasis flourish (darken board + grow/glow matched tiles) ──
    this._renderMatch4Flourish(ctx, ox, oy, cs);

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
        // Keep the wild tile border on Thrall tiles while they swap.
        if (isWild(typeKey)) this._drawWildTileBorder(ctx, x, y, cs);
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

  // ── Locked tile overlay (woven `lock`) ────────────────

  /**
   * Draw the `locked_tile` frame image over a locked tile at (x, y) with side
   * `size`, sized to the cell, plus a white "turns remaining" number badge.
   * Drawn with high-quality smoothing (detailed art). No-op if the sprite is
   * missing. See decision #40.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y @param {number} size
   * @param {number} [turns] turns remaining (drawn as a white badge if > 0)
   */
  _drawLockedTileOverlay(ctx, x, y, size, turns = 0) {
    if (size <= 0) return;
    const img = this._assetManager ? this._assetManager.get('locked_tile') : null;
    if (img) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, img.width, img.height, Math.round(x), Math.round(y), size, size);
      ctx.restore();
    }
    // White turns-remaining badge, centered, with a dark outline for legibility
    // over the tile + lock art.
    if (turns > 0) {
      const fs = Math.max(10, Math.round(size * 0.34));
      const cx = x + size / 2;
      const cy = y + size / 2;
      ctx.save();
      ctx.font = `bold ${fs}px "MarcellusSC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, fs * 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = Math.max(2, fs * 0.15);
      ctx.strokeText(String(turns), cx, cy);
      ctx.shadowBlur = 0;
      ctx.fillText(String(turns), cx, cy);
      ctx.restore();
    }
  }

  // ── Wild (Thrall) tile border overlay ─────────────────

  /**
   * Draw the `wild_tile_border` frame image over a wild (Thrall) tile, centered
   * on the tile at (x, y) with side length `size` and scaled slightly larger
   * (WILD_TILE_BORDER_SCALE) so it encompasses the tile art. Self-contained;
   * never mutates tile size/position. Follows fall + swap animation since it
   * uses the same display coords as the tile. Falls back to the legacy rainbow
   * border only if the image asset is missing.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - tile top-left X (design space)
   * @param {number} y - tile top-left Y (design space)
   * @param {number} size - tile side length (px)
   */
  _drawWildTileBorder(ctx, x, y, size) {
    if (size <= 0) return;
    const img = this._assetManager ? this._assetManager.get('wild_tile_border') : null;
    if (!img) {
      // Image missing — fall back to the retained rainbow border so wild tiles
      // still read as "match-anything".
      this._drawWildBorder(ctx, x, y, size);
      return;
    }
    // Optional subtle "flex" (breathing) pulse around the base scale. When the
    // amplitude is 0 (disabled) the ENTIRE block is skipped — no time sampling,
    // no trig — so a disabled flex costs nothing beyond the static draw.
    let scale = WILD_TILE_BORDER_SCALE;
    const flex = WILD_TILE_BORDER_FLEX;
    if (flex.amplitude) {
      // RELATIVE time base — feeding raw Date.now() (~1.7e9) into sin() wrecks
      // float precision and makes the motion stutter, so anchor at first draw.
      if (this._wildAnimT0 == null) this._wildAnimT0 = Date.now();
      const tSec = (Date.now() - this._wildAnimT0) / 1000;
      scale *= 1 + Math.sin(tSec * flex.speedHz * Math.PI * 2) * flex.amplitude;
    }

    // The board renders with imageSmoothingEnabled=false so the pixel-aligned
    // tile sprites stay crisp. The wild frame, however, is a DETAILED ornate
    // image drawn at a SCALED (fractional) size — nearest-neighbour resampling
    // of that into a non-integer rect is what makes it look fuzzy/aliased. So
    // enable high-quality smoothing just for this draw (then restore). The
    // top-left is pixel-aligned; drawSize stays fractional so the flex is smooth.
    const drawSize = size * scale;
    const offset = (drawSize - size) / 2; // center the larger frame over the tile
    const dx = Math.round(x - offset);
    const dy = Math.round(y - offset);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, drawSize, drawSize);
    ctx.restore();
  }

  // ── Wild (Thrall) rainbow border (DISABLED — retained for reference) ──

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

    // Use a RELATIVE time base. Date.now()/1000 is ~1.75e9, and feeding numbers
    // that large into the gradient/angle math wrecks float precision, making the
    // motion snap/stutter instead of flowing. Anchoring the clock at first draw
    // keeps tSec small (seconds since start) so the animation stays smooth.
    if (this._wildAnimT0 == null) this._wildAnimT0 = Date.now();
    const tSec = (Date.now() - this._wildAnimT0) / 1000;

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
   * linear gradient whose colors flow continuously over time.
   * @private
   */
  _makeWildGradient(ctx, cx, cy, bx, by, bw, tSec, cfg) {
    const hues = WILD_BORDER_HUES;
    const n = hues.length;
    const color = (h) => `hsl(${((h % 360) + 360) % 360}, ${cfg.saturation}%, ${cfg.lightness}%)`;

    if (cfg.mode === 'cycle' && typeof ctx.createConicGradient === 'function') {
      // Normalize the angle to one revolution so the value stays small/precise.
      const period = 360 / Math.max(0.0001, cfg.cycleSpeedDeg); // sec per revolution
      const angle = ((tSec / period) % 1) * Math.PI * 2;
      const g = ctx.createConicGradient(angle, cx, cy);
      for (let i = 0; i <= n; i++) g.addColorStop(i / n, color(hues[i % n]));
      return g;
    }

    // 'scroll' mode (and conic fallback): a smoothly flowing linear gradient.
    // Colors are sampled by CONTINUOUS interpolation around the hue ring (no
    // discrete stepping), and the whole ring is offset over time so it flows.
    const g = ctx.createLinearGradient(bx, by, bx + bw, by + bw);
    const reps = 2;     // hue cycles across the diagonal
    const STOPS = 24;   // sampling resolution (higher = smoother)
    const offset = (tSec * cfg.scrollSpeed) % 1;
    for (let i = 0; i <= STOPS; i++) {
      const p = i / STOPS;
      const ringPos = (p * reps + offset) % 1; // continuous position around the ring
      g.addColorStop(p, color(this._ringHue(ringPos)));
    }
    return g;
  }

  /**
   * Interpolated hue (degrees) at a continuous position t in [0,1) around the
   * 5-color ring, taking the short "forward" path across the red↔purple wrap so
   * the rainbow flows smoothly rather than jumping.
   * @private
   */
  _ringHue(t) {
    const hues = WILD_BORDER_HUES;
    const n = hues.length;
    const x = (((t % 1) + 1) % 1) * n; // [0, n)
    const i0 = Math.floor(x) % n;
    const i1 = (i0 + 1) % n;
    const frac = x - Math.floor(x);
    let h0 = hues[i0];
    let h1 = hues[i1];
    if (h1 < h0) h1 += 360; // forward direction around the wheel
    return h0 + (h1 - h0) * frac;
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
