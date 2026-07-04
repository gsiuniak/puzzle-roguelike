/**
 * HarvestTendrilEffect — continuous red "energy tendril" connection.
 *
 * Draws a persistent, writhing tendril of energy CONNECTING each source board
 * cell to a single target point (a portrait) for the whole life of the effect —
 * rather than a single pellet that flies across. Used by BattleScene for the
 * Usurper's Heart Thrall harvest: red energy tendrils stay connected from each
 * harvested Thrall tile to the boss's portrait, with bright pulses flowing
 * along them toward him, then the whole thing fades.
 *
 * Not a UIElement — uses absolute (design-space) coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect): construct, call update(dt) + render(ctx) each frame, and
 * remove the instance once `done` is true.
 *
 * Lifecycle (all tendrils share one clock):
 *   FORM: the connection grows from each source out to the target
 *   HOLD: the full source↔target connection writhes; pulses flow toward target
 *   FADE: the whole effect fades out
 *
 * The path is a straight source→target line plus an animated perpendicular
 * offset whose wave SCROLLS over time (toward the target) so the tendril looks
 * like live, flowing energy. A sine envelope pins the offset to 0 at BOTH ends
 * so every strand stays visually anchored to the tile and the portrait.
 *
 * Everything is tunable via the config object so the harvest feel (color,
 * writhe, flow speed, strand count) can be retuned without touching battle logic.
 */
// ── Baked glow sprites ──────────────────────────────────────────────────────
// Mobile tuning (same rationale as ManaStreamEffect): NO ctx.shadowBlur — the
// additive 'lighter' blend + a wide faint halo stroke supply the glow — and the
// pulse/anchor/flare radial gradients are baked ONCE per color pair into small
// sprites (module cache) instead of createRadialGradient every frame.
const GLOW_SPRITE_R = 32;
const _glowCache = new Map(); // `${kind}|${color}|${coreColor}` → canvas

