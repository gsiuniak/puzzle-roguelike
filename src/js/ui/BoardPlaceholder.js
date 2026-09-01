import UIElement from './UIElement.js';
import { isWild, isMana, isFungal, fungalTimer } from '../game/TileTypes.js';
// Shared fall kinematics (rigid shared gravity + landing bounce). The law
// lives in BattleController so the FALL phase length and this view's
// animation can never disagree; FALL_TUNING is live-tunable via ?falltune.
import { fallTimeToLandMs, fallRowsFallen, FALL_TUNING } from '../game/BattleController.js';

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
// Fallback tile fills while the sprite sheet streams in (module constant —
// this literal used to be rebuilt every renderSelf call).
const FALLBACK_TILE_COLORS = {
  red: '#cc3333', blue: '#3366cc', green: '#33aa33',
  yellow: '#cccc33', purple: '#9933cc', skull: '#555555',
  disease: '#7d8a3a', thrall: '#b0392f',
};

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
 * here.
 *
 * TWO MODES (see _spawnIdleGlints):
 *   - Default (no provider): 1–2 RANDOM mana tiles glint per burst
 *     (skull/disease/wild excluded via isMana).
 *   - HINT mode: when a host wires `setIdleGlintProvider(fn)` (BattleScene does,
 *     backed by the MoveAdvisor suggestion), each burst glints exactly ONE tile
 *     of the suggested swap — a gentle nudge after a pause on the player's
 *     turn. The provider returning null (not the player's turn, no move)
 *     suppresses the burst entirely; there is NO random fallback. Provider
 *     glints may sit on any tile type (a suggested swap can move a skull).
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
  // Matched tiles pop up by this fraction over cell size at peak (rides `env`,
  // so they grow in → hold → settle back). The whole group scales about its
  // centroid — tiles shift outward as they grow — so they NEVER overlap each
  // other however big this is; they only bulge over the surrounding darkened
  // non-matched tiles (which reads fine). Bump for a punchier pop.
  growScale: 0.18,
  // Slight overshoot on the pop for punch (easeOutBack strength; 0 = linear).
  popOvershoot: 1.7,
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
  // "Sekiro parry" flash (EXPERIMENTAL — flip `enabled` to kill it): a sharp
  // near-white flare + expanding shockwave ring + thin glint streaks bursting
  // from the matched group's centroid. Own sharper timing curve (brightest on
  // frame 1, dissipated by `spanFrac` of the beat) rather than the darken env,
  // so it reads as an instant deflect-spark. Drawn topmost (over the popped
  // tiles) in the 'tiles' phase, additive, no shadowBlur.
  parryFlash: {
    enabled: true,
    spanFrac: 1.0,         // fraction of the freeze beat the flash lives in
    color: '255,248,228',  // warm near-white
    centerColor: '255,255,255', // hottest flare-center color
    coreRadiusFrac: 1.5,   // flare radius at full spread (× cell size)
    coreAlpha: 0.95,       // flare strength on frame 1 (decays quadratically)
    ringEndFrac: 3.4,      // shockwave ring radius at full spread (× cell size)
    ringWidthFrac: 0.3,    // ring half-thickness at birth (× cell size, thins)
    ringAlpha: 0.85,       // ring strength (fades with the flash)
    streaks: 4,            // glint streak count (0 = none)
    streakAngleDeg: 22,    // rotation of the streak fan
    streakLenFrac: 2.8,    // streak tip reach at full stretch (× cell size)
    streakWidthFrac: 0.1,  // streak half-width at the base (× cell size)
    streakAlpha: 0.8,      // streak strength (fades with the flash)
    // Per-side override merged over the base when the flourish is the ENEMY's:
    // slightly toned down and shifted toward red (a hostile deflect-spark).
    enemy: {
      color: '255,120,96',
      centerColor: '255,214,200',
      coreRadiusFrac: 1.3,
      coreAlpha: 0.8,
      ringEndFrac: 2.9,
      ringAlpha: 0.7,
      streakLenFrac: 2.3,
      streakAlpha: 0.65,
    },
  },
};

/** Vivid per-type glow colors for the match-4 flourish (kept in sync as RGB). */
const MATCH4_GLOW_COLORS = {
  red: '255,90,74', blue: '90,155,255', green: '90,214,90', yellow: '255,206,74',
  purple: '197,107,255', skull: '220,220,220', thrall: '255,90,74', disease: '194,209,90',
};

