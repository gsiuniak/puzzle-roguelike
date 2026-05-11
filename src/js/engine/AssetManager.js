/**
 * AssetManager — loads and caches images by key.
 *
 * Usage:
 *   const am = new AssetManager();
 *   am.add('warrior', 'assets/sprites/.../portrait_warrior.png');
 *   am.add('placeholder', 'assets/sprites/placeholder.png');
 *   await am.loadAll();
 *   const img = am.get('warrior');
 *
 * Uses:
 *  - add(key, path) to register
 *  - loadAll() returns Promise that resolves when all load (or fail gracefully)
 *  - get(key) returns HTMLImageElement or null
 *  - isLoaded(key) returns boolean
 */
export default class AssetManager {
  constructor() {
    /** Map<key, { path, image }> */
    this._assets = new Map();

    /** Total registered count */
    this._count = 0;
    /** Successfully loaded count */
    this._loaded = 0;
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
   * Load all registered assets. Returns a promise that resolves when all
   * are loaded or failed. Does NOT reject on individual failures.
   * @returns {Promise<number>} number of successfully loaded assets
   */
  async loadAll() {
    const promises = [];

    for (const [key, entry] of this._assets.entries()) {
      promises.push(this._loadOne(key, entry));
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

  /**
   * Get a loaded image by key.
   * @param {string} key
   * @returns {HTMLImageElement|null}
   */
  get(key) {
    const entry = this._assets.get(key);
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
   * Check if an asset is loaded and available.
   * @param {string} key
   * @returns {boolean}
   */
  isLoaded(key) {
    const entry = this._assets.get(key);
    return !!(entry && entry.image);
  }

  /** Number of registered assets */
  get count() { return this._count; }

  /** Number of successfully loaded assets */
  get loaded() { return this._loaded; }
}
