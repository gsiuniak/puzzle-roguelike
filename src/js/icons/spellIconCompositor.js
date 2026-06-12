/**
 * spellIconCompositor.js — renders an IconRecipe (spellIconRecipe.js) into a
 * painterly circular spell icon on an offscreen canvas. Canvas 2D only.
 *
 * Ported from the reference demo (sim/spell-icon-generator.html). The pipeline
 * stage ORDER is part of the icon format — changing it changes every icon, so
 * bump ICON_PIPELINE_VERSION when touching it (the cache key includes it):
 *
 *   1. value-noise FBM cloud background (grayscale; 'ridged' variant for veins)
 *   2. clouds lit by the glyph's glow (multiply by base + blurred glyph)
 *   3. additive bloom — four blur passes of the glyph (wide → sharp core)
 *   4. overlay layers, additive (soft pass + sharp pass)
 *   5. radial vignette (multiply)
 *   6. gradient-map LUT: luminance → palette color (THE color step)
 *   7. circular clip + beveled rim (rarity variant + secondary-palette hairline)
 *
 * Everything before stage 6 works on a genuinely GRAYSCALE luminance canvas —
 * glyphs/overlays must only draw white/gray (the LUT reads the red channel).
 *
 * Determinism: one SeededRNG per render (recipe.seed), threaded through the
 * stages in a fixed call order (clouds → glyph → overlays). No Math.random().
 *
 * Glyphs are hybrid: procedural draw functions, or registered PNG/canvas images
 * (registerPngGlyph) following the shared art spec — white/gray luminance art
 * on a transparent background. PNG art may be alpha-tight (any size/aspect);
 * it is contain-fit into the icon's safe circle at draw time (PNG_GLYPH_FIT).
 */

import { SeededRNG } from '../map/MapGenerator.js';

/** Bump when stage order, palettes, glyphs, or overlays change (invalidates caches). */
export const ICON_PIPELINE_VERSION = 1;

/** Native render size. Icons are drawn once at this size and scaled at draw time. */
export const ICON_NATIVE_SIZE = 512;

// ═══════════════════════════════════════════════════════════
// Palettes — luminance 0..1 → color stops (gradient-map LUTs)
// ═══════════════════════════════════════════════════════════

/** All stops: near-black → dark saturated → saturated mid → bright → near-white. */
export const PALETTES = Object.freeze({
  fire:      [[0, '#0a0302'], [0.22, '#3a0d02'], [0.45, '#a82500'], [0.68, '#ff7b00'], [0.86, '#ffce6e'], [1, '#fff7e6']],
  lightning: [[0, '#070604'], [0.25, '#241a05'], [0.5, '#8a6400'], [0.72, '#f5c000'], [0.88, '#fff0b0'], [1, '#ffffff']],
  ice:       [[0, '#020512'], [0.25, '#0a1c4d'], [0.5, '#1f5dbb'], [0.74, '#5fb9f5'], [0.9, '#cfeeff'], [1, '#ffffff']],
  nature:    [[0, '#020a04'], [0.25, '#0d2e12'], [0.5, '#2f7d26'], [0.74, '#8fd44a'], [0.9, '#e0f7b0'], [1, '#fbfff0']],
  void:      [[0, '#030107'], [0.25, '#16051f'], [0.5, '#561585'], [0.74, '#a64dff'], [0.9, '#e3c2ff'], [1, '#fbf2ff']],
  holy:      [[0, '#0c0902'], [0.25, '#4d3a08'], [0.5, '#b8922a'], [0.74, '#ffd75e'], [0.9, '#fff3c4'], [1, '#ffffff']],
  bone:      [[0, '#050404'], [0.22, '#191712'], [0.45, '#5d5948'], [0.7, '#b0a88c'], [0.88, '#e8e2cd'], [1, '#fffdf4']],
  arcane:    [[0, '#06060c'], [0.25, '#181a33'], [0.5, '#41498f'], [0.74, '#8b94e8'], [0.9, '#dde0ff'], [1, '#ffffff']],
});

