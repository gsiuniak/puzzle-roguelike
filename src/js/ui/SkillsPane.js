import UIPanel from './UIPanel.js';
import { createCardModel, measureCardModel, drawCardModel } from './skillCard.js';

/**
 * SkillsPane — fixed-size battle panel showing the EQUIPPED skills as
 * legacy-style auto-height cards, with INTERNAL SCROLLING when they overflow.
 *
 * - The outer panel (art + dimensions) is completely static — nothing around
 *   it ever moves. Only the list inside scrolls/clips.
 * - Cards are the shared legacy renderer (skillCard.js — same cards as the
 *   Manage Skills modal): circular icon, name, structured effect lines with
 *   keyword coloring, mana cost + gem on the right, dynamic heights.
 * - Scrolling: mouse wheel over the panel, touch/mouse drag on the list
 *   (a drag past SCROLL_DRAG_THRESHOLD scrolls instead of casting), and a
 *   thin fantasy-style scrollbar on the right (draggable thumb). Top/bottom
 *   fade shadows appear when there is more content in that direction.
 * - CASTING: a click (press + release without dragging) anywhere on a
 *   castable card casts it (player pane + affordable — BattleController
 *   still validates the turn). Castable cards highlight whole.
 * - A small MANAGE button sits in the panel header (player pane only — shown
 *   when `onManageClick` is wired) and opens the loadout modal; next to it
 *   the equipped count ("5 / 6") set via setEquippedInfo().
 *
 * Implementation: NO child UIElements — everything is drawn manually in
 * renderSelf and hit-tested from the last-rendered layout via
 * handleMouseDown/Move/Up + handleWheel, which BattleScene routes directly
 * (before its turn-state gating). hitTest() returns null. Card description
 * KeywordTexts are exposed via descKeywordTexts as keyword-tooltip sources;
 * cards scrolled out of view set theirs `visible:false` so stale span rects
 * never trigger tooltips.
 */

// ── Outer panel (UNCHANGED dimensions — keep the surrounding layout static) ──
const PANE_PADDING = { top: 48, right: 20, bottom: 24, left: 20 };
// The pane's height was defined by the old grid; preserve it exactly.
const LEGACY_SLOT_HEIGHT = 105;
const LEGACY_ROWS = 6;
const LEGACY_GRID_GAP = 6;
const NATURAL_HEIGHT =
  PANE_PADDING.top + PANE_PADDING.bottom +
  LEGACY_ROWS * LEGACY_SLOT_HEIGHT + (LEGACY_ROWS - 1) * LEGACY_GRID_GAP;

// ── List ──
/** Minimum card slots shown (empty ones render as locked fillers). */
const MIN_SLOTS = 6;
const CARD_GAP = 6;
const LOCKED_CARD_H = 70;
const LOCKED_ICON_SIZE = 26;
const LOCKED_ALPHA = 0.45;

// ── Scrolling ──
const SCROLLBAR_GUTTER = 12;       // space reserved at the right for the bar
const SCROLLBAR_WIDTH = 5;
const SCROLLBAR_TRACK_COLOR = 'rgba(60, 50, 32, 0.55)';
const SCROLLBAR_THUMB_COLOR = 'rgba(214, 188, 120, 0.75)';
const SCROLLBAR_THUMB_MIN_H = 28;
const SCROLL_WHEEL_SPEED = 0.6;    // deltaY multiplier
/** Pointer movement (design px) that turns a press into a scroll-drag
 *  instead of a click-cast. */
const SCROLL_DRAG_THRESHOLD = 12;
const FADE_HEIGHT = 26;            // top/bottom "more content" fade shadows

// ── Header (Manage button + equipped count, drawn in the panel art's top band) ──
const MANAGE_BTN_W = 86;
const MANAGE_BTN_H = 26;
const MANAGE_BTN_MARGIN = { top: 12, right: 16 };
const MANAGE_BTN_BG = 'rgba(38, 30, 16, 0.92)';
const MANAGE_BTN_BG_HOVER = 'rgba(70, 56, 26, 0.95)';
const MANAGE_BTN_BORDER = 'rgba(214, 188, 120, 0.8)';
const MANAGE_BTN_TEXT = '#e8d8a8';
const MANAGE_BTN_FONT_SIZE = 16;
const COUNT_FONT_SIZE = 15;
const COUNT_COLOR = '#9d927c';

const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