// ── Baked flourish glow sprites ─────────────────────────────────────────────
// The match-4 flourish used to build 2 radial gradients PER matched tile PER
// FRAME (bloom + core, plus the parry flare) for the whole freeze beat —
// gradient construction + gradient fills are slow on mobile Canvas2D. Each
// look is instead baked ONCE (module cache, a handful of colors) and drawn as
// a scaled additive blit with globalAlpha carrying the animated intensity
// (all the gradients' alpha stops scale by one common factor, so this is
// visually identical). Same idiom as TileParticleEffect/ManaStreamEffect.
const FLOURISH_SPRITE_R = 96;
const _flourishSpriteCache = new Map(); // `${kind}|${key}` → canvas

/**
 * kind: 'bloom' (key = 'r,g,b')            — warm tile bloom, stops 1 → 0.45 → 0
 *       'core'  (key = '')                 — white-ish hot center, 1 → 0
 *       'flare' (key = 'centerRGB|mainRGB') — parry-flash flare, 1 → 0.7 → 0
 */
function _getFlourishSprite(kind, key) {
  const cacheKey = kind + '|' + key;
  let cv = _flourishSpriteCache.get(cacheKey);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = FLOURISH_SPRITE_R * 2;
  const c = cv.getContext('2d');
  const r = FLOURISH_SPRITE_R;
  let g;
  if (kind === 'bloom') {
    g = c.createRadialGradient(r, r, r * 0.08, r, r, r);
    g.addColorStop(0, `rgba(${key},1)`);
    g.addColorStop(MATCH4_FLOURISH.bloomInnerFrac, `rgba(${key},0.45)`);
    g.addColorStop(1, `rgba(${key},0)`);
  } else if (kind === 'core') {
    g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
  } else { // 'flare'
    const [center, main] = key.split('|');
    g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, `rgba(${center},1)`);
    g.addColorStop(0.35, `rgba(${main},0.7)`);
    g.addColorStop(1, `rgba(${main},0)`);
  }
  c.fillStyle = g;
  c.fillRect(0, 0, FLOURISH_SPRITE_R * 2, FLOURISH_SPRITE_R * 2);
  _flourishSpriteCache.set(cacheKey, cv);
  return cv;
}

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
    // Fall ANIMATION duration. BattleScene syncs this to the controller's
    // real FALL phase via setFallDurationMs() — now PER FRAME (the phase is
    // sized per step to its longest fall); the raw 350 default only applies
    // when no controller is wired (placeholder boards).
    this._fallDuration = 350;
    // Fall-kinematics inputs: the current step's animation array (a
    // reference-change detector) + the step's total base-ms length (last
    // tile's propagation delay + travel + bounce — mirrors _doFall's math).
    this._fallCellsRef = null;
    this._fallTotalBaseMs = 0;

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

  /** Sync the fall animation to the controller's actual FALL phase length. */
  setFallDurationMs(ms) {
    if (ms > 0) this._fallDuration = ms;
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
      // Cache the step's longest fall distance (the kinematics anchor) —
      // recomputed only when the controller hands over a NEW step's array.
      if (this.fallCells !== this._fallCellsRef) {
        this._fallCellsRef = this.fallCells;
        // The step's total base length = its last-finishing tile (delay +
        // travel) + bounce — the SAME math as BattleController._doFall, so
        // progress × this is exact base-time elapsed.
        let m = fallTimeToLandMs(1);
        for (const f of this.fallCells) {
          const t = (f.delayIdx || 0) * FALL_TUNING.propagationMs
            + fallTimeToLandMs(f.row - f.startRow);
          if (t > m) m = t;
        }
        this._fallTotalBaseMs = m + FALL_TUNING.bounceMs;
      }
      this._fallProgress = Math.min(1, this._fallProgress + dt / this._fallDuration);
    } else {
      this._fallProgress = 0;
      this._fallCellsRef = null;
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

  /**
   * Supply a hint provider for the idle glint: a function returning the ONE
   * board cell to glint ({col,row}) or null to suppress the burst (e.g. not
   * the player's turn). While set, random-tile glinting is replaced entirely.
   * Called lazily — only when a burst is due on an idle board — so an
   * expensive provider (the MoveAdvisor) runs at most once per interval.
   * @param {(() => ({col:number,row:number}|null))|null} fn
   */
  setIdleGlintProvider(fn) {
    this._idleGlintProvider = typeof fn === 'function' ? fn : null;
  }

  /**
   * Spawn a glint burst: the provider's single hint tile when a provider is
   * wired (see setIdleGlintProvider), else 1–2 random resting mana tiles.
   * @private
   */
  _spawnIdleGlints() {
    const c = IDLE_GLINT_CONFIG;

    // HINT mode — glint exactly one tile of the suggested move; no burst at
    // all when the provider has nothing (not the player's turn, no move).
    if (this._idleGlintProvider) {
      const cell = this._idleGlintProvider();
      if (!cell) return;
      if (!this.getTileAt(cell.row, cell.col)) return; // cell empty/out of range
      // `any: true` — a suggested swap may move a skull; render it anyway.
      this._idleGlints.push({ col: cell.col, row: cell.row, t: 0, any: true });
      return;
    }

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
      // Tile changed/cleared → skip. Provider (hint) glints may sit on any
      // tile type; random glints stay mana-only.
      if (!colorKey || (!g.any && !isMana(colorKey))) continue;
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
   *
   * Two-phase split (for the board-frame overlay): `phase` = 'darken' draws
   * only the board darken (belongs UNDER the frame overlay so the rails don't
   * dim), 'tiles' draws only the bloom + grown/brightened tiles (drawn ABOVE
   * the frame overlay via renderFlourishOverlay so emerging tiles pop over the
   * rails), 'all' (default) draws both for standalone use.
   * @private
   */
  _renderMatch4Flourish(ctx, ox, oy, cs, phase = 'all') {
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
        cx: ox + pos.col * cs + cs / 2,   // rest center
        cy: oy + pos.row * cs + cs / 2,
      };
    });

    // Group centroid — the whole matched cluster POPS about this point: each
    // tile both grows AND shifts outward from the centroid by the same factor,
    // so the group scales as one rigid unit and tiles never overlap each other
    // (only the surrounding darkened non-matched tiles, which is fine). The
    // "pop" rides `env` through an easeOutBack overshoot (punch up → settle;
    // returns to 1 at env=0, so nothing clips at rest).
    let gx = 0, gy = 0;
    for (const it of items) { gx += it.cx; gy += it.cy; }
    gx /= items.length; gy /= items.length;
    const c1 = cfg.popOvershoot;
    const pop = 1 + (c1 + 1) * Math.pow(env - 1, 3) + c1 * Math.pow(env - 1, 2);
    const scale = 1 + cfg.growScale * pop;
    for (const it of items) {
      it.dcx = gx + (it.cx - gx) * scale;   // grown/spread center
      it.dcy = gy + (it.cy - gy) * scale;
    }

    ctx.save();

    // 1. Darken the entire board (the UNDER-frame phase).
    if (phase !== 'tiles') {
      ctx.fillStyle = `rgba(0,0,0,${env * cfg.darkenAlpha})`;
      ctx.fillRect(ox, oy, boardW, boardH);
    }
    if (phase === 'darken') {
      ctx.restore();
      return;
    }

    // 2. Additive warm BLOOM behind the tiles (grows in with env; overlapping
    //    radials merge into one soft glow across the matched group). Baked
    //    sprites + globalAlpha — no per-frame gradient construction.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    const baseAlpha = ctx.globalAlpha;
    const bloomR = cs * cfg.bloomRadiusFrac * (cfg.bloomStartScale + (1 - cfg.bloomStartScale) * env);
    ctx.globalAlpha = baseAlpha * cfg.bloomAlpha * env;
    for (const it of items) {
      const sprite = _getFlourishSprite('bloom', it.rgb);
      ctx.drawImage(sprite, it.dcx - bloomR, it.dcy - bloomR, bloomR * 2, bloomR * 2);
    }
    // Hot white-ish core for the "brightest frame" pop.
    const coreR = cs * cfg.coreRadiusFrac * env;
    if (coreR > 0) {
      const coreSprite = _getFlourishSprite('core', '');
      ctx.globalAlpha = baseAlpha * cfg.coreAlpha * env;
      for (const it of items) {
        ctx.drawImage(coreSprite, it.dcx - coreR, it.dcy - coreR, coreR * 2, coreR * 2);
      }
    }
    ctx.restore();

    // 3. Redraw the matched tiles on top (restores them from the darken) and
    //    brighten the art itself with an additive sprite-over-sprite pass.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const drawCs = cs * scale;
      const dx = it.dcx - drawCs / 2;
      const dy = it.dcy - drawCs / 2;
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

    // 4. "Sekiro parry" flash — topmost, bursting from the group centroid.
    if (cfg.parryFlash && cfg.parryFlash.enabled) {
      this._renderParryFlash(ctx, gx, gy, cs, p);
    }

    ctx.restore();
  }

  /**
   * The match-4+ "parry flash" (see MATCH4_FLOURISH.parryFlash): an instant
   * near-white flare that spreads from the matched group's centroid — bright
   * core, expanding thinning shockwave ring, and a fan of tapered glint
   * streaks — all decaying to nothing within `spanFrac` of the freeze beat.
   * Additive blending only (no shadowBlur); a handful of gradient fills for a
   * handful of frames.
   * @param {number} gx - flash center x (group centroid)
   * @param {number} gy - flash center y
   * @param {number} cs - cell size
   * @param {number} p  - raw flourish progress 0..1 (NOT the darken envelope)
   * @private
   */
  _renderParryFlash(ctx, gx, gy, cs, p) {
    const base = MATCH4_FLOURISH.parryFlash;
    const enemySide = this.match4Flourish && this.match4Flourish.side === 'enemy';
    const cfg = enemySide && base.enemy ? { ...base, ...base.enemy } : base;
    const fp = Math.min(1, p / Math.max(0.01, cfg.spanFrac));
    if (fp >= 1) return;
    const spread = 1 - Math.pow(1 - fp, 3);      // easeOutCubic — fast burst out
    const decay = Math.pow(1 - fp, 2);           // brightest on frame 1, gone fast

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Central flare — hot white core over the matched tiles. Baked sprite
    // (module cache) — the gradient's alpha stops all scale by decay, so a
    // globalAlpha blit reproduces it without per-frame gradient construction.
    const flareR = cs * cfg.coreRadiusFrac * (0.35 + 0.65 * spread);
    const flareSprite = _getFlourishSprite('flare', `${cfg.centerColor}|${cfg.color}`);
    const prevFlashAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevFlashAlpha * cfg.coreAlpha * decay;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(flareSprite, gx - flareR, gy - flareR, flareR * 2, flareR * 2);
    ctx.globalAlpha = prevFlashAlpha;

    // Expanding shockwave ring — thins as it travels outward. (Kept as a live
    // gradient: its inner/outer radius RATIO changes every frame, so a scaled
    // sprite can't represent it; it's one gradient per frame, not per tile.)
    const ringR = cs * cfg.ringEndFrac * spread;
    const ringW = Math.max(1, cs * cfg.ringWidthFrac * (1 - fp * 0.7));
    if (ringR > ringW) {
      const g = ctx.createRadialGradient(gx, gy, Math.max(0, ringR - ringW), gx, gy, ringR + ringW);
      g.addColorStop(0, `rgba(${cfg.color},0)`);
      g.addColorStop(0.5, `rgba(${cfg.color},${cfg.ringAlpha * decay})`);
      g.addColorStop(1, `rgba(${cfg.color},0)`);
      ctx.fillStyle = g;
      const ext = ringR + ringW;
      ctx.fillRect(gx - ext, gy - ext, ext * 2, ext * 2);
    }

    // Glint streaks — a fan of thin tapered diamonds stretching outward.
    if (cfg.streaks > 0) {
      const len = cs * cfg.streakLenFrac * (0.4 + 0.6 * spread);
      const halfW = cs * cfg.streakWidthFrac * (1 - fp * 0.5);
      ctx.fillStyle = `rgba(${cfg.color},${cfg.streakAlpha * decay})`;
      ctx.translate(gx, gy);
      ctx.rotate((cfg.streakAngleDeg * Math.PI) / 180);
      const step = Math.PI / cfg.streaks;         // fan covers the full circle
      for (let i = 0; i < cfg.streaks; i++) {
        // Symmetric spike through the center (both directions at once).
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.quadraticCurveTo(0, -halfW, len, 0);
        ctx.quadraticCurveTo(0, halfW, -len, 0);
        ctx.fill();
        ctx.rotate(step);
      }
    }

    ctx.restore();
  }

  /**
   * Deferred match-4+ flourish pass — the bloom + grown/brightened matched
   * tiles, drawn by BattleBoardPanel AFTER its border-only frame overlay so
   * the emerging tiles render ABOVE the frame rails/crests. (The board darken
   * happens in renderSelf, beneath the frame.) No-op unless a flourish is
   * active this frame.
   */
  renderFlourishOverlay(ctx) {
    if (!this.match4Flourish) return;
    const { cellSize, offsetX, offsetY } = this.getCellMetrics();
    this._renderMatch4Flourish(
      ctx, Math.floor(offsetX), Math.floor(offsetY), Math.floor(cellSize), 'tiles');
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

    // PHYSICAL pixels per design pixel under the current transform (DPR ×
    // contain-fit scale). The pre-scaled tile cache must bake at PHYSICAL
    // resolution: a cs-design-px cell rasterizes to cs×pxScale device pixels,
    // and baking at plain cs then upscaling made tiles blurry/jagged on hiDPI.
    // Baked at bakeCs the blit is 1:1 on screen — same pixels as the old
    // direct full-res nearest draw.
    let pxScale = 1;
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      pxScale = Math.max(0.1, Math.hypot(m.a, m.b));
    } else if (typeof window !== 'undefined' && window.devicePixelRatio) {
      pxScale = window.devicePixelRatio;
    }
    const bakeCs = Math.max(1, Math.round(cs * pxScale));
    this._bakeCs = bakeCs; // shared with the swap-anim tile draw below
    this._cs = cs;         // design cell size — border bake needs the px ratio
    // Bordered-tile bakes are keyed per tile type at ONE bakeCs — drop them
    // all when the physical cell size changes (resize / DPR change).
    if (this._borderBakeCs !== bakeCs) {
      this._borderBakeCs = bakeCs;
      if (this._borderedTileCache) this._borderedTileCache.clear();
    }

    // Pre-scaled physical-resolution copies (nearest, matching the old live
    // downscale) — 1:1 blits instead of 64 full-res downscales per frame.
    // Falls back to the raw sprite while the sheet is still loading.
    const gridDark = this._assetManager
      ? (this._assetManager.getScaled('grid_dark', bakeCs, bakeCs) || this._assetManager.get('grid_dark'))
      : null;
    const gridLight = this._assetManager
      ? (this._assetManager.getScaled('grid_light', bakeCs, bakeCs) || this._assetManager.get('grid_light'))
      : null;

    const fallbackColors = FALLBACK_TILE_COLORS;

    const bgDark = '#2a2a1a';
    const bgLight = '#3a3a2a';

    // Reused per-frame lookup structures on numeric cell indices (col*16+row)
    // — the old string-keyed Set/object built 128+ template strings per frame.
    const emptyMask = this._emptyMask || (this._emptyMask = new Uint8Array(256));
    emptyMask.fill(0);
    for (const p of this.emptyCells) emptyMask[p.col * 16 + p.row] = 1;

    const fallSlots = this._fallSlots || (this._fallSlots = new Array(256).fill(null));
    fallSlots.fill(null);
    for (const f of this.fallCells) fallSlots[f.col * 16 + f.row] = f;

    // Swap animation: skip rendering swapped tiles in their original positions
    let swapSkipA = -1, swapSkipB = -1;
    if (this.swapAnim) {
      swapSkipA = this.swapAnim.from.col * 16 + this.swapAnim.from.row;
      swapSkipB = this.swapAnim.to.col * 16 + this.swapAnim.to.row;
    }

    // ═══════════════════════════════════════════════════════
    // PASS 1: Draw all cell BACKGROUNDS (chessboard + dark empties)
    // ═══════════════════════════════════════════════════════
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = ox + col * cs;
        const y = oy + row * cs;
        const isDark = (row + col) % 2 === 0;

        if (emptyMask[col * 16 + row]) {
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
    // While tiles are FALLING, clip the tile passes to the grid band plus a
    // small peek above the top row: stacked refill tiles start several rows
    // ABOVE the board (negative startRow) and must enter from under the
    // frame's top rail — not hover over the crest art. The peek band sits
    // within the rail zone the frame overlay repaints on top.
    const fallClip = this.fallCells.length > 0 && this._fallProgress < 1;
    if (fallClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox - 2, oy - cs * 0.35, this.cols * cs + 4, this.rows * cs + cs * 0.35 + 2);
      ctx.clip();
    }
    // Shared-gravity fall state for THIS frame: elapsed BASE ms into the
    // step (progress × the phase's base length = deepest land time + bounce)
    // → rows EVERY falling tile has covered. Computed once; each tile just
    // subtracts what it has left, so all falling tiles move at identical
    // instantaneous speeds (rigid columns — gaps never change mid-flight).
    const fallElapsed = fallClip
      ? this._fallProgress * (this._fallTotalBaseMs || 1)
      : 0;
    // Wild (Thrall) borders are deferred to a pass AFTER all tiles are drawn —
    // the frame overhangs the cell, so drawing it inline would let later-drawn
    // neighbor tiles clip its right/bottom edge.
    const wildBorders = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cellIdx = col * 16 + row;

        // Skip tiles being swap-animated (rendered separately at end)
        if (cellIdx === swapSkipA || cellIdx === swapSkipB) continue;

        // Skip empty cells
        if (emptyMask[cellIdx]) continue;

        const colorKey = this.getTileAt(row, col);
        if (!colorKey) continue;

        // Compute display position (animated for falling tiles)
        let displayX = ox + col * cs;
        let displayY = oy + row * cs;

        const fallData = fallSlots[cellIdx];
        if (fallData && this._fallProgress < 1) {
          // Shared gravity + COLLAPSE PROPAGATION: this tile starts falling
          // delayIdx × propagationMs after the step began (the mover just
          // above the gap leads, the pile ripples downward tile by tile),
          // then follows the one shared gravity law — lower tiles always
          // lead, so tiles can never cross. startRow may be NEGATIVE
          // (refills stack above the board and drop in under the rail).
          // Once landed, a brief BOUNCE hop (sin envelope, decaying) sells
          // the stop as a thunk instead of a slam.
          const dist = fallData.row - fallData.startRow;
          const local = fallElapsed
            - (fallData.delayIdx || 0) * FALL_TUNING.propagationMs;
          const remaining = dist - (local > 0 ? fallRowsFallen(local) : 0);
          if (remaining > 0) {
            displayY = Math.floor(displayY - remaining * cs);
          } else if (FALL_TUNING.bounceAmp > 0 && FALL_TUNING.bounceMs > 0) {
            const sinceLand = local - fallTimeToLandMs(dist);
            const q = sinceLand / FALL_TUNING.bounceMs;
            if (q >= 0 && q < 1) {
              const hop = FALL_TUNING.bounceAmp * cs * Math.sin(Math.PI * q) * (1 - q);
              displayY = Math.floor(displayY - hop);
            }
          }
        }

        // Board-shuffle fly-in: offset/scale/fade each tile toward its cell.
        let drawX = displayX, drawY = displayY, drawCs = cs, tileAlpha = 1;
        const sa = this._shuffleAnim;
        if (sa) {
          // Shuffle offsets stay string-keyed (built once per shuffle); the
          // key is only built while the fly-in is actually running.
          const o = sa.offsets.get(`${col},${row}`);
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

        // Tile sprite. At the normal cell size use the physical-resolution
        // pre-scaled cache (1:1 device-pixel blit — the sheet slices are much
        // larger than the cell, and downscaling all 64 every frame is the
        // board's constant floor cost). Odd sizes (the shuffle fly-in animates
        // drawCs) fall back to the full-res draw so the scaled cache never
        // thrashes with per-frame sizes.
        const assetKey = `tile_${colorKey}`;
        let tileImg = null;
        let borderBaked = false;
        if (this._assetManager) {
          if (drawCs === cs) {
            // Bordered bake first: tile art + cell border pre-stroked into one
            // canvas, so the per-tile cost is a single 1:1 blit (the 64
            // per-frame hairline strokeRects were a measurable path-stroke
            // cost on mobile GPUs).
            const bordered = this._getBorderedTile(assetKey, bakeCs, cs);
            if (bordered) {
              tileImg = bordered;
              borderBaked = true;
            } else {
              tileImg = this._assetManager.getScaled(assetKey, bakeCs, bakeCs) || this._assetManager.get(assetKey);
            }
          } else {
            tileImg = this._assetManager.get(assetKey);
          }
        }
        if (tileImg) {
          ctx.drawImage(tileImg, 0, 0, tileImg.width, tileImg.height, drawX, drawY, drawCs, drawCs);
        } else {
          ctx.fillStyle = fallbackColors[colorKey] || '#444';
          ctx.fillRect(drawX + 1, drawY + 1, drawCs - 2, drawCs - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(drawX + 1, drawY + 1, drawCs - 2, (drawCs - 2) * 0.3);
        }

        // Cell border (live stroke only where the bake couldn't provide it:
        // sheet still loading, fallback fill, or the shuffle fly-in's odd sizes)
        if (!borderBaked) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(drawX, drawY, drawCs, drawCs);
        }

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

        // Fungal blight tiles (Blight Warden): remaining-turns badge, derived
        // straight from the type id (fungal_2 / fungal_1) — no side state.
        if (isFungal(colorKey)) {
          const prevA = ctx.globalAlpha;
          if (tileAlpha < 1) ctx.globalAlpha = prevA * tileAlpha;
          this._drawFungalTimerBadge(ctx, drawX, drawY, drawCs, fungalTimer(colorKey));
          if (tileAlpha < 1) ctx.globalAlpha = prevA;
        }
      }
    }

    // Wild-tile border pass — on top of all tiles so the overhanging frame
    // isn't clipped by neighbors.
    for (const b of wildBorders) {
      this._drawWildTileBorder(ctx, b.x, b.y, b.cs != null ? b.cs : cs);
    }
    if (fallClip) ctx.restore();

    // Idle "sleeping" glints — sheen sweep on resting mana tiles (only spawns
    // while the board is idle; see _updateIdleGlints).
    this._renderIdleGlints(ctx, ox, oy, cs);

    // ═══════════════════════════════════════════════════════
    // OVERLAYS (rendered above tiles)
    // ═══════════════════════════════════════════════════════

    // ── Highlight overlay (SHOW_MATCH phase) ──
    if (this.highlightCells.length > 0) {
      // Pulse + styles are identical for every cell — computed once per frame
      // (was Date.now() + 2 rgba template strings + save/restore per cell).
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
      ctx.save();
      ctx.lineWidth = 2.5;
      const hlFill = `rgba(255,255,100,${0.15 + pulse * 0.2})`;
      const hlStroke = `rgba(255,255,50,${0.5 + pulse * 0.3})`;
      for (const pos of this.highlightCells) {
        const hx = ox + pos.col * cs;
        const hy = oy + pos.row * cs;
        ctx.fillStyle = hlFill;
        ctx.fillRect(hx, hy, cs, cs);
        ctx.strokeStyle = hlStroke;
        ctx.strokeRect(hx + 1, hy + 1, cs - 2, cs - 2);
      }
      ctx.restore();
    }

    // ── Match-4+ emphasis flourish — DARKEN phase only. The bloom + grown
    // tiles are deferred to renderFlourishOverlay(), which BattleBoardPanel
    // calls AFTER its frame overlay so the emerging tiles pop ABOVE the frame
    // rails (the darken stays here, beneath the frame, so the rails don't dim).
    this._renderMatch4Flourish(ctx, ox, oy, cs, 'darken');

    // ── Targeting overlay (skill targeting like Explode! 3x3) ──
    if (this.targetingOverlayCells && this.targetingOverlayCells.length > 0) {
      // Dim every cell OUTSIDE the previewed area so the target zone pops
      // (same read as the match-4 flourish darken). Cheap flat fills, and
      // only while targeting — a transient state.
      const inArea = this._targetDimSet || (this._targetDimSet = new Set());
      inArea.clear();
      for (const pos of this.targetingOverlayCells) {
        inArea.add(pos.col * 16 + pos.row);
      }
      ctx.save();
      ctx.fillStyle = 'rgba(6, 4, 12, 0.42)';
      for (let col = 0; col < this.cols; col++) {
        for (let row = 0; row < this.rows; row++) {
          if (inArea.has(col * 16 + row)) continue;
          ctx.fillRect(ox + col * cs, oy + row * cs, cs, cs);
        }
      }
      ctx.restore();

      // Pulse + styles hoisted out of the loop (identical per cell).
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
      // Pulsing glow via a wide faint outer stroke — no shadowBlur (the
      // expensive canvas op; this runs per cell per frame while targeting).
      const tgFill = `rgba(255, 255, 255, ${0.05 + pulse * 0.15})`;
      const tgGlow = `rgba(255, 255, 255, ${0.10 + pulse * 0.14})`;
      ctx.save();
      for (const pos of this.targetingOverlayCells) {
        const hx = ox + pos.col * cs;
        const hy = oy + pos.row * cs;
        ctx.fillStyle = tgFill;
        ctx.fillRect(hx, hy, cs, cs);
        ctx.strokeStyle = tgGlow;
        ctx.lineWidth = 9;
        ctx.strokeRect(hx, hy, cs, cs);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 3;
        ctx.strokeRect(hx, hy, cs, cs);
      }
      ctx.restore();
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
      // Glow = wide faint stroke under the crisp one (no shadowBlur — this
      // draws every frame while a tile is selected).
      ctx.strokeStyle = 'rgba(255,255,0,0.30)';
      ctx.lineWidth = 8;
      ctx.strokeRect(sx + 1, sy + 1, cs - 2, cs - 2);
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 3;
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

      // No drop shadow on the moving tiles — shadowBlur on drawImage forces
      // the slow canvas path every swap frame (mobile), and the motion itself
      // already separates the pair from the grid.
      this._drawSwapTile(ctx, ax, ay, fromType, cs);
      this._drawSwapTile(ctx, bx, by, toType, cs);
    }

    // Restore smoothing to previous state
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  /**
   * Draw one swap-animated tile (was a per-frame closure allocated inside
   * renderSelf for every swap frame). Same bordered bake as the grid pass.
   */
  _drawSwapTile(ctx, x, y, typeKey, cs) {
    if (!typeKey) return;
    const assetKey = `tile_${typeKey}`;
    const bakeSize = this._bakeCs || cs;
    const bordered = this._assetManager ? this._getBorderedTile(assetKey, bakeSize, cs) : null;
    const tileImg = bordered || (this._assetManager
      ? (this._assetManager.getScaled(assetKey, bakeSize, bakeSize) || this._assetManager.get(assetKey))
      : null);
    if (tileImg) {
      ctx.drawImage(tileImg, 0, 0, tileImg.width, tileImg.height, x, y, cs, cs);
    } else {
      ctx.fillStyle = FALLBACK_TILE_COLORS[typeKey] || '#444';
      ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 1, y + 1, cs - 2, (cs - 2) * 0.3);
    }
    if (!bordered) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, cs, cs);
    }
    // Keep the wild tile border on Thrall tiles while they swap.
    if (isWild(typeKey)) this._drawWildTileBorder(ctx, x, y, cs);
    // Keep the fungal timer badge on blight tiles while they swap.
    if (isFungal(typeKey)) this._drawFungalTimerBadge(ctx, x, y, cs, fungalTimer(typeKey));
  }

  /**
   * Return a physical-resolution tile bake WITH the 0.5-design-px cell border
   * pre-stroked into it (fully inside the cell — the old live strokeRect
   * straddled the cell edge, its outer half overdrawn by neighbors), or null
   * while the underlying sprite hasn't loaded (caller falls back to the live
   * draw + strokeRect). One entry per tile type at the current bakeCs;
   * invalidated in renderSelf when bakeCs changes.
   */
  _getBorderedTile(assetKey, bakeCs, cs) {
    const cache = this._borderedTileCache || (this._borderedTileCache = new Map());
    const hit = cache.get(assetKey);
    if (hit !== undefined) return hit;
    const base = this._assetManager.getScaled(assetKey, bakeCs, bakeCs);
    if (!base) return null; // not cached — retried next frame once the sheet loads
    const canvas = document.createElement('canvas');
    canvas.width = bakeCs;
    canvas.height = bakeCs;
    const bctx = canvas.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(base, 0, 0);
    const lw = 0.5 * (bakeCs / Math.max(1, cs)); // 0.5 design px in physical px
    bctx.strokeStyle = 'rgba(0,0,0,0.25)';
    bctx.lineWidth = lw;
    bctx.strokeRect(lw / 2, lw / 2, bakeCs - lw, bakeCs - lw);
    cache.set(assetKey, canvas);
    return canvas;
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
      // The thick dark strokeText already supplies the legibility halo —
      // no shadowBlur (drawn per locked tile per frame).
      ctx.strokeText(String(turns), cx, cy);
      ctx.fillText(String(turns), cx, cy);
      ctx.restore();
    }
  }

  /**
   * Draw the FUNGAL tile "turns remaining" badge — a small white number with a
   * dark outline in the tile's top-right corner (corner rather than center so
   * the blight art stays readable; the same number-on-tile language as the
   * lock badge). The timer is derived from the type id, so this needs no
   * side-band state and follows fall/swap/shuffle for free. See decision #46.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y @param {number} size
   * @param {number} turns - remaining enemy-turn starts before it explodes
   */
  _drawFungalTimerBadge(ctx, x, y, size, turns = 0) {
    if (size <= 0 || !(turns > 0)) return;
    const fs = Math.max(9, Math.round(size * 0.30));
    const cx = x + size * 0.78;
    const cy = y + size * 0.24;
    ctx.save();
    ctx.font = `bold ${fs}px "MarcellusSC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fs * 0.22);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#eaffda';
    // Thick dark strokeText supplies the legibility halo — no shadowBlur
    // (drawn per fungal tile per frame, same budget rule as the lock badge).
    ctx.strokeText(String(turns), cx, cy);
    ctx.fillText(String(turns), cx, cy);
    ctx.restore();
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
