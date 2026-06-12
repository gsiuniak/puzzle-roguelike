import UIPanel from './UIPanel.js';
import KeywordText from './KeywordText.js';

/**
 * SkillsPane — fixed-size ACCORDION list of skills (expandable-list reference).
 *
 * The outer panel (art + dimensions) is completely static — identical to the
 * old grid pane, so nothing around it (board, character frame) ever moves.
 * Only the INTERNAL list lays out dynamically:
 *
 *   - Each skill is a compact collapsed ROW: [icon] [name] [cost + gem] [⌄].
 *   - Clicking a row (or its chevron) expands it inline, accordion-style —
 *     at most ONE row is expanded; opening another collapses the previous.
 *   - Expanded content (the FULL description as a KeywordText, so [[keyword]]
 *     coloring applies, plus a Cast button on the player's pane) renders
 *     directly beneath the row and pushes the rows below it down.
 *   - Overflow is CLIPPED inside the panel's inner area (never grows the
 *     panel).
 *
 * Implementation style: NO child UIElements — rows are drawn manually in
 * renderSelf (RelicBar precedent) and hit-tested from the last-rendered
 * layout via handleClick/handleMouseMove, which BattleScene calls directly
 * (before its turn-state gating, so expanding works even on the enemy's
 * turn / for the enemy's pane). hitTest() returns null — clicks never route
 * through the generic onClick dispatch.
 *
 * CASTING: clicking a row only expands it. The player casts via the gold
 * "Cast" button inside the expanded block (rendered only when `onSkillClick`
 * is wired, i.e. the player's pane; BattleController still validates turn +
 * mana, the button just dims when unaffordable).
 *
 * Each skill row's description KeywordText is exposed via descKeywordTexts
 * for inline keyword tooltips; collapsed rows set their element `visible:
 * false` so TooltipManager ignores their stale span rects.
 */

// ── Outer panel (UNCHANGED dimensions — keep the surrounding layout static) ──
const PANE_PADDING = { top: 48, right: 20, bottom: 24, left: 20 };
// The pane's height was defined by the old 6×105 grid; preserve it exactly.
const LEGACY_SLOT_HEIGHT = 105;
const LEGACY_ROWS = 6;
const LEGACY_GRID_GAP = 6;
const NATURAL_HEIGHT =
  PANE_PADDING.top + PANE_PADDING.bottom +
  LEGACY_ROWS * LEGACY_SLOT_HEIGHT + (LEGACY_ROWS - 1) * LEGACY_GRID_GAP;

// ── Accordion rows ──
/** Minimum row slots shown (empty ones render as locked fillers). */
const MIN_SLOTS = 6;
const ROW_H = 56;             // collapsed row height
const ROW_GAP = 4;
const ROW_RADIUS = 7;
const ROW_PAD_X = 10;
const ROW_BG = 'rgba(12, 10, 8, 0.55)';
const ROW_BG_HOVER = 'rgba(44, 37, 24, 0.65)';
const ROW_BG_EXPANDED = 'rgba(24, 20, 13, 0.72)';
const ROW_BORDER = 'rgba(120, 100, 60, 0.35)';
const DIVIDER_COLOR = 'rgba(214, 188, 120, 0.13)';
const CASTABLE_ACCENT = 'rgba(237, 249, 142, 0.75)'; // left edge bar when castable

const ICON_SIZE = 40;
const ICON_GAP = 10;
const NAME_FONT_SIZE = 22;
const NAME_COLOR = '#e4e4d9';
const LOCKED_ICON_SIZE = 26;
const LOCKED_ALPHA = 0.45;

const COST_FONT_SIZE = 22;
const COST_ORB_SIZE = 22;
const COST_PAIR_GAP = 5;
const CHEVRON_W = 14;
const CHEVRON_H = 8;
const CHEVRON_COLOR = '#d6bc78';
const CHEVRON_MARGIN_R = 8;
const COST_CHEVRON_GAP = 14;

