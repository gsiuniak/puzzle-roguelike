/**
 * BloodSplashEffect — a dramatic burst of opaque liquid "blood" droplets.
 *
 * Used when Lord Malakor's Usurper's Heart HARVESTS a Thrall tile: blood
 * splashes from the tile's board location. Unlike TileParticleEffect (which
 * renders with additive 'lighter' blending for a magical glow), this effect is
 * meant to read as VISCOUS LIQUID — so it is an externally-managed floating
 * effect rendered with NORMAL ('source-over') blending on top of the board.
 *
 * Droplets launch outward (biased upward) in a fan, arc under gravity, stretch
 * into streaks along their velocity, and fade as they die. A quick central
 * "splat" blob anchors the origin.
 *
 * Not a UIElement — uses absolute screen-local coordinates. Lives in
 * BattleScene._floatingEffects (same contract as HarvestTendrilEffect:
 * update(dt) / render(ctx) / done).
 */

export default class BloodSplashEffect {
  /**
   * @param {number} x  - origin X in screen-local pixels
   * @param {number} y  - origin Y in screen-local pixels
   * @param {object} [config]
   * @param {number} [config.scale=1]          - overall size multiplier (scale to cell size)
   * @param {number} [config.dropletCount=20]  - number of droplets
   * @param {number} [config.gravity=1500]     - downward accel (px/s², pre-scale)
   * @param {string[]} [config.colors]         - droplet color palette (hex)
   */
  constructor(x, y, config = {}) {
    this.x = x;
    this.y = y;
    this.done = false;
    this.elapsed = 0;

    const scale = config.scale || 1;
    const dropletCount = config.dropletCount || 20;
    const colors = config.colors || ['#7a0000', '#9e0a0a', '#c01818', '#5a0000'];

    this._gravity = (config.gravity || 1500) * scale;

    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,color:string,delay:number,active:boolean}>} */
    this.droplets = [];
    for (let i = 0; i < dropletCount; i++) {
      // Fan biased into the upper hemisphere so it reads as an upward splash.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
      const speed = (170 + Math.random() * 520) * scale;
      const life = 340 + Math.random() * 460;
      this.droplets.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: (2.5 + Math.random() * 5.5) * scale,
        color: colors[(Math.random() * colors.length) | 0],
        delay: Math.random() * 45,
        active: false,
      });
    }

    // Central splat blob — quick expand + fade to anchor the origin.
    this._splatMaxR = (16 + Math.random() * 10) * scale;
    this._splatDuration = 240;
    this._splatColor = colors[colors.length - 1];

    this._maxLife = Math.max(
      this._splatDuration,
      ...this.droplets.map((d) => d.maxLife + d.delay)
    );
  }

  /**
   * Advance the splash by dt milliseconds.
   * @param {number} dt - delta time in ms
   */
  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    const dtSec = dt / 1000;
    let anyAlive = false;

    for (const d of this.droplets) {
      if (!d.active) {
        if (this.elapsed >= d.delay) d.active = true;
        else { anyAlive = true; continue; }
      }
      d.life -= dt;
      if (d.life <= 0) { d.life = 0; continue; }
      anyAlive = true;

      d.vy += this._gravity * dtSec;
      d.vx *= 0.99; // light air drag
      d.x += d.vx * dtSec;
      d.y += d.vy * dtSec;
    }

    if (!anyAlive && this.elapsed >= this._maxLife) this.done = true;
  }

  /**
   * Render the splash. Caller uses normal ('source-over') blending.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.done) return;
    ctx.save();

    // ── Central splat blob ──
    if (this.elapsed <= this._splatDuration) {
      const t = this.elapsed / this._splatDuration;
      const r = this._splatMaxR * (0.4 + 0.6 * t);
      const alpha = (1 - t) * 0.85;
      ctx.fillStyle = this._rgba(this._splatColor, alpha);
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Droplets ──
    for (const d of this.droplets) {
      if (!d.active || d.life <= 0) continue;
      const frac = d.life / d.maxLife;
      // Hold full opacity, then fade over the last 35% of life.
      const alpha = frac > 0.35 ? 1 : frac / 0.35;

      const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
      // Stretch into a liquid streak along the direction of travel.
      const stretch = 1 + Math.min(2.4, speed * 0.0032);

      ctx.save();
      ctx.translate(d.x, d.y);
      if (speed > 5) {
        ctx.rotate(Math.atan2(d.vy, d.vx));
        ctx.scale(stretch, 1 / Math.sqrt(stretch)); // preserve area
      }
      ctx.fillStyle = this._rgba(d.color, alpha);
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.5, d.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /** Hex color + alpha → rgba string. */
  _rgba(hex, alpha) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
