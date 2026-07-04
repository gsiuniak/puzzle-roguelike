import UIElement from './UIElement.js';
import { parseKeywordText } from '../systems/keywordParser.js';
import { KEYWORD_MISSING_COLOR } from '../data/keywordDefinitions.js';

/**
 * KeywordText — renders a string containing [[Keyword]] markup as normal text
 * with inline, colored keyword spans.
 *
 * It deliberately mirrors the subset of UIText's API used by Tooltip
 * (`setStyle`, `measureText`, `renderSelf`, `rect`) so it can be used as a
 * drop-in replacement for a tooltip/description body. Plain text with no
 * keywords renders identically to UIText (single default color).
 *
 * Word-wrapping is keyword-aware: a keyword's visible `label` (not the bracket
 * token) participates in wrapping, and each keyword's on-screen rectangle is
 * recorded during render so callers can hit-test/hover individual keyword
 * spans (see `getKeywordRects()`).
 *
 * Supported style props (via setStyle):
 *   text, fontSize, fontFamily, color, bold, italic,
 *   alignH ('left'|'center'|'right'), alignV ('top'|'center'|'bottom'),
 *   maxWidth (wrap width; 0 = single line), lineHeight,
 *   missingColor (color for unresolved keywords),
 *   shadowColor / shadowBlur / shadowOffsetX / shadowOffsetY.
 */
export default class KeywordText extends UIElement {
  constructor(text = '') {
    super();
    this.text = text;
    this.fontSize = 18;
    this.fontFamily = '"Marcellus SC", Georgia, "Times New Roman", serif';
    this.color = '#f5e7c8';
    this.bold = false;
    this.italic = false;
    this.alignH = 'center';
    this.alignV = 'center';
    this.maxWidth = 0;
    /** Max wrapped lines (0 = unlimited). Overflow lines are dropped and a
     *  trailing ellipsis is drawn after the last visible line as the
     *  "there's more" indicator (used by SkillButton's 2-line descriptions). */
    this.maxLines = 0;
    this.lineHeight = null;
    this._missingColor = KEYWORD_MISSING_COLOR;

    // Blur 0 = sharp offset shadow (blurred shadows are the slow canvas path;
    // skill cards draw many of these per frame) — mirrors UIText's default.
    this.shadowColor = 'rgba(0,0,0,0.65)';
    this.shadowBlur = 0;
    this.shadowOffsetX = 1;
    this.shadowOffsetY = 1;

    // Layout cache (lines built from the parsed segments).
    this._layout = null;
    this._layoutKey = null;

    // Keyword hit rects from the last render, absolute (design) coords.
    /** @type {Array<{ keywordId:string, label:string, rect:{x:number,y:number,w:number,h:number} }>} */
    this._keywordRects = [];
  }

  _getLineHeight() {
    return this.lineHeight != null ? this.lineHeight : this.fontSize * 1.35;
  }

  getFontString() {
    const style = this.italic ? 'italic ' : '';
    const weight = this.bold ? 'bold ' : '';
    return `${style}${weight}${this.fontSize}px ${this.fontFamily}`;
  }

  setStyle(props) {
    super.setStyle(props);
    let invalidate = false;
    if (props.text !== undefined) { this.text = props.text == null ? '' : String(props.text); invalidate = true; }
    if (props.fontSize !== undefined) { this.fontSize = props.fontSize; invalidate = true; }
    if (props.fontFamily !== undefined) { this.fontFamily = props.fontFamily; invalidate = true; }
    if (props.bold !== undefined) { this.bold = props.bold; invalidate = true; }
    if (props.italic !== undefined) { this.italic = props.italic; invalidate = true; }
    if (props.maxWidth !== undefined) { this.maxWidth = props.maxWidth; invalidate = true; }
    if (props.maxLines !== undefined) { this.maxLines = props.maxLines; invalidate = true; }
    if (props.lineHeight !== undefined) { this.lineHeight = props.lineHeight; invalidate = true; }
    if (props.color !== undefined) { this.color = props.color; invalidate = true; }
    if (props.missingColor !== undefined) { this._missingColor = props.missingColor; invalidate = true; }
    if (props.alignH !== undefined) this.alignH = props.alignH;
    if (props.alignV !== undefined) this.alignV = props.alignV;
    if (props.shadowColor !== undefined) this.shadowColor = props.shadowColor;
    if (props.shadowBlur !== undefined) this.shadowBlur = props.shadowBlur;
    if (props.shadowOffsetX !== undefined) this.shadowOffsetX = props.shadowOffsetX;
    if (props.shadowOffsetY !== undefined) this.shadowOffsetY = props.shadowOffsetY;
    if (invalidate) { this._layout = null; this._layoutKey = null; }
  }

