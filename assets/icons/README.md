# PWA install icons

The PWA manifest (see `vite.config.js`) uses square icons for the install /
"Add to Home Screen" experience:

- `icon-192.jpg` — 192×192
- `icon-512.jpg` — 512×512 (also used as the maskable icon, and as the iOS
  `apple-touch-icon` referenced from `index.html`)

JPEG is accepted by the web app manifest. PNG is the more common choice (it
supports transparency and avoids compression artifacts) — fine to swap to PNGs
later; just update the `type` + `src` in the manifest if you do.

These files are copied verbatim into the build at `dist/assets/icons/` by the
`copyGameAssets` step in `vite.config.js`.

For a maskable icon, keep the important art within the centre ~80% (safe zone)
so platform circle/squircle masks don't clip it.
