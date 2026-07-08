/**
 * toolbench/ui/views/bench.mjs — the BENCH tab: the weighing instrument.
 *
 * Left: player build + enemy config editors. Right: the weigh scale (tilt =
 * measured win rate, streamed in waves so the beam settles as the CI wedge
 * narrows) + measured readouts (TTK, fight-length distribution, damage
 * sources, verdict vs the enemy-slot band). Both-brackets mode runs Simple
 * (greedy) alongside the primary AI and renders it as the ghost needle.
 */

import { $, h, esc, pct, pct1, f1, f2, tagFor, bandTag, histogram, shareBars, debounce } from '../util.mjs';
import { store, allEnemyDefs, specForChoice } from '../store.mjs';
import { weighScale, playerPanel, enemyPanel, aiSelector, progressRow } from '../components.mjs';
import { runBattleArm, seedsFor, chunkFor, makeToken } from '../sim.mjs';
import { aggregate, makeEnemyCombatant, makePlayerCombatant } from '../../engine.mjs';
import { wilson95 } from '../../measure.mjs';
import { CAL } from '../../analytic.mjs';

const bandKeyOf = (def) => (def && (def.type === 'boss' || def.type === 'elite')) ? def.type : 'minion';

export function benchView() {
  const el = h(`<div>
    <h2>Bench</h2>
    <p class="desc">The instrument: seeded Monte-Carlo battles on the <b>real engine</b>, weighed on the beam.
    Tilt = measured player win rate (logit-scaled, level = 50%); the shaded wedge is the 95% CI — it narrows as
    the batch streams in. Green arc = the fair band for this enemy's slot. Pans show each side's measured
    power composite (√(DPT × HP pool)) split by damage source — descriptive; the tilt is the verdict.</p>
    <div class="row" data-controls style="align-items:flex-end;margin-bottom:12px">
      <div class="fix" data-ai-player></div>
      <div class="fix" data-ai-enemy></div>
      <div class="fix"><label class="f">Floor</label><input type="range" data-floor min="1" max="10" step="1" style="width:130px"><span class="mono" data-floor-val style="margin-left:6px;font-weight:700"></span></div>
      <div class="fix"><label class="f">Battles</label><input type="number" data-n min="40" step="100" style="width:84px"></div>
      <div class="fix"><label class="f">&nbsp;</label><label class="tog"><input type="checkbox" data-both> both brackets</label></div>
      <div class="fix"><label class="f">&nbsp;</label><label class="tog"><input type="checkbox" data-auto> auto-weigh</label></div>
    </div>
    <div data-progress></div>
    <div class="grid g32">
      <div data-editors class="col-gap"></div>
      <div>
        <div class="panel scale-panel">
          <div class="eyebrow"><span class="ix">⚖</span>Weigh scale <span class="right hint" data-scale-note></span></div>
          <div data-scale></div>
          <div class="verdict" data-verdict style="display:none"></div>
          <div class="ttk-row" data-ttk style="display:none"></div>
        </div>
        <div class="grid g2" style="margin-top:14px">
          <div class="panel" data-stats-panel style="display:none">
            <div class="eyebrow"><span class="ix">≡</span>Measured readouts</div>
            <div class="stats" data-stats></div>
          </div>
          <div class="panel" data-dist-panel style="display:none">
            <div class="eyebrow"><span class="ix">∿</span>Fight length</div>
            <div data-hist></div>
            <div class="eyebrow" style="margin-top:10px">Player damage by source</div>
            <div data-shares-p></div>
            <div class="eyebrow" style="margin-top:10px">Enemy damage by source</div>
            <div data-shares-e></div>
          </div>
        </div>
      </div>
    </div>
  </div>`);

  /* ── wire controls ── */
  const cfg = store.cfg;
  const floorInput = $('[data-floor]', el);
  const nInput = $('[data-n]', el);
  const bothInput = $('[data-both]', el);
  const autoInput = $('[data-auto]', el);
  floorInput.value = cfg.enemy.floor;
  $('[data-floor-val]', el).textContent = cfg.enemy.floor;
  nInput.value = cfg.battles;
  bothInput.checked = cfg.bothBrackets;
  autoInput.checked = cfg.autoWeigh;

  const scheduleAuto = debounce(() => { if (cfg.autoWeigh && active) weigh({ auto: true }); }, 650);
  const onCfgChange = () => { store.emit(); scheduleAuto(); };

  floorInput.addEventListener('input', () => {
    cfg.enemy.floor = Number(floorInput.value);
    $('[data-floor-val]', el).textContent = floorInput.value;
    ePanel.write();
    onCfgChange();
  });
  nInput.addEventListener('change', () => { cfg.battles = Math.max(40, Number(nInput.value) || 400); onCfgChange(); });
  bothInput.addEventListener('change', () => { cfg.bothBrackets = bothInput.checked; onCfgChange(); });
  autoInput.addEventListener('change', () => { cfg.autoWeigh = autoInput.checked; store.emit(); });

  const pPanel = playerPanel(cfg.player, onCfgChange);
  const ePanel = enemyPanel(cfg.enemy, () => { floorInput.value = cfg.enemy.floor; $('[data-floor-val]', el).textContent = cfg.enemy.floor; onCfgChange(); });
  $('[data-editors]', el).append(pPanel.el, ePanel.el);
  $('[data-ai-player]', el).appendChild(aiSelector('player', onCfgChange).el);
  $('[data-ai-enemy]', el).appendChild(aiSelector('enemy', onCfgChange).el);

  const prog = progressRow({ runLabel: 'Weigh', onRun: () => weigh({}), onCancel: () => { token && (token.cancelled = true); } });
  $('[data-progress]', el).appendChild(prog.el);
  const scale = weighScale($('[data-scale]', el));
  scale.update({ idle: true, band: null, left: { name: 'player' }, right: { name: 'enemy' } });

  /* ── the weigh ── */
  let token = null;
  let active = false;
  let runId = 0;

  function pans(agg, enemyMaxHp, playerMaxHp, pName, eName) {
    const powP = agg ? Math.sqrt(Math.max(0, agg.playerDPT) * playerMaxHp) : null;
    const powE = agg ? Math.sqrt(Math.max(0, agg.enemyDPT) * enemyMaxHp) : null;
    return {
      left: { name: pName, power: powP, parts: agg ? agg.damageShares : {} },
      right: { name: eName, power: powE, parts: agg ? agg.enemyDamageShares : {} },
    };
  }

  async function weigh({ auto = false } = {}) {
    const id = ++runId;
    token && (token.cancelled = true);
    token = makeToken();
    const myToken = token;

    const player = store.playerPayload();
    const enemy = store.enemyPayload();
    const def = allEnemyDefs().find((d) => d.id === cfg.enemy.id) || {};
    const bandKey = bandKeyOf(def);
    const band = CAL.winBands[bandKey];
    const aiKey = store.aiKey('player');
    const playerSpec = store.aiSpec('player');
    const enemySpec = store.aiSpec('enemy');
    const nFull = cfg.battles;
    const n = auto ? Math.min(nFull, aiKey === 'simple' ? 240 : 80) : nFull;
    const seeds = seedsFor(`gems-bench|f${cfg.enemy.floor}|${cfg.enemy.id}`, n);
    const chunk = chunkFor(aiKey);

    // main-thread combatant previews for pan pools (no battle, no RNG swap)
    let pName = 'player', eName = 'enemy', pMax = 1, eMax = 1;
    try {
      const pc = makePlayerCombatant(player);
      const ec = makeEnemyCombatant(enemy.def || enemy.id, enemy.floor, enemy.overrides);
      pName = pc.name; eName = ec.name; pMax = pc.maxHp + pc.armor; eMax = ec.maxHp + ec.armor;
    } catch { /* preview only */ }

    prog.running(true);
    prog.status(`${aiKey} · n=${n}${auto ? ' (auto)' : ''}`);
    $('[data-scale-note]', el).textContent = `${pName} vs ${eName} @ f${cfg.enemy.floor} · AI ${aiKey}${cfg.bothBrackets ? ' + ghost simple' : ''}`;

    const results = [];
    let ghost = null;
    try {
      // stream in waves so the beam settles as confidence builds
      const waves = Math.max(1, Math.min(12, Math.round(n / (chunk * 2))));
      const per = Math.ceil(n / waves);
      for (let wStart = 0; wStart < n; wStart += per) {
        if (myToken.cancelled) throw { cancelled: true };
        const slice = seeds.slice(wStart, wStart + per);
        const part = await runBattleArm({
          player, enemy, seeds: slice, playerSpec, enemySpec, chunk, token: myToken,
          onProgress: (f) => prog.progress((wStart + f * slice.length) / n * (cfg.bothBrackets ? 0.7 : 1)),
        });
        if (id !== runId) return;
        results.push(...part);
        const wins = results.filter((r) => r.playerWon).length;
        const ci = wilson95(wins, results.length);
        const agg = aggregate(results);
        scale.update({
          winRate: wins / results.length, ciLo: ci.lo, ciHi: ci.hi, n: results.length,
          running: wStart + per < n, band, ghost: null,
          ...pans(agg, eMax, pMax, pName, eName),
        });
      }

      // second bracket (ghost): greedy, unless the primary IS greedy → champion ghost
      if (cfg.bothBrackets) {
        const ghostKey = aiKey === 'simple' ? 'hard' : 'simple';
        const gn = Math.min(n, ghostKey === 'simple' ? 240 : 80);
        const gRes = await runBattleArm({
          player, enemy, seeds: seeds.slice(0, gn),
          playerSpec: specForChoice(ghostKey),
          enemySpec, chunk: chunkFor(ghostKey), token: myToken,
          onProgress: (f) => prog.progress(0.7 + f * 0.3),
        });
        if (id !== runId) return;
        ghost = { winRate: gRes.filter((r) => r.playerWon).length / gRes.length, label: `${ghostKey} bracket (n=${gn})` };
      }
    } catch (e) {
      if (!e || !e.cancelled) { prog.status('error: ' + (e && e.message || e)); console.error(e); }
      prog.running(false);
      return;
    }
    if (id !== runId) return;
    prog.running(false);
    prog.status('done');

    const agg = aggregate(results);
    const wins = results.filter((r) => r.playerWon).length;
    const ci = wilson95(wins, results.length);
    scale.update({
      winRate: agg.winRate, ciLo: ci.lo, ciHi: ci.hi, n: agg.n, running: false, band, ghost,
      ...pans(agg, eMax, pMax, pName, eName),
    });
    renderReadouts(agg, { def, bandKey, band, ghost, pMax });
    return agg;
  }

  function renderReadouts(agg, { def, bandKey, band, ghost }) {
    /* verdict */
    const winTag = agg.winRate < band[0] ? { cls: 'bad', label: 'enemy-favored' }
      : agg.winRate > band[1] ? { cls: 'info', label: 'player-favored' }
      : { cls: 'good', label: 'in band' };
    const turnBand = CAL.fightBands[bandKey];
    const turnTag = bandTag(agg.turns.mean, turnBand);
    const burstMax = CAL.burstShareMax[bandKey];
    const burstTag = agg.burstShare > burstMax ? { cls: 'bad', label: 'spiky' } : (agg.burstShare < 0.12 ? { cls: 'info', label: 'toothless' } : { cls: 'good', label: 'burst ok' });
    let verdict = 'Balanced for its slot.';
    if (agg.winRate < band[0]) verdict = `Too hard for a ${bandKey} here (win ${pct(agg.winRate)} < ${pct(band[0])}). Lower baseline HP/attack or move to later floors.`;
    else if (agg.winRate > band[1]) verdict = `Too easy for a ${bandKey} here (win ${pct(agg.winRate)} > ${pct(band[1])}). Raise attack (lethality) before HP (pacing).`;
    else if (agg.turns.mean > turnBand[1]) verdict = `Right lethality but the fight drags (${f1(agg.turns.mean)} > ${turnBand[1]} turns). Cut HP, keep attack.`;
    else if (agg.turns.mean < turnBand[0]) verdict = `Over too fast (${f1(agg.turns.mean)} < ${turnBand[0]} turns). Add HP for pacing.`;
    const ghostTxt = ghost ? ` Ghost needle: ${esc(ghost.label)} lands at <b>${pct1(ghost.winRate)}</b> — the bracket gap ${pct1(Math.abs(agg.winRate - ghost.winRate))} is the skill-expression read.` : '';
    const v = $('[data-verdict]', el);
    v.style.display = '';
    v.innerHTML = `${tagFor(winTag)} ${tagFor(turnTag)} ${tagFor(burstTag)} <span>${verdict} <span class="hint">band ${pct(band[0])}–${pct(band[1])} for a ${bandKey}.</span>${ghostTxt}</span>`;

    /* TTK pair */
    const winTurns = agg.results.filter((r) => r.playerWon).map((r) => r.turns);
    const lossCycles = agg.results.filter((r) => r.winner === 'enemy').map((r) => r.turnCycles);
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const ttk = $('[data-ttk]', el);
    ttk.style.display = '';
    ttk.innerHTML = `
      <div class="ttk"><div class="k">⏱ Player kills ${esc(def.name || 'enemy')} in</div><div class="v">${f1(mean(winTurns))} <small>turns (on wins)</small></div></div>
      <div class="ttk"><div class="k">⏱ ${esc(def.name || 'Enemy')} kills player in</div><div class="v">${f1(mean(lossCycles))} <small>cycles (on losses${lossCycles.length ? `, n=${lossCycles.length}` : ' — none'})</small></div></div>`;

    /* stats tiles */
    $('[data-stats-panel]', el).style.display = '';
    $('[data-stats]', el).innerHTML = `
      <div class="stat"><div class="k">Player win</div><div class="v" style="color:${agg.winRate >= band[0] && agg.winRate <= band[1] ? 'var(--good)' : 'var(--warn)'}">${pct1(agg.winRate)}</div></div>
      <div class="stat"><div class="k">Death risk</div><div class="v">${pct1(1 - agg.winRate - agg.drawRate)}</div></div>
      <div class="stat"><div class="k">Turns</div><div class="v">${f1(agg.turns.mean)} <small>p10 ${agg.turns.p10} · p90 ${agg.turns.p90}</small></div></div>
      <div class="stat"><div class="k">HP left on win</div><div class="v">${pct(agg.hpLeftOnWin)}</div></div>
      <div class="stat"><div class="k">Burst share</div><div class="v">${pct(agg.burstShare)}</div></div>
      <div class="stat"><div class="k">Player DPT</div><div class="v">${f2(agg.playerDPT)}</div></div>
      <div class="stat"><div class="k">Enemy DPT</div><div class="v">${f2(agg.enemyDPT)}</div></div>
      <div class="stat"><div class="k">Mana / turn</div><div class="v">${f2(agg.manaPerTurn)}</div></div>
      <div class="stat"><div class="k">Extra turns</div><div class="v">${f2(agg.extraTurnRate)} <small>/turn</small></div></div>
      <div class="stat"><div class="k">Casts / fight</div><div class="v">${f2(agg.castsPerFight)}</div></div>
      <div class="stat"><div class="k">Draws</div><div class="v">${pct(agg.drawRate)}</div></div>`;

    /* distribution + shares */
    $('[data-dist-panel]', el).style.display = '';
    $('[data-hist]', el).innerHTML = histogram(agg.results.map((r) => r.turns), { label: 'player turns to resolve', w: 420, h: 120 });
    $('[data-shares-p]', el).innerHTML = shareBars(agg.damageShares, { skull: 'var(--t-skull)', skill: 'var(--signal)', skullDestroy: '#E08A4A', passive: 'var(--t-green)', poisonTick: 'var(--t-green)' });
    $('[data-shares-e]', el).innerHTML = shareBars(agg.enemyDamageShares, { skull: 'var(--t-skull)', skill: 'var(--t-red)' });
  }

  const unsub = store.onChange(() => { /* other tabs may mutate cfg */ });

  let autoran = false;
  return {
    el,
    onShow() {
      active = true; pPanel.refreshWoven(); pPanel.write(); ePanel.write();
      // scripted smoke: ?autorun=1 [&ai=simple] weighs once on first show and
      // beacons the result to the dev server (serve.mjs logs it as [bench])
      if (!autoran && new URLSearchParams(location.search).has('autorun')) {
        autoran = true;
        weigh({ auto: true })
          .then((agg) => fetch('/__bench', { method: 'POST', body: JSON.stringify(agg ? { ok: true, winRate: agg.winRate, n: agg.n, turns: agg.turns.mean } : { ok: false, note: 'no agg (cancelled/superseded)' }) }))
          .catch((e) => fetch('/__bench', { method: 'POST', body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) }));
      }
    },
    onHide() { active = false; token && (token.cancelled = true); },
    destroy() { unsub(); },
  };
}
