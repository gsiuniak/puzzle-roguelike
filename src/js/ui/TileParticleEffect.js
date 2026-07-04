/**
 * TileParticleEffect — magical gem explosion burst when a tile is destroyed.
 *
 * Creates a juicy, energetic burst with:
 *   1. Quick radial flash/pop at origin
 *   2. Staggered particles that arc outward with organic drift
 *   3. Tiny trailing sparkles that linger briefly
 *   4. Velocity-based stretch and smooth fade+shrink
 *
 * Rendered with additive blending ('lighter') for a magical glow feel.
 * Designed to render BETWEEN board background and tiles so tiles
 * always stay visually dominant.
 *
 * Not a UIElement — uses absolute board-local coordinates.
 * Managed by BattleScene, rendered by BoardPlaceholder.
 *
 * Lifecycle:
 *   1. Instantiate with origin, color, baseSize.
 *   2. Call update(dt) each frame.
 *   3. Call render(ctx) each frame (with additive blending by caller).
 *   4. Check `done` property — when true, remove.
 */

// ── Baked glow sprites ──────────────────────────────────────────────────────
// Mobile tuning: building 2 radial gradients PER PARTICLE PER FRAME (glow +
// core) was the dominant cascade cost — a big cascade has 100+ live particles.
// Instead each gradient look is baked ONCE per tile color into a small
// offscreen sprite (module cache, a handful of colors total) and drawn with a
// plain scaled drawImage + globalAlpha. Alpha stops scale linearly, so
// multiplying globalAlpha by the particle alpha reproduces the old gradients
// exactly.
const SPRITE_R = 32; // baked sprite radius in px (drawn scaled)
const _spriteCache = new Map(); // `${kind}|${color}` → canvas

function _rgbaFromHex(hex, alpha) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * kind: 'glow'  — soft outer halo (color 0.65 → 0.25 → 0)
 *       'core'  — bright center (white 0.95 → color 0.8 → 0)
 *       'flash' — burst pop glow (white 0.9 → color 0.55 → 0)
 */
function _getSprite(kind, color) {
  const key = kind + '|' + color;
  let cv = _spriteCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE_R * 2;
  const c = cv.getContext('2d');
  const r = SPRITE_R;
  let g;
  if (kind === 'glow') {
    g = c.createRadialGradient(r, r, r * 0.043, r, r, r);
    g.addColorStop(0, _rgbaFromHex(color, 0.65));
    g.addColorStop(0.3, _rgbaFromHex(color, 0.25));
    g.addColorStop(1, 'rgba(0,0,0,0)');
  } else if (kind === 'core') {
    g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, _rgbaFromHex(color, 0.8));
    g.addColorStop(1, _rgbaFromHex(color, 0));
  } else { // 'flash'
    g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, _rgbaFromHex(color, 0.55));
    g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  c.fillStyle = g;
  c.fillRect(0, 0, SPRITE_R * 2, SPRITE_R * 2);
  _spriteCache.set(key, cv);
  return cv;
}

