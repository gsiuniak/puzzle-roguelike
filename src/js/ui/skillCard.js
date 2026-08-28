import KeywordText from './KeywordText.js';
import { resolveDynamicText } from '../data/scalingConfig.js';

/**
 * skillCard.js — SHARED legacy-style skill card renderer.
 *
 * One card = the classic look: `skills_button` frame art stretched to the
 * card, circular icon on the left, prominent (word-wrapped) name, the skill's
 * STRUCTURED effect lines as separate keyword-colored blocks, mana cost
 * (number + gem) right-aligned and vertically centered. Card height auto-fits
 * the content.
 *
 * Used by BOTH the in-battle SkillsPane and the SkillLoadoutOverlay (manage
 * skills modal), so the two always look identical. Pure canvas drawing — the
 * card is NOT a UIElement; callers own layout/hit-testing/scrolling.
 *
 * Usage:
 *   const model = createCardModel(skill);                  // once per skill
 *   const m = measureCardModel(ctx, model, cardWidth);     // every render
 *   drawCardModel(ctx, model, {x, y, w, h: m.h}, m, opts); // every render
 */

// ── Card chrome ──
export const CARD_BG_KEY = 'skills_button';
export const CARD_MIN_H = 100;
const CARD_RADIUS = 7;
const CARD_FALLBACK_BG = 'rgba(12, 10, 8, 0.6)';
const CARD_FALLBACK_BORDER = 'rgba(120, 100, 60, 0.4)';
export const CARD_PAD = { top: 12, bottom: 12, left: 12, right: 12 };
const CARD_BG_HOVER = 'rgba(44, 37, 24, 0.35)';

// Whole-card castable highlight (the card IS the cast button in battle).
const CASTABLE_ACCENT = 'rgba(237, 249, 142, 0.75)';
const CASTABLE_FILL = 'rgba(255, 240, 180, 0.10)';
const CASTABLE_FILL_HOVER = 'rgba(255, 250, 200, 0.18)';
const CASTABLE_BORDER = 'rgba(255, 240, 180, 0.95)';

// Selected highlight (loadout modal: click-to-place source).
const SELECTED_BORDER = 'rgba(214, 188, 120, 0.95)';
const SELECTED_FILL = 'rgba(214, 188, 120, 0.10)';

// Circular icon (left column).
export const ICON_SIZE = 80;
export const ICON_GAP = 12;
const ICON_RING_COLOR = 'rgba(20, 16, 10, 0.9)';
const ICON_RING_WIDTH = 3;

const NAME_FONT_SIZE = 22;
const NAME_LINE_HEIGHT = 26;
const NAME_MAX_LINES = 2;
const NAME_COLOR = '#e4e4d9';
const NAME_DESC_GAP = 4;

// Effect blocks (structured effect lines).
const DESC_FONT_SIZE = 17;
const DESC_LINE_HEIGHT = 20;
const DESC_COLOR = '#cfc8a8';
const EFFECT_GAP = 6;

// Mana cost — a small pill BADGE attached to the icon's lower-right edge
// (frees the whole right side of the card for name/description text).
// Badge height ≈ 40% of ICON_SIZE; the pill widens for two-digit costs.
const COST_BADGE_H = Math.round(ICON_SIZE * 0.40);
const COST_BADGE_FONT_SIZE = Math.round(COST_BADGE_H * 0.68);
const COST_BADGE_GEM_R = Math.round(COST_BADGE_H * 0.32);
const COST_BADGE_PAD_X = 7;          // pill end-cap padding
const COST_BADGE_GAP = 4;            // number ↔ gem gap
const COST_BADGE_STACK_GAP = 3;      // between pills (multi-color costs)
/** How far the pill pokes past the icon's bottom-right edge. */
const COST_BADGE_OFFSET = { x: 4, y: 3 };
const COST_BADGE_BG = 'rgba(10, 8, 5, 0.95)';
const COST_BADGE_BORDER = 'rgba(214, 188, 120, 0.85)';
const COST_BADGE_NUMBER = '#ffffff';
const COST_BADGE_GLOW_ALPHA = 0.55;  // subtle gem-colored glow behind the pill