export default class SkillsPane extends UIPanel {
  constructor(skills = null, assetManager = null) {
    super();

    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'skill_pane_panel';
    // Lock height — the panel NEVER resizes; the list inside scrolls/clips.
    this.height = NATURAL_HEIGHT;

    /** @type {Function|null} (skillData) => void — wired on the player pane only */
    this.onSkillClick = null;
    /** @type {Function|null} () => void — opens the Manage Skills modal */
    this.onManageClick = null;

    /** @type {Array<{skill:object|null, locked:boolean, model:object|null}>} */
    this._rows = [];
    /** Hovered card index, -1 = none. */
    this._hoverRow = -1;
    this._hoverManage = false;
    /** @type {object|null} player mana for affordability */
    this._mana = null;
    /** Equipped count indicator ("count / max"); null hides it. */
    this._equippedInfo = null;

    // ── Scroll state ──
    this._scrollY = 0;
    this._contentH = 0;
    /** null | 'pending' | 'scroll' | 'bar' — current press interaction */
    this._dragMode = null;
    this._dragStartY = 0;
    this._dragStartScroll = 0;
    this._pressRow = -1;

    /**
     * Last-rendered card layout (absolute design coords, scroll applied):
     * [{ y, h }]. Rebuilt every renderSelf.
     */
    this._rowLayout = [];
    /** Last-rendered scrollbar thumb rect (absolute), null when not shown. */
    this._thumbRect = null;
    /** Last-rendered Manage button rect (absolute), null when hidden. */
    this._manageRect = null;

    this.setSkills(skills || []);
  }

  setAssetManager(am) {
    this._assetManager = am;
    this.assetManager = am;
  }

  setSkills(skills) {
    const list = skills || [];
    this._rows = [];
    for (const skill of list) {
      this._rows.push({ skill, locked: false, model: createCardModel(skill) });
    }
    while (this._rows.length < MIN_SLOTS) {
      this._rows.push({ skill: null, locked: true, model: null });
    }
    this._hoverRow = -1;
    this._rowLayout = [];
    this._scrollY = 0;
    this._dragMode = null;
  }

  /** Update mana for affordability cues (idempotent, called every frame). */
  setManaState(manaState) {
    this._mana = manaState || null;
  }

  /** Header indicator: "count / max" equipped. Pass null to hide. */
  setEquippedInfo(count, max) {
    this._equippedInfo = count != null && max != null ? { count, max } : null;
  }

  /** All effect-line KeywordText elements (inline keyword tooltip sources). */
  get descKeywordTexts() {
    const out = [];
    for (const r of this._rows) {
      if (r.model) out.push(...r.model.effectKTs);
    }
    return out;
  }

  _affordable(skill) {
    if (!skill || !skill.cost || Object.keys(skill.cost).length === 0) return true;
    if (!this._mana) return false;
    for (const [color, amount] of Object.entries(skill.cost)) {
      if ((this._mana[color] || 0) < amount) return false;
    }
    return true;
  }

  _maxScroll() {
    const inner = this._innerRect();
    return Math.max(0, this._contentH - inner.h);
  }

  _setScroll(v) {
    this._scrollY = Math.max(0, Math.min(this._maxScroll(), v));
  }

  // ── Input (routed by BattleScene BEFORE its turn-state gating) ──

  /** Mouse wheel over the panel scrolls the list. Returns true if consumed. */
  handleWheel(x, y, deltaY) {
    if (!this._insideInner(x, y)) return false;
    if (this._maxScroll() <= 0) return true; // over the panel → still consume
    this._setScroll(this._scrollY + deltaY * SCROLL_WHEEL_SPEED);
    return true;
  }

  /**
   * Press. Starts a potential click-cast, scroll-drag, or scrollbar drag.
   * Returns true when consumed (the press landed inside the panel).
   */
  handleMouseDown(x, y) {
    // Manage button lives in the header band (outside the inner list rect).
    if (this._manageRect && this._pointIn(this._manageRect, x, y)) {
      if (this.onManageClick) this.onManageClick();
      return true;
    }
    if (!this._insideInner(x, y)) return false;

    // Scrollbar thumb / track drag
    if (this._thumbRect &&
        x >= this._thumbRect.x - 6 && x <= this._thumbRect.x + this._thumbRect.w + 6) {
      this._dragMode = 'bar';
      this._dragStartY = y;
      this._dragStartScroll = this._scrollY;
      return true;
    }

    this._dragMode = 'pending';
    this._dragStartY = y;
    this._dragStartScroll = this._scrollY;
    this._pressRow = this._rowAt(y);
    return true;
  }