function hexToRgb(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Build a 256-entry RGB LUT from palette stops. */
function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const f = (b[0] - a[0]) > 1e-6 ? (t - a[0]) / (b[0] - a[0]) : 0;
    const ca = hexToRgb(a[1]), cb = hexToRgb(b[1]);
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = ca[k] + (cb[k] - ca[k]) * f;
  }
  return lut;
}

const LUTS = {};
for (const k in PALETTES) LUTS[k] = buildLUT(PALETTES[k]);

/** A palette's bright accent color (used to tint the rim hairline). */
function paletteAccent(paletteId) {
  const stops = PALETTES[paletteId];
  if (!stops) return null;
  // Pick the stop nearest luminance 0.74 — the saturated bright band.
  let best = stops[0];
  for (const s of stops) if (Math.abs(s[0] - 0.74) < Math.abs(best[0] - 0.74)) best = s;
  return best[1];
}

// ═══════════════════════════════════════════════════════════
// Value-noise FBM clouds (stage 1)
// ═══════════════════════════════════════════════════════════

function makeValueNoise(rng) {
  const N = 64, g = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = rng();
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & (N - 1), x1 = (xi + 1) & (N - 1), y0 = yi & (N - 1), y1 = (yi + 1) & (N - 1);
    const a = g[y0 * N + x0], b = g[y0 * N + x1], c = g[y1 * N + x0], d = g[y1 * N + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Generate a 256px grayscale cloud canvas (upscaled with smoothing later). */
function cloudCanvas(rng, ridged) {
  const R = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = R;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(R, R);
  const noise = makeValueNoise(rng);
  const ox = rng() * 64, oy = rng() * 64, rot = rng() * Math.PI;
  const cosr = Math.cos(rot), sinr = Math.sin(rot);
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const u = (x * cosr - y * sinr) / R, v = (x * sinr + y * cosr) / R;
      let amp = 1, freq = 4, sum = 0, norm = 0;
      for (let o = 0; o < 5; o++) {
        let n = noise(ox + u * freq, oy + v * freq);
        if (ridged && o > 0) { n = 1 - Math.abs(2 * n - 1); n *= n; }
        sum += n * amp; norm += amp; amp *= 0.55; freq *= 2.1;
      }
      let t = sum / norm;
      t = Math.min(1, Math.max(0, (t - 0.32) / 0.5)); // contrast: carve cloud masses
      t = Math.pow(t, 1.25);
      const lum = 18 + t * 150;
      const i = (y * R + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = lum;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ═══════════════════════════════════════════════════════════
// Glyphs — white-on-transparent, inside the ~70% safe circle
// ═══════════════════════════════════════════════════════════

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Procedural glyph draw functions: (ctx, rng, S). */
const PROC_GLYPHS = {
  strike(ctx, rng, S) {
    const cx = S / 2, cy = S / 2, n = 7, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([cx + (t - 0.5) * S * 0.8, cy + (rng() - 0.5) * S * 0.14 + Math.sin(t * 6.3 + rng() * 3) * S * 0.03]);
    }
    const top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, hw = S * 0.075 * (0.2 + Math.sin(Math.PI * t)) * (0.6 + rng() * 0.7);
      top.push([pts[i][0], pts[i][1] - hw]);
      bot.push([pts[i][0], pts[i][1] + hw]);
    }
    ctx.fillStyle = '#fff';
    poly(ctx, top.concat(bot.reverse()));
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; // jagged notches
    for (let i = 1; i < n; i++) {
      if (rng() < 0.65) {
        const p = pts[i], w = S * (0.02 + rng() * 0.05), up = rng() < 0.5 ? -1 : 1;
        poly(ctx, [[p[0] - w, p[1] + up * S * 0.12], [p[0] + w * 0.2, p[1] - up * S * 0.01], [p[0] + w, p[1] + up * S * 0.12]]);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; // forks
    ctx.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const p = pts[1 + Math.floor(rng() * (n - 1))];
      ctx.lineWidth = (2 + rng() * 4) * (S / 512);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      let x = p[0], y = p[1];
      for (let s = 0; s < 4; s++) {
        x += (rng() - 0.5) * S * 0.12;
        y += (rng() < 0.5 ? -1 : 1) * rng() * S * 0.07;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  slash(ctx, rng, S) {
    const cx = S * 0.5, cy = S * 0.52, R = S * (0.3 + rng() * 0.06);
    const a0 = Math.PI * (0.65 + rng() * 0.2), a1 = a0 + Math.PI * (0.95 + rng() * 0.2), N = 48;
    const out = [], inn = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + (a1 - a0) * t, w = S * 0.11 * Math.pow(Math.sin(Math.PI * t), 0.8);
      out.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
      inn.push([cx + Math.cos(a) * (R - w), cy + Math.sin(a) * (R - w)]);
    }
    ctx.fillStyle = '#fff';
    poly(ctx, out.concat(inn.reverse()));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; // motion trails
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const rr = R + S * (0.04 + i * 0.035), b0 = a0 + rng() * 0.3, b1 = b0 + 0.5 + rng() * 0.9;
      ctx.lineWidth = (1.5 + rng() * 2.5) * (S / 512);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, b0, b1);
      ctx.stroke();
    }
  },
  burst(ctx, rng, S) {
    const cx = S / 2, cy = S / 2, n = 8 + Math.floor(rng() * 5), pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.3;
      const ro = S * (0.26 + rng() * 0.16), ri = S * (0.09 + rng() * 0.05);
      pts.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]);
      const a2 = a + Math.PI / n;
      pts.push([cx + Math.cos(a2) * ri, cy + Math.sin(a2) * ri]);
    }
    ctx.fillStyle = '#fff';
    poly(ctx, pts);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.075, 0, 7);
    ctx.fill();
  },
  shield(ctx, rng, S) {
    const cx = S / 2, cy = S / 2, w = S * (0.46 + rng() * 0.06), h = S * (0.56 + rng() * 0.06);
    function path(sc) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - h * 0.5 * sc);
      ctx.quadraticCurveTo(cx + w * 0.5 * sc, cy - h * 0.42 * sc, cx + w * 0.5 * sc, cy - h * 0.05 * sc);
      ctx.quadraticCurveTo(cx + w * 0.5 * sc, cy + h * 0.3 * sc, cx, cy + h * 0.5 * sc);
      ctx.quadraticCurveTo(cx - w * 0.5 * sc, cy + h * 0.3 * sc, cx - w * 0.5 * sc, cy - h * 0.05 * sc);
      ctx.quadraticCurveTo(cx - w * 0.5 * sc, cy - h * 0.42 * sc, cx, cy - h * 0.5 * sc);
      ctx.closePath();
    }
    ctx.fillStyle = '#fff'; path(1); ctx.fill();               // bright border
    ctx.fillStyle = 'rgb(115,115,115)'; path(0.8); ctx.fill(); // body
    ctx.save(); path(0.8); ctx.clip();                         // lit half
    ctx.fillStyle = 'rgb(175,175,175)';
    ctx.fillRect(cx - w / 2, cy - h / 2, w / 2, h);
    ctx.restore();
    ctx.fillStyle = 'rgb(235,235,235)';                        // gem
    poly(ctx, [[cx, cy - h * 0.16], [cx + w * 0.12, cy], [cx, cy + h * 0.16], [cx - w * 0.12, cy]]);
    ctx.fill();
  },
  orb(ctx, rng, S) {
    const cx = S / 2, cy = S / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.14, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgb(160,160,160)';
    ctx.lineWidth = S * 0.012;
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.24, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) { // comet streaks
      const a = rng() * Math.PI * 2, len = S * (0.1 + rng() * 0.18);
      ctx.lineWidth = (2 + rng() * 5) * (S / 512);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * S * 0.16, cy + Math.sin(a) * S * 0.16);
      ctx.lineTo(cx + Math.cos(a) * (S * 0.16 + len), cy + Math.sin(a) * (S * 0.16 + len));
      ctx.stroke();
    }
  },
  rune(ctx, rng, S) {
    const cx = S / 2, cy = S / 2, R = S * 0.29;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = S * 0.028;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    const n = 6 + Math.floor(rng() * 5);
    ctx.lineWidth = S * 0.014;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
      ctx.lineTo(cx + Math.cos(a) * R * 1.18, cy + Math.sin(a) * R * 1.18);
      ctx.stroke();
    }
    const a0 = rng() * Math.PI * 2; // inner sigil
    ctx.lineWidth = S * 0.02;
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.62, y = cy + Math.sin(a) * R * 0.62;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, S * 0.045, 0, 7); ctx.fill();
  },
};

