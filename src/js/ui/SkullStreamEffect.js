/**
 * SkullStreamEffect — the dark mirror of ManaStreamEffect: violence, not magic.
 *
 * When skull tiles are destroyed (a skull match, or a destroy skill catching
 * skulls), crimson streaks fly from each destroyed cell and converge on the
 * RECEIVING side's portrait, each led by a ghostly copy of the skull tile art
 * that tumbles and shrinks in flight. It is the visual cause→effect link the
 * damage counter was missing: BattleScene attaches the skull damage as a
 * PAYLOAD (`addPayload`), and the effect hands it back in chunks via
 * `onDeliver(chunk, isLast)` as wisps land — so the accumulating damage
 * counter ticks up in sync with each skull that arrives.
 *
 * Payload contract:
 *   - addPayload(amount) may be called any time (the damage event can arrive
 *     a frame after the stream spawns, or never — a fully blocked hit emits
 *     no event and the stream simply flies empty).
 *   - Each wisp arrival delivers an even share of the remaining payload;
 *     the LAST arrival flushes the remainder (`isLast: true` — the caller's
 *     cue for the big impact accents).
 *   - If the effect finishes with payload still undelivered (added after all
 *     arrivals), it flushes immediately so damage feedback can never be lost.
 *
 * Externally-managed effect contract (update(dt)/render(ctx)/done); lives in
 * BattleScene's _floatingEffects. Same mobile rules as ManaStreamEffect:
 * NO shadowBlur, baked glow sprite, zero per-frame allocation on the path walk.
 */

const GLOW_SPRITE_SIZE = 48;
let _glowSprite = null;

const GLOW_COLOR = 'rgba(200, 40, 30, 1)';
const GLOW_CORE = 'rgba(255, 214, 170, 1)';

function getGlowSprite() {
  if (_glowSprite) return _glowSprite;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_SPRITE_SIZE;
  canvas.height = GLOW_SPRITE_SIZE;
  const g = canvas.getContext('2d');
  const c = GLOW_SPRITE_SIZE / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, GLOW_CORE);
  grad.addColorStop(0.4, GLOW_COLOR);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  _glowSprite = canvas;
  return canvas;
}

export default class SkullStreamEffect {
  /**
   * @param {Array<{x:number,y:number}>} sources - destroyed skull cell centers
   * @param {{x:number,y:number}} target - receiver portrait center
   * @param {object} [config]
   * @param {HTMLImageElement|HTMLCanvasElement} [config.headImage] - skull tile
   *   art drawn as the tumbling ghost head (falls back to the glow dot alone)
   * @param {number} [config.headSize=34]       - ghost head draw size at launch (px)
   * @param {string} [config.color]             - streak color
   * @param {string} [config.coreColor]         - bright core color
   * @param {number} [config.thickness=4.5]     - base streak width
   * @param {number} [config.maxSources=8]      - cap on source cells used
   * @param {number} [config.travelMs=430]      - nominal travel time
   * @param {number} [config.staggerMs=150]     - spread of start times
   * @param {number} [config.curve=70]          - perpendicular bow magnitude
   * @param {number} [config.fadeTail=150]      - ms the trail fades after arrival
   * @param {function} [config.onDeliver]       - (chunk, isLast) per wisp arrival
   */
  constructor(sources, target, config = {}) {
    this.target = target;
    this.color = config.color || 'rgba(190, 34, 26, 0.9)';
    this.coreColor = config.coreColor || 'rgba(255, 200, 160, 0.95)';
    this.thickness = config.thickness != null ? config.thickness : 4.5;
    this.travelMs = config.travelMs != null ? config.travelMs : 430;
    this.staggerMs = config.staggerMs != null ? config.staggerMs : 150;
    this.curve = config.curve != null ? config.curve : 70;
    this.fadeTail = config.fadeTail != null ? config.fadeTail : 150;
    this.headImage = config.headImage || null;
    this.headSize = config.headSize != null ? config.headSize : 34;

    this._onDeliver = typeof config.onDeliver === 'function' ? config.onDeliver : null;
    this._payload = 0;          // damage still to hand out via onDeliver
    this._payloadFlushed = false;

    this.elapsed = 0;
    this.done = false;

    this._pA = { x: 0, y: 0 };
    this._pB = { x: 0, y: 0 };

    const maxSources = config.maxSources != null ? config.maxSources : 8;
    const srcs = (sources || []).slice(0, maxSources);

    // ONE wisp per skull cell — each arrival is one counter tick, so the tick
    // count reads as "each skull landed".
    this._wisps = [];
    for (let i = 0; i < srcs.length; i++) {
      const delay = (i / Math.max(1, srcs.length)) * this.staggerMs
        + Math.random() * 40;
      const sx = srcs[i].x + (Math.random() * 2 - 1) * 8;
      const sy = srcs[i].y + (Math.random() * 2 - 1) * 8;
      const dx = target.x - sx;
      const dy = target.y - sy;
      const len = Math.max(1, Math.hypot(dx, dy));
      this._wisps.push({
        sx, sy,
        px: -dy / len,
        py: dx / len,
        bow: (Math.random() * 2 - 1) * this.curve,
        wobblePhase: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 0.012, // ghost head tumble (rad/ms)
        delay,
        dur: this.travelMs * (0.85 + Math.random() * 0.3),
        arrived: false,
      });
    }

    this._arrivalsLeft = this._wisps.length;
    this._total = this.travelMs + this.staggerMs + 40 + this.fadeTail + 60;
    if (this._wisps.length === 0) this.done = true;
  }

