import UIContainer from './UIContainer.js';
import UIImage from './UIImage.js';
import { resolveDynamicText } from '../data/scalingConfig.js';
import { roundRectPath } from './skillCard.js';

// ── Tunable layout constants ─────────────────────────────
// These are the per-bar internals; the BattleScene owns the bar's
// outer width/height/margins so the layout offset stays in one place.
// No background or border — relics float over the battle background.
//
// Positioning model: the icon COLUMN is anchored to the PANEL-side edge of the
// bar (the side set via setGradientDarkSide — 'right' for the player bar, 'left'
// for the enemy bar). The icon-column center sits ICON_INSET_FROM_PANEL px in
// from that edge, and the first icon ICON_TOP_MARGIN px down from the bar's top.
// Tweak these two to move the whole relic stack; the backdrop gradient anchors
// to the actual icon rects, so it follows automatically.
const ICON_SIZE = 70;
const ICON_GAP = 13;
/** First icon's top offset from the bar's top edge. */
const ICON_TOP_MARGIN = 30;
/**
 * Icon-column CENTER distance from the panel-side edge of the bar. NOTE the bar
 * (RELIC_COL_WIDTH 90) overlaps the panel by ~|MAIN_ROW_GAP| (32px), so icons
 * sit at (edge − inset ± ICON_SIZE/2): 68 parks the stack flush beside the
 * tightly-cropped panel frame with a ~1px gap. Raise to push icons further
 * into the open battle area, lower to tuck them against (over) the panel.
 */
const ICON_INSET_FROM_PANEL = 68;
const BAR_PADDING = { top: ICON_TOP_MARGIN, right: 0, bottom: 0, left: 0 };

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

// ── Trigger "jiggle" animation ────────────────────────────
// When a relic's passive fires, its icon quickly rotates back and forth in a
// small arc, then settles back to upright. All three are configurable.
const JIGGLE_AMPLITUDE_DEG = 10;   // peak rotation to each side (±degrees)
const JIGGLE_OSCILLATIONS  = 3;    // number of full back-and-forth swings
const JIGGLE_DURATION_MS   = 420;  // total animation length

// ── Backdrop gradient ────────────────────────────────────
// A subtle black gradient behind the floating relic icons to lift them off the
// battle background: darkest (semi-transparent) at the edge nearest the
// character panel, fading to fully transparent away from it. Anchored to the
// ACTUAL icon rects (position + count) so it always aligns with the stack.
const GRADIENT_DARK_ALPHA = 0.42;    // black alpha at the panel-side edge
const GRADIENT_WIDTH = 20;          // px width of the fade band
const GRADIENT_DARK_OVERHANG = 12;   // how far past the icons (toward panel) the dark edge sits
const GRADIENT_V_PAD = 12;           // vertical padding above/below the icon stack

