/**
 * skillWeaveTags.js — tag catalog + rarity-weighted draw for the "Weave a Power"
 * (Skill Weave) reward screen.
 *
 * The Skill Weave screen is a staged tag draft: across a variable number of
 * ROUNDS the player builds a skill by choosing one keyword TAG per round. The
 * chosen tags form a "bag" that is later SYNTHESIZED into a concrete spell (see
 * skillSynthesizer.js). This module is the single source of truth for:
 *   - the tag catalog (id → label + category + rarity + icon), and
 *   - the per-round DRAW (which tags an option round offers).
 *
 * ── Draw model (replaces the old positional grammar) ────────────────────────
 * Tags are no longer drawn by slot position ([action, element, shape]). Each
 * round draws its options from ONE global pool, weighted by tag RARITY (see
 * weaveConfig.RARITY_WEIGHTS), with a single soft guarantee: ROUND 0 always
 * offers at least one ACTION tag, so every synthesized spell has a verb to build
 * around. Tags already committed to the recipe are excluded from later rounds
 * (no duplicate slots). Validity/meaning of the resulting bag is resolved at
 * synthesis time, not here — so any combination the player can pick is allowed.
 *
 * NOTE: skills are not implemented yet. The recipe → concrete-skill step is a
 * placeholder (skillSynthesizer.synthesize). This module + weaveConfig only
 * define and feed the tag bag.
 */

import { TAG_RARITY, RARITY_WEIGHTS, pickWeightedEntry } from './weaveConfig.js';

/**
 * Tag category buckets. ACTION tags are the "verbs" (the soft round-0 guarantee
 * draws from these). The rest classify how a tag contributes once synthesized.
 *   ACTION   — the verb (damage, create, drain, …)
 *   ELEMENT  — a color / skull the action operates on
 *   SHAPE    — where the action lands (row, area, tile, …)
 *   MODIFIER — alters the spell (extra turn, wild, lock)
 *   STATUS   — a status effect applied to the enemy (logic added later)
 */
export const TAG_CATEGORY = Object.freeze({
  ACTION: 'action',
  ELEMENT: 'element',
  SHAPE: 'shape',
  MODIFIER: 'modifier',
  STATUS: 'status',
});

/**
 * Tag catalog — keyed by tag id. Each entry:
 *   id       — stable identifier (used in recipes + synthesis)
 *   label    — display text shown on the option plaque + recipe slot
 *   category — TAG_CATEGORY bucket (drives the round-0 action guarantee + synth)
 *   rarity   — TAG_RARITY tier (drives draw frequency via RARITY_WEIGHTS)
 *   icon     — AssetManager key for the small gold icon (null → placeholder)
 *
 * Rarity assignments below are a tunable BASELINE — basic colors/verbs are
 * common, board-warping and status tags are rarer. Adjust freely; the draw and
 * the rarity-suffixed option art both read straight from `rarity`.
 *
 * Icons: only a single placeholder tag icon ships today (`skill_weave_tag_test`,
 * the gold flame). Until per-tag art exists every tag falls back to it via
 * getTagIcon(); the gold LABEL carries the tag's identity. Wire real icon keys
 * here as art lands.
 *
 * Hidden value rolls (e.g. `create` → 3..12) are NOT here — they live in
 * weaveConfig.TAG_VALUE_TABLES, keyed by the same id.
 */
