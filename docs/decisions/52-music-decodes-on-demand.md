# Decision #52 — Music/ambient tracks decode ON DEMAND and unload on switch; SFX stay preloaded (2026-07-17)

**Music and ambient `SOUNDS` entries get `preload: false`; only the currently playing
track (plus the outgoing one mid-crossfade) is ever decoded.** Implemented entirely in
[`AudioManager`](../../src/js/audio/AudioManager.js):

- `loadSound` creates MUSIC/AMBIENT howls lazy (`preload: !lazyLoad`).
- `playMusic` / `_play` kick `howl.load()` explicitly when the howl is `'unloaded'` —
  **required**, because Howler's `play()` on an unloaded howl only QUEUES the play, it
  never starts the load. Fades/volume also queue, so the rest of the flow is unchanged.
- `_teardownMusicHowl(key, howl)` runs when a track finishes crossfading out (both the
  `'fade'` event and the wall-clock fallback route into it, once-guarded) and in
  `stopMusic`: it stops + `unload()`s the howl (freeing the decoded buffer) and swaps a
  FRESH lazy Howl back into `_sounds` under the same key, so a later revisit reloads
  cleanly instead of reusing a destroyed Howl.

## Why

With `preload: true` every track decoded to a committed Web Audio Float32 PCM buffer at
boot: ~0.34 MB per second of stereo audio — ≈450–520 MB resident before any gameplay,
dominated by the 8-minute `game_over_theme` (~161 MB decoded, heard only on death).
That figure alone risked background-tab eviction / tab-kill on iOS Safari. See
[docs/performance-review.md](../performance-review.md), finding F1.

## Tradeoffs / invariants

- First play of a track starts after its fetch+decode (a few hundred ms) instead of
  instantly. Crossfades mask this; `startBattleMusic`'s "cross-fades as it loads"
  behavior is unchanged.
- SFX (both audio-sprite Howls and standalone) remain `preload: true` — latency matters
  there and the sprites are small (~2.2 MB files).
- Never call `howl.play()` on a lazy howl without the `state() === 'unloaded'` load
  kick — it will queue forever.
- Rapid switch-back within a fade window is safe: teardown no-ops when the howl has
  become current again (same guard the old stop path had).