// ── Expanded content ──
const DESC_FONT_SIZE = 18;
const DESC_LINE_HEIGHT = 23;
const DESC_COLOR = '#cfc8a8';
const DESC_INDENT = 14;       // left/right inset of the description block
const EXPANDED_PAD_TOP = 4;
const EXPANDED_PAD_BOTTOM = 12;
const CAST_BTN_W = 110;
const CAST_BTN_H = 32;
const CAST_BTN_GAP = 10;      // gap between description and Cast button
const CAST_BTN_BG = 'rgba(58, 46, 22, 0.9)';
const CAST_BTN_BG_HOVER = 'rgba(86, 68, 30, 0.95)';
const CAST_BTN_BORDER = '#d6bc78';
const CAST_BTN_TEXT = '#f0dfae';
const CAST_BTN_FONT_SIZE = 20;

const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};

export default class SkillsPane extends UIPanel {
  constructor(skills = null, assetManager = null) {
    super();

    this._assetManager = assetManager;
    this.assetManager = assetManager;
    this.smoothing = true;

    this.padding = PANE_PADDING;
    this.backgroundAssetKey = 'skill_pane_panel';
    // Lock height — the panel NEVER resizes; the list inside clips.
    this.height = NATURAL_HEIGHT;

    /** @type {Function|null} (skillData) => void — wired on the player pane only */
    this.onSkillClick = null;

    /** @type {Array<{skill:object|null, locked:boolean, descKT:KeywordText|null}>} */
    this._rows = [];
    /** Index of the expanded row (accordion: at most one), -1 = none. */
    this._expanded = -1;
    /** Hovered row index (header band only), -1 = none. */
    this._hoverRow = -1;
    /** True while the pointer is over the expanded row's Cast button. */
    this._hoverCast = false;
    /** @type {object|null} player mana for affordability */
    this._mana = null;
    /**
     * Last-rendered row layout (absolute design coords) used for hit-testing:
     * [{ y, h, castRect: {x,y,w,h}|null }]. Rebuilt every renderSelf.
     */
    this._rowLayout = [];

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
      const descKT = new KeywordText(skill.description || '');
      descKT.setStyle({
        fontSize: DESC_FONT_SIZE,
        color: DESC_COLOR,
        alignH: 'left',
        alignV: 'top',
        lineHeight: DESC_LINE_HEIGHT,
      });
      descKT.visible = false; // only the expanded row's text is "live"
      this._rows.push({ skill, locked: false, descKT });
    }
    while (this._rows.length < MIN_SLOTS) {
      this._rows.push({ skill: null, locked: true, descKT: null });
    }
    this._expanded = -1;
    this._hoverRow = -1;
    this._hoverCast = false;
    this._rowLayout = [];
  }

  /** Update mana for affordability cues (idempotent, called every frame). */
  setManaState(manaState) {
    this._mana = manaState || null;
  }

  /** Description KeywordText elements (for inline keyword tooltip sources).
   *  Collapsed rows are visible:false, so only the expanded one is hoverable. */
  get descKeywordTexts() {
    return this._rows.filter(r => r.descKT).map(r => r.descKT);
  }

  _affordable(skill) {
    if (!skill || !skill.cost || Object.keys(skill.cost).length === 0) return true;
    if (!this._mana) return false;
    for (const [color, amount] of Object.entries(skill.cost)) {
      if ((this._mana[color] || 0) < amount) return false;
    }
    return true;
  }

  /** Expand/collapse a row (accordion: opening one collapses the others). */
  toggleRow(index) {
    const row = this._rows[index];
    if (!row || row.locked) return;
    this._expanded = this._expanded === index ? -1 : index;
    for (let i = 0; i < this._rows.length; i++) {
      const kt = this._rows[i].descKT;
      if (kt) kt.visible = i === this._expanded;
    }
  }

  /**
   * Handle a mousedown in design space. Returns true when consumed (row
   * toggled / cast clicked). BattleScene calls this BEFORE its turn-state
   * gating so expansion works at any time, for both panes.
   */
  handleClick(x, y) {
    if (!this._insideInner(x, y)) return false;
    for (let i = 0; i < this._rowLayout.length; i++) {
      const entry = this._rowLayout[i];
      if (!entry) continue;
      // Cast button (expanded player rows only)
      if (entry.castRect && this._pointIn(entry.castRect, x, y)) {
        const skill = this._rows[i] && this._rows[i].skill;
        if (skill && this.onSkillClick && this._affordable(skill)) {
          this.onSkillClick(skill);
        }
        return true;
      }
      // Header band toggles expansion
      if (y >= entry.y && y <= entry.y + ROW_H) {
        if (!this._rows[i] || this._rows[i].locked) return true; // consume, no-op
        this.toggleRow(i);
        return true;
      }
      // Inside the expanded block (not the cast button): consume, no action
      if (y >= entry.y && y <= entry.y + entry.h) return true;
    }
    return false;
  }

  /** Track hover for row highlight + cast button highlight. */
  handleMouseMove(x, y) {
    this._hoverRow = -1;
    this._hoverCast = false;
    if (!this._insideInner(x, y)) return;
    for (let i = 0; i < this._rowLayout.length; i++) {
      const entry = this._rowLayout[i];
      if (!entry) continue;
      if (entry.castRect && this._pointIn(entry.castRect, x, y)) {
        this._hoverCast = true;
        return;
      }
      if (y >= entry.y && y <= entry.y + ROW_H) {
        if (this._rows[i] && !this._rows[i].locked) this._hoverRow = i;
        return;
      }
    }
  }

  /** Clicks are handled exclusively via handleClick — never the generic
   *  onClick dispatch (which is gated by turn state in BattleScene). */
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
    const layout = [];

    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip(); // overflow stays INSIDE the panel — it never grows

    let y = inner.y;
    for (let i = 0; i < this._rows.length; i++) {
      const row = this._rows[i];
      const isExpanded = i === this._expanded && !row.locked;

      // Measure expanded content first (drives this row's height).
      let descH = 0;
      let castH = 0;
      if (isExpanded && row.descKT) {
        row.descKT.setStyle({ maxWidth: inner.w - DESC_INDENT * 2 });
        descH = row.descKT.measureText(ctx).height;
        if (this.onSkillClick) castH = CAST_BTN_GAP + CAST_BTN_H;
      }
      const extraH = isExpanded ? EXPANDED_PAD_TOP + descH + castH + EXPANDED_PAD_BOTTOM : 0;
      const h = ROW_H + extraH;

      const entry = { y, h, castRect: null };
      if (y <= inner.y + inner.h) {
        this._renderRow(ctx, row, i, inner, y, h, isExpanded, descH, entry);
        // Divider between rows (skip after the last row).
        if (i < this._rows.length - 1) {
          ctx.strokeStyle = DIVIDER_COLOR;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(inner.x + 6, y + h + ROW_GAP / 2);
          ctx.lineTo(inner.x + inner.w - 6, y + h + ROW_GAP / 2);
          ctx.stroke();
        }
      }
      layout.push(entry);
      y += h + ROW_GAP;
    }

    ctx.restore();
    this._rowLayout = layout;
  }

  _renderRow(ctx, row, index, inner, y, h, isExpanded, descH, entry) {
    const x = inner.x;
    const w = inner.w;
    const skill = row.skill;
    const hovered = index === this._hoverRow;
    const castable = !row.locked && this._affordable(skill) && !!this.onSkillClick;

    // Row background (whole row incl. expanded block — reads as ONE row).
    ctx.save();
    this._roundRectPath(ctx, x, y, w, h, ROW_RADIUS);
    ctx.fillStyle = isExpanded ? ROW_BG_EXPANDED : (hovered ? ROW_BG_HOVER : ROW_BG);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ROW_BORDER;
    ctx.stroke();
    if (castable) {
      // Left accent bar: this skill can be cast right now.
      ctx.fillStyle = CASTABLE_ACCENT;
      ctx.fillRect(x, y + 3, 3, h - 6);
    }
    ctx.restore();

    if (row.locked) {
      const img = this._asset('skills_locked_icon');
      if (img) {
        ctx.save();
        ctx.globalAlpha *= LOCKED_ALPHA;
        const s = LOCKED_ICON_SIZE;
        ctx.drawImage(img, x + w / 2 - s / 2, y + ROW_H / 2 - s / 2, s, s);
        ctx.restore();
      }
      return;
    }

    // ── Header: [icon] [name] ......... [cost orb] [chevron] ──
    const iconImg = this._asset(skill.icon) || this._asset('placeholder');
    if (iconImg) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      const iw = iconImg.width || ICON_SIZE;
      const ih = iconImg.height || ICON_SIZE;
      const sc = Math.min(ICON_SIZE / iw, ICON_SIZE / ih);
      const dw = iw * sc;
      const dh = ih * sc;
      ctx.drawImage(iconImg,
        x + ROW_PAD_X + (ICON_SIZE - dw) / 2,
        y + ROW_H / 2 - dh / 2, dw, dh);
      ctx.restore();
    }

    // Chevron (right edge)
    const chevCX = x + w - CHEVRON_MARGIN_R - CHEVRON_W / 2;
    const chevCY = y + ROW_H / 2;
    ctx.save();
    ctx.strokeStyle = CHEVRON_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (isExpanded) { // ∧
      ctx.moveTo(chevCX - CHEVRON_W / 2, chevCY + CHEVRON_H / 2);
      ctx.lineTo(chevCX, chevCY - CHEVRON_H / 2);
      ctx.lineTo(chevCX + CHEVRON_W / 2, chevCY + CHEVRON_H / 2);
    } else {          // ∨
      ctx.moveTo(chevCX - CHEVRON_W / 2, chevCY - CHEVRON_H / 2);
      ctx.lineTo(chevCX, chevCY + CHEVRON_H / 2);
      ctx.lineTo(chevCX + CHEVRON_W / 2, chevCY + CHEVRON_H / 2);
    }
    ctx.stroke();
    ctx.restore();

    // Mana cost (number + gem), right-aligned before the chevron.
    let costLeft = x + w - CHEVRON_MARGIN_R - CHEVRON_W - COST_CHEVRON_GAP;
    const cost = skill.cost || {};
    const costColors = Object.keys(cost).filter(c => cost[c] > 0);
    if (costColors.length) {
      ctx.save();
      ctx.font = `bold ${COST_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      // Draw right-to-left so multiple costs stack leftward.
      for (let c = costColors.length - 1; c >= 0; c--) {
        const color = costColors[c];
        const amount = String(cost[color]);
        // gem
        const orbImg = this._asset(`mana_${color}_simple`);
        const orbX = costLeft - COST_ORB_SIZE;
        if (orbImg) {
          ctx.drawImage(orbImg, orbX, y + ROW_H / 2 - COST_ORB_SIZE / 2, COST_ORB_SIZE, COST_ORB_SIZE);
        } else {
          ctx.beginPath();
          ctx.arc(orbX + COST_ORB_SIZE / 2, y + ROW_H / 2, COST_ORB_SIZE / 2, 0, Math.PI * 2);
          ctx.fillStyle = MANA_COLORS[color] || '#888';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#665522';
          ctx.stroke();
        }
        // amount
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(amount, orbX - COST_PAIR_GAP, y + ROW_H / 2 + 1);
        costLeft = orbX - COST_PAIR_GAP - ctx.measureText(amount).width - 10;
      }
      ctx.restore();
    }

    // Name (clipped against the cost area)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, Math.max(0, costLeft - x), ROW_H);
    ctx.clip();
    ctx.font = `bold ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = NAME_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.fillText(skill.name || '', x + ROW_PAD_X + ICON_SIZE + ICON_GAP, y + ROW_H / 2 + 1);
    ctx.restore();

    // ── Expanded block: full description (+ Cast on the player pane) ──
    if (isExpanded && row.descKT) {
      const descY = y + ROW_H + EXPANDED_PAD_TOP;
      const kt = row.descKT;
      kt.rect.x = x + DESC_INDENT;
      kt.rect.y = descY;
      kt.rect.w = inner.w - DESC_INDENT * 2;
      kt.rect.h = descH;
      kt.renderSelf(ctx);

      if (this.onSkillClick) {
        const bx = x + w - DESC_INDENT - CAST_BTN_W;
        const by = descY + descH + CAST_BTN_GAP;
        const enabled = this._affordable(skill);
        ctx.save();
        this._roundRectPath(ctx, bx, by, CAST_BTN_W, CAST_BTN_H, 5);
        ctx.fillStyle = this._hoverCast && enabled ? CAST_BTN_BG_HOVER : CAST_BTN_BG;
        ctx.globalAlpha *= enabled ? 1 : 0.45;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = CAST_BTN_BORDER;
        ctx.stroke();
        ctx.font = `bold ${CAST_BTN_FONT_SIZE}px ${FONT_FAMILY}`;
        ctx.fillStyle = CAST_BTN_TEXT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Cast', bx + CAST_BTN_W / 2, by + CAST_BTN_H / 2 + 1);
        ctx.restore();
        entry.castRect = { x: bx, y: by, w: CAST_BTN_W, h: CAST_BTN_H };
      }
    }
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
