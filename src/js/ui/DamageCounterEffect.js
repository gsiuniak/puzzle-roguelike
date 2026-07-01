/**
 * DamageCounterEffect — accumulating combat-damage feedback over the health bar.
 *
 * A single stylized counter appears hovering over the RECEIVING side's health
 * bar (player pane left, enemy pane right) when a damage sequence begins and
 * ACCUMULATES every hit of that sequence instead of spawning one popup per
 * hit. It shows the running total + a chain count:
 *
 *     34          ← big damage digits
 *     DAMAGE      ⎫ the "DAMAGE / CHAIN X" label sprite
 *     CHAIN X 3   ⎭ (the "3" is the chain count, drawn over the CHAIN X line)
 *
 * Lifecycle (a four-phase timeline):
 *   1. ACCUMULATE — compact, parked over the receiver's health bar. Each new
 *      hit bumps the
 *      total + chain and replays a punchy "tick": scale pop, small positional
 *      shake, and a couple of slash accents. Stays small so it doesn't block the
 *      board while damage is still landing.
 *   2. FINALIZE  — once no new damage arrives (and the board has settled), the
 *      block grows large with a bounce/overshoot and holds for readability.
 *   3. FLY       — the whole block detaches and arcs toward the target's
 *      portrait with a fast ease, shrinking as it travels.
 *   4. IMPACT    — at the portrait it bursts: a quick scale pop + radial flash
 *      + spark fan, fires the onImpact() callback (so the scene can shake /
 *      flash the target), then fades and ends.
 *
 * RENDERING is sprite-based (decision #41 / combat-damage spritesheet): the
 * "DAMAGE / CHAIN X" label and every digit are authored sprites sliced from
 * ui_spritesheet_combat_damage, fetched from the AssetManager by key. No text
 * rasterization happens at runtime — each frame is just a few drawImage blits.
 *
 * Not a UIElement — uses absolute design-space coordinates and is managed
 * externally by BattleScene's _floatingEffects list (same contract as
 * FloatingTextEffect): construct, call update(dt) + render(ctx) each frame,
 * remove once `done` is true. The owning scene feeds it the center anchor
 * (over the receiver's health bar), the target anchor (receiver portrait),
 * and the `resolving` hint each frame.
 */

// ── Combat-damage spritesheet (ui_spritesheet_combat_damage) ─────────────────
// Sprites sliced from the sheet (registered in main.js SPRITESHEET_MAP):
//   ui_animated_text_damage_chain_single_digit — "DAMAGE" (big) over "CHAIN X"
//   ui_animated_text_damage_chain_double_digit    on a dark plaque. The plaque
//                                    is widened on the _double_ variant so a
//                                    two-digit chain count fits; we pick the
//                                    variant by the chain count's digit count.
//   digit_0 … digit_9             — individual gold digit glyphs, reused for
//                                    both the big damage total and the chain
//                                    count.
// All frames were packed at a common DIGIT_NATIVE_H source height with NO top
// trim (trim_y = 0), so glyphs share a top origin and lay out cleanly top-
// aligned (scaling each by glyphH / DIGIT_NATIVE_H keeps a uniform baseline).
const LABEL_KEY_SINGLE = 'ui_animated_text_damage_chain_single_digit';
const LABEL_KEY_DOUBLE = 'ui_animated_text_damage_chain_double_digit';
const DIGIT_NATIVE_H = 298;

// Layout (design-space px @ phase scale 1.0). The block stacks vertically:
//     [ big damage number ]          ← digit sprites; height ramps with intensity
//     [ DAMAGE / CHAIN X label ]     ← the label sprite (chain count overlaid)
// The chain-count digits are drawn ON TOP of the label's baked "CHAIN X" line.
const LABEL_DISPLAY_H = 80;           // label height @ scale 1 (label width follows its aspect) Initial: 160
const BLOCK_GAP = 4;                  // gap between the number row and the label
const NUMBER_MIN_H = 84;              // big-number glyph height @ intensity 0
const NUMBER_MAX_H = 112;             // big-number glyph height @ intensity 1
const NUMBER_DIGIT_GAP_FRAC = 0.04;   // gap between big-number digits ÷ glyph height

// Chain-count placement — fractions of the DISPLAYED label rect. The count digit
// sits just right of the baked "CHAIN X" text, matched to its size.
const CHAIN_DIGIT_H_FRAC = 0.29;      // chain digit height ÷ label height
const CHAIN_DIGIT_LEFT_FRAC = 0.72;   // left edge of the chain count ÷ label width
const CHAIN_DIGIT_CY_FRAC = 0.79;     // chain count vertical center ÷ label height
const CHAIN_DIGIT_GAP_FRAC = 0.04;    // gap between chain-count digits ÷ glyph height