function _bakeGlow(kind, color, coreColor) {
  const key = kind + '|' + color + '|' + coreColor;
  let cv = _glowCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = GLOW_SPRITE_R * 2;
  const c = cv.getContext('2d');
  const r = GLOW_SPRITE_R;
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  if (kind === 'pulse') {
    g.addColorStop(0, coreColor);
    g.addColorStop(0.4, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
  } else if (kind === 'flare') {
    g.addColorStop(0, coreColor);
    g.addColorStop(0.35, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
  } else { // 'anchor'
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  c.fillStyle = g;
  c.fillRect(0, 0, GLOW_SPRITE_R * 2, GLOW_SPRITE_R * 2);
  _glowCache.set(key, cv);
  return cv;
}

export default class HarvestTendrilEffect {
  /**
   * @param {Array<{x:number,y:number}>} sources - origin points (design space)
   * @param {{x:number,y:number}} target - destination point (design space)
   * @param {object} [config]
   * @param {string} [config.color='#d22a2a'] - tendril color
   * @param {number} [config.formDuration=240] - ms, connection grows out to target
   * @param {number} [config.holdDuration=420] - ms, full connection writhes
   * @param {number} [config.fadeDuration=260] - ms, fade out
   * @param {number} [config.waveCount=2.2]    - spatial oscillations along the path
   * @param {number} [config.amplitude=42]     - max perpendicular writhe (px)
   * @param {number} [config.flowSpeed=0.010]  - wave scroll rate (rad/ms, toward target)
   * @param {number} [config.thickness=7]      - base stroke width
   * @param {number} [config.strands=3]        - parallel energy strands per source
   * @param {number} [config.pulses=2]         - bright pulses flowing along each strand
   * @param {number} [config.pulseSpeed=0.0017]- pulse travel rate (path-fraction/ms)
   * @param {string} [config.coreColor='#ffd2c2'] - hot inner-core / pulse / flare color
   * @param {boolean}[config.continuous=false] - when true the connection never fades
   *   or completes (stays at full strength forever) — caller drops the instance to
   *   end it. Used for the sustained Skill-Weave crucible beams.
   */
  constructor(sources, target, config = {}) {
    this.target = target;
    this.color = config.color || '#d22a2a';
    this.coreColor = config.coreColor || '#ffd2c2';
    this.continuous = !!config.continuous;

    this.formDuration = config.formDuration != null ? config.formDuration : 240;
    this.holdDuration = config.holdDuration != null ? config.holdDuration : 420;
    this.fadeDuration = config.fadeDuration != null ? config.fadeDuration : 260;

    this.waveCount = config.waveCount != null ? config.waveCount : 2.2;
    this.amplitude = config.amplitude != null ? config.amplitude : 42;
    this.flowSpeed = config.flowSpeed != null ? config.flowSpeed : 0.010;
    this.thickness = config.thickness != null ? config.thickness : 7;
    this.strandsPerSource = config.strands != null ? config.strands : 3;
    this.pulsesPerStrand = config.pulses != null ? config.pulses : 2;
    this.pulseSpeed = config.pulseSpeed != null ? config.pulseSpeed : 0.0017;

    this.elapsed = 0;
    this.done = false;

    this._holdStart = this.formDuration;
    this._fadeStart = this.formDuration + this.holdDuration;
    this._total = this._fadeStart + this.fadeDuration;

    // Precompute per-source geometry + a few independently-phased strands so the
    // tendril reads as a small bundle of writhing energy rather than one line.
    this._tendrils = (sources || []).map((s) => {
      const dx = target.x - s.x;
      const dy = target.y - s.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const px = -dy / len; // unit perpendicular to source→target
      const py = dx / len;

      const strands = [];
      for (let i = 0; i < this.strandsPerSource; i++) {
        const pulses = [];
        for (let k = 0; k < this.pulsesPerStrand; k++) {
          pulses.push((k + Math.random() * 0.5) / Math.max(1, this.pulsesPerStrand));
        }
        strands.push({
          phase: i * 2.1 + Math.random() * 0.6,
          sign: i % 2 === 0 ? 1 : -1,
          ampScale: 1 - i * 0.24,        // inner strands writhe a little less
          widthScale: 1 - i * 0.18,
          pulses,
        });
      }

      return { sx: s.x, sy: s.y, px, py, strands };
    });

    // Reusable scratch polyline (STEPS+1 points) — filled in place each strand
    // so render allocates nothing per frame.
    this._scratchPts = [];
    for (let i = 0; i <= HarvestTendrilEffect.STEPS; i++) this._scratchPts.push({ x: 0, y: 0 });
  }

  static STEPS = 26;

  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    if (!this.continuous && this.elapsed >= this._total) this.done = true;
  }

  /** Overall alpha (1 during form+hold, easing to 0 over fade; always 1 if continuous). */
  get _alpha() {
    if (this.continuous) return 1;
    if (this.elapsed <= this._fadeStart) return 1;
    const p = (this.elapsed - this._fadeStart) / this.fadeDuration;
    return Math.max(0, 1 - p * p);
  }

  /** How far the connection has grown out to the target (0→1, then pinned at 1). */
  get _head() {
    if (this.elapsed >= this._holdStart) return 1;
    const p = Math.min(1, this.elapsed / this.formDuration);
    return p * p * (3 - 2 * p); // smoothstep
  }

  /**
   * Point on a strand at path parameter u in [0,1] at the current time.
   * Straight source→target plus a perpendicular, time-scrolling wave whose
   * amplitude is enveloped to 0 at both ends (sin(u·π)).
   */
  _pointAt(t, strand, u, out) {
    const baseX = t.sx + (this.target.x - t.sx) * u;
    const baseY = t.sy + (this.target.y - t.sy) * u;
    const env = Math.sin(u * Math.PI); // 0 at both ends, peaks mid-path
    const phase = strand.phase - this.elapsed * this.flowSpeed; // scroll toward target
    const wave =
      Math.sin(u * this.waveCount * Math.PI * 2 + phase) * 0.72 +
      Math.sin(u * this.waveCount * 1.7 * Math.PI * 2 + phase * 1.6) * 0.28;
    const w = env * this.amplitude * strand.ampScale * strand.sign * wave;
    out.x = baseX + t.px * w;
    out.y = baseY + t.py * w;
    return out;
  }

  render(ctx) {
    if (this.done) return;
    const alpha = this._alpha;
    if (alpha <= 0) return;

    const head = this._head;
    const STEPS = HarvestTendrilEffect.STEPS;
    const pts = this._scratchPts;
    const pulseSprite = _bakeGlow('pulse', this.color, this.coreColor);
    const anchorSprite = _bakeGlow('anchor', this.color, this.coreColor);
    const flareSprite = _bakeGlow('flare', this.color, this.coreColor);
    const scratch = pts[0]; // reused for pulse positions too

    ctx.save();
    ctx.globalAlpha *= alpha;
    const baseAlpha = ctx.globalAlpha; // includes any host fade (multiplied, not overwritten)
    ctx.globalCompositeOperation = 'lighter'; // additive glow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // NOTE: deliberately NO ctx.shadowBlur here — blurred strokes are the most
    // expensive canvas op on mobile. The additive blend + the wide faint halo
    // stroke below read as the same glow at a fraction of the cost.

    for (const t of this._tendrils) {
      for (const strand of t.strands) {
        // Build the polyline source(0) → head along the strand (in place).
        for (let i = 0; i <= STEPS; i++) {
          const u = head * (i / STEPS);
          this._pointAt(t, strand, u, pts[i]);
        }

        // Wide faint halo pass (replaces the old shadowBlur glow).
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = baseAlpha * 0.30;
        ctx.lineWidth = this.thickness * strand.widthScale * 2.4;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= STEPS; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.globalAlpha = baseAlpha;

        // Outer glow pass (wide, colored).
        ctx.lineWidth = this.thickness * strand.widthScale;
        ctx.stroke(); // same path is still current

        // Bright inner core pass (thin, hot) for an energy look.
        ctx.strokeStyle = this.coreColor;
        ctx.lineWidth = Math.max(1, this.thickness * strand.widthScale * 0.35);
        ctx.stroke();

        // Energy pulses flowing along the connection toward the target
        // (baked radial sprite instead of a per-pulse gradient).
        for (const offset of strand.pulses) {
          let pu = (this.elapsed * this.pulseSpeed + offset) % 1;
          if (pu > head) continue;
          const p = this._pointAt(t, strand, pu, scratch);
          const r = this.thickness * strand.widthScale * (0.7 + 0.4 * Math.sin(pu * Math.PI)) * 2.2;
          ctx.drawImage(pulseSprite, p.x - r, p.y - r, r * 2, r * 2);
        }
      }

      // Small anchor glow pinning the bundle to the tile location.
      const aR = this.thickness * 1.4;
      ctx.drawImage(anchorSprite, t.sx - aR, t.sy - aR, aR * 2, aR * 2);
    }

    // Sustained flare where every tendril converges on the portrait, present
    // once the connection has (mostly) formed.
    if (this.elapsed >= this.formDuration * 0.6) {
      const r = 10 + 22 * Math.min(1, head);
      ctx.drawImage(flareSprite, this.target.x - r, this.target.y - r, r * 2, r * 2);
    }

    ctx.restore();
  }
}
