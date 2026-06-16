# PWA install icons

The PWA manifest (see `vite.config.js`) uses **`icon.svg`** as the install icon.
Chrome accepts an SVG (`"sizes": "any"`) as a valid manifest icon, so no binary
PNG export is required for the app to be installable on desktop/Android.

`icon.svg` is copied verbatim into the build at `dist/assets/icons/` alongside
the rest of the game art.

## Optional: a custom iOS home-screen icon
iOS Safari's "Add to Home Screen" does NOT use SVG manifest icons — it uses an
`apple-touch-icon` PNG (or falls back to a screenshot). If you want a polished
iOS icon, add a 180×180 (or 512×512) PNG here and reference it with a
`<link rel="apple-touch-icon" href="assets/icons/icon-180.png">` in `index.html`.
Not required for installability on desktop/Android.
