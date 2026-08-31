/**
 * BattleActionTicker — the visual top-of-screen action waterfall + its log.
 *
 * Every meaningful battle action is one COMPOSED ROW, not plain text:
 *
 *     [portrait chip]  ›  [action icon]  ›  text  -14
 *
 * — the circular portrait of who acted/was affected, the action's icon
 * (the same asset the skill cards use — skill icons incl. woven canvases,
 * the skull tile art, stat icons), then a short label and/or a bold colored
 * amount. Segments that don't apply are simply omitted; dim chevrons join
 * the ones present, giving the "who → what → how much" read.
 *
 * Waterfall behavior: the NEWEST row pops in at top-center and holds crisp;
 * the moment a new row arrives (or its hold expires) it FALLS downward while
 * fading out — at most one non-faded action is ever readable.
 *
 * Also keeps a HISTORY ring of the last HISTORY_MAX row specs — the data
 * source for BattleScene's battle-log overlay ('l' / the corner log button),
 * which re-draws the SAME baked row sprites left-aligned in the panel.
 *
 * Scene-owned (NOT in _floatingEffects — persistent, not one-shot):
 * BattleScene calls update(dt) each frame (after the hit-stop early-return,
 * so it freezes with everything else) and render(ctx, cx, topY). Each row is
 * BAKED once into a sprite at 2× design resolution (`ensureSprite`, public so
 * the log overlay can bake rows pushed while it was open) — per-frame cost is
 * one alpha-scaled drawImage per visible row; no DOM → plain-text fallback.
 *
 * Push spec: { portrait?: image, icon?: image, text?: string,
 *              value?: string, color?: string } — images must be READY
 * (BattleScene resolves asset keys and only passes loaded images).
 */

const POP_MS = 140;    // slide/fade in at the top
const HOLD_MS = 1500;  // crisp read time (cut short when displaced)
const FALL_MS = 750;   // the tumble-out
const FALL_DIST = 110; // px fallen by the time it's fully faded
const POP_RISE = 14;   // px it slides down from during pop-in

// Row geometry (design px; baked at ×BAKE_SCALE).
const ROW_H = 58;            // sprite height (fits the portrait chip + ring)
const PORTRAIT_D = 50;       // portrait chip diameter
const ICON_D = 42;           // action-icon chip diameter
const SEG_GAP = 10;          // gap on each side of a chevron
const TEXT_GAP = 9;          // gap between label text and the value
const TEXT_SIZE = 28;        // label font size
const VALUE_SIZE = 34;       // amount font size (bold)
const CHEVRON_SIZE = 22;
const BAKE_SCALE = 2;        // sprite oversampling (matches the DPR cap)
const OUTLINE_WIDTH = 5;     // dark text outline (bake px)
const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';
const RING_COLOR = 'rgba(214, 188, 120, 0.9)';
const CHEVRON_COLOR = 'rgba(214, 188, 120, 0.55)';
const CHIP_BACKING = 'rgba(14, 11, 8, 0.9)';
/** Portrait crop: the top square of the (tall) portrait art ≈ the face. */
const PORTRAIT_CROP_TOP_FRAC = 0.02;

// The LIVE waterfall's translucent pill container behind each row (the log
// overlay draws the bare sprites — its panel is the container there).
const PLATE_PAD_X = 20;      // pill overhang past the row's ends
const PLATE_PAD_Y = 3;
const PLATE_FILL = 'rgba(12, 9, 7, 0.6)';
const PLATE_BORDER = 'rgba(214, 188, 120, 0.35)';

const HISTORY_MAX = 20;

function easeOutCubic(p) { return 1 - (1 - p) * (1 - p) * (1 - p); }

export default class BattleActionTicker {
  constructor() {
    /** Live on-screen rows, oldest first: {spec, age, falling, fallStart}. */
    this._entries = [];
    /** Row-spec ring (sprite baked onto each), oldest first, ≤ HISTORY_MAX. */
    this._history = [];
  }

