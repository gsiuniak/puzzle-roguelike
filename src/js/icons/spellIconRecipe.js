/**
 * spellIconRecipe.js — chooses which authored sprites compose a spell's icon.
 *
 * Given a spell's keyword tags (the Skill Weave tag ids — data/skillWeaveTags.js)
 * and its mana cost, this resolves an icon PLAN: the base orb (by mana color),
 * one or two effect sprites (by effect tag), and the border cap. The compositor
 * (spellIconCompositor.js) draws the plan; caching lives in spellIcons.js.
 *
 * ── Selection rules ─────────────────────────────────────────────────────────
 *   BASE  — the spell's dominant mana color (highest-cost color; ties broken by
 *           the spell's first element tag). Falls back to a neutral base.
 *   EFFECTS — 1 or 2 sprites drawn over the base. Effect-bearing tags (actions,
 *           statuses, shapes, modifiers — NOT elements, which only color the
 *           base) are ranked by EFFECT_TAG_PRIORITY: the top one is the MAJOR
 *           (the readable subject, color-dodged), the next distinct one is the
 *           MINOR (multiplied into the base). A verb-less bag falls back to a
 *           default effect so every icon has a subject.
 *   BORDER — always icon_border_2.
 *
 * ── Sprite naming convention (matches the authored sheets) ──────────────────
 *   ui_spritesheet_weave_base:    <color>_base_<n>     (variants 1..N, e.g. red_base_1)
 *       <color> ∈ red blue green yellow purple skull
 *   ui_spritesheet_weave_generic: foreground_<tag>_<n> (variants 1..N, e.g. foreground_damage_1)
 *                                 icon_border_2        (the border cap)
 *       <tag> = any effect tag id below (same ids as the weave tags).
 *
 * Variant counts are auto-discovered (the code probes the bare prefix then
 * _1.._N), so colors/effects may carry any number of authored variants; the
 * choice is deterministic per spell. Missing sprites degrade gracefully
 * (skip / fall back), never throw.
 */

// ═══════════════════════════════════════════════════════════
// Naming + concept tables
// ═══════════════════════════════════════════════════════════

const BORDER_KEY = 'icon_border_2';

/** Sprite-key prefix for a color's base orb (variants are `<prefix>_<n>`). */
const baseKeyPrefix = (color) => `${color}_base`;
/**
 * Some effect tags share authored foreground art with another tag (no dedicated
 * sprite of their own). `change` (the single-tile recolor) reuses `convert`'s.
 */
const EFFECT_SPRITE_ALIAS = Object.freeze({
  change: 'convert',
  // The two damage TYPES reuse the shared damage foreground until dedicated art lands.
  strike: 'damage',
  blast: 'damage',
});
/** Sprite-key prefix for an effect tag's foreground (variants are `<prefix>_<n>`). */
const effectKeyPrefix = (tag) => `foreground_${EFFECT_SPRITE_ALIAS[tag] || tag}`;

/**
 * Mana colors that own a base orb. There is no neutral orb, so the no-color
 * fallback reuses the gray/stone `skull` base.
 */
const BASE_COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'skull']);
const NEUTRAL_COLOR = 'skull';

/** Element tag id → base color (for cost-tie / no-cost fallback). */
const ELEMENT_TO_COLOR = Object.freeze({
  red: 'red', blue: 'blue', green: 'green', yellow: 'yellow', purple: 'purple', skull: 'skull',
});

/**
 * Effect-bearing tag → selection priority (higher wins the MAJOR slot). Tags
 * absent here are not effect layers: elements color the base instead, and any
 * unknown keyword is ignored (it still flavors the cache signature via the tag
 * list). Actions rank above statuses, shapes, then modifiers, so the spell's
 * verb is the readable subject and a shape/status becomes the embedded minor.
 */
const EFFECT_TAG_PRIORITY = Object.freeze({
  // actions (the readable subject)
  explode: 100, strike: 96, blast: 96, damage: 96, attack: 92, magic: 92, destroy: 90, convert: 86,
  change: 85, shuffle: 84, create: 83, heal: 82, armor: 80, drain: 76,
  // statuses (distinct subjects, secondary to a hard action)
  bleed: 60, frozen: 58, barrier: 57, berserk: 56, silence: 54,
  cripple: 52, enfeeble: 50, brittle: 48, intangible: 46,
  // shapes (read well as the embedded minor layer)
  area: 40, row: 36, column: 36, tile: 30,
  // modifiers
  wild: 28, extra_turn: 20,
});

/** When a bag carries no effect-bearing tag, the icon still needs a subject. */
const DEFAULT_EFFECT_TAG = 'damage';

// ═══════════════════════════════════════════════════════════
// Hashing (FNV-1a) — deterministic variant selection + cache keys
// ═══════════════════════════════════════════════════════════

/**
 * FNV-1a hash of a string → uint32. Used for deterministic variant picks and as
 * the icon cache-key hash (spellIcons.js).
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

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** True if the AssetManager has the key loaded (silent — no missing-key warn). */
function has(am, key) {
  return !!(am && typeof am.isLoaded === 'function' && am.isLoaded(key));
}

/**
 * All authored variant keys for a sprite prefix, in stable order: the unnumbered
 * key (if present) then `<prefix>_1`.._N. Probes silently via isLoaded.
 * @param {object} am — AssetManager
 * @param {string} prefix
 * @param {number} [maxVariants=32]
 * @returns {string[]}
 */
