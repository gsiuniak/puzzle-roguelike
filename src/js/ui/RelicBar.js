import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';

// ── Tunable layout constants ─────────────────────────────
// These are the per-bar internals; the BattleScene owns the bar's
// outer width/height/margins so the layout offset stays in one place.
// No background or border — relics float over the battle background.
const BAR_PADDING = { top: 40, right: 55, bottom: 0, left: 0 };
const ICON_SIZE = 70;
const ICON_GAP = 13;

// ── Pagination (page-flip arrows when relics overflow the column) ─────────
// When more relics are collected than fit in the column height, the list is
// split into pages. A down-arrow appears at the bottom (next page) and an
// up-arrow at the top (previous page). Sizes are design-space px.
const ARROW_WIDTH = 42;
const ARROW_HEIGHT = 24;
/** Vertical gap between an arrow and the icon stack it borders. */
const ARROW_GAP = 10;
/** Extra clickable padding around an arrow's drawn triangle (touch comfort). */
const ARROW_HIT_PADDING = 14;
const ARROW_COLOR = '#ccaa77';
const ARROW_SHADOW = 'rgba(0, 0, 0, 0.6)';

// Tooltip layout for relic icons. Tweak here, not at call sites.
const TOOLTIP_SCALE   = 1.0;
const TOOLTIP_OFFSET  = 16;
const TOOLTIP_PADDING = 22;
// Extra design-px around the 50×50 icon that still triggers the tooltip.
// Makes the icon comfortably tappable on phones without enlarging the art.
const TOOLTIP_HIT_PADDING = 12;

/**
 * RelicBar — thin, passive vertical column that displays collected relics
 * as small icons (Slay-the-Spire style).
 *
 * Sits to the left of the player character panel. Icons stack from the top
 * downward; the column has no background or border so the icons appear to
 * "float" against the battle background.
 *
 * Pagination: when the collected relics don't all fit in the column height,
 * the bar shows one page at a time with up/down arrows to flip pages. The
 * arrows are drawn directly by the bar (not child elements) and clicked via
 * `handlePageClick(x, y)` (called by BattleScene's mousedown handler). Icon
 * clicks remain passive (`hitTest` returns null) — only the arrows react.
 *
 * Each icon registers a tooltip with the supplied TooltipManager showing the
 * relic's name and description; only the current page's icons are attached.
 *
 * Usage:
 *   const col = new RelicBar(assetManager);
 *   col.setTooltipManager(tooltipManager); // optional
 *   col.setRelics(playerState.relics);     // safe to call every frame
 *   // in mousedown: if (col.handlePageClick(x, y)) return;
 */
export default class RelicBar extends UIContainer {
  constructor(assetManager = null, tooltipManager = null) {
    super();

    this._assetManager = assetManager;
    this._tooltipManager = tooltipManager;
    this.smoothing = true;

    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'start';
    this.gap = ICON_GAP;
    this.padding = BAR_PADDING;

    /** Last set of relic ids — used to skip rebuilds when unchanged. */
    this._lastRelicSignature = '';
    /** Cached last relic list. */
    this._lastRelics = [];
    /** @type {UIImage[]} icon images for the CURRENT page only. */
    this._iconImages = [];

    // ── Pagination state ──
    /** Current page index (0-based). */
    this._page = 0;
    /** Whether the relic list overflows and needs paging. */
    this._paginate = false;
    /** Icons shown per page (computed from the column height). */
    this._pageSize = 0;
    /** Total page count. */
    this._pageCount = 1;
    /** Signature of the currently-built page slice (skip redundant rebuilds). */
    this._builtSliceSig = null;
    /** Drawn arrow hit-rects (null when that arrow is hidden). */
    this._upArrowRect = null;
    this._downArrowRect = null;
  }

  setAssetManager(am) {
    this._assetManager = am;
    for (const img of this._iconImages) img.assetManager = am;
  }

  /**
   * Set the TooltipManager used to register per-icon tooltips. Always
   * triggers a rebuild so attachments are re-registered even when the same
   * manager reference is passed in — BattleScene reuses one manager across
   * battles and calls `clear()` between them.
   * @param {import('../systems/TooltipManager.js').default|null} tm
   */
  setTooltipManager(tm) {
    if (this._tooltipManager && this._tooltipManager !== tm) {
      for (const img of this._iconImages) this._tooltipManager.detach(img);
    }
    this._tooltipManager = tm;
    this._builtSliceSig = null; // force re-attach of the current page
    this._relayoutPage();
  }

  /**
   * Replace the displayed relics. Idempotent: re-paginates only when the
   * relic id list actually changes, so it's safe to call every frame.
   * @param {Array<{id:string, name?:string, description?:string, icon?:string}>} relics
   */
  setRelics(relics) {
    const list = Array.isArray(relics) ? relics : [];
    const signature = list.map(r => (r && r.id) || '').join('|');
    if (signature === this._lastRelicSignature) return;
    this._lastRelicSignature = signature;
    this._lastRelics = list;
    this._relayoutPage();
  }

  /**
   * Manual layout: compute pagination from the column height, (re)build the
   * current page's icons, and position icons + arrows. We override rather
   * than use flex so a single page lays out exactly like the old column and
   * the arrows can claim reserved space at top/bottom.
   */
  layoutChildren() {
    this._relayoutPage();
  }