  /**
   * Add an action row. Any row still holding starts falling immediately —
   * the newcomer owns the crisp slot.
   * @param {{portrait?:object, icon?:object, text?:string, value?:string, color?:string}} spec
   */
  push(spec) {
    if (!spec || (!spec.text && !spec.value && !spec.icon)) return;
    for (const e of this._entries) {
      if (!e.falling) {
        e.falling = true;
        e.fallStart = e.age;
      }
    }
    this._entries.push({ spec, age: 0, falling: false, fallStart: 0 });
    this._history.push(spec);
    if (this._history.length > HISTORY_MAX) {
      this._history.splice(0, this._history.length - HISTORY_MAX);
    }
  }

  /** Last HISTORY_MAX row specs, oldest→newest — the log overlay's data. */
  getHistory() {
    return this._history;
  }

  clear() {
    this._entries.length = 0;
    this._history.length = 0;
  }

  update(dt) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const e = this._entries[i];
      e.age += dt;
      if (!e.falling && e.age >= POP_MS + HOLD_MS) {
        e.falling = true;
        e.fallStart = e.age;
      }
      if (e.falling && e.age - e.fallStart >= FALL_MS) {
        this._entries.splice(i, 1);
      }
    }
  }

  /**
   * Draw the waterfall. Oldest first so the newest lands on top.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx - horizontal center (design space)
   * @param {number} topY - resting top edge of the newest row
   */
  render(ctx, cx, topY) {
    if (this._entries.length === 0) return;
    ctx.save();
    for (const e of this._entries) {
      let alpha;
      let y = topY;
      if (e.age < POP_MS) {
        const p = easeOutCubic(e.age / POP_MS);
        alpha = p;
        y = topY - POP_RISE * (1 - p);
      } else {
        alpha = 1;
      }
      if (e.falling) {
        const q = Math.min(1, (e.age - e.fallStart) / FALL_MS);
        y += FALL_DIST * q * q; // accelerating fall
        alpha = Math.min(alpha, 1 - q);
      }
      if (alpha <= 0) continue;

      this.ensureSprite(e.spec);
      ctx.globalAlpha = alpha;
      const s = e.spec;
      if (s.sprite) {
        const w = s.spriteW / BAKE_SCALE;
        const h = s.spriteH / BAKE_SCALE;
        // Translucent pill container behind the row (live waterfall only).
        const px = cx - w / 2 - PLATE_PAD_X;
        const py = y - PLATE_PAD_Y;
        const pw = w + PLATE_PAD_X * 2;
        const ph = h + PLATE_PAD_Y * 2;
        const r = ph / 2;
        ctx.beginPath();
        ctx.moveTo(px + r, py);
        ctx.arcTo(px + pw, py, px + pw, py + ph, r);
        ctx.arcTo(px + pw, py + ph, px, py + ph, r);
        ctx.arcTo(px, py + ph, px, py, r);
        ctx.arcTo(px, py, px + pw, py, r);
        ctx.closePath();
        ctx.fillStyle = PLATE_FILL;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = PLATE_BORDER;
        ctx.stroke();
        ctx.drawImage(s.sprite, cx - w / 2, y, w, h);
      } else {
        // No-DOM / bake-failure fallback: the row as plain outlined text.
        const txt = [s.text, s.value].filter(Boolean).join(' ');
        ctx.font = `600 ${TEXT_SIZE}px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 8, 6, 0.9)';
        ctx.strokeText(txt, cx, y);
        ctx.fillStyle = s.color || '#e8d8a8';
        ctx.fillText(txt, cx, y);
      }
    }
    ctx.restore();
  }

  /**
   * Bake a row spec's composed sprite once (2× design res). PUBLIC: the log
   * overlay calls it too, so rows pushed while the overlay was open (the
   * ticker render skipped) still get their sprite.
   */
  ensureSprite(spec) {
    if (spec.sprite || spec._bakeFailed || typeof document === 'undefined') return;
    try {
      const K = BAKE_SCALE;
      const color = spec.color || '#e8d8a8';
      const scratch = document.createElement('canvas');
      const g = scratch.getContext('2d');

      // ── Measure the segments left→right ──
      const textFont = `${TEXT_SIZE * K}px ${FONT_FAMILY}`;
      const valueFont = `600 ${VALUE_SIZE * K}px ${FONT_FAMILY}`;
      let textW = 0;
      let valueW = 0;
      if (spec.text) { g.font = textFont; textW = g.measureText(spec.text).width; }
      if (spec.value) { g.font = valueFont; valueW = g.measureText(spec.value).width; }
      g.font = `${CHEVRON_SIZE * K}px ${FONT_FAMILY}`;
      const chevW = g.measureText('›').width; // ›

      const segs = []; // {kind, w}
      if (spec.portrait) segs.push({ kind: 'portrait', w: PORTRAIT_D * K });
      if (spec.icon) segs.push({ kind: 'icon', w: ICON_D * K });
      if (spec.text || spec.value) {
        segs.push({
          kind: 'textblock',
          w: textW + (spec.text && spec.value ? TEXT_GAP * K : 0) + valueW,
        });
      }
      if (segs.length === 0) { spec._bakeFailed = true; return; }

      const joinW = SEG_GAP * K + chevW + SEG_GAP * K;
      const pad = OUTLINE_WIDTH + 2;
      let total = pad * 2;
      for (let i = 0; i < segs.length; i++) {
        total += segs[i].w + (i > 0 ? joinW : 0);
      }
      const H = ROW_H * K + pad * 2;
      scratch.width = Math.ceil(total);
      scratch.height = Math.ceil(H);
      const cy = H / 2;

      // Canvas resize reset state — set shared text styles once.
      g.textBaseline = 'middle';
      g.lineJoin = 'round';

      let x = pad;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (i > 0) {
          // Dim chevron joiner — the "→" causal read.
          x += SEG_GAP * K;
          g.font = `${CHEVRON_SIZE * K}px ${FONT_FAMILY}`;
          g.textAlign = 'left';
          g.fillStyle = CHEVRON_COLOR;
          g.fillText('›', x, cy + 1 * K);
          x += chevW + SEG_GAP * K;
        }
        if (seg.kind === 'portrait') {
          this._drawPortraitChip(g, spec.portrait, x, cy, (PORTRAIT_D * K) / 2);
          x += seg.w;
        } else if (seg.kind === 'icon') {
          this._drawIconChip(g, spec.icon, x, cy, (ICON_D * K) / 2);
          x += seg.w;
        } else {
          g.textAlign = 'left';
          if (spec.text) {
            g.font = textFont;
            g.lineWidth = OUTLINE_WIDTH;
            g.strokeStyle = 'rgba(10, 8, 6, 0.92)';
            g.strokeText(spec.text, x, cy);
            g.fillStyle = color;
            g.fillText(spec.text, x, cy);
            x += textW + (spec.value ? TEXT_GAP * K : 0);
          }
          if (spec.value) {
            g.font = valueFont;
            g.lineWidth = OUTLINE_WIDTH;
            g.strokeStyle = 'rgba(10, 8, 6, 0.92)';
            g.strokeText(spec.value, x, cy);
            g.fillStyle = color;
            g.fillText(spec.value, x, cy);
            x += valueW;
          }
        }
      }

      spec.sprite = scratch;
      spec.spriteW = scratch.width;
      spec.spriteH = scratch.height;
    } catch (err) {
      spec._bakeFailed = true;
    }
  }

  /** Circular portrait chip: top-square face crop + gold ring. @private */
  _drawPortraitChip(g, img, x, cy, r) {
    const cx = x + r;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = CHIP_BACKING;
    g.fill();
    g.clip();
    // Source crop: the top square of the tall portrait art (the face).
    const sw = img.width;
    const sh = Math.min(img.height, img.width);
    const sy = Math.min(img.height - sh, img.height * PORTRAIT_CROP_TOP_FRAC);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, sy, sw, sh, cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.beginPath();
    g.arc(cx, cy, r - 1, 0, Math.PI * 2);
    g.lineWidth = 2.5;
    g.strokeStyle = RING_COLOR;
    g.stroke();
  }

  /** Circular action-icon chip: dark backing, cover-fit art, thin ring. @private */
  _drawIconChip(g, img, x, cy, r) {
    const cx = x + r;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = CHIP_BACKING;
    g.fill();
    g.clip();
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    g.imageSmoothingEnabled = true;
    g.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    g.restore();
    g.beginPath();
    g.arc(cx, cy, r - 1, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = RING_COLOR;
    g.stroke();
  }
}

/** Sprite scale factor the log overlay divides by (kept in one place). */
export const TICKER_BAKE_SCALE = BAKE_SCALE;
