/**
 * AssetManager — loads and caches images by key. Also supports pre-scaled
 * offscreen canvases to avoid repeated drawImage scaling every frame.
 *
 * Usage:
 *   const am = new AssetManager();
 *   am.add('warrior', 'assets/sprites/.../portrait_warrior.png');
 *   am.add('placeholder', 'assets/sprites/placeholder.png');
 *   await am.loadAll();
 *   const img = am.get('warrior');
 *   // Pre-scaled offscreen canvas:
 *   const scaled = am.getScaled('warrior', 48, 48);
 *
 * Uses:
 *  - add(key, path) to register
 *  - addSpriteSheet(sheetKey, imagePath, jsonPath) to register a packed sheet;
 *    each named sprite inside it becomes individually retrievable by its name
 *  - loadAll() returns Promise that resolves when all load (or fail gracefully)
 *  - get(key) returns HTMLImageElement | HTMLCanvasElement or null
 *  - getScaled(key, w, h) returns HTMLCanvasElement (offscreen, pre-scaled) or null
 *  - isLoaded(key) returns boolean
 *
 * Spritesheets:
 *  A spritesheet is one packed PNG plus a JSON sidecar shaped
 *  `{ meta: {...}, sprites: { <name>: { x, y, w, h, ... }, ... } }`. On load the
 *  sheet image is fetched, the JSON parsed, and every sprite is sliced into its
 *  OWN offscreen canvas registered under its sprite name. Because a canvas is a
 *  drop-in for an Image in `ctx.drawImage` (and exposes `.width`/`.height`),
 *  sliced sprites flow through `get()` / `getScaled()` / `UIImage` exactly like
 *  standalone images — no special-casing needed in any consumer.
 */
export default class AssetManager {
  constructor() {
    /** Map<key, { path, image }> — image may be an HTMLImageElement OR a sliced sprite canvas */
    this._assets = new Map();

    /** Map<sheetKey, { imagePath, jsonPath }> — registered spritesheets */
    this._sheets = new Map();

    /**
     * Map<aliasKey, targetKey> — alias keys resolve to another asset's image at
     * lookup time (lazy), so a key can point at a spritesheet sprite that only
     * exists after the sheet loads. Resolution follows chains (cycle-guarded).
     * @type {Map<string, string>}
     */
    this._aliases = new Map();

    /** Total registered count */
    this._count = 0;
    /** Successfully loaded count */
    this._loaded = 0;

    /**
     * Cache of pre-scaled offscreen canvases.
     * Key format: "assetKey:w:h"
     * @type {Map<string, HTMLCanvasElement>}
     */
    this._scaledCache = new Map();
  }

  /**
   * Register an asset for loading.
   * @param {string} key  - logical name
   * @param {string} path - file path relative to the page
   */
  add(key, path) {
    if (this._assets.has(key)) {
      console.warn(`AssetManager: key "${key}" already registered, overwriting.`);
    }
    this._assets.set(key, { path, image: null });
    this._count++;
  }

  /**
   * Register a spritesheet for loading. The sheet image is loaded and its JSON
   * sidecar parsed; once both arrive, every sprite named in the JSON is sliced
   * into its own offscreen canvas and registered under its sprite name, so it
   * can later be retrieved with `get(spriteName)` like any standalone image.
   *
   * Counts as ONE unit of load progress — the sliced sprites are free
   * byproducts of the single sheet load and don't inflate the progress total.
   *
   * @param {string} sheetKey  - logical name for the full sheet image
   * @param {string} imagePath - path to the packed sheet PNG
   * @param {string} jsonPath  - path to the sheet's JSON sidecar
   * @param {object} [opts]
   * @param {boolean} [opts.trim=false] - when true, each sliced sprite is cropped
   *   to the bounding box of its non-transparent pixels. Use for ICON sheets
   *   whose glyphs sit at inconsistent sizes/offsets inside uniform cells, so
   *   every icon ends up tightly framed (consistent visible size + centered).
   *   Leave false for sheets where the cell padding is meaningful.
   * @param {boolean} [opts.slice=true] - when false, NO per-sprite canvases are
   *   created; only the full sheet is registered under `sheetKey`. Use for
   *   sheets consumed whole (e.g. the attack-animation sheets, which
   *   SpriteSheetAnimation blits directly from the full image because the
   *   slicer drops the per-frame trim offsets) — slicing those would allocate
   *   dozens of large canvases that are never read.
   */
  addSpriteSheet(sheetKey, imagePath, jsonPath, opts = {}) {
    if (this._sheets.has(sheetKey)) {
      console.warn(`AssetManager: spritesheet "${sheetKey}" already registered, overwriting.`);
    } else {
      this._count++;
    }
    this._sheets.set(sheetKey, { imagePath, jsonPath, trim: !!opts.trim, slice: opts.slice !== false });
  }