  /**
   * Recompute pagination for the current rect, rebuild the visible page's
   * icon children if the slice changed, and position everything. Safe to
   * call any time the rect, relic list, or page index changes.
   */
  _relayoutPage() {
    const content = this.getContentRect();
    const contentH = Math.max(0, content.h);
    const total = this._lastRelics.length;
    const rowH = ICON_SIZE + ICON_GAP;

    // How many icons fit without any arrows.
    const fitNoPager = Math.max(1, Math.floor((contentH + ICON_GAP) / rowH));

    let paginate;
    let pageSize;
    if (total <= fitNoPager) {
      paginate = false;
      pageSize = Math.max(1, total);
    } else {
      paginate = true;
      // Reserve only a BOTTOM arrow band — the up-arrow floats above the icons
      // in the column's top padding, so it never pushes the relics down.
      const reserved = ARROW_HEIGHT + ARROW_GAP;
      pageSize = Math.max(1, Math.floor((contentH - reserved + ICON_GAP) / rowH));
    }

    const pageCount = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
    this._page = Math.min(Math.max(0, this._page), pageCount - 1);
    this._paginate = paginate;
    this._pageSize = pageSize;
    this._pageCount = pageCount;

    // Rebuild icon children only when the visible slice actually changes.
    const start = this._page * pageSize;
    const slice = this._lastRelics.slice(start, start + pageSize);
    const sliceSig = `${this._page}|${pageSize}|` + slice.map(r => (r && r.id) || '').join('|');
    if (sliceSig !== this._builtSliceSig) {
      this._builtSliceSig = sliceSig;
      this._buildIcons(slice);
    }

    this._positionPage(content);
  }

  /**
   * (Re)create the icon UIImages for the given relic slice and register their
   * tooltips. Detaches the previous page's tooltips first.
   * @param {Array<object>} slice
   */
  _buildIcons(slice) {
    if (this._tooltipManager) {
      for (const img of this._iconImages) this._tooltipManager.detach(img);
    }
    this.clearChildren();
    this._iconImages = [];

    for (const relic of slice) {
      if (!relic) continue;
      const iconKey = relic.icon || 'placeholder';
      const img = new UIImage(iconKey, this._assetManager);
      img.setStyle({
        width: ICON_SIZE,
        height: ICON_SIZE,
        fitMode: 'contain',
      });
      this._iconImages.push(img);
      this.addChild(img);

      if (this._tooltipManager && (relic.description || relic.name)) {
        this._tooltipManager.attach(img, {
          title: relic.name || '',
          text: relic.description || '',
          scale: TOOLTIP_SCALE,
          offset: TOOLTIP_OFFSET,
          padding: TOOLTIP_PADDING,
          hitPadding: TOOLTIP_HIT_PADDING,
        });
      }
    }
  }

  /**
   * Position the current page's icons (stacked, centered on the column) and
   * compute the up/down arrow hit-rects for this page.
   * @param {import('./Rect.js').default} content — content rect (inside padding)
   */
  _positionPage(content) {
    const centerX = content.x + content.w / 2;
    const rowH = ICON_SIZE + ICON_GAP;

    // Icons always start at the top of the content area — the up-arrow floats
    // above them (in the top padding) rather than reserving a row.
    let y = content.y;
    for (const img of this._iconImages) {
      img.rect.x = centerX - ICON_SIZE / 2;
      img.rect.y = y;
      img.rect.w = ICON_SIZE;
      img.rect.h = ICON_SIZE;
      img.layoutChildren();
      y += rowH;
    }

    // Arrow rects: up shown when a previous page exists, down when a next one does.
    // The up-arrow sits ABOVE the first icon (overlapping the top padding band),
    // so showing/hiding it never shifts the relic icons.
    const ax = centerX - ARROW_WIDTH / 2;
    this._upArrowRect = (this._paginate && this._page > 0)
      ? { x: ax, y: content.y - ARROW_GAP - ARROW_HEIGHT, w: ARROW_WIDTH, h: ARROW_HEIGHT }
      : null;
    this._downArrowRect = (this._paginate && this._page < this._pageCount - 1)
      ? { x: ax, y: content.y + content.h - ARROW_HEIGHT, w: ARROW_WIDTH, h: ARROW_HEIGHT }
      : null;
  }

  /**
   * Handle a click at (x, y). If it lands on a visible page arrow, flip the
   * page and return true (so the caller consumes the click). Otherwise false.
   * @param {number} x @param {number} y — canvas/design coords
   * @returns {boolean}
   */
  handlePageClick(x, y) {
    if (!this._paginate) return false;
    if (this._upArrowRect && this._hitArrow(this._upArrowRect, x, y)) {
      this._page = Math.max(0, this._page - 1);
      this._relayoutPage();
      return true;
    }
    if (this._downArrowRect && this._hitArrow(this._downArrowRect, x, y)) {
      this._page = Math.min(this._pageCount - 1, this._page + 1);
      this._relayoutPage();
      return true;
    }
    return false;
  }

  _hitArrow(r, x, y) {
    const p = ARROW_HIT_PADDING;
    return x >= r.x - p && x <= r.x + r.w + p && y >= r.y - p && y <= r.y + r.h + p;
  }

  // ── Render ───────────────────────────────────────────
  render(ctx) {
    if (!this.visible) return;
    super.render(ctx); // draws the icon children at their positioned rects
    if (this._upArrowRect)   this._drawArrow(ctx, this._upArrowRect, 'up');
    if (this._downArrowRect) this._drawArrow(ctx, this._downArrowRect, 'down');
  }

  /** Draw a single filled triangle arrow within `r`, pointing `dir`. */
  _drawArrow(ctx, r, dir) {
    const cx = r.x + r.w / 2;
    ctx.save();
    ctx.fillStyle = ARROW_COLOR;
    ctx.shadowColor = ARROW_SHADOW;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    if (dir === 'up') {
      ctx.moveTo(cx, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.lineTo(r.x, r.y + r.h);
    } else {
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + r.w, r.y);
      ctx.lineTo(cx, r.y + r.h);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Passive display — icon clicks never absorb input (arrows use handlePageClick). */
  hitTest() {
    return null;
  }
}
