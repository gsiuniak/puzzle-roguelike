/**
 * pngGlyphs.js — registry of authored PNG glyphs for the procedural spell-icon
 * pipeline (the "hybrid" path: painted grayscale luminance art drops into the
 * same glyph slot the procedural draw functions use; noise/bloom/LUT/rim stay
 * fully procedural — see spellIconCompositor.registerPngGlyph).
 *
 * This file is the single source of truth for WHICH glyph ids are PNG-backed:
 *   - spellIconRecipe.js imports PNG_GLYPH_IDS to extend GLYPH_IDS and to set
 *     `glyphSource: 'png'` on recipes that resolve to one of these ids.
 *   - main.js preloads the art through the AssetManager (the asset key→path
 *     entries live in main.js ASSET_MAP as usual) and calls
 *     registerPngGlyphsFromAssets() once loading completes.
 *   - src/icon-debug.html loads the same art standalone (no AssetManager) and
 *     registers it directly via registerPngGlyph.
 *
 * Art spec: white/gray luminance art on a TRANSPARENT background (the pipeline
 * reads it as a light source — dark pixels emit nothing). Alpha-tight crops are
 * fine: the compositor contain-fits the image into the icon's safe circle by
 * aspect (see PNG_GLYPH_FIT in spellIconCompositor.js), so no 512px-square
 * framing is required.
 *
 * To add a PNG glyph:
 *   1. Add an entry here (glyph id → AssetManager key).
 *   2. Add the asset key→path to main.js ASSET_MAP.
 *   3. Point a keyword at the glyph id in spellIconRecipe.KEYWORD_ICON_ROLES.
 *   4. (Optional) add it to the icon-debug.html preload list.
 */

import { registerPngGlyph } from './spellIconCompositor.js';

/**
 * Glyph id → AssetManager asset key. The current two entries are TEMP TEST ART
 * (assets/sprites/temp/weave_grayscale_*.png) proving out the hybrid path —
 * replace with final authored glyphs as they're produced.
 * @type {Readonly<Record<string, string>>}
 */
export const PNG_GLYPH_ASSET_KEYS = Object.freeze({
  flame_png:   'spell_glyph_flame_png',
  droplet_png: 'spell_glyph_droplet_png',
});

/** The PNG-backed glyph ids (consumed by spellIconRecipe.js). */
export const PNG_GLYPH_IDS = Object.freeze(Object.keys(PNG_GLYPH_ASSET_KEYS));

/**
 * Register every loaded PNG glyph image with the compositor. Call AFTER the
 * AssetManager has finished loading (main.js does this in loadAll().then) and
 * BEFORE any renderIcon that uses a PNG glyph — in practice the first icon
 * render happens deep into a run (SkillWeaveScene), long after boot loading.
 * A glyph whose asset failed to load is skipped with a warning; the compositor
 * then falls back to the procedural orb for that id, so nothing breaks.
 *
 * @param {import('../engine/AssetManager.js').default} assetManager
 * @returns {number} how many glyphs were registered
 */
export function registerPngGlyphsFromAssets(assetManager) {
  let registered = 0;
  for (const [glyphId, assetKey] of Object.entries(PNG_GLYPH_ASSET_KEYS)) {
    const image = assetManager.get(assetKey);
    if (image) {
      registerPngGlyph(glyphId, image);
      registered++;
    } else {
      console.warn(`pngGlyphs: asset "${assetKey}" for glyph "${glyphId}" not loaded — falling back to procedural.`);
    }
  }
  return registered;
}
