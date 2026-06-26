/**
 * DamageCounterEffect — center-screen accumulating combat-damage feedback.
 *
 * A single stylized counter appears in the CENTER of the board when a damage
 * sequence begins and ACCUMULATES every hit of that sequence instead of
 * spawning one popup per hit. It shows the running total + a chain count:
 *
 *     34 DAMAGE
 *     CHAIN x3
 *
 * Lifecycle (a four-phase timeline):
 *   1. ACCUMULATE — compact, parked at board center. Each new hit bumps the
 *      total + chain and replays a punchy "tick": scale pop, small positional
 *      shake, a glow flare, and a couple of slash accents. Stays small so it
 *      doesn't block the board while damage is still landing.
 *   2. FINALIZE  — once no new damage arrives (and the board has settled), the
 *      number grows large with a bounce/overshoot and holds for readability,
 *      while the "DAMAGE" word + chain line fade out, leaving just the number.
 *   3. FLY       — the bare number detaches and arcs toward the target's
 *      portrait with a fast ease, shrinking as it travels.
 *   4. IMPACT    — at the portrait it bursts: a quick scale pop + radial flash
 *      + spark fan, fires the onImpact() callback (so the scene can shake /
 *      flash the target), then fades and ends.
 *
 * Not a UIElement — uses absolute design-space coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect): construct, call update(dt) + render(ctx) each frame,
 * remove once `done` is true. The owning scene feeds it the center anchor
 * (board center), the target anchor (receiver portrait), and the `resolving`
 * hint each frame.
 */

const FONT_FAMILY = '"Marcellus SC", Georgia, serif';

// Intensity (relative damage 0..1) → number color ramp. Fiery gold → red. Even
// a small hit reads as a rich molten orange (not pale yellow) for drama.
const COLOR_STOPS = [
  { t: 0.00, c: [255, 196, 64] },
  { t: 0.30, c: [255, 138, 36] },
  { t: 0.60, c: [255, 80, 36] },
  { t: 1.00, c: [255, 44, 40] },
];

// Damage as a fraction of max HP that reads as "full intensity". Lower = hits
// the hot colors / big sizes sooner (more dramatic on ordinary hits).
const INTENSITY_FULL_FRACTION = 0.4;

// Number sizing (px font at scale 1.0). Big and bold.
const NUMBER_BASE_FONT = 122;
const NUMBER_INTENSITY_GROWTH = 70;   // extra px at full intensity
const WORD_FONT = 46;                 // "DAMAGE"
const CHAIN_FONT = 36;                // "CHAIN xN"

// Phase scales. Compact while accumulating so the board stays readable.
const ACCUMULATE_SCALE = 0.92;
const FINAL_SCALE = 1.6;              // settled finalize size (rest)
const FINAL_OVERSHOOT = 1.9;          // bounce peak before settling back
const FLY_END_SCALE = 0.55;           // shrunk size as it reaches the portrait

// Per-hit "tick" punch (replayed on every accumulation).
const PUNCH_MS = 260;
const PUNCH_AMP = 0.55;               // peak extra scale
const PUNCH_ROT = 0.12;               // peak wobble (radians)
const SHAKE_AMP = 12;                 // peak positional shake (px), decays
const FLARE_GLOW = 40;                // extra glow blur on a fresh hit, decays

// Idle → finalize. No new damage for this long (while NOT resolving) ends the
// sequence. Held off while the board is still resolving so a long cascade stays
// as ONE accumulating counter.
const FINALIZE_IDLE_MS = 150;

// Finalize timeline: a bounce-up grow, then a readable hold (words fade early).
const FINAL_GROW_MS = 140;
const FINAL_HOLD_MS = 130;
const WORD_FADE_MS = 150;             // "DAMAGE"/chain fade window at finalize start

// Fly-to-portrait.
const FLY_MS = 200;
const FLY_ARC_LIFT = 110;             // peak upward bow of the arc (px)

