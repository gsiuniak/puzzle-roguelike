/**
 * PortraitSmackEffect — a "lift and smack" attack lunge for a combatant portrait.
 *
 * When a character deals direct damage (skull match or a damaging skill) the
 * BattleScene drives one of these per side. It's a pure transform generator:
 * it owns no drawing. Each frame `update(dt)` (dt in MILLISECONDS, matching the
 * rest of BattleScene's effects) advances a three-beat timeline —
 *
 *   1. windup  — the portrait LIFTS up and coils back away from the opponent,
 *      growing (anticipation, like raising a hammer),
 *   2. smack   — a fast drive TOWARD the opponent that also slams DOWN through
 *      its resting line (overshooting both reach and the floor), peaking in
 *      scale — the impact,
 *   3. return  — a springy settle back to rest (ease-out-back, a subtle bounce
 *      back up past neutral before landing).
 *
 * — exposing the current {scale, dx, dy, rot} via `getTransform()`, which the
 * pane applies about its portrait's lower-center (see CharacterInfoPane
 * .setPortraitTransform). `dir` is +1 to lunge RIGHT (the player pane, opponent
 * to its right) or −1 to lunge LEFT (the enemy pane). Vertical motion (the lift
 * + slam) is the star; rotation is only a small accent. Externally-managed
 * effect contract: construct, call update(dt) each frame, read `done`.
 */

const WINDUP_MS = 125;  // the lift + coil (anticipation)
const SMACK_MS = 55;    // the drive down/forward — fast + violent
const RETURN_MS = 230;  // springy settle back

const WINDUP_BACK_FRAC = 0.20; // coil-back distance as a fraction of `reach`
const LIFT_FRAC = 0.60;        // how high it rises in windup (fraction of reach)
const SMACK_OVERSHOOT = 1.22;  // forward drive travels past `reach` by this factor
const SMACK_DOWN_FRAC = 0.24;  // how far it slams BELOW rest at impact (of reach)
const SCALE_WINDUP = 1.08;     // scale at the top of the lift
const SCALE_PEAK = 1.46;       // scale at the moment of impact
const ROT_PEAK = 0.07;         // forward-lean accent at impact (radians)
const RETURN_OVERSHOOT = 2.1;  // ease-out-back springiness on the settle

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
    const lift = this.reach * LIFT_FRAC;
    const peakDx = this.reach * SMACK_OVERSHOOT;
    const slam = this.reach * SMACK_DOWN_FRAC;

    if (t < WINDUP_MS) {
      const p = t / WINDUP_MS;
      const e = 1 - (1 - p) * (1 - p); // ease-out — lifts promptly, hangs at the top
      this.dx = -this.dir * back * e;
      this.dy = -lift * e;            // rise up
      this.scale = 1 + (SCALE_WINDUP - 1) * e;
      this.rot = 0;
    } else if (t < WINDUP_MS + SMACK_MS) {
      const p = (t - WINDUP_MS) / SMACK_MS;
      const e = p * p; // ease-in — accelerates into the impact
      // Forward: sweep from the coiled −back through to the overshot reach.
      this.dx = this.dir * ((peakDx + back) * e - back);
      // Vertical: drop from the lifted height, overshooting DOWN past rest.
      this.dy = -lift + (lift + slam) * e;
      this.scale = SCALE_WINDUP + (SCALE_PEAK - SCALE_WINDUP) * e;
      this.rot = this.dir * ROT_PEAK * e; // slight lean into the hit
    } else if (t < WINDUP_MS + SMACK_MS + RETURN_MS) {
      const p = (t - WINDUP_MS - SMACK_MS) / RETURN_MS;
      const e = easeOutBack(p); // springs slightly past neutral, then lands
      this.dx = this.dir * peakDx * (1 - e);
      this.dy = slam * (1 - e);
      this.scale = SCALE_PEAK + (1 - SCALE_PEAK) * e;
      this.rot = this.dir * ROT_PEAK * (1 - e);
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