  /** Move: hover tracking + scroll/bar dragging. */
  handleMouseMove(x, y) {
    if (this._dragMode === 'bar') {
      const inner = this._innerRect();
      const trackH = inner.h;
      const ratio = this._contentH > 0 ? trackH / this._contentH : 1;
      this._setScroll(this._dragStartScroll + (y - this._dragStartY) / Math.max(0.0001, ratio));
      return;
    }
    if (this._dragMode === 'pending' &&
        Math.abs(y - this._dragStartY) > SCROLL_DRAG_THRESHOLD &&
        this._maxScroll() > 0) {
      this._dragMode = 'scroll';
    }
    if (this._dragMode === 'scroll') {
      this._setScroll(this._dragStartScroll - (y - this._dragStartY));
      return;
    }

    this._hoverRow = -1;
    this._hoverManage = !!(this._manageRect && this._pointIn(this._manageRect, x, y));
    if (!this._insideInner(x, y)) return;
    this._hoverRow = this._rowAt(y);
  }

  /**
   * Release. A press that never became a drag is a CLICK: clicking anywhere
   * on a castable card casts it. Returns true when consumed.
   */
  handleMouseUp(x, y) {
    const mode = this._dragMode;
    this._dragMode = null;
    if (mode === 'bar' || mode === 'scroll') return true;
    if (mode !== 'pending') return false;

    const i = this._rowAt(y);
    if (i === -1 || i !== this._pressRow || !this._insideInner(x, y)) return true;
    const row = this._rows[i];
    if (row && !row.locked && this.onSkillClick && this._affordable(row.skill)) {
      this.onSkillClick(row.skill);
    }
    return true;
  }

  /** Index of the card at absolute y (uses the last-rendered layout). */
  _rowAt(y) {
    for (let i = 0; i < this._rowLayout.length; i++) {
      const e = this._rowLayout[i];
      if (e && y >= e.y && y <= e.y + e.h) return i;
    }
    return -1;
  }

  /** Clicks are handled exclusively via handleMouseDown/Up — never the
   *  generic onClick dispatch (which is gated by turn state in BattleScene). */
  hitTest(_x, _y) {
    return null;
  }