const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

// ── Passive card (enemy relics shown as "passives") ──
// Same frame + circular icon + keyword description as a skill card, but a
// distinct two-region layout: a HEADER row ([Passive banner] + relic name) on
// top, then a BODY row (icon + description) beneath. The cost badge is replaced
// by an "infinite" (∞) badge of the same pill size/shape.
export const PASSIVE_BANNER_KEY = 'ui_skill_panel_passive_banner';
const PASSIVE_BANNER_ASPECT = 866 / 285;   // trimmed sprite frame aspect
const PASSIVE_BANNER_H = 26;
const PASSIVE_BANNER_TEXT = 'Passive';
const PASSIVE_BANNER_FONT_SIZE = 16;
/** "Passive" label color — pale, muted gold. */
const PASSIVE_BANNER_TEXT_COLOR = '#d8c48c';
const PASSIVE_BANNER_FALLBACK = 'rgba(74, 42, 120, 0.92)';
const PASSIVE_BANNER_FALLBACK_BORDER = 'rgba(180, 140, 230, 0.9)';
const PASSIVE_HEADER_GAP = 8;               // banner ↔ DESCRIPTION (sets name↔desc spacing)
const PASSIVE_ICON_GAP = 4;                 // banner ↔ ICON art (independent of the description)
const PASSIVE_NAME_GAP = 12;                // banner ↔ name (also the description indent)
const PASSIVE_ICON_SIZE = 72;
const PASSIVE_NAME_FONT_SIZE = 21;
const PASSIVE_NAME_MIN_FONT_SIZE = 14;
const INFINITY_GLYPH = '∞';            // ∞
/** Extra px added to the infinity badge width so it reads as an OVAL (wider
 *  than the round cost pill), and its own tweakable border color. */
const INFINITY_BADGE_EXTRA_W = 12;
const INFINITY_BADGE_BORDER = 'rgba(212, 200, 165, 0.85)';

const MANA_COLORS = {
  red:    '#cc3333',
  blue:   '#3366cc',
  green:  '#33aa33',
  yellow: '#cccc33',
  purple: '#9933cc',
};

/** Trim an effect line and give it terminal punctuation (display only) so
 *  every effect reads as a complete statement ("Deal 5 Damage."). */
function ensureSentence(raw) {
  const line = String(raw == null ? '' : raw).trim();
  if (!line) return '';
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/**
 * Build a card model for a skill: one KeywordText per EFFECT line.
 * Preferred source: the structured `descriptionLines` array (one complete
 * sentence per effect — the synthesizer emits it); legacy `description`
 * strings fall back to splitting on '\n' (the catalog authors one effect per
 * line). The KeywordTexts are live keyword-tooltip sources while visible.
 *
 * @param {object} skill
 * @returns {{ skill: object, effectKTs: KeywordText[] }}
 */
export function createCardModel(skill) {
  const lines = Array.isArray(skill.descriptionLines) && skill.descriptionLines.length
    ? skill.descriptionLines
    : String(skill.description || '').split('\n');
  const effectKTs = [];
  // The authored template per effect line (with `<<n>>` / `[[kw]]` markup intact)
  // — parallel to effectKTs. measureCardModel re-resolves `<<n>>` from these each
  // frame using the live caster, so the displayed damage stays current.
  const lineTemplates = [];
  for (const raw of lines) {
    const line = ensureSentence(raw);
    if (!line) continue;
    lineTemplates.push(line);
    const kt = new KeywordText(line);
    kt.setStyle({
      fontSize: DESC_FONT_SIZE,
      color: DESC_COLOR,
      alignH: 'left',
      alignV: 'top',
      lineHeight: DESC_LINE_HEIGHT,
    });
    kt.visible = true;
    effectKTs.push(kt);
  }

  return { skill, effectKTs, lineTemplates };
}

/**
 * Greedy word-boundary wrap (never splits a word). Lines beyond NAME_MAX_LINES
 * are dropped and the last kept line gets a trailing ellipsis.
 * ctx.font must already be set by the caller.
 */
// Bumped once the display fonts finish loading — measurements cached before
// that were taken with fallback-face metrics and must be redone.
let _fontsGeneration = 0;
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { _fontsGeneration++; }).catch(() => {});
}