export const SKILL_WEAVE_TAGS = Object.freeze({
  // ── Elements (the match-3 colors + skull) ──
  red:    { id: 'red',    label: 'Red',    category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  blue:   { id: 'blue',   label: 'Water',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  green:  { id: 'green',  label: 'Green',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  yellow: { id: 'yellow', label: 'Yellow', category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  purple: { id: 'purple', label: 'Purple', category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  skull:  { id: 'skull',  label: 'Skull',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.UNCOMMON, icon: null },

  // ── Actions (the verb the skill performs) ──
  damage:  { id: 'damage',  label: 'Damage',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: null },
  armor:   { id: 'armor',   label: 'Armor',   category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: null },
  create:  { id: 'create',  label: 'Create',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: null },
  destroy: { id: 'destroy', label: 'Destroy', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  convert: { id: 'convert', label: 'Convert', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  gain:    { id: 'gain',    label: 'Gain',    category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: null },
  heal:    { id: 'heal',    label: 'Heal',    category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  drain:   { id: 'drain',   label: 'Drain',   category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE,     icon: null },
  attack:  { id: 'attack',  label: 'Attack',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  explode: { id: 'explode', label: 'Explode', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE,     icon: null },

  // ── Shapes / targets (where the action lands) ──
  row:    { id: 'row',    label: 'Row',    category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.UNCOMMON, icon: null },
  column: { id: 'column', label: 'Column', category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.UNCOMMON, icon: null },
  area:   { id: 'area',   label: 'Area',   category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.RARE,     icon: null },
  tile:   { id: 'tile',   label: 'Tile',   category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.COMMON,   icon: null },
  random: { id: 'random', label: 'Random', category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.COMMON,   icon: null },

  // ── Modifiers (alter the spell as a whole) ──
  extra_turn: { id: 'extra_turn', label: 'Extra Turn', category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.LEGENDARY, icon: null },
  wild:       { id: 'wild',       label: 'Wild',       category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.LEGENDARY, icon: null },
  lock:       { id: 'lock',       label: 'Lock',       category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.RARE,      icon: null },

  // ── Status effects (enemy debuffs; LOGIC ADDED LATER — data stubs only) ──
  silence:    { id: 'silence',    label: 'Silence',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  cripple:    { id: 'cripple',    label: 'Cripple',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  enfeeble:   { id: 'enfeeble',   label: 'Enfeeble',   category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  brittle:    { id: 'brittle',    label: 'Brittle',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  intangible: { id: 'intangible', label: 'Intangible', category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.LEGENDARY, icon: null },
  berserk:    { id: 'berserk',    label: 'Berserk',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.LEGENDARY, icon: null },
  bleed:      { id: 'bleed',      label: 'Bleed',      category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  frozen:     { id: 'frozen',     label: 'Frozen',     category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  barrier:    { id: 'barrier',    label: 'Barrier',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.UNCOMMON,  icon: null },
});

/** Default tag-icon asset key (gold flame placeholder from the mock). */
export const DEFAULT_TAG_ICON = 'skill_weave_tag_test';

/** All tag ids, frozen — the global draw pool. */
const ALL_TAG_IDS = Object.freeze(Object.keys(SKILL_WEAVE_TAGS));

// ═══════════════════════════════════════════════════════════
// Catalog lookups
// ═══════════════════════════════════════════════════════════

/**
 * Resolve a tag id to its catalog entry.
 * @param {string} id
 * @returns {object|null}
 */
export function getTag(id) {
  return SKILL_WEAVE_TAGS[id] || null;
}

/**
 * Display label for a tag id (falls back to the raw id).
 * @param {string} id
 * @returns {string}
 */
export function getTagLabel(id) {
  const tag = getTag(id);
  return tag ? tag.label : String(id || '');
}

/**
 * Icon asset key for a tag id (falls back to the shared placeholder).
 * @param {string} id
 * @returns {string}
 */
export function getTagIcon(id) {
  const tag = getTag(id);
  return (tag && tag.icon) || DEFAULT_TAG_ICON;
}

/**
 * Rarity tier for a tag id (falls back to common).
 * @param {string} id
 * @returns {string} a TAG_RARITY value
 */
export function getTagRarity(id) {
  const tag = getTag(id);
  return (tag && tag.rarity) || TAG_RARITY.COMMON;
}

// ═══════════════════════════════════════════════════════════
// Rarity-weighted draw
// ═══════════════════════════════════════════════════════════

/**
 * Pick one tag id from `ids`, weighted by each tag's rarity. Pure; returns null
 * for an empty pool.
 * @param {string[]} ids
 * @returns {string|null}
 */
function pickByRarity(ids) {
  const entries = ids.map((id) => [id, RARITY_WEIGHTS[getTagRarity(id)] || 0]);
  return pickWeightedEntry(entries);
}

/** Fisher–Yates shuffle on a copy. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draw the option tags for one round, rarity-weighted, with no repeats within
 * the round and excluding tags already committed to the recipe.
 *
 * Soft action guarantee: when `guaranteeAction` is true (default for round 0)
 * at least one ACTION-category tag is included, so the bag always has a verb.
 *
 * @param {object} opts
 * @param {number}   [opts.roundIndex=0]  0-based round number
 * @param {string[]} [opts.chosen=[]]     tag ids already committed (excluded)
 * @param {number}   [opts.count=3]       how many options to show (2–4)
 * @param {boolean}  [opts.guaranteeAction] force ≥1 action (defaults to round 0)
 * @returns {string[]} the drawn tag ids (shuffled display order)
 */
export function drawTagsForRound({ roundIndex = 0, chosen = [], count = 3, guaranteeAction } = {}) {
  const exclude = new Set(chosen);
  const wantAction = guaranteeAction != null ? guaranteeAction : roundIndex === 0;
  const picks = [];

  // Soft guarantee: seed one rarity-weighted ACTION tag first.
  if (wantAction) {
    const actionPool = ALL_TAG_IDS.filter(
      (id) => !exclude.has(id) && SKILL_WEAVE_TAGS[id].category === TAG_CATEGORY.ACTION,
    );
    const a = pickByRarity(actionPool);
    if (a) { picks.push(a); exclude.add(a); }
  }

  // Fill the rest from the global pool.
  while (picks.length < count) {
    const pool = ALL_TAG_IDS.filter((id) => !exclude.has(id));
    const id = pickByRarity(pool);
    if (!id) break;
    picks.push(id);
    exclude.add(id);
  }

  // Shuffle so a guaranteed action isn't always in the first slot.
  return shuffle(picks);
}