  /**
   * Register `aliasKey` as a lazy alias for `targetKey`. Looking up the alias
   * (via get/getScaled/isLoaded) resolves to whatever `targetKey` holds at the
   * time — including a spritesheet sprite that loads later. Lets existing asset
   * keys be re-pointed at packed sprites without touching consumers.
   * @param {string} aliasKey
   * @param {string} targetKey
   */
  alias(aliasKey, targetKey) {
    this._aliases.set(aliasKey, targetKey);
  }

  /** Resolve a key through the alias chain to the first real (or unaliased) key. */
  _resolveKey(key) {
    let k = key;
    const seen = new Set();
    while (!this._assets.has(k) && this._aliases.has(k) && !seen.has(k)) {
      seen.add(k);
      k = this._aliases.get(k);
    }
    return k;
  }

  /**
   * Load all registered assets (standalone images + spritesheets). Returns a
   * promise that resolves when all are loaded or failed. Does NOT reject on
   * individual failures.
   * @returns {Promise<number>} number of successfully loaded units
   */
  async loadAll() {
    const promises = [];

    for (const [key, entry] of this._assets.entries()) {
      promises.push(this._loadOne(key, entry));
    }

    for (const [key, entry] of this._sheets.entries()) {
      promises.push(this._loadSheet(key, entry));
    }

    await Promise.allSettled(promises);
    return this._loaded;
  }

  async _loadOne(key, entry) {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        entry.image = img;
        this._loaded++;
        console.log(`AssetManager: loaded "${key}" (${img.width}x${img.height})`);
        resolve();
      };

      img.onerror = () => {
        console.warn(`AssetManager: failed to load "${key}" from "${entry.path}"`);
        // Keep image null — caller will get placeholder fallback
        resolve();
      };

