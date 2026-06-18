import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite build for the gems match-3 roguelike.
 *
 * This is an OPTIONAL build layer — it does NOT change how the game is served
 * raw. The app still runs by serving the project and opening `src/index.html`
 * with native ES modules + relative asset paths (no build step). Vite only adds:
 *   - `npm run build`   → a minified, PWA-enabled `dist/` for distribution
 *   - `npm run dev`     → an optional HMR dev server (serves `src/` at /)
 *   - `npm run preview` → serve the built `dist/` to test the production output
 *
 * Design notes that keep the raw-serve behavior intact:
 *   - root = 'src'  → builds the SAME src/index.html, untouched.
 *   - base = './'   → relative URLs, so the build works at a domain root AND
 *                     under a subpath (e.g. itch.io HTML5 hosting).
 *   - Game assets are referenced by STRING paths in JS (ASSET_MAP) and runtime
 *     fetch() (the spritesheet JSON sidecars), not by Vite imports — so they are
 *     copied to dist/assets VERBATIM (see copyGameAssets) and every runtime path
 *     ('assets/…') resolves identically to the raw-served app.
 *   - Vite's own hashed JS/CSS go in `bundle/` (assetsDir) so they never collide
 *     with the game's copied `assets/` tree.
 */

/**
 * Copy verbatim trees that the app references by raw path (not Vite imports) so
 * they land at the same relative location they live at during raw serving:
 *   - src/assets → dist/assets : all game art/audio/fonts/sheet JSON (loaded via
 *     ASSET_MAP string paths + runtime fetch()).
 *   - src/js/lib → dist/js/lib : Howler is loaded as a CLASSIC (non-module)
 *     `<script src="js/lib/howler.js">`; copying it guarantees that path resolves
 *     in the build whether or not Vite rewrites the tag (harmless dup if it does).
 */
function copyGameAssets() {
  return {
    name: 'copy-game-assets',
    apply: 'build',
    writeBundle() {
      fs.cpSync(path.resolve(ROOT, 'src/assets'), path.resolve(ROOT, 'dist/assets'), { recursive: true });
      fs.cpSync(path.resolve(ROOT, 'src/js/lib'), path.resolve(ROOT, 'dist/js/lib'), { recursive: true });
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  // We copy src/assets ourselves (verbatim); disable Vite's default public dir.
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'bundle', // keep hashed JS/CSS out of the game's assets/ tree
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    copyGameAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Puzzle Rogue',
        short_name: 'Puzzle Rogue',
        description: 'Match-3 Puzzle Roguelike',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: './',
        scope: './',
        // Square icons (192/512). JPEG is accepted by the manifest; the 512 also
        // serves as the maskable icon (the emblem is full-bleed + opaque).
        icons: [
          { src: 'assets/icons/icon-192.jpg', sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
          { src: 'assets/icons/icon-512.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
          { src: 'assets/icons/icon-512.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the small app shell; the heavy game media is runtime-cached
        // on first use (below) so the install isn't a multi-hundred-MB download.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Take control + drop the old precache as soon as a new deploy's SW
        // installs, so a returning device isn't stuck on an old app shell.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          // Game media uses StaleWhileRevalidate (NOT CacheFirst): the cached copy
          // is served instantly, but the SW ALSO re-fetches in the background so a
          // CHANGED or previously-BROKEN asset self-heals on the next visit. Game
          // assets live at STABLE URLs (assets/…/foo.png — no content hash), so
          // CacheFirst would otherwise pin a stale/broken copy for up to 30 days.
          // Only real 200s are cached (dropping status 0 avoids persisting a
          // partial/opaque/broken response and then serving it forever).
          //
          // The SFX audio sprite (.ogg) + its offset map (.json) MUST share a
          // strategy or they desync after a repack — both are SWR now.
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-images',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'audio',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-audio',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Spritesheet JSON sidecars fetched at runtime.
            urlPattern: ({ url }) => url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-data',
              cacheableResponse: { statuses: [200] },
            },
          },
          // NOTE: cutscene videos (.mp4) are intentionally NOT cached — they're
          // large and stream from the network; add a CacheFirst + RangeRequests
          // rule here if full-offline cutscenes are needed.
        ],
      },
      // Keep the SW out of `vite dev` so the optional dev server stays simple.
      devOptions: { enabled: false },
    }),
  ],
});
