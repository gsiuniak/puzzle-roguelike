/**
 * pngGlyphs.js — registry of authored PNG glyphs for the procedural spell-icon
 * pipeline (the "hybrid" path: painted grayscale luminance art drops into the
 * same glyph slot the procedural draw functions use; noise/bloom/LUT/rim stay
 * fully procedural — see spellIconCompositor.registerPngGlyph).
 *
 * The art lives in the `ui_spritesheet_weave_grayscale` spritesheet (one
 * `weave_grayscale_<tagId>` sprite per weave tag — registered in main.js
 * SPRITESHEET_MAP). AssetManager slices each sprite into its own canvas under
 * the sprite name, and a canvas is a drop-in for an Image in the compositor.
 *
 * This file is the single source of truth for WHICH glyph ids are PNG-backed:
 *   - spellIconRecipe.js imports PNG_GLYPH_IDS to extend GLYPH_IDS and to set
 *     `glyphSource: 'png'` on recipes that resolve to one of these ids.
 *   - main.js calls registerPngGlyphsFromAssets() once loading completes.
 *   - src/icon-debug.html loads the same sheet through its own AssetManager
 *     instance and calls the same helper.
 *
 * Only FORM keywords get glyph entries — the glyph slot is the form slot.
 * Element art in the sheet (red/blue/…/skull) is unused here (elements color
 * the icon via palettes), as are shape/modifier/status sprites (those map to
 * overlays); they're available for future overlay/palette work.
 *
 * Art spec: white/gray luminance art on a TRANSPARENT background (the pipeline
 * reads it as a light source — dark pixels emit nothing). Alpha-tight crops are
 * fine: the compositor contain-fits the image into the icon's safe circle by
 * aspect (see PNG_GLYPH_FIT in spellIconCompositor.js).
 *
 * To add a PNG glyph:
 *   1. Add the sprite to the ui_spritesheet_weave_grayscale sheet.
 *   2. Add an entry here (glyph id → sprite name).
 *   3. Point a keyword at the glyph id in spellIconRecipe.KEYWORD_ICON_ROLES.
 */

import { registerPngGlyph } from './spellIconCompositor.js';

/**
 * Glyph id → AssetManager asset key (= the sliced sprite's name in the
 * weave-grayscale sheet). One entry per FORM keyword in KEYWORD_ICON_ROLES.
 * @type {Readonly<Record<string, string>>}
 */
export const PNG_GLYPH_ASSET_KEYS = Object.freeze({
  damage_png:  'weave_grayscale_damage',
  armor_png:   'weave_grayscale_armor',
  attack_png:  'weave_grayscale_attack',
  convert_png: 'weave_grayscale_convert',
  destroy_png: 'weave_grayscale_destroy',
  create_png:  'weave_grayscale_create',
  heal_png:    'weave_grayscale_heal',
  gain_png:    'weave_grayscale_gain',
  drain_png:   'weave_grayscale_drain',
  explode_png: 'weave_grayscale_explode',
  barrier_png: 'weave_grayscale_barrier',
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
