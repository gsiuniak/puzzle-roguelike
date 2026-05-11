/**
 * TileParticleEffect — animated particle burst when a tile is destroyed.
 *
 * Spawns a small burst of lightweight particles at a given screen position
 * that disperse outward, fade, and shrink. Particles use the tile's
 * particleColor for a polished match-3 feel.
 *
 * Not a UIElement — uses absolute screen coordinates and is managed
 * externally by BattleScene.
 *
 * Lifecycle:
 *   1. Instantiate with origin (center x, y), particle color, and base size.
 *   2. Call update(dt) each frame.
 *   3. Call render(ctx) each frame.
 *   4. Check `done` property — when true, remove the instance.
 *
 * Each particle:
 *   - Starts at the origin with a random outward velocity
 *   - Has a short lifetime (~250-400ms with variance)
 *   - Fades alpha from 1 → 0
 *   - Shrinks slightly as it fades
 *   - Rendered as a small circle with a soft radial glow
 */

export default class TileParticleEffect {
  /**
   * @param {number} originX      - center X in screen coordinates
   * @param {number} originY      - center Y in screen coordinates
   * @param {string} color        - CSS color for the particle fill (e.g., '#E74C3C')
   * @param {number} baseSize     - base particle radius in pixels (scales with board cell size)
   * @param {object} [config]
   * @param {number} [config.particleCount=8]   - number of particles in the burst
   * @param {number} [config.minLife=200]        - minimum particle lifetime (ms)
   * @param {number} [config.maxLife=400]        - maximum particle lifetime (ms)
   * @param {number} [config.minSpeed=15]        - minimum initial speed (px/s at 1s scale)
   * @param {number} [config.maxSpeed=60]        - maximum initial speed (px/s at 1s scale)
   * @param {number} [config.gravity=30]         - downward drift (px/s²)
   */
  constructor(originX, originY, color, baseSize, config = {}) {
    this.originX = originX;
    this.originY = originY;
    this.color = color;
    this.baseSize = baseSize;

    this.elapsed = 0;           // ms since creation
    this.done = false;          // true when all particles expired

    const particleCount = config.particleCount || 8;
    const minLife = config.minLife || 200;
    const maxLife = config.maxLife || 400;
    const minSpeed = config.minSpeed || 15;
    const maxSpeed = config.maxSpeed || 60;
    const gravity = config.gravity || 30;

    /** @type {Array<{x:number, y:number, vx:number, vy:number, life:number, maxLife:number, size:number}>} */
    this.particles = [];

    for (let i = 0; i < particleCount; i++) {
      // Random direction with slight upward bias for a burst feel
      const angle = Math.random() * Math.PI * 2;
      // Bias: more particles go upward/sideways than straight down
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      const vx = Math.cos(angle) * speed;
      // Slight upward bias — reduce downward velocity
      const vy = Math.sin(angle) * speed * 0.8 - 10;

      const life = minLife + Math.random() * (maxLife - minLife);

      // Slight size variation per particle
      const sizeVariation = 0.6 + Math.random() * 0.8;

      this.particles.push({
        x: originX + (Math.random() - 0.5) * baseSize * 0.5,
        y: originY + (Math.random() - 0.5) * baseSize * 0.5,
        vx,
        vy,
        life,
        maxLife: life,
        size: baseSize * sizeVariation,
      });
    }

    this._gravity = gravity;
    // Track max life for done detection
    this._maxLife = Math.max(...this.particles.map(p => p.maxLife));
  }

  /**
   * Advance animation by dt milliseconds.
   * @param {number} dt - delta time in ms
   */
  update(dt) {
    if (this.done) return;
    this.elapsed += dt;

    // Convert dt from ms to seconds for velocity calculations
    const dtSec = dt / 1000;

    let anyAlive = false;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        p.life = 0;
        continue;
      }
      anyAlive = true;

      // Move particle
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;

      // Apply gravity
      p.vy += this._gravity * dtSec;

      // Slight drag for a natural feel
      p.vx *= 0.98;
      p.vy *= 0.98;
    }

    if (!anyAlive && this.elapsed >= this._maxLife + 50) {
      this.done = true;
    }
  }

  /**
   * Current alpha for a particle based on its remaining life fraction.
   * Uses ease-out for smooth fade.
   * @param {object} particle
   * @returns {number}
   */
  _particleAlpha(particle) {
    if (particle.life <= 0) return 0;
    const fraction = particle.life / particle.maxLife;
    // Ease-out cubic: particles stay bright longer, then fade quickly
    return fraction * fraction * fraction;
  }

  /**
   * Current scale for a particle based on its remaining life fraction.
   * Particles shrink slightly as they die.
   * @param {object} particle
   * @returns {number}
   */
  _particleScale(particle) {
    if (particle.life <= 0) return 0;
    const fraction = particle.life / particle.maxLife;
    // Shrink to 30% of original size by end of life
    return 0.3 + 0.7 * fraction;
  }

  /**
   * Render the particle burst to a canvas context.
   * Uses additive-style blending (lighter composite) for a soft glow.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.done) return;

    ctx.save();

    for (const p of this.particles) {
      const alpha = this._particleAlpha(p);
      if (alpha <= 0.01) continue;

      const scale = this._particleScale(p);
      const radius = Math.max(0.5, p.size * scale);

      const x = Math.floor(p.x);
      const y = Math.floor(p.y);

      // Outer glow — larger, softer, more transparent
      const glowRadius = radius * 2.5;
      const glowGradient = ctx.createRadialGradient(x, y, radius * 0.3, x, y, glowRadius);
      glowGradient.addColorStop(0, this._rgba(this.color, alpha * 0.7));
      glowGradient.addColorStop(0.4, this._rgba(this.color, alpha * 0.3));
      glowGradient.addColorStop(1, this._rgba(this.color, 0));

      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core — small, bright
      const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      coreGradient.addColorStop(0, 'rgba(255, 255, 255, ' + (alpha * 0.9) + ')');
      coreGradient.addColorStop(0.5, this._rgba(this.color, alpha * 0.8));
      coreGradient.addColorStop(1, this._rgba(this.color, 0));

      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Convert a hex color and alpha to rgba string.
   * @param {string} hex - e.g., '#E74C3C'
   * @param {number} alpha - 0..1
   * @returns {string} rgba() string
   */
  _rgba(hex, alpha) {
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
