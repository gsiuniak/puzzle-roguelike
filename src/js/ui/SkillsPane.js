import UIPanel from './UIPanel.js';
import KeywordText from './KeywordText.js';

/**
 * SkillsPane — legacy-style list of full-width skill cards with DYNAMIC
 * heights (variable-height reference mock).
 *
 * Each skill is one horizontal card in the classic look: circular icon on the
 * left, prominent name, the FULL description (wrapped, keyword-colored)
 * directly on the card, mana cost (number + gem) on the right. The card's
 * height auto-fits its wrapped description — longer skills grow downward and
 * push the cards below them down. No accordion, no chevron, no "?" tooltip
 * button: everything is visible on the card itself.
 *
 * The OUTER panel (art + dimensions) is completely static; overflow is
 * CLIPPED inside the panel's inner area (never grows the panel, never moves
 * surrounding UI).
 *
 * CASTING: clicking anywhere on a castable card casts it (player pane +
 * affordable — BattleController still validates the turn). Castable cards
 * are highlighted whole (gold tint + bright border + left accent).
 *
 * Implementation style: NO child UIElements — cards are drawn manually in
 * renderSelf (RelicBar precedent) and hit-tested from the last-rendered
 * layout via handleClick/handleMouseMove, which BattleScene calls directly.
 * hitTest() returns null — clicks never route through the generic onClick
 * dispatch. Each card's description KeywordText (always visible) is exposed
 * via descKeywordTexts so its [[keyword]] spans are inline tooltip sources.
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

// ── Cards ──
/** Minimum card slots shown (empty ones render as locked fillers). */
const MIN_SLOTS = 6;
/** Per-card frame art (the legacy carved-panel look), stretched to the card. */
const CARD_BG_KEY = 'skills_button';
const CARD_GAP = 6;
const CARD_MIN_H = 84;          // shortest a skill card may be
const LOCKED_CARD_H = 70;       // fixed height for empty locked slots
const CARD_RADIUS = 7;          // fallback styling when the art is missing
const CARD_FALLBACK_BG = 'rgba(12, 10, 8, 0.6)';
const CARD_FALLBACK_BORDER = 'rgba(120, 100, 60, 0.4)';
const CARD_PAD = { top: 12, bottom: 12, left: 12, right: 12 };
const CARD_BG_HOVER = 'rgba(44, 37, 24, 0.35)';

// Whole-card castable highlight (the card IS the cast button).
const CASTABLE_ACCENT = 'rgba(237, 249, 142, 0.75)';      // left edge bar
const CASTABLE_FILL = 'rgba(255, 240, 180, 0.10)';        // card tint
const CASTABLE_FILL_HOVER = 'rgba(255, 250, 200, 0.18)';  // hovered card tint
const CASTABLE_BORDER = 'rgba(255, 240, 180, 0.95)';      // bright border

// Circular icon (left column), vertically centered in the card.
const ICON_SIZE = 64;
const ICON_GAP = 12;
const ICON_RING_COLOR = 'rgba(20, 16, 10, 0.9)';
const ICON_RING_WIDTH = 3;

const NAME_FONT_SIZE = 22;
const NAME_LINE_HEIGHT = 26;
/** Long names wrap at WORD boundaries (never mid-word); past this many lines
 *  they're dropped with a trailing ellipsis. */
const NAME_MAX_LINES = 2;
const NAME_COLOR = '#e4e4d9';
const NAME_DESC_GAP = 4;

// Description — full text, wrapped, keyword-colored. NO line cap: the card
// grows to fit it.
const DESC_FONT_SIZE = 18;
const DESC_LINE_HEIGHT = 23;
const DESC_COLOR = '#cfc8a8';

// Mana cost (right column), vertically centered.
const COST_FONT_SIZE = 22;
const COST_ORB_SIZE = 24;
const COST_PAIR_GAP = 5;
const COST_COL_WIDTH = 56;

