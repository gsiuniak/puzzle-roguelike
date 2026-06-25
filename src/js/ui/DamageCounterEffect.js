/**
 * DamageCounterEffect — accumulating "total damage" counter over a portrait.
 *
 * Replaces the old per-hit floating "-x" damage text. Instead of one number per
 * damage instance, a SINGLE counter pops up on the receiver's portrait and
 * ACCUMULATES every hit during a damage sequence (e.g. 3 → cascade +5 → shows
 * 8). The number grows brighter / hotter-colored / slightly bigger the higher
 * the damage gets RELATIVE to the receiver's max HP, and "bobbles" with a
 * Balatro-style scale punch (+ a little rotational wobble) every time it grows.
 *
 * When the damage sequence ends (no new damage for a short grace window while
 * the board is no longer resolving — i.e. the end of the turn), the counter does
 * one last quick grow-pop showing the final total, then shrinks and fades away.
 *
 * Not a UIElement — uses absolute design-space coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect): construct, call update(dt) + render(ctx) each frame,
 * and remove the instance once `done` is true. The owning scene re-anchors it
 * each frame (setAnchor) and feeds it the `resolving` hint.
 */

const FONT_FAMILY = '"Marcellus SC", Georgia, serif';

// Intensity (relative damage 0..1) → number color ramp. Soft gold → bright red.
const COLOR_STOPS = [
  { t: 0.00, c: [255, 240, 170] },
  { t: 0.35, c: [255, 176, 64] },
  { t: 0.65, c: [255, 96, 56] },
  { t: 1.00, c: [255, 56, 56] },
];

// Damage as a fraction of max HP that reads as "full intensity". Hitting this
// much of the receiver's bar maxes out the size/color/glow.
const INTENSITY_FULL_FRACTION = 0.6;

// Sizing.
const BASE_FONT = 46;               // px font at scale 1.0, intensity 0
const FONT_INTENSITY_GROWTH = 50;   // extra px at full intensity
const SCALE_INTENSITY = 0.16;       // rest scale grows slightly with intensity
const SCALE_LERP = 0.014;           // per-ms approach of base scale toward target

// Balatro-style "punch" replayed on every accumulation.
const PUNCH_MS = 300;
const PUNCH_AMP = 0.45;             // peak extra scale
const PUNCH_ROT = 0.11;            // peak wobble (radians)

// Idle life bob (small, scales with intensity).
const BOB_FREQ = 0.006;            // rad/ms
const BOB_AMP = 0.035;

// No new damage for this long (while the board is NOT resolving) → finalize.
const FINALIZE_IDLE_MS = 850;

// Final grow-pop then shrink + fade.
const FINAL_GROW_MS = 190;
const FINAL_GROW_SCALE = 1.55;     // multiplier on the rest scale at the peak
const FINAL_FADE_MS = 360;
const FINAL_END_SCALE = 0.4;

// Glow (drop-shadow bloom) base + intensity.
const GLOW_BASE = 6;
const GLOW_INTENSITY = 28;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rampColor(t) {
  t = clamp01(t);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * f);
      const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * f);
      const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * f);
      return `rgb(${r},${g},${bl})`;
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1].c;
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

export default class DamageCounterEffect {
  /**
   * @param {number} x - anchor center X (design space)
   * @param {number} y - anchor center Y (design space)
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.total = 0;
    this.maxHp = 100;

    this.done = false;

    this._age = 0;            // ms since spawn
    this._idle = 0;           // ms since last damage (while not resolving)
    this._scaleBase = 0.6;    // current rest scale (eases toward target)

    this._punchElapsed = PUNCH_MS; // start "settled" (no punch)

    /** True while the board is resolving — holds off the idle finalize. */
    this.resolving = false;

