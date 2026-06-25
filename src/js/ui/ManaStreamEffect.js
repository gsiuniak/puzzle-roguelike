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
 */
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
   * @param {number} [config.trail=8]             - trail sample count
   * @param {number} [config.fadeTail=140]        - ms a wisp fades after arriving
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
    this.trail = config.trail != null ? config.trail : 8;
    this.fadeTail = config.fadeTail != null ? config.fadeTail : 140;

    this._onArrive = typeof config.onArrive === 'function' ? config.onArrive : null;
    this._arriveAt = this.travelMs * 0.78;
    this._arrived = false;

    this.elapsed = 0;
    this.done = false;

    const maxSources = config.maxSources != null ? config.maxSources : 6;
    const srcs = (sources || []).slice(0, maxSources);

    this._wisps = [];
    for (let i = 0; i < srcs.length; i++) {
      for (let k = 0; k < this.wispsPerSource; k++) {
        const delay = Math.random() * this.staggerMs;
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

    this._total = this.travelMs + this.staggerMs + this.fadeTail + 60;
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

  /** Point on a wisp's bowed path at fraction p in [0,1]. */
  _pointAt(w, p) {
    const baseX = w.sx + (this.target.x - w.sx) * p;
    const baseY = w.sy + (this.target.y - w.sy) * p;
    const env = Math.sin(p * Math.PI); // pin offset to 0 at both ends
    const wob = 1 + Math.sin(p * Math.PI * 2 + w.wobblePhase) * 0.35;
    const off = env * w.bow * wob;
    return { x: baseX + w.px * off, y: baseY + w.py * off };
  }

  render(ctx) {
    if (this.done) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // additive glow
    ctx.lineCap = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;

    const TAIL = 0.16; // trailing streak length as a path fraction

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

      // Trailing streak, tapering in width + alpha toward the tail.
      const pts = [];
      for (let s = 0; s <= this.trail; s++) {
        const f = s / this.trail; // 0 tail → 1 head
        const p = Math.max(0, head - TAIL * (1 - f));
        pts.push({ pt: this._pointAt(w, p), f });
      }
      for (let s = 1; s < pts.length; s++) {
        const a = pts[s - 1].pt;
        const b = pts[s].pt;
        const seg = pts[s].f;
        ctx.globalAlpha = alpha * seg * 0.9;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.thickness * (0.3 + seg * 0.9);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Bright head.
      const hp = this._pointAt(w, head);
      ctx.globalAlpha = alpha;
      const r = this.thickness * 1.3;
      const g = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, r * 2);
      g.addColorStop(0, this.coreColor);
      g.addColorStop(0.4, this.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, r * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
