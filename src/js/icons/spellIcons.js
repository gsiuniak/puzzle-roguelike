/**
 * spellIcons.js — cache + integration layer for procedural spell icons.
 *
 * Public surface:
 *   getSpellIcon({ keywords, spellId, runSeed, assetManager? })
 *     → { canvas, assetKey, recipe } — resolves, renders (once), caches.
 *   clearSpellIconCache()
 *     → drop all cached icons. Call at run boundaries (icons embed the run
 *       seed, so a previous run's icons are dead weight). Wired into
 *       MapScene.resetForNewRun().
 *
 * Caching: keyed by recipeKey(recipe) + ICON_PIPELINE_VERSION. The recipe
 * contains the run-derived seed, so caches are naturally per-run; the version
 * suffix invalidates stale entries whenever the compositor pipeline changes.
 *
 * AssetManager integration: when an assetManager is supplied, the rendered
 * canvas is also registered under a stable `spell_icon_<hash>` key (via
 * AssetManager.registerCanvas), so any UIImage/SkillButton can display the
 * icon through the normal asset-key path — no consumer special-casing.
 */

import { resolveRecipe, recipeKey, hashString } from './spellIconRecipe.js';
import { renderIcon, ICON_PIPELINE_VERSION, ICON_NATIVE_SIZE } from './spellIconCompositor.js';

/** @type {Map<string, {canvas: HTMLCanvasElement, assetKey: string, recipe: object}>} */
const _cache = new Map();

/**
 * Resolve + render (or fetch from cache) the icon for a spell.
 *
 * @param {object} opts
 * @param {string[]} opts.keywords — the spell's keyword ids (Skill Weave tag ids)
 * @param {string}   opts.spellId — stable spell identifier within the run
 * @param {string|number} opts.runSeed — the run seed (MapScene seed string)
 * @param {object}   [opts.assetManager] — when given, the canvas is registered
 *   under the returned assetKey so it's drawable via the normal asset path
 * @param {number}   [opts.size=ICON_NATIVE_SIZE] — native render size
 * @returns {{ canvas: HTMLCanvasElement, assetKey: string, recipe: object }}
 */
export function getSpellIcon({ keywords, spellId, runSeed, assetManager = null, size = ICON_NATIVE_SIZE }) {
  const recipe = resolveRecipe(keywords, spellId, runSeed);
  const key = `${recipeKey(recipe)}:${size}:v${ICON_PIPELINE_VERSION}`;

  let entry = _cache.get(key);
  if (!entry) {
    const canvas = renderIcon(recipe, size);
    const assetKey = `spell_icon_${hashString(key).toString(36)}`;
    entry = { canvas, assetKey, recipe };
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
