/**
 * ManaStreamEffect — thin whispy mana stream from matched tiles to a mana orb.
 *
 * When a mana match resolves, a handful of thin, glowing "wisps" of that mana's
 * color fly from the matched board cells and converge on the matching mana
 * counter orb in the character pane. Each wisp travels along a gently bowed
 * path with a tapering trailing streak and a bright head, staggered so the
 * stream reads as a flowing wisp rather than a single pellet, then fades as it
 * lands. An optional `onArrive` callback fires as the leading wisps reach the
 * orb so the orb can give a little pulse in sync.
 *
 * Not a UIElement — uses absolute design-space coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect / HarvestTendrilEffect): construct, call update(dt) +
 * render(ctx) each frame, remove once `done` is true.
 *
 * ── Mobile performance ────────────────────────────────────────────────
 * This effect is deliberately cheap to draw because many wisps can be on
 * screen at once during a cascade:
 *   - NO `ctx.shadowBlur` — canvas shadow blur is the biggest mobile perf
 *     killer; the additive ('lighter') blend already reads as a glow.
 *   - The bright head glow is a SMALL per-color sprite baked ONCE (module
 *     cache) and drawn with `drawImage`, instead of allocating a
 *     `createRadialGradient` every frame (which churns GC and stalls).
 *   - The tapering trail is a 2-pass stroke (wide-soft + thin-bright) instead
 *     of N shadowed segment strokes, and the path is walked with reusable
 *     scratch points so no arrays/objects are allocated per frame.
 */

// Module-level cache of small radial "glow dot" sprites, keyed by color pair.
// Baked once and reused for the life of the page (a handful of mana colors).
const GLOW_SPRITE_SIZE = 48;
const _glowSprites = new Map();

function getGlowSprite(color, coreColor) {
  const key = `${color}|${coreColor}`;
  let sprite = _glowSprites.get(key);
  if (sprite) return sprite;

  // Guard for non-DOM contexts (tests) — fall back to null so render skips it.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_SPRITE_SIZE;
  canvas.height = GLOW_SPRITE_SIZE;
  const g = canvas.getContext('2d');
  const c = GLOW_SPRITE_SIZE / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, coreColor);
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);

  _glowSprites.set(key, canvas);
  return canvas;
}

