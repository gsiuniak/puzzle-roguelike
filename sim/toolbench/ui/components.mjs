/**
 * toolbench/ui/components.mjs — shared widgets: the WEIGH SCALE (hero),
 * combatant editor panels, AI selectors, progress row.
 *
 * The weigh scale (design §4.1.1): tilt = logit(measured win rate), CI wedge
 * at the pivot = the Wilson interval rendered as possible beam angles, green
 * band arc = the enemy-slot fair band, pans = each side's measured power
 * composite broken into damage-source ingots. While a batch streams in, the
 * beam wobbles with an amplitude tied to the CI width and settles as it
 * narrows — the Monte-Carlo convergence IS the weighing motion.
 */

import { $, $$, h, esc, pct, pct1, f1, MANA_COLORS, COLOR_CSS } from './util.mjs';
import {
  store, customs, allEnemyDefs, customSkillById, customRelicById,
  AI_CHOICES, ENEMY_AI_CHOICES, champion, custom, parseCustomWeights,
  RELIC_CATALOG, CHARACTERS_BY_ID,
} from './store.mjs';
import { makePlayerCombatant, makeEnemyCombatant } from '../engine.mjs';

/* ═══════════════════════════ the weigh scale ═══════════════════════════ */

const MAX_ANGLE = 13;                // degrees at the logit clamp
const LOGIT_REF = Math.log(0.965 / 0.035); // win rate that pins the beam
const logit = (p) => Math.log(Math.max(1e-4, Math.min(1 - 1e-4, p)) / (1 - Math.max(1e-4, Math.min(1 - 1e-4, p))));
// NEGATIVE when the player is favored: the beam's LEFT (player) end is drawn at
// PY − ARM·sin(a), so a negative angle sinks the player pan — heavier side DOWN.
const angleFor = (win) => -Math.max(-1, Math.min(1, logit(win) / LOGIT_REF)) * MAX_ANGLE;

const PAN_PALETTE = {
  skull: 'var(--t-skull)', skill: 'var(--signal)', skullDestroy: '#E08A4A',
  passive: 'var(--t-green)', poisonTick: 'var(--t-green)', echo: 'var(--t-yellow)',
  bleed: 'var(--t-red)', hit: 'var(--ink-3)', consume: 'var(--t-purple)', reflect: 'var(--t-blue)',
};
const ENEMY_PAN_PALETTE = { ...PAN_PALETTE, skill: 'var(--t-red)' };

/**
 * Mount the scale into `container`. Returns { update(state) }.
 * state: {
 *   winRate, ciLo, ciHi, n, running,          // outcome (drives the tilt)
 *   band: [lo,hi] | null,                     // fair band for the enemy slot
 *   left:  { name, power, parts:{src:amt} },  // player pan (descriptive)
 *   right: { name, power, parts:{src:amt} },  // enemy pan
 *   ghost: { winRate, label } | null,         // second bracket needle
 *   idle: bool                                // nothing measured yet
 * }
 */
