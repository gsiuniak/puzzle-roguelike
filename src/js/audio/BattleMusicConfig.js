/**
 * BattleMusicConfig.js — Persistent battle music behavior configuration.
 *
 * Controls whether normal battle music persists across scenes
 * (battle → rewards → map → next battle) or stops/restarts between scenes.
 *
 * Toggle ACTIVE_MUSIC_MODE to switch between old and new behavior.
 * When testing, simply change ACTIVE_MUSIC_MODE and reload.
 *
 * Usage elsewhere:
 *   import { ENABLE_PERSISTENT_BATTLE_MUSIC, DEFAULT_BATTLE_MUSIC_KEY } from './BattleMusicConfig.js';
 */

// ═══════════════════════════════════════════════════════════
// Music behavior mode
// ═══════════════════════════════════════════════════════════

/** @readonly @enum {string} */
export const MUSIC_MODE = {
  /** Old behavior: music stops on GAME_OVER, restarts fresh each battle (default original) */
  STOP_BETWEEN_SCENES: 'stop_between_scenes',
  /** New behavior: normal battle music persists quietly through rewards/map, rises back on next battle */
  PERSIST_DEFAULT_BATTLE_MUSIC: 'persist_default_battle_music',
};

/**
 * Active music behavior mode.
 * Change this to MUSIC_MODE.STOP_BETWEEN_SCENES to revert to the original behavior.
 * @type {string}
 */
export const ACTIVE_MUSIC_MODE = MUSIC_MODE.PERSIST_DEFAULT_BATTLE_MUSIC;

/** Convenience flag — true when persistent mode is active */
export const ENABLE_PERSISTENT_BATTLE_MUSIC =
  ACTIVE_MUSIC_MODE === MUSIC_MODE.PERSIST_DEFAULT_BATTLE_MUSIC;

// ═══════════════════════════════════════════════════════════
// Volume constants (0..1)
// ═══════════════════════════════════════════════════════════

/** Full volume during active battle */
export const NORMAL_BATTLE_MUSIC_VOLUME = 1.0;

/** Reduced volume during rewards overlay and map scene */
export const BACKGROUND_BATTLE_MUSIC_VOLUME = 0.15;

/** Duration for music fades in milliseconds (quick, natural track switches) */
export const MUSIC_FADE_DURATION = 400;

/**
 * Fade duration (ms) for the post-battle hand-off when a non-default battle
 * track (e.g. the Act 1 elite theme) ends: the special track slowly fades out
 * and the normal battle music fades back in underneath. Longer than the normal
 * quick switch so the elite outro feels deliberate.
 */
export const POST_BATTLE_TRACK_HANDOFF_FADE = 1500;

// ═══════════════════════════════════════════════════════════
// Default track key
// ═══════════════════════════════════════════════════════════

/**
 * SoundConfig key for the default/normal battle music track.
 * Used when no enemy-specific music is defined.
 */
export const DEFAULT_BATTLE_MUSIC_KEY = 'battle_theme';
