/**
 * spellIcons.js — cache + integration layer for composited spell icons.
 *
 * Public surface:
 *   getSpellIcon({ keywords, cost, spellId, assetManager? })
 *     → { canvas, assetKey, plan } — resolves the layer plan, renders (once),
 *       caches by the resolved-sprite signature, and (with an assetManager)
 *       registers the canvas under a stable `spell_icon_<hash>` key so any
 *       UIImage/SkillButton can draw it through the normal asset-key path.
 *   clearSpellIconCache()
 *     → drop all cached icons. Wired into MapScene.resetForNewRun().
 *
 * Caching: keyed by the plan signature (the resolved base/effect/border sprite
 * keys) + size + ICON_PIPELINE_VERSION. Two spells whose icons composite from
 * the same authored layers naturally share one cached canvas. Icons no longer
 * embed the run seed (the art is authored, not procedural), so a given spell
 * always produces the same icon — but clearing per run keeps memory bounded.
 */

import { resolveIconPlan, hashString } from './spellIconRecipe.js';
import { renderIcon, ICON_PIPELINE_VERSION, ICON_NATIVE_SIZE } from './spellIconCompositor.js';

/** @type {Map<string, {canvas: HTMLCanvasElement, assetKey: string, plan: object}>} */
const _cache = new Map();

/**
 * Resolve + render (or fetch from cache) the icon for a spell.
 *
 * @param {object} opts
 * @param {string[]} opts.keywords — the spell's keyword ids (Skill Weave tag ids)
 * @param {object}   [opts.cost] — the spell's mana cost `{ color: amount }`
 * @param {string}   opts.spellId — stable spell identifier
 * @param {object}   [opts.assetManager] — supplies sheet sprites; when given the
 *   canvas is registered under the returned assetKey so it's drawable normally
 * @param {number}   [opts.size=ICON_NATIVE_SIZE] — native render size
 * @returns {{ canvas: HTMLCanvasElement, assetKey: string, plan: object }}
 */
export function getSpellIcon({ keywords, cost = null, spellId, assetManager = null, size = ICON_NATIVE_SIZE }) {
  const plan = resolveIconPlan(keywords, cost, spellId, assetManager);
  const key = `${plan.signature}:${size}:v${ICON_PIPELINE_VERSION}`;

  let entry = _cache.get(key);
  if (!entry) {
    const canvas = renderIcon(plan, assetManager, size);
    const assetKey = `spell_icon_${hashString(key).toString(36)}`;
    entry = { canvas, assetKey, plan };
    _cache.set(key, entry);
  }

  if (assetManager && typeof assetManager.registerCanvas === 'function') {
    assetManager.registerCanvas(entry.assetKey, entry.canvas);
  }
  return entry;
}

/** Drop every cached icon (call when a run ends/starts). */
export function clearSpellIconCache() {
  _cache.clear();
}
