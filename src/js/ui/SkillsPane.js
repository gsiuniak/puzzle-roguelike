import UIPanel from './UIPanel.js';
import {
  createCardModel, measureCardModel, drawCardModel,
  CARD_BG_KEY, CARD_PAD, ICON_SIZE,
} from './skillCard.js';

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

// ── Outer panel — sized to the 2026-07 `skill_pane_panel` art ──
// The new art is 535×715 (aspect ≈0.75, shorter than the old 488×956 frame).
// NATURAL_HEIGHT ≈ column width / 0.75 keeps the frame art near-unstretched at
// the ~440px wide-viewport side column. Padding hugs the new frame: the top
// band (~60px native) is the centered nameplate tab + top rail; sides/bottom
// are the metal border.
const PANE_PADDING = { top: 54, right: 10, bottom: 22, left: 18 };
const NATURAL_HEIGHT = 600;

// ── List ──
/** Minimum card slots shown (empty ones render as GHOST placeholder cards). */
const MIN_SLOTS = 8;
const CARD_GAP = 2;

// ── Ghost slots (empty placeholders — dimmed card silhouettes, NO lock) ──
// They mirror the real card's geometry (same frame art, same icon position)
// at much lower contrast, so the list keeps its rhythm and the empty space
// reads as "future skill slot", not "disabled button".
const GHOST_CARD_H = 76;
const GHOST_BASE_BG = 'rgba(10, 8, 6, 0.55)';
const GHOST_BORDER = 'rgba(120, 100, 60, 0.22)';
const GHOST_FRAME_ALPHA = 0.22;      // skills_button art, heavily dimmed
const GHOST_ICON_FILL = 'rgba(5, 4, 3, 0.6)';     // circular icon recess
const GHOST_ICON_RING = 'rgba(150, 130, 90, 0.18)';
const GHOST_ICON_INNER_RING = 'rgba(0, 0, 0, 0.4)';
const GHOST_DIVIDER = 'rgba(214, 188, 120, 0.06)'; // faint placeholder line

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
// The button's vertical CENTER is derived from TITLE_CENTER_Y_FRAC (same band
// as the nameplate tab), so the two always line up; only the right inset is a
// margin. Keep the inset clear of the frame's top-right corner crest.
const MANAGE_BTN_W = 82;
const MANAGE_BTN_H = 26;
const MANAGE_BTN_MARGIN = { right: 34 };
const MANAGE_BTN_BG = 'rgba(38, 30, 16, 0.92)';
const MANAGE_BTN_BG_HOVER = 'rgba(70, 56, 26, 0.95)';
const MANAGE_BTN_BORDER = 'rgba(214, 188, 120, 0.8)';
const MANAGE_BTN_TEXT = '#e8d8a8';
const MANAGE_BTN_FONT_SIZE = 16;
const COUNT_FONT_SIZE = 15;
const COUNT_COLOR = '#9d927c';

// ── Nameplate title ("Skills") ──
// The panel art's nameplate no longer bakes in the word, so it's drawn as text
// centered in the nameplate banner. Y is a FRACTION of panel height (the art is
// stretched to the rect), so it tracks the banner if the panel resizes.
const TITLE_TEXT = 'Skills';
const TITLE_FONT_SIZE = 26;
const TITLE_COLOR = '#e8d8a8';
// The new art's nameplate tab spans y ≈ 0..50 of 715 native → center ≈ 0.036.
const TITLE_CENTER_Y_FRAC = 0.036;
const TITLE_LETTER_SPACING = 1.5;

// ── Whether to show Equipped Info 
const EQUIPPED_INFO_IS_ENABLED = false

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

  /**
   * The owning combatant's stats ({ attack, magic }) used to live-resolve a
   * skill's `<<n>>` dynamic damage values. Idempotent — called every frame.
   * @param {{attack?:number, magic?:number}|null} stats
   */
  setOwnerStats(stats) {
    this._ownerStats = stats || null;
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

    // Centered "Skills" title in the nameplate banner (the art no longer bakes
    // the word in). Drawn for both the player and enemy panes.
    ctx.save();
    ctx.font = `${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = TITLE_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${TITLE_LETTER_SPACING}px`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(TITLE_TEXT,
      this.rect.x + this.rect.w / 2,
      this.rect.y + this.rect.h * TITLE_CENTER_Y_FRAC);
    ctx.restore();

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
      let h = GHOST_CARD_H;
      if (!row.locked) {
        m = measureCardModel(ctx, row.model, cardW, { caster: this._ownerStats });
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
          this._renderGhostCard(ctx, inner.x, y, cardW, h);
        } else {
          if (row.model) for (const kt of row.model.effectKTs) kt.visible = true;
          drawCardModel(ctx, row.model, { x: inner.x, y, w: cardW, h }, m, {
            assetManager: this._assetManager,
            hovered: i === this._hoverRow,
            // "Castable" = affordable with the current mana. Highlighted for BOTH
            // panes (player: you can cast it; enemy: it can cast it) — clicking is
            // separately gated by onSkillClick in handleMouseUp.
            castable: !row.locked && this._affordable(row.skill),
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
      // Vertically centered on the same band as the nameplate tab title.
      const by = Math.round(this.rect.y + this.rect.h * TITLE_CENTER_Y_FRAC - MANAGE_BTN_H / 2);
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
      if (this._equippedInfo && EQUIPPED_INFO_IS_ENABLED) {
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

  /**
   * Ghost slot — a dimmed placeholder card silhouette (NO lock symbol).
   * Mirrors the real card: same frame art (heavily dimmed) and a faint
   * circular icon recess at the exact spot a real skill's icon sits, so the
   * list keeps its rhythm and empty space reads as "future skill slot".
   */
  _renderGhostCard(ctx, x, y, w, h) {
    ctx.save();

    // Dark base + faint border (lower contrast than active cards).
    ctx.fillStyle = GHOST_BASE_BG;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = GHOST_BORDER;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // The carved frame art, heavily dimmed — keeps the card silhouette.
    const frame = this._asset(CARD_BG_KEY);
    if (frame) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha *= GHOST_FRAME_ALPHA;
      ctx.drawImage(frame, x, y, w, h);
      ctx.restore();
    }

    // Circular icon recess at the real icon's position (clamped to the
    // ghost card's height so shorter slots keep a proportioned well).
    const r = Math.min(ICON_SIZE / 2, (h - 14) / 2);
    const cx = x + CARD_PAD.left + ICON_SIZE / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = GHOST_ICON_FILL;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = GHOST_ICON_RING;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, r - 4), 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = GHOST_ICON_INNER_RING;
    ctx.stroke();

    // Very faint placeholder line where a skill name would sit.
    const lineX = x + CARD_PAD.left + ICON_SIZE + 14;
    const lineW = Math.max(0, w - (lineX - x) - CARD_PAD.right - 20);
    if (lineW > 30) {
      ctx.fillStyle = GHOST_DIVIDER;
      ctx.fillRect(lineX, cy - 1, lineW * 0.55, 2);
    }

    ctx.restore();
  }
}
