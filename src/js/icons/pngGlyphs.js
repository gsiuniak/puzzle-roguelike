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
 * EVERY sheet sprite registers as a glyph id `<tagId>_png` — the recipe layer
 * system uses them in three placements (see spellIconRecipe.resolveRecipe):
 * form art as the PRIMARY glyph, element art as the primary (form-less spells)
 * or as the dim BACKDROP layer, and losing-form/status art as small FLANK
 * badges. The compositor treats all three identically (luminance art).
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

/** Every weave tag with a sprite in the weave-grayscale sheet (all but `random`). */
const SHEET_TAGS = Object.freeze([
  // elements
  'red', 'blue', 'green', 'yellow', 'purple', 'skull',
  // actions (forms)
  'damage', 'armor', 'create', 'destroy', 'convert', 'gain', 'heal', 'drain', 'attack', 'explode',
  // shapes
  'row', 'column', 'area', 'tile',
  // modifiers
  'extra_turn', 'wild', 'lock',
  // statuses
  'silence', 'cripple', 'enfeeble', 'brittle', 'intangible', 'berserk', 'bleed', 'frozen', 'barrier',
]);

/**
 * Glyph id (`<tagId>_png`) → AssetManager asset key (= the sliced sprite's
 * name in the weave-grayscale sheet). One entry per sheet sprite.
 * @type {Readonly<Record<string, string>>}
 */
export const PNG_GLYPH_ASSET_KEYS = Object.freeze(
  Object.fromEntries(SHEET_TAGS.map((t) => [`${t}_png`, `weave_grayscale_${t}`])),
);

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
