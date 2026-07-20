# Performance Review — gems

> Full-codebase performance assessment, 2026-07-17. Produced from a five-track code
> audit (rendering path, effects/animations, assets/audio, battle-logic hot paths,
> memory/listener lifecycle). Findings marked **CONFIRMED** are directly supported by
> code; **SUSPECTED** items need runtime profiling to size. Phase 0 items were
> implemented the same day — see the checklist at the bottom.

---

## Executive Summary

The five largest realistic opportunities, in order of expected real-world impact:

1. **Stop decoding the entire soundtrack to PCM at boot (~450–500 MB of committed
   audio memory).** Every music track and SFX loaded with `preload: true, html5: false`,
   so Howler decoded everything to Float32 PCM buffers at init — including an 8-minute
   game-over theme (~161 MB decoded) heard only on death. Single biggest memory item in
   the game; probable tab-kill on iOS Safari. Config-level fix. *(Implemented in Phase 0.)*

2. **Fix the KeywordText cache-defeat bug.** One missing value-comparison caused both
   skill panes to re-tokenize and re-measure every effect line of every visible skill
   card, 60×/s, during every battle. Largest avoidable steady-state CPU cost in battle.
   *(Implemented in Phase 0 — one-line guard.)*

3. **Cut the boot payload and stop gating the title screen on all assets (~67 MB of
   images before TitleScreen).** Everything for every scene loads before the title.
   The relic sheet alone is a 3809×4111 PNG (12.5 MB file) for icons drawn small.

4. **Cap devicePixelRatio.** The full window was cleared and redrawn every frame at raw
   DPR with no cap — up to ~8.3M px/frame at 4K/DPR-2, worse on DPR-3 phones. Fill rate
   is the classic mobile Canvas2D killer. *(Implemented in Phase 0, cap = 2 — no change
   on desktop/DPR≤2 displays, so no sharpness loss there.)*

5. **Move the hint/AI evaluation off the main thread (or budget it).** The idle-glint
   hint runs ~1,500 synchronous board clones + cascade resolutions per turn; the code
   itself documents a "visible one-frame hitch" on mobile. `formulaPolicy.js` is already
   pure/headless (the sim toolbench runs it in Node), making it unusually worker-friendly.

Explicitly **not** recommended: a WebGL/WebGPU migration. The evidence points to
CPU-side waste (text measuring, per-frame layout, gradient allocation) and memory, not
draw-call or rasterization limits.

---

## Current Performance Architecture

**Rendering.** One full-window canvas, 2D context with `alpha: false`, backing store at
`devicePixelRatio` (`CanvasApp.js`). All drawing in a fixed 1920×1080 design space via a
pre-set transform. A single rAF loop (`GameLoop.js`) drives
`update → layout → clear → render` through `SceneManager._tick`. **No dirty-checking, no
static-layer caching, no FPS cap** — every frame fully relayouts the UI tree and redraws
everything, whether or not anything changed. Only one scene renders at a time; battle
overlays draw on top of a still-fully-rendered battle.

**UI.** A retained widget tree (UIElement/UIContainer/UIText/…) that re-emits all draw
calls every frame. Text wrapping is cached per text/font/width; no offscreen text
baking. An idle battle frame issues roughly 170–200 `drawImage`, 40–70 `fillText`,
64 `strokeRect` (board cell borders), and 1–5 gradient creations — modest by Canvas2D
standards.

**Game state.** Battle logic is a fixed-timestep state machine inside
`BattleController.update(dt)` — no setTimeout/promise chains anywhere in battle logic
(good design). Cascade steps are serialized by presentation timers (~633 ms per step at
current speed). The scene polls `getState()` every frame, allocating a fresh ~40-field
snapshot object per frame (`BattleController.js:963-1080`).

**Effects.** Event-driven, finite-lifetime, self-pruning effect arrays. Battle effects
are already well-tuned: baked gradient sprites with module caches, reusable scratch
buffers, zero `shadowBlur`, one composite-mode switch per batch. A heavy 5-chain cascade
peaks at low hundreds of live particles. Idle battle has essentially zero continuous
effect cost.

**Assets.** Everything registers at boot; `loadAll()` fetches all of it; LoadingScene
holds the title until image progress hits 100%. Images load via `new Image()`; 19
spritesheets are sliced into **353 individual canvases** (~157 MB committed pixels),
while the full sheet Image was *also* retained under its own key.