/**
 * Glyph registry — hybrid procedural + PNG. Procedural entries draw with the
 * shared rng; PNG entries are pre-registered images/canvases (see
 * registerPngGlyph) drawn into the same slot, so the rest of the pipeline
 * applies to them unchanged.
 * @type {Record<string, {kind:'proc', draw:Function} | {kind:'png', image:any}>}
 */
const GLYPHS = {};
for (const id in PROC_GLYPHS) GLYPHS[id] = { kind: 'proc', draw: PROC_GLYPHS[id] };

/**
 * Fraction of the icon size a PNG glyph's longer side is scaled to. Procedural
 * glyphs draw their subject at roughly this span, and the vignette (stage 5)
 * starts darkening past ~0.52·S radius — alpha-tight art larger than this
 * would push its luminance into the rim.
 */
const PNG_GLYPH_FIT = 0.66;

/**
 * Register a PNG (or canvas) glyph. Art spec: white/gray luminance art on a
 * TRANSPARENT background (the pipeline treats the glyph as a light source —
 * dark pixels emit nothing), consistent top-left lighting. Any size/aspect:
 * the image is contain-fit by aspect into the safe circle (PNG_GLYPH_FIT), so
 * alpha-tight crops need no 512px-square framing. Must be loaded BEFORE any
 * render that uses it (preload through AssetManager at boot — see
 * pngGlyphs.registerPngGlyphsFromAssets) — renderIcon stays synchronous.
 * @param {string} id
 * @param {HTMLImageElement|HTMLCanvasElement} image
 */
