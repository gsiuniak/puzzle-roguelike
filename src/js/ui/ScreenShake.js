/**
 * ScreenShake — a self-contained screen-shake effect.
 *
 * Triggered when damage is dealt to a character. The shake intensity
 * scales with damage as a percentage of the target's max HP, capped
 * at 20%+ for a dramatic shake.
 *
 * Not a UIElement — managed externally by BattleScene, similar to
 * FloatingImageEffect. Applies a canvas translation offset each frame.
 *
 * Lifecycle:
 *   1. Call trigger(intensity) when damage is dealt.
 *   2. Call update(dt) each frame.
 *   3. Call getOffset() each frame to obtain {x, y} translation.
 *   4. Check `active` to skip offset work when idle.
 *
 * Shake mechanics:
 *   - Two overlapping sinusoidal oscillations at different frequencies
 *     for a natural, non-repetitive feel.
 *   - Amplitude decays quadratically over the duration.
 *   - Max pixel offset ranges from ~4px (min damage) to ~18px (20%+).
 */

export default class ScreenShake {
  constructor() {
    /** Current shake intensity (0-1), set by trigger() */
    this.intensity = 0;

    /** Elapsed time in ms since last trigger */
    this.elapsed = 0;

    /** Total shake duration in ms */
    this.duration = 320;

    /** Whether the shake is currently active */
    this.active = false;

    /**
     * Directional bias (−1 | 0 | +1): the attack axis. A hit traveling
     * left→right (player attacking) shoves the screen RIGHT (+1) on its
     * leading edge before the normal oscillation takes over, so the shake
     * reads as "hit from the left" rather than a generic rumble.
     */
    this.dirX = 0;
  }

  /**
   * Trigger a screen shake. If already shaking, the higher intensity wins.
   * @param {number} intensity - 0.0 to 1.0 (clamped internally)
   * @param {number} [dirX=0] - optional attack-axis bias: +1 shoves right,
   *   −1 shoves left, 0 keeps the classic non-directional shake.
   */
  trigger(intensity, dirX = 0) {
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped <= 0) return;

    // If already shaking, only upgrade the intensity (don't reset elapsed
    // or we'd get a jarring restart). Only start fresh if idle.
    if (!this.active || clamped > this.intensity) {
      this.intensity = clamped;
      this.dirX = dirX > 0 ? 1 : (dirX < 0 ? -1 : 0);
    }
    if (!this.active) {
      this.elapsed = 0;
      this.active = true;
    }
  }

  /**
   * Advance the shake animation by dt milliseconds.
   * @param {number} dt - delta time in ms
   */
  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.active = false;
      this.intensity = 0;
      this.elapsed = 0;
    }
  }

  /**
   * Get the current screen-space offset for this frame.
   * Returns {x: 0, y: 0} when the shake is inactive.
   * @returns {{x: number, y: number}}
   */
  getOffset() {
    if (!this.active || this.intensity <= 0) {
      return { x: 0, y: 0 };
    }

    const progress = this.elapsed / this.duration; // 0 → 1

    // Quadratic decay: starts at 1.0, ends near 0
    const decay = (1 - progress) * (1 - progress);

    // Max pixel offset scales with intensity:
    //   intensity 0.05 → ~4 px
    //   intensity 1.0  → ~18 px
    const maxOffset = 4 + this.intensity * 14;

    const amplitude = maxOffset * decay;

    // Two overlapping sine waves at different frequencies and phases
    // to produce a natural, non-metronomic shake.
    const t = this.elapsed;
    let x = Math.sin(t * 0.062 + 1.7) * amplitude
          + Math.sin(t * 0.113 + 0.4) * amplitude * 0.45;
    const y = Math.cos(t * 0.073 + 0.3) * amplitude
            + Math.cos(t * 0.097 + 2.1) * amplitude * 0.45;

    // Directional shove: a strong initial kick along the attack axis that
    // dies off faster than the oscillation (front-loaded via decay²), so the
    // first visible frames carry the hit's direction and the tail is the
    // familiar rumble.
    if (this.dirX !== 0) {
      x += this.dirX * maxOffset * decay * decay * 1.1;
    }

    return {
      x: Math.round(x),
      y: Math.round(y),
    };
  }
}
