/**
 * keywordParser.js — parse [[Keyword]] markup into renderable segments and
 * resolve the keyword chains used by stacked tooltips.
 *
 * Markup: a keyword is any text wrapped in double square brackets, e.g.
 *   '[[Create]] 10 [[Skulls]].'  →  "Create 10 Skulls." (Create / Skulls styled)
 *
 * The bracket characters are NEVER shown to the player; the visible text is the
 * keyword's configured `label` (or the raw token, for missing keywords).
 *
 * Graceful failure:
 *   - A bracket token with no matching definition is still returned as a
 *     keyword segment, flagged `missing:true` with a fallback color, so callers
 *     can render it as plain/fallback text instead of crashing.
 *   - A one-time developer warning is logged per unknown token.
 */

import {
  getKeywordDefinition,
  normalizeKeywordKey,
  KEYWORD_COLOR,
  KEYWORD_MISSING_COLOR,
} from '../data/keywordDefinitions.js';

// Match [[ ... ]] where the inner text contains no brackets.
const KEYWORD_TAG_RE = /\[\[([^\[\]]+)\]\]/g;

/** Tokens already warned about, so the console isn't spammed each frame. */
const _warned = new Set();

function warnMissingKeyword(rawToken) {
  const key = normalizeKeywordKey(rawToken);
  if (_warned.has(key)) return;
  _warned.add(key);
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      `[keywords] No definition for [[${rawToken}]] (normalized: "${key}"). ` +
      'Rendering as fallback text. Add it to data/keywordDefinitions.js.',
    );
  }
}

/**
 * @typedef {object} TextSegment
 * @property {'text'} type
 * @property {string} text
 *
 * @typedef {object} KeywordSegment
 * @property {'keyword'} type
 * @property {string} keywordId   — normalized id (canonical when resolved)
 * @property {string} label       — visible text (definition label, or raw token)
 * @property {string} color       — render color (keyword color or fallback)
 * @property {boolean} missing     — true when no definition was found
 */

/**
 * Parse text with [[Keyword]] markup into an ordered list of segments.
 * Text outside brackets becomes 'text' segments; bracket tokens become
 * 'keyword' segments. Returns a single empty array for empty input.
 * @param {string} raw
 * @returns {Array<TextSegment|KeywordSegment>}
 */
export function parseKeywordText(raw) {
  const text = raw == null ? '' : String(raw);
  const segments = [];
  if (!text) return segments;

  let lastIndex = 0;
  let m;
  KEYWORD_TAG_RE.lastIndex = 0;
  while ((m = KEYWORD_TAG_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, m.index) });
    }

    const rawToken = m[1];
    const def = getKeywordDefinition(rawToken);
    if (def) {
      segments.push({
        type: 'keyword',
        keywordId: def.id,
        label: def.label,
        color: KEYWORD_COLOR,
        missing: false,
      });
    } else {
      warnMissingKeyword(rawToken);
      segments.push({
        type: 'keyword',
        keywordId: normalizeKeywordKey(rawToken),
        label: rawToken,
        color: KEYWORD_MISSING_COLOR,
        missing: true,
      });
    }

    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Strip [[ ]] markup, returning plain display text (labels substituted, no
 * brackets). Handy for places that can't render styled spans yet.
 * @param {string} raw
 * @returns {string}
 */
export function stripKeywordMarkup(raw) {
  return parseKeywordText(raw)
    .map(seg => (seg.type === 'keyword' ? seg.label : seg.text))
    .join('');
}

/**
 * True if the text contains at least one resolvable (non-missing) keyword.
 * @param {string} raw
 * @returns {boolean}
 */
export function hasKeywords(raw) {
  return parseKeywordText(raw).some(seg => seg.type === 'keyword' && !seg.missing);
}

/**
 * Resolve the ordered, de-duplicated chain of keyword definitions reachable
 * from `rootText`, for building a chain of stacked tooltips.
 *
 * Traversal is breadth-first across keyword descriptions: first all keywords
 * found directly in `rootText`, then the keywords inside those keywords'
 * descriptions, and so on. This is what makes nested keywords (a keyword whose
 * description mentions another keyword) appear later in the chain.
 *
 * Recursion safety:
 *   - `visited` tracks keyword ids so the same keyword never appears twice in a
 *     chain (e.g. Create → Tiles → Create won't loop).
 *   - The result is capped at `maxDepth` total links.
 *
 * @param {string} rootText — text whose keywords seed the chain
 * @param {number} [maxDepth=3] — maximum number of links returned
 * @param {Iterable<string>} [excludeIds] — keyword ids to pre-mark as visited,
 *   so they never appear in the chain. Pass the hovered keyword's own id here
 *   when the parent tooltip IS a keyword, so its definition isn't repeated when
 *   a nested description links back to it (e.g. Tiles → Match → Tiles).
 * @returns {Array<{ id:string, label:string, color:string, description:string }>}
 */
export function buildTooltipChain(rootText, maxDepth = 3, excludeIds = null) {
  const result = [];
  if (maxDepth <= 0) return result;

  const visited = new Set();
  if (excludeIds) {
    for (const id of excludeIds) visited.add(id);
  }
  let frontier = [rootText];

  while (frontier.length > 0 && result.length < maxDepth) {
    const nextFrontier = [];
    for (const text of frontier) {
      const segs = parseKeywordText(text);
      for (const seg of segs) {
        if (seg.type !== 'keyword' || seg.missing) continue;
        if (visited.has(seg.keywordId)) continue;
        visited.add(seg.keywordId);

        const def = getKeywordDefinition(seg.keywordId);
        if (!def) continue;

        result.push(def);
        nextFrontier.push(def.description || '');
        if (result.length >= maxDepth) break;
      }
      if (result.length >= maxDepth) break;
    }
    frontier = nextFrontier;
  }

  return result;
}

export default parseKeywordText;
