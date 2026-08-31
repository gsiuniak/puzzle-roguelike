/**
 * PortraitRecoilEffect — the RECEIVER's half of the impact sandwich.
 *
 * PortraitSmackEffect lunges the ATTACKER's portrait toward the opponent;
 * this is its mirror on the side that takes the hit: a fast knockback AWAY
 * from the attack (with a small compression dip and a backward lean), then a
 * springy ease-out-back settle to rest. Driven by BattleScene when a damage
 * carrier (skull stream / spell projectile) lands, so the flinch happens at
 * the moment of visual impact — not when the model applied the damage.
 *
 * Pure transform generator (owns no drawing): update(dt) in MILLISECONDS,
 * read `getTransform()` → {scale, dx, dy, rot}, applied by
 * CharacterInfoPane.setPortraitTransform about the portrait's lower-center.
 * `dir` is the knockback direction: −1 pushes LEFT (the player pane, attack
 * arriving from the right), +1 pushes RIGHT (the enemy pane).
 * `intensity` (0..1) scales the whole gesture — a chip hit barely nudges,
 * a huge hit rocks the portrait.
 *
 * Externally-managed contract: construct, update(dt) each frame, read `done`.
 * Restartable: BattleScene calls hit(intensity) on an existing instance to
 * re-jolt mid-settle (successive skull arrivals) without allocation.
 */

const JOLT_MS = 60;     // the shove — fast and involuntary
const RETURN_MS = 300;  // springy settle back to rest

const BASE_KNOCKBACK = 30;   // px at intensity 1 (scaled by `reach` factor)
const KNOCK_LIFT_FRAC = 0.22; // slight upward pop as the hit lands (of knockback)
const SCALE_DIP = 0.045;      // compression at the jolt peak (1 − dip·intensity)
const ROT_PEAK = 0.05;        // backward lean at the jolt peak (radians)
const RETURN_OVERSHOOT = 1.9; // ease-out-back springiness

function easeOutBack(p, s = RETURN_OVERSHOOT) {
  const c = s + 1;
  const q = p - 1;
  return 1 + c * q * q * q + s * q * q;
}

export class PortraitRecoilEffect {
  /**
   * @param {object} opts
   * @param {number} [opts.dir=-1] −1 knocks left (player pane), +1 right (enemy pane).
   * @param {number} [opts.intensity=0.5] 0..1 hit weight.
   * @param {number} [opts.reach=1] extra multiplier (portrait-size adaptation).
   */
  constructor({ dir = -1, intensity = 0.5, reach = 1 } = {}) {
    this.dir = dir >= 0 ? 1 : -1;
    this.reach = reach;
    this._t = 0;
    this._intensity = 0;
    this.scale = 1;
    this.dx = 0;
    this.dy = 0;
    this.rot = 0;
    this.done = false;
    this.hit(intensity);
  }

  /**
   * (Re)start the jolt at the given intensity. A stronger hit always wins;
   * a weaker one landing mid-settle still restarts the jolt at its own
   * weight so rapid chip hits read as a stutter, not nothing.
   */
  hit(intensity) {
    this._intensity = Math.max(0.15, Math.min(1, intensity || 0));
    this._t = 0;
    this.done = false;
  }

  update(dt) {
    if (this.done) return;
    this._t += dt;

    const k = BASE_KNOCKBACK * this._intensity * this.reach;
    const lift = k * KNOCK_LIFT_FRAC;

    if (this._t <= JOLT_MS) {
      // Shove out — ease-out so the first frames carry most of the motion.
      const p = this._t / JOLT_MS;
      const e = 1 - (1 - p) * (1 - p);
      this.dx = this.dir * k * e;
      this.dy = -lift * e;
      this.scale = 1 - SCALE_DIP * this._intensity * e;
      this.rot = -this.dir * ROT_PEAK * this._intensity * e;
    } else if (this._t <= JOLT_MS + RETURN_MS) {
      // Springy settle back past neutral.
      const p = (this._t - JOLT_MS) / RETURN_MS;
      const e = 1 - easeOutBack(p); // 1 → 0 with a slight negative overshoot
      this.dx = this.dir * k * e;
      this.dy = -lift * e;
      this.scale = 1 - SCALE_DIP * this._intensity * e;
      this.rot = -this.dir * ROT_PEAK * this._intensity * e;
    } else {
      this.scale = 1;
      this.dx = 0;
      this.dy = 0;
      this.rot = 0;
      this.done = true;
    }
  }

  /** Current transform for CharacterInfoPane.setPortraitTransform. */
  getTransform() {
    return { scale: this.scale, dx: this.dx, dy: this.dy, rot: this.rot };
  }
}