**Audio.** Howler with Web Audio buffers, `preload: true` on everything (pre-Phase-0).
Two SFX audio sprites (good — ~200 one-shots share two Howls). Music loops manually via
the `'end'` event and crossfades with `howl.fade()`.

**Lifecycle (healthy).** Listeners balanced across scene enter/exit, zero `setInterval`,
one rAF loop, no console spam in hot paths, combat log capped at 50, caches bounded or
evicted, videos destroyed on scene exit, at most one stale BattleScene between battles
(bounded by design). No unbounded leak found anywhere.

---

## Confirmed Bottlenecks

### F1. Entire audio library decoded to PCM at boot — largest memory item *(fixed: Phase 0)*

- **Behavior:** every sound/music def had `preload: true, html5: false`
  (`AudioManager.js`, `SoundConfig.js`); `init()` loaded all of them at boot.
- **Cost:** Web Audio buffers are committed Float32 PCM (~0.34 MB/s stereo). Measured:
  main theme 197 s (~66 MB), three battle themes ~52–62 MB each, weave theme ~52 MB,
  **game_over_theme 479 s ≈ 161 MB**, ~65 MB for the two SFX sprites.
  Total ≈ **450–520 MB RAM** + ~31 MB boot network.
- **Change made:** music tracks now `preload: false`, loaded on demand by
  `playMusic`, and **unloaded after crossfade-out** — only the playing track (plus the
  outgoing one mid-fade) is decoded. SFX sprites stay Web Audio/preloaded.
- **Still open:** re-export `game_over_theme` shorter (content decision, ~9.3 MB file);
  consider `html5: true` streaming per-track after listening tests.
- **Validate:** Chrome Task Manager JS memory before/after init; loop seams + crossfades
  per track.

### F2. KeywordText layout cache defeated every frame in both skill panes *(fixed: Phase 0)*

- **Behavior:** `SkillsPane.renderSelf` measures every visible card every frame
  (`SkillsPane.js:457-460`); `measureCardModel` passes `maxWidth` unconditionally
  (`skillCard.js:227`); `KeywordText.setStyle` invalidated its layout whenever a field
  was *present*, without comparing values (`KeywordText.js:74-90`). The wrap cache
  existed but never got a hit → every effect line of every card in both panes re-parsed
  keyword markup, re-tokenized, and ran `measureText` per run at 60 fps.
- **Change made:** `setStyle` now only invalidates when a value actually changed.
- **Validate:** DevTools profile of idle battle — `measureText`/`parseKeywordText`
  self-time should collapse; confirm `<<n>>` dynamic text still updates.

### F3. Boot payload: ~67 MB of images gate the title; all scenes load up front

- **Behavior:** all standalone images + 19 sheets load at boot (`main.js`);
  LoadingScene fades to title only at 100% image progress. Sheets for scenes a player
  may never visit decode + slice before the title.
- **Cost:** ~66.8 MB fetch + decode + 353 synchronous slices before interactivity.
  Relic sheet 3809×4111; enemy portraits 2904×3802.
- **Change (Phase 1):** per-scene asset groups — gate title on title/character-select
  assets only, stream the rest; downscale/re-pack outsized sheets to actual draw size;
  make the Vite build the deployment path.
- **Impact:** High (load time). **Risk:** entering a scene before its group is ready
  (needs a wait state). **Validate:** Network bytes + time-to-title before/after.

### F4. Spritesheets retained twice; 353 sliced canvases (~157 MB committed) *(partially fixed: Phase 0)*

- **Behavior:** after slicing, each sprite lives in its own canvas **and** the full
  sheet Image stayed retrievable under `sheetKey` (`AssetManager.js`).
- **Change made:** sliced sheets no longer retain the full-sheet Image (only
  `slice: false` sheets, which SpriteSheetAnimation consumes whole, keep it).
- **Still open (Phase 2):** atlas-native rendering — store frame rects, draw via 9-arg
  `drawImage` from the sheet, eliminating the 353 slice canvases entirely. Multiplied
  by F3's sheet downscaling.
- **Validate:** heap snapshot after boot; verify relic bar / panes / icon compositor
  still render (compositor reads sliced sprites).

