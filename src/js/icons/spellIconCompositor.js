/**
 * spellIconCompositor.js — assembles a spell icon from AUTHORED spritesheet
 * layers (no procedural drawing). Canvas 2D only.
 *
 * The icon is a stack of pre-painted sprites composited with Photoshop-style
 * blend modes so the foreground effect reads as magically energized by the
 * colored base rather than pasted on:
 *
 *   1. base background      — colored circular mana orb (weave_base sheet), full size, source-over
 *   2. minor effect (opt.)  — secondary effect sprite, contained + centered, MULTIPLY (embeds into base)
 *   3. major effect         — primary effect sprite, contained + centered, COLOR-DODGE (the readable subject)
 *   4. border cap           — icon_border_2 (weave_generic sheet), full size, source-over (never blended)
 *
 * The layer SELECTION (which base color, which effect sprites) is decided in
 * spellIconRecipe.js → resolveIconPlan(); this module only draws a resolved
 * plan. Sprites are fetched by key from the AssetManager at render time (the
 * weave_base / weave_generic sheets are sliced into per-sprite canvases there).
 *
 * Output: a transparent S×S canvas (the base orb art is circular on transparent
 * ground, so the corners stay clear). Rendered once and cached — see
 * spellIcons.js. No randomness anywhere: the same plan always yields the same
 * pixels.
 */

/** Bump when the layer stack / blend order changes (invalidates caches). */
export const ICON_PIPELINE_VERSION = 3; // v3: authored-spritesheet blend compositing

/** Native render size. Icons are drawn once at this size and scaled at draw time. */
export const ICON_NATIVE_SIZE = 512;

// Fraction of the icon size an effect sprite's longer side is scaled to, so it
// sits cleanly inside the base orb without crowding the rim. The minor layer is
// a touch larger (it reads as a backdrop behind the major subject).
const MINOR_FIT = 0.68;
const MAJOR_FIT = 0.60;

/**
 * Draw an image contained (aspect-preserved) within `fit·S`, centered.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {number} S — icon size
 * @param {number} fit — fraction of S the longer side fills
 */
function drawContained(ctx, img, S, fit) {
  const iw = img.width || S;
  const ih = img.height || S;
  const sc = (fit * S) / Math.max(iw, ih);
  const w = iw * sc;
  const h = ih * sc;
  ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
}

/**
 * Render a resolved icon plan into a new canvas.
 *
 * @param {object} plan — from spellIconRecipe.resolveIconPlan()
 * @param {string}        plan.baseKey   — base orb asset key (full-size background)
 * @param {string|null}   plan.minorKey  — optional secondary effect asset key (multiply)
 * @param {string}        plan.majorKey  — primary effect asset key (color-dodge)
 * @param {string|null}   plan.borderKey — border cap asset key (source-over, never blended)
 * @param {object} assetManager — supplies sliced sheet sprites via get(key)
 * @param {number} [size=ICON_NATIVE_SIZE]
 * @returns {HTMLCanvasElement}
 */
export function renderIcon(plan, assetManager, size = ICON_NATIVE_SIZE) {
  const S = size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sprite = (key) => (key && assetManager ? assetManager.get(key) : null);

  // 1. base background — full size, normal blend.
  const base = sprite(plan.baseKey);
  if (base) ctx.drawImage(base, 0, 0, S, S);

  // 2. minor effect (optional) — MULTIPLY so it sinks into the base.
  const minor = plan.minorKey ? sprite(plan.minorKey) : null;
  if (minor) {
    ctx.globalCompositeOperation = 'multiply';
    drawContained(ctx, minor, S, MINOR_FIT);
  }

  // 3. major effect — COLOR-DODGE so it glows, energized by the base color.
  const major = sprite(plan.majorKey);
  if (major) {
    ctx.globalCompositeOperation = 'color-dodge';
    drawContained(ctx, major, S, MAJOR_FIT);
  }

  // 4. border cap — reset to normal so the frame is never blended.
  ctx.globalCompositeOperation = 'source-over';
  const border = plan.borderKey ? sprite(plan.borderKey) : null;
  if (border) ctx.drawImage(border, 0, 0, S, S);

  return cv;
}
