/**
 * videoCacheWarmer — fills the service worker's video cache (`game-videos`,
 * see the .mp4 runtimeCaching rule in vite.config.js) with FULL-BODY copies
 * of the game's cutscene videos so they play offline in the installed PWA.
 *
 * Why a plain fetch() and not the <video> elements the scenes already create:
 * <video> fetches carry Range headers and get 206 partial responses, which
 * the cache rule refuses to store (caching a partial body would corrupt
 * offline playback). A plain fetch() has no Range header, flows through the
 * same CacheFirst route, and stores the complete 200; the route's
 * rangeRequests plugin then slices that cached body into the 206s a <video>
 * element asks for when the network is gone.
 *
 * No-ops when there is no controlling service worker (raw serving, `vite
 * dev`, or the very first PWA visit before the SW claims the page — the next
 * boot warms instead). Downloads run sequentially so multi-MB videos never
 * compete with gameplay asset loading for bandwidth, and an already-cached
 * URL costs one cache lookup.
 */

/** @param {string[]} urls — video URLs relative to index.html */
export async function warmVideoCache(urls) {
  if (!urls || urls.length === 0) return;
  if (typeof caches === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) return;

    for (const url of urls) {
      try {
        if (await caches.match(url)) continue;
        if (navigator.onLine === false) return; // offline — warm next boot
        await fetch(url, { credentials: 'same-origin' });
      } catch (e) {
        // Network failure mid-warm — leave the rest for the next online boot.
      }
    }
  } catch (e) {
    // Cache/SW APIs unavailable (private mode etc.) — nothing to warm.
  }
}
