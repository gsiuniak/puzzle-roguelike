/** toolbench/ui/util.mjs — DOM + formatting helpers (Balance Bench). */

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const pct = (x, d = 0) => (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(d) + '%';
export const pct1 = (x) => pct(x, 1);
export const pp = (x, d = 1) => (x == null || !isFinite(x)) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp`;
export const f1 = (x) => (x == null || !isFinite(x)) ? '—' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
export const f2 = (x) => (x == null || !isFinite(x)) ? '—' : x.toFixed(2);
export const signed = (x, d = 1) => (x == null || !isFinite(x)) ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;

export const MANA_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
export const COLOR_CSS = {
  red: 'var(--t-red)', blue: 'var(--t-blue)', green: 'var(--t-green)',
  yellow: 'var(--t-yellow)', purple: 'var(--t-purple)', skull: 'var(--t-skull)',
};

export function tagFor(kind) { return `<span class="tag ${kind.cls}">${esc(kind.label)}</span>`; }

export function bandTag(value, [lo, hi], { lowIsBad = true } = {}) {
  if (value < lo) return { cls: lowIsBad ? 'bad' : 'info', label: 'under' };
  if (value > hi) return { cls: lowIsBad ? 'info' : 'bad', label: 'over' };
  return { cls: 'good', label: 'in band' };
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Tiny local PRNG (mulberry32) for DISPLAY-side deterministic picks —
 *  never swaps the global Math.random. */
export function localRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function downloadText(filename, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ── tiny SVG charts (palette-aware, adapted from the v1 toolbench) ── */

export function lineChart(seriesList, { w = 560, h = 200, xLabel = '', fmt = f1 } = {}) {
  const pad = { l: 42, r: 48, t: 14, b: 24 };
  const xs = seriesList[0].points.map((p) => p.x);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x) => pad.l + (xmax === xmin ? 0.5 : (x - xmin) / (xmax - xmin)) * (w - pad.l - pad.r);
  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">`;
  seriesList.forEach((s, si) => {
    const ys = s.points.map((p) => p.y).filter((y) => isFinite(y));
    let ymin = s.min != null ? s.min : Math.min(...ys), ymax = s.max != null ? s.max : Math.max(...ys);
    if (ymax === ymin) { ymax += 1; ymin -= 1; }
    const Y = (y) => h - pad.b - (y - ymin) / (ymax - ymin) * (h - pad.t - pad.b);
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    for (const p of s.points) svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${s.color}"/>`;
    const ax = si === 0 ? pad.l - 6 : w - pad.r + 6;
    const anchor = si === 0 ? 'end' : 'start';
    if (si < 2) {
      for (const t of [ymin, (ymin + ymax) / 2, ymax]) {
        svg += `<text x="${ax}" y="${(h - pad.b - (t - ymin) / (ymax - ymin) * (h - pad.t - pad.b)) + 3}" text-anchor="${anchor}" fill="${s.color}">${s.fmt ? s.fmt(t) : fmt(t)}</text>`;
      }
    }
    svg += `<text x="${pad.l + si * 90}" y="${pad.t - 3}" text-anchor="start" fill="${s.color}">${esc(s.name)}</text>`;
  });
  for (const x of xs) svg += `<text x="${X(x)}" y="${h - 8}" text-anchor="middle">${x}</text>`;
  svg += '</svg>';
  return svg + (xLabel ? `<div class="hint" style="text-align:center">${esc(xLabel)}</div>` : '');
}

export function histogram(values, { w = 320, h = 110, color = 'var(--signal)', label = '' } = {}) {
  if (!values.length) return '<div class="note">no data</div>';
  const min = Math.min(...values), max = Math.max(...values);
  const bins = Math.min(16, Math.max(5, Math.round(max - min) + 1));
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / ((max - min + 1e-9) / bins || 1)))]++;
  const peak = Math.max(...counts);
  const bw = (w - 30) / bins;
  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">`;
  counts.forEach((c, i) => {
    const bh = c / peak * (h - 30);
    svg += `<rect x="${15 + i * bw + 1}" y="${h - 18 - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" fill="${color}" opacity=".8" rx="1"/>`;
  });
  svg += `<text x="15" y="${h - 5}">${f1(min)}</text><text x="${w - 15}" y="${h - 5}" text-anchor="end">${f1(max)}</text></svg>`;
  return svg + (label ? `<div class="hint" style="text-align:center">${esc(label)}</div>` : '');
}

export function shareBars(shares, palette = {}) {
  const total = Object.values(shares).reduce((a, b) => a + b, 0) || 1;
  const names = {
    skull: 'skull matches', skill: 'skills', skullDestroy: 'destroyed skulls',
    passive: 'passives/relics', echo: 'echo', poisonTick: 'poison', bleed: 'bleed',
    reflect: 'reflect', hit: 'other', consume: 'consume',
  };
  return Object.entries(shares).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div class="kv"><span class="k">${esc(names[k] || k)}</span>
    <span style="flex:1;margin:5px 12px 0" class="bar"><i style="width:${(v / total * 100).toFixed(1)}%;background:${palette[k] || 'var(--signal)'}"></i></span>
    <span class="v">${pct(v / total)}</span></div>`).join('');
}
