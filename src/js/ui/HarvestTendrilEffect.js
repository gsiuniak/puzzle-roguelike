/**
 * HarvestTendrilEffect — animated "harvest" tendrils.
 *
 * Spirals of energy travel from a set of source board cells toward a single
 * target point (a portrait), then flare and fade. Used by BattleScene for the
 * Baron's Signet Thrall harvest: red tendrils spiral from each harvested Thrall
 * tile to the boss's portrait.
 *
 * Not a UIElement — uses absolute (design-space) coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect): construct, call update(dt) + render(ctx) each frame, and
 * remove the instance once `done` is true.
 *
 * Lifecycle (per tendril, all share the same clock):
 *   TRAVEL: the tendril head advances source → target along a decaying spiral
 *   HOLD:   brief bright flare at the target
 *   FADE:   whole effect fades out
 *
 * Everything is tunable via the config object so the harvest feel (color,
 * spiral tightness, speed) can be retuned without touching the battle logic.
 */
export default class HarvestTendrilEffect {
  /**
   * @param {Array<{x:number,y:number}>} sources - origin points (design space)
   * @param {{x:number,y:number}} target - destination point (design space)
   * @param {object} [config]
   * @param {string} [config.color='#d22a2a'] - tendril color
   * @param {number} [config.travelDuration=480] - ms, head source→target
   * @param {number} [config.holdDuration=70]    - ms, flare at target
   * @param {number} [config.fadeDuration=220]   - ms, fade out
   * @param {number} [config.spiralTurns=2.4]    - half-oscillations along the path
   * @param {number} [config.amplitude=46]       - max spiral offset (px) near source
   * @param {number} [config.thickness=4]        - stroke width at the head
   * @param {number} [config.tailFraction=0.45]  - portion of the path drawn behind the head
   */
  constructor(sources, target, config = {}) {
    this.target = target;
    this.color = config.color || '#d22a2a';

    this.travelDuration = config.travelDuration || 480;
    this.holdDuration = config.holdDuration || 70;
    this.fadeDuration = config.fadeDuration || 220;
    this.spiralTurns = config.spiralTurns != null ? config.spiralTurns : 2.4;
    this.amplitude = config.amplitude != null ? config.amplitude : 46;
    this.thickness = config.thickness || 4;
    this.tailFraction = config.tailFraction != null ? config.tailFraction : 0.45;

    this.elapsed = 0;
    this.done = false;

    this._fadeStart = this.travelDuration + this.holdDuration;
    this._total = this._fadeStart + this.fadeDuration;

    // Precompute a per-tendril geometry: direction, perpendicular, length, and a
    // small phase offset so the spirals don't move in lockstep.
    this._tendrils = (sources || []).map((s, i) => {
      const dx = target.x - s.x;
      const dy = target.y - s.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      return {
        sx: s.x, sy: s.y,
        // unit perpendicular to the source→target direction
        px: -dy / len, py: dx / len,
        phase: i * 0.7,
        // alternate spiral handedness per tendril for variety
        sign: i % 2 === 0 ? 1 : -1,
      };
    });
  }

  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= this._total) this.done = true;
  }

  /** Overall alpha (1 during travel+hold, easing to 0 over fade). */
  get _alpha() {
    if (this.elapsed <= this._fadeStart) return 1;
    const p = (this.elapsed - this._fadeStart) / this.fadeDuration;
    return Math.max(0, 1 - p * p);
  }

  /** Head progress 0→1 along the path (ease-in so it accelerates inward). */
  get _head() {
    const p = Math.min(1, this.elapsed / this.travelDuration);
    return p * p * (3 - 2 * p); // smoothstep
  }

  /**
   * Point on a tendril's spiral path at parameter u in [0,1].
   * Linear source→target plus a perpendicular sine offset that decays to 0 at
   * the target, so all tendrils converge cleanly on the portrait.
   */
  _pointAt(t, u) {
    const baseX = t.sx + (this.target.x - t.sx) * u;
    const baseY = t.sy + (this.target.y - t.sy) * u;
    const wobble = Math.sin(u * Math.PI * this.spiralTurns + t.phase) * (1 - u) * this.amplitude * t.sign;
    return { x: baseX + t.px * wobble, y: baseY + t.py * wobble };
  }

  render(ctx) {
    if (this.done) return;
    const alpha = this._alpha;
    if (alpha <= 0) return;

    const head = this._head;
    const tailStart = Math.max(0, head - this.tailFraction);
    const STEPS = 18;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter'; // additive glow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;

    for (const t of this._tendrils) {
      // Draw the trailing segment from tail → head, thinning toward the tail.
      ctx.strokeStyle = this.color;
      let prev = this._pointAt(t, tailStart);
      for (let i = 1; i <= STEPS; i++) {
        const f = i / STEPS;
        const u = tailStart + (head - tailStart) * f;
        const pt = this._pointAt(t, u);
        ctx.lineWidth = this.thickness * (0.25 + 0.75 * f);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        prev = pt;
      }

      // Bright head node travelling toward the portrait.
      const headPt = this._pointAt(t, head);
      ctx.fillStyle = '#ffe2d0';
      ctx.beginPath();
      ctx.arc(headPt.x, headPt.y, this.thickness * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flare at the target once the heads start arriving / during hold.
    if (this.elapsed >= this.travelDuration * 0.7) {
      const flareP = Math.min(1, (this.elapsed - this.travelDuration * 0.7) / (this.travelDuration * 0.3 + this.holdDuration));
      const r = 8 + flareP * 26;
      const grad = ctx.createRadialGradient(this.target.x, this.target.y, 0, this.target.x, this.target.y, r);
      grad.addColorStop(0, this.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.target.x, this.target.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
