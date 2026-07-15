/**
 * PortraitSmackEffect — a punchy "attack lunge" for a combatant portrait.
 *
 * When a character deals direct damage (skull match or a damaging skill) the
 * BattleScene drives one of these per side. It's a pure transform generator:
 * it owns no drawing. Each frame `update(dt)` (dt in MILLISECONDS, matching the
 * rest of BattleScene's effects) advances a three-beat timeline —
 *
 *   1. windup  — a coiled pull BACK away from the opponent, a slight lean-back
 *      tilt, and a touch of grow (anticipation),
 *   2. strike  — a fast lunge TOWARD the opponent that OVERSHOOTS the reach,
 *      peaking in scale, leaning forward into the hit with a small upward hop,
 *   3. return  — a springy settle back to rest (ease-out-back, a subtle
 *      overshoot past neutral before landing).
 *
 * — exposing the current {scale, dx, dy, rot} via `getTransform()`, which the
 * pane applies about its portrait's center (see CharacterInfoPane
 * .setPortraitTransform). `dir` is +1 to lunge RIGHT (the player pane, opponent
 * to its right) or −1 to lunge LEFT (the enemy pane). Externally-managed effect
 * contract: construct, call update(dt) each frame, read `done`.
 */

const WINDUP_MS = 120;  // coiled anticipation
const STRIKE_MS = 70;   // the lunge — fast + overshoots
const RETURN_MS = 300;  // springy settle back

const WINDUP_BACK_FRAC = 0.22; // pull-back distance as a fraction of `reach`
const STRIKE_OVERSHOOT = 1.12; // strike travels past `reach` by this factor
const SCALE_WINDUP = 1.05;     // scale at the top of the windup
const SCALE_PEAK = 1.30;       // scale at the moment of impact
const HOP_FRAC = 0.10;         // upward hop at impact, as a fraction of `reach`
const ROT_WINDUP = 0.05;       // lean-BACK tilt during windup (radians)
const ROT_PEAK = 0.14;         // lean-INTO-the-hit tilt at impact (radians)
const RETURN_OVERSHOOT = 1.6;  // ease-out-back springiness on the settle

// Ease-out-back: overshoots 1 then settles. Higher `s` = more spring.
function easeOutBack(p, s = RETURN_OVERSHOOT) {
  const c = s + 1;
  const q = p - 1;
  return 1 + c * q * q * q + s * q * q;
}

export class PortraitSmackEffect {
  /**
   * @param {object} opts
   * @param {number} [opts.dir=1] +1 lunges right (player), −1 lunges left (enemy).
   * @param {number} [opts.reach=55] Forward lunge distance in design-space px.
   */
  constructor({ dir = 1, reach = 55 } = {}) {
    this.dir = dir >= 0 ? 1 : -1;
    this.reach = reach;
    this._t = 0;
    this.scale = 1;
    this.dx = 0;
    this.dy = 0;
    this.rot = 0;
    this.done = false;
  }

  update(dt) {
    if (this.done) return;
    this._t += dt;
    const t = this._t;
    const back = this.reach * WINDUP_BACK_FRAC;
    const peakDx = this.reach * STRIKE_OVERSHOOT;

    if (t < WINDUP_MS) {
      const p = t / WINDUP_MS;
      const e = p * p; // ease-in — coils slowly, snaps at the end
      this.dx = -this.dir * back * e;
      this.scale = 1 + (SCALE_WINDUP - 1) * e;
      this.rot = -this.dir * ROT_WINDUP * e; // lean back
      this.dy = 0;
    } else if (t < WINDUP_MS + STRIKE_MS) {
      const p = (t - WINDUP_MS) / STRIKE_MS;
      const e = 1 - (1 - p) * (1 - p); // ease-out — explosive then eases into impact
      // Sweep from the windup's −back through to the overshot reach.
      this.dx = this.dir * ((peakDx + back) * e - back);
      this.scale = SCALE_WINDUP + (SCALE_PEAK - SCALE_WINDUP) * e;
      this.rot = -this.dir * ROT_WINDUP + this.dir * (ROT_PEAK + ROT_WINDUP) * e; // whip forward
      this.dy = -this.reach * HOP_FRAC * Math.sin(p * Math.PI); // rise + fall hop
    } else if (t < WINDUP_MS + STRIKE_MS + RETURN_MS) {
      const p = (t - WINDUP_MS - STRIKE_MS) / RETURN_MS;
      const e = easeOutBack(p); // springs slightly past neutral, then lands
      this.dx = this.dir * peakDx * (1 - e);
      this.scale = SCALE_PEAK + (1 - SCALE_PEAK) * e;
      this.rot = this.dir * ROT_PEAK * (1 - e);
      this.dy = 0;
    } else {
      this.dx = 0;
      this.dy = 0;
      this.rot = 0;
      this.scale = 1;
      this.done = true;
    }
  }

  /** Current transform to hand to CharacterInfoPane.setPortraitTransform. */
  getTransform() {
    return { scale: this.scale, dx: this.dx, dy: this.dy, rot: this.rot };
  }
}