export default class TileParticleEffect {
  /**
   * @param {number} originX   - center X in board-local pixels
   * @param {number} originY   - center Y in board-local pixels
   * @param {string} color     - hex color for the burst (e.g., '#E74C3C')
   * @param {number} baseSize  - base particle radius (scales with cell size)
   * @param {object} [config]
   * @param {number} [config.particleCount=12]   - primary burst particles
   * @param {number} [config.sparkCount=6]       - trailing spark particles
   * @param {number} [config.minLife=250]        - min particle lifetime (ms)
   * @param {number} [config.maxLife=500]        - max particle lifetime (ms)
   * @param {number} [config.minSpeed=20]        - min initial speed (px/s)
   * @param {number} [config.maxSpeed=100]       - max initial speed (px/s)
   * @param {number} [config.gravity=25]         - downward drift (px/s²)
   */
  constructor(originX, originY, color, baseSize, config = {}) {
    this.originX = originX;
    this.originY = originY;
    this.color = color;
    this.baseSize = baseSize;

    this.elapsed = 0;
    this.done = false;

    // ── Flash config ──
    this._flashDuration = 100;          // ms for flash ring
    this._flashMaxRadius = baseSize * 4.5;
    this._flashAlpha = 1.0;

    // ── Particle config ──
    const particleCount = config.particleCount || 12;
    const sparkCount = config.sparkCount || 6;
    const minLife = config.minLife || 250;
    const maxLife = config.maxLife || 500;
    const minSpeed = config.minSpeed || 20;
    const maxSpeed = config.maxSpeed || 100;
    const gravity = config.gravity || 25;

    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,delay:number,active:boolean,drift:number,driftFreq:number,isSpark:boolean,twinkle:number}>} */
    this.particles = [];

    // ── Primary burst particles ──
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;

      // Two-tier: ~30% fast far-shards
      const isFast = Math.random() < 0.30;
      const speed = isFast
        ? maxSpeed * 0.7 + Math.random() * maxSpeed * 0.3
        : minSpeed + Math.random() * (maxSpeed * 0.55 - minSpeed);

      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      const life = minLife + Math.random() * (maxLife - minLife);
      const sizeVar = isFast ? (0.45 + Math.random() * 0.35) : (0.65 + Math.random() * 0.55);
      const delay = Math.random() * 70; // stagger 0–70ms

      // Arc/drift parameters: each particle gets a slight perpendicular
      // acceleration that oscillates, creating organic curving motion
      const drift = (Math.random() - 0.5) * 80;  // drift strength
      const driftFreq = 3 + Math.random() * 5;    // oscillation speed

      this.particles.push({
        x: originX,
        y: originY,
        vx, vy,
        life,
        maxLife: life,
        size: baseSize * sizeVar,
        delay,
        active: delay <= 0,
        drift,
        driftFreq,
        isSpark: false,
        twinkle: Math.random() * Math.PI * 2,
      });
    }

    // ── Trailing spark particles (smaller, softer, linger) ──
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = minSpeed * 0.4 + Math.random() * maxSpeed * 0.25;
      const life = maxLife * 0.6 + Math.random() * maxLife * 0.4; // longer life
      const delay = 40 + Math.random() * 60; // spawn after main burst
      const drift = (Math.random() - 0.5) * 40;
      const driftFreq = 2 + Math.random() * 3;

      this.particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: baseSize * (0.3 + Math.random() * 0.3), // smaller
        delay,
        active: false,
        drift,
        driftFreq,
        isSpark: true,
        twinkle: Math.random() * Math.PI * 2,
      });
    }

    this._gravity = gravity;
    this._maxTotalLife = Math.max(...this.particles.map(p => p.maxLife + p.delay));
  }

  /**
   * Advance animation by dt milliseconds.
   * @param {number} dt - delta time in ms
   */
  update(dt) {
    if (this.done) return;
    this.elapsed += dt;

    // Flash fade
    if (this.elapsed <= this._flashDuration) {
      const pct = this.elapsed / this._flashDuration;
      this._flashAlpha = 1.0 - pct * pct; // sharp ease-out
    } else {
      this._flashAlpha = 0;
    }

    const dtSec = dt / 1000;
    let anyAlive = false;

    for (const p of this.particles) {
      // Stagger activation
      if (!p.active) {
        if (this.elapsed >= p.delay) {
          p.active = true;
          p.life -= this.elapsed - p.delay;
          if (p.life <= 0) { p.life = 0; continue; }
        } else {
          anyAlive = true;
          continue;
        }
      }

      p.life -= dt;
      if (p.life <= 0) { p.life = 0; continue; }
      anyAlive = true;

      const lifeFraction = p.life / p.maxLife;

      // Rapid deceleration: fast pop then slow drift
      const decel = 0.90 + lifeFraction * 0.08;

      // Arc/drift: perpendicular force that oscillates over time
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > 0.1) {
        // Unit perpendicular vector
        const px = -p.vy / speed;
        const py = p.vx / speed;
        const driftForce = p.drift * Math.sin(this.elapsed * 0.001 * p.driftFreq) * dtSec;
        p.vx += px * driftForce;
        p.vy += py * driftForce;
      }

      p.vx *= decel;
      p.vy *= decel;
      p.vy += this._gravity * dtSec;

      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;

      // Twinkle phase advance for spark particles
      p.twinkle += dt * 0.015;
    }

    if (!anyAlive && this.elapsed >= this._flashDuration + 100 && this.elapsed >= this._maxTotalLife) {
      this.done = true;
    }
  }

  /**
   * Alpha for a particle. Sparks twinkle; main particles fade smoothly.
   */
  _particleAlpha(p) {
    if (p.life <= 0 || !p.active) return 0;
    const fraction = p.life / p.maxLife;

    if (p.isSpark) {
      // Sparks: twinkling alpha with an overall fade envelope
      const twinkle = 0.5 + 0.5 * Math.sin(p.twinkle);
      return fraction * (0.4 + 0.6 * twinkle);
    }

    // Main particles: bright pop then smooth cubic fade
    if (fraction > 0.85) return 1.0;
    return fraction * fraction;
  }

  /**
   * Scale for a particle. Shrinks as it dies.
   */
  _particleScale(p) {
    if (p.life <= 0 || !p.active) return 0;
    const fraction = p.life / p.maxLife;
    // Stay full for first 25% of life, then shrink to 10%
    if (fraction > 0.75) return 1.0;
    return 0.10 + 0.90 * ((fraction - 0.05) / 0.70);
  }

  /**
   * Render the burst. Caller should set ctx.globalCompositeOperation = 'lighter'
   * before calling for additive/magical blending.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.done) return;

    ctx.save();

    // ── Flash: expanding double ring + central glow ──
    if (this._flashAlpha > 0.005) {
      const flashPct = Math.min(1, this.elapsed / this._flashDuration);
      const ringR = this._flashMaxRadius * flashPct;
      const thick = this.baseSize * 1.8 * (1 - flashPct * 0.6);

      // Outer ring
      ctx.beginPath();
      ctx.arc(this.originX, this.originY, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = this._rgba(this.color, this._flashAlpha * 0.60);
      ctx.lineWidth = thick;
      ctx.stroke();

      // Inner tighter ring
      ctx.beginPath();
      ctx.arc(this.originX, this.originY, ringR * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = this._rgba(this.color, this._flashAlpha * 0.45);
      ctx.lineWidth = thick * 0.5;
      ctx.stroke();

      // Central pop glow (baked sprite — see _getSprite)
      const glowR = this._flashMaxRadius * 0.35;
      const flashSprite = _getSprite('flash', this.color);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * this._flashAlpha;
      ctx.drawImage(flashSprite, this.originX - glowR, this.originY - glowR, glowR * 2, glowR * 2);
      ctx.globalAlpha = prevAlpha;
    }

    // ── Particles ── (baked sprites; no per-frame gradient construction)
    const glowSprite = _getSprite('glow', this.color);
    const coreSprite = _getSprite('core', this.color);
    for (const p of this.particles) {
      if (!p.active) continue;
      const alpha = this._particleAlpha(p);
      if (alpha <= 0.02) continue;

      const scale = this._particleScale(p);
      const radius = Math.max(0.4, p.size * scale);

      // Compute velocity-based stretch
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      let stretchX = 1.0;
      let stretchY = 1.0;
      let stretchAngle = 0;
      if (speed > 5) {
        const stretchAmount = 1.0 + Math.min(1.5, speed * 0.004);
        stretchX = stretchAmount;
        stretchY = 1.0 / Math.sqrt(stretchAmount); // preserve area
        stretchAngle = Math.atan2(p.vy, p.vx);
      }

      const x = Math.floor(p.x);
      const y = Math.floor(p.y);

      ctx.save();
      ctx.translate(x, y);
      if (stretchAngle !== 0) ctx.rotate(stretchAngle);
      ctx.scale(stretchX, stretchY);
      ctx.globalAlpha *= alpha;

      // Soft outer glow
      const glowR = radius * 3.5;
      ctx.drawImage(glowSprite, -glowR, -glowR, glowR * 2, glowR * 2);

      // Bright core
      const coreR = radius * 0.55;
      ctx.drawImage(coreSprite, -coreR, -coreR, coreR * 2, coreR * 2);

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Hex color + alpha → rgba string.
   */
  _rgba(hex, alpha) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
