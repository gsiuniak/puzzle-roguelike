/**
 * toolbench/ui/views/runs.mjs — the RUNS tab: full-run lab.
 *
 * Full 10-floor runs via run-core.mjs in the workers (real reward RCT drops +
 * weave training floors), analyzed by run-analyze.mjs — the SAME math as
 * `node sim/toolbench/runs.mjs analyze`. Interop both ways: export the run
 * log as JSONL (same record shape as reports/), or import a CLI-produced
 * JSONL and view it here.
 */

import { $, h, esc, pct, pct1, pp, f1, tagFor, histogram, lineChart, downloadText, signed } from '../util.mjs';
import { store, specForChoice, AI_CHOICES, CHARACTERS_BY_ID } from '../store.mjs';
import { progressRow } from '../components.mjs';
import { runRuns, makeToken } from '../sim.mjs';
import { analyzeRuns } from '../../run-analyze.mjs';

export function runsView() {
  const el = h(`<div>
    <h2>Runs</h2>
    <p class="desc">Seeded, policy-driven <b>full 10-floor runs</b> — the top-level balance unit. The player starts
    with only the kit; relic rewards are the game's real rarity roll with a uniform-random pick (every reward node
    is a randomized trial), and weave floors run the real tag draft + synthesizer. Targets under the champion:
    warrior ≈ 50–60% survival, mage/WD within ~5pp, flattish death histogram.</p>
    <div class="row" style="align-items:flex-end;margin-bottom:10px">
      <div class="fix"><label class="f">Characters</label><select data-chars>
        <option value="all">all three</option>
        ${Object.values(CHARACTERS_BY_ID).map((c) => `<option value="${c.id}">${esc(c.name)} only</option>`).join('')}</select></div>
      <div class="fix"><label class="f">Runs / char</label><input type="number" data-n value="150" min="20" step="50" style="width:84px"></div>
      <div class="fix"><label class="f">Weave floors</label><input type="number" data-weaves value="2" min="0" max="4" style="width:64px"></div>
      <div class="fix"><label class="f">Player AI</label><select data-ai>${AI_CHOICES.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}</select></div>
      <div class="fix"><label class="f">Min events/arm</label><input type="number" data-min value="15" min="5" style="width:64px"></div>
      <div class="fix"><label class="f">&nbsp;</label><button class="btn" data-export disabled>Export JSONL</button></div>
      <div class="fix"><label class="f">Import CLI JSONL</label><input type="file" data-import accept=".jsonl,.json"></div>
    </div>
    <div data-progress></div>
    <div data-out></div>
  </div>`);

  $('[data-ai]', el).value = store.cfg.ai.player === 'custom' || store.cfg.ai.player === 'value' ? store.cfg.ai.player : store.cfg.ai.player;

  const prog = progressRow({ runLabel: 'Simulate runs', onRun: () => go(), onCancel: () => { token && (token.cancelled = true); } });
  $('[data-progress]', el).appendChild(prog.el);
  let token = null;
  let lastRecords = null;

  async function go() {
    token = makeToken();
    const t = token;
    const sel = $('[data-chars]', el).value;
    const chars = sel === 'all' ? Object.keys(CHARACTERS_BY_ID) : [sel];
    const n = Math.max(20, Number($('[data-n]', el).value) || 150);
    const weaveFloors = Math.max(0, Number($('[data-weaves]', el).value) || 0);
    const aiKey = $('[data-ai]', el).value;
    const playerSpec = specForChoice(aiKey);
    prog.running(true);
    const records = [{ type: 'meta', date: new Date().toISOString(), n, chars, policy: aiKey, weaveFloors, source: 'balance-bench' }];
    try {
      for (let ci = 0; ci < chars.length; ci++) {
        if (t.cancelled) throw { cancelled: true };
        prog.status(`${chars[ci]} · ${n} runs · AI ${aiKey}`);
        const recs = await runRuns({
          characterId: chars[ci], n, weaveFloors, playerSpec, token: t,
          onProgress: (f) => prog.progress((ci + f) / chars.length),
        });
        records.push(...recs);
        render(records);
      }
      prog.status('done');
    } catch (e) {
      if (!e || !e.cancelled) prog.status('error: ' + (e && e.message || e));
    }
    prog.running(false);
  }

  $('[data-export]', el).addEventListener('click', () => {
    if (!lastRecords) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadText(`runs-bench-${stamp}.jsonl`, lastRecords.map((r) => JSON.stringify(r)).join('\n') + '\n', 'application/x-ndjson');
  });
  $('[data-import]', el).addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const records = (await f.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      prog.status(`imported ${records.length} lines from ${f.name}`);
      render(records);
    } catch (err) { prog.status('import error: ' + err.message); }
  });

  function render(records) {
    lastRecords = records;
    $('[data-export]', el).disabled = false;
    const minN = Math.max(5, Number($('[data-min]', el).value) || 15);
    const res = analyzeRuns(records, { minN });
    const out = $('[data-out]', el);

    const charTiles = Object.entries(res.perChar).map(([id, cs]) => `
      <div class="stat"><div class="k">${esc(id)} survival</div>
      <div class="v" style="color:${cs.survived / cs.runs >= 0.4 ? 'var(--good)' : 'var(--warn)'}">${pct1(cs.survived / cs.runs)}</div>
      <div class="hint">n=${cs.runs} · ${(cs.victories / cs.runs).toFixed(1)} wins/run</div></div>`).join('');

    const deathFloors = [];
    for (const cs of Object.values(res.perChar)) for (const [f, k] of Object.entries(cs.deaths)) for (let i = 0; i < k; i++) deathFloors.push(Number(f));

    const floorKeys = Object.keys(res.floorFights).sort((a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]));
    const winPts = floorKeys.map((k) => ({ x: Number(k.split('|')[0]), y: res.floorFights[k].wins / res.floorFights[k].n }));

    const rctTable = (rows, kind) => rows.length ? `<table><tr><th>${kind}</th><th class="num">n</th><th class="num">ΔSurv</th><th class="num">±SE</th><th class="num">ΔFloors</th><th class="num">ΔNextWin</th><th></th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.id)}</td><td class="num">${r.n}</td>
        <td class="num" style="color:${r.dSurv >= 0 ? 'var(--good)' : 'var(--bad)'}">${pp(r.dSurv)}</td>
        <td class="num">${(r.seSurv * 100).toFixed(1)}</td>
        <td class="num">${signed(r.dProg, 2)}</td>
        <td class="num">${r.dNext != null ? pp(r.dNext) : '—'}</td>
        <td>${Math.abs(r.dSurv) > 2 * r.seSurv ? tagFor({ cls: r.dSurv > 0 ? 'good' : 'bad', label: 'significant' }) : ''}</td></tr>`).join('')}</table>`
      : '<div class="note">not enough events per arm — raise runs or lower min events</div>';

    out.innerHTML = `
      <div class="grid g2" style="margin-top:6px">
        <div class="panel">
          <div class="eyebrow">Run health ${res.meta ? `<span class="right hint">policy ${esc(res.meta.policy || '?')}</span>` : ''}</div>
          <div class="stats">${charTiles}</div>
          <div class="eyebrow" style="margin-top:12px">Death floors</div>
          ${histogram(deathFloors, { label: 'floor died on', color: 'var(--bad)' })}
        </div>
        <div class="panel">
          <div class="eyebrow">Per-floor fight win rate</div>
          ${lineChart([{ name: 'win %', color: 'var(--good)', points: winPts, min: 0, max: 1, fmt: (x) => pct(x) }], { xLabel: 'floor', w: 520, h: 200 })}
          <div class="hint" style="margin-top:6px">${floorKeys.map((k) => `${k.replace('|', ' ')}=${pct(res.floorFights[k].wins / res.floorFights[k].n)}`).join('  ')}</div>
        </div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="panel"><div class="eyebrow">Relic power — run-context RCT (picked vs offered-not-picked)</div>
          <div class="scroll" style="max-height:420px">${rctTable(res.relics, 'Relic')}</div></div>
        <div class="panel"><div class="eyebrow">Weave-tag power — run-context RCT</div>
          <div class="scroll" style="max-height:420px">${rctTable(res.weaveTags, 'Tag')}</div></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="panel"><div class="eyebrow">Per-character divergence (spread > 10pp)</div>
          ${res.relicByCharacter.length ? res.relicByCharacter.map((row) => `<div class="kv"><span class="k">${esc(row.id)}</span>
            <span class="v">${Object.entries(row.per).map(([c, r]) => `${esc(c)} ${pp(r.d)}`).join(' · ')}</span></div>`).join('') : '<div class="note">none at this sample size</div>'}
          <div class="eyebrow" style="margin-top:12px">Color-linked relics — with vs without the color in build</div>
          ${res.colorSynergy.length ? res.colorSynergy.map((r) => `<div class="kv"><span class="k">${esc(r.id)} <span class="hint">(${r.color})</span></span>
            <span class="v">with ${r.withColor ? pp(r.withColor.d) : '—'} · without ${r.without ? pp(r.without.d) : '—'}</span></div>`).join('') : '<div class="note">insufficient events per arm</div>'}
        </div>
        <div class="panel"><div class="eyebrow">Relic pair interactions (exploratory, survivorship-prone)</div>
          ${res.pairs.length ? res.pairs.slice(0, 12).map((r) => `<div class="kv"><span class="k">${esc(r.a)} + ${esc(r.b)}</span>
            <span class="v">n=${r.n} · synergy ${pp(r.synergy)}</span></div>`).join('') : '<div class="note">not enough co-occurrence data</div>'}
        </div>
      </div>`;
  }

  return { el, onShow() {}, onHide() { token && (token.cancelled = true); } };
}
