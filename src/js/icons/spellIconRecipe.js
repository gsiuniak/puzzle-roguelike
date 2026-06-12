/**
 * spellIconRecipe.js — keyword → IconRecipe resolution for procedural spell icons.
 *
 * PURE LOGIC, no canvas. Maps a spell's keyword list (the Skill Weave tag ids —
 * see data/skillWeaveTags.js) to an IconRecipe: which palette, glyph, overlays,
 * background style, rim, and render seed the compositor should use. Rendering
 * lives in spellIconCompositor.js; caching/integration in spellIcons.js.
 *
 * ── Slot model (the coherence guarantees — do not relax) ────────────────────
 *   - Exactly ONE palette colors the icon body. A second element keyword may
 *     only tint the rim hairline (`secondaryPalette`); third+ elements drop.
 *   - Exactly ONE glyph. A losing form keyword follows its `demoteTo` path
 *     (becomes an overlay if it has one, else drops).
 *   - At most TWO overlays. Extra modifiers drop in priority order.
 *   - Unknown keywords never fail — they just contribute to the seed.
 *
 * ── Seed model ──────────────────────────────────────────────────────────────
 *   iconSeed = fnv1a(runSeed | spellId | sortedKeywords)
 *   Keyword resolution (which palette/glyph/overlays) is seed-INDEPENDENT so a
 *   fire burst is always recognizably a fire burst; the run seed only varies
 *   the compositor's jitter (cloud layout, glyph variation, overlay placement).
 *   Same spell + same run → identical icon. New run → fresh rendering.
 */

import { getTagRarity } from '../data/skillWeaveTags.js';
import { TAG_RARITY } from '../data/weaveConfig.js';
import { PNG_GLYPH_IDS } from './pngGlyphs.js';

// ═══════════════════════════════════════════════════════════
// Ids used by the compositor (palettes / glyphs / overlays / rims)
// ═══════════════════════════════════════════════════════════

/** Palette ids — must exist in spellIconCompositor.PALETTES. */
export const PALETTE_IDS = Object.freeze([
  'fire', 'lightning', 'ice', 'nature', 'void', 'holy', 'bone', 'arcane',
]);

/**
 * Glyph ids — must exist in the compositor's glyph registry. Procedural ids
 * first; PNG-backed ids come from pngGlyphs.js (registered with the compositor
 * at boot once their art loads).
 */
export const GLYPH_IDS = Object.freeze([
  'strike', 'slash', 'burst', 'shield', 'orb', 'rune',
  ...PNG_GLYPH_IDS,
]);

const PNG_GLYPH_ID_SET = new Set(PNG_GLYPH_IDS);

/** Overlay ids — must exist in spellIconCompositor.OVERLAYS. */
export const OVERLAY_IDS = Object.freeze([
  'wild', 'greater', 'sparks', 'streaks_h', 'streaks_v', 'cage',
]);

/** Rim ids — must exist in spellIconCompositor.RIMS. Picked from rarity. */
export const RIM_IDS = Object.freeze(['iron', 'bronze', 'gold', 'arcane']);

const DEFAULT_PALETTE = 'arcane';
const DEFAULT_GLYPH = 'orb';

/** Palettes whose clouds read better as ridged veins than soft masses. */
const RIDGED_PALETTES = new Set(['lightning', 'void', 'bone']);

// ═══════════════════════════════════════════════════════════
// Keyword → icon role registry
// ═══════════════════════════════════════════════════════════

/**
 * Icon role data per keyword id. Keys are the Skill Weave tag ids (the game's
 * spell keywords). Each entry:
 *   role     — 'element' | 'form' | 'modifier' | 'meta'
 *   priority — higher wins slot conflicts
 *   palette  — (element) palette id
 *   glyph    — (form) glyph id
 *   overlay  — (modifier) overlay id; omit for seed-only keywords
 *   demoteTo — (form) fallback when the glyph slot is already taken
 *
 * 'meta' keywords carry no visual payload — they still participate in the seed
 * (so e.g. "frozen damage" and plain "damage" render differently) but claim no
 * slot. New keywords default to meta when absent from this table.
 */
