import { createCardModel, measureCardModel, drawCardModel, roundRectPath } from './skillCard.js';

/**
 * SkillLoadoutOverlay — the "Manage Skills / Loadout" MODAL.
 *
 * Opens over the (dimmed, inactive) battle scene from the Skills panel's
 * Manage button. Two columns of legacy-style skill cards (the SHARED
 * skillCard renderer, so they look identical to the battle panel):
 *
 *   LEFT  — Equipped Skills (the battle loadout; ORDER MATTERS)
 *   RIGHT — All Owned Skills (the reserve: everything not equipped)
 *
 * Interactions:
 *   - DRAG & DROP: drag a reserve card onto the equipped column to equip
 *     (inserted at the drop position; if the loadout is FULL, dropping ON an
 *     equipped card replaces it — the replaced skill returns to reserve).
 *     Drag within the equipped column to reorder. Drag an equipped card to
 *     the reserve column to unequip (at least 1 skill stays equipped).
 *   - CLICK-TO-PLACE: click a reserve card to select it (gold outline), then
 *     click an equipped card to swap with it, or an empty slot to equip into
 *     it. Click the selection again (or empty space) to deselect.
 *   - Wheel scrolls the column under the cursor; each column has a thin
 *     fantasy scrollbar (draggable thumb). Empty equipped capacity renders
 *     as dashed "Empty Slot" drop targets.
 *   - Close via the X button or ESC.
 *
 * Contract with BattleScene (mirrors RewardOverlay):
 *   show({ allSkills, equippedIds, maxEquipped, onChange, onClose })
 *   isActive() / getBackdropAlpha() / update(dt) / render(ctx)
 *   handleMouseDown/Move/Up(x, y), handleWheel(x, y, dy), handleKeyDown(e)
 * Every mutation immediately calls onChange(equippedIds) so the battle
 * loadout (and runState) stays live.
 */

const DESIGN_W = 1920;
const DESIGN_H = 1080;

// ── Panel ──
const PANEL_W = 1520;
const PANEL_H = 960;
const PANEL_BG = 'rgba(14, 11, 8, 0.97)';
const PANEL_BORDER_OUTER = '#5a4a2a';
const PANEL_BORDER_INNER = 'rgba(214, 188, 120, 0.55)';
const PANEL_RADIUS = 10;
const TITLE_TEXT = 'Manage Skills / Loadout';
const TITLE_FONT_SIZE = 34;
const TITLE_COLOR = '#d6bc78';
const TITLE_BAND_H = 64;
const FOOTER_TEXT = 'Drag to equip, remove, or reorder. Or click a reserve skill, then an equipped slot.';
const FOOTER_FONT_SIZE = 17;
const FOOTER_COLOR = '#8d8478';
const FOOTER_BAND_H = 40;

// ── Close button ──
const CLOSE_SIZE = 40;
const CLOSE_MARGIN = 14;
const CLOSE_COLOR = '#d6bc78';

// ── Columns ──
const COL_MARGIN_X = 36;
const COL_GAP = 36;
const COL_HEADER_H = 56;
const COL_HEADER_FONT_SIZE = 24;
const COL_HEADER_COLOR = '#cdb87f';
const COL_COUNT_COLOR = '#8d8478';
const COL_BG = 'rgba(0, 0, 0, 0.35)';
const COL_BORDER = 'rgba(120, 100, 60, 0.4)';
const COL_PAD = 12;
const CARD_GAP = 8;

// ── Scrolling (per column) ──
const SCROLLBAR_WIDTH = 5;
const SCROLLBAR_GUTTER = 12;
const SCROLLBAR_TRACK_COLOR = 'rgba(60, 50, 32, 0.55)';
const SCROLLBAR_THUMB_COLOR = 'rgba(214, 188, 120, 0.75)';
const SCROLLBAR_THUMB_MIN_H = 28;
const SCROLL_WHEEL_SPEED = 0.6;

// ── Drag & drop ──
const DRAG_START_PX = 8;        // movement that turns a press into a drag
const DRAG_GHOST_ALPHA = 0.8;
const DROP_LINE_COLOR = 'rgba(214, 188, 120, 0.9)';
const REPLACE_TINT = 'rgba(214, 120, 90, 0.22)';

// ── Empty equipped slots ──
const EMPTY_SLOT_H = 70;
const EMPTY_SLOT_TEXT = 'Empty Slot — drag a skill here';
const EMPTY_SLOT_COLOR = 'rgba(160, 145, 110, 0.55)';

