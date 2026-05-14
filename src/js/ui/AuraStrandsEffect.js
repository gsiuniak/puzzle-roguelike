/**
 * AuraStrandsEffect — canvas-based animated aura/aurora strands rendered
 * behind UI elements. Provides a slow, breezy, magical particle effect
 * using bezier curves with sinusoidal drift and glowing particles.
 *
 * Usage:
 *   const aura = new AuraStrandsEffect();
 *   aura.setTargetColor(r, g, b);      // smooth transition
 *   aura.setColorInstant(r, g, b);     // immediate
 *   aura.setDrawStrands(false);        // hide strands, show only floating particles
 *   aura.update(dt);                   // each frame
 *   aura.render(ctx, rect);            // draw to canvas
 *
 * All coordinates are in CSS-pixel space (context is pre-scaled by DPR).
 */

/** Default strand count */
const STRAND_COUNT = 7;

/** Number of anchor points per strand (more = wigglier) */
const ANCHORS_PER_STRAND = 5;

/** Maximum active particles when strands are visible */
const MAX_PARTICLES = 22;

/** Maximum active particles when strands are hidden (free-floating mode) */
const MAX_PARTICLES_FLOATING = 60;

/** Interval between particle spawns (seconds) */
const PARTICLE_SPAWN_INTERVAL = 0.18;

/** Interval between particle spawns when strands are hidden (seconds) */
const PARTICLE_SPAWN_INTERVAL_FLOATING = 0.06;

/** Particle lifespan (seconds) */
const PARTICLE_LIFESPAN = 2.5;

/** Glow render passes per strand (1 = no glow, 3 = soft glow) */
const GLOW_PASSES = 3;

/** Color lerp speed normalized for 60fps (0-1 per 16ms step) */
const COLOR_LERP_SPEED = 0.035;

export default class AuraStrandsEffect {
  constructor() {
    /** @type {Array<Strand>} */
    this._strands = [];

    /** @type {Array<Particle>} */
    this._particles = [];

    /** Current display color {r,g,b} 0-1 range */
    this._color = { r: 1.0, g: 0.3, b: 0.1 };

    /** Target color to lerp toward {r,g,b} 0-1 range */
    this._targetColor = { r: 1.0, g: 0.3, b: 0.1 };

    /** Elapsed seconds (drives all animation) */
    this._time = 0;

    /** Accumulator for particle spawn timer */
    this._spawnAccum = 0;

    /**
     * Whether to render the aurora strand bezier curves.
     * When false, only free-floating particles are rendered.
     * @type {boolean}
     */
    this._drawStrands = false;

    this._initStrands();
  }

  /**
   * Enable or disable aurora strand rendering.
   * When disabled, only floating particles are drawn and
   * particle count increases for a richer effect.
   * @param {boolean} visible
   */
  setDrawStrands(visible) {
    this._drawStrands = !!visible;
  }

  // ═══════════════════════════════════════════════════════
  // Strand initialization
  // ═══════════════════════════════════════════════════════

  _initStrands() {
    for (let i = 0; i < STRAND_COUNT; i++) {
      const t = i / (STRAND_COUNT - 1 || 1);

      this._strands.push({
        // Normalized anchor positions (0-1 across canvas)
        anchors: this._generateAnchors(ANCHORS_PER_STRAND, t),
        // Independent motion phases
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        freqX: 0.25 + Math.random() * 0.55,
        freqY: 0.2 + Math.random() * 0.45,
        ampX: 0.025 + Math.random() * 0.065,
        ampY: 0.018 + Math.random() * 0.05,
        // Visual properties
        baseWidth: 2.5 + Math.random() * 7.0,
        opacity: 0.10 + Math.random() * 0.22,
        // Each strand has a "wave speed" multiplier
        speedMul: 0.6 + Math.random() * 0.8,
      });
    }
  }