### F5. Map screen rebuilds layout and ~30 radial gradients per frame

- **Behavior:** every frame `MapRenderer.render` re-runs `layoutNodes` (all node
  positions + per-node hash jitter + fresh arrays), draws ~26 nodes with 1–3 fresh
  radial gradients each, `shadowBlur` 8–20 rings, and ~350–450 per-dot `arc`+`fill`
  edge dots (`MapRenderer.js:354,422-570,585-810`).
- **Change (Phase 1):** cache `layoutNodes` (invalidate on resize/graph change); bake
  the static graph to an offscreen canvas redrawn on state change; pre-bake gradient
  sprites (pattern already in `TileParticleEffect.js:49-78`).
- **Impact:** Moderate–High on the map scene. **Risk:** stale bake on hover/state
  change — invalidate on those events. **Validate:** map-scene profile before/after.

### F6. Uncapped DPR: full-window redraw at native resolution *(fixed: Phase 0)*

- **Behavior:** backing store = window × raw `devicePixelRatio`, uncapped; `clear()`
  fills the physical canvas every frame; everything redraws at that resolution.
  Fill cost scales with DPR².
- **Change made:** effective DPR capped at 2 (`MAX_RENDER_DPR` in `main.js` →
  `CanvasApp` `maxDpr` option). **No change on desktop/DPR≤2** (so no sharpness loss
  there); DPR-3 phones render at 2× and upscale 1.5× — the main fill-rate lever.
  `?dprcap=N` URL override for A/B testing (`?dprcap=0` = uncapped native).
- **Validate:** frame time on a mid-range phone, native vs capped; inspect text/tile
  sharpness on a DPR-3 device.

### F7. Synchronous hint/AI simulation hitch, once per turn

- **Behavior:** idle-glint hint = `MoveAdvisor.rankMoves` with Monte-Carlo refill
  sampling + opponent-reply lookahead ≈ ~1,500 board clones + cascade resolutions per
  player turn; `?` hint = `formulaPolicy.bestActionValue` sweeps with beam re-ranking
  and extra-turn recursion (quadratic worst case). Both synchronous, main-thread,
  cached per turn. Self-documented mobile hitch (`BattleScene.js:2432-2437`).
- **Change (Phase 2):** Web Worker — `formulaPolicy.js` + board sim are pure ES modules
  already run headless by the toolbench. Post board snapshot, receive ranked move.
  Fallback: time-slice, or drop `samples` on low-end.
- **Impact:** Moderate–High (turn-start latency, mobile). **Risk:** worker/main board
  state sync. **Validate:** `performance.mark` around the hint now; assert identical
  move output worker vs inline on seeded boards.

### F8. Per-frame full UI relayout with allocations

- **Behavior:** `SceneManager` calls `scene.layoutChildren()` **every frame**
  (`SceneManager.js:297-298`); `UIContainer.layoutChildren` allocates filter arrays,
  per-child measure objects, and reduce closures per container per frame
  (`UIContainer.js:32-222`) — producing identical rects almost always.
- **Change (Phase 2):** layout on resize/scene-enter/dirty-flag only; intermediate
  step: keep per-frame layout but allocation-free. **Highest regression surface of the
  medium tier** — per-frame relayout currently doubles as change propagation.
- **Validate:** allocation-sampling profile idle battle; watch for stale layout on
  equip/resize.

### F9. Character-select aura: ~120 radial gradients per frame *(fixed: Phase 0)*

- **Behavior:** `AuraStrandsEffect` created 2 radial gradients + 2 arc fills per
  particle per frame, up to 60 particles (`AuraStrandsEffect.js:469-490`) — the exact
  pattern the battle effects already engineered away.
- **Change made:** glow/core sprites baked per color into a module cache and blitted,
  same pattern as `TileParticleEffect`.

### F10. Smaller confirmed items

