/**
 * AudioManager.js — Centralized audio system wrapping Howler.js.
 *
 * All game audio flows through this manager. Game code should never
 * call Howler/Howl directly. Uses Howler.js features for:
 *   - Looping music via native Howler loop support
 *   - Per-category volume control (master, music, sfx, ui, ambient)
 *   - Global mute/unmute
 *   - Overlapping SFX (multiple instances of same sound)
 *   - Fade-in / fade-out for music transitions
 *   - Graceful warning on missing/not-loaded sound keys
 *
 * Usage:
 *   import AudioManager from './audio/AudioManager.js';
 *   AudioManager.init(soundConfig);
 *   AudioManager.playMusic('battle_theme', { fadeIn: 800 });
 *   AudioManager.playSfx('sfx_match_3');
 *   AudioManager.setMasterVolume(0.8);
 */

import { AudioCategory } from './SoundConfig.js';

class _AudioManager {
  constructor() {
    /** @type {boolean} */
    this._initialized = false;

    /**
     * Map of sound key → Howl instance.
     * For music/ambient categories, one instance is reused.
     * For sfx/ui categories, each Howl supports multiple overlapping playbacks.
     * @type {Map<string, Howl>}
     */
    this._sounds = new Map();

    /**
     * Reference to the sound config registry (SoundConfig.js default export).
     * Set during init().
     * @type {object|null}
     */
    this._config = null;

    /**
     * Track the currently playing music key so we can:
     *   - Prevent restarting the same track
     *   - Fade out before switching
     * @type {string|null}
     */
    this._currentMusicKey = null;

    /**
     * The Howl instance of the currently playing music, for
     * direct volume/fade manipulation.
     * @type {Howl|null}
     */
    this._currentMusicHowl = null;

    /**
     * ID of the currently playing music instance within the Howl.
     * @type {number|null}
     */
    this._currentMusicId = null;

    // ── Volume state (0..1) ────────────────────────────
    this._masterVolume = 1.0;
    this._musicVolume = 0.3;
    this._sfxVolume = 1.0;
    this._uiVolume = 1.0;
    this._ambientVolume = 1.0;
    this._muted = false;
  }

  // ── Initialization ────────────────────────────────────

  /**
   * Initialize the audio system with a sound configuration.
   * Loads all sounds defined in the config.
   *
   * @param {object} config — SoundConfig default export
   */
  init(config) {
    if (this._initialized) {
      console.warn('[AudioManager] Already initialized.');
      return;
    }

    this._config = config;

    for (const [key, def] of Object.entries(config)) {
      this.loadSound(key, def);
    }

    this._initialized = true;
    console.log(`[AudioManager] Initialized with ${this._sounds.size} sounds.`);
  }

  // ── Sound Loading ─────────────────────────────────────

  /**
   * Load a single sound into the registry.
   * Gracefully warns if audio files are missing (404) — doesn't crash.
   *
   * @param {string} key    — sound key
   * @param {object} config — { src: string|string[], category: AudioCategory, options?: object }
   */
  loadSound(key, config) {
    if (this._sounds.has(key)) {
      console.warn(`[AudioManager] Sound key "${key}" already loaded. Skipping.`);
      return;
    }

    const { src, category, options = {} } = config;

    // Merge category-specific defaults with per-sound options
    const howlOptions = {
      src: Array.isArray(src) ? src : [src],
      volume: 0, // Start at 0; actual volume applied on play via _applyCategoryVolume
      preload: true,
      html5: false, // Use Web Audio API (default)
      ...options,
      // Ensure onloaderror doesn't throw; we warn gracefully
      onloaderror: (id, err) => {
        console.warn(`[AudioManager] Failed to load sound "${key}":`, err);
      },
    };

    try {
      const howl = new Howl(howlOptions);
      this._sounds.set(key, howl);
    } catch (err) {
      console.warn(`[AudioManager] Error creating Howl for "${key}":`, err);
    }
  }

  // ── Playback ──────────────────────────────────────────

  /**
   * Play a one-shot SFX sound. Supports overlapping instances.
   *
   * @param {string} key     — sound key
   * @param {object} [opts]  — { volume?: number, rate?: number, loop?: boolean }
   * @returns {number|null}  — Howl play ID, or null if not available
   */
  playSfx(key, opts = {}) {
    return this._play(key, AudioCategory.SFX, this._sfxVolume, opts);
  }

