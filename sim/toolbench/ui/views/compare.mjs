/**
 * toolbench/ui/views/compare.mjs — the COMPARE tab: paired A/B + relic table.
 *
 * Everything here is PAIRED on common seeds (trainer.mjs methodology): the
 * same seed runs both arms, so the per-pair win differences isolate the
 * change. ΔWin ± 95% CI from measure.mjs pairedStats; eqHP via the locally
 * measured win-per-HP slope on config A. The relic-table mode is a browser
 * mini-`trainer relics` scoped to the live context: every catalog relic
 * paired against config A, baseline shared.
 */

import { $, $$, h, esc, pct, pct1, pp, f1, f2, signed, tagFor } from '../util.mjs';
import { store, allEnemyDefs, specForChoice, AI_CHOICES, RELIC_CATALOG, customs } from '../store.mjs';
import { playerPanel, enemyPanel, weighScale, progressRow } from '../components.mjs';
import { runBattleArm, seedsFor, chunkFor, makeToken, hpSlope, armCacheKey, baselineArm } from '../sim.mjs';
import { pairedStats } from '../../measure.mjs';

const RARITY_BUDGET = { common: 0.03, uncommon: 0.06, rare: 0.12, legendary: 0.25, starter: 0.05 };
const DELTA_GAIN = 3; // beam gain for ΔWin display (±16pp ≈ full tilt)

function cloneCfg(c) { return structuredClone(c); }

function columnCfg(fromStore = true) {
  const src = fromStore ? store.cfg : null;
  return {
    player: src ? cloneCfg(src.player) : cloneCfg(store.cfg.player),
    enemy: src ? cloneCfg(src.enemy) : cloneCfg(store.cfg.enemy),
    aiKey: src ? src.ai.player : 'hard',
  };
}

