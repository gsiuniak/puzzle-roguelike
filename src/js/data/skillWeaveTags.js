/**
 * skillWeaveTags.js — tag catalog + recipe grammar for the "Weave a Power"
 * (Skill Weave) reward screen.
 *
 * The Skill Weave screen is a staged tag draft: the player builds a skill by
 * choosing one keyword TAG per step, filling a fixed-length RECIPE. This module
 * is the single source of truth for:
 *   - the tag catalog (id → display label + icon + category), and
 *   - the recipe GRAMMAR that decides which tags are valid at each step.
 *
 * The grammar is intentionally data-driven (a small rule table, NOT hardcoded
 * branching) so it can be expanded as real skills are authored. Today every
 * complete recipe is `[action, element, shape]`; `ACTION_RULES` declares which
 * elements/shapes each action permits, and `getValidTagsForStep()` derives the
 * valid option pool for any partial recipe from that table — so every path the
 * player can walk always resolves to a real (action, element, shape) combo.
 *
 * NOTE: skills are not implemented yet. The final "resolve this recipe into a
 * concrete skill" step is a placeholder (see SkillWeaveScene._finishWeave) —
 * this module only defines/validates the tag path that feeds it.
 */

/** Number of tags a completed recipe holds. */
export const RECIPE_LENGTH = 3;

/** Tag category buckets (purely descriptive — drives nothing today). */
export const TAG_CATEGORY = Object.freeze({
  ACTION: 'action',
  ELEMENT: 'element',
  SHAPE: 'shape',
});

/**
 * Tag catalog — keyed by tag id. Each entry:
 *   id       — stable identifier (used in recipes + the grammar table)
 *   label    — display text shown on the option plaque + recipe slot
 *   category — TAG_CATEGORY bucket
 *   icon     — AssetManager key for the small gold icon (null → placeholder)
 *
 * Icons: only a single placeholder tag icon ships today
 * (`skill_weave_tag_test`, the gold flame from the mock). Until per-tag art
 * exists, every tag falls back to it via getTagIcon(); the gold LABEL carries
 * the tag's identity. Wire real icon keys here as art lands.
 */
export const SKILL_WEAVE_TAGS = Object.freeze({
  // ── Elements (the match-3 colors + skull), themed as the mock's flat icons ──
  red:    { id: 'red',    label: 'Fire',    category: TAG_CATEGORY.ELEMENT, icon: null },
  blue:   { id: 'blue',   label: 'Water',   category: TAG_CATEGORY.ELEMENT, icon: null },
  green:  { id: 'green',  label: 'Leaf',    category: TAG_CATEGORY.ELEMENT, icon: null },
  yellow: { id: 'yellow', label: 'Sun',     category: TAG_CATEGORY.ELEMENT, icon: null },
  purple: { id: 'purple', label: 'Moon',    category: TAG_CATEGORY.ELEMENT, icon: null },
  skull:  { id: 'skull',  label: 'Skull',   category: TAG_CATEGORY.ELEMENT, icon: null },

  // ── Actions (the verb the skill performs) ──
  damage:  { id: 'damage',  label: 'Damage',  category: TAG_CATEGORY.ACTION, icon: null },
  armor:   { id: 'armor',   label: 'Armor',   category: TAG_CATEGORY.ACTION, icon: null },
  create:  { id: 'create',  label: 'Create',  category: TAG_CATEGORY.ACTION, icon: null },
  destroy: { id: 'destroy', label: 'Destroy', category: TAG_CATEGORY.ACTION, icon: null },
  convert: { id: 'convert', label: 'Convert', category: TAG_CATEGORY.ACTION, icon: null },
  gain:    { id: 'gain',    label: 'Gain',    category: TAG_CATEGORY.ACTION, icon: null },
  heal:    { id: 'heal',    label: 'Heal',    category: TAG_CATEGORY.ACTION, icon: null },

  // ── Shapes / targets (where the action lands) ──
  row:    { id: 'row',    label: 'Row',    category: TAG_CATEGORY.SHAPE, icon: null },
  column: { id: 'column', label: 'Column', category: TAG_CATEGORY.SHAPE, icon: null },
  area:   { id: 'area',   label: 'Area',   category: TAG_CATEGORY.SHAPE, icon: null },
  tile:   { id: 'tile',   label: 'Tile',   category: TAG_CATEGORY.SHAPE, icon: null },
  random: { id: 'random', label: 'Random', category: TAG_CATEGORY.SHAPE, icon: null },
});

