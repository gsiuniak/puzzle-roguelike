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
        name: 'Puzzle Roguelike',
        short_name: 'Roguelike',
        description: 'Match-3 Puzzle Roguelike',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: './',
        scope: './',
        // SVG icon — Chrome accepts an SVG ("sizes":"any") as a valid install
        // icon, so no binary PNG export is needed for installability. (Add a PNG
        // apple-touch-icon later only if you want a custom iOS home-screen icon.)
        icons: [
          { src: 'assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the small app shell; the heavy game media is runtime-cached
        // on first use (below) so the install isn't a multi-hundred-MB download.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-images',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'audio',
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-audio',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Spritesheet JSON sidecars fetched at runtime.
            urlPattern: ({ url }) => url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-data',
              cacheableResponse: { statuses: [0, 200] },
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
