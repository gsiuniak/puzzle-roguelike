/**
 * videoManifest — the runtime-playable cutscene/splash .mp4 URLs, collected
 * from the data catalogs that actually reference them (so a new hero splash
 * or boss intro is picked up automatically, with no list to remember).
 *
 * Consumed by the boot sequence (main.js) to warm the service worker's
 * `game-videos` cache so every video also plays fully OFFLINE in the
 * installed PWA — see engine/videoCacheWarmer.js and the .mp4 runtimeCaching
 * rule in vite.config.js.
 *
 * Deliberately NOT included: SkillWeaveScene's BACKGROUND_VIDEO_SRC — the
 * feature is flagged off (USE_BACKGROUND_VIDEO = false); add it here if that
 * flag is ever turned on.
 */

import characterSelectDefinitions from './characterSelectDefinitions.js';
import { ALL_ENEMIES } from './enemies/index.js';

/**
 * Title-screen movies (played by TitleScreen — the intro that settles into the
 * static title image, and the button-press transition into character select).
 * Defined here (not in the scene) so the cache warmer and the scene share one
 * source of truth.
 */
export const TITLE_SCREEN_VIDEOS = {
  intro: 'assets/sprites/title/title_screen_movie_intro.mp4',
  transition: 'assets/sprites/title/title_screen_movie_transition.mp4',
};

/**
 * Every video URL the game can play at runtime, deduplicated.
 * @returns {string[]} URLs relative to index.html
 */
export function collectRuntimeVideoUrls() {
  const urls = new Set();
  // Title movies first — they play before anything else after a cold install.
  urls.add(TITLE_SCREEN_VIDEOS.intro);
  urls.add(TITLE_SCREEN_VIDEOS.transition);
  for (const def of characterSelectDefinitions) {
    if (def && def.splashVideo) urls.add(def.splashVideo);
  }
  for (const enemy of ALL_ENEMIES) {
    if (enemy && enemy.introVideo) urls.add(enemy.introVideo);
    if (enemy && enemy.portraitVideo) urls.add(enemy.portraitVideo);
  }
  return [...urls];
}