  /**
   * Play a UI sound (button hover/click, notifications).
   *
   * @param {string} key
   * @param {object} [opts]
   * @returns {number|null}
   */
  playUi(key, opts = {}) {
    return this._play(key, AudioCategory.UI, this._uiVolume, opts);
  }

  /**
   * Play a music track. Ensures no duplicate playback:
   *   - If the requested track is already playing, does nothing.
   *   - If a different track is playing, fades it out first.
   *
   * @param {string} key     — sound key
   * @param {object} [opts]  — { fadeIn?: number (ms), volume?: number }
   * @returns {number|null}
   */
  playMusic(key, opts = {}) {
    // If this music is already playing, skip
    if (this._currentMusicKey === key) {
      return this._currentMusicId;
    }

    // Stop any currently playing music with optional fade
    if (this._currentMusicHowl && this._currentMusicId !== null) {
      this._currentMusicHowl.stop();
      this._currentMusicHowl = null;
      this._currentMusicId = null;
      this._currentMusicKey = null;
    }

    const howl = this._sounds.get(key);
    if (!howl) {
      console.warn(`[AudioManager] Music key "${key}" not found.`);
      return null;
    }

    const volume = opts.volume !== undefined ? opts.volume : 1.0;
    const fadeIn = opts.fadeIn || 0;

    // Apply category + master volume
    const effectiveVolume = this._muted ? 0 : volume * this._musicVolume * this._masterVolume;

    const id = howl.play();
    if (id !== null && id !== undefined) {
      howl.loop(true, id);

      if (fadeIn > 0) {
        howl.volume(0, id);
        howl.fade(0, effectiveVolume, fadeIn, id);
      } else {
        howl.volume(effectiveVolume, id);
      }

      this._currentMusicKey = key;
      this._currentMusicHowl = howl;
      this._currentMusicId = id;
    }

    return id;
  }

  /**
   * Stop the currently playing music track.
   *
   * @param {number} [fadeOut] — fade-out duration in ms (0 = immediate)
   */
  stopMusic(fadeOut = 0) {
    if (!this._currentMusicHowl || this._currentMusicId === null) return;

    if (fadeOut > 0) {
      const howl = this._currentMusicHowl;
      const id = this._currentMusicId;
      const currentVol = howl.volume(id) || 0;

      howl.fade(currentVol, 0, fadeOut, id);
      // Stop after fade completes
      setTimeout(() => {
        howl.stop();
      }, fadeOut + 50);
    } else {
      this._currentMusicHowl.stop();
    }

    this._currentMusicKey = null;
    this._currentMusicHowl = null;
    this._currentMusicId = null;
  }

  /**
   * Fade the currently playing music to a target volume.
   *
   * @param {number} targetVolume — 0..1
   * @param {number} duration     — ms
   */
  fadeMusic(targetVolume, duration) {
    if (!this._currentMusicHowl || this._currentMusicId === null) return;

    const effectiveVolume = this._muted
      ? 0
      : targetVolume * this._musicVolume * this._masterVolume;

    this._currentMusicHowl.fade(
      this._currentMusicHowl.volume(this._currentMusicId) || 0,
      effectiveVolume,
      duration,
      this._currentMusicId
    );
  }

  /**
   * Play an ambient loop.
   *
   * @param {string} key
   * @param {object} [opts]
   * @returns {number|null}
   */
  playAmbient(key, opts = {}) {
    return this._play(key, AudioCategory.AMBIENT, this._ambientVolume, opts);
  }

  // ── Internal play helper ──────────────────────────────