export const KEYWORD_ICON_ROLES = Object.freeze({
  // ── Elements → palette ──
  red:    { role: 'element', priority: 30, palette: 'fire' },
  blue:   { role: 'element', priority: 30, palette: 'ice' },
  green:  { role: 'element', priority: 30, palette: 'nature' },
  yellow: { role: 'element', priority: 30, palette: 'lightning' },
  purple: { role: 'element', priority: 30, palette: 'void' },
  skull:  { role: 'element', priority: 32, palette: 'bone' },

  // ── Actions → glyph (demote to overlay when the form slot is taken) ──
  // All forms use authored PNG glyphs from the weave-grayscale sheet (see
  // icons/pngGlyphs.js); the procedural glyphs remain as fallbacks/defaults.
  explode: { role: 'form', priority: 26, glyph: 'explode_png', demoteTo: { overlay: 'wild' } },
  damage:  { role: 'form', priority: 25, glyph: 'damage_png',  demoteTo: { overlay: 'sparks' } },
  armor:   { role: 'form', priority: 25, glyph: 'armor_png',   demoteTo: { overlay: 'greater' } },
  attack:  { role: 'form', priority: 24, glyph: 'attack_png',  demoteTo: { overlay: 'sparks' } },
  convert: { role: 'form', priority: 24, glyph: 'convert_png', demoteTo: { overlay: 'greater' } },
  destroy: { role: 'form', priority: 23, glyph: 'destroy_png', demoteTo: { overlay: 'wild' } },
  create:  { role: 'form', priority: 22, glyph: 'create_png',  demoteTo: { overlay: 'sparks' } },
  heal:    { role: 'form', priority: 21, glyph: 'heal_png',    demoteTo: { overlay: 'greater' } },
  gain:    { role: 'form', priority: 20, glyph: 'gain_png',    demoteTo: { overlay: 'sparks' } },
  drain:   { role: 'form', priority: 19, glyph: 'drain_png',   demoteTo: { overlay: 'wild' } },

  // ── Modifiers → overlay ──
  wild:       { role: 'modifier', priority: 28, overlay: 'wild' },
  extra_turn: { role: 'modifier', priority: 27, overlay: 'sparks' },
  lock:       { role: 'modifier', priority: 18, overlay: 'cage' },

  // ── Shapes → overlay ──
  area:   { role: 'modifier', priority: 16, overlay: 'greater' },
  row:    { role: 'modifier', priority: 15, overlay: 'streaks_h' },
  column: { role: 'modifier', priority: 15, overlay: 'streaks_v' },
  random: { role: 'modifier', priority: 14, overlay: 'sparks' },
  tile:   { role: 'meta',     priority: 5 },

  // ── Statuses — mostly seed-only today; a few have a natural visual ──
  barrier:    { role: 'form',     priority: 12, glyph: 'barrier_png', demoteTo: { overlay: 'greater' } },
  berserk:    { role: 'modifier', priority: 13, overlay: 'wild' },
  bleed:      { role: 'modifier', priority: 12, overlay: 'streaks_v' },
  silence:    { role: 'meta',     priority: 5 },
  cripple:    { role: 'meta',     priority: 5 },
  enfeeble:   { role: 'meta',     priority: 5 },
  brittle:    { role: 'meta',     priority: 5 },
  intangible: { role: 'meta',     priority: 5 },
  frozen:     { role: 'meta',     priority: 5 },
});

// ═══════════════════════════════════════════════════════════
// Seed derivation
// ═══════════════════════════════════════════════════════════

/**
 * FNV-1a hash of a string → uint32. Used both for icon seed derivation and as
 * the recipe cache key hash (spellIcons.js).
 * @param {string} s
 * @returns {number} uint32
 */
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Derive the icon render seed from the run seed + spell identity.
 * @param {string|number} runSeed — the run's map seed (MapScene._seed)
 * @param {string} spellId — stable spell identifier within the run
 * @param {string[]} keywords
 * @returns {number} uint32
 */
export function deriveIconSeed(runSeed, spellId, keywords) {
  const sorted = (keywords || []).slice().sort().join('|');
  return hashString(`${String(runSeed)} ${String(spellId)} ${sorted}`);
}

// ═══════════════════════════════════════════════════════════
// Resolution
// ═══════════════════════════════════════════════════════════

