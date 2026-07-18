# Decision #51 — Render DPR is capped at 2 (`MAX_RENDER_DPR`), overridable via `?dprcap` (2026-07-17)

**The canvas backing store is sized at `min(devicePixelRatio, 2)` instead of raw DPR.**
`MAX_RENDER_DPR = 2` lives in [`main.js`](../../src/js/main.js) and flows into
`CanvasApp` as the `maxDpr` option; `CanvasApp` keeps the RAW dpr separately
(`_rawDpr`, used only for DPR-change detection) and clamps the render dpr
(`_clampDpr`).

## Why

Canvas fill cost scales with dpr². The whole game redraws every frame at full
backing-store resolution, so a dpr-3 phone rasterized ~2.25× the pixels of dpr-2 —
the dominant fill-rate cost on high-DPI mobile (see
[docs/performance-review.md](../performance-review.md), finding F6) — for detail that
is not visible at game viewing distance.

## Why the cap is 2, not lower

Sharpness: typical desktop/laptop displays are dpr 1–2 and sit AT or BELOW the cap, so
they render **exactly as before** — zero sharpness change. Only dpr>2 devices (flagship
phones) are affected: they render at 2× design resolution and upscale ~1.5×, a slight
softening in exchange for roughly halving rasterized pixels.

## Testing / escape hatch

`?dprcap=N` URL param overrides the cap (`?dprcap=0` = uncapped native, `?dprcap=3`
etc.) for side-by-side sharpness/frame-time comparisons on a real device. If a
device-class complaint ever materializes, the knob is `MAX_RENDER_DPR` in `main.js`.

## Bug class this prevents

Do NOT read `window.devicePixelRatio` directly in render code — it is the UNCAPPED
value. Use `app.dpr` (capped) or derive the pixel scale from the live context
transform (`ctx.getTransform()`), as `BoardPlaceholder`'s tile baking already does.
