/**
 * toolbench/ui/views/designer.mjs — the DESIGNER tab (ported from toolbench v1).
 *
 * Create/tune an enemy, skill, or relic: analytic score instantly, one-click
 * SEEDED sim check through the worker pool (paired for skills/relics — the
 * v1 designer's independent batches are upgraded to common seeds), paste-ready
 * code when it lands. Customs persist in localStorage (same key as v1) and
 * are selectable across the bench.
 */

import { $, $$, h, esc, pct, pct1, f1, f2, tagFor, bandTag, MANA_COLORS, COLOR_CSS } from '../util.mjs';
import {
  store, customs, saveCustoms, allEnemyDefs, findEnemyDef, customSkillById, customRelicById,
  SKILL_CATALOG, RELIC_CATALOG, ENEMY_RELIC_CATALOG, CHARACTERS_BY_ID,
} from '../store.mjs';
import { runBattleArm, seedsFor, makeToken } from '../sim.mjs';
import { aggregate } from '../../engine.mjs';
import { pairedStats } from '../../measure.mjs';
import * as A from '../../analytic.mjs';

const enemyBandKey = (def) => (def && (def.type === 'boss' || def.type === 'elite')) ? def.type : 'minion';

const SKILL_TEMPLATES = [
  { label: 'damage (flat)', effect: { effectType: 'damage', damage: { amount: 5 } } },
  { label: 'damage + attack scaling ×1', effect: { effectType: 'damage', damage: { amount: 5, scaling: { attack: 1 } } } },
  { label: 'damage + magic scaling ×1.5', effect: { effectType: 'damage', damage: { amount: 5, scaling: { magic: 1.5 } } } },
  { label: 'damage + per-skull rider', effect: { effectType: 'damage', damage: { amount: 8, perSkull: 1 } } },
  { label: 'heal', effect: { effectType: 'heal', heal: { amount: 5, scaling: { attack: 0.5, magic: 0.5 } } } },
  { label: 'armor', effect: { effectType: 'armor', armor: { amount: 6, scaling: { attack: 1 / 3 } } } },
  { label: 'barrier (magic ×2/3)', effect: { effectType: 'barrier', barrier: { amount: 4, scaling: { magic: 2 / 3 } } } },
  { label: 'extra turn', effect: { effectType: 'extra_turn' } },
  { label: 'gain attack (permanent)', effect: { effectType: 'gain_attack', gainAttack: { amount: 1 } } },
  { label: 'create tiles', effect: { effectType: 'create_tiles', createTiles: { amount: 3, type: 'blue' } } },
  { label: 'create skulls', effect: { effectType: 'create_tiles', createTiles: { amount: 6, type: 'skull' } } },
  { label: 'mass convert (green→skull)', effect: { effectType: 'convert_tiles_by_type', convertByType: { from: 'green', to: 'skull' } } },
  { label: 'destroy row', effect: { effectType: 'destroy_tiles_row' } },
  { label: 'destroy 3×3 area', effect: { effectType: 'destroy_tiles' } },
  { label: 'poison (magic ×1/4)', effect: { effectType: 'apply_poison', poison: { amount: 2, target: 'opponent', scaling: { magic: 0.25 } } } },
  { label: 'apply status (silence 1t)', effect: { effectType: 'apply_status', applyStatus: { id: 'silenced', target: 'opponent', turns: 1 } } },
  { label: 'drain 5 of every mana', effect: { effectType: 'drain_mana', drainMana: { amount: 5 } } },
  { label: 'gain mana', effect: { effectType: 'gain_mana', gainMana: { color: 'purple', amount: 4 } } },
];
const RELIC_TEMPLATES = [
  { label: 'flat +attack (battle start)', effect: { trigger: 'onBattleStart', effectType: 'modify_stat', modifyStat: { stat: 'attack', amount: 2 } } },
  { label: 'spawn rate +10pp', effect: { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'red', amount: 10 } } },
  { label: '+1 mana per match of color', effect: { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'red', amount: 1 } } },
  { label: '+skull match damage', effect: { trigger: 'onBattleStart', effectType: 'modify_skull_damage', skullDamage: { amount: 3 } } },
  { label: 'starting mana', effect: { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'red', amount: 5 } } },
  { label: 'attack per unspent mana', effect: { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'red', per: 3, amount: 1 } } },
  { label: 'turn-start armor', effect: { trigger: 'onTurnStart', effectType: 'armor', armor: { amount: 2 } } },
  { label: 'turn-start heal', effect: { trigger: 'onTurnStart', effectType: 'heal', heal: { amount: 2 } } },
  { label: 'turn-start damage', effect: { trigger: 'onTurnStart', effectType: 'damage', damage: { amount: 3 } } },
  { label: 'turn-start +attack (ramp!)', effect: { trigger: 'onTurnStart', effectType: 'gain_attack', gainAttack: { amount: 1 } } },
  { label: 'on 4+ match: damage', effect: { trigger: 'onMatch4Plus', effectType: 'damage', damage: { amount: 2 } } },
  { label: 'on 4+ match: explode r1', effect: { trigger: 'onMatch4Plus', effectType: 'destroy_tiles_radius', area: { radius: 1 } } },
  { label: 'on skull match: +attack (Scythe)', effect: { trigger: 'onTileMatchType', condition: { typeId: 'skull', minCount: 3 }, effectType: 'gain_attack', gainAttack: { amount: 1 } } },
  { label: 'on take damage: gain mana', effect: { trigger: 'onTakeDamage', effectType: 'gain_mana', gainMana: { color: 'red', amount: 2 } } },
  { label: 'on deal damage: heal', effect: { trigger: 'onDealDamage', effectType: 'heal', heal: { amount: 1 } } },
  { label: 'on gain color mana: damage', effect: { trigger: 'onGainMana', condition: { color: 'red' }, effectType: 'damage', damage: { amount: 1 } } },
  { label: 'reduce all incoming damage', effect: { trigger: 'onIncomingDamage', effectType: 'reduce_damage', reduceDamage: { amount: 1 } } },
];