  /**
   * Generate count anchor points spread across the canvas.
   * Points flow diagonally/curved across the screen for a breezy feel.
   * @param {number} count
   * @param {number} t - strand index normalized 0-1 (for vertical distribution)
   * @returns {Array<{x:number, y:number}>}
   */
  _generateAnchors(count, t) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1 || 1); // horizontal spread 0→1
      // Vertical position: center-weighted with variation
      const baseY = 0.25 + t * 0.5;
      const yJitter = (Math.random() - 0.5) * 0.2;
      const y = Math.max(0.05, Math.min(0.95, baseY + yJitter));

      points.push({
        x: u * 0.85 + 0.075, // inset from edges
        y,
      });
    }
    return points;
  }

  // ═══════════════════════════════════════════════════════
  // Color control
  // ═══════════════════════════════════════════════════════

  /**
   * Set the target aura color. The effect will smoothly lerp toward this.
   * @param {number} r - red 0-1
   * @param {number} g - green 0-1
   * @param {number} b - blue 0-1
   */
  setTargetColor(r, g, b) {
    this._targetColor.r = r;
    this._targetColor.g = g;
    this._targetColor.b = b;
  }

  /**
   * Instantly set the aura color with no transition.
   * @param {number} r - red 0-1
   * @param {number} g - green 0-1
   * @param {number} b - blue 0-1
   */
  setColorInstant(r, g, b) {
    this._color.r = r;
    this._color.g = g;
    this._color.b = b;
    this._targetColor.r = r;
    this._targetColor.g = g;
    this._targetColor.b = b;
  }

  // ═══════════════════════════════════════════════════════
  // Update
  // ═══════════════════════════════════════════════════════

  /**
   * Advance animation state.
   * @param {number} dt - delta time in milliseconds
   */
  update(dt) {
    const dtSec = dt * 0.001;

    // Advance global time
    this._time += dtSec;

    // Lerp color toward target
    const t = Math.min(1, COLOR_LERP_SPEED * (dt / 16));
    this._color.r += (this._targetColor.r - this._color.r) * t;
    this._color.g += (this._targetColor.g - this._color.g) * t;
    this._color.b += (this._targetColor.b - this._color.b) * t;

    // Update particles
    this._updateParticles(dtSec);

    // Spawn new particles — higher rate/count when strands are hidden
    const maxParticles = this._drawStrands ? MAX_PARTICLES : MAX_PARTICLES_FLOATING;
    const spawnInterval = this._drawStrands ? PARTICLE_SPAWN_INTERVAL : PARTICLE_SPAWN_INTERVAL_FLOATING;

    this._spawnAccum += dtSec;
    while (this._spawnAccum >= spawnInterval && this._particles.length < maxParticles) {
      this._spawnAccum -= spawnInterval;
      this._spawnParticle();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Particles
  // ═══════════════════════════════════════════════════════

  _spawnParticle() {
    if (this._drawStrands) {
      // ── Strand-bound particle: travels along a bezier curve strand ──
      const strandIdx = Math.floor(Math.random() * this._strands.length);
      this._particles.push({
        type: 'strand',
        strandIdx,
        /** Position along strand 0-1 */
        t: Math.random(),
        /** Speed in strand-length per second */
        speed: 0.02 + Math.random() * 0.07,
        /** Particle radius */
        radius: 1.0 + Math.random() * 2.5,
        /** Current age in seconds */
        age: 0,
        /** Total lifespan */
        lifespan: PARTICLE_LIFESPAN * (0.5 + Math.random() * 0.5),
        /** Base opacity */
        baseOpacity: 0.3 + Math.random() * 0.5,
      });
    } else {
      // ── Free-floating particle: drifts independently across the screen ──
      // Normalized positions (0-1), converted to px during render
      const angle = Math.random() * Math.PI * 2;
      const driftSpeed = 0.008 + Math.random() * 0.035;
      this._particles.push({
        type: 'floating',
        /** Normalized x position (0-1) */
        nx: Math.random(),
        /** Normalized y position (0-1) */
        ny: Math.random(),
        /** Normalized drift velocity */
        vx: Math.cos(angle) * driftSpeed,
        vy: Math.sin(angle) * driftSpeed,
        /** Particle radius — slightly larger for floating mode */
        radius: 1.2 + Math.random() * 3.5,
        /** Current age in seconds */
        age: 0,
        /** Total lifespan — longer for floating mode */
        lifespan: PARTICLE_LIFESPAN * (0.7 + Math.random() * 0.8),
        /** Base opacity */
        baseOpacity: 0.25 + Math.random() * 0.45,
        /** Twinkle phase offset */
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * @param {number} dtSec - delta time in seconds
   */
  _updateParticles(dtSec) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.age += dtSec;
      if (p.age >= p.lifespan) {
        this._particles.splice(i, 1);
        continue;
      }

      if (p.type === 'floating') {
        // ── Free-floating: drift with slight sinusoidal wobble ──
        const wobbleX = Math.sin(p.age * 3.5 + p.twinklePhase) * 0.003;
        const wobbleY = Math.cos(p.age * 2.8 + p.twinklePhase) * 0.004;
        p.nx += (p.vx + wobbleX) * dtSec;
        p.ny += (p.vy + wobbleY) * dtSec;
        // Wrap around edges so particles stay on screen
        if (p.nx < -0.05) p.nx = 1.05;
        if (p.nx > 1.05) p.nx = -0.05;
        if (p.ny < -0.05) p.ny = 1.05;
        if (p.ny > 1.05) p.ny = -0.05;
      } else {
        // ── Strand-bound: advance along strand ──
        p.t += p.speed * dtSec;
        if (p.t > 1.0) {
          // Wrap around
          p.t -= 1.0;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  /**
   * Render aura strands and particles into the given canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number, y:number, w:number, h:number}} rect
   */
  render(ctx, rect) {
    if (rect.w <= 0 || rect.h <= 0) return;

    const W = rect.w;
    const H = rect.h;

    ctx.save();

    // ── Draw strands (only when enabled) ───────────────
    if (this._drawStrands) {
      for (const strand of this._strands) {
        const points = this._driftPoints(strand, W, H);
        if (points.length < 2) continue;
        this._drawStrand(ctx, points, strand);
      }
    }

    // ── Draw particles ─────────────────────────────────
    for (const p of this._particles) {
      this._drawParticle(ctx, p, W, H);
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════
  // Strand rendering
  // ═══════════════════════════════════════════════════════

  /**
   * Compute drifted point positions for a strand at the current time.
   * @param {Strand} strand
   * @param {number} W - canvas width
   * @param {number} H - canvas height
   * @returns {Array<{x:number, y:number}>}
   */
  _driftPoints(strand, W, H) {
    const t = this._time * strand.speedMul;
    return strand.anchors.map((anchor, i) => {
      const ip = i * 1.1;
      const x = anchor.x * W
        + Math.sin(t * strand.freqX + strand.phaseX + ip) * strand.ampX * W;
      const y = anchor.y * H
        + Math.cos(t * strand.freqY + strand.phaseY + ip) * strand.ampY * H;
      return { x, y };
    });
  }

  /**
   * Draw a single strand as a smooth bezier chain with soft glow.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x:number, y:number}>} points
   * @param {Strand} strand
   */
  _drawStrand(ctx, points, strand) {
    const { r, g, b } = this._color;

    // Multi-pass glow: outer passes are wider and more transparent
    for (let pass = GLOW_PASSES - 1; pass >= 0; pass--) {
      const isCore = pass === 0;
      const alpha = strand.opacity * (isCore ? 1.0 : 0.10);
      const width = strand.baseWidth * (isCore ? 1.0 : 1.8 + pass * 1.5);

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      // Build smooth quadratic bezier chain through midpoints
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      // Final segment
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);

      ctx.strokeStyle = `rgba(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)}, ${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Particle rendering
  // ═══════════════════════════════════════════════════════

  /**
   * Get the interpolated position along a strand at parameter t (0-1).
   * Uses the same drifted point positions as _drawStrand.
   * @param {Strand} strand
   * @param {number} t - position 0-1 along strand
   * @param {number} W - canvas width
   * @param {number} H - canvas height
   * @returns {{x:number, y:number}}
   */
  _getStrandPosition(strand, t, W, H) {
    const points = this._driftPoints(strand, W, H);
    if (points.length < 2) return points[0] || { x: W / 2, y: H / 2 };

    // Clamp t
    const tc = Math.max(0, Math.min(1, t));

    // Find which segment t falls into
    const segmentCount = points.length - 1;
    const segFloat = tc * segmentCount;
    const segIdx = Math.min(Math.floor(segFloat), segmentCount - 1);
    const localT = segFloat - segIdx;

    return {
      x: points[segIdx].x + (points[segIdx + 1].x - points[segIdx].x) * localT,
      y: points[segIdx].y + (points[segIdx + 1].y - points[segIdx].y) * localT,
    };
  }

  /**
   * Draw a single glowing particle.
   * Handles both strand-bound ('strand') and free-floating ('floating') particles.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Particle} p
   * @param {number} W - canvas width
   * @param {number} H - canvas height
   */
  _drawParticle(ctx, p, W, H) {
    let pos;

    if (p.type === 'floating') {
      // ── Free-floating: convert normalized coords to pixels ──
      pos = {
        x: p.nx * W,
        y: p.ny * H,
      };
    } else {
      // ── Strand-bound: sample position from strand curve ──
      const strand = this._strands[p.strandIdx];
      if (!strand) return;
      pos = this._getStrandPosition(strand, p.t, W, H);
    }

    // Opacity: fade in, hold, fade out
    let fadeAlpha;
    if (p.type === 'floating') {
      // Floating particles: slower fade in/out for softer presence
      const fadeIn = 0.4;
      const fadeOut = 0.6;
      if (p.age < fadeIn) {
        fadeAlpha = p.age / fadeIn;
      } else if (p.age > p.lifespan - fadeOut) {
        fadeAlpha = (p.lifespan - p.age) / fadeOut;
      } else {
        // Add subtle twinkle during hold phase
        const twinkle = 1.0 + Math.sin(p.age * 4.5 + p.twinklePhase) * 0.2;
        fadeAlpha = twinkle;
      }
    } else {
      const fadeIn = 0.25;
      const fadeOut = 0.4;
      if (p.age < fadeIn) {
        fadeAlpha = p.age / fadeIn;
      } else if (p.age > p.lifespan - fadeOut) {
        fadeAlpha = (p.lifespan - p.age) / fadeOut;
      } else {
        fadeAlpha = 1.0;
      }
    }

    const alpha = p.baseOpacity * fadeAlpha;
    if (alpha <= 0.005) return;

    const { r, g, b } = this._color;

    // Soft glow circle
    const glowRadius = p.radius * 3;
    const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
    const r255 = Math.floor(r * 255);
    const g255 = Math.floor(g * 255);
    const b255 = Math.floor(b * 255);
    grad.addColorStop(0, `rgba(${r255}, ${g255}, ${b255}, ${alpha})`);
    grad.addColorStop(0.3, `rgba(${r255}, ${g255}, ${b255}, ${alpha * 0.5})`);
    grad.addColorStop(1, `rgba(${r255}, ${g255}, ${b255}, 0)`);

    // Brighter core
    const coreGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, p.radius);
    coreGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.7})`);
    coreGrad.addColorStop(1, `rgba(${r255}, ${g255}, ${b255}, ${alpha * 0.2})`);

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * @typedef {object} Strand
 * @property {Array<{x:number, y:number}>} anchors
 * @property {number} phaseX
 * @property {number} phaseY
 * @property {number} freqX
 * @property {number} freqY
 * @property {number} ampX
 * @property {number} ampY
 * @property {number} baseWidth
 * @property {number} opacity
 * @property {number} speedMul
 */

/**
 * @typedef {object} Particle
 * @property {'strand'|'floating'} type - particle movement mode
 * @property {number} [strandIdx] - (strand type) which strand this particle rides
 * @property {number} [t] - (strand type) position along strand 0-1
 * @property {number} [speed] - (strand type) speed in strand-length per second
 * @property {number} [nx] - (floating type) normalized x 0-1
 * @property {number} [ny] - (floating type) normalized y 0-1
 * @property {number} [vx] - (floating type) normalized x velocity
 * @property {number} [vy] - (floating type) normalized y velocity
 * @property {number} [twinklePhase] - (floating type) twinkle phase offset
 * @property {number} radius
 * @property {number} age
 * @property {number} lifespan
 * @property {number} baseOpacity
 */