| Item | Evidence | Fix | Status |
|---|---|---|---|
| Full-canvas 10-stop scrim gradient rebuilt every frame in battle | `BattleScene.js:2246` | Cache; rebuild on resize | **Phase 0 ✓** |
| `getBoundingClientRect()` + `{x,y}` alloc per unthrottled mousemove | `InputManager.js:113` | Cache rect; invalidate on resize/scroll | **Phase 0 ✓** |
| No `visibilitychange` handling — audio plays / videos decode while hidden | grep-confirmed absence | Mute/pause on hide (partly a product choice) | Phase 1 |
| `getState()` allocates ~40-field object + ~10 arrays per frame | `BattleController.js:963-1080` | Reuse snapshot / swap event buffers only | Phase 1 |
| Board idle pass allocates ~130 string keys + Set/map per frame | `BoardPlaceholder.js:763-827` | Precompute keys / numeric indexing | Phase 2 (with board bake) |
| Dead weight in served tree: 379 MB `raw*/_old/_bak` art, obsolete mp4s (~54 MB), unregistered `character_pane2` (4.7 MB), dead font, 404-ing sound defs | du + config | Delete/move | Disk hygiene only — unreferenced files are never fetched, so zero runtime impact; left to the owner (art pipeline may reference raw dirs) |
| `getAllPlayerSkills` deep-clones all woven skills twice per battle setup | `playerStats.js:49,63,193` | Clone once | Phase 1 (low) |

---

## High-Probability Risks (need profiling)

1. **Idle-battle total frame cost on low-end mobile** — ~200 draws/frame is fine on
   desktop; with DPR-3 (pre-cap) + F2 it may have exceeded 16 ms on older phones.
   Re-profile after Phase 0.
2. **GC pauses during cascades** — ~540 particle objects per 30-tile cascade + per-step
   full-grid snapshots (`BattleController.js:2069`) + per-frame layout/state churn.
3. **PassiveSystem dispatch scaling** — O(relics × effects) both sides, 5–10+ dispatches
   per cascade step (`PassiveSystem.js:76-138`). Fine now; index per-trigger when relic
   counts grow ~5×.
4. **UIProgressBar blurred label shadow** (`shadowBlur=2`, `UIProgressBar.js:345`) +
   5–7 save/clip paths per bar per frame — suspected minor, always-visible path.
5. **`AssetManager._scaledCache`** evicts only on DPR change — slow session growth with
   distinct scaled sizes.

---

## Rendering Strategy Assessment

**Stay on Canvas 2D.**

- The measured problems are CPU-side JS (text measuring, layout allocation, gradient
  churn, synchronous simulation) and memory — WebGL fixes none of them.
- ~200 sprites/frame is two orders of magnitude below Canvas2D's drawImage limits.
- The game is text/UI-heavy — Canvas2D's strength, WebGL's weakness (SDF fonts, glyph
  atlases, gradients, clips would all need rebuilding; the whole `src/js/ui` framework
  would need a port).
- WebGPU adds device-support risk on exactly the low-end targets that matter.
- The one real GPU win — fill rate at high DPR — is captured by the DPR cap for ~10 lines.

**Hybrid renderer** (WebGL board/particles under 2D UI): only if post-Phase-0/1 profiles
on real phones still show raster-bound frames during heavy cascades. Not predicted.

**Workers/OffscreenCanvas:** worker for AI/hint (F7) is the justified use. OffscreenCanvas
rendering is not — the main thread isn't saturated by drawing.

---

## Changes Not Worth Doing

- **WebGL/WebGPU/PixiJS migration** — see above.
- **Particle/object pooling** — peak live objects in the low hundreds, finite lifetimes,
  no per-frame allocation in tuned paths. Revisit only on measured GC spikes.
- **ECS / battle-system refactor** — the state machine is clean and headless-testable.
- **Dirty-region partial repaints** — letterboxing + shake + full-canvas scrims make
  region tracking fragile; static-*layer* caching captures most of the win.
- **Match resolution in a worker** — O(64) per step, trivially cheap live.
- **In-app idle FPS caps** — rAF already throttles hidden tabs; adds jank risk.
- **`createImageBitmap` everywhere / IndexedDB caching** — dwarfed by loading less (F3)
  and slicing less (F4).

---

## Profiling Plan

1. **Frame-time HUD** *(added in Phase 0: `?perf` URL flag — rolling avg/p95 +
   update/layout/render sub-timings, `src/js/engine/PerfHud.js`)*.
2. **Baselines (DevTools Performance, 6× CPU throttle):** idle battle 30 s; scripted
   heavy cascade; map idle 30 s; character select idle 30 s; turn start with hint
   (`performance.mark` the hint call). Track `measureText`, `layoutChildren`, gradient
   callers, long tasks >50 ms.