      img.src = entry.path;
    });
  }

  /** Load a single image, resolving to the element or null (never rejects). */
  _loadImage(path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = path;
    });
  }

  /**
   * Load a spritesheet: fetch the image + JSON in parallel, then slice every
   * sprite into its own offscreen canvas registered under its sprite name.
   * Always resolves (counts as one load unit even on failure).
   */
  async _loadSheet(sheetKey, entry) {
    try {
      const [img, data] = await Promise.all([
        this._loadImage(entry.imagePath),
        fetch(entry.jsonPath).then((r) => r.json()),
      ]);

      if (!img) {
        console.warn(`AssetManager: spritesheet image failed to load "${entry.imagePath}"`);
        return;
      }

      // Make the full sheet retrievable under its own key too.
      this._assets.set(sheetKey, { path: entry.imagePath, image: img });

      // slice:false sheets are consumed whole (SpriteSheetAnimation) — skip
      // allocating a canvas per sprite that nothing would ever read.
      if (entry.slice === false) {
        console.log(`AssetManager: loaded spritesheet "${sheetKey}" (unsliced)`);
        return;
      }

      const sprites = (data && data.sprites) || {};
      let sliced = 0;
      for (const [name, frame] of Object.entries(sprites)) {
        const canvas = this._sliceSprite(img, frame, entry.trim);
        if (canvas) {
          this._assets.set(name, { path: `${entry.imagePath}#${name}`, image: canvas });
          sliced++;
        }
      }
      console.log(`AssetManager: loaded spritesheet "${sheetKey}" (${sliced} sprites)`);
    } catch (err) {
      console.warn(`AssetManager: failed to load spritesheet "${sheetKey}":`, err);
    } finally {
      this._loaded++;
    }
  }

  /**
   * Copy one sprite's frame (`{ x, y, w, h }`) out of the sheet into a canvas.
   * When `trim` is true the result is cropped to its non-transparent bounds.
   */
  _sliceSprite(sheetImg, frame, trim = false) {
    const { x = 0, y = 0, w = 0, h = 0 } = frame || {};
    if (w <= 0 || h <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', trim ? { willReadFrequently: true } : undefined);
    ctx.drawImage(sheetImg, x, y, w, h, 0, 0, w, h);
    if (!trim) return canvas;
    return this._trimTransparent(canvas) || canvas;
  }

  /**
   * Crop a canvas to the bounding box of its non-transparent pixels. Returns a
   * NEW tightly-cropped canvas, the same canvas if nothing to trim, or null if
   * fully transparent / pixel access is blocked (e.g. cross-origin taint).
   */
  _trimTransparent(src) {
    const w = src.width, h = src.height;
    let data;
    try {
      data = src.getContext('2d').getImageData(0, 0, w, h).data;
    } catch (e) {
      return null; // tainted canvas — fall back to the untrimmed slice
    }
    const ALPHA_FLOOR = 8; // ignore faint glow halo / compression fringe
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > ALPHA_FLOOR) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;          // fully transparent
    const tw = maxX - minX + 1, th = maxY - minY + 1;
    if (tw === w && th === h) return src;                 // nothing to crop
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    out.getContext('2d').drawImage(src, minX, minY, tw, th, 0, 0, tw, th);
    return out;
  }

  /**
   * Register a runtime-generated canvas under an asset key (e.g. procedural
   * spell icons). Like sliced spritesheet sprites, the canvas then flows
   * through get()/getScaled()/UIImage exactly like a loaded image. Does NOT
   * count toward load progress (nothing loads).
   * @param {string} key
   * @param {HTMLCanvasElement} canvas
   */
  registerCanvas(key, canvas) {
    this._assets.set(key, { path: `generated://${key}`, image: canvas });
  }

  /**
   * Get a loaded image by key.
   * @param {string} key
   * @returns {HTMLImageElement|null}
   */
  get(key) {
    const entry = this._assets.get(this._resolveKey(key));
    if (!entry) {
      // Not registered — log once and return null
      if (!this._warnedMissing) this._warnedMissing = new Set();
      if (!this._warnedMissing.has(key)) {
        console.warn(`AssetManager: key "${key}" not registered. Returning null.`);
        this._warnedMissing.add(key);
      }
      return null;
    }
    return entry.image; // may be null if still loading or failed
  }

  /**
   * Get a pre-scaled offscreen canvas for an asset.
   * Avoids repeatedly scaling the same image every frame in drawImage.
   *
   * @param {string} key - asset key
   * @param {number} w   - target width (integer)
   * @param {number} h   - target height (integer)
   * @returns {HTMLCanvasElement|null}
   */
  getScaled(key, w, h) {
    const cacheKey = `${key}:${w}:${h}`;
    if (this._scaledCache.has(cacheKey)) {
      return this._scaledCache.get(cacheKey);
    }

    const img = this.get(key);
    if (!img) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);

    this._scaledCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Clear the scaled image cache (e.g. when the DPR changes and
   * all pre-scaled sizes need recalculation).
   */
  clearScaledCache() {
    this._scaledCache.clear();
  }

  /**
   * Check if an asset is loaded and available.
   * @param {string} key
   * @returns {boolean}
   */
  isLoaded(key) {
    const entry = this._assets.get(this._resolveKey(key));
    return !!(entry && entry.image);
  }

  /** Number of registered assets */
  get count() { return this._count; }

  /** Number of successfully loaded (or failed) assets */
  get loaded() { return this._loaded; }

  /**
   * Loading progress in the range [0, 1]. Increments as each asset finishes
   * (success OR failure — both resolve `_loadOne`). Returns 1 when nothing is
   * registered so a poller never stalls. Safe to poll every frame (e.g. by a
   * loading scene driving a progress bar).
   * @returns {number}
   */
  get progress() {
    if (this._count === 0) return 1;
    return Math.min(1, this._loaded / this._count);
  }
}