  /** Keyword spans drawn in the last render, with absolute rects. */
  getKeywordRects() {
    return this._keywordRects;
  }

  // ── Layout ────────────────────────────────────────────

  /**
   * Build a flat char stream from the parsed segments, each char carrying its
   * color and keyword id (null for plain text / unresolved keywords).
   */
  _buildChars() {
    const segs = parseKeywordText(this.text);
    const chars = [];
    for (const seg of segs) {
      if (seg.type === 'text') {
        for (const ch of seg.text) chars.push({ ch, color: this.color, keywordId: null, label: '' });
      } else if (seg.type === 'dynamic') {
        // A computed/scaled value (`<<n>>`) — colored, but not a hoverable span.
        const color = seg.color || this.color;
        for (const ch of seg.text) chars.push({ ch, color, keywordId: null, label: '' });
      } else {
        const color = seg.missing ? this._missingColor : (seg.color || this.color);
        // Missing keywords aren't hoverable spans — render as fallback text only.
        const kid = seg.missing ? null : seg.keywordId;
        for (const ch of seg.label) chars.push({ ch, color, keywordId: kid, label: seg.label });
      }
    }
    return chars;
  }

  /**
   * Tokenize chars into words (runs of same color/keyword), spaces, and hard
   * breaks; then greedily wrap into lines respecting maxWidth.
   * Returns { lines, spaceW }.
   */
  _buildLayout(ctx) {
    ctx.font = this.getFontString();
    const spaceW = ctx.measureText(' ').width;
    const chars = this._buildChars();

    // Tokenize: words carry an array of colored runs.
    const tokens = []; // {type:'word', runs:[{text,color,keywordId,label,width}], width} | {type:'space'} | {type:'break'}
    let runs = [];
    let runText = '';
    let runColor = null;
    let runKid = null;
    let runLabel = '';

    const flushRun = () => {
      if (runText) {
        runs.push({ text: runText, color: runColor, keywordId: runKid, label: runLabel, width: 0 });
        runText = '';
      }
    };
    const flushWord = () => {
      flushRun();
      if (runs.length) tokens.push({ type: 'word', runs, width: 0 });
      runs = [];
      runColor = null;
      runKid = null;
      runLabel = '';
    };

    for (const c of chars) {
      if (c.ch === '\n') { flushWord(); tokens.push({ type: 'break' }); continue; }
      if (c.ch === ' ' || c.ch === '\t') { flushWord(); tokens.push({ type: 'space' }); continue; }
      if (runText && (c.color !== runColor || c.keywordId !== runKid)) flushRun();
      if (!runText) { runColor = c.color; runKid = c.keywordId; runLabel = c.label; }
      runText += c.ch;
    }
    flushWord();

    // Measure run + word widths.
    for (const t of tokens) {
      if (t.type !== 'word') continue;
      let w = 0;
      for (const r of t.runs) { r.width = ctx.measureText(r.text).width; w += r.width; }
      t.width = w;
    }

    // Greedy wrap.
    const maxW = this.maxWidth && this.maxWidth > 0 ? this.maxWidth : Infinity;
    const lines = [];
    let line = { words: [], width: 0 };
    let pendingSpace = false;
    const pushLine = () => { lines.push(line); line = { words: [], width: 0 }; pendingSpace = false; };

    for (const t of tokens) {
      if (t.type === 'break') { pushLine(); continue; }
      if (t.type === 'space') { if (line.words.length) pendingSpace = true; continue; }
      // word
      const leadSpace = line.words.length && pendingSpace ? spaceW : 0;
      if (line.words.length && line.width + leadSpace + t.width > maxW) {
        pushLine();
        line.words.push({ token: t, spaceBefore: false });
        line.width = t.width;
      } else {
        line.words.push({ token: t, spaceBefore: !!leadSpace });
        line.width += leadSpace + t.width;
      }
      pendingSpace = false;
    }
    if (line.words.length || lines.length === 0) lines.push(line);

    // Line cap: drop overflow lines; renderSelf draws a trailing ellipsis.
    let truncated = false;
    if (this.maxLines > 0 && lines.length > this.maxLines) {
      lines.length = this.maxLines;
      truncated = true;
    }

    return { lines, spaceW, truncated };
  }