function effectsEditor(templates) {
  const box = h(`<div>
    <div class="row"><div style="flex:2"><label class="f">Insert effect template</label>
    <select data-tpl>${templates.map((t, i) => `<option value="${i}">${esc(t.label)}</option>`).join('')}</select></div>
    <div class="fix" style="align-self:flex-end"><button class="btn small" data-ins>Insert</button></div></div>
    <label class="f">effects[] (JSON)</label><textarea data-json>[]</textarea>
    <div class="hint" data-err></div>
  </div>`);
  $('[data-ins]', box).addEventListener('click', () => {
    const t = templates[Number($('[data-tpl]', box).value)];
    let arr = [];
    try { arr = JSON.parse($('[data-json]', box).value || '[]'); } catch { arr = []; }
    arr.push(t.effect);
    $('[data-json]', box).value = JSON.stringify(arr, null, 2);
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return {
    el: box,
    get() {
      try {
        const arr = JSON.parse($('[data-json]', box).value || '[]');
        $('[data-err]', box).textContent = '';
        return Array.isArray(arr) ? arr : [];
      } catch (e) { $('[data-err]', box).textContent = 'JSON error: ' + e.message; return null; }
    },
    set(arr) { $('[data-json]', box).value = JSON.stringify(arr || [], null, 2); },
  };
}

const simSeeds = (tag, n) => seedsFor(`gems-designer|${tag}`, n);

export function designerView() {
  const el = h(`<div>
    <h2>Designer</h2>
    <p class="desc">Create or tune an enemy, skill, or relic — analytic score first, one-click <b>seeded</b> sim
    to verify (skills/relics run PAIRED with/without on common seeds), paste-ready code when it lands. Customs
    save locally and are selectable across every tab.</p>
    <div class="subtabs">
      <button data-st="enemy" class="active">Enemy</button><button data-st="skill">Skill</button><button data-st="relic">Relic</button>
    </div>
    <div data-body></div>
  </div>`);
  const body = $('[data-body]', el);
  let sub = null;
  function show(k) {
    $$('.subtabs button', el).forEach((b) => b.classList.toggle('active', b.dataset.st === k));
    body.innerHTML = ''; body.appendChild(sub[k].el); sub[k].refresh();
  }
  $$('.subtabs button', el).forEach((b) => b.addEventListener('click', () => show(b.dataset.st)));

  /* ---------- enemy designer ---------- */
  function enemyDesigner() {
    const box = h(`<div class="grid g32">
      <div class="panel"><div class="eyebrow">Enemy definition</div>
        <div class="row"><div><label class="f">id</label><input data-k="id" value="new_enemy"></div>
        <div><label class="f">name</label><input data-k="name" value="New Enemy"></div></div>
        <div class="row">
          <div><label class="f">type</label><select data-k="type"><option>minion</option><option>elite</option><option>boss</option></select></div>
          <div><label class="f">rarity</label><select data-k="rarity"><option>common</option><option>uncommon</option><option>rare</option></select></div>
          <div><label class="f">floors (csv)</label><input data-k="floors" value="3,4,5"></div>
        </div>
        <div class="row">
          <div><label class="f">HP (f1 baseline)</label><input type="number" data-k="hp" value="16"></div>
          <div><label class="f">Attack</label><input type="number" data-k="attack" value="2"></div>
          <div><label class="f">Armor</label><input type="number" data-k="armor" value="0"></div>
          <div><label class="f">attackScale</label><input type="number" data-k="attackScale" value="1" step="0.5"></div>
        </div>
        <label class="f">Starting mana (r,b,g,y,p)</label>
        <div class="row">${MANA_COLORS.map((c) => `<input type="number" data-mana="${c}" value="0" title="${c}" style="border-bottom:2px solid ${COLOR_CSS[c]}">`).join('')}</div>
        <label class="f">Skills</label><div class="checks" data-skills>
          ${Object.values(SKILL_CATALOG).map((s) => `<label><input type="checkbox" value="${s.id}"> ${esc(s.name)}</label>`).join('')}
          ${customs.skills.map((s) => `<label><input type="checkbox" value="${s.id}" data-custom="1"> ${esc(s.name)} <span class="hint">custom</span></label>`).join('')}
        </div>
        <label class="f">Relics (enemy pool)</label><div class="checks" data-relics>
          ${Object.values(ENEMY_RELIC_CATALOG).map((r) => `<label><input type="checkbox" value="${r.id}"> ${esc(r.name)}</label>`).join('')}
          ${customs.relics.map((r) => `<label><input type="checkbox" value="${r.id}" data-custom="1"> ${esc(r.name)} <span class="hint">custom</span></label>`).join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn primary fix" data-save>Save custom</button>
          <button class="btn fix" data-load>Load existing…</button>
          <select data-loadsel class="fix" style="width:170px">${allEnemyDefs().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div>
        <div class="panel"><div class="eyebrow">Budget check</div>
          <div class="row">
            <div><label class="f">Assumed player DPT (measure on Bench)</label><input type="number" data-dpt value="3.0" step="0.2"></div>
            <div><label class="f">Player max HP at floor</label><input type="number" data-php value="45"></div>
            <div><label class="f">Target turns</label><input type="number" data-tt value="8"></div>
          </div>
          <div data-budget style="margin-top:10px"></div>
        </div>
        <div class="panel" style="margin-top:12px"><div class="eyebrow">Simulation check (seeded)</div>
          <div class="row">
            <div><label class="f">Test floor</label><input type="number" data-floor value="3" min="1" max="10"></div>
            <div><label class="f">Character</label><select data-char>${Object.values(CHARACTERS_BY_ID).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
            <div><label class="f">Battles</label><input type="number" data-n value="200"></div>
            <div class="fix" style="align-self:flex-end"><button class="btn primary" data-test>Test vs reference player</button></div>
          </div>
          <div class="progress"><i data-prog></i></div>
          <div data-sim></div>
        </div>
        <div class="panel" style="margin-top:12px"><div class="eyebrow">Export</div><pre class="code" data-code></pre></div>
      </div>
    </div>`);
    function read() {
      const def = {
        id: $('[data-k=id]', box).value.trim() || 'new_enemy',
        name: $('[data-k=name]', box).value.trim() || 'New Enemy',
        type: $('[data-k=type]', box).value, rarity: $('[data-k=rarity]', box).value,
        floors: $('[data-k=floors]', box).value.split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 10),
        hp: Number($('[data-k=hp]', box).value) || 1, maxHp: Number($('[data-k=hp]', box).value) || 1,
        attack: Number($('[data-k=attack]', box).value) || 0,
        armor: Number($('[data-k=armor]', box).value) || 0,
        attackScale: Number($('[data-k=attackScale]', box).value),
        mana: Object.fromEntries(MANA_COLORS.map((c) => [c, Number($(`[data-mana=${c}]`, box).value) || 0])),
        skills: $$('[data-skills] input:checked', box).filter((i) => !i.dataset.custom).map((i) => i.value),
        relics: $$('[data-relics] input:checked', box).filter((i) => !i.dataset.custom).map((i) => i.value),
        customSkills: $$('[data-skills] input:checked', box).filter((i) => i.dataset.custom).map((i) => customSkillById(i.value)).filter(Boolean),
        customRelics: $$('[data-relics] input:checked', box).filter((i) => i.dataset.custom).map((i) => customRelicById(i.value)).filter(Boolean),
        act: 1, aiBehavior: null, className: 'Minion',
        _custom: true,
      };
      def._resolvedSkills = [...def.skills.map((id) => SKILL_CATALOG[id]).filter(Boolean), ...def.customSkills];
      return def;
    }
    function refresh() {
      const def = read();
      const dpt = Number($('[data-dpt]', box).value) || 3;
      const php = Number($('[data-php]', box).value) || 40;
      const tt = Number($('[data-tt]', box).value) || 8;
      const rows = (def.floors.length ? def.floors : [1]).map((f) => {
        const t = A.enemyThreat(def, f, { dpt, maxHp: php });
        const hpBudget = A.budgetEnemyBaseHp(dpt, tt, f);
        const burstTag = t.burstShare > A.CAL.burstShareMax[enemyBandKey(def)] ? { cls: 'bad', label: 'spiky' } : (t.burstShare < 0.12 ? { cls: 'info', label: 'toothless' } : { cls: 'good', label: 'ok' });
        return `<tr><td class="num">${f}</td><td class="num">${t.hp}</td><td class="num">${t.attack}</td>
          <td class="num">${f1(t.ttk)}</td><td class="num">${f1(t.burst)} (${t.burstShare != null ? pct(t.burstShare) : '—'}) ${tagFor(burstTag)}</td>
          <td class="num">${hpBudget} ${Math.abs(hpBudget - def.hp) <= Math.max(3, hpBudget * 0.25) ? tagFor({ cls: 'good', label: 'ok' }) : tagFor({ cls: 'warn', label: def.hp > hpBudget ? 'over' : 'under' })}</td></tr>`;
      }).join('');
      $('[data-budget]', box).innerHTML = `<table><tr><th class="num">Floor</th><th class="num">HP</th><th class="num">Atk</th>
        <th class="num">TTK est</th><th class="num">Burst est (share)</th><th class="num">HP budget @${tt}t</th></tr>${rows}</table>
        <p class="note" style="margin-top:6px">Budget: baseline HP ≈ playerDPT × targetTurns ÷ floor-mult. Ramping kits under-show here — sim at their TOP floor.</p>`;
      $('[data-code]', box).textContent = A.enemySnippet(read());
    }
    box.addEventListener('change', refresh);
    $('[data-save]', box).addEventListener('click', () => {
      const def = read();
      const i = customs.enemies.findIndex((d) => d.id === def.id);
      if (i >= 0) customs.enemies[i] = def; else customs.enemies.push(def);
      saveCustoms();
      alert(`Saved "${def.id}" — selectable across the bench after reload.`);
    });
    $('[data-load]', box).addEventListener('click', () => {
      const def = findEnemyDef($('[data-loadsel]', box).value);
      if (!def) return;
      $('[data-k=id]', box).value = def.id; $('[data-k=name]', box).value = def.name;
      $('[data-k=type]', box).value = def.type || 'minion'; $('[data-k=rarity]', box).value = def.rarity || 'common';
      $('[data-k=floors]', box).value = (def.floors || []).join(',');
      $('[data-k=hp]', box).value = def.hp != null ? def.hp : def.maxHp;
      $('[data-k=attack]', box).value = def.attack || 0; $('[data-k=armor]', box).value = def.armor || 0;
      $('[data-k=attackScale]', box).value = typeof def.attackScale === 'number' ? def.attackScale : 1;
      for (const c of MANA_COLORS) $(`[data-mana=${c}]`, box).value = (def.mana && def.mana[c]) || 0;
      $$('[data-skills] input', box).forEach((i) => { i.checked = (def.skills || []).includes(i.value); });
      $$('[data-relics] input', box).forEach((i) => { i.checked = (def.relics || []).includes(i.value); });
      refresh();
    });
    $('[data-test]', box).addEventListener('click', async () => {
      const def = read();
      const floor = Math.max(1, Math.min(10, Number($('[data-floor]', box).value) || 1));
      const n = Number($('[data-n]', box).value) || 200;
      const victories = Math.round((floor - 1) * A.CAL.winsPerFloor);
      const results = await runBattleArm({
        player: { characterId: $('[data-char]', box).value, victories },
        enemy: { def, floor, overrides: {} },
        seeds: simSeeds(`enemy|${def.id}|f${floor}`, n),
        chunk: 25, token: makeToken(),
        onProgress: (f) => { $('[data-prog]', box).style.width = pct(f); },
      });
      const agg = aggregate(results);
      const bk = enemyBandKey(def);
      const wt = bandTag(agg.winRate, A.CAL.winBands[bk]);
      const tt2 = bandTag(agg.turns.mean, A.CAL.fightBands[bk]);
      $('[data-sim]', box).innerHTML = `<div class="verdict">${tagFor(wt)} win ${pct1(agg.winRate)} · ${tagFor(tt2)} ${f1(agg.turns.mean)} turns
        · burst ${pct(agg.burstShare)} · vs ${esc($('[data-char]', box).value)} v${victories} (greedy player, n=${agg.n})</div>`;
    });
    return { el: box, refresh };
  }

  /* ---------- skill / relic designers share the paired-test body ---------- */
  function itemDesigner(kind) {
    const isSkill = kind === 'skill';
    const fx = effectsEditor(isSkill ? SKILL_TEMPLATES : RELIC_TEMPLATES);
    const loadables = isSkill
      ? [...Object.values(SKILL_CATALOG), ...customs.skills]
      : [...Object.values(RELIC_CATALOG), ...Object.values(ENEMY_RELIC_CATALOG), ...customs.relics];
    const box = h(`<div class="grid g32">
      <div class="panel"><div class="eyebrow">${isSkill ? 'Skill' : 'Relic'} definition</div>
        <div class="row"><div><label class="f">id</label><input data-k="id" value="new_${kind}"></div>
        <div><label class="f">name</label><input data-k="name" value="New ${isSkill ? 'Skill' : 'Relic'}"></div></div>
        ${isSkill
          ? `<label class="f">Cost (r,b,g,y,p)</label>
             <div class="row">${MANA_COLORS.map((c) => `<input type="number" data-cost="${c}" value="0" title="${c}" style="border-bottom:2px solid ${COLOR_CSS[c]}">`).join('')}</div>`
          : `<div class="row">
              <div><label class="f">rarity</label><select data-k="rarity"><option>common</option><option>uncommon</option><option>rare</option><option>legendary</option><option>starter</option></select></div>
              <div><label class="f">pool</label><select data-k="pool"><option value="player">player</option><option value="enemy">enemy</option></select></div>
            </div>`}
        <div data-fx></div>
        <div class="row" style="margin-top:10px">
          <button class="btn primary fix" data-save>Save custom</button>
          <button class="btn fix" data-load>Load…</button>
          <select data-loadsel class="fix" style="width:170px">${loadables.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div>
        <div class="panel"><div class="eyebrow">Analytic score</div>
          <div class="row"><div><label class="f">Reference Attack</label><input type="number" data-ra value="5"></div>
          <div><label class="f">Reference Magic</label><input type="number" data-rm value="5"></div></div>
          <div data-an style="margin-top:10px"></div>
        </div>
        <div class="panel" style="margin-top:12px"><div class="eyebrow">Paired sim check (common seeds, added to the kit)</div>
          <div class="row">
            <div><label class="f">Character</label><select data-char>${Object.values(CHARACTERS_BY_ID).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
            <div><label class="f">Enemy</label><select data-en>${allEnemyDefs().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
            <div><label class="f">Floor</label><input type="number" data-floor value="5" min="1" max="10"></div>
            <div><label class="f">Battles</label><input type="number" data-n value="200"></div>
            <div class="fix" style="align-self:flex-end"><button class="btn primary" data-test>A/B test</button></div>
          </div>
          <div class="progress"><i data-prog></i></div><div data-sim></div>
        </div>
        <div class="panel" style="margin-top:12px"><div class="eyebrow">Export</div><pre class="code" data-code></pre></div>
      </div>
    </div>`);
    $('[data-fx]', box).appendChild(fx.el);
    function read() {
      return isSkill ? {
        id: $('[data-k=id]', box).value.trim() || 'new_skill',
        name: $('[data-k=name]', box).value.trim() || 'New Skill',
        description: '', icon: 'skill_bash', sound: 'skill_bash',
        cost: Object.fromEntries(MANA_COLORS.map((c) => [c, Number($(`[data-cost=${c}]`, box).value) || 0]).filter(([, v]) => v > 0)),
        effects: fx.get() || [], _custom: true,
      } : {
        id: $('[data-k=id]', box).value.trim() || 'new_relic',
        name: $('[data-k=name]', box).value.trim() || 'New Relic',
        description: '', icon: 'relic_claymore',
        rarity: $('[data-k=rarity]', box).value,
        effects: fx.get() || [], _custom: true,
      };
    }
    function refresh() {
      const item = read();
      const stats = { attack: Number($('[data-ra]', box).value) || 5, magic: Number($('[data-rm]', box).value) || 5 };
      if (isSkill) {
        const s = A.skillSummary(item, stats);
        const synth = A.synthCostEstimate(item, stats);
        const bandCls = s.band === 'in band' ? 'good' : (s.band === 'weak' || s.band === 'must-pick' ? 'bad' : 'warn');
        $('[data-an]', box).innerHTML = `
          <div class="stats">
            <div class="stat"><div class="k">Total cost</div><div class="v">${s.cost}</div></div>
            <div class="stat"><div class="k">DEV / cast</div><div class="v">${f1(s.dev)}</div></div>
            <div class="stat"><div class="k">Value / mana</div><div class="v">${f2(s.vpm)}</div></div>
            <div class="stat"><div class="k">Synth price</div><div class="v">${synth.suggestedCost} <small>pow ${f1(synth.power)}</small></div></div>
          </div>
          <div class="verdict">${tagFor({ cls: bandCls, label: s.band })}
            <span>Target V/mana ∈ [${A.CAL.vpmBand.join(', ')}]. ${s.notes.length ? 'Notes: ' + esc(s.notes.join('; ')) : ''}</span></div>`;
        $('[data-code]', box).textContent = A.skillSnippet(item);
      } else {
        const r = A.relicDEVPerFight(item, stats);
        const band = A.RARITY_DEV_BAND[item.rarity] || [0, 999];
        $('[data-an]', box).innerHTML = `
          <div class="stats">
            <div class="stat"><div class="k">DEV / fight</div><div class="v">${f1(r.dev)}</div></div>
            <div class="stat"><div class="k">Rarity band</div><div class="v">${band[0]}–${band[1]}</div></div>
          </div>
          <div class="verdict">${tagFor(bandTag(r.dev, band))} <span>DEV/fight at fight length ${A.CAL.fightTurns}.
          Per-turn attack ramps are unbounded — check at elite/boss fight lengths. ${r.notes.length ? 'Notes: ' + esc(r.notes.join('; ')) : ''}</span></div>`;
        $('[data-code]', box).textContent = A.relicSnippet(item, $('[data-k=pool]', box).value);
      }
    }
    box.addEventListener('change', refresh);
    $('[data-save]', box).addEventListener('click', () => {
      const item = read();
      if (!fx.get()) return alert('Fix the effects JSON first.');
      const list = isSkill ? customs.skills : customs.relics;
      const i = list.findIndex((s) => s.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      saveCustoms();
      alert(`Saved "${item.id}" — selectable across the bench after reload.`);
    });
    $('[data-load]', box).addEventListener('click', () => {
      const id = $('[data-loadsel]', box).value;
      const item = isSkill ? (SKILL_CATALOG[id] || customSkillById(id)) : (RELIC_CATALOG[id] || ENEMY_RELIC_CATALOG[id] || customRelicById(id));
      if (!item) return;
      $('[data-k=id]', box).value = item.id; $('[data-k=name]', box).value = item.name;
      if (isSkill) for (const c of MANA_COLORS) $(`[data-cost=${c}]`, box).value = (item.cost && item.cost[c]) || 0;
      else $('[data-k=rarity]', box).value = item.rarity || 'common';
      fx.set(item.effects);
      refresh();
    });
    $('[data-test]', box).addEventListener('click', async () => {
      const item = read();
      if (!fx.get()) return alert('Fix the effects JSON first.');
      const characterId = $('[data-char]', box).value;
      const def = findEnemyDef($('[data-en]', box).value);
      const floor = Math.max(1, Math.min(10, Number($('[data-floor]', box).value) || 5));
      const n = Number($('[data-n]', box).value) || 200;
      const victories = Math.round((floor - 1) * A.CAL.winsPerFloor);
      const seeds = simSeeds(`${kind}|${def.id}|f${floor}`, n);
      const enemy = def._custom ? { def, floor, overrides: {} } : { id: def.id, floor, overrides: {} };
      const t = makeToken();
      const base = await runBattleArm({
        player: { characterId, victories }, enemy, seeds, chunk: 25, token: t,
        onProgress: (f) => { $('[data-prog]', box).style.width = pct(f / 2); },
      });
      const withIt = await runBattleArm({
        player: { characterId, victories, ...(isSkill ? { customSkills: [item] } : { customRelics: [item] }) },
        enemy, seeds, chunk: 25, token: t,
        onProgress: (f) => { $('[data-prog]', box).style.width = pct(0.5 + f / 2); },
      });
      const s = pairedStats(base, withIt);
      const sig = Math.abs(s.dWin) > s.ci95;
      let chip;
      if (isSkill) {
        chip = s.dWin > 0.12 ? { cls: 'bad', label: 'too strong?' } : (!sig ? { cls: 'warn', label: 'unresolved' } : (s.dWin < 0.005 ? { cls: 'info', label: 'no impact' } : { cls: 'good', label: 'healthy' }));
      } else {
        const bands = { common: 0.03, uncommon: 0.06, rare: 0.12, legendary: 0.25, starter: 0.05 };
        const cap = bands[item.rarity] || 0.06;
        chip = s.dWin > cap * 1.8 ? { cls: 'bad', label: 'over rarity budget' } : (!sig ? { cls: 'warn', label: 'unresolved' } : (s.dWin < 0.002 ? { cls: 'info', label: 'no impact' } : { cls: 'good', label: 'in budget' }));
      }
      $('[data-sim]', box).innerHTML = `<div class="verdict">${tagFor(chip)}
        <span>ΔWin <b>${(s.dWin * 100).toFixed(1)}pp ± ${(s.ci95 * 100).toFixed(1)}</b> (${pct1(s.winBase)} → ${pct1(s.winVar)}) ·
        Δturns <b>${s.dTurns >= 0 ? '+' : ''}${f1(s.dTurns)}</b> · ΔCasts ${f2(s.dCasts)} · vs ${esc(def.name)} @ f${floor}, paired n=${n}</span></div>`;
    });
    return { el: box, refresh };
  }

  sub = { enemy: enemyDesigner(), skill: itemDesigner('skill'), relic: itemDesigner('relic') };
  show('enemy');
  return { el, onShow: () => {}, onHide: () => {} };
}