function collectVariants(am, prefix, maxVariants = 32) {
  const out = [];
  if (has(am, prefix)) out.push(prefix);
  for (let n = 1; n <= maxVariants; n++) {
    const k = `${prefix}_${n}`;
    if (has(am, k)) out.push(k);
  }
  return out;
}

/**
 * Pick one variant of `prefix` deterministically from `seed`. When no Asset
 * Manager is available (variants can't be probed) the bare prefix is returned so
 * a render still has something to draw.
 * @returns {string|null}
 */
function pickVariant(am, prefix, seed) {
  if (!am) return prefix;
  const variants = collectVariants(am, prefix);
  if (!variants.length) return null;
  return variants[seed % variants.length];
}

/** Normalize a cost object `{ color: amount }` to a stable string for hashing. */
function costSignature(cost) {
  if (!cost || typeof cost !== 'object') return '-';
  return Object.keys(cost)
    .sort()
    .map((c) => `${c}${cost[c]}`)
    .join(',') || '-';
}

/**
 * Determine the dominant mana color from the cost: the highest-amount color,
 * ties broken by the spell's first element tag, then neutral.
 * @param {object} cost — `{ color: amount }`
 * @param {string[]} elementTags — element tag ids present on the spell
 * @returns {string} a BASE_COLORS entry
 */
function dominantColor(cost, elementTags) {
  const entries = cost && typeof cost === 'object'
    ? Object.entries(cost).filter(([c, amt]) => ELEMENT_TO_COLOR[c] && amt > 0)
    : [];
  if (entries.length) {
    let max = -Infinity;
    for (const [, amt] of entries) if (amt > max) max = amt;
    const tied = entries.filter(([, amt]) => amt === max).map(([c]) => c);
    if (tied.length === 1) return ELEMENT_TO_COLOR[tied[0]];
    // Tie: prefer a tied color that is also one of the spell's element tags.
    const byElement = elementTags.find((t) => tied.includes(t));
    return ELEMENT_TO_COLOR[byElement || tied[0]];
  }
  // No usable cost — fall back to the first element tag, else neutral.
  if (elementTags.length) return ELEMENT_TO_COLOR[elementTags[0]] || NEUTRAL_COLOR;
  return NEUTRAL_COLOR;
}

// ═══════════════════════════════════════════════════════════
// Resolution
// ═══════════════════════════════════════════════════════════

/**
 * Resolve a spell's tags + cost into an icon PLAN of authored sprite keys.
 *
 * Deterministic: identical (tags, cost, spellId) always resolve to the same
 * plan. Variant selection probes the AssetManager so only authored sprites are
 * chosen; with no AssetManager the bare-prefix keys are used (no variants).
 *
 * @param {string[]} tags — spell keyword/tag ids (Skill Weave tag ids)
 * @param {object} cost — mana cost `{ color: amount }`
 * @param {string} spellId — stable spell id (seeds the variant picks)
 * @param {object} [assetManager] — supplies sprite presence + slices
 * @returns {{
 *   baseKey: string, minorKey: string|null, majorKey: string,
 *   borderKey: string|null, color: string,
 *   majorTag: string, minorTag: string|null, signature: string,
 * }}
 */
export function resolveIconPlan(tags, cost, spellId = '', assetManager = null) {
  const list = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [];
  const am = assetManager || null;

  const elementTags = list.filter((t) => ELEMENT_TO_COLOR[t]);
  const color = dominantColor(cost, elementTags);

  // Rank the effect-bearing tags; keep input order stable for equal priority.
  const effectTags = list
    .map((id, i) => ({ id, i, pri: EFFECT_TAG_PRIORITY[id] }))
    .filter((e) => e.pri !== undefined)
    .sort((a, b) => (b.pri - a.pri) || (a.i - b.i))
    .map((e) => e.id);

  const seedBase = hashString(`${String(spellId)}|${list.slice().sort().join('+')}|${costSignature(cost)}`);

  // MAJOR: the highest-priority effect tag with an authored sprite.
  let majorTag = null;
  let majorKey = null;
  for (const tag of effectTags) {
    const key = pickVariant(am, effectKeyPrefix(tag), (seedBase ^ hashString(tag)) >>> 0);
    if (key) { majorTag = tag; majorKey = key; break; }
  }
  // Fallback subject so every icon reads as something.
  if (!majorKey) {
    majorTag = DEFAULT_EFFECT_TAG;
    majorKey = pickVariant(am, effectKeyPrefix(DEFAULT_EFFECT_TAG), seedBase)
      || effectKeyPrefix(DEFAULT_EFFECT_TAG);
  }

  // MINOR: the next distinct effect tag with an authored sprite.
  let minorTag = null;
  let minorKey = null;
  for (const tag of effectTags) {
    if (tag === majorTag) continue;
    const key = pickVariant(am, effectKeyPrefix(tag), (seedBase ^ hashString(`m${tag}`)) >>> 0);
    if (key) { minorTag = tag; minorKey = key; break; }
  }

  const baseKey = pickVariant(am, baseKeyPrefix(color), (seedBase ^ hashString('base')) >>> 0)
    // Neutral fallback if the chosen color has no authored base.
    || pickVariant(am, baseKeyPrefix(NEUTRAL_COLOR), seedBase)
    || baseKeyPrefix(color);

  const borderKey = !am || has(am, BORDER_KEY) ? BORDER_KEY : null;

  // Signature = the resolved sprite keys: two spells that composite from the
  // same layers share a cache entry, and the cache key fully pins the pixels.
  const signature = [baseKey, minorKey || '-', majorKey, borderKey || '-'].join('|');

  return { baseKey, minorKey, majorKey, borderKey, color, majorTag, minorTag, signature };
}
