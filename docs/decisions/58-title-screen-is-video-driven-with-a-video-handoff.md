# Decision #58 — The title screen is video-driven, and the transition movie is HANDED OFF to CharacterSelectScene for a true cross-fade (2026-08-27)

The static title screen became a movie sequence: an intro movie that cross-fades
into the static `title_screen` image, and — on any input — a transition movie
(plus its `sfx_title_transition` stinger, started together on the input gesture)
whose end cross-fades into the character-select layout.

## Why a handoff instead of `fadeToScene`

`SceneManager.fadeToScene` fades **through black** — fine for every other scene
change, but it cannot produce "the movie's last frames dissolving into the next
scene's UI". Rebuilding SceneManager around a generic cross-fade transition was
rejected as far too invasive for one use site. Instead the ownership of the
still-playing `<video>` element moves across the scene boundary:

1. When the transition movie is within `TRANSITION_HANDOFF_LEAD_MS` (~1 frame)
   of its end, TitleScreen calls
   `CharacterSelectScene.setEntryVideoOverlay(video, fadeMs)` and then an
   **instant `switchTo`** (no black fade).
2. CharacterSelectScene draws the video in `renderForeground` (over ALL its UI,
   covering the bars) at an alpha decaying 1→0 over `TRANSITION_CROSSFADE_MS`,
   then releases the element. The movie ends within a frame of the switch, so
   what dissolves is its HELD LAST FRAME — fading a still-moving picture reads
   as mush, which is why the handoff lead and the fade duration are separate
   knobs.

## The bug classes this shape prevents

- **Teardown races:** `switchTo` synchronously calls the outgoing scene's
  `onExit`, and TitleScreen's `onExit` destroys its videos. The handoff
  therefore detaches TitleScreen's listeners and **nulls its reference BEFORE
  `switchTo`** — otherwise the element would be torn down mid-cross-fade.
  Symmetrically, CharacterSelectScene must **NOT reset the overlay fields in
  `onEnter`** (the handoff sets them immediately before `onEnter` runs); it
  releases the element when the fade completes, and in `onExit` as a safety.
- **Stuck transitions:** `switchTo`/`fadeToScene` are silently ignored while a
  SceneManager transition is in flight (e.g. the LoadingScene → Title fade-in),
  so every end condition only sets `_pendingHandoff`/`_pendingFallback`, and
  `update()` executes them once `!isTransitioning()` — the BossIntroScene
  `_pendingFinish` idiom.
- **Offline/black-screen hangs:** all of decision #53 applies — errors are
  remembered on the element (`_tsFailed`), a video with no paintable frame
  within 4s falls back (intro → static image, transition → the classic
  `fadeToScene`), and both movies are in `videoManifest` for PWA cache warming.

**The same handoff shape now has a second use site (2026-08-28):** confirming a
hero plays the shared map-transition movie in CharacterSelectScene and hands it
to `MapScene.setEntryVideoOverlay` (which also arms MapView's fullscreen-splash
entry reveal) — same ownership-transfer-before-`switchTo`, same deferral, same
fail-fast fallbacks.

The movie URLs live in `data/videoManifest.js` (`TITLE_SCREEN_VIDEOS`) so the
scene and the cache warmer share one source of truth; `main.js` calls
`titleScreen.preloadVideos()` at boot so both movies buffer during the loading
screen. The transition SFX is a `.webm` outside `assets/audio/`, so the
service worker's `game-audio` route also matches `.webm` **by pathname**
(Howler's Web Audio XHR has `request.destination === ''`).