export function registerPngGlyph(id, image) {
  GLYPHS[id] = { kind: 'png', image };
}

/** Draw the recipe's glyph onto a fresh canvas (white on transparent). */
function drawGlyphCanvas(recipe, rng, S) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const entry = GLYPHS[recipe.glyph] || GLYPHS.orb;
  if (entry.kind === 'png' && entry.image) {
    const img = entry.image;
    const iw = img.width || S;
    const ih = img.height || S;
    const scale = (S * PNG_GLYPH_FIT) / Math.max(iw, ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
  } else if (entry.kind === 'proc') {
    entry.draw(ctx, rng, S);
  } else {
    GLYPHS.orb.draw(ctx, rng, S);
  }
  return cv;
}

// ═══════════════════════════════════════════════════════════
// Overlays — white art on transparent, reads against any glyph
// ═══════════════════════════════════════════════════════════

/** Overlay draw functions: (ctx, rng, S, glyphCv). */
export const OVERLAYS = {
  wild(ctx, rng, S) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      let r = S * (0.18 + rng() * 0.1);
      let x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      ctx.lineWidth = (1 + rng() * 3) * (S / 512);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        r += S * (0.03 + rng() * 0.05);
        const ja = a + (rng() - 0.5) * 0.9;
        x = S / 2 + Math.cos(ja) * r;
        y = S / 2 + Math.sin(ja) * r;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  greater(ctx, rng, S, glyphCv) {
    // Glyph echo — scaled-up ghost of the glyph behind the main bloom.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.filter = `blur(${Math.round(6 * (S / 512))}px)`;
    const sc = 1.45, off = (S - S * sc) / 2;
    ctx.drawImage(glyphCv, off, off, S * sc, S * sc);
    ctx.restore();
  },
  sparks(ctx, rng, S) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2, r = S * (0.12 + rng() * 0.32);
      ctx.globalAlpha = 0.3 + rng() * 0.7;
      ctx.beginPath();
      ctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, (0.8 + rng() * 2.6) * (S / 512), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  streaks_h(ctx, rng, S) { drawStreaks(ctx, rng, S, false); },
  streaks_v(ctx, rng, S) { drawStreaks(ctx, rng, S, true); },
  cage(ctx, rng, S) {
    // Containment bars + binding arcs (the "lock" read).
    const cx = S / 2, cy = S / 2, R = S * 0.34;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineCap = 'round';
    const bars = 4;
    for (let i = 0; i < bars; i++) {
      const fx = -0.6 + (1.2 * i) / (bars - 1) + (rng() - 0.5) * 0.06;
      const x = cx + fx * R;
      const half = Math.sqrt(Math.max(0, 1 - fx * fx)) * R;
      ctx.lineWidth = (3 + rng() * 3) * (S / 512);
      ctx.beginPath();
      ctx.moveTo(x, cy - half);
      ctx.lineTo(x, cy + half);
      ctx.stroke();
    }
    ctx.lineWidth = (4 + rng() * 2) * (S / 512);
    for (const fy of [-0.45, 0.45]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + fy * R, R * 0.95, R * 0.28, 0, 0, 7);
      ctx.stroke();
    }
  },
};

