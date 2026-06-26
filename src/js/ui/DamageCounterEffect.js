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

// ── Forged-text look (ported from sim/emberforge.html `drawLine()`) ──────────
// EMBER is the EmberForge "Forged Ember" settings tuned in that studio: the text
// is one line drawn as a deliberate stack of passes — fire glow → drop shadow →
// extruded 3D side → dark edge → metal-face gradient (with the dark reflection
// line) → inner sheen. All PIXEL params (widths, blurs, depth, tracking) are
// authored at the REF SIZES below and scaled per-line by fontPx/refSize so the
// proportions hold at any rendered size. To retune the look, edit EMBER (it's
// the exact JSON the studio's "Copy settings" produces, minus text/sizes).
const EMBER = {
  font: '"Cinzel", "Marcellus SC", Georgia, serif',
  weight: 800,
  letterSpacing: 2,        // px @ ref size
  slant: -20,              // ° — horizontal shear of the whole block
  tilt: -8,                // ° — rotation of the whole block
  // metal face (vertical gradient with the reflection line)
  topColor: '#fdf5d8',
  bodyColor: '#eb9641',
  reflectColor: '#eca434',
  underglowColor: '#f8e449',
  reflectPos: 0.29,
  reflectSharp: 0.03,
  // forge depth (the chunky 3D side)
  extrudeDepth: 13,        // px @ ref size
  extrudeDir: 201,         // °
  extrudeColor: '#4d0b00',
  // edge + inner sheen
  edgeWidth: 9.5,          // px @ ref size
  edgeColor: '#500202',
  innerWidth: 1.5,         // px @ ref size
  innerColor: '#f9e6a3',
  // fire glow (behind the stack)
  glowColor: '#e7692d',
  glowSpread: 30,          // px @ ref size
  glowIntensity: 2,        // stacked passes
  // drop shadow (grounds the text)
  shadowColor: '#fea62a',
  shadowAlpha: 0.65,
  shadowBlur: 6,           // px @ ref size
  shadowDY: 6,             // px @ ref size
};

// Sizes the EMBER pixel params were authored at — pixel params scale by
// fontPx / refSize. The number's rendered size ramps with intensity up to
// EMBER_NUM_SIZE; the words are drawn at their ref sizes (× phase scale).
const EMBER_NUM_SIZE = 224;
const EMBER_HEAD_SIZE = 105;   // "DAMAGE"
const EMBER_SUB_SIZE = 43;     // "CHAIN xN"
const EMBER_LINE_GAP = 11;     // px @ scale 1, between stacked lines

// Intensity (relative damage 0..1) → accent color ramp for the IMPACT burst +
// slash flicks (yellow-gold → fiery red). The forged number/words get their
// colors from EMBER, not this ramp; this only tints the spark effects.
const COLOR_STOPS = [
  { t: 0.00, c: [255, 210, 74] },   // yellow-gold (low relative dmg)
  { t: 0.35, c: [255, 152, 40] },   // amber
  { t: 0.65, c: [255, 88, 30] },    // hot orange
  { t: 1.00, c: [228, 30, 26] },    // fiery red (high relative dmg)
];

// Damage as a fraction of max HP that reads as "full intensity". Lower = hits
// the hot colors / big sizes sooner (more dramatic on ordinary hits).
const INTENSITY_FULL_FRACTION = 0.4;

// Number sizing (px font at phase scale 1.0). Ramps with intensity from
// NUMBER_MIN_SIZE (chip damage) up to EMBER_NUM_SIZE (heavy relative hit), so a
// big hit visibly dwarfs a small one. The words use the EMBER ref sizes.
const NUMBER_MIN_SIZE = 140;

// Phase scales (multiply the per-line ref sizes). Compact while accumulating so
// the board stays readable; finalize settles near the EmberForge design size.
const ACCUMULATE_SCALE = 0.72;
const FINAL_SCALE = 1.0;              // settled finalize size (= design size)
const FINAL_OVERSHOOT = 1.18;        // bounce peak before settling back
const FLY_END_SCALE = 0.46;          // shrunk size as it reaches the portrait

