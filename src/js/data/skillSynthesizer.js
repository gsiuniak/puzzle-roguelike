/**
 * skillSynthesizer.js — turns a woven tag bag into a concrete skill.
 *
 * ⚠ FOUNDATION STUB. Skills are not yet implemented in battle, and the full
 * synthesis rule engine (role assignment, special-combo rules like
 * red+convert+green, the "not every tag is used" logic, and premade-spell
 * overrides) is intentionally NOT built yet — see the decision to land the RNG
 * foundation first. What IS here:
 *
 *   - groups the chosen tags by category (action / element / shape / modifier /
 *     status), giving the future engine its raw material,
 *   - rolls each tag's HIDDEN VALUE from weaveConfig.TAG_VALUE_TABLES (e.g.
 *     `create` rolls 3–12) so the high-roll layer is exercised end-to-end now,
 *   - returns a structured, inspectable result (no real effects[] yet).
 *
 * When skills are wired into battle, replace `synthesize()`'s body with the rule
 * engine that emits a real skill object ({ name, icon, cost, effects[] }). The
 * inputs it receives (grouped tags + rolled values) are already shaped for that.
 */

import { rollTagValue } from './weaveConfig.js';
import { getTag, getTagLabel, TAG_CATEGORY } from './skillWeaveTags.js';

/**
 * Group an ordered list of tag ids by their catalog category.
 * @param {string[]} tagIds
 * @returns {Object<string, string[]>} category → tag ids (in pick order)
 */
function groupByCategory(tagIds) {
  const groups = {
    [TAG_CATEGORY.ACTION]: [],
    [TAG_CATEGORY.ELEMENT]: [],
    [TAG_CATEGORY.SHAPE]: [],
    [TAG_CATEGORY.MODIFIER]: [],
    [TAG_CATEGORY.STATUS]: [],
  };
  for (const id of tagIds) {
    const tag = getTag(id);
    if (tag && groups[tag.category]) groups[tag.category].push(id);
  }
  return groups;
}

/**
 * Synthesize a woven tag bag into a skill (STUB — see file header).
 *
 * @param {string[]} recipe — committed tag ids, in pick order
 * @returns {{
 *   recipe: string[],
 *   groups: Object<string, string[]>,
 *   rolledValues: Object<string, number>,
 *   usedTags: string[],
 *   unusedTags: string[],
 *   skill: object|null,
 *   summary: string,
 * }}
 */
export function synthesize(recipe) {
  const tagIds = Array.isArray(recipe) ? recipe.slice() : [];
  const groups = groupByCategory(tagIds);

  // Roll hidden values for any tag that carries a value table.
  const rolledValues = {};
  for (const id of tagIds) {
    const v = rollTagValue(id);
    if (v != null) rolledValues[id] = v;
  }

  // Placeholder "used vs unused" — the real engine will drop tags that can't be
  // applied (special rules). For now every tag is considered used.
  const usedTags = tagIds.slice();
  const unusedTags = [];

  const summary = tagIds
    .map((id) => (id in rolledValues ? `${getTagLabel(id)}(${rolledValues[id]})` : getTagLabel(id)))
    .join(' + ');

  console.log(`[SkillSynth] Bag woven: [${summary}] — synthesis is a placeholder (no skill emitted).`);

  return {
    recipe: tagIds,
    groups,
    rolledValues,
    usedTags,
    unusedTags,
    skill: null,        // future: a real { name, icon, cost, effects[] } object
    summary,
  };
}
