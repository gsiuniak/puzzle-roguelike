/**
 * toolbench/ui/views/audit.mjs — the AUDIT tab (ported from toolbench v1).
 * Every skill/relic/enemy scored analytically on one scale; per-row Sim
 * buttons run the seeded ground truth through the worker pool.
 */

import { $, $$, h, esc, pct, f1, f2, tagFor, bandTag } from '../util.mjs';
import { store, customs, allEnemyDefs, findEnemyDef, SKILL_CATALOG, RELIC_CATALOG, ENEMY_RELIC_CATALOG, CHARACTERS_BY_ID } from '../store.mjs';
import { runBattleArm, seedsFor, makeToken } from '../sim.mjs';
import { aggregate } from '../../engine.mjs';
import * as A from '../../analytic.mjs';

const enemyBandKey = (def) => (def && (def.type === 'boss' || def.type === 'elite')) ? def.type : 'minion';

export function auditView() {
  const el = h(`<div>
    <h2>Catalog Audit</h2>
    <p class="desc">Every skill, relic and enemy scored on one scale. Analytic columns compute instantly;
    the <b>Sim</b> buttons run the seeded ground truth for that row. The flags are the point — anything not
    green deserves a look.</p>
    <div class="row" style="margin-bottom:10px">
      <div class="fix"><label class="f">Ref Attack</label><input type="number" data-ra value="5" style="width:70px"></div>
      <div class="fix"><label class="f">Ref Magic</label><input type="number" data-rm value="5" style="width:70px"></div>
      <div class="fix"><label class="f">Audit character (sim)</label><select data-char>${Object.values(CHARACTERS_BY_ID).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="fix" style="align-self:flex-end"><button class="btn" data-refresh>Recompute</button></div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Skills — value per mana (target ${A.CAL.vpmBand.join('–')})</h3><div class="scroll" data-skills></div></div>
      <div class="panel"><h3>Relics — DEV per fight vs rarity band</h3><div class="scroll" data-relics></div></div>
      <div class="panel"><h3>Enemies — threat at their floors</h3><div class="scroll" data-enemies></div>
        <p class="note" style="margin-top:8px">Sim = seeded win% of the reference character (victories = (floor−1)×${A.CAL.winsPerFloor})
        over 150 battles at the enemy's LOWEST and HIGHEST legal floor. Bands: minion ${pct(A.CAL.winBands.minion[0])}–${pct(A.CAL.winBands.minion[1])},
        elite ${pct(A.CAL.winBands.elite[0])}–${pct(A.CAL.winBands.elite[1])}, boss ${pct(A.CAL.winBands.boss[0])}–${pct(A.CAL.winBands.boss[1])}.</p>
      </div>
    </div>
  </div>`);

  function stats() { return { attack: Number($('[data-ra]', el).value) || 5, magic: Number($('[data-rm]', el).value) || 5 }; }

  function render() {
    const st = stats();
    const skills = [...Object.values(SKILL_CATALOG), ...customs.skills];
    $('[data-skills]', el).innerHTML = `<table><tr><th>Skill</th><th class="num">Cost</th><th class="num">DEV</th><th class="num">V/mana</th><th class="num">Dmg/mana</th><th>Flag</th><th>Notes</th></tr>
      ${skills.map((s) => {
        const r = A.skillSummary(s, st);
        const cls = r.band === 'in band' ? 'good' : (r.band === 'weak' || r.band === 'must-pick' ? 'bad' : (r.band === 'free' ? 'info' : 'warn'));
        return `<tr><td>${esc(s.name)} <span class="hint">${esc(s.id)}</span></td><td class="num">${r.cost}</td>
          <td class="num">${f1(r.dev)}</td><td class="num">${r.cost ? f2(r.vpm) : '∞'}</td><td class="num">${r.cost ? f2(r.dpm) : '—'}</td>
          <td>${tagFor({ cls, label: r.band })}</td><td class="hint">${esc(r.notes.join('; '))}</td></tr>`;
      }).join('')}</table>`;

    const relics = [
      ...Object.values(RELIC_CATALOG).map((r) => ({ ...r, _pool: 'player' })),
      ...Object.values(ENEMY_RELIC_CATALOG).map((r) => ({ ...r, _pool: 'enemy' })),
      ...customs.relics.map((r) => ({ ...r, _pool: 'custom' })),
    ];
    $('[data-relics]', el).innerHTML = `<table><tr><th>Relic</th><th>Pool</th><th>Rarity</th><th class="num">DEV/fight</th><th>Flag</th><th>Notes</th></tr>
      ${relics.map((r) => {
        const s = A.relicDEVPerFight(r, st);
        const band = A.RARITY_DEV_BAND[r.rarity] || [0, 999];
        const t = bandTag(s.dev, band);
        return `<tr><td>${esc(r.name)} <span class="hint">${esc(r.id)}</span></td><td>${r._pool}</td><td>${r.rarity}</td>
          <td class="num">${f1(s.dev)} <span class="hint">/${band[0]}–${band[1]}</span></td>
          <td>${tagFor(t)}</td><td class="hint">${esc(s.notes.join('; '))}</td></tr>`;
      }).join('')}</table>`;

    const enemies = allEnemyDefs().filter((d) => d.floors && d.floors.length);
    $('[data-enemies]', el).innerHTML = `<table><tr><th>Enemy</th><th>Type</th><th>Floors</th>
      <th class="num">HP lo→hi</th><th class="num">Atk lo→hi</th><th class="num">Burst est</th><th>Sim lo</th><th>Sim hi</th></tr>
      ${enemies.map((d) => {
        d._resolvedSkills = (d.skills || []).map((id) => SKILL_CATALOG[id]).filter(Boolean);
        const lo = d.floors[0], hi = d.floors[d.floors.length - 1];
        const tLo = A.enemyThreat(d, lo, null), tHi = A.enemyThreat(d, hi, null);
        return `<tr data-en="${d.id}"><td>${esc(d.name)}</td><td>${d.type}</td><td>${d.floors.join(',')}</td>
          <td class="num">${tLo.hp}→${tHi.hp}</td><td class="num">${tLo.attack}→${tHi.attack}</td>
          <td class="num">${f1(tLo.burst)}→${f1(tHi.burst)}</td>
          <td><button class="btn small" data-sim="${d.id}|${lo}">Sim f${lo}</button></td>
          <td><button class="btn small" data-sim="${d.id}|${hi}">Sim f${hi}</button></td></tr>`;
      }).join('')}</table>`;
    $$('[data-sim]', el).forEach((b) => b.addEventListener('click', async () => {
      const [id, floorS] = b.dataset.sim.split('|');
      const floor = Number(floorS);
      const def = findEnemyDef(id);
      b.textContent = '…';
      const victories = Math.round((floor - 1) * A.CAL.winsPerFloor);
      const results = await runBattleArm({
        player: { characterId: $('[data-char]', el).value, victories },
        enemy: def._custom ? { def, floor, overrides: {} } : { id: def.id, floor, overrides: {} },
        seeds: seedsFor(`gems-audit|${id}|f${floor}`, 150),
        chunk: 25, token: makeToken(),
      });
      const agg = aggregate(results);
      const t = bandTag(agg.winRate, A.CAL.winBands[enemyBandKey(def)]);
      b.outerHTML = `${tagFor(t)} <span class="mono">${pct(agg.winRate)}·${f1(agg.turns.mean)}t</span>`;
    }));
  }

  $('[data-refresh]', el).addEventListener('click', render);
  return { el, onShow: render, onHide: () => {} };
}