// Per-hit "tick" punch (replayed on every accumulation).
const PUNCH_MS = 260;
const PUNCH_AMP = 0.55;               // peak extra scale
const PUNCH_ROT = 0.12;               // peak wobble (radians)
const SHAKE_AMP = 12;                 // peak positional shake (px), decays

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

// Hex "#rrggbb" → "rgba(r,g,b,a)" (EmberForge colors are hex strings).
function hexA(hex, a) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// The metal-face gradient stops (ported verbatim from EmberForge gradientStops):
// bright top sheen → body → a hard dark REFLECTION line near reflectPos → body
// → lower underglow. The reflection band is what reads as polished metal.
function emberGradientStops(e) {
  const p = e.reflectPos;
  const w = e.reflectSharp;
  const stops = [
    [0, e.topColor],
    [p * 0.5, e.bodyColor],
    [p - w, e.bodyColor],
    [p, e.reflectColor],
    [p + w, e.bodyColor],
    [Math.min(0.999, p + 0.3), e.underglowColor],
    [1, e.underglowColor],
  ].map(([o, c]) => [clamp01(o), c]).sort((a, b) => a[0] - b[0]);
  // Nudge any colliding offsets so addColorStop offsets strictly increase.
  let last = -1;
  for (const st of stops) {
    if (st[0] <= last) st[0] = Math.min(1, last + 0.0006);
    last = st[0];
  }
  return stops;
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
    // Whole-block tilt + slant (EmberForge `tilt`/`slant`), plus the punch wobble.
    ctx.rotate(rot + EMBER.tilt * Math.PI / 180);
    ctx.transform(1, 0, Math.tan(EMBER.slant * Math.PI / 180), 1, 0, 0);

    const numFontPx = this._numberFont(intensity, scale);
    const headFontPx = EMBER_HEAD_SIZE * scale;
    const subFontPx = EMBER_SUB_SIZE * scale;

    // Stack the lines (number / DAMAGE / CHAIN) and center the block. The words'
    // contribution to height scales with their fade so the number settles to
    // center smoothly as they vanish at finalize.
    const CAP = 0.36;                 // ≈ half cap-height as a fraction of fontPx
    const gap = EMBER_LINE_GAP * scale;
    const numHalf = numFontPx * CAP;
    const headHalf = headFontPx * CAP;
    const subHalf = subFontPx * CAP;
    const wa = clamp01(wordAlpha);
    const wordsH = (gap + 2 * headHalf + gap + 2 * subHalf) * wa;
    const numCenterY = -wordsH / 2;
    const headCenterY = numCenterY + numHalf + gap + headHalf;
    const subCenterY = headCenterY + headHalf + gap + subHalf;

    this._drawForged(ctx, String(this.total), 0, numCenterY, numFontPx, EMBER_NUM_SIZE, numAlpha);

    // Slash accents flick across the number on a fresh hit (accumulate only).
    if (this._phase === PHASE.ACCUMULATE && fresh > 0.25) {
      ctx.save();
      ctx.translate(0, numCenterY);
      this._drawSlashes(ctx, numFontPx, fresh, intensity);
      ctx.restore();
    }

    // "DAMAGE" + "CHAIN xN" (fade out during finalize).
    if (wordAlpha > 0.01) {
      this._drawForged(ctx, 'DAMAGE', 0, headCenterY, headFontPx, EMBER_HEAD_SIZE, wordAlpha);
      const bang = this.chain >= 4 ? '!' : '';
      this._drawForged(ctx, `CHAIN x${this.chain}${bang}`, 0, subCenterY, subFontPx, EMBER_SUB_SIZE, wordAlpha * 0.95);
    }

    ctx.restore();
  }

  /** Number font px for an intensity + phase scale: ramps NUMBER_MIN_SIZE →
   *  EMBER_NUM_SIZE with relative damage, then × the phase scale. */
  _numberFont(intensity, scale) {
    return (NUMBER_MIN_SIZE + (EMBER_NUM_SIZE - NUMBER_MIN_SIZE) * intensity) * scale;
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

    const numFontPx = this._numberFont(intensity, scale);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(EMBER.tilt * Math.PI / 180);
    ctx.transform(1, 0, Math.tan(EMBER.slant * Math.PI / 180), 1, 0, 0);
    this._drawForged(ctx, String(this.total), 0, 0, numFontPx, EMBER_NUM_SIZE, alpha);
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

  /**
   * Draw one line as the EmberForge forged stack (ported from
   * sim/emberforge.html `drawLine()`), centered horizontally at `cx` and
   * vertically on `cyCenter`. All EMBER pixel params scale by fontPx/refSize so
   * the look holds at any rendered size. The caller owns the tilt/slant.
   */
  _drawForged(ctx, text, cx, cyCenter, fontPx, refSize, alpha) {
    if (alpha <= 0 || fontPx < 1) return;
    const e = EMBER;
    const k = fontPx / refSize;   // scale EMBER's px params from its ref size

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${e.weight} ${Math.round(fontPx)}px ${e.font}`;
    try { ctx.letterSpacing = (e.letterSpacing * k) + 'px'; } catch (_) {}
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // Measure → center the caps on cyCenter and map the gradient to the glyph's
    // own ascent/descent (so the reflection line lands consistently).
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || fontPx * 0.7;
    const desc = m.actualBoundingBoxDescent || fontPx * 0.04;
    const baseY = cyCenter + (asc - desc) / 2;

    // (1) FIRE GLOW — colored fill + big blur, stacked for a punchy halo.
    if (e.glowIntensity > 0 && e.glowSpread > 0) {
      ctx.save();
      ctx.shadowColor = e.glowColor;
      ctx.shadowBlur = e.glowSpread * k;
      ctx.fillStyle = e.glowColor;
      for (let i = 0; i < e.glowIntensity; i++) ctx.fillText(text, cx, baseY);
      ctx.restore();
    }
    // (2) DROP SHADOW — offset-down soft shadow, grounds the text.
    if (e.shadowAlpha > 0) {
      ctx.save();
      ctx.shadowColor = hexA(e.shadowColor, e.shadowAlpha);
      ctx.shadowBlur = e.shadowBlur * k;
      ctx.shadowOffsetY = e.shadowDY * k;
      ctx.fillStyle = '#000';
      ctx.fillText(text, cx, baseY);
      ctx.restore();
    }
    // (3) FORGE DEPTH — dark copies nudged along extrudeDir = the 3D side.
    if (e.extrudeDepth > 0) {
      const a = e.extrudeDir * Math.PI / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      const depth = Math.max(1, Math.round(e.extrudeDepth * k));
      ctx.fillStyle = e.extrudeColor;
      for (let i = depth; i >= 1; i--) ctx.fillText(text, cx + dx * i, baseY + dy * i);
    }
    // (4) EDGE — thick dark outline around the front face.
    if (e.edgeWidth > 0) {
      ctx.strokeStyle = e.edgeColor;
      ctx.lineWidth = e.edgeWidth * k;
      ctx.strokeText(text, cx, baseY);
    }
    // (5) METAL FACE — vertical gradient with the dark reflection line.
    const grad = ctx.createLinearGradient(0, baseY - asc, 0, baseY + desc);
    for (const [o, col] of emberGradientStops(e)) grad.addColorStop(o, col);
    ctx.fillStyle = grad;
    ctx.fillText(text, cx, baseY);
    // (6) INNER SHEEN — thin bright rim, a catch of light on the bevel.
    if (e.innerWidth > 0) {
      ctx.strokeStyle = e.innerColor;
      ctx.lineWidth = e.innerWidth * k;
      ctx.strokeText(text, cx, baseY);
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