export function compareView() {
  const el = h(`<div>
    <h2>Compare</h2>
    <p class="desc">Paired A/B on <b>common seeds</b> — change anything between the columns (a relic, the loadout,
    the AI bracket, an enemy tweak, a woven skill) and the per-pair differences isolate its effect.
    <b>ΔWin ± 95% CI</b> plus <b>eqHP</b> ("worth as much as +N max HP here", via the measured win-per-HP slope).</p>
    <div class="subtabs"><button data-st="ab" class="active">A / B</button><button data-st="relics">Relic table</button></div>
    <div data-body-ab></div>
    <div data-body-relics style="display:none"></div>
  </div>`);

  /* ═══════════════ A/B ═══════════════ */
  const A = columnCfg(), B = columnCfg();
  const abBody = $('[data-body-ab]', el);
  abBody.appendChild(h(`<div>
    <div class="row" style="align-items:flex-end;margin-bottom:10px">
      <div class="fix"><button class="btn" data-sync>Sync A from Bench</button></div>
      <div class="fix"><button class="btn" data-copy>Copy A → B</button></div>
      <div class="fix"><label class="f">Preset for B</label><select data-preset>
        <option value="">— pick a preset —</option>
        <option value="ai">AI: A simple vs B hard</option>
        <option value="atk">Enemy +1 baseline attack in B</option>
        <option value="floor">Floor +2 in B</option>
        <optgroup label="+ relic in B">${Object.values(RELIC_CATALOG).filter((r) => r.rarity !== 'starter').map((r) => `<option value="relic:${r.id}">${esc(r.name)} (${r.rarity})</option>`).join('')}</optgroup>
      </select></div>
      <div class="fix"><label class="f">Battles (paired)</label><input type="number" data-n value="300" min="60" step="100" style="width:90px"></div>
    </div>
    <div data-progress></div>
    <div class="grid g2">
      <div data-col-a></div>
      <div data-col-b></div>
    </div>
    <div class="panel" style="margin-top:14px" data-result-panel hidden>
      <div class="eyebrow"><span class="ix">⚖</span>Paired verdict <span class="right hint">beam gain ×${DELTA_GAIN} — tilt is ΔWin, not absolute win</span></div>
      <div data-scale></div>
      <div class="verdict" data-verdict></div>
      <div class="stats" data-stats style="margin-top:10px"></div>
      <div class="row" style="margin-top:8px"><div class="fix"><button class="btn" data-double>Double n & re-run</button></div></div>
    </div>
  </div>`));

  function aiSelect(current) {
    return `<div class="panel" style="margin-top:10px;padding:10px 14px"><label class="f">AI (player side)</label>
      <select data-colai>${AI_CHOICES.map((c) => `<option value="${c.key}"${c.key === current ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>`;
  }

  function buildColumn(container, cfgCol, label) {
    container.innerHTML = `<div class="col-head ${label === 'A' ? 'a' : 'b'}">CONFIG ${label}</div>`;
    const pp2 = playerPanel(cfgCol.player, null, { title: `Player ${label}` });
    const ep = enemyPanel(cfgCol.enemy, null, { title: `Enemy ${label}` });
    container.append(pp2.el, ep.el);
    const ai = h(aiSelect(cfgCol.aiKey));
    ai.addEventListener('change', () => { cfgCol.aiKey = $('[data-colai]', ai).value; });
    container.appendChild(ai);
    return { pp: pp2, ep };
  }
  let colA = buildColumn($('[data-col-a]', abBody), A, 'A');
  let colB = buildColumn($('[data-col-b]', abBody), B, 'B');

  $('[data-sync]', abBody).addEventListener('click', () => {
    Object.assign(A, columnCfg());
    colA = buildColumn($('[data-col-a]', abBody), A, 'A');
  });
  $('[data-copy]', abBody).addEventListener('click', () => {
    B.player = cloneCfg(A.player); B.enemy = cloneCfg(A.enemy); B.aiKey = A.aiKey;
    colB = buildColumn($('[data-col-b]', abBody), B, 'B');
  });
  $('[data-preset]', abBody).addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (!v) return;
    B.player = cloneCfg(A.player); B.enemy = cloneCfg(A.enemy); B.aiKey = A.aiKey;
    if (v === 'ai') { A.aiKey = 'simple'; B.aiKey = 'hard'; colA = buildColumn($('[data-col-a]', abBody), A, 'A'); }
    else if (v === 'atk') {
      const def = allEnemyDefs().find((d) => d.id === B.enemy.id) || {};
      B.enemy.attackOverride = (B.enemy.attackOverride != null ? B.enemy.attackOverride : (def.attack || 0)) + 1;
    } else if (v === 'floor') B.enemy.floor = Math.min(10, B.enemy.floor + 2);
    else if (v.startsWith('relic:')) {
      const id = v.slice(6);
      if (!B.player.relicIds.includes(id)) B.player.relicIds.push(id);
    }
    colB = buildColumn($('[data-col-b]', abBody), B, 'B');
    ev.target.value = '';
  });

  const abProg = progressRow({ runLabel: 'Run paired A/B', onRun: () => runAB(), onCancel: () => { abToken && (abToken.cancelled = true); } });
  $('[data-progress]', abBody).appendChild(abProg.el);
  let abScale = null, abToken = null;

  async function runAB() {
    abToken = makeToken();
    const n = Math.max(60, Number($('[data-n]', abBody).value) || 300);
    const seeds = seedsFor(`gems-compare|${A.enemy.id}|f${A.enemy.floor}`, n);
    const armFor = (col) => ({
      player: store.playerPayload(col.player),
      enemy: store.enemyPayload(col.enemy),
      playerSpec: specForChoice(col.aiKey),
      enemySpec: null,
      chunk: chunkFor(col.aiKey),
    });
    abProg.running(true);
    try {
      const t = abToken;
      const armA = armFor(A), armB = armFor(B);
      const resA = await runBattleArm({ ...armA, seeds, token: t, onProgress: (f) => abProg.progress(f * 0.4) });
      const resB = await runBattleArm({ ...armB, seeds, token: t, onProgress: (f) => abProg.progress(0.4 + f * 0.4) });
      const stats = pairedStats(resA, resB);
      // eqHP on config A's frame (skip if arms differ in enemy — slope frame ambiguous)
      let eq = null, slope = null;
      const sameFrame = JSON.stringify(A.enemy) === JSON.stringify(B.enemy);
      if (sameFrame) {
        const key = armCacheKey({ player: armA.player, enemy: armA.enemy, spec: armA.playerSpec, seedsNs: 'compare', n });
        slope = await hpSlope({ key, ...armA, seeds, token: t, onProgress: (f) => abProg.progress(0.8 + f * 0.2) });
        if (slope.slope >= 0.0015) eq = stats.dWin / slope.slope;
      }
      renderAB(stats, eq, slope, n);
    } catch (e) {
      if (!e || !e.cancelled) abProg.status('error: ' + (e && e.message || e));
    }
    abProg.running(false);
  }

  function renderAB(stats, eqHp, slope, n) {
    const panel = $('[data-result-panel]', abBody);
    panel.hidden = false;
    if (!abScale) abScale = weighScale($('[data-scale]', abBody));
    const disp = 0.5 + Math.max(-0.16, Math.min(0.16, -stats.dWin)) * DELTA_GAIN; // tilt LEFT (A) when A wins more
    abScale.update({
      winRate: disp, ciLo: disp - stats.ci95 * DELTA_GAIN, ciHi: disp + stats.ci95 * DELTA_GAIN,
      n, running: false, band: null,
      left: { name: `A · ${pct1(stats.winBase)}`, power: stats.winBase * 20, parts: { skill: 1 } },
      right: { name: `B · ${pct1(stats.winVar)}`, power: stats.winVar * 20, parts: { skill: 1 } },
      ghost: null,
    });
    const sig = Math.abs(stats.dWin) > stats.ci95;
    const chip = sig
      ? (stats.dWin > 0 ? { cls: 'good', label: 'B is stronger' } : { cls: 'bad', label: 'B is weaker' })
      : { cls: 'warn', label: 'not resolved at this n' };
    $('[data-verdict]', abBody).innerHTML = `${tagFor(chip)}
      <span><b>ΔWin ${pp(stats.dWin)} ± ${(stats.ci95 * 100).toFixed(1)}</b> (A ${pct1(stats.winBase)} → B ${pct1(stats.winVar)}, paired n=${stats.n}).
      ${sig ? '' : 'The CI straddles zero — double n or accept the effect is < ' + (stats.ci95 * 100).toFixed(1) + 'pp.'}
      ${eqHp != null ? `Worth ≈ <b>${signed(eqHp, 1)} max HP</b> on this frame (slope ${(slope.slope * 100).toFixed(2)}pp/HP).` : (slope ? 'Frame saturated — eqHP unreliable.' : 'eqHP skipped (enemies differ between arms).')}</span>`;
    $('[data-stats]', abBody).innerHTML = `
      <div class="stat"><div class="k">ΔTurns</div><div class="v">${signed(stats.dTurns, 2)}</div></div>
      <div class="stat"><div class="k">B casts/fight</div><div class="v">${f2(stats.castsPerFight)}</div></div>
      <div class="stat"><div class="k">ΔCasts</div><div class="v">${signed(stats.dCasts, 2)} ${Math.abs(stats.dCasts) < 0.05 && stats.dWin === 0 ? '<small>· added thing may never fire</small>' : ''}</div></div>
      <div class="stat"><div class="k">Paired n</div><div class="v">${stats.n}</div></div>`;
  }

  $('[data-double]', abBody).addEventListener('click', () => {
    const nEl = $('[data-n]', abBody);
    nEl.value = (Number(nEl.value) || 300) * 2;
    runAB();
  });

  /* ═══════════════ Relic table ═══════════════ */
  const relBody = $('[data-body-relics]', el);
  relBody.appendChild(h(`<div>
    <p class="desc">Every player-pool relic paired against <b>config A</b> (set it in the A/B sub-tab; defaults to
    the Bench build) on its current enemy/floor/AI. The baseline arm runs once and is shared — the whole catalog
    costs ~1 batch + 1 per relic. Verdict = ΔWin vs the rarity budget (common ≤3pp · uncommon ≤6 · rare ≤12 · legendary ≤25).</p>
    <div class="row" style="align-items:flex-end;margin-bottom:8px">
      <div class="fix"><label class="f">Battles / relic (paired)</label><input type="number" data-rn value="150" min="60" step="50" style="width:90px"></div>
      <div class="fix"><label class="f">&nbsp;</label><span class="hint mono" data-eta></span></div>
    </div>
    <div data-progress></div>
    <div class="panel"><div class="eyebrow">Relic uplift on this frame <span class="right hint" data-frame></span></div>
      <div class="scroll" style="max-height:640px"><table data-table></table></div>
    </div>
  </div>`));

  const relProg = progressRow({ runLabel: 'Measure all relics', onRun: () => runRelicTable(), onCancel: () => { relToken && (relToken.cancelled = true); } });
  $('[data-progress]', relBody).appendChild(relProg.el);
  let relToken = null;

  async function runRelicTable() {
    relToken = makeToken();
    const t = relToken;
    const n = Math.max(60, Number($('[data-rn]', relBody).value) || 150);
    const player = store.playerPayload(A.player);
    const enemy = store.enemyPayload(A.enemy);
    const spec = specForChoice(A.aiKey);
    const chunk = chunkFor(A.aiKey);
    const seeds = seedsFor(`gems-relictable|${A.enemy.id}|f${A.enemy.floor}`, n);
    const relics = [...Object.values(RELIC_CATALOG).filter((r) => r.rarity !== 'starter' && !player.relicIds.includes(r.id)), ...customs.relics];
    $('[data-frame]', relBody).textContent = `${player.characterId} v${player.victories} · AI ${A.aiKey} vs ${A.enemy.id} @ f${A.enemy.floor} · n=${n} paired`;
    $('[data-eta]', relBody).textContent = `${relics.length + 2} arms of ${n}`;
    relProg.running(true);

    const table = $('[data-table]', relBody);
    table.innerHTML = `<tr><th>Relic</th><th>Rarity</th><th class="num">ΔWin</th><th class="num">±CI</th><th class="num">eqHP</th><th class="num">ΔCasts</th><th>Verdict</th></tr>`;
    const rows = [];
    try {
      const baseKey = armCacheKey({ player, enemy, spec, seedsNs: 'relictable', n });
      const base = await baselineArm(baseKey + '|base', () =>
        runBattleArm({ player, enemy, playerSpec: spec, seeds, chunk, token: t, onProgress: (f) => relProg.progress(f / (relics.length + 2)) }));
      const slope = await hpSlope({ key: baseKey, player, enemy, playerSpec: spec, seeds, chunk, token: t, onProgress: (f) => relProg.progress((1 + f) / (relics.length + 2)) });
      for (let i = 0; i < relics.length; i++) {
        if (t.cancelled) throw { cancelled: true };
        const r = relics[i];
        const isCustom = !!customs.relics.find((x) => x.id === r.id);
        const varr = await runBattleArm({
          player: isCustom
            ? { ...player, customRelics: [...(player.customRelics || []), r] }
            : { ...player, relicIds: [...player.relicIds, r.id] },
          enemy, playerSpec: spec, seeds, chunk, token: t,
          onProgress: (f) => relProg.progress((2 + i + f) / (relics.length + 2)),
        });
        const s = pairedStats(base, varr);
        const eq = slope.slope >= 0.0015 ? s.dWin / slope.slope : null;
        const budget = RARITY_BUDGET[r.rarity] || 0.06;
        const sig = Math.abs(s.dWin) > s.ci95;
        const verdict = s.dWin > budget * 1.8 ? { cls: 'bad', label: 'over budget' }
          : (sig && s.dWin < -0.005) ? { cls: 'bad', label: 'harmful?' }
          : Math.abs(s.dCasts) < 0.02 && Math.abs(s.dWin) < 0.005 ? { cls: 'info', label: 'never fires?' }
          : !sig ? { cls: 'warn', label: 'unresolved' }
          : { cls: 'good', label: 'in budget' };
        rows.push({ r, s, eq, verdict });
        rows.sort((a, b) => b.s.dWin - a.s.dWin);
        table.innerHTML = `<tr><th>Relic</th><th>Rarity</th><th class="num">ΔWin</th><th class="num">±CI</th><th class="num">eqHP</th><th class="num">ΔCasts</th><th>Verdict</th></tr>`
          + rows.map(({ r: rr, s: ss, eq: ee, verdict: vv }) => `<tr>
            <td>${esc(rr.name)} <span class="hint">${esc(rr.id)}</span></td><td>${rr.rarity}${customs.relics.includes(rr) ? ' · custom' : ''}</td>
            <td class="num" style="color:${ss.dWin >= 0 ? 'var(--good)' : 'var(--bad)'}">${pp(ss.dWin)}</td>
            <td class="num">${(ss.ci95 * 100).toFixed(1)}</td>
            <td class="num">${ee != null ? signed(ee, 1) : '—'}</td>
            <td class="num">${signed(ss.dCasts, 2)}</td>
            <td>${tagFor(vv)}</td></tr>`).join('');
      }
      relProg.status(`done — baseline win ${pct1(rows.length ? pairedStats(base, base).winBase : 0)}`);
    } catch (e) {
      if (!e || !e.cancelled) relProg.status('error: ' + (e && e.message || e));
    }
    relProg.running(false);
  }

  /* sub-tab switch */
  $$('.subtabs button', el).forEach((b) => b.addEventListener('click', () => {
    $$('.subtabs button', el).forEach((x) => x.classList.toggle('active', x === b));
    abBody.style.display = b.dataset.st === 'ab' ? '' : 'none';
    relBody.style.display = b.dataset.st === 'relics' ? '' : 'none';
  }));

  return {
    el,
    onShow() {},
    onHide() { abToken && (abToken.cancelled = true); relToken && (relToken.cancelled = true); },
  };
}