/** Rarity tier → rim id. */
const RIM_BY_RARITY = Object.freeze({
  [TAG_RARITY.COMMON]: 'iron',
  [TAG_RARITY.UNCOMMON]: 'bronze',
  [TAG_RARITY.RARE]: 'gold',
  [TAG_RARITY.LEGENDARY]: 'arcane',
});
const RARITY_ORDER = [TAG_RARITY.COMMON, TAG_RARITY.UNCOMMON, TAG_RARITY.RARE, TAG_RARITY.LEGENDARY];

/** Highest rarity tier among the keywords (falls back to common). */
function maxRarity(keywords) {
  let best = 0;
  for (const k of keywords) {
    const idx = RARITY_ORDER.indexOf(getTagRarity(k));
    if (idx > best) best = idx;
  }
  return RARITY_ORDER[best];
}

/**
 * Resolve a keyword list into an IconRecipe.
 *
 * Deterministic and seed-independent in its CHOICES (palette/glyph/overlays
 * come only from the keywords); the run seed feeds only `seed`, which the
 * compositor uses for jitter. Never fails — empty/unknown keyword lists
 * produce the neutral arcane orb.
 *
 * @param {string[]} keywords — spell keyword ids (Skill Weave tag ids)
 * @param {string} spellId — stable id for seed derivation (e.g. 'woven_red_damage')
 * @param {string|number} runSeed — the run seed (MapScene seed string)
 * @returns {{
 *   palette: string, secondaryPalette: string|null,
 *   glyph: string, glyphSource: 'procedural'|'png',
 *   overlays: string[], bgStyle: 'clouds'|'ridged',
 *   rim: string, seed: number,
 * }}
 */
export function resolveRecipe(keywords, spellId = '', runSeed = 0) {
  const list = Array.isArray(keywords) ? keywords.filter((k) => typeof k === 'string') : [];

  // Sort by priority descending (stable for equal priorities: keep input order).
  const known = list
    .map((id, i) => ({ id, i, def: KEYWORD_ICON_ROLES[id] || null }))
    .filter((e) => e.def)
    .sort((a, b) => (b.def.priority - a.def.priority) || (a.i - b.i));

  let palette = null;
  let secondaryPalette = null;
  let glyph = null;
  const overlays = [];

  const addOverlay = (id) => {
    if (id && overlays.length < 2 && !overlays.includes(id)) overlays.push(id);
  };

  // Element + form slots first (modifiers fill remaining overlay capacity after,
  // so a demoted form competes with modifiers in priority order — handled by
  // walking the sorted list once and letting addOverlay enforce the cap).
  for (const { def } of known) {
    if (def.role === 'element') {
      if (!palette) palette = def.palette;
      else if (!secondaryPalette && def.palette !== palette) secondaryPalette = def.palette;
      // third+ elements: ignored
    } else if (def.role === 'form') {
      if (!glyph) glyph = def.glyph;
      else if (def.demoteTo && def.demoteTo.overlay) addOverlay(def.demoteTo.overlay);
    } else if (def.role === 'modifier') {
      addOverlay(def.overlay);
    }
    // 'meta' → seed-only
  }

  palette = palette || DEFAULT_PALETTE;
  glyph = glyph || DEFAULT_GLYPH;

  return {
    palette,
    secondaryPalette,
    glyph,
    glyphSource: PNG_GLYPH_ID_SET.has(glyph) ? 'png' : 'procedural',
    overlays,
    bgStyle: RIDGED_PALETTES.has(palette) ? 'ridged' : 'clouds',
    rim: RIM_BY_RARITY[maxRarity(list)] || 'iron',
    seed: deriveIconSeed(runSeed, spellId, list),
  };
}

/**
 * Stable string form of a recipe — the cache key body (spellIcons.js appends
 * the pipeline version).
 * @param {object} recipe
 * @returns {string}
 */
export function recipeKey(recipe) {
  return [
    recipe.palette,
    recipe.secondaryPalette || '-',
    recipe.glyph,
    recipe.glyphSource,
    recipe.overlays.join('+') || '-',
    recipe.bgStyle,
    recipe.rim,
    recipe.seed,
  ].join(':');
}