// Intensity (relative damage 0..1) → accent color ramp for the IMPACT burst +
// slash flicks (yellow-gold → fiery red). The gold sprites carry their own
// color; this only tints the spark / flash / slash accents.
const COLOR_STOPS = [
  { t: 0.00, c: [255, 210, 74] },   // yellow-gold (low relative dmg)
  { t: 0.35, c: [255, 152, 40] },   // amber
  { t: 0.65, c: [255, 88, 30] },    // hot orange
  { t: 1.00, c: [228, 30, 26] },    // fiery red (high relative dmg)
];

// Damage as a fraction of max HP that reads as "full intensity". Lower = hits
// the hot colors / big sizes sooner (more dramatic on ordinary hits).
const INTENSITY_FULL_FRACTION = 0.4;

// Phase scales (multiply the per-line ref sizes). Compact while accumulating so
// the board stays readable; finalize settles at the design size.
const ACCUMULATE_SCALE = 0.72;
const FINAL_SCALE = 1.0;              // settled finalize size (= design size)
const FLY_END_SCALE = 0.46;          // shrunk size as it reaches the portrait
const FINAL_BACK = 1.5;              // easeOutBack overshoot (lower = gentler pop)

// Per-hit "tick" punch (replayed on every accumulation).
const PUNCH_MS = 260;
const PUNCH_AMP = 0.55;               // peak extra scale
const PUNCH_ROT = 0.12;               // peak wobble (radians)
const SHAKE_AMP = 8;                  // peak positional shake (px), decays

// Idle → finalize. No new damage for this long (while NOT resolving) ends the
// sequence. Held off while the board is still resolving so a long cascade stays
// as ONE accumulating counter.
const FINALIZE_IDLE_MS = 150;

// Finalize timeline: the whole block (number + label) pops to FINAL_SCALE
// (easeOutBack) then holds briefly before flying to the portrait AS ONE UNIT.
const FINAL_GROW_MS = 150;
const FINAL_HOLD_MS = 130;

// Fly-to-portrait. The hop is short now (health bar → portrait within the
// same pane), so the arc bow is modest.
const FLY_MS = 140;
const FLY_ARC_LIFT = 55;              // peak upward bow of the arc (px)