const FADE_HEIGHT = 24;
const BACKDROP_ALPHA = 0.62;
const FADE_IN_MS = 180;

const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

export default class SkillLoadoutOverlay {
  constructor({ assetManager = null } = {}) {
    this._assetManager = assetManager;
    this._active = false;
    this._elapsed = 0;

    /** @type {object[]} equipped skill objects (order = loadout order) */
    this._equipped = [];
    /** @type {object[]} every owned skill (the pool) */
    this._all = [];
    this._maxEquipped = 6;
    /** @type {Function|null} (equippedIds: string[]) => void */
    this._onChange = null;
    /** @type {Function|null} */
    this._onClose = null;

    /** skill id → card model (shared between both columns) */
    this._models = new Map();

    // Scroll state per column.
    this._scroll = { left: 0, right: 0 };
    this._contentH = { left: 0, right: 0 };

    // Hover / selection / drag state.
    this._hover = null;            // { col:'left'|'right', index }
    this._hoverClose = false;
    this._selected = null;         // { col:'right', index } (click-to-place)
    this._drag = null;             // { skill, fromCol, fromIndex, x, y, started, offsetY }
    this._barDrag = null;          // { col, startY, startScroll }

    // Last-rendered layout caches (absolute design coords).
    this._cards = { left: [], right: [] }; // [{ y, h }]
    this._emptySlots = [];                 // equipped column placeholders
    this._listRects = { left: null, right: null };
    this._thumbs = { left: null, right: null };
    this._closeRect = null;
  }

  setAssetManager(am) {
    this._assetManager = am;
  }

  // ── Lifecycle ─────────────────────────────────────────

  /**
   * Open the modal.
   * @param {object} opts
   * @param {object[]} opts.allSkills — every owned skill (resolved objects)
   * @param {string[]} opts.equippedIds — current loadout ids, in order
   * @param {number} opts.maxEquipped
   * @param {Function} opts.onChange — (equippedIds) => void, fired per mutation
   * @param {Function} [opts.onClose]
   */
  show({ allSkills, equippedIds, maxEquipped, onChange, onClose = null, caster = null }) {
    this._all = allSkills || [];
    this._maxEquipped = maxEquipped || 6;
    this._onChange = onChange || null;
    this._onClose = onClose;
    // Owner stats ({ attack, magic }) for live `<<n>>` dynamic damage values.
    this._caster = caster || null;

    const byId = new Map(this._all.map((s) => [s.id, s]));
    this._equipped = [];
    for (const id of equippedIds || []) {
      const s = byId.get(id);
      if (s && !this._equipped.includes(s)) this._equipped.push(s);
    }

    this._models.clear();
    for (const s of this._all) this._models.set(s.id, createCardModel(s));
    // Modal keyword spans are not tooltip sources (the tooltip manager is
    // disabled while a modal is open) — keep them inert.
    for (const m of this._models.values()) {
      for (const kt of m.effectKTs) kt.visible = false;
    }

    this._scroll = { left: 0, right: 0 };
    this._hover = null;
    this._selected = null;
    this._drag = null;
    this._barDrag = null;
    this._elapsed = 0;
    this._active = true;
  }

  dismiss() {
    this._active = false;
    this._drag = null;
    this._selected = null;
    if (this._onClose) this._onClose();
  }

  isActive() {
    return this._active;
  }

  getBackdropAlpha() {
    return BACKDROP_ALPHA * Math.min(1, this._elapsed / FADE_IN_MS);
  }

  update(dt) {
    if (this._active) this._elapsed += dt;
  }

  // ── Data helpers ──────────────────────────────────────

  /** Reserve = owned minus equipped, in pool order. */
  _reserve() {
    return this._all.filter((s) => !this._equipped.includes(s));
  }

  _commit() {
    if (this._onChange) this._onChange(this._equipped.map((s) => s.id));
  }

  _skillAt(col, index) {
    const list = col === 'left' ? this._equipped : this._reserve();
    return list[index] || null;
  }

  // ── Input ─────────────────────────────────────────────

  handleKeyDown(e) {
    if (!this._active) return false;
    if (e.key === 'Escape') {
      this.dismiss();
      return true;
    }
    return true; // swallow all keys while modal is open
  }