// Impact burst at the portrait.
const IMPACT_MS = 220;
const IMPACT_RING_MAX = 90;           // burst ring radius (px)
const SPARK_COUNT = 10;
const SPARK_LEN = 34;
const SPARK_SPEED = 0.4;              // px/ms outward

// Glow (drop-shadow bloom) base + intensity for the number.
const GLOW_BASE = 12;
const GLOW_INTENSITY = 34;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rampRGB(t) {
  t = clamp01(t);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].c.slice();
}

function rgb([r, g, b], a) {
  return a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

function shade([r, g, b], f) {
  // f<1 darken, f>1 lighten (clamped).
  return [
    Math.max(0, Math.min(255, Math.round(r * f))),
    Math.max(0, Math.min(255, Math.round(g * f))),
    Math.max(0, Math.min(255, Math.round(b * f))),
  ];
}

const PHASE = { ACCUMULATE: 0, FINALIZE: 1, FLY: 2, IMPACT: 3 };

export default class DamageCounterEffect {
  /**
   * @param {number} x - center anchor X (board center, design space)
   * @param {number} y - center anchor Y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    // Where the number flies on finalize (receiver portrait). Defaults to the
    // center anchor until the scene supplies it.
    this.targetX = x;
    this.targetY = y;

    this.total = 0;
    this.chain = 0;
    this.maxHp = 100;

    this.done = false;

    /** Fired once at the start of the IMPACT phase: onImpact(intensity). */
    this.onImpact = null;

    this._phase = PHASE.ACCUMULATE;
    this._age = 0;            // ms since spawn
    this._idle = 0;           // ms since last damage (while not resolving)
    this._scaleBase = 0.6;    // current rest scale (eases toward phase target)

    this._punchElapsed = PUNCH_MS; // start "settled" (no punch)

    /** True while the board is resolving — holds off the idle finalize. */
    this.resolving = false;

    this._phaseElapsed = 0;   // ms within the current non-accumulate phase
    this._flyFromX = x;
    this._flyFromY = y;
    this._impactFired = false;
    this._sparks = null;
  }

  /** Has the counter begun its end-of-sequence finalize (or later)? */
  get finalizing() {
    return this._phase !== PHASE.ACCUMULATE;
  }

  /** True once the flying number has reached the portrait (impact fired). The
   *  turn gate releases here so the turn can pass as the burst fades. */
  get delivered() {
    return this._impactFired;
  }

  /** Re-anchor the center (board center). Only meaningful while accumulating. */
  setCenter(x, y) {
    if (this._phase === PHASE.ACCUMULATE) {
      this.x = x;
      this.y = y;
    }
  }

  /** Set the fly-to target (receiver portrait center). */
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  /** Back-compat alias (old callers used setAnchor for the portrait). */
  setAnchor(x, y) {
    this.setCenter(x, y);
  }

  /**
   * Accumulate a damage hit: bump the total + chain and replay the punch tick.
   * @param {number} amount
   * @param {number} maxHp - receiver max HP (drives relative intensity)
   */
  add(amount, maxHp) {
    if (this._phase !== PHASE.ACCUMULATE || this.done) return;
    if (amount > 0) this.total += amount | 0;
    if (maxHp > 0) this.maxHp = maxHp;
    this.chain += 1;
    this._punchElapsed = 0;
    this._idle = 0;
  }

  /** Begin the finalize → fly → impact sequence. */
  finalize() {
    if (this._phase !== PHASE.ACCUMULATE || this.done) return;
    this._phase = PHASE.FINALIZE;
    this._phaseElapsed = 0;
  }

  _intensity() {
    return clamp01(this.total / Math.max(1, this.maxHp * INTENSITY_FULL_FRACTION));
  }

  update(dt) {
    if (this.done) return;
    this._age += dt;
    if (this._punchElapsed < PUNCH_MS) this._punchElapsed += dt;

    if (this._phase === PHASE.ACCUMULATE) {
      // Ease the rest scale up to the compact accumulate size.
      const target = ACCUMULATE_SCALE;
      const k = 1 - Math.pow(1 - 0.04, dt);
      this._scaleBase += (target - this._scaleBase) * k;

      // Idle → finalize. Held off while the board is still resolving so a long
      // cascade stays as ONE accumulating counter.
      if (this.resolving) {
        this._idle = 0;
      } else if (this.total > 0) {
        this._idle += dt;
        if (this._idle >= FINALIZE_IDLE_MS) this.finalize();
      }
      return;
    }

    this._phaseElapsed += dt;

    if (this._phase === PHASE.FINALIZE) {
      if (this._phaseElapsed >= FINAL_GROW_MS + FINAL_HOLD_MS) {
        this._phase = PHASE.FLY;
        this._phaseElapsed = 0;
        this._flyFromX = this.x;
        this._flyFromY = this.y;
      }
      return;
    }

    if (this._phase === PHASE.FLY) {
      if (this._phaseElapsed >= FLY_MS) {
        this._phase = PHASE.IMPACT;
        this._phaseElapsed = 0;
      }
      return;
    }

    // IMPACT.
    if (!this._impactFired) {
      this._impactFired = true;
      this._spawnSparks();
      if (typeof this.onImpact === 'function') this.onImpact(this._intensity());
    }
    if (this._phaseElapsed >= IMPACT_MS) this.done = true;
  }

  _spawnSparks() {
    this._sparks = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const a = (i / SPARK_COUNT) * Math.PI * 2 + Math.random() * 0.5;
      const spd = SPARK_SPEED * (0.7 + Math.random() * 0.6);
      this._sparks.push({ a, spd, len: SPARK_LEN * (0.6 + Math.random() * 0.7) });
    }
  }

  _punchScale() {
    if (this._punchElapsed >= PUNCH_MS) return 0;
    const p = this._punchElapsed / PUNCH_MS;
    return PUNCH_AMP * (1 - p) * Math.cos(p * Math.PI * 1.5);
  }

  _punchRot() {
    if (this._punchElapsed >= PUNCH_MS) return 0;
    const p = this._punchElapsed / PUNCH_MS;
    return PUNCH_ROT * (1 - p) * Math.sin(p * Math.PI * 3);
  }

  /** Decaying 0..1 "fresh hit" factor driving shake + glow flare. */
  _hitFresh() {
    if (this._punchElapsed >= PUNCH_MS) return 0;
    return 1 - this._punchElapsed / PUNCH_MS;
  }

  render(ctx) {
    if (this.done || this.total <= 0) return;
    if (this._phase === PHASE.FLY || this._phase === PHASE.IMPACT) {
      this._renderFlying(ctx);
    } else {
      this._renderCentered(ctx);
    }
  }

  // ── Accumulate + finalize: number + DAMAGE + CHAIN at the center ──────────

  _renderCentered(ctx) {
    const intensity = this._intensity();
    const fresh = this._hitFresh();

    // Scale + word alpha by phase.
    let scale = this._scaleBase + this._punchScale();
    let wordAlpha = 1;
    let numAlpha = 1;
    if (this._phase === PHASE.FINALIZE) {
      const e = this._phaseElapsed;
      if (e < FINAL_GROW_MS) {
        const p = e / FINAL_GROW_MS;
        // Overshoot to the peak (eased) over the first 60%, then settle back.
        if (p < 0.6) {
          const q = p / 0.6;
          scale = FINAL_OVERSHOOT * (1 - Math.pow(1 - q, 3));
        } else {
          const q = (p - 0.6) / 0.4;
          scale = FINAL_OVERSHOOT + (FINAL_SCALE - FINAL_OVERSHOOT) * q;
        }
      } else {
        scale = FINAL_SCALE;
      }
      wordAlpha = clamp01(1 - this._phaseElapsed / WORD_FADE_MS);
    }

    // Positional shake on a fresh hit (only while accumulating).
    let sx = 0, sy = 0;
    if (this._phase === PHASE.ACCUMULATE && fresh > 0) {
      sx = (Math.random() - 0.5) * 2 * SHAKE_AMP * fresh;
      sy = (Math.random() - 0.5) * 2 * SHAKE_AMP * fresh;
    }
    const rot = this._phase === PHASE.ACCUMULATE ? this._punchRot() : 0;

    const cx = this.x + sx;
    const cy = this.y + sy;

    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);

    const numFont = (NUMBER_BASE_FONT + NUMBER_INTENSITY_GROWTH * intensity) * scale;
    const glowBoost = FLARE_GLOW * fresh;

    // Number sits slightly above center so the words tuck below it.
    const numY = -numFont * 0.18;
    this._drawNumber(ctx, String(this.total), 0, numY, numFont, intensity, numAlpha, glowBoost);

    // Slash accents flick across on a fresh hit (accumulate only).
    if (this._phase === PHASE.ACCUMULATE && fresh > 0.25) {
      this._drawSlashes(ctx, numFont, fresh, intensity);
    }

    // "DAMAGE" + "CHAIN xN" (fade out during finalize).
    if (wordAlpha > 0.01) {
      const wordY = numY + numFont * 0.5;
      this._drawWord(ctx, 'DAMAGE', 0, wordY, WORD_FONT * scale, wordAlpha, intensity);
      const chainY = wordY + WORD_FONT * scale * 0.95;
      const bang = this.chain >= 4 ? '!' : '';
      this._drawWord(ctx, `CHAIN x${this.chain}${bang}`, 0, chainY, CHAIN_FONT * scale, wordAlpha * 0.92, intensity, true);
    }

    ctx.restore();
  }

  // ── Fly + impact: just the number arcs to the portrait, then bursts ──────

  _renderFlying(ctx) {
    const intensity = this._intensity();

    let x, y, scale, alpha = 1;
    if (this._phase === PHASE.FLY) {
      const p = clamp01(this._phaseElapsed / FLY_MS);
      const ease = p * p; // ease-in (accelerates toward the portrait)
      x = this._flyFromX + (this.targetX - this._flyFromX) * ease;
      y = this._flyFromY + (this.targetY - this._flyFromY) * ease;
      y -= Math.sin(p * Math.PI) * FLY_ARC_LIFT; // arc bow
      scale = FINAL_SCALE + (FLY_END_SCALE - FINAL_SCALE) * ease;
    } else {
      // IMPACT — parked on the portrait with a quick pop then fade.
      x = this.targetX;
      y = this.targetY;
      const p = clamp01(this._phaseElapsed / IMPACT_MS);
      scale = FLY_END_SCALE * (1 + 0.5 * (1 - p) * (1 - p));
      alpha = 1 - p * p;
      this._drawImpactBurst(ctx, x, y, p, intensity);
    }

    const numFont = (NUMBER_BASE_FONT + NUMBER_INTENSITY_GROWTH * intensity) * scale;
    ctx.save();
    ctx.translate(x, y);
    this._drawNumber(ctx, String(this.total), 0, 0, numFont, intensity, alpha, 0);
    ctx.restore();
  }

  _drawImpactBurst(ctx, x, y, p, intensity) {
    const col = rampRGB(intensity);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';

    // Radial flash, fading fast.
    const flash = 1 - p;
    if (flash > 0) {
      const rr = IMPACT_RING_MAX * (0.4 + p * 0.9);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      grad.addColorStop(0, rgb([255, 245, 210], 0.85 * flash));
      grad.addColorStop(0.5, rgb(col, 0.5 * flash));
      grad.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Spark fan flying outward.
    if (this._sparks) {
      const dist = this._phaseElapsed * SPARK_SPEED;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgb([255, 236, 190], Math.max(0, 1 - p) * 0.9);
      for (const s of this._sparks) {
        const d = dist * s.spd / SPARK_SPEED;
        const x0 = Math.cos(s.a) * d;
        const y0 = Math.sin(s.a) * d;
        const x1 = Math.cos(s.a) * (d + s.len * (1 - p));
        const y1 = Math.sin(s.a) * (d + s.len * (1 - p));
        ctx.lineWidth = 4 * (1 - p) + 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Drawing primitives ───────────────────────────────────────────────────

  _drawNumber(ctx, text, x, y, fontPx, intensity, alpha, glowBoost) {
    if (alpha <= 0 || fontPx < 1) return;
    const col = rampRGB(intensity);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `bold ${Math.round(fontPx)}px ${FONT_FAMILY}`;

    // Heavy dark outline for legibility against any background.
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(3, fontPx * 0.14);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, x, y);

    // Gold→hot vertical gradient fill, with an intensity-scaled glow.
    const grad = ctx.createLinearGradient(0, y - fontPx * 0.55, 0, y + fontPx * 0.55);
    grad.addColorStop(0, rgb(shade(col, 1.35)));
    grad.addColorStop(0.5, rgb(col));
    grad.addColorStop(1, rgb(shade(col, 0.62)));
    ctx.shadowColor = rgb(col);
    ctx.shadowBlur = (GLOW_BASE + GLOW_INTENSITY * intensity) + glowBoost;
    ctx.fillStyle = grad;
    ctx.fillText(text, x, y);

    // Bright bevel highlight skimming the top edge.
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = rgb([255, 250, 225]);
    ctx.fillText(text, x, y - fontPx * 0.04);
    ctx.globalAlpha /= 0.5;

    // Additive bloom at higher intensity for a "hot" look.
    if (intensity > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= (intensity - 0.3) / 0.7 * 0.45;
      ctx.shadowColor = rgb(col);
      ctx.shadowBlur = (GLOW_BASE + GLOW_INTENSITY * intensity) * 1.4 + glowBoost;
      ctx.fillStyle = rgb(col);
      ctx.fillText(text, x, y);
    }

    ctx.restore();
  }

  _drawWord(ctx, text, x, y, fontPx, alpha, intensity, dim) {
    if (alpha <= 0 || fontPx < 1) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Letter-spaced caps for a banner feel (drawn char-by-char).
    const spacing = fontPx * 0.12;
    ctx.font = `bold ${Math.round(fontPx)}px ${FONT_FAMILY}`;
    const widths = [];
    let totalW = 0;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      widths.push(w);
      totalW += w + spacing;
    }
    totalW -= spacing;
    let cx = x - totalW / 2;
    const gold = dim ? [255, 226, 150] : [255, 214, 120];
    ctx.lineWidth = Math.max(2, fontPx * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = rgb(gold);
    for (let i = 0; i < widths.length; i++) {
      const ch = text[i];
      const chx = cx + widths[i] / 2;
      ctx.strokeText(ch, chx, y);
      ctx.fillText(ch, chx, y);
      cx += widths[i] + spacing;
    }
    ctx.restore();
  }

  _drawSlashes(ctx, fontPx, fresh, intensity) {
    const col = rampRGB(intensity);
    const len = fontPx * 1.1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= fresh * 0.8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgb([255, 240, 200]);
    ctx.shadowColor = rgb(col);
    ctx.shadowBlur = 16;
    // Two crossing diagonal flicks.
    const offs = [
      { a: -0.5, o: -fontPx * 0.2 },
      { a: -0.5, o: fontPx * 0.22 },
    ];
    for (const s of offs) {
      const dx = Math.cos(s.a) * len * 0.5;
      const dy = Math.sin(s.a) * len * 0.5;
      ctx.lineWidth = 4 * fresh + 1;
      ctx.beginPath();
      ctx.moveTo(-dx, -dy + s.o);
      ctx.lineTo(dx, dy + s.o);
      ctx.stroke();
    }
    ctx.restore();
  }
}
