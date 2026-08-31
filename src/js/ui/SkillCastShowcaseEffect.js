/**
 * SkillCastShowcaseEffect — "the opponent played this card."
 *
 * When the ENEMY casts a skill, most players are watching the board — not the
 * enemy's skills pane. This effect animates a COPY of the cast skill's card
 * (the shared skillCard renderer, so it looks exactly like the pane's card)
 * flying out of the enemy pane, scaling up near center stage, holding a beat
 * so the player can read what was just cast, then dissolving away toward the
 * caster. The Hearthstone opponent-card-play moment.
 *
 * Owns a PRIVATE card model (createCardModel(skill)) — deliberately separate
 * from the SkillsPane's models so its KeywordTexts never feed the tooltip
 * system's recorded rects. Model + measure are built lazily on first render
 * (measureCardModel needs a live ctx).
 *
 * Externally-managed effect contract (update(dt)/render(ctx)/done); lives in
 * BattleScene's _floatingEffects (inside the shake transform, above panes).
 */

import { createCardModel, measureCardModel, drawCardModel } from './skillCard.js';

const FLY_IN_MS = 260;   // pane → showcase spot
const HOLD_MS = 620;     // read-the-card beat
const OUT_MS = 240;      // dissolve toward the caster

const SHOWCASE_SCALE = 1.18; // card scale at the showcase spot
const OUT_SCALE = 0.55;      // scale as it dissolves
const HOLD_BOB_PX = 4;       // gentle float amplitude during HOLD
const TILT_RAD = 0.035;      // slight settle tilt as it arrives

function easeOutCubic(p) { return 1 - (1 - p) * (1 - p) * (1 - p); }
function easeInCubic(p) { return p * p * p; }

export default class SkillCastShowcaseEffect {
  /**
   * @param {object} skill - the cast skill (catalog/woven def with name/cost/effects)
   * @param {object} opts
   * @param {object} opts.assetManager
   * @param {{x:number,y:number}} opts.center     - showcase spot (design space)
   * @param {{x:number,y:number,w:number,h:number}} [opts.startRect] - the card's
   *   rect in the enemy SkillsPane (flight origin; falls back to growing in place)
   * @param {{x:number,y:number}} [opts.outTarget] - where the dissolve drifts
   *   toward (the caster portrait); defaults to the start rect / center
   * @param {object} [opts.caster] - caster battle state (live <<n>> values)
   * @param {number} [opts.cardW=320] - base card width the model is measured at
   * @param {number} [opts.holdMs] - override the read beat
   * @param {function} [opts.onDone]
   */
  constructor(skill, opts = {}) {
    this.skill = skill;
    this.am = opts.assetManager || null;
    this.center = opts.center || { x: 960, y: 430 };
    this.startRect = opts.startRect || null;
    this.outTarget = opts.outTarget
      || (this.startRect
        ? { x: this.startRect.x + this.startRect.w / 2, y: this.startRect.y + this.startRect.h / 2 }
        : this.center);
    this.caster = opts.caster || null;
    this.cardW = opts.cardW != null ? opts.cardW : 320;
    this.holdMs = opts.holdMs != null ? opts.holdMs : HOLD_MS;
    this._onDone = typeof opts.onDone === 'function' ? opts.onDone : null;

    this._model = null; // built lazily (needs ctx)
    this._m = null;
    this.elapsed = 0;
    this.done = false;
    this._total = FLY_IN_MS + this.holdMs + OUT_MS;
  }

  update(dt) {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= this._total) {
      this.done = true;
      if (this._onDone) this._onDone();
    }
  }

  _ensureModel(ctx) {
    if (!this._model) this._model = createCardModel(this.skill);
    // Measured every render (cheap memo inside) so live stats stay current.
    this._m = measureCardModel(ctx, this._model, this.cardW, { caster: this.caster });
  }

  render(ctx) {
    if (this.done) return;
    this._ensureModel(ctx);
    const m = this._m;
    if (!m) return;

    const t = this.elapsed;
    let cx; let cy; let scale; let alpha; let rot = 0;

    const start = this.startRect
      ? { x: this.startRect.x + this.startRect.w / 2, y: this.startRect.y + this.startRect.h / 2 }
      : this.center;
    const startScale = this.startRect
      ? Math.max(0.3, Math.min(1, this.startRect.h / Math.max(1, m.h)))
      : 0.5;

    if (t <= FLY_IN_MS) {
      const p = easeOutCubic(t / FLY_IN_MS);
      cx = start.x + (this.center.x - start.x) * p;
      cy = start.y + (this.center.y - start.y) * p;
      scale = startScale + (SHOWCASE_SCALE - startScale) * p;
      alpha = Math.min(1, 0.35 + p);
      rot = TILT_RAD * (1 - p);
    } else if (t <= FLY_IN_MS + this.holdMs) {
      const ht = t - FLY_IN_MS;
      cx = this.center.x;
      cy = this.center.y + Math.sin(ht / 260) * HOLD_BOB_PX;
      scale = SHOWCASE_SCALE;
      alpha = 1;
    } else {
      const p = easeInCubic((t - FLY_IN_MS - this.holdMs) / OUT_MS);
      cx = this.center.x + (this.outTarget.x - this.center.x) * p;
      cy = this.center.y + (this.outTarget.y - this.center.y) * p;
      scale = SHOWCASE_SCALE + (OUT_SCALE - SHOWCASE_SCALE) * p;
      alpha = 1 - p;
    }

    if (alpha <= 0) return;

    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.scale(scale, scale);
    // Soft backdrop shadow so the card pops off the busy battle behind it.
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = '#000000';
    ctx.fillRect(-this.cardW / 2 - 6, -m.h / 2 + 8, this.cardW + 12, m.h + 4);
    ctx.globalAlpha = 1;
    drawCardModel(
      ctx, this._model,
      { x: -this.cardW / 2, y: -m.h / 2, w: this.cardW, h: m.h },
      m,
      { assetManager: this.am, castable: true, alpha },
    );
    ctx.restore();
  }
}