// Impact burst at the portrait.
const IMPACT_MS = 220;
const IMPACT_RING_MAX = 65;           // burst ring radius (px)
const SPARK_COUNT = 10;
const SPARK_LEN = 24;
const SPARK_SPEED = 0.4;              // px/ms outward

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// easeOutBack: overshoots past 1 then settles. FINAL_BACK tunes the overshoot.
function easeOutBack(p) {
  const c1 = FINAL_BACK;
  const c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
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

const PHASE = { ACCUMULATE: 0, FINALIZE: 1, FLY: 2, IMPACT: 3 };

export default class DamageCounterEffect {
  /**
   * @param {number} x - center anchor X (over the receiver's health bar, design space)
   * @param {number} y - center anchor Y
   * @param {object} [assetManager] - AssetManager (for the sliced damage sprites)
   */
  constructor(x, y, assetManager = null) {
    this.x = x;
    this.y = y;
    this._am = assetManager;
    // Where the block flies on finalize (receiver portrait). Defaults to the
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

  /** True once the flying block has reached the portrait (impact fired). The
   *  turn gate releases here so the turn can pass as the burst fades. */
  get delivered() {
    return this._impactFired;
  }

  /** Re-anchor the center (over the receiver's health bar). Only meaningful while accumulating. */
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

  /** Decaying 0..1 "fresh hit" factor driving shake + slash accents. */
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

  // ── Sprite lookups ─────────────────────────────────────────────────────────

  _digitSprite(ch) {
    return this._am ? this._am.get(`digit_${ch}`) : null;
  }

  /** The "DAMAGE / CHAIN X" label, choosing the wider-plaque variant when the
   *  chain count is 10+ (two digits) so the count fits. */
  _labelSprite() {
    if (!this._am) return null;
    const key = this.chain >= 10 ? LABEL_KEY_DOUBLE : LABEL_KEY_SINGLE;
    return this._am.get(key);
  }

  // ── Accumulate + finalize: number + label at the center ───────────────────

  _renderCentered(ctx) {
    const intensity = this._intensity();
    const fresh = this._hitFresh();

    // Phase scale: accumulate ease, or the finalize pop to FINAL_SCALE.
    let scale = this._scaleBase + this._punchScale();
    if (this._phase === PHASE.FINALIZE) {
      const e = this._phaseElapsed;
      scale = e < FINAL_GROW_MS
        ? ACCUMULATE_SCALE + (FINAL_SCALE - ACCUMULATE_SCALE) * easeOutBack(e / FINAL_GROW_MS)
        : FINAL_SCALE;
    }

    // Positional shake + punch wobble on a fresh hit (accumulate only).
    let sx = 0, sy = 0;
    if (this._phase === PHASE.ACCUMULATE && fresh > 0) {
      sx = (Math.random() - 0.5) * 2 * SHAKE_AMP * fresh;
      sy = (Math.random() - 0.5) * 2 * SHAKE_AMP * fresh;
    }
    const rot = this._phase === PHASE.ACCUMULATE ? this._punchRot() : 0;

    ctx.save();
    ctx.translate(this.x + sx, this.y + sy);
    ctx.rotate(rot);
    this._drawBlock(ctx, scale, intensity, 1, fresh, this._phase === PHASE.ACCUMULATE);
    ctx.restore();
  }

  /**
   * Draw the composed block (big number / label / chain count) centered on the
   * current transform origin. The whole block scales as ONE unit, so it stays
   * composed whether parked at center or flying to the portrait. The caller owns
   * the translate/rotate; this owns the layout + sprite blits. `alpha` is the
   * whole-block opacity (for the impact fade).
   */
  _drawBlock(ctx, scale, intensity, alpha, fresh, allowSlashes) {
    const label = this._labelSprite();
    if (!label || !label.width) return; // sheet not loaded yet — draw nothing

    const labelH = LABEL_DISPLAY_H * scale;
    const labelW = labelH * (label.width / label.height);
    const numberH = (NUMBER_MIN_H + (NUMBER_MAX_H - NUMBER_MIN_H) * intensity) * scale;
    const gap = BLOCK_GAP * scale;

    // Stack the number row + label and center the FULL block on the origin.
    const totalH = numberH + gap + labelH;
    const numTopY = -totalH / 2;
    const numCenterY = numTopY + numberH / 2;     // for the slash accents
    const labelTopY = numTopY + numberH + gap;

    // (1) Big damage number — digit sprites, centered horizontally.
    this._drawDigits(ctx, String(this.total), 0, numTopY, numberH, NUMBER_DIGIT_GAP_FRAC, alpha);

    // Slash accents flick across the number on a fresh hit (accumulate only).
    if (allowSlashes && fresh > 0.25) {
      ctx.save();
      ctx.translate(0, numCenterY);
      this._drawSlashes(ctx, numberH, fresh, intensity);
      ctx.restore();
    }

    // (2) The "DAMAGE / CHAIN X" label.
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(label, -labelW / 2, labelTopY, labelW, labelH);
    ctx.restore();

    // (3) Chain count — digit sprites overlaid just right of the "CHAIN X" text,
    // left-aligned at CHAIN_DIGIT_LEFT_FRAC of the label width.
    const chainStr = String(this.chain);
    const chainH = labelH * CHAIN_DIGIT_H_FRAC;
    const chainW = this._measureDigits(chainStr, chainH, CHAIN_DIGIT_GAP_FRAC);
    const chainLeftX = -labelW / 2 + labelW * CHAIN_DIGIT_LEFT_FRAC;
    const chainCx = chainLeftX + chainW / 2;
    const chainTopY = labelTopY + labelH * CHAIN_DIGIT_CY_FRAC - chainH / 2;
    this._drawDigits(ctx, chainStr, chainCx, chainTopY, chainH, CHAIN_DIGIT_GAP_FRAC, alpha);
  }

  /** Total display width of a digit string at `glyphH` (no trailing gap). */
  _measureDigits(str, glyphH, gapFrac) {
    const f = glyphH / DIGIT_NATIVE_H;
    const gap = glyphH * gapFrac;
    let w = 0;
    let n = 0;
    for (const ch of str) {
      const sp = this._digitSprite(ch);
      if (!sp || !sp.width) continue;
      w += sp.width * f;
      n++;
    }
    return n > 0 ? w + gap * (n - 1) : 0;
  }

  /**
   * Draw a digit string centered horizontally on `cx`, top-aligned at `topY`.
   * Each glyph scales by glyphH / DIGIT_NATIVE_H (uniform factor) so the shared
   * top origin keeps the run on a consistent baseline.
   */
  _drawDigits(ctx, str, cx, topY, glyphH, gapFrac, alpha) {
    if (alpha <= 0 || glyphH < 1) return;
    const f = glyphH / DIGIT_NATIVE_H;
    const gap = glyphH * gapFrac;
    const totalW = this._measureDigits(str, glyphH, gapFrac);
    let x = cx - totalW / 2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const ch of str) {
      const sp = this._digitSprite(ch);
      if (!sp || !sp.width) continue;
      const dw = sp.width * f;
      const dh = sp.height * f;
      ctx.drawImage(sp, x, topY, dw, dh);
      x += dw + gap;
    }
    ctx.restore();
  }

  // ── Fly + impact: the WHOLE block arcs to the portrait, then bursts ───────

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

    ctx.save();
    ctx.translate(x, y);
    this._drawBlock(ctx, scale, intensity, alpha, 0, false);
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