/** Default tag-icon asset key (gold flame placeholder from the mock). */
export const DEFAULT_TAG_ICON = 'skill_weave_tag_test';

/**
 * Recipe grammar.
 *
 * A complete recipe is `[action, element, shape]`. Each action declares the
 * elements and shapes it accepts; the cross-product of those is the set of
 * valid complete recipes for that action. Step 0 offers the actions; step 1
 * offers the chosen action's elements; step 2 offers its shapes. Because the
 * pools are declared per-action, every selectable path is guaranteed to end on
 * a real combo — there are no dead ends.
 *
 * To extend: add/adjust an action's `elements`/`shapes`, or add a new action.
 */
const ACTION_RULES = Object.freeze({
  create:  { elements: ['red', 'blue', 'green', 'yellow', 'purple', 'skull'], shapes: ['row', 'column', 'area', 'tile', 'random'] },
  destroy: { elements: ['skull', 'red', 'blue', 'green', 'yellow', 'purple'], shapes: ['row', 'column', 'area', 'random'] },
  convert: { elements: ['red', 'blue', 'green', 'yellow', 'purple'],          shapes: ['area', 'tile', 'random'] },
  gain:    { elements: ['red', 'blue', 'green', 'yellow', 'purple'],          shapes: ['tile', 'random'] },
  damage:  { elements: ['red', 'skull', 'purple'],                            shapes: ['row', 'column', 'area', 'tile'] },
  armor:   { elements: ['blue', 'green'],                                     shapes: ['tile', 'random'] },
  heal:    { elements: ['green', 'purple'],                                   shapes: ['tile', 'random'] },
});

/** Ordered list of the action tags offered at step 0. */
const ACTIONS = Object.keys(ACTION_RULES);

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
 * The pool of valid tag ids for the NEXT step given the tags chosen so far.
 *
 * - 0 chosen → the action tags.
 * - 1 chosen → the chosen action's allowed elements.
 * - 2 chosen → the chosen action's allowed shapes.
 * - 3 chosen (recipe full) → [] (no further steps).
 *
 * @param {string[]} chosen — already-committed tag ids, in order
 * @returns {string[]} valid tag ids for the next slot (never mutated by caller)
 */
export function getValidTagsForStep(chosen) {
  const picks = Array.isArray(chosen) ? chosen : [];
  if (picks.length >= RECIPE_LENGTH) return [];

  if (picks.length === 0) return ACTIONS.slice();

  const rule = ACTION_RULES[picks[0]];
  if (!rule) return [];

  if (picks.length === 1) return rule.elements.slice();
  if (picks.length === 2) return rule.shapes.slice();
  return [];
}

/**
 * @param {string[]} chosen
 * @returns {boolean} true once the recipe holds RECIPE_LENGTH tags
 */
export function isRecipeComplete(chosen) {
  return Array.isArray(chosen) && chosen.length >= RECIPE_LENGTH;
}

/**
 * Pick up to `count` tag ids at random from a pool (no repeats). Used to show
 * only N of the valid tags per step. Pure Fisher–Yates on a copy.
 * @param {string[]} pool
 * @param {number} count
 * @returns {string[]}
 */
export function sampleTags(pool, count) {
  const arr = Array.isArray(pool) ? pool.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, count));
}