// ── Counter badge (every-N relics, e.g. Hourglass) ───────────────────────
// A relic whose effect carries a `condition.everyN` gate gets a small pill
// badge on its icon's lower-right edge showing the live counter (0…N-1),
// read each frame from the effect's `_everyNCounter`. Styled after the
// skill-card mana cost pill (dark backing, thin gold trim, white number).
const COUNTER_BADGE_H = Math.round(ICON_SIZE * 0.38);
const COUNTER_BADGE_FONT_SIZE = Math.round(COUNTER_BADGE_H * 0.68);
const COUNTER_BADGE_PAD_X = 7;           // pill end-cap padding
const COUNTER_BADGE_OFFSET = { x: 4, y: 3 }; // past the icon's lower-right edge
const COUNTER_BADGE_BG = 'rgba(10, 8, 5, 0.95)';
const COUNTER_BADGE_BORDER = 'rgba(214, 188, 120, 0.85)';
const COUNTER_BADGE_NUMBER = '#ffffff';
const COUNTER_BADGE_FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

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

    /**
     * Which edge of the bar the backdrop gradient is darkest at — the side that
     * abuts the character panel. 'right' (default, player bar) | 'left' (enemy
     * bar) | null (no gradient). Set via setGradientDarkSide().
     */
    this._gradientDarkSide = 'right';
    /** Owner stats ({ attack, magic }) for live `<<n>>` tooltip damage values. */
    this._ownerStats = null;
    /** Signature of the owner stats last baked into tooltips (re-attach gate). */
    this._ownerStatsSig = '';
    /** Last set of relic ids — used to skip rebuilds when unchanged. */
    this._lastRelicSignature = '';
    /** Cached last relic list. */
    this._lastRelics = [];
    /** @type {UIImage[]} icon images for the CURRENT page only. */
    this._iconImages = [];
    /** @type {string[]} relic ids parallel to _iconImages (current page). */
    this._iconRelicIds = [];
    /** @type {object[]} relic objects parallel to _iconImages — kept as live
     * references so per-frame badges (everyN counters) read current values. */
    this._iconRelics = [];

    /**
     * Active jiggle animations keyed by relic id → elapsed ms. Keyed by id
     * (not icon index) so the animation survives page rebuilds and applies to
     * whichever icon currently represents that relic. Advanced in update(dt).
     * @type {Map<string, number>}
     */
    this._jiggles = new Map();

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
   * Owner stats ({ attack, magic }) used to live-resolve `<<n>>` dynamic damage
   * values inside relic tooltips (e.g. a "Deal <<1>> [[mag]]" relic shows its
   * real Magic-scaled amount). Idempotent — called every frame; only forces a
   * tooltip re-attach when the stats actually change. Safe to omit (tooltips
   * then show the base amount).
   * @param {{attack?:number, magic?:number}|null} stats
   */
  setOwnerStats(stats) {
    this._ownerStats = stats || null;
    const sig = stats ? `${stats.attack || 0}|${stats.magic || 0}` : '';
    if (sig === this._ownerStatsSig) return;
    this._ownerStatsSig = sig;
    // Re-bake the current page's tooltip text with the new stats.
    this._builtSliceSig = null;
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
    this._iconRelicIds = [];
    this._iconRelics = [];

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
      this._iconRelicIds.push(relic.id || '');
      this._iconRelics.push(relic);
      this.addChild(img);

      if (this._tooltipManager && (relic.description || relic.name)) {
        // Resolve `<<n>>` dynamic damage values from the owner's current stats
        // so a scaling relic's tooltip shows its real, stat-scaled amount.
        const text = resolveDynamicText(relic.description || '', relic.effects, this._ownerStats);
        this._tooltipManager.attach(img, {
          title: relic.name || '',
          text,
          scale: TOOLTIP_SCALE,
          offset: TOOLTIP_OFFSET,
          padding: TOOLTIP_PADDING,
          hitPadding: TOOLTIP_HIT_PADDING,
        });
      }
    }
  }

  /**
   * The icon-column center X — anchored ICON_INSET_FROM_PANEL in from the
   * panel-side edge of the bar (the side set via setGradientDarkSide), so the
   * stack tucks against the character panel and mirrors correctly per side.
   */
  _iconColumnCenterX() {
    const r = this.rect;
    return this._gradientDarkSide === 'left'
      ? r.x + ICON_INSET_FROM_PANEL              // enemy bar — panel on the left
      : r.x + r.w - ICON_INSET_FROM_PANEL;       // player bar — panel on the right
  }

  /**
   * Position the current page's icons (stacked, anchored to the panel side) and
   * compute the up/down arrow hit-rects for this page.
   * @param {import('./Rect.js').default} content — content rect (inside padding)
   */
  _positionPage(content) {
    const centerX = this._iconColumnCenterX();
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

  // ── Trigger jiggle ───────────────────────────────────
  /**
   * Start (or restart) the jiggle animation for the relic with the given id.
   * Safe to call when the relic isn't on the visible page — the animation is
   * tracked by id and applies to whichever icon represents it.
   * @param {string} relicId
   */
  triggerJiggle(relicId) {
    if (!relicId) return;
    this._jiggles.set(relicId, 0); // restart from the beginning
  }

  /**
   * Advance active jiggles and write each animating relic's current rotation
   * onto its on-page icon. Completed jiggles snap the icon back to upright.
   * @param {number} dt — delta time in ms
   */
  update(dt) {
    super.update(dt);
    if (this._jiggles.size === 0) return;

    const amp = (JIGGLE_AMPLITUDE_DEG * Math.PI) / 180;
    for (const [relicId, elapsedPrev] of this._jiggles) {
      const elapsed = elapsedPrev + dt;
      const idx = this._iconRelicIds.indexOf(relicId);
      if (elapsed >= JIGGLE_DURATION_MS) {
        // Done — settle upright and stop tracking.
        if (idx >= 0 && this._iconImages[idx]) this._iconImages[idx].rotation = 0;
        this._jiggles.delete(relicId);
        continue;
      }
      this._jiggles.set(relicId, elapsed);
      // Pure sine over N full swings: starts and ends at exactly 0, peaking at
      // ±amplitude on each swing. (Integer oscillations → sin = 0 at p = 1.)
      const p = elapsed / JIGGLE_DURATION_MS;
      const angle = amp * Math.sin(p * Math.PI * 2 * JIGGLE_OSCILLATIONS);
      if (idx >= 0 && this._iconImages[idx]) this._iconImages[idx].rotation = angle;
    }
  }

  /**
   * Set which edge the backdrop gradient is darkest at (the panel side).
   * @param {'left'|'right'|null} side
   */
  setGradientDarkSide(side) {
    this._gradientDarkSide = side;
  }

  // ── Render ───────────────────────────────────────────
  render(ctx) {
    if (!this.visible) return;
    // this._renderBackdropGradient(ctx); // behind the icons
    super.render(ctx); // draws the icon children at their positioned rects
    this._drawCounterBadges(ctx);
    if (this._upArrowRect)   this._drawArrow(ctx, this._upArrowRect, 'up');
    if (this._downArrowRect) this._drawArrow(ctx, this._downArrowRect, 'down');
  }

  /**
   * Draw a counter badge on every visible relic that carries an everyN effect
   * (e.g. Hourglass: extra turn every 10 matches). The badge shows the live
   * `_everyNCounter` (0 when unset — the counter only exists on per-battle
   * effect clones once PassiveSystem starts counting). Drawn per frame so the
   * number updates the moment the counter advances, with no icon rebuild.
   */
  _drawCounterBadges(ctx) {
    for (let i = 0; i < this._iconImages.length; i++) {
      const relic = this._iconRelics[i];
      if (!relic) continue;
      const counterEffect = (relic.effects || []).find(
        e => e && e.condition && e.condition.everyN > 0
      );
      if (!counterEffect) continue;

      const r = this._iconImages[i].rect;
      const label = String(counterEffect._everyNCounter || 0);

      ctx.save();
      ctx.font = `bold ${COUNTER_BADGE_FONT_SIZE}px ${COUNTER_BADGE_FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      const numW = ctx.measureText(label).width;
      const pillW = Math.max(COUNTER_BADGE_H, COUNTER_BADGE_PAD_X * 2 + numW);
      // Anchor: pill's bottom-right corner pokes just past the icon's edge
      // (same anchoring as the skill-card mana cost badge).
      const px = r.x + r.w + COUNTER_BADGE_OFFSET.x - pillW;
      const py = r.y + r.h + COUNTER_BADGE_OFFSET.y - COUNTER_BADGE_H;

      roundRectPath(ctx, px, py, pillW, COUNTER_BADGE_H, COUNTER_BADGE_H / 2);
      ctx.fillStyle = COUNTER_BADGE_BG;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = COUNTER_BADGE_BORDER;
      ctx.stroke();

      ctx.fillStyle = COUNTER_BADGE_NUMBER;
      ctx.textAlign = 'center';
      ctx.fillText(label, px + pillW / 2, py + COUNTER_BADGE_H / 2 + 1);
      ctx.restore();
    }
  }

  /**
   * Draw the subtle black gradient behind the icons. It's anchored to the ACTUAL
   * icon rects (so it always aligns with the stack regardless of bar padding):
   * a vertical band spanning the icon stack (+GRADIENT_V_PAD), darkest just past
   * the icons toward the panel and fading to transparent away from it. No icons
   * → no gradient.
   */
  // _renderBackdropGradient(ctx) {
  //   if (!this._gradientDarkSide || this._iconImages.length === 0) return;
  //   const first = this._iconImages[0].rect;
  //   const last = this._iconImages[this._iconImages.length - 1].rect;
  //   if (!first || first.w <= 0) return;

  //   const cx = first.x + first.w / 2;          // icon column center (icons share x)
  //   const top = first.y - GRADIENT_V_PAD;
  //   const h = (last.y + last.h + GRADIENT_V_PAD) - top;

  //   const darkLeft = this._gradientDarkSide === 'left';
  //   // Dark edge sits just past the icons toward the panel; fade GRADIENT_WIDTH out.
  //   const darkX = darkLeft
  //     ? cx - ICON_SIZE / 2 - GRADIENT_DARK_OVERHANG
  //     : cx + ICON_SIZE / 2 + GRADIENT_DARK_OVERHANG;
  //   const clearX = darkLeft ? darkX + GRADIENT_WIDTH : darkX - GRADIENT_WIDTH;

  //   const grad = ctx.createLinearGradient(darkX, 0, clearX, 0);
  //   grad.addColorStop(0, `rgba(0, 0, 0, ${GRADIENT_DARK_ALPHA})`);
  //   grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  //   ctx.save();
  //   ctx.fillStyle = grad;
  //   ctx.fillRect(Math.min(darkX, clearX), top, GRADIENT_WIDTH, h);
  //   ctx.restore();
  // }

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