    this._finalizing = false;
    this._finalElapsed = 0;
    this._finalStartScale = 1;
  }

  /** Has the counter begun its end-of-sequence finalize animation? */
  get finalizing() {
    return this._finalizing;
  }

  /** Re-anchor to the portrait center (the scene updates this each frame). */
  setAnchor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Accumulate a damage hit. Replays the punch and resets the idle timer.
   * @param {number} amount
   * @param {number} maxHp - receiver max HP (drives relative intensity)
   */
  add(amount, maxHp) {
    if (this._finalizing || this.done) return;
    if (amount > 0) this.total += amount | 0;
    if (maxHp > 0) this.maxHp = maxHp;
    this._punchElapsed = 0;
    this._idle = 0;
  }

  /** Begin the final grow-pop + shrink/fade. */
  finalize() {
    if (this._finalizing || this.done) return;
    this._finalizing = true;
    this._finalElapsed = 0;
    this._finalStartScale = this._scaleBase;
  }

  _intensity() {
    return clamp01(this.total / Math.max(1, this.maxHp * INTENSITY_FULL_FRACTION));
  }

  update(dt) {
    if (this.done) return;
    this._age += dt;

    if (this._finalizing) {
      this._finalElapsed += dt;
      if (this._finalElapsed >= FINAL_GROW_MS + FINAL_FADE_MS) this.done = true;
      return;
    }

    // Ease the rest scale toward its intensity-driven target.
    const target = 1 + SCALE_INTENSITY * this._intensity();
    const k = 1 - Math.pow(1 - SCALE_LERP, dt);
    this._scaleBase += (target - this._scaleBase) * k;

    if (this._punchElapsed < PUNCH_MS) this._punchElapsed += dt;

    // Idle → finalize. Held off while the board is still resolving so a long
    // cascade stays as ONE accumulating counter (the "end of the turn" trigger).
    if (this.resolving) {
      this._idle = 0;
    } else if (this.total > 0) {
      this._idle += dt;
      if (this._idle >= FINALIZE_IDLE_MS) this.finalize();
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

  /** Current draw scale + alpha (handles the finalize timeline). */
  _scaleAndAlpha() {
    if (this._finalizing) {
      const e = this._finalElapsed;
      if (e < FINAL_GROW_MS) {
        const p = e / FINAL_GROW_MS;
        const ease = 1 - Math.pow(1 - p, 3); // ease-out
        const peak = this._finalStartScale * FINAL_GROW_SCALE;
        return { scale: this._finalStartScale + (peak - this._finalStartScale) * ease, alpha: 1 };
      }
      const p = (e - FINAL_GROW_MS) / FINAL_FADE_MS;
      const peak = this._finalStartScale * FINAL_GROW_SCALE;
      const end = this._finalStartScale * FINAL_END_SCALE;
      const ease = p * p; // ease-in
      return { scale: peak + (end - peak) * ease, alpha: Math.max(0, 1 - p * p) };
    }
    const intensity = this._intensity();
    const bob = BOB_AMP * intensity * Math.sin(this._age * BOB_FREQ);
    return { scale: this._scaleBase + this._punchScale() + bob, alpha: 1 };
  }

  render(ctx) {
    if (this.done || this.total <= 0) return;

    const { scale, alpha } = this._scaleAndAlpha();
    if (alpha <= 0 || scale <= 0.02) return;

    const intensity = this._intensity();
    const color = rampColor(intensity);
    const fontPx = Math.max(1, Math.round((BASE_FONT + FONT_INTENSITY_GROWTH * intensity) * scale));
    const rot = this._finalizing ? 0 : this._punchRot();
    const text = String(this.total);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(this.x, this.y);
    if (rot) ctx.rotate(rot);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;

    // Dark outline (no glow) for legibility against any background.
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(2, fontPx * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 0, 0);

    // Colored fill with an intensity-scaled glow.
    ctx.shadowColor = color;
    ctx.shadowBlur = (GLOW_BASE + GLOW_INTENSITY * intensity) * scale;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);

    // Additive bloom pass at higher intensity for a "hot" look.
    if (intensity > 0.35) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= (intensity - 0.35) / 0.65 * 0.5;
      ctx.shadowBlur = (GLOW_BASE + GLOW_INTENSITY * intensity) * scale * 1.3;
      ctx.fillText(text, 0, 0);
    }

    ctx.restore();
  }
}
