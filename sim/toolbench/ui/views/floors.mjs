/**
 * toolbench/ui/views/floors.mjs — the FLOORS tab: character × floor sweep.
 *
 * The current Bench build swept across floors 1–10, against either the
 * floor-legal spawn mix (uniform among eligible defs — transparent, no hidden
 * weighting) or one fixed enemy at every floor. Growth applies per floor
 * (victories ≈ (floor−1) × 0.7, the doc's reference progression) or stays
 * frozen at the Bench value. Both AI brackets render as two lines.
 */

import { $, h, esc, pct, f1, tagFor, bandTag, lineChart, localRng, hash32 } from '../util.mjs';
import { store, allEnemyDefs, specForChoice } from '../store.mjs';
import { progressRow } from '../components.mjs';
import { runBattleArm, seedsFor, chunkFor, makeToken } from '../sim.mjs';
import { aggregate } from '../../engine.mjs';
import { WINS_PER_FLOOR } from '../../measure.mjs';
import { CAL } from '../../analytic.mjs';

const FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const slotType = (f) => (f === 10 ? 'boss' : f >= 7 ? 'elite' : 'minion');

function eligibleAt(floor) {
  const defs = allEnemyDefs().filter((d) => (d.floors || []).includes(floor));
  return defs.length ? defs : allEnemyDefs().filter((d) => d.type === 'minion');
}

