# Decision #56 — Full-canvas backgrounds and large panel arts are pre-baked at physical resolution; `imageSmoothingQuality` is always restored with `imageSmoothingEnabled` (2026-08-27)

**The battle frame's dominant mobile cost was resampling, not effects.** After the
Phase 0.5 effect pass, profiling-guided review (Phase 0.75 in
[performance-review.md](../performance-review.md)) found every frame still paid:

1. a full-physical-canvas **smoothed cover-fit resample** of the battle background
   (`CanvasApp.clear()` → `_drawCoverImage`, ≈4M pixels at dpr 2),
2. a second full-canvas gradient `fillRect` (the scrim) with per-frame key-string
   churn, and
3. two ~1178×1181 board-frame arts + the character/skills panel arts smoothly
   resampled from full-resolution sources to their on-screen size, every frame.

## The bake contract

All of these now render ONCE into offscreen canvases at **backing-store resolution**
(one high-quality resample), and the per-frame draw is a ~1:1 blit:

- **Bar-fill background** (`CanvasApp._getBakedBarFill`): invalidated by backing-store
  size change (covers window resize AND DPR change — both flow through
  `_handleResize`), by `setBackgroundImage()` (a **generation counter** bumped there —
  never fingerprint pixels), and by the source element's decoded size appearing (an
  image registered before load). Scene changes need nothing special: they already go
  through `setBackgroundImage`. Screen shake needs nothing: the shake translate is
  applied inside `BattleScene.render`, AFTER `clear()` — backgrounds are always
  pre-shake.
- **Scrim stops** are cached on their 9 numeric determinants (layout rects + viewport
  mapping) and passed as the SAME array reference so
  `fillFullCanvasHGradient`'s referential fast path skips even the key build.
- **Panel arts** go through `AssetManager.getScaled(key, w, h, smooth=true)` (the
  `smooth` flag is part of the cache key). The target size derives from the live
  `ctx.getTransform()` (decision #51 — never `window.devicePixelRatio`), and callers
  use a **stable-size guard**: the bake is only fetched once the target size has been
  stable for a frame, so a panel whose rect animates falls back to direct draws and
  can never thrash the cache with per-frame bakes (`UIPanel._drawArtScaled`,
  `BattleBoardPanel._drawSquareArtScaled`, `BoardPlaceholder._getBorderedTile`).
- **Eviction**: `assetManager.clearScaledCache()` is wired to a debounced window
  `resize` listener in `main.js` — stale-size bakes (panel bakes are multi-MB) don't
  accumulate across resizes; the new size rebuilds lazily.

## The smoothing-state rule (bug class)

`CharacterInfoPane._renderHealthOverlay` set `imageSmoothingQuality = 'high'` and
restored only `imageSmoothingEnabled` — with no enclosing `ctx.save()`, `'high'`
leaked onto **every later smoothed draw in the frame**, silently multiplying resample
cost scene-wide. Rule: **any code that sets `imageSmoothingQuality` outside a
`ctx.save()`/`restore()` pair must capture and restore it exactly like
`imageSmoothingEnabled`.** (Inside a save/restore pair both are covered — the canvas
state stack includes them.)

## Why not dirty-region repaints instead

Rejected in the review's "Changes Not Worth Doing" — the bake-and-blit idiom keeps the
full-repaint architecture (simple, correct) and just makes the repaint cheap.