export default class ManaStreamEffect {
  /**
   * @param {Array<{x:number,y:number}>} sources - matched-tile centers (design space)
   * @param {{x:number,y:number}} target - mana orb center (design space)
   * @param {object} [config]
   * @param {string} [config.color='#ffffff']    - mana color
   * @param {string} [config.coreColor='#ffffff']- bright head/core color
   * @param {number} [config.thickness=3]         - base streak width
   * @param {number} [config.wispsPerSource=2]    - wisps spawned per source cell
   * @param {number} [config.maxSources=6]        - cap on source cells used
   * @param {number} [config.travelMs=460]        - nominal travel time per wisp
   * @param {number} [config.staggerMs=130]       - spread of wisp start times
   * @param {number} [config.spawnJitter=16]      - random offset of each wisp start (px)
   * @param {number} [config.curve=55]            - perpendicular bow magnitude (px)
   * @param {number} [config.trail=6]             - trail sample count (path resolution)
   * @param {number} [config.fadeTail=140]        - ms a wisp fades after arriving
   * @param {number} [config.delayMs=0]           - initial hold before any wisp launches
   *   (used by the skill-projectile reuse to wait out the enemy cast showcase)
   * @param {function} [config.onArrive]          - called once as wisps land
   */
  constructor(sources, target, config = {}) {
    this.target = target;
    this.color = config.color || '#ffffff';
    this.coreColor = config.coreColor || '#ffffff';
    this.thickness = config.thickness != null ? config.thickness : 3;
    this.wispsPerSource = config.wispsPerSource != null ? config.wispsPerSource : 2;
    this.travelMs = config.travelMs != null ? config.travelMs : 460;
    this.staggerMs = config.staggerMs != null ? config.staggerMs : 130;
    this.spawnJitter = config.spawnJitter != null ? config.spawnJitter : 16;
    this.curve = config.curve != null ? config.curve : 55;
    this.trail = config.trail != null ? config.trail : 6;
    this.fadeTail = config.fadeTail != null ? config.fadeTail : 140;
    this.delayMs = config.delayMs != null ? config.delayMs : 0;

    this._onArrive = typeof config.onArrive === 'function' ? config.onArrive : null;
    this._arriveAt = this.delayMs + this.travelMs * 0.78;
    this._arrived = false;

    this.elapsed = 0;
    this.done = false;

    // Reusable scratch points so the per-frame path walk allocates nothing.
    this._pA = { x: 0, y: 0 };
    this._pB = { x: 0, y: 0 };

    const maxSources = config.maxSources != null ? config.maxSources : 6;
    const srcs = (sources || []).slice(0, maxSources);

    this._wisps = [];
    for (let i = 0; i < srcs.length; i++) {
      for (let k = 0; k < this.wispsPerSource; k++) {
        const delay = this.delayMs + Math.random() * this.staggerMs;
        const sx = srcs[i].x + (Math.random() * 2 - 1) * this.spawnJitter;
        const sy = srcs[i].y + (Math.random() * 2 - 1) * this.spawnJitter;
        const dx = target.x - sx;
        const dy = target.y - sy;
        const len = Math.max(1, Math.hypot(dx, dy));
        this._wisps.push({
          sx, sy,
          px: -dy / len, // unit perpendicular to source→target
          py: dx / len,
          bow: (Math.random() * 2 - 1) * this.curve,
          wobblePhase: Math.random() * Math.PI * 2,
          delay,
          dur: this.travelMs * (0.85 + Math.random() * 0.3),
        });
      }
    }

    this._total = this.delayMs + this.travelMs + this.staggerMs + this.fadeTail + 60;
    // No wisps (no valid sources) → nothing to do.
    if (this._wisps.length === 0) this.done = true;
  }

  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    if (!this._arrived && this.elapsed >= this._arriveAt) {
      this._arrived = true;
      if (this._onArrive) this._onArrive();
    }
    if (this.elapsed >= this._total) this.done = true;
  }

  /** Write the point on a wisp's bowed path at fraction p into `out`. */
  _segPoint(w, p, out) {
    const baseX = w.sx + (this.target.x - w.sx) * p;
    const baseY = w.sy + (this.target.y - w.sy) * p;
    const env = Math.sin(p * Math.PI); // pin offset to 0 at both ends
    const wob = 1 + Math.sin(p * Math.PI * 2 + w.wobblePhase) * 0.35;
    const off = env * w.bow * wob;
    out.x = baseX + w.px * off;
    out.y = baseY + w.py * off;
  }

  render(ctx) {
    if (this.done) return;

    const glow = getGlowSprite(this.color, this.coreColor);
    const TAIL = 0.16; // trailing streak length as a path fraction
    const segs = this.trail;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // additive glow (NO shadowBlur)
    ctx.lineCap = 'round';

    for (const w of this._wisps) {
      const t = this.elapsed - w.delay;
      if (t <= 0) continue;

      const head = Math.min(1, t / w.dur);
      let alpha;
      if (head >= 1) {
        alpha = Math.max(0, 1 - (t - w.dur) / this.fadeTail);
      } else {
        alpha = Math.min(1, head * 3); // quick ease-in
      }
      if (alpha <= 0) continue;

      // Trailing streak: two cheap full-polyline strokes (wide-soft +
      // thin-bright) walked with reusable scratch points (zero allocation).
      const tailStart = Math.max(0, head - TAIL);

      // Pass 1 — wide, soft, mana-colored.
      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.thickness * 1.4;
      this._strokePath(ctx, w, tailStart, head, segs);

      // Pass 2 — thin, bright core.
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = this.coreColor;
      ctx.lineWidth = this.thickness * 0.5;
      this._strokePath(ctx, w, tailStart, head, segs);

      // Bright head — a baked glow sprite (cheap drawImage), no per-frame gradient.
      this._segPoint(w, head, this._pA);
      ctx.globalAlpha = alpha;
      const r = this.thickness * 2.6;
      if (glow) {
        ctx.drawImage(glow, this._pA.x - r, this._pA.y - r, r * 2, r * 2);
      } else {
        // Fallback (no DOM): a solid additive dot.
        ctx.fillStyle = this.coreColor;
        ctx.beginPath();
        ctx.arc(this._pA.x, this._pA.y, this.thickness, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** Stroke a wisp's path from fraction a→b in `segs` steps (no allocation). */
  _strokePath(ctx, w, a, b, segs) {
    ctx.beginPath();
    this._segPoint(w, a, this._pA);
    ctx.moveTo(this._pA.x, this._pA.y);
    for (let s = 1; s <= segs; s++) {
      const p = a + (b - a) * (s / segs);
      this._segPoint(w, p, this._pB);
      ctx.lineTo(this._pB.x, this._pB.y);
    }
    ctx.stroke();
  }
}
