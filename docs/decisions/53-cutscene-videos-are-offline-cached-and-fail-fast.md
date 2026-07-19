# Decision #53 — Cutscene/splash videos are OFFLINE-CACHED (CacheFirst + rangeRequests + a boot-time warmer) and video playback FAILS FAST (2026-07-18)

**The installed PWA froze at character select when played with little/no connectivity.**
Confirming a hero sat on the static splash for the full 30s `CHOOSE_VIDEO_MAX_DURATION`
(read by players as a hard freeze); the boss intro had the same class of hang (~20s of
black screen). Three causes composed:

1. **The service worker deliberately did not cache `.mp4`s** (the old vite.config note:
   "large, stream from the network"). Offline, every video fetch failed.
2. **The graceful-failure path was disarmed before it could help.** Both video scenes
   preload their `<video>` elements ahead of playback; offline, the `'error'` event fires
   *during preload*, while the scene's transition guard (`_choosingActive` /
   playback-listeners-not-yet-attached) swallows it.
3. **A dead `<video>` element emits no further signals.** Calling `play()` on an element
   already in `MEDIA_ERR_NETWORK` state does not re-run resource selection: `'error'`
   never re-fires and the `play()` promise NEVER settles, so every event/promise exit
   the scenes waited on was unreachable. Only the long safety cap remained.

## The decision — two independent layers

**Layer 1: video playback must fail fast (scenes).** A load `'error'` is remembered ON
the element (`_csFailed` / `_biFailed`) no matter when it fires; starting playback checks
the flag (and `video.error`) and skips the cutscene immediately instead of waiting on
events that cannot come. A ~4s watchdog (`CHOOSE_VIDEO_STALL_BAILOUT_MS` /
`_stallBailout`) additionally bails when the video never becomes paintable
(`readyState < 2`) or — character select only — its playback clock stops advancing.
BossIntroScene's preload-time error handler only MARKS the element; it must never call
`_requestFinish()`, because that starts the boss music while the player still roams the
map. Cutscenes are garnish: when the video can't play, the game moves on within seconds.

**Layer 2: videos work offline (build + boot).** A `game-videos` runtime route in
vite.config.js matches `request.destination === 'video'` OR a `.mp4` pathname, handler
**CacheFirst** with `rangeRequests: true` + `cacheableResponse: {statuses: [200]}`.
Two subtleties make the shape non-obvious:

- **CacheFirst, not the SWR every other asset uses:** the files are multi-MB and
  effectively immutable; SWR's background refetch would re-download them on every play.
  Consequence: replacing a video's CONTENT at the same URL serves stale — rename the
  file to bust.
- **`<video>` elements cannot warm this cache themselves.** Their fetches carry Range
  headers; servers answer 206, and a partial body must never be cached (the
  `statuses: [200]` gate enforces that). So boot warms the cache with plain `fetch()`es
  (no Range header → full 200 → cached): [`engine/videoCacheWarmer.js`](../../src/js/engine/videoCacheWarmer.js),
  called from main.js AFTER `assetManager.loadAll()` resolves so ~42 MB of video never
  competes with gameplay assets for bandwidth. Sequential downloads; a cached URL costs
  one lookup; no-op without a controlling SW (raw serving, `vite dev`, first PWA visit —
  the next boot warms). The route matching `.mp4` by *pathname*, not just destination,
  is what routes the warming fetch into the same cache. `rangeRequests` then slices the
  cached full body into the 206s the `<video>` element requests offline.
- The URL list is collected from the data catalogs
  ([`data/videoManifest.js`](../../src/js/data/videoManifest.js): hero `splashVideo`s,
  enemy `introVideo`/`portraitVideo`) so new hero/boss videos warm automatically.
  SkillWeaveScene's flagged-off background video is deliberately excluded.

## Why not precache the videos in the SW manifest?

Workbox's precache handler doesn't serve Range requests, `maximumFileSizeToCacheInBytes`
would need raising past 25 MB, and every deploy would re-validate the entries. The
runtime-cache + warmer shape keeps the install download small (the shell stays ~560 KB)
and degrades gracefully: worst case the video simply isn't cached yet, and Layer 1
guarantees that costs ~4s, not a frozen screen.

## Bug class prevented

Any scene that gates a transition on a media element's lifecycle events must (a) record
terminal failure OUT-OF-BAND of the event (the element won't re-signal), and (b) carry a
short paintability watchdog. Waiting on `'ended'`/`'error'`/`play().catch` alone is a
proven offline deadlock.