export function floorsView() {
  const el = h(`<div>
    <h2>Floors</h2>
    <p class="desc">The Bench build swept 1→10. Opponents are the <b>floor-legal spawn pool</b> (uniform among
    eligible enemies, seeded — transparent) or a fixed enemy. The green verdicts compare each floor's win rate
    to its slot band (minion ${pct(CAL.winBands.minion[0])}–${pct(CAL.winBands.minion[1])} ·
    elite ${pct(CAL.winBands.elite[0])}–${pct(CAL.winBands.elite[1])} · boss ${pct(CAL.winBands.boss[0])}–${pct(CAL.winBands.boss[1])}).</p>
    <div class="row" style="align-items:flex-end;margin-bottom:10px">
      <div class="fix"><label class="f">Opponents</label><select data-mode>
        <option value="spawn">floor-legal spawn pool</option>
        <option value="fixed">fixed enemy at every floor</option></select></div>
      <div class="fix" data-fixed-wrap style="display:none"><label class="f">Enemy</label><select data-fixed>
        ${allEnemyDefs().map((d) => `<option value="${d.id}">${esc(d.name)} · ${d.type}</option>`).join('')}</select></div>
      <div class="fix"><label class="f">Growth</label><select data-growth>
        <option value="auto">victories ≈ (floor−1) × ${WINS_PER_FLOOR}</option>
        <option value="fixed">frozen at Bench victories</option></select></div>
      <div class="fix"><label class="f">Battles / floor</label><input type="number" data-n value="150" min="40" step="50" style="width:84px"></div>
      <div class="fix"><label class="f">&nbsp;</label><label class="tog"><input type="checkbox" data-both checked> both brackets</label></div>
    </div>
    <div data-progress></div>
    <div class="grid g2" data-out style="display:none">
      <div class="panel"><div class="eyebrow"><span class="ix">∿</span>Win rate by floor <span class="right hint" data-note></span></div><div data-chart></div></div>
      <div class="panel"><div class="eyebrow">Per-floor table</div><div class="scroll" style="max-height:420px"><table data-table></table></div></div>
    </div>
  </div>`);

  $('[data-mode]', el).addEventListener('change', (ev) => {
    $('[data-fixed-wrap]', el).style.display = ev.target.value === 'fixed' ? '' : 'none';
  });

  const prog = progressRow({ runLabel: 'Sweep floors', onRun: () => sweep(), onCancel: () => { token && (token.cancelled = true); } });
  $('[data-progress]', el).appendChild(prog.el);
  let token = null;

  async function floorBatch({ floor, n, playerSpec, chunkSize, mode, fixedId, growth, token: t, onProgress }) {
    const basePlayer = store.playerPayload();
    const player = growth === 'auto'
      ? { ...basePlayer, victories: Math.round((floor - 1) * WINS_PER_FLOOR) }
      : basePlayer;
    // group seeds by opponent
    const groups = new Map(); // enemyId|def → seeds[]
    const seeds = seedsFor(`gems-floors|f${floor}|${mode}|${fixedId || ''}`, n);
    if (mode === 'fixed') {
      groups.set(fixedId, seeds);
    } else {
      const pool = eligibleAt(floor);
      const rng = localRng(hash32(`floors|${floor}`));
      const order = seeds.map(() => pool[Math.floor(rng() * pool.length)]);
      order.forEach((def, i) => {
        if (!groups.has(def.id)) groups.set(def.id, []);
        groups.get(def.id).push(seeds[i]);
      });
    }
    const results = [];
    const mix = [];
    let done = 0;
    for (const [id, gSeeds] of groups.entries()) {
      if (t.cancelled) throw { cancelled: true };
      const def = allEnemyDefs().find((d) => d.id === id);
      mix.push(`${def ? def.name : id}×${gSeeds.length}`);
      const part = await runBattleArm({
        player,
        enemy: def && def._custom ? { def, floor, overrides: {} } : { id, floor, overrides: {} },
        seeds: gSeeds, playerSpec, chunk: chunkSize, token: t,
        onProgress: (f) => onProgress((done + f * gSeeds.length) / n),
      });
      done += gSeeds.length;
      results.push(...part);
    }
    return { agg: aggregate(results), mix, victories: player.victories };
  }

  async function sweep() {
    token = makeToken();
    const t = token;
    const mode = $('[data-mode]', el).value;
    const fixedId = $('[data-fixed]', el).value;
    const growth = $('[data-growth]', el).value;
    const n = Math.max(40, Number($('[data-n]', el).value) || 150);
    const both = $('[data-both]', el).checked;
    const primaryKey = store.aiKey('player');
    const brackets = both
      ? [primaryKey, primaryKey === 'simple' ? 'hard' : 'simple']
      : [primaryKey];
    prog.running(true);
    const perFloor = {}; // floor → { [bracket]: {agg, mix, victories} }
    try {
      const totalSteps = FLOORS.length * brackets.length;
      let step = 0;
      for (const floor of FLOORS) {
        perFloor[floor] = {};
        for (const bk of brackets) {
          if (t.cancelled) throw { cancelled: true };
          const bn = bk === 'simple' ? n : Math.min(n, 100);
          prog.status(`f${floor} · ${bk} · n=${bn}`);
          perFloor[floor][bk] = await floorBatch({
            floor, n: bn, playerSpec: specForChoice(bk), chunkSize: chunkFor(bk),
            mode, fixedId, growth, token: t,
            onProgress: (f) => prog.progress((step + f) / totalSteps),
          });
          step++;
          render(perFloor, brackets, { mode, fixedId, growth });
        }
      }
      prog.status('done');
    } catch (e) {
      if (!e || !e.cancelled) prog.status('error: ' + (e && e.message || e));
    }
    prog.running(false);
  }

  function render(perFloor, brackets, { mode, fixedId, growth }) {
    $('[data-out]', el).style.display = '';
    const floors = FLOORS.filter((f) => perFloor[f] && perFloor[f][brackets[0]]);
    const colors = { [brackets[0]]: 'var(--signal)' };
    if (brackets[1]) colors[brackets[1]] = 'var(--ink-3)';
    const series = brackets.filter((bk) => floors.some((f) => perFloor[f][bk])).map((bk, i) => ({
      name: `win % · ${bk}`, color: colors[bk], min: 0, max: 1, fmt: (x) => pct(x),
      dash: i ? '5 4' : null,
      points: floors.filter((f) => perFloor[f][bk]).map((f) => ({ x: f, y: perFloor[f][bk].agg.winRate })),
    }));
    $('[data-chart]', el).innerHTML = lineChart(series, { xLabel: 'floor', w: 560, h: 240 });
    $('[data-note]', el).textContent = mode === 'fixed'
      ? `vs ${fixedId} everywhere · growth ${growth}` : `spawn pool per floor · growth ${growth}`;
    const rows = floors.map((f) => {
      const primary = perFloor[f][brackets[0]];
      const band = CAL.winBands[slotType(f)];
      const tg = primary.agg.winRate < band[0] ? { cls: 'bad', label: 'too hard' }
        : primary.agg.winRate > band[1] ? { cls: 'info', label: 'too easy' } : { cls: 'good', label: 'in band' };
      const ghost = brackets[1] && perFloor[f][brackets[1]];
      return `<tr><td>${f} <span class="hint">${slotType(f)} v${primary.victories}</span></td>
        <td class="num">${pct(primary.agg.winRate)}</td>
        <td class="num">${ghost ? pct(ghost.agg.winRate) : '—'}</td>
        <td class="num">${f1(primary.agg.turns.mean)}</td>
        <td class="num">${pct(primary.agg.burstShare)}</td>
        <td>${tagFor(tg)}</td>
        <td class="hint">${esc(primary.mix.slice(0, 4).join(', '))}${primary.mix.length > 4 ? '…' : ''}</td></tr>`;
    }).join('');
    $('[data-table]', el).innerHTML = `<tr><th>Floor</th><th class="num">Win (${esc(brackets[0])})</th>
      <th class="num">Win (${esc(brackets[1] || '—')})</th><th class="num">Turns</th><th class="num">Burst</th><th>Verdict</th><th>Mix</th></tr>${rows}`;
  }

  return { el, onShow() {}, onHide() { token && (token.cancelled = true); } };
}