  handleWheel(x, y, deltaY) {
    if (!this._active) return false;
    for (const col of ['left', 'right']) {
      const r = this._listRects[col];
      if (r && this._pointIn(r, x, y)) {
        this._setScroll(col, this._scroll[col] + deltaY * SCROLL_WHEEL_SPEED);
        return true;
      }
    }
    return true; // modal swallows the wheel regardless
  }

  handleMouseDown(x, y) {
    if (!this._active) return false;

    if (this._closeRect && this._pointIn(this._closeRect, x, y)) {
      this.dismiss();
      return true;
    }

    // Scrollbar thumbs
    for (const col of ['left', 'right']) {
      const t = this._thumbs[col];
      if (t && x >= t.x - 6 && x <= t.x + t.w + 6 &&
          this._listRects[col] && this._pointIn(this._listRects[col], x, y)) {
        this._barDrag = { col, startY: y, startScroll: this._scroll[col] };
        return true;
      }
    }

    // Press on a card → arm a potential drag.
    for (const col of ['left', 'right']) {
      const idx = this._cardIndexAt(col, x, y);
      if (idx !== -1) {
        const skill = this._skillAt(col, idx);
        if (skill) {
          const entry = this._cards[col][idx];
          this._drag = {
            skill,
            fromCol: col,
            fromIndex: idx,
            x, y,
            started: false,
            offsetY: y - entry.y,
          };
        }
        return true;
      }
    }

    // Click on an empty equipped slot with a selected reserve skill → equip.
    const slotIdx = this._emptySlotAt(x, y);
    if (slotIdx !== -1 && this._selected) {
      const skill = this._skillAt('right', this._selected.index);
      if (skill && this._equipped.length < this._maxEquipped) {
        this._equipped.push(skill);
        this._commit();
      }
      this._selected = null;
      return true;
    }

    this._selected = null; // clicked empty space → deselect
    return true;           // modal swallows everything
  }

  handleMouseMove(x, y) {
    if (!this._active) return;

    if (this._barDrag) {
      const col = this._barDrag.col;
      const r = this._listRects[col];
      if (r) {
        const ratio = this._contentH[col] > 0 ? r.h / this._contentH[col] : 1;
        this._setScroll(col, this._barDrag.startScroll + (y - this._barDrag.startY) / Math.max(0.0001, ratio));
      }
      return;
    }

    if (this._drag) {
      if (!this._drag.started) {
        const dx = x - this._drag.x;
        const dy = y - this._drag.y;
        if (dx * dx + dy * dy > DRAG_START_PX * DRAG_START_PX) this._drag.started = true;
      }
      this._drag.x = x;
      this._drag.y = y;
      return;
    }

    this._hoverClose = !!(this._closeRect && this._pointIn(this._closeRect, x, y));
    this._hover = null;
    for (const col of ['left', 'right']) {
      const idx = this._cardIndexAt(col, x, y);
      if (idx !== -1) {
        this._hover = { col, index: idx };
        return;
      }
    }
  }

  handleMouseUp(x, y) {
    if (!this._active) return false;
    this._barDrag = null;

    const drag = this._drag;
    this._drag = null;
    if (!drag) return true;

    if (!drag.started) {
      this._handleCardClick(drag.fromCol, drag.fromIndex);
      return true;
    }

    // ── Drop ──
    const leftList = this._listRects.left;
    const rightList = this._listRects.right;

    if (leftList && this._pointIn(leftList, x, y)) {
      if (drag.fromCol === 'left') {
        // Reorder within equipped.
        const insertAt = this._insertIndexAt(y, drag.fromIndex);
        const [moved] = this._equipped.splice(drag.fromIndex, 1);
        this._equipped.splice(Math.min(insertAt, this._equipped.length), 0, moved);
        this._commit();
      } else {
        // Reserve → equipped.
        if (this._equipped.length < this._maxEquipped) {
          const insertAt = this._insertIndexAt(y, -1);
          this._equipped.splice(Math.min(insertAt, this._equipped.length), 0, drag.skill);
          this._commit();
        } else {
          // Full: dropping ON a card replaces it.
          const idx = this._cardIndexAt('left', x, y);
          if (idx !== -1) {
            this._equipped.splice(idx, 1, drag.skill);
            this._commit();
          }
        }
      }
    } else if (rightList && this._pointIn(rightList, x, y)) {
      if (drag.fromCol === 'left' && this._equipped.length > 1) {
        // Unequip (always keep at least one skill equipped).
        this._equipped.splice(drag.fromIndex, 1);
        this._commit();
      }
    }
    return true;
  }