function wrapWords(ctx, text, maxW) {
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

/**
 * Measure a card at the given width. Returns everything drawCardModel needs.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{skill, effectKTs}} model
 * @param {number} cardW — outer card width
 * @returns {{ h:number, textX:number, textW:number, nameLines:string[],
 *             effectHeights:number[], effectsH:number }}
 */
/**
 * Live-resolve `<<n>>` dynamic damage values on a card model from the caster's
 * current stats (run every frame so the shown amount tracks Attack/Magic). With
 * no caster the base amount is shown. A shared cursor pairs tokens → scalable
 * effects (damage/heal/…) in order across all lines (resolveDynamicText filters).
 * Shared by skill cards AND passive cards.
 */
function resolveModelDynamics(model, opts) {
  if (!model.lineTemplates) return;
  const caster = opts.caster || null;
  // Resolved text depends only on (templates, effect payloads, attack, magic) —
  // templates/payloads are static for a model's lifetime, so skip the per-line
  // string resolution entirely (it ran per card per frame) until a stat moves.
  const atk = caster ? caster.attack : null;
  const mag = caster ? caster.magic : null;
  if (model._dynResolved && model._dynAtk === atk && model._dynMag === mag) return;
  model._dynResolved = true;
  model._dynAtk = atk;
  model._dynMag = mag;
  const cursor = { i: 0 };
  const effects = (model.skill && model.skill.effects) || [];
  for (let k = 0; k < model.effectKTs.length; k++) {
    const tmpl = model.lineTemplates[k];
    if (tmpl == null) continue;
    const resolved = resolveDynamicText(tmpl, effects, caster, cursor);
    const kt = model.effectKTs[k];
    if (kt.text !== resolved) kt.setStyle({ text: resolved });
  }
}

export function measureCardModel(ctx, model, cardW, opts = {}) {
  resolveModelDynamics(model, opts);

  // Whole-measure memo: the result depends only on (cardW, resolved stats,
  // font readiness) — all cheap to compare. Cards re-measured every frame for
  // the scroll range now cost two field checks on the steady path.
  const mc = model._measureCache;
  if (mc && mc.cardW === cardW && mc.fontsGen === _fontsGeneration
      && mc.atk === model._dynAtk && mc.mag === model._dynMag) {
    return mc.m;
  }

  const textX = CARD_PAD.left + ICON_SIZE + ICON_GAP; // relative to card x
  // The cost lives on the icon badge — text gets the whole right side.
  const textW = Math.max(20, cardW - CARD_PAD.right - textX);

  // Name wrapping is cached on the model — it re-ran measureText per word per
  // card per frame for a name that never changes. Re-wrapped on width change
  // and once the display fonts finish loading (fallback-face metrics differ).
  let nameLines;
  const name = model.skill.name || '';
  const nw = model._nameWrap;
  if (nw && nw.name === name && nw.textW === textW && nw.fontsGen === _fontsGeneration) {
    nameLines = nw.lines;
  } else {
    ctx.font = `bold ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    nameLines = wrapWords(ctx, name, textW);
    model._nameWrap = { name, textW, fontsGen: _fontsGeneration, lines: nameLines };
  }
  const nameH = nameLines.length * NAME_LINE_HEIGHT;

  const effectHeights = [];
  let effectsH = 0;
  for (const kt of model.effectKTs) {
    kt.setStyle({ maxWidth: textW });
    const bh = kt.measureText(ctx).height;
    effectHeights.push(bh);
    effectsH += bh;
  }
  if (model.effectKTs.length > 1) effectsH += (model.effectKTs.length - 1) * EFFECT_GAP;

  const contentH = nameH + (effectsH > 0 ? NAME_DESC_GAP + effectsH : 0);
  const h = Math.max(CARD_MIN_H, CARD_PAD.top + contentH + CARD_PAD.bottom);
  const m = { h, textX, textW, nameLines, effectHeights, effectsH };
  model._measureCache = {
    cardW, fontsGen: _fontsGeneration, atk: model._dynAtk, mag: model._dynMag, m,
  };
  return m;
}

/**
 * Draw a card. The model's effect KeywordTexts get their rects positioned
 * here, so they double as inline keyword tooltip sources at the drawn spot.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{skill, effectKTs}} model
 * @param {{x:number, y:number, w:number, h:number}} rect
 * @param {ReturnType<typeof measureCardModel>} m
 * @param {object} opts
 * @param {object}  opts.assetManager
 * @param {boolean} [opts.hovered]
 * @param {boolean} [opts.castable] — whole-card gold cast highlight
 * @param {boolean} [opts.selected] — loadout click-to-place highlight
 * @param {number}  [opts.alpha=1]  — whole-card alpha (drag ghosting)
 */
export function drawCardModel(ctx, model, rect, m, opts = {}) {
  const { x, y, w, h } = rect;
  const am = opts.assetManager || null;
  const skill = model.skill;
  const asset = (key) => {
    if (!key || !am) return null;
    const img = am.get(key);
    return img && img.complete !== false ? img : null;
  };

  ctx.save();
  if (opts.alpha != null && opts.alpha < 1) ctx.globalAlpha *= opts.alpha;

  // ── Frame ──
  const frame = asset(CARD_BG_KEY);
  if (frame) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(frame, x, y, w, h);
    ctx.restore();
  } else {
    roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fillStyle = CARD_FALLBACK_BG;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CARD_FALLBACK_BORDER;
    ctx.stroke();
  }

  // ── Highlights ──
  if (opts.castable) {
    ctx.fillStyle = opts.hovered ? CASTABLE_FILL_HOVER : CASTABLE_FILL;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CASTABLE_BORDER;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = CASTABLE_ACCENT;
    ctx.fillRect(x + 1, y + 4, 3, h - 8);
  } else if (opts.selected) {
    ctx.fillStyle = SELECTED_FILL;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = SELECTED_BORDER;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  } else if (opts.hovered) {
    ctx.fillStyle = CARD_BG_HOVER;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  // ── Circular icon ──
  const iconImg = asset(skill.icon) || asset('placeholder');
  const iconCX = x + CARD_PAD.left + ICON_SIZE / 2;
  const iconCY = y + h / 2;
  if (iconImg) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.beginPath();
    ctx.arc(iconCX, iconCY, ICON_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    const iw = iconImg.width || ICON_SIZE;
    const ih = iconImg.height || ICON_SIZE;
    const sc = Math.max(ICON_SIZE / iw, ICON_SIZE / ih);
    ctx.drawImage(iconImg, iconCX - (iw * sc) / 2, iconCY - (ih * sc) / 2, iw * sc, ih * sc);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(iconCX, iconCY, ICON_SIZE / 2, 0, Math.PI * 2);
    ctx.lineWidth = ICON_RING_WIDTH;
    ctx.strokeStyle = ICON_RING_COLOR;
    ctx.stroke();
  }

  // ── Mana cost badge: a small pill attached to the icon's lower-right
  //    edge ("5 ●"), one pill per cost color (stacked upward for the rare
  //    multi-color cost). Dark backing, thin gold trim, gem-colored glow. ──
  const cost = skill.cost || {};
  const costColors = Object.keys(cost).filter(c => cost[c] > 0);
  if (costColors.length) {
    ctx.save();
    ctx.font = `bold ${COST_BADGE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    // Anchor: pill's bottom-right corner pokes just past the icon's edge.
    const anchorRight = iconCX + ICON_SIZE / 2 + COST_BADGE_OFFSET.x;
    let pillBottom = iconCY + ICON_SIZE / 2 + COST_BADGE_OFFSET.y;
    for (const color of costColors) {
      const amount = String(cost[color]);
      const numW = ctx.measureText(amount).width;
      const pillW = COST_BADGE_PAD_X + numW + COST_BADGE_GAP + COST_BADGE_GEM_R * 2 + COST_BADGE_PAD_X;
      const px = anchorRight - pillW;
      const py = pillBottom - COST_BADGE_H;
      const gemColor = MANA_COLORS[color] || '#888';

      // Subtle gem-colored glow under the pill, then the dark pill + trim.
      // The glow is a slightly enlarged gem-colored rounded rect BEHIND the
      // pill (the opaque pill covers its center, leaving a colored rim) — not
      // shadowBlur, which forces the slow canvas path per pill per frame.
      ctx.save();
      ctx.globalAlpha *= COST_BADGE_GLOW_ALPHA;
      const glowPad = 3;
      roundRectPath(ctx, px - glowPad, py - glowPad, pillW + glowPad * 2,
        COST_BADGE_H + glowPad * 2, (COST_BADGE_H + glowPad * 2) / 2);
      ctx.fillStyle = gemColor;
      ctx.fill();
      ctx.restore();
      roundRectPath(ctx, px, py, pillW, COST_BADGE_H, COST_BADGE_H / 2);
      ctx.fillStyle = COST_BADGE_BG;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = COST_BADGE_BORDER;
      ctx.stroke();

      // Number (left) + gem (right) — "5 ●".
      const cy = py + COST_BADGE_H / 2;
      ctx.fillStyle = COST_BADGE_NUMBER;
      ctx.textAlign = 'left';
      ctx.fillText(amount, px + COST_BADGE_PAD_X, cy + 1);
      const gemCX = px + COST_BADGE_PAD_X + numW + COST_BADGE_GAP + COST_BADGE_GEM_R;
      const orbImg = asset(`mana_${color}_simple`);
      if (orbImg) {
        ctx.drawImage(orbImg, gemCX - COST_BADGE_GEM_R, cy - COST_BADGE_GEM_R,
          COST_BADGE_GEM_R * 2, COST_BADGE_GEM_R * 2);
      } else {
        ctx.beginPath();
        ctx.arc(gemCX, cy, COST_BADGE_GEM_R, 0, Math.PI * 2);
        ctx.fillStyle = gemColor;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#665522';
        ctx.stroke();
      }

      pillBottom = py - COST_BADGE_STACK_GAP; // next color stacks upward
    }
    ctx.restore();
  }

  // ── Name + effect blocks (content vertically centered) ──
  const textX = x + m.textX;
  const contentH = m.nameLines.length * NAME_LINE_HEIGHT
    + (m.effectsH > 0 ? NAME_DESC_GAP + m.effectsH : 0);
  let lineY = y + Math.max(CARD_PAD.top, (h - contentH) / 2);

  ctx.save();
  ctx.font = `bold ${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillStyle = NAME_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Sharp 1px offset shadow — blur-free shadows skip the expensive canvas
  // blur path (this draws every frame for every visible card).
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  for (const line of m.nameLines) {
    ctx.fillText(line, textX, lineY + NAME_LINE_HEIGHT / 2);
    lineY += NAME_LINE_HEIGHT;
  }
  ctx.restore();

  if (m.effectsH > 0) {
    let blockY = lineY + NAME_DESC_GAP;
    for (let e = 0; e < model.effectKTs.length; e++) {
      const kt = model.effectKTs[e];
      const bh = m.effectHeights[e];
      kt.rect.x = textX;
      kt.rect.y = blockY;
      kt.rect.w = m.textW;
      kt.rect.h = bh;
      kt.renderSelf(ctx);
      blockY += bh + EFFECT_GAP;
    }
  }

  ctx.restore();
}

// ── Passive card (relic → "passive") ─────────────────────────────
// Reuses createCardModel(relic) — the relic's name/description/effects/icon map
// straight onto the model's `skill` field (createCardModel only reads name,
// descriptionLines|description, and later effects/icon).

/**
 * Measure a passive card. Layout: header row (banner + name) over a body row
 * (icon + wrapped keyword description).
 * @returns {{ h, textX, textW, effectHeights, descH, headerH, bodyH }}
 */
export function measurePassiveCardModel(ctx, model, cardW, opts = {}) {
  resolveModelDynamics(model, opts);

  // Same whole-measure memo as measureCardModel.
  const mc = model._measureCache;
  if (mc && mc.cardW === cardW && mc.fontsGen === _fontsGeneration
      && mc.atk === model._dynAtk && mc.mag === model._dynMag) {
    return mc.m;
  }

  // The banner sits top-left; the name AND the description both start just past
  // it so the two text columns share a left edge (`textX`). Layout uses the
  // constant banner aspect (= the sliced sprite's true w/h) so measure and draw
  // agree on the alignment X.
  const bannerW = Math.round(PASSIVE_BANNER_H * PASSIVE_BANNER_ASPECT);
  const textX = CARD_PAD.left + bannerW + PASSIVE_NAME_GAP; // relative to card x
  const textW = Math.max(20, cardW - CARD_PAD.right - textX);

  const effectHeights = [];
  let descH = 0;
  for (const kt of model.effectKTs) {
    kt.setStyle({ maxWidth: textW });
    const bh = kt.measureText(ctx).height;
    effectHeights.push(bh);
    descH += bh;
  }
  if (model.effectKTs.length > 1) descH += (model.effectKTs.length - 1) * EFFECT_GAP;

  // The icon and the description hang from the banner on SEPARATE gaps (the icon
  // hugs the banner; the description keeps its name↔desc spacing), so the card
  // fits whichever column is taller.
  const headerH = PASSIVE_BANNER_H;
  const bodyContentH = Math.max(PASSIVE_HEADER_GAP + descH, PASSIVE_ICON_GAP + PASSIVE_ICON_SIZE);
  const h = CARD_PAD.top + headerH + bodyContentH + CARD_PAD.bottom;
  const m = { h, textX, textW, bannerW, effectHeights, descH, headerH };
  model._measureCache = {
    cardW, fontsGen: _fontsGeneration, atk: model._dynAtk, mag: model._dynMag, m,
  };
  return m;
}

/**
 * Draw a passive card (enemy relic). Same contract as drawCardModel.
 * @param {object} opts — { assetManager }
 */
export function drawPassiveCardModel(ctx, model, rect, m, opts = {}) {
  const { x, y, w, h } = rect;
  const am = opts.assetManager || null;
  const relic = model.skill; // createCardModel stores the source object here
  const asset = (key) => {
    if (!key || !am) return null;
    const img = am.get(key);
    return img && img.complete !== false ? img : null;
  };

  ctx.save();
  if (opts.alpha != null && opts.alpha < 1) ctx.globalAlpha *= opts.alpha;

  // ── Frame ──
  const frame = asset(CARD_BG_KEY);
  if (frame) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(frame, x, y, w, h);
    ctx.restore();
  } else {
    roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fillStyle = CARD_FALLBACK_BG;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CARD_FALLBACK_BORDER;
    ctx.stroke();
  }

  // ── Header row: [Passive banner] + relic name ──
  const headerY = y + CARD_PAD.top;
  const bannerH = m.headerH;
  const bannerW = m.bannerW;          // layout-derived (measure & draw agree)
  const bannerX = x + CARD_PAD.left;
  const bannerImg = asset(PASSIVE_BANNER_KEY);
  if (bannerImg) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bannerImg, bannerX, headerY, bannerW, bannerH);
    ctx.restore();
  } else {
    roundRectPath(ctx, bannerX, headerY, bannerW, bannerH, bannerH / 2);
    ctx.fillStyle = PASSIVE_BANNER_FALLBACK;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = PASSIVE_BANNER_FALLBACK_BORDER;
    ctx.stroke();
  }
  // "Passive" label written into the banner.
  ctx.save();
  ctx.font = `${PASSIVE_BANNER_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Two-pass offset fill instead of shadowBlur (slow path, drawn per frame)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(PASSIVE_BANNER_TEXT, bannerX + bannerW / 2 + 1, headerY + bannerH / 2 + 2);
  ctx.fillStyle = PASSIVE_BANNER_TEXT_COLOR;
  ctx.fillText(PASSIVE_BANNER_TEXT, bannerX + bannerW / 2, headerY + bannerH / 2 + 1);
  ctx.restore();

  // Relic name — shares the description's left edge (x + m.textX), auto-shrunk
  // to fit one line.
  const nameX = x + m.textX;
  const nameMaxW = Math.max(20, x + w - CARD_PAD.right - nameX);
  ctx.save();
  let nameFont = PASSIVE_NAME_FONT_SIZE;
  const name = relic.name || '';
  ctx.font = `bold ${nameFont}px ${FONT_FAMILY}`;
  while (nameFont > PASSIVE_NAME_MIN_FONT_SIZE && ctx.measureText(name).width > nameMaxW) {
    nameFont -= 1;
    ctx.font = `bold ${nameFont}px ${FONT_FAMILY}`;
  }
  ctx.fillStyle = NAME_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillText(name, nameX, headerY + bannerH / 2 + 1);
  ctx.restore();

  // ── Body: icon (hugs the banner) + description (own anchor) ──
  // Two independent vertical anchors so the ICON can sit close to the banner
  // without changing the name↔description spacing.
  const descTopY = headerY + m.headerH + PASSIVE_HEADER_GAP; // sets name↔desc gap
  const iconTopY = headerY + m.headerH + PASSIVE_ICON_GAP;   // pulls the art up
  const iconCX = x + CARD_PAD.left + PASSIVE_ICON_SIZE / 2;
  const iconImg = asset(relic.icon) || asset('placeholder');
  if (iconImg) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const iw = iconImg.width || PASSIVE_ICON_SIZE;
    const ih = iconImg.height || PASSIVE_ICON_SIZE;
    // CONTAIN-fit the whole relic art (never cropped) — relic icons aren't
    // square/circular like skill icons, so mirror how RelicBar draws them —
    // and TOP-anchor it so the visible art hugs the banner.
    const sc = Math.min(PASSIVE_ICON_SIZE / iw, PASSIVE_ICON_SIZE / ih);
    ctx.drawImage(iconImg, iconCX - (iw * sc) / 2, iconTopY, iw * sc, ih * sc);
    ctx.restore();
  }

  // ── "Infinite" badge — same pill size/shape as the cost badge, ∞ glyph. ──
  {
    ctx.save();
    ctx.font = `bold ${COST_BADGE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    const glyphW = Math.max(ctx.measureText(INFINITY_GLYPH).width, COST_BADGE_GEM_R * 2);
    // Forced a touch wider than a round cost pill → an oval badge.
    const pillW = COST_BADGE_PAD_X + glyphW + COST_BADGE_PAD_X + INFINITY_BADGE_EXTRA_W;
    const px = iconCX + PASSIVE_ICON_SIZE / 2 + COST_BADGE_OFFSET.x - pillW;
    const py = iconTopY + PASSIVE_ICON_SIZE + COST_BADGE_OFFSET.y - COST_BADGE_H;
    roundRectPath(ctx, px, py, pillW, COST_BADGE_H, COST_BADGE_H / 2);
    ctx.fillStyle = COST_BADGE_BG;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INFINITY_BADGE_BORDER;
    ctx.stroke();
    ctx.fillStyle = COST_BADGE_NUMBER;
    ctx.textAlign = 'center';
    ctx.fillText(INFINITY_GLYPH, px + pillW / 2, py + COST_BADGE_H / 2 + 1);
    ctx.restore();
  }

  // Description keyword blocks — same left edge as the name, own top anchor.
  if (m.descH > 0) {
    const textX = x + m.textX;
    let blockY = descTopY;
    for (let e = 0; e < model.effectKTs.length; e++) {
      const kt = model.effectKTs[e];
      const bh = m.effectHeights[e];
      kt.rect.x = textX;
      kt.rect.y = blockY;
      kt.rect.w = m.textW;
      kt.rect.h = bh;
      kt.renderSelf(ctx);
      blockY += bh + EFFECT_GAP;
    }
  }

  ctx.restore();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
