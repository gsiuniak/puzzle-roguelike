# PWA install icons

The PWA manifest (see `vite.config.js`) references two square icons used for the
"Add to Home Screen" / install experience on mobile and desktop:

- `icon-192.png` — 192×192 px
- `icon-512.png` — 512×512 px (also used as the maskable icon)

Drop those two PNGs in this folder. They are copied verbatim into the build at
`dist/assets/icons/` alongside the rest of the game art.

The build (`npm run build`) succeeds **without** them — the app is still an
installable PWA, it just falls back to a generic icon until you add these.

Tip: for the maskable icon, keep important art within the centre ~80% (safe
zone) so platform masks (circle/squircle) don't clip it.