const LOCKED_ICON_SIZE = 26;
const LOCKED_ALPHA = 0.45;

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
    /** Hovered card index, -1 = none. */
    this._hoverRow = -1;
    /** @type {object|null} player mana for affordability */
    this._mana = null;
    /**
     * Last-rendered card layout (absolute design coords) used for
     * hit-testing: [{ y, h }]. Rebuilt every renderSelf.
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
      descKT.visible = true; // always on the card → always a keyword source
      this._rows.push({ skill, locked: false, descKT });
    }
    while (this._rows.length < MIN_SLOTS) {
      this._rows.push({ skill: null, locked: true, descKT: null });
    }
    this._hoverRow = -1;
    this._rowLayout = [];
  }

  /** Update mana for affordability cues (idempotent, called every frame). */
  setManaState(manaState) {
    this._mana = manaState || null;
  }

  /** Description KeywordText elements (inline keyword tooltip sources). */
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

  /**
   * Handle a mousedown in design space. Returns true when consumed.
   * Clicking anywhere on a castable card CASTS it (player pane + affordable;
   * BattleController still validates the turn). Other card clicks are
   * consumed without action. BattleScene calls this BEFORE its turn-state
   * gating.
   */
  handleClick(x, y) {
    if (!this._insideInner(x, y)) return false;
    for (let i = 0; i < this._rowLayout.length; i++) {
      const entry = this._rowLayout[i];
      if (!entry) continue;
      if (y >= entry.y && y <= entry.y + entry.h) {
        const row = this._rows[i];
        if (row && !row.locked && this.onSkillClick && this._affordable(row.skill)) {
          this.onSkillClick(row.skill);
        }
        return true;
      }
    }
    return false;
  }

  /** Track the hovered card for the highlight. */
  handleMouseMove(x, y) {
    this._hoverRow = -1;
    if (!this._insideInner(x, y)) return;
    for (let i = 0; i < this._rowLayout.length; i++) {
      const entry = this._rowLayout[i];
      if (!entry) continue;
      if (y >= entry.y && y <= entry.y + entry.h) {
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

    const textX = inner.x + CARD_PAD.left + ICON_SIZE + ICON_GAP;
    const textW = Math.max(20, inner.x + inner.w - CARD_PAD.right - COST_COL_WIDTH - textX);

    let y = inner.y;
    for (let i = 0; i < this._rows.length; i++) {
      const row = this._rows[i];

      // ── Measure: card height auto-fits name + wrapped description ──
      let h = LOCKED_CARD_H;
      let nameLines = null;
      let descH = 0;
      if (!row.locked) {
        ctx.font = `bold ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
        nameLines = this._wrapWords(ctx, row.skill.name || '', textW);
        const nameH = nameLines.length * NAME_LINE_HEIGHT;
        if (row.descKT && row.skill.description) {
          row.descKT.setStyle({ maxWidth: textW });
          descH = row.descKT.measureText(ctx).height;
        }
        const contentH = nameH + (descH > 0 ? NAME_DESC_GAP + descH : 0);
        h = Math.max(CARD_MIN_H, CARD_PAD.top + contentH + CARD_PAD.bottom);
      }

      const entry = { y, h };
      if (y <= inner.y + inner.h) {
        this._renderCard(ctx, row, i, inner, y, h, textX, textW, nameLines, descH);
      }
      layout.push(entry);
      y += h + CARD_GAP;
    }

    ctx.restore();
    this._rowLayout = layout;
  }

  _renderCard(ctx, row, index, inner, y, h, textX, textW, nameLines, descH) {
    const x = inner.x;
    const w = inner.w;
    const skill = row.skill;
    const hovered = index === this._hoverRow;
    const castable = !row.locked && this._affordable(skill) && !!this.onSkillClick;

    // ── Card frame: the legacy carved-panel art, stretched to the card ──
    const frame = this._asset(CARD_BG_KEY);
    if (frame) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(frame, x, y, w, h);
      ctx.restore();
    } else {
      ctx.save();
      this._roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
      ctx.fillStyle = CARD_FALLBACK_BG;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = CARD_FALLBACK_BORDER;
      ctx.stroke();
      ctx.restore();
    }

    // Castable: highlight the WHOLE card (the card is the cast button).
    ctx.save();
    if (castable) {
      ctx.fillStyle = hovered ? CASTABLE_FILL_HOVER : CASTABLE_FILL;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = CASTABLE_BORDER;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.fillStyle = CASTABLE_ACCENT;
      ctx.fillRect(x + 1, y + 4, 3, h - 8);
    } else if (hovered && !row.locked) {
      ctx.fillStyle = CARD_BG_HOVER;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
    ctx.restore();

    if (row.locked) {
      const img = this._asset('skills_locked_icon');
      if (img) {
        ctx.save();
        ctx.globalAlpha *= LOCKED_ALPHA;
        const s = LOCKED_ICON_SIZE;
        ctx.drawImage(img, x + w / 2 - s / 2, y + h / 2 - s / 2, s, s);
        ctx.restore();
      }
      return;
    }

    // ── Circular icon (left, vertically centered) ──
    const iconImg = this._asset(skill.icon) || this._asset('placeholder');
    const iconCX = x + CARD_PAD.left + ICON_SIZE / 2;
    const iconCY = y + h / 2;
    if (iconImg) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.beginPath();
      ctx.arc(iconCX, iconCY, ICON_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      // Cover-fit into the circle's bounding square.
      const iw = iconImg.width || ICON_SIZE;
      const ih = iconImg.height || ICON_SIZE;
      const sc = Math.max(ICON_SIZE / iw, ICON_SIZE / ih);
      const dw = iw * sc;
      const dh = ih * sc;
      ctx.drawImage(iconImg, iconCX - dw / 2, iconCY - dh / 2, dw, dh);
      ctx.restore();
      // Dark ring so the icon reads as a carved circular inset.
      ctx.save();
      ctx.beginPath();
      ctx.arc(iconCX, iconCY, ICON_SIZE / 2, 0, Math.PI * 2);
      ctx.lineWidth = ICON_RING_WIDTH;
      ctx.strokeStyle = ICON_RING_COLOR;
      ctx.stroke();
      ctx.restore();
    }

    // ── Mana cost (right, vertically centered): number + gem ──
    const cost = skill.cost || {};
    const costColors = Object.keys(cost).filter(c => cost[c] > 0);
    if (costColors.length) {
      ctx.save();
      ctx.font = `bold ${COST_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      const rowH = COST_ORB_SIZE + 4;
      let cy = y + h / 2 - ((costColors.length - 1) * rowH) / 2;
      for (const color of costColors) {
        const amount = String(cost[color]);
        const orbX = x + w - CARD_PAD.right - COST_ORB_SIZE;
        const orbImg = this._asset(`mana_${color}_simple`);
        if (orbImg) {
          ctx.drawImage(orbImg, orbX, cy - COST_ORB_SIZE / 2, COST_ORB_SIZE, COST_ORB_SIZE);
        } else {
          ctx.beginPath();
          ctx.arc(orbX + COST_ORB_SIZE / 2, cy, COST_ORB_SIZE / 2, 0, Math.PI * 2);
          ctx.fillStyle = MANA_COLORS[color] || '#888';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#665522';
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(amount, orbX - COST_PAIR_GAP, cy + 1);
        cy += rowH;
      }
      ctx.restore();
    }

    // ── Name + full description (block vertically centered in the card) ──
    const contentH = nameLines.length * NAME_LINE_HEIGHT
      + (descH > 0 ? NAME_DESC_GAP + descH : 0);
    let lineY = y + Math.max(CARD_PAD.top, (h - contentH) / 2);

    ctx.save();
    ctx.font = `bold ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = NAME_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    for (const line of nameLines) {
      ctx.fillText(line, textX, lineY + NAME_LINE_HEIGHT / 2);
      lineY += NAME_LINE_HEIGHT;
    }
    ctx.restore();

    if (row.descKT && descH > 0) {
      const kt = row.descKT;
      kt.rect.x = textX;
      kt.rect.y = lineY + NAME_DESC_GAP;
      kt.rect.w = textW;
      kt.rect.h = descH;
      kt.renderSelf(ctx);
    }
  }

  /**
   * Greedy word-boundary wrap (never splits a word; a single over-long word
   * overflows its line rather than breaking). Lines beyond NAME_MAX_LINES are
   * dropped and the last kept line gets a trailing ellipsis.
   * ctx.font must already be set by the caller.
   */
  _wrapWords(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxW) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.length > NAME_MAX_LINES) {
      lines.length = NAME_MAX_LINES;
      lines[NAME_MAX_LINES - 1] += '…';
    }
    return lines.length ? lines : [''];
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