  _insideInner(x, y) {
    const r = this._innerRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  _innerRect() {
    const r = this.rect;
    return {
      x: r.x + PANE_PADDING.left,
      y: r.y + PANE_PADDING.top,
      w: r.w - PANE_PADDING.left - PANE_PADDING.right,
      h: r.h - PANE_PADDING.top - PANE_PADDING.bottom,
    };
  }

  _pointIn(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  _asset(key) {
    if (!key || !this._assetManager) return null;
    const img = this._assetManager.get(key);
    return img && img.complete !== false ? img : null;
  }

  // ── Render ────────────────────────────────────────────

  renderSelf(ctx) {
    super.renderSelf(ctx); // panel art

    const inner = this._innerRect();
    const cardW = inner.w - SCROLLBAR_GUTTER;
    const layout = [];

    // Hide all keyword spans up front; cards drawn below re-enable theirs.
    for (const r of this._rows) {
      if (r.model) for (const kt of r.model.effectKTs) kt.visible = false;
    }

    // Measure all cards (content height drives the scroll range).
    const measures = [];
    let contentH = 0;
    for (const row of this._rows) {
      let m = null;
      let h = LOCKED_CARD_H;
      if (!row.locked) {
        m = measureCardModel(ctx, row.model, cardW);
        h = m.h;
      }
      measures.push({ m, h });
      contentH += h + CARD_GAP;
    }
    if (this._rows.length) contentH -= CARD_GAP;
    this._contentH = contentH;
    this._setScroll(this._scrollY); // re-clamp (content may have shrunk)

    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip(); // overflow stays INSIDE the panel — it never grows

    let y = inner.y - this._scrollY;
    for (let i = 0; i < this._rows.length; i++) {
      const row = this._rows[i];
      const { m, h } = measures[i];
      const visible = y + h >= inner.y && y <= inner.y + inner.h;
      if (visible) {
        if (row.locked) {
          this._renderLockedCard(ctx, inner.x, y, cardW, h);
        } else {
          if (row.model) for (const kt of row.model.effectKTs) kt.visible = true;
          drawCardModel(ctx, row.model, { x: inner.x, y, w: cardW, h }, m, {
            assetManager: this._assetManager,
            hovered: i === this._hoverRow,
            castable: !row.locked && this._affordable(row.skill) && !!this.onSkillClick,
          });
        }
      }
      layout.push({ y, h });
      y += h + CARD_GAP;
    }

    // Top/bottom fade shadows when there is more content in that direction.
    const maxScroll = this._maxScroll();
    if (maxScroll > 0) {
      if (this._scrollY > 1) {
        const g = ctx.createLinearGradient(0, inner.y, 0, inner.y + FADE_HEIGHT);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(inner.x, inner.y, inner.w, FADE_HEIGHT);
      }
      if (this._scrollY < maxScroll - 1) {
        const g = ctx.createLinearGradient(0, inner.y + inner.h - FADE_HEIGHT, 0, inner.y + inner.h);
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
        ctx.fillStyle = g;
        ctx.fillRect(inner.x, inner.y + inner.h - FADE_HEIGHT, inner.w, FADE_HEIGHT);
      }
    }

    ctx.restore();
    this._rowLayout = layout;

    // ── Thin fantasy scrollbar (right edge, inside the panel) ──
    this._thumbRect = null;
    if (maxScroll > 0) {
      const trackX = inner.x + inner.w - SCROLLBAR_WIDTH;
      ctx.save();
      ctx.fillStyle = SCROLLBAR_TRACK_COLOR;
      ctx.fillRect(trackX, inner.y, SCROLLBAR_WIDTH, inner.h);
      const thumbH = Math.max(SCROLLBAR_THUMB_MIN_H, inner.h * (inner.h / this._contentH));
      const thumbY = inner.y + (inner.h - thumbH) * (this._scrollY / maxScroll);
      ctx.fillStyle = SCROLLBAR_THUMB_COLOR;
      ctx.fillRect(trackX, thumbY, SCROLLBAR_WIDTH, thumbH);
      // Tiny gold caps for the carved look.
      ctx.fillRect(trackX - 1, thumbY, SCROLLBAR_WIDTH + 2, 2);
      ctx.fillRect(trackX - 1, thumbY + thumbH - 2, SCROLLBAR_WIDTH + 2, 2);
      ctx.restore();
      this._thumbRect = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
    }

    // ── Header: Manage button + equipped count ──
    this._manageRect = null;
    if (this.onManageClick) {
      const bx = this.rect.x + this.rect.w - MANAGE_BTN_MARGIN.right - MANAGE_BTN_W;
      const by = this.rect.y + MANAGE_BTN_MARGIN.top;
      ctx.save();
      ctx.fillStyle = this._hoverManage ? MANAGE_BTN_BG_HOVER : MANAGE_BTN_BG;
      ctx.fillRect(bx, by, MANAGE_BTN_W, MANAGE_BTN_H);
      ctx.lineWidth = 1;
      ctx.strokeStyle = MANAGE_BTN_BORDER;
      ctx.strokeRect(bx + 0.5, by + 0.5, MANAGE_BTN_W - 1, MANAGE_BTN_H - 1);
      ctx.font = `${MANAGE_BTN_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.fillStyle = MANAGE_BTN_TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Manage', bx + MANAGE_BTN_W / 2, by + MANAGE_BTN_H / 2 + 1);
      if (this._equippedInfo) {
        ctx.font = `${COUNT_FONT_SIZE}px ${FONT_FAMILY}`;
        ctx.fillStyle = COUNT_COLOR;
        ctx.textAlign = 'right';
        ctx.fillText(`${this._equippedInfo.count} / ${this._equippedInfo.max}`,
          bx - 10, by + MANAGE_BTN_H / 2 + 1);
      }
      ctx.restore();
      this._manageRect = { x: bx, y: by, w: MANAGE_BTN_W, h: MANAGE_BTN_H };
    }
  }

  _renderLockedCard(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(12, 10, 8, 0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 100, 60, 0.3)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const img = this._asset('skills_locked_icon');
    if (img) {
      ctx.globalAlpha *= LOCKED_ALPHA;
      const s = LOCKED_ICON_SIZE;
      ctx.drawImage(img, x + w / 2 - s / 2, y + h / 2 - s / 2, s, s);
    }
    ctx.restore();
  }
}