/** Shared row/column motion-line drawing (horizontal or vertical). */
function drawStreaks(ctx, rng, S, vertical) {
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const off = S / 2 + (rng() - 0.5) * S * 0.45; // perpendicular offset
    const a0 = S * (0.06 + rng() * 0.12);
    const a1 = S - S * (0.06 + rng() * 0.12);
    ctx.lineWidth = (1.5 + rng() * 3.5) * (S / 512);
    ctx.globalAlpha = 0.4 + rng() * 0.6;
    ctx.beginPath();
    if (vertical) { ctx.moveTo(off, a0); ctx.lineTo(off, a1); }
    else { ctx.moveTo(a0, off); ctx.lineTo(a1, off); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ═══════════════════════════════════════════════════════════
// Rims — rarity variants (metallic band gradient colors)
// ═══════════════════════════════════════════════════════════

/** Rim id → [light, mid, dark] band gradient stops. */
export const RIMS = Object.freeze({
  iron:   ['#8d9094', '#43464b', '#1a1c1f'],
  bronze: ['#a39684', '#4a4138', '#241f1a'],
  gold:   ['#d8b25a', '#7a5c1e', '#2e2410'],
  arcane: ['#b39ad1', '#503a6e', '#1d1430'],
});

// ═══════════════════════════════════════════════════════════
// The compositor
// ═══════════════════════════════════════════════════════════

/**
 * Render an IconRecipe into a new canvas. Synchronous (PNG glyphs must be
 * pre-registered). ~50–120ms at 512 — render once and cache (spellIcons.js).
 *
 * @param {object} recipe — an IconRecipe from spellIconRecipe.resolveRecipe()
 * @param {number} [size=ICON_NATIVE_SIZE]
 * @returns {HTMLCanvasElement}
 */
export function renderIcon(recipe, size = ICON_NATIVE_SIZE) {
  const S = size;
  const k = S / 512; // blur/linewidth scale factor relative to the tuned 512 base
  const srng = new SeededRNG(recipe.seed >>> 0);
  const rng = () => srng.next();

  const lum = document.createElement('canvas');
  lum.width = lum.height = S;
  const lctx = lum.getContext('2d', { willReadFrequently: true });

  // Fixed rng call order — part of the icon format: clouds → glyph → overlays.
  const clouds = cloudCanvas(rng, recipe.bgStyle === 'ridged');
  const glyphCv = drawGlyphCanvas(recipe, rng, S);
  const overlayCvs = (recipe.overlays || []).map((id) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const fn = OVERLAYS[id];
    if (fn) fn(cv.getContext('2d'), rng, S, glyphCv);
    return cv;
  });

  // 1. cloud background
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, S, S);
  lctx.imageSmoothingEnabled = true;
  lctx.drawImage(clouds, 0, 0, S, S);

  // 2. light the clouds with the glyph's glow (multiply by base + blurred glyph)
  const light = document.createElement('canvas');
  light.width = light.height = S;
  const litx = light.getContext('2d');
  litx.fillStyle = 'rgb(55,55,55)';
  litx.fillRect(0, 0, S, S);
  litx.globalCompositeOperation = 'lighter';
  litx.filter = `blur(${Math.round(70 * k)}px)`;
  litx.drawImage(glyphCv, 0, 0);
  litx.filter = `blur(${Math.round(28 * k)}px)`;
  litx.globalAlpha = 0.8;
  litx.drawImage(glyphCv, 0, 0);
  lctx.globalCompositeOperation = 'multiply';
  lctx.drawImage(light, 0, 0);

  // 3. additive bloom: wide → tight → sharp core
  lctx.globalCompositeOperation = 'lighter';
  for (const [blur, alpha] of [[36, 0.85], [14, 0.9], [5, 1], [0, 1]]) {
    lctx.filter = blur ? `blur(${Math.max(1, Math.round(blur * k))}px)` : 'none';
    lctx.globalAlpha = alpha;
    lctx.drawImage(glyphCv, 0, 0);
  }

  // 4. overlays, additive with a soft pass + sharp pass
  for (const cv of overlayCvs) {
    lctx.filter = `blur(${Math.max(1, Math.round(6 * k))}px)`;
    lctx.globalAlpha = 0.7;
    lctx.drawImage(cv, 0, 0);
    lctx.filter = 'none';
    lctx.globalAlpha = 1;
    lctx.drawImage(cv, 0, 0);
  }
  lctx.filter = 'none';
  lctx.globalAlpha = 1;

  // 5. vignette
  lctx.globalCompositeOperation = 'multiply';
  const vg = lctx.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.52);
  vg.addColorStop(0, '#ffffff');
  vg.addColorStop(0.75, '#cfcfcf');
  vg.addColorStop(1, '#3a3a3a');
  lctx.fillStyle = vg;
  lctx.fillRect(0, 0, S, S);
  lctx.globalCompositeOperation = 'source-over';

  // 6. gradient-map LUT: luminance → palette color
  const img = lctx.getImageData(0, 0, S, S);
  const d = img.data;
  const lut = LUTS[recipe.palette] || LUTS.arcane;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i]; // grayscale, so red channel == luminance
    d[i] = lut[v * 3];
    d[i + 1] = lut[v * 3 + 1];
    d[i + 2] = lut[v * 3 + 2];
    d[i + 3] = 255;
  }

  // 7. circular clip + beveled rim
  const target = document.createElement('canvas');
  target.width = target.height = S;
  const ctx = target.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 32 * k, 0, 7);
  ctx.clip();
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = S;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();

  const band = RIMS[recipe.rim] || RIMS.iron;
  const rings = [
    [S / 2 - 10 * k, 18 * k, '#060504'],
    [S / 2 - 24 * k, 13 * k, null], // metallic band (gradient)
    [S / 2 - 33 * k, 6 * k, '#15110d'],
  ];
  for (const [r, w, col] of rings) {
    ctx.lineWidth = w;
    if (col) {
      ctx.strokeStyle = col;
    } else {
      const g = ctx.createLinearGradient(S * 0.2, 0, S * 0.8, S);
      g.addColorStop(0, band[0]);
      g.addColorStop(0.5, band[1]);
      g.addColorStop(1, band[2]);
      ctx.strokeStyle = g;
    }
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, r, 0, 7);
    ctx.stroke();
  }
  // Hairline highlight — tinted by the secondary element when present.
  const accent = recipe.secondaryPalette ? paletteAccent(recipe.secondaryPalette) : null;
  ctx.lineWidth = 2 * k;
  if (accent) {
    const [ar, ag, ab] = hexToRgb(accent);
    ctx.strokeStyle = `rgba(${ar},${ag},${ab},.45)`;
  } else {
    ctx.strokeStyle = 'rgba(255,235,200,.22)';
  }
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 37 * k, 0, 7);
  ctx.stroke();

  return target;
}