  /** Click semantics (press + release without dragging). */
  _handleCardClick(col, index) {
    if (col === 'right') {
      // Select / deselect a reserve skill.
      if (this._selected && this._selected.index === index) this._selected = null;
      else this._selected = { col: 'right', index };
      return;
    }
    // Equipped card clicked.
    if (this._selected) {
      const incoming = this._skillAt('right', this._selected.index);
      if (incoming) {
        this._equipped.splice(index, 1, incoming); // swap: old one returns to reserve
        this._commit();
      }
      this._selected = null;
    }
  }

  /** Insertion index in the equipped list for a drop at absolute y.
   *  `ignoreIndex` (own card during reorder) is skipped for midpoints. */
  _insertIndexAt(y, ignoreIndex) {
    const cards = this._cards.left;
    let insert = 0;
    for (let i = 0; i < this._equipped.length; i++) {
      if (i === ignoreIndex) continue;
      const e = cards[i];
      if (!e) break;
      if (y > e.y + e.h / 2) insert = i + (i > ignoreIndex && ignoreIndex !== -1 ? 0 : 1);
    }
    // Adjust for the removed element when reordering downward.
    if (ignoreIndex !== -1 && insert > ignoreIndex) insert -= 0; // splice handles it
    return insert;
  }

  _cardIndexAt(col, x, y) {
    const list = this._listRects[col];
    if (!list || !this._pointIn(list, x, y)) return -1;
    const cards = this._cards[col];
    for (let i = 0; i < cards.length; i++) {
      const e = cards[i];
      if (e && y >= e.y && y <= e.y + e.h) return i;
    }
    return -1;
  }

  _emptySlotAt(x, y) {
    for (let i = 0; i < this._emptySlots.length; i++) {
      if (this._pointIn(this._emptySlots[i], x, y)) return i;
    }
    return -1;
  }

  _setScroll(col, v) {
    const r = this._listRects[col];
    const max = r ? Math.max(0, this._contentH[col] - r.h) : 0;
    this._scroll[col] = Math.max(0, Math.min(max, v));
  }