3. **Fill/GPU:** Rendering → Frame Rendering Stats + `about:tracing` GPU track, desktop
   + phone; DPR native vs capped on the same scene.
4. **Memory:** heap snapshot + Chrome Task Manager (JS + GPU memory) at title, post-boot,
   mid-battle, after 5 battles, after 30 min idle. Before/after F1 = the audio win.
5. **GC:** allocation-instrumentation timeline during heavy cascade + idle battle.
6. **Load:** Network tab (no cache, Fast-3G + unthrottled) bytes/time-to-title;
   Lighthouse on the Vite build.
7. **Input latency:** interaction track, pointer-down→board-response, idle vs cascade;
   turn start pre/post F7.
8. **Mobile ground truth:** remote-debug mid/low-end Android + iPhone; on iOS confirm a
   full run survives (the F1 memory test).
9. **Regression guard:** re-run the scripted scenario set on the HUD after each phase;
   toolbench headless engine asserts AI-move equivalence for the worker migration.

---

## Phased Implementation Plan

**Phase 0 — immediate, low-risk — IMPLEMENTED 2026-07-17:**
- [x] KeywordText invalidation guard (F2)
- [x] Music on-demand load + unload-on-switch (F1) — game_over re-export still open
- [x] DPR cap = 2 with `?dprcap` override (F6)
- [x] Battle scrim gradient cache (F10)
- [x] InputManager rect cache (F10)
- [x] AuraStrands gradient-sprite bake (F9)
- [x] Drop full-sheet retention after slicing (F4-lite)
- [x] PerfHud frame-time overlay (`?perf`)
- [ ] Dead-asset cleanup — deliberately skipped: unreferenced files are never fetched
      (zero runtime impact) and the raw dirs may feed the art pipeline; owner's call.

**Phase 0.5 — cascade effect pass — IMPLEMENTED 2026-07-19** (response to a reported
mobile fps drop during cascades — addresses Risk #2's render-side half; all changes are
the established bake-and-blit idiom, verified pixel-equivalent or imperceptible):
- [x] `TileParticleEffect`: glow+core pre-summed into ONE baked `'burst'` sprite
      (additive blending is linear → identical pixels), halving per-particle draws; and
      a transform-free fast path for particles below `STRETCH_MIN_SPEED` — most of a
      particle's life — removing the per-particle save/translate/rotate/scale/restore
      churn (hundreds of particles live during a big cascade step).
- [x] `BattleScene._spawnTileDestroyParticles`: particle/spark counts throttle once 12+
      / 24+ bursts are already live, bounding board-wide destroys and deep bottom-row
      cascades; ordinary 3-5 tile matches unaffected.
- [x] `FloatingTextEffect`: the 3-pass text look (shadow/outline/fill) baked once per
      string into a module-cached sprite at physical resolution — the animating font
      size defeated the glyph cache, re-rasterizing 3 text passes per effect per frame.
- [x] `FloatingImageEffect`: the ~700px animated-text art's `'high'`-quality resample
      now happens once into a peak-size pre-scaled copy; per-frame draws are ≤1:1 blits.
- [x] Match-4 flourish (`BoardPlaceholder`): bloom/core/parry-flare gradients baked into
      module-cached sprites (2 gradients per matched tile per frame → ≤1 per frame, the
      ring). Matters most on chained 4+ flourishes, whose freeze beats escalate.

**Phase 1 — medium structural:** asset groups + title gating + Vite deploys (F3) ·
re-pack/downscale relics + portrait sheets (F3/F4) · map static-layer bake + cached
layout (F5) · `visibilitychange` pause/mute · `getState()` snapshot reuse.

**Phase 2 — requires profiling evidence:** hint/AI Web Worker (F7) · dirty-flag layout
(F8 — highest regression surface; only with the HUD in place) · battle static-layer
caching if idle frames still exceed budget on target phones · atlas-native sprite
rendering if memory targets aren't met.

**Phase 3 — as the game grows:** PassiveSystem per-trigger indexing (relic counts ~5×) ·
particle pooling (only on measured GC spikes) · hybrid WebGL effects layer (only if
post-fix profiles show fill-bound frames — not currently predicted).