  /** True when the last layout dropped lines due to maxLines (valid after
   *  the element has been measured/rendered at least once). */
  get truncated() {
    return !!(this._layout && this._layout.truncated);
  }

  _getLayout(ctx) {
    const key = `${this.text}|${this.getFontString()}|${this.maxWidth}|${this.maxLines}`;
    if (this._layout && this._layoutKey === key) return this._layout;
    this._layout = this._buildLayout(ctx);
    this._layoutKey = key;
    return this._layout;
  }

  /**
   * Measure wrapped dimensions. Mirrors UIText.measureText's return shape.
   * @returns {{width:number, height:number, ascent:number, lineCount:number}}
   */
  measureText(ctx) {
    const { lines } = this._getLayout(ctx);
    const lineH = this._getLineHeight();
    let maxWidth = 0;
    for (const l of lines) if (l.width > maxWidth) maxWidth = l.width;
    const m = ctx.measureText('M');
    const ascent = m.actualBoundingBoxAscent || this.fontSize * 0.8;
    return {
      width: maxWidth,
      height: lines.length > 0 ? (lines.length - 1) * lineH + this.fontSize : 0,
      ascent,
      lineCount: lines.length,
    };
  }

  // ── Render ────────────────────────────────────────────

  renderSelf(ctx) {
    this._keywordRects = [];
    if (!this.text) return;

    const r = this.rect;
    const layout = this._getLayout(ctx);
    const { lines, spaceW } = layout;
    const lineCount = lines.length;
    if (lineCount === 0) return;

    const lineH = this._getLineHeight();
    const blockHeight = (lineCount - 1) * lineH + this.fontSize;

    ctx.save();
    ctx.font = this.getFontString();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; // we position each run manually
    if (this.shadowColor) {
      ctx.shadowColor = this.shadowColor;
      ctx.shadowBlur = this.shadowBlur;
      ctx.shadowOffsetX = this.shadowOffsetX;
      ctx.shadowOffsetY = this.shadowOffsetY;
    }

    // Vertical anchor of the first line's baseline center.
    let startY;
    switch (this.alignV) {
      case 'top': startY = r.y + this.fontSize / 2; break;
      case 'bottom': startY = r.y + r.h - blockHeight + this.fontSize / 2; break;
      default: startY = r.y + (r.h - blockHeight) / 2 + this.fontSize / 2; break;
    }

    const needsClip = this.maxWidth > 0 && lineCount > 1 && blockHeight > r.h;
    if (needsClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }

    for (let i = 0; i < lineCount; i++) {
      const line = lines[i];
      const cy = startY + i * lineH;

      // Horizontal start based on alignment.
      let x;
      switch (this.alignH) {
        case 'center': x = r.x + (r.w - line.width) / 2; break;
        case 'right': x = r.x + r.w - line.width; break;
        default: x = r.x; break;
      }

      // Track open keyword span to merge adjacent runs (incl. inter-word space).
      let openKw = null;
      const lineTop = cy - this.fontSize / 2;
      const closeKw = () => {
        if (!openKw) return;
        this._keywordRects.push({
          keywordId: openKw.id,
          label: openKw.label,
          rect: { x: openKw.x0, y: lineTop, w: Math.max(0, openKw.x1 - openKw.x0), h: this.fontSize },
        });
        openKw = null;
      };

      for (let w = 0; w < line.words.length; w++) {
        const entry = line.words[w];
        if (entry.spaceBefore) x += spaceW; // gap kept inside an open keyword span
        for (const run of entry.token.runs) {
          ctx.fillStyle = run.color;
          ctx.fillText(run.text, x, cy);

          if (run.keywordId) {
            if (openKw && openKw.id === run.keywordId) {
              openKw.x1 = x + run.width;
            } else {
              closeKw();
              openKw = { id: run.keywordId, label: run.label, x0: x, x1: x + run.width };
            }
          } else {
            closeKw();
          }
          x += run.width;
        }
      }
      closeKw();

      // Truncation indicator: a trailing ellipsis after the last visible line
      // (maxLines dropped content). Clamped to the rect's right edge.
      if (layout.truncated && i === lineCount - 1) {
        const ellW = ctx.measureText('…').width;
        ctx.fillStyle = this.color;
        ctx.fillText('…', Math.min(x + 2, r.x + r.w - ellW), cy);
      }
    }

    if (needsClip) ctx.restore();
    ctx.restore();
  }
}