  _pointIn(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  // ── Render ────────────────────────────────────────────

  // canvasW/H = the CURRENT design-viewport size (BattleScene passes them —
  // the battle uses an adaptive wide viewport, so the width can exceed 1920;
  // the DESIGN_* constants are only the no-arg fallback).
  render(ctx, canvasW = DESIGN_W, canvasH = DESIGN_H) {
    if (!this._active) return;

    const px = (canvasW - PANEL_W) / 2;
    const py = (canvasH - PANEL_H) / 2;

    // ── Panel (carved dark stone + double gold border) ──
    ctx.save();
    roundRectPath(ctx, px, py, PANEL_W, PANEL_H, PANEL_RADIUS);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PANEL_BORDER_OUTER;
    ctx.stroke();
    roundRectPath(ctx, px + 5, py + 5, PANEL_W - 10, PANEL_H - 10, PANEL_RADIUS - 3);
    ctx.lineWidth = 1;
    ctx.strokeStyle = PANEL_BORDER_INNER;
    ctx.stroke();

    // Title
    ctx.font = `${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = TITLE_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.fillText(TITLE_TEXT, px + PANEL_W / 2, py + TITLE_BAND_H / 2 + 4);
    ctx.shadowBlur = 0;

    // Footer hint
    ctx.font = `${FOOTER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = FOOTER_COLOR;
    ctx.fillText(FOOTER_TEXT, px + PANEL_W / 2, py + PANEL_H - FOOTER_BAND_H / 2 - 4);

    // Close button (X)
    const cx = px + PANEL_W - CLOSE_MARGIN - CLOSE_SIZE;
    const cy = py + CLOSE_MARGIN;
    this._closeRect = { x: cx, y: cy, w: CLOSE_SIZE, h: CLOSE_SIZE };
    ctx.beginPath();
    ctx.arc(cx + CLOSE_SIZE / 2, cy + CLOSE_SIZE / 2, CLOSE_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = this._hoverClose ? 'rgba(80, 62, 28, 0.95)' : 'rgba(38, 30, 16, 0.92)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CLOSE_COLOR;
    ctx.stroke();
    ctx.strokeStyle = CLOSE_COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const ix = cx + CLOSE_SIZE / 2;
    const iy = cy + CLOSE_SIZE / 2;
    ctx.beginPath();
    ctx.moveTo(ix - 8, iy - 8); ctx.lineTo(ix + 8, iy + 8);
    ctx.moveTo(ix + 8, iy - 8); ctx.lineTo(ix - 8, iy + 8);
    ctx.stroke();

    // ── Columns ──
    const colW = (PANEL_W - COL_MARGIN_X * 2 - COL_GAP) / 2;
    const colY = py + TITLE_BAND_H;
    const colH = PANEL_H - TITLE_BAND_H - FOOTER_BAND_H;
    const leftX = px + COL_MARGIN_X;
    const rightX = leftX + colW + COL_GAP;

    const reserve = this._reserve();
    this._renderColumn(ctx, 'left', leftX, colY, colW, colH,
      'Equipped Skills', `${this._equipped.length} / ${this._maxEquipped} Equipped`, this._equipped);
    this._renderColumn(ctx, 'right', rightX, colY, colW, colH,
      'All Owned Skills', `${reserve.length} in reserve`, reserve);

    // ── Drag ghost (on top of everything) ──
    if (this._drag && this._drag.started) {
      const model = this._models.get(this._drag.skill.id);
      if (model) {
        const ghostW = colW - COL_PAD * 2 - SCROLLBAR_GUTTER;
        const m = measureCardModel(ctx, model, ghostW, { caster: this._caster });
        drawCardModel(ctx, model,
          { x: this._drag.x - ghostW / 2, y: this._drag.y - this._drag.offsetY, w: ghostW, h: m.h },
          m, { assetManager: this._assetManager, alpha: DRAG_GHOST_ALPHA });
      }
    }

    ctx.restore();
  }

  _renderColumn(ctx, col, x, y, w, h, title, countText, skills) {
    // Header
    ctx.save();
    ctx.font = `${COL_HEADER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = COL_HEADER_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, x + 6, y + COL_HEADER_H / 2 - 4);
    ctx.font = `15px ${FONT_FAMILY}`;
    ctx.fillStyle = COL_COUNT_COLOR;
    ctx.textAlign = 'right';
    ctx.fillText(countText, x + w - 6, y + COL_HEADER_H / 2 - 4);
    ctx.restore();

    // List background
    const list = { x, y: y + COL_HEADER_H, w, h: h - COL_HEADER_H - 16 };
    this._listRects[col] = list;
    ctx.save();
    roundRectPath(ctx, list.x, list.y, list.w, list.h, 6);
    ctx.fillStyle = COL_BG;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COL_BORDER;
    ctx.stroke();
    ctx.restore();

    const cardX = list.x + COL_PAD;
    const cardW = list.w - COL_PAD * 2 - SCROLLBAR_GUTTER;

    // Measure
    const measures = [];
    let contentH = 0;
    for (const skill of skills) {
      const model = this._models.get(skill.id);
      const m = measureCardModel(ctx, model, cardW, { caster: this._caster });
      measures.push(m);
      contentH += m.h + CARD_GAP;
    }
    // Empty equipped slots count toward content height.
    let emptyCount = 0;
    if (col === 'left') {
      emptyCount = Math.max(0, this._maxEquipped - skills.length);
      contentH += emptyCount * (EMPTY_SLOT_H + CARD_GAP);
    }
    if (contentH > 0) contentH -= CARD_GAP;
    this._contentH[col] = contentH;
    this._setScroll(col, this._scroll[col]);

    // Cards (clipped + scrolled)
    ctx.save();
    ctx.beginPath();
    ctx.rect(list.x, list.y, list.w, list.h);
    ctx.clip();

    const cards = [];
    let cy = list.y + COL_PAD / 2 - this._scroll[col];
    const draggingThis = (i) => this._drag && this._drag.started
      && this._drag.fromCol === col && this._drag.fromIndex === i;

    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      const model = this._models.get(skill.id);
      const m = measures[i];
      const visible = cy + m.h >= list.y && cy <= list.y + list.h;
      if (visible) {
        const isReplaceTarget = this._drag && this._drag.started
          && this._drag.fromCol === 'right' && col === 'left'
          && this._equipped.length >= this._maxEquipped
          && this._hoverIndexForDrag() === i;
        drawCardModel(ctx, model, { x: cardX, y: cy, w: cardW, h: m.h }, m, {
          assetManager: this._assetManager,
          hovered: !this._drag && this._hover && this._hover.col === col && this._hover.index === i,
          selected: this._selected && col === 'right' && this._selected.index === i,
          alpha: draggingThis(i) ? 0.3 : 1,
        });
        if (isReplaceTarget) {
          ctx.fillStyle = REPLACE_TINT;
          ctx.fillRect(cardX, cy, cardW, m.h);
        }
      }
      cards.push({ y: cy, h: m.h });
      cy += m.h + CARD_GAP;
    }

    // Empty equipped slots (drop targets / click-to-place targets)
    if (col === 'left') {
      this._emptySlots = [];
      for (let s = 0; s < emptyCount; s++) {
        const rect = { x: cardX, y: cy, w: cardW, h: EMPTY_SLOT_H };
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = EMPTY_SLOT_COLOR;
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `16px ${FONT_FAMILY}`;
        ctx.fillStyle = EMPTY_SLOT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(EMPTY_SLOT_TEXT, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        ctx.restore();
        this._emptySlots.push(rect);
        cy += EMPTY_SLOT_H + CARD_GAP;
      }
    }

    // Drop insertion indicator (equipped column, while dragging with room /
    // reordering).
    if (this._drag && this._drag.started && col === 'left'
      && this._listRects.left && this._pointIn(this._listRects.left, this._drag.x, this._drag.y)) {
      const canInsert = this._drag.fromCol === 'left' || this._equipped.length < this._maxEquipped;
      if (canInsert) {
        const insertAt = this._insertIndexAt(this._drag.y, this._drag.fromCol === 'left' ? this._drag.fromIndex : -1);
        let lineY;
        if (insertAt <= 0) lineY = (cards[0] ? cards[0].y : list.y + COL_PAD / 2) - CARD_GAP / 2;
        else if (insertAt >= cards.length) lineY = cards.length ? cards[cards.length - 1].y + cards[cards.length - 1].h + CARD_GAP / 2 : list.y + COL_PAD / 2;
        else lineY = cards[insertAt].y - CARD_GAP / 2;
        ctx.strokeStyle = DROP_LINE_COLOR;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cardX + 4, lineY);
        ctx.lineTo(cardX + cardW - 4, lineY);
        ctx.stroke();
      }
    }

    // Fade shadows
    const maxScroll = Math.max(0, contentH - list.h);
    if (maxScroll > 0) {
      if (this._scroll[col] > 1) {
        const g = ctx.createLinearGradient(0, list.y, 0, list.y + FADE_HEIGHT);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(list.x, list.y, list.w, FADE_HEIGHT);
      }
      if (this._scroll[col] < maxScroll - 1) {
        const g = ctx.createLinearGradient(0, list.y + list.h - FADE_HEIGHT, 0, list.y + list.h);
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
        ctx.fillStyle = g;
        ctx.fillRect(list.x, list.y + list.h - FADE_HEIGHT, list.w, FADE_HEIGHT);
      }
    }

    ctx.restore();
    this._cards[col] = cards;

    // Scrollbar
    this._thumbs[col] = null;
    if (maxScroll > 0) {
      const trackX = list.x + list.w - SCROLLBAR_WIDTH - 3;
      ctx.save();
      ctx.fillStyle = SCROLLBAR_TRACK_COLOR;
      ctx.fillRect(trackX, list.y + 3, SCROLLBAR_WIDTH, list.h - 6);
      const thumbH = Math.max(SCROLLBAR_THUMB_MIN_H, (list.h - 6) * (list.h / contentH));
      const thumbY = list.y + 3 + (list.h - 6 - thumbH) * (this._scroll[col] / maxScroll);
      ctx.fillStyle = SCROLLBAR_THUMB_COLOR;
      ctx.fillRect(trackX, thumbY, SCROLLBAR_WIDTH, thumbH);
      ctx.fillRect(trackX - 1, thumbY, SCROLLBAR_WIDTH + 2, 2);
      ctx.fillRect(trackX - 1, thumbY + thumbH - 2, SCROLLBAR_WIDTH + 2, 2);
      ctx.restore();
      this._thumbs[col] = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
    }
  }

  /** While dragging from reserve over a FULL equipped column: which equipped
   *  card is under the cursor (the replace target)? */
  _hoverIndexForDrag() {
    if (!this._drag) return -1;
    return this._cardIndexAt('left', this._drag.x, this._drag.y);
  }
}