export function weighScale(container) {
  const W = 660, H = 330, PX = W / 2, PY = 96, ARM = 252, DROP = 74;
  const el = h(`<div class="scale-wrap"><svg viewBox="0 0 ${W} ${H}" class="scale-svg"></svg></div>`);
  container.appendChild(el);
  const svg = $('svg', el);

  let target = null;       // latest state
  let shown = 0;           // displayed angle (smoothed)
  let raf = null, t0 = performance.now();

  function arcPath(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  const rad = (deg) => (deg * Math.PI) / 180;

  function panSvg(cx, cy, side, pan, palette) {
    const trayW = 128, trayH = 10, stackW = 92;
    let g = '';
    // strings from beam end down to the tray
    g += `<line x1="${cx - trayW / 2 + 8}" y1="${cy - DROP + 4}" x2="${cx - trayW / 2 + 14}" y2="${cy}" stroke="var(--line-2)" stroke-width="1.4"/>`;
    g += `<line x1="${cx + trayW / 2 - 8}" y1="${cy - DROP + 4}" x2="${cx + trayW / 2 - 14}" y2="${cy}" stroke="var(--line-2)" stroke-width="1.4"/>`;
    g += `<line x1="${cx}" y1="${cy - DROP}" x2="${cx}" y2="${cy - DROP + 6}" stroke="var(--line-2)" stroke-width="1.4"/>`;
    // ingot stack (damage-source composition), drawn sitting ON the tray
    const parts = Object.entries(pan.parts || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
    const stackH = Math.max(10, Math.min(46, (pan.power || 0) * 2.4));
    let y = cy - 2;
    for (const [k, v] of parts) {
      const hgt = Math.max(3, (v / total) * stackH);
      y -= hgt;
      g += `<rect x="${cx - stackW / 2}" y="${y.toFixed(1)}" width="${stackW}" height="${(hgt - 1).toFixed(1)}" rx="2" fill="${palette[k] || 'var(--ink-3)'}" opacity=".85"><title>${esc(k)}: ${pct(v / total)}</title></rect>`;
    }
    // tray
    g += `<path d="M${cx - trayW / 2},${cy} h${trayW} l-9,${trayH} h-${trayW - 18} z" fill="var(--panel-2)" stroke="var(--line-2)" stroke-width="1.2"/>`;
    // labels
    const col = side === 'l' ? 'var(--signal)' : 'var(--t-red)';
    g += `<text x="${cx}" y="${cy + trayH + 16}" text-anchor="middle" style="font-size:11px;font-weight:600" fill="${col}">${esc(pan.name || '')}</text>`;
    g += `<text x="${cx}" y="${cy + trayH + 31}" text-anchor="middle" class="mono" style="font-size:12px;font-weight:700" fill="var(--ink)">${pan.power != null ? f1(pan.power) : '—'}<tspan fill="var(--ink-3)" style="font-size:9px;font-weight:400"> pwr</tspan></text>`;
    return g;
  }

  function render(angle, s) {
    const a = rad(angle);
    const exL = PX - ARM * Math.cos(a), eyL = PY - ARM * Math.sin(a);
    const exR = PX + ARM * Math.cos(a), eyR = PY + ARM * Math.sin(a);
    let g = '';

    // ── base: post + foot
    g += `<path d="M${PX - 46},${H - 14} h92 l-10,-10 h-72 z" fill="var(--panel-2)" stroke="var(--line-2)"/>`;
    g += `<rect x="${PX - 5}" y="${PY}" width="10" height="${H - 24 - PY}" rx="3" fill="var(--panel-2)" stroke="var(--line-2)"/>`;

    // ── fair band arc + 50% tick (behind the beam)
    // Arc parameter θ maps to a LEFT-end beam position at π+θ and a RIGHT-end
    // position at θ (left end of beam angle a sits at (PX−R·cos a, PY−R·sin a)
    // = the circle point at π+a), so both sides sweep [min,max] of the band's
    // beam angles directly.
    if (s.band) {
      const a0 = rad(angleFor(s.band[0])), a1 = rad(angleFor(s.band[1]));
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      g += `<path d="${arcPath(PX, PY, ARM + 16, Math.PI + lo, Math.PI + hi)}" stroke="var(--good)" stroke-width="4" fill="none" opacity=".45"/>`;
      g += `<path d="${arcPath(PX, PY, ARM + 16, lo, hi)}" stroke="var(--good)" stroke-width="4" fill="none" opacity=".45"/>`;
    }
    g += `<line x1="${PX - ARM - 24}" y1="${PY}" x2="${PX - ARM - 8}" y2="${PY}" stroke="var(--line-2)" stroke-width="1"/>`;
    g += `<line x1="${PX + ARM + 8}" y1="${PY}" x2="${PX + ARM + 24}" y2="${PY}" stroke="var(--line-2)" stroke-width="1"/>`;

    // ── CI wedge: the beam's possible angles at 95% confidence
    if (s.ciLo != null && s.ciHi != null && !s.idle) {
      const aLo = rad(angleFor(s.ciLo)), aHi = rad(angleFor(s.ciHi));
      const wedge = (r) => {
        const p0 = [PX - r * Math.cos(aLo), PY - r * Math.sin(aLo)];
        const p1 = [PX - r * Math.cos(aHi), PY - r * Math.sin(aHi)];
        return `M${PX},${PY} L${p0[0].toFixed(1)},${p0[1].toFixed(1)} A${r},${r} 0 0 ${aHi > aLo ? 0 : 1} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} z`
          + ` M${PX},${PY} L${(2 * PX - p0[0]).toFixed(1)},${(2 * PY - p0[1]).toFixed(1)} A${r},${r} 0 0 ${aHi > aLo ? 0 : 1} ${(2 * PX - p1[0]).toFixed(1)},${(2 * PY - p1[1]).toFixed(1)} z`;
      };
      g += `<path d="${wedge(ARM)}" fill="var(--signal)" opacity=".07"/>`;
    }

    // ── ghost needle (other bracket)
    if (s.ghost && s.ghost.winRate != null) {
      const ga = rad(angleFor(s.ghost.winRate));
      g += `<line x1="${(PX - ARM * Math.cos(ga)).toFixed(1)}" y1="${(PY - ARM * Math.sin(ga)).toFixed(1)}" x2="${(PX + ARM * Math.cos(ga)).toFixed(1)}" y2="${(PY + ARM * Math.sin(ga)).toFixed(1)}" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="6 5" opacity=".6"><title>${esc(s.ghost.label || 'other bracket')}: ${pct1(s.ghost.winRate)}</title></line>`;
    }

    // ── beam + pans
    g += `<line x1="${exL.toFixed(1)}" y1="${eyL.toFixed(1)}" x2="${exR.toFixed(1)}" y2="${eyR.toFixed(1)}" stroke="var(--ink-2)" stroke-width="5" stroke-linecap="round"/>`;
    g += `<line x1="${exL.toFixed(1)}" y1="${eyL.toFixed(1)}" x2="${exR.toFixed(1)}" y2="${eyR.toFixed(1)}" stroke="var(--signal)" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>`;
    g += panSvg(exL, eyL + DROP, 'l', s.left || {}, PAN_PALETTE);
    g += panSvg(exR, eyR + DROP, 'r', s.right || {}, ENEMY_PAN_PALETTE);

    // ── pivot cap + headline
    g += `<circle cx="${PX}" cy="${PY}" r="8" fill="var(--panel-2)" stroke="var(--signal)" stroke-width="1.6"/>`;
    if (s.idle) {
      g += `<text x="${PX}" y="${PY - 44}" text-anchor="middle" class="mono" style="font-size:13px" fill="var(--ink-3)">press WEIGH</text>`;
    } else {
      g += `<text x="${PX}" y="${PY - 46}" text-anchor="middle" class="mono" style="font-size:26px;font-weight:700" fill="var(--ink)">${pct1(s.winRate)}</text>`;
      const ciTxt = s.ciLo != null ? `${pct(s.ciLo)}–${pct(s.ciHi)} CI` : '';
      g += `<text x="${PX}" y="${PY - 30}" text-anchor="middle" class="mono" style="font-size:9.5px" fill="var(--ink-3)">player win · n=${s.n || 0}${s.running ? ' · weighing…' : ''} ${ciTxt ? '· ' + ciTxt : ''}</text>`;
    }
    svg.innerHTML = g;
  }

  function tick(now) {
    raf = null;
    if (!target) return;
    const s = target;
    const tgt = s.idle ? 0 : angleFor(s.winRate || 0.5);
    // wobble amplitude tracks the CI width — unsettled looks unsettled
    const ciW = (s.ciHi != null && s.ciLo != null) ? (s.ciHi - s.ciLo) : (s.running ? 0.5 : 0);
    const wobble = s.running ? Math.sin((now - t0) / 130) * Math.min(5, ciW * 26) : 0;
    shown += (tgt - shown) * 0.14;
    render(shown + wobble, s);
    if (s.running || Math.abs(tgt - shown) > 0.05) raf = requestAnimationFrame(tick);
  }

  return {
    update(state) {
      target = state;
      if (!raf) raf = requestAnimationFrame(tick);
    },
  };
}

/* ═══════════════════════ combatant editor panels ═══════════════════════ */

/** Player build editor bound to a player-cfg section object. */
export function playerPanel(p, onChange, { title = 'Player' } = {}) {
  const chars = Object.values(CHARACTERS_BY_ID);
  const relics = [...Object.values(RELIC_CATALOG).filter((r) => r.rarity !== 'starter'), ...customs.relics];
  const el = h(`<div class="panel"><div class="eyebrow"><span class="ix">◈</span>${esc(title)}</div>
    <div class="row">
      <div><label class="f">Character</label><select data-k="characterId">
        ${chars.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.className)})</option>`).join('')}</select></div>
      <div><label class="f">Victories <span class="hint">growth</span></label><input type="number" data-k="victories" min="0" max="14" step="1"></div>
    </div>
    <div class="row">
      <div><label class="f">Δ HP</label><input type="number" data-d="maxHp" step="1"></div>
      <div><label class="f">Δ Atk</label><input type="number" data-d="attack" step="1"></div>
      <div><label class="f">Δ Mag</label><input type="number" data-d="magic" step="1"></div>
      <div><label class="f">Δ Armor</label><input type="number" data-d="armor" step="1"></div>
    </div>
    <label class="f">Relics</label>
    <div class="checks" data-relics>
      ${relics.map((r) => `<label><input type="checkbox" value="${r.id}" data-custom="${!!customRelicById(r.id)}"> ${esc(r.name)} <span class="hint">${r.rarity}${customRelicById(r.id) ? '·custom' : ''}</span></label>`).join('')}
    </div>
    <div data-extra-skills></div>
    <div class="note" data-preview style="margin-top:8px"></div>
  </div>`);

  function renderExtraSkills() {
    const box = $('[data-extra-skills]', el);
    const woven = store.wovenSkills;
    if (!customs.skills.length && !woven.length) {
      box.innerHTML = `<label class="f">Woven skills</label>
        <div class="note">none yet — weave one in the <b>Weave</b> tab and press "Add to build"; it appears here (persists across reloads).</div>`;
      return;
    }
    const costStr = (sk) => Object.entries(sk.cost || {}).map(([c, v]) => `${v}${c[0]}`).join('+') || 'free';
    box.innerHTML = `<label class="f">Extra skills <span class="hint">custom + woven — ticked = in the build</span></label>
      <div class="checks">
        ${customs.skills.map((s) => `<label><input type="checkbox" data-cskill value="${s.id}"> ${esc(s.name)} <span class="hint">custom</span></label>`).join('')}
        ${woven.map((wsk, i) => `<label title="${esc((wsk.recipe || []).join(' + '))}"><input type="checkbox" data-woven value="${i}"> ${esc(wsk.skill.name)}
          <span class="hint">woven · ${esc(costStr(wsk.skill))}</span>
          <span data-woven-x="${i}" style="margin-left:auto;color:var(--ink-3);cursor:pointer;font-weight:700" title="delete this woven skill">✕</span></label>`).join('')}
      </div>`;
    $$('[data-cskill]', box).forEach((i) => { i.checked = (p.customSkillIds || []).includes(i.value); });
    $$('[data-woven]', box).forEach((i) => { i.checked = (p.wovenSkillIdx || []).includes(Number(i.value)); });
    $$('[data-woven-x]', box).forEach((x) => x.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const idx = Number(x.dataset.wovenX);
      const isStoreCfg = p === store.cfg.player; // removeWoven already fixes the store's own indexes
      store.removeWoven(idx);
      if (!isStoreCfg) {
        // Compare-column clones hold their own index arrays — fix them too
        p.wovenSkillIdx = (p.wovenSkillIdx || []).filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i));
      }
      renderExtraSkills();
      preview();
      onChange && onChange();
    }));
  }

  function read() {
    p.characterId = $('[data-k=characterId]', el).value;
    p.victories = Number($('[data-k=victories]', el).value) || 0;
    for (const d of ['maxHp', 'attack', 'magic', 'armor']) p.statDelta[d] = Number($(`[data-d=${d}]`, el).value) || 0;
    p.relicIds = $$('[data-relics] input:checked', el).filter((i) => i.dataset.custom !== 'true').map((i) => i.value);
    p.customRelicIds = $$('[data-relics] input:checked', el).filter((i) => i.dataset.custom === 'true').map((i) => i.value);
    p.customSkillIds = $$('[data-cskill]:checked', el).map((i) => i.value);
    p.wovenSkillIdx = $$('[data-woven]:checked', el).map((i) => Number(i.value));
    preview();
    onChange && onChange();
  }

  function preview() {
    try {
      const c = makePlayerCombatant(store.playerPayload(p));
      $('[data-preview]', el).innerHTML =
        `→ <b>${esc(c.name)}</b> · HP <b>${c.maxHp}</b> · Atk <b>${c.attack}</b> · Mag <b>${c.magic}</b> · Armor <b>${c.armor}</b>`
        + ` · skills: ${c.skills.map((s) => esc(s.name)).join(', ') || '—'} · relics ${c.relics.length}`;
    } catch (err) { $('[data-preview]', el).textContent = String(err); }
  }

  function write() {
    $('[data-k=characterId]', el).value = p.characterId;
    $('[data-k=victories]', el).value = p.victories;
    for (const d of ['maxHp', 'attack', 'magic', 'armor']) $(`[data-d=${d}]`, el).value = p.statDelta[d];
    $$('[data-relics] input', el).forEach((i) => {
      i.checked = (p.relicIds || []).includes(i.value) || (p.customRelicIds || []).includes(i.value);
    });
    renderExtraSkills();
    preview();
  }

  el.addEventListener('change', read);
  write();
  return { el, write, refreshWoven: renderExtraSkills };
}

/** Enemy config editor bound to an enemy-cfg section object. */
export function enemyPanel(e, onChange, { title = 'Enemy', showFloor = true } = {}) {
  const defs = allEnemyDefs();
  const el = h(`<div class="panel"><div class="eyebrow enemy"><span class="ix">◆</span>${esc(title)}</div>
    <div class="row">
      <div style="flex:2"><label class="f">Enemy</label><select data-k="id">
        ${defs.map((d) => `<option value="${d.id}">${esc(d.name)} · ${d.type}${d._custom ? ' · custom' : ''}</option>`).join('')}</select></div>
      ${showFloor ? '<div><label class="f">Floor</label><input type="number" data-k="floor" min="1" max="10" step="1"></div>' : ''}
    </div>
    <div class="row">
      <div><label class="f">HP override <span class="hint">baseline</span></label><input type="number" data-k="hpOverride" placeholder="def"></div>
      <div><label class="f">Atk override <span class="hint">baseline</span></label><input type="number" data-k="attackOverride" placeholder="def"></div>
    </div>
    <div class="note" data-preview style="margin-top:8px"></div>
  </div>`);

  function read() {
    e.id = $('[data-k=id]', el).value;
    if (showFloor) e.floor = Math.max(1, Math.min(10, Number($('[data-k=floor]', el).value) || 1));
    const hp = $('[data-k=hpOverride]', el).value, atk = $('[data-k=attackOverride]', el).value;
    e.hpOverride = hp === '' ? null : Number(hp);
    e.attackOverride = atk === '' ? null : Number(atk);
    preview();
    onChange && onChange();
  }

  function preview() {
    try {
      const payload = store.enemyPayload(e);
      const en = makeEnemyCombatant(payload.def || payload.id, payload.floor, payload.overrides);
      const def = allEnemyDefs().find((d) => d.id === e.id) || {};
      $('[data-preview]', el).innerHTML =
        `→ <b>${esc(en.name)}</b> @ f${e.floor}: HP <b>${en.maxHp}</b> · Atk <b>${en.attack}</b> · Armor <b>${en.armor}</b>`
        + ` · floors ${def.floors && def.floors.length ? def.floors.join(',') : '—'}`
        + ` · skills: ${en.skills.map((s) => esc(s.name)).join(', ') || '—'} · relics: ${en.relics.map((r) => esc(r.name)).join(', ') || '—'}`;
    } catch (err) { $('[data-preview]', el).textContent = String(err); }
  }

  function write() {
    $('[data-k=id]', el).value = e.id;
    if (showFloor) $('[data-k=floor]', el).value = e.floor;
    $('[data-k=hpOverride]', el).value = e.hpOverride == null ? '' : e.hpOverride;
    $('[data-k=attackOverride]', el).value = e.attackOverride == null ? '' : e.attackOverride;
    preview();
  }

  el.addEventListener('change', read);
  write();
  return { el, write, preview };
}

/* ═══════════════════════════ AI selector ═══════════════════════════ */

export function aiSelector(side, onChange) {
  const choices = side === 'enemy' ? ENEMY_AI_CHOICES : AI_CHOICES;
  const el = h(`<div class="ai-select">
    <label class="f">${side === 'player' ? 'Player AI' : 'Enemy AI'}</label>
    <select data-ai>${choices.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}</select>
    <div class="hint" data-ai-note></div>
    <div data-ai-custom style="display:none">
      <textarea data-json placeholder='paste weights JSON ({"weights":{...}} or bare)' style="min-height:64px"></textarea>
      <input type="file" data-file accept=".json" style="margin-top:4px">
    </div>
  </div>`);
  const sel = $('[data-ai]', el);
  sel.value = store.cfg.ai[side];

  function note() {
    const key = sel.value;
    const c = choices.find((x) => x.key === key);
    let extra = '';
    if (key === 'hard') {
      if (champion.error) extra = ` ⚠ champion weights failed to load: ${champion.error}`;
      else if (champion.provenance) extra = ` · ${esc(JSON.stringify(champion.provenance).slice(0, 110))}`;
    }
    if (key === 'custom') {
      extra = custom.weights ? ` · loaded "${esc(custom.name)}" (${custom.kind}${custom.warning ? ' — ' + esc(custom.warning) : ''})` : ' · no weights loaded yet';
    }
    $('[data-ai-note]', el).innerHTML = (c ? esc(c.desc) : '') + extra;
    $('[data-ai-custom]', el).style.display = key === 'custom' ? '' : 'none';
  }

  sel.addEventListener('change', () => {
    store.cfg.ai[side] = sel.value;
    note();
    onChange && onChange();
  });
  $('[data-json]', el).addEventListener('change', (ev) => {
    try {
      const r = parseCustomWeights(JSON.parse(ev.target.value), 'pasted');
      if (r.error) throw new Error(r.error);
      note(); onChange && onChange();
    } catch (err) { $('[data-ai-note]', el).textContent = 'JSON error: ' + err.message; }
  });
  $('[data-file]', el).addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const r = parseCustomWeights(JSON.parse(await f.text()), f.name);
      if (r.error) throw new Error(r.error);
      note(); onChange && onChange();
    } catch (err) { $('[data-ai-note]', el).textContent = 'file error: ' + err.message; }
  });
  note();
  return { el, note };
}

/* ═══════════════════════════ progress row ═══════════════════════════ */

export function progressRow({ runLabel = 'Weigh', onRun, onCancel }) {
  const el = h(`<div class="row" style="margin:10px 0">
    <div class="fix"><button class="btn primary" data-run>${esc(runLabel)}</button></div>
    <div class="fix"><button class="btn" data-cancel disabled>Cancel</button></div>
    <div style="align-self:center"><div class="progress"><i data-prog></i></div></div>
    <div class="fix hint mono" data-status style="align-self:center;min-width:120px"></div>
  </div>`);
  $('[data-run]', el).addEventListener('click', () => onRun && onRun());
  $('[data-cancel]', el).addEventListener('click', () => onCancel && onCancel());
  return {
    el,
    progress(f) { $('[data-prog]', el).style.width = pct(f); },
    status(s) { $('[data-status]', el).textContent = s; },
    running(is) { $('[data-run]', el).disabled = is; $('[data-cancel]', el).disabled = !is; if (!is) $('[data-prog]', el).style.width = '0%'; },
  };
}