  /**
   * @param {string} key
   * @param {AudioCategory} category
   * @param {number} categoryVolume — pre-mute volume for this category (0..1)
   * @param {object} opts
   * @returns {number|null}
   */
  _play(key, category, categoryVolume, opts = {}) {
    const howl = this._sounds.get(key);
    if (!howl) {
      console.warn(`[AudioManager] Sound key "${key}" not found (category: ${category}).`);
      return null;
    }

    const baseVolume = opts.volume !== undefined ? opts.volume : 1.0;
    const effectiveVolume = this._muted
      ? 0
      : baseVolume * categoryVolume * this._masterVolume;

    const id = howl.play();
    if (id !== null && id !== undefined) {
      howl.volume(effectiveVolume, id);

      if (opts.rate !== undefined) {
        howl.rate(opts.rate, id);
      }

      if (opts.loop !== undefined) {
        howl.loop(opts.loop, id);
      }
    }

    return id;
  }

  // ── Volume Control ────────────────────────────────────

  /**
   * Set master volume (affects all categories multiplicatively).
   * @param {number} v — 0..1
   */
  setMasterVolume(v) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    this._applyAllVolumes();
    if (!this._muted) {
      Howler.volume(this._masterVolume);
    }
  }

  /**
   * Set music category volume.
   * @param {number} v — 0..1
   */
  setMusicVolume(v) {
    this._musicVolume = Math.max(0, Math.min(1, v));
    this._applyCategoryVolume(AudioCategory.MUSIC, this._musicVolume);
  }

  /**
   * Set SFX category volume.
   * @param {number} v — 0..1
   */
  setSfxVolume(v) {
    this._sfxVolume = Math.max(0, Math.min(1, v));
    // SFX are one-shot, so volume applies to future plays.
    // Active SFX are not retroactively adjusted (acceptable).
  }

  /**
   * Set UI category volume.
   * @param {number} v — 0..1
   */
  setUiVolume(v) {
    this._uiVolume = Math.max(0, Math.min(1, v));
  }

  /**
   * Set ambient category volume.
   * @param {number} v — 0..1
   */
  setAmbientVolume(v) {
    this._ambientVolume = Math.max(0, Math.min(1, v));
    this._applyCategoryVolume(AudioCategory.AMBIENT, this._ambientVolume);
  }

  // ── Mute / Unmute ─────────────────────────────────────

  mute() {
    if (this._muted) return;
    this._muted = true;
    Howler.mute(true);
  }

  unmute() {
    if (!this._muted) return;
    this._muted = false;
    Howler.mute(false);
    // Restore volume levels
    this._applyAllVolumes();
  }

  /** @returns {boolean} */
  isMuted() {
    return this._muted;
  }

  // ── Internal: Apply Volumes ───────────────────────────

  /**
   * Recompute and apply the effective volume for the currently playing music
   * based on master, category, and mute state.
   */
  _applyCategoryVolume(category, categoryVolume) {
    const effectiveVolume = this._muted ? 0 : categoryVolume * this._masterVolume;

    if (category === AudioCategory.MUSIC && this._currentMusicHowl && this._currentMusicId !== null) {
      this._currentMusicHowl.volume(effectiveVolume, this._currentMusicId);
    }

    // For ambient, find and adjust all ambient sounds
    if (category === AudioCategory.AMBIENT && this._config) {
      for (const [key, def] of Object.entries(this._config)) {
        if (def.category === AudioCategory.AMBIENT) {
          const howl = this._sounds.get(key);
          if (howl) {
            howl.volume(effectiveVolume);
          }
        }
      }
    }
  }

  /**
   * Apply all category volume settings. Called after master/mute changes.
   */
  _applyAllVolumes() {
    if (this._currentMusicHowl && this._currentMusicId !== null) {
      this._applyCategoryVolume(AudioCategory.MUSIC, this._musicVolume);
    }
    this._applyCategoryVolume(AudioCategory.AMBIENT, this._ambientVolume);

    // Update Howler global volume
    if (!this._muted) {
      Howler.volume(this._masterVolume);
    }
  }

  // ── State Queries ─────────────────────────────────────

  /**
   * Check if a sound key has been loaded.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._sounds.has(key);
  }

  /**
   * Check if music is currently playing.
   * @returns {boolean}
   */
  isMusicPlaying() {
    return this._currentMusicKey !== null && this._currentMusicHowl !== null;
  }

  /**
   * Get the currently playing music key.
   * @returns {string|null}
   */
  getCurrentMusicKey() {
    return this._currentMusicKey;
  }
}

// ── Singleton export ────────────────────────────────────
const AudioManager = new _AudioManager();
export default AudioManager;