  /** Attach damage to be delivered by the (remaining) wisp arrivals. */
  addPayload(amount) {
    if (!amount || amount <= 0) return;
    this._payload += amount;
    // Every wisp already landed → nothing left to sync to; flush now.
    if (this._arrivalsLeft <= 0) this._flushPayload(true);
  }

  /** True while arrivals (and their payload chunks) are still pending. */
  get delivering() {
    return !this.done && this._arrivalsLeft > 0;
  }

  _deliver(chunk, isLast) {
    if (chunk <= 0 && !isLast) return;
    if (this._onDeliver) this._onDeliver(chunk, isLast);
  }

  _flushPayload(isLast) {
    const rest = this._payload;
    this._payload = 0;
    if (rest > 0 || isLast) this._deliver(rest, isLast);
  }

  update(dt) {
    if (this.done) return;
    this.elapsed += dt;

    for (const w of this._wisps) {
      if (w.arrived) continue;
      const t = this.elapsed - w.delay;
      if (t >= w.dur) {
        w.arrived = true;
        this._arrivalsLeft--;
        const isLast = this._arrivalsLeft <= 0;
        // Even share of what's left, remainder rides the last arrival.
        const chunk = isLast
          ? this._payload
          : Math.round(this._payload / (this._arrivalsLeft + 1));
        this._payload -= chunk;
        this._deliver(chunk, isLast);
        if (isLast) this._payloadFlushed = true;
      }
    }

    if (this.elapsed >= this._total) {
      // Safety: never end with undelivered payload (damage feedback must
      // not vanish if timing went sideways).
      if (this._payload > 0) this._flushPayload(true);
      this.done = true;
    }
  }

  _segPoint(w, p, out) {
    const baseX = w.sx + (this.target.x - w.sx) * p;
    const baseY = w.sy + (this.target.y - w.sy) * p;
    const env = Math.sin(p * Math.PI);
    const wob = 1 + Math.sin(p * Math.PI * 2 + w.wobblePhase) * 0.3;
    const off = env * w.bow * wob;
    out.x = baseX + w.px * off;
    out.y = baseY + w.py * off;
  }

  render(ctx) {
    if (this.done) return;

    const glow = getGlowSprite();
    const TAIL = 0.2;
    const SEGS = 7;

    ctx.save();
    ctx.lineCap = 'round';

    for (const w of this._wisps) {
      const t = this.elapsed - w.delay;
      if (t <= 0) continue;

      const head = Math.min(1, t / w.dur);
      let alpha;
      if (head >= 1) {
        alpha = Math.max(0, 1 - (t - w.dur) / this.fadeTail);
      } else {
        alpha = Math.min(1, head * 3);
      }
      if (alpha <= 0) continue;

      const tailStart = Math.max(0, head - TAIL);

      // Trail: additive two-pass streak (wide-soft + thin-bright).
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.thickness * 1.5;
      this._strokePath(ctx, w, tailStart, head, SEGS);

      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = this.coreColor;
      ctx.lineWidth = this.thickness * 0.5;
      this._strokePath(ctx, w, tailStart, head, SEGS);

      this._segPoint(w, head, this._pA);

      // Glow under the head.
      const r = this.thickness * 2.4;
      if (glow) {
        ctx.globalAlpha = alpha * 0.9;
        ctx.drawImage(glow, this._pA.x - r, this._pA.y - r, r * 2, r * 2);
      }

      // Ghost skull head — the tile art tumbling in NORMAL blending (additive
      // would wash the dark art out), shrinking as it nears the portrait.
      if (head < 1 && this.headImage) {
        const size = this.headSize * (1 - head * 0.45);
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha * 0.82;
        ctx.translate(this._pA.x, this._pA.y);
        ctx.rotate(w.wobblePhase + this.elapsed * w.spin);
        ctx.drawImage(this.headImage, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }

    ctx.restore();
  }

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
