/**
 * toolbench/ui/views/weave.mjs — the WEAVE tab: draft a skill, then price it.
 *
 * Draft mode replays the in-game "Weave a Power" flow headlessly through the
 * REAL tables (rollRoundsPerWeave/rollTagsPerRound/drawTagsForRound) and the
 * REAL synthesizer — or free-pick any tags. The result card shows the exact
 * skill (cost split, effect lines, wasted-tag reasons, synth power), then:
 * MEASURE it (paired battles with/without on the Bench frame → ΔWin ± CI,
 * eqHP), ADD it to the build (usable in Bench/Compare/Runs), or SAVE it to
 * Designer customs. Distribution mode synthesizes N random weaves and places
 * the draft's power on that curve + against the authored catalog.
 */

import { $, $$, h, esc, pct1, pp, f1, f2, signed, tagFor, histogram, COLOR_CSS } from '../util.mjs';
import { store, specForChoice, customs, saveCustoms, CHARACTERS_BY_ID, SKILL_CATALOG } from '../store.mjs';
import { progressRow } from '../components.mjs';
import { runBattleArm, seedsFor, chunkFor, makeToken, hpSlope, armCacheKey, baselineArm } from '../sim.mjs';
import { pairedStats } from '../../measure.mjs';
import { affinityColorsFor, colorBiasFor, makeRandomWovenSkill } from '../../run-core.mjs';
import { synthCostEstimate } from '../../analytic.mjs';
import { SKILL_WEAVE_TAGS, drawTagsForRound, getTagLabel, getTagRarity } from '../../../../src/js/data/skillWeaveTags.js';
import { rollRoundsPerWeave, rollTagsPerRound } from '../../../../src/js/data/weaveConfig.js';
import { synthesize } from '../../../../src/js/data/skillSynthesizer.js';

const stripMarkup = (s) => String(s || '').replace(/\[\[(.+?)\]\]/g, '$1').replace(/<<(.+?)>>/g, '$1');
const RARITY_COLOR = { common: 'var(--ink-2)', uncommon: 'var(--t-green)', rare: 'var(--t-purple)', legendary: 'var(--t-yellow)' };

function quietSynthesize(recipe, opts) {
  const orig = console.log;
  console.log = () => {};
  try { return synthesize(recipe, opts); } finally { console.log = orig; }
}

export function weaveView() {
  const el = h(`<div>
    <h2>Weave</h2>
    <p class="desc">Weave a skill through the <b>real</b> draft tables + synthesizer, then price it like the trainer
    would: paired battles with/without → ΔWin ± CI and eqHP, plus a percentile against random weaves and the
    authored catalog (shared synth-power scale).</p>
    <div class="row" style="align-items:flex-end;margin-bottom:10px">
      <div class="fix"><label class="f">Character (affinity)</label><select data-char>
        ${Object.values(CHARACTERS_BY_ID).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="fix"><label class="f">&nbsp;</label><button class="btn primary" data-roll>Roll a draft</button></div>
      <div class="fix"><label class="f">Free-pick a tag</label><select data-free>
        <option value="">— add any tag —</option>
        ${Object.values(SKILL_WEAVE_TAGS).filter((t) => !t.disabled).map((t) => `<option value="${t.id}">${esc(t.label)} (${t.category} · ${t.rarity})</option>`).join('')}</select></div>
      <div class="fix"><label class="f">&nbsp;</label><button class="btn" data-back disabled>← Back</button></div>
      <div class="fix"><label class="f">&nbsp;</label><button class="btn" data-clear>Clear</button></div>
    </div>
    <div class="grid g2">
      <div>
        <div class="panel"><div class="eyebrow">Draft <span class="right hint" data-plan></span></div>
          <div data-recipe class="chips-row"></div>
          <div data-options style="margin-top:10px"></div>
        </div>
        <div class="panel" style="margin-top:12px" data-card-panel hidden>
          <div class="eyebrow"><span class="ix">✦</span>Woven skill</div>
          <div data-card></div>
          <div class="row" style="margin-top:10px">
            <div class="fix"><button class="btn primary" data-measure>Measure on Bench frame</button></div>
            <div class="fix"><button class="btn" data-reroll>Reroll magnitudes</button></div>
            <div class="fix"><button class="btn" data-add>Add to build</button></div>
            <div class="fix"><button class="btn" data-save>Save to customs</button></div>
          </div>
          <div data-progress></div>
          <div data-measure-out></div>
        </div>
      </div>
      <div>
        <div class="panel"><div class="eyebrow">Power distribution <span class="right hint">shared synth-power scale</span></div>
          <div class="row" style="align-items:flex-end">
            <div class="fix"><label class="f">Random weaves</label><input type="number" data-dn value="400" min="50" step="100" style="width:84px"></div>
            <div class="fix"><label class="f">&nbsp;</label><button class="btn" data-dist>Synthesize N random</button></div>
          </div>
          <div data-dist-out style="margin-top:10px"></div>
        </div>
      </div>
    </div>
  </div>`);

  /* ── draft state ── */
  let plan = null;        // { rounds, counts[] }
  let steps = [];         // [{ options[], picked }]
  let recipe = [];
  let synthesis = null;
  let lastDistribution = null;

  const charId = () => $('[data-char]', el).value;

  function rollPlan() {
    plan = { rounds: rollRoundsPerWeave(), counts: [] };
    for (let r = 0; r < plan.rounds; r++) plan.counts.push(rollTagsPerRound());
    steps = []; recipe = []; synthesis = null;
    nextStep();
    renderDraft();
  }

  function nextStep() {
    if (!plan || recipe.length >= plan.rounds) return;
    const options = drawTagsForRound({
      roundIndex: recipe.length, chosen: recipe, count: plan.counts[recipe.length],
      colorBias: colorBiasFor(charId()), // the game's affinity-color draw weighting
    });
    steps.push({ options, picked: null });
  }

  function pick(tag) {
    if (steps.length) steps[steps.length - 1].picked = tag;
    recipe.push(tag);
    if (plan && recipe.length < plan.rounds) nextStep();
    maybeSynthesize();
    renderDraft();
  }

  function maybeSynthesize() {
    synthesis = null;
    const complete = plan ? recipe.length >= plan.rounds : recipe.length >= 2;
    if (recipe.length && complete) {
      synthesis = quietSynthesize([...recipe], { affinityColors: affinityColorsFor(charId()) });
    }
    renderCard();
  }

  $('[data-roll]', el).addEventListener('click', rollPlan);
  $('[data-free]', el).addEventListener('change', (ev) => {
    const id = ev.target.value;
    if (!id) return;
    plan = null; // free-pick leaves the rolled plan
    if (recipe.length < 4) { recipe.push(id); steps = []; }
    ev.target.value = '';
    maybeSynthesize();
    renderDraft();
  });
  $('[data-back]', el).addEventListener('click', () => {
    if (!recipe.length) return;
    recipe.pop();
    if (plan) { steps = steps.slice(0, recipe.length); nextStep(); }
    maybeSynthesize();
    renderDraft();
  });
  $('[data-clear]', el).addEventListener('click', () => { plan = null; steps = []; recipe = []; synthesis = null; renderDraft(); renderCard(); });
  $('[data-reroll]', el).addEventListener('click', () => { maybeSynthesize(); });

  function renderDraft() {
    $('[data-plan]', el).textContent = plan ? `${plan.rounds} rounds · ${plan.counts.join('/')} options` : (recipe.length ? 'free-pick' : 'roll or free-pick');
    $('[data-back]', el).disabled = !recipe.length;
    $('[data-recipe]', el).innerHTML = recipe.length
      ? recipe.map((t) => `<span class="chip" style="border-color:${RARITY_COLOR[getTagRarity(t)] || 'var(--line-2)'}">${esc(getTagLabel(t))} <span class="hint">${getTagRarity(t)}</span></span>`).join('')
      : '<span class="hint">no tags picked yet</span>';
    const cur = steps[steps.length - 1];
    const optBox = $('[data-options]', el);
    if (plan && cur && cur.picked == null && recipe.length < plan.rounds) {
      optBox.innerHTML = `<div class="hint" style="margin-bottom:6px">round ${recipe.length + 1} of ${plan.rounds} — pick one:</div>`
        + `<div class="chips-row">${cur.options.map((t) => `<button class="btn tagopt" data-tag="${t}" style="border-color:${RARITY_COLOR[getTagRarity(t)] || 'var(--line-2)'}">${esc(getTagLabel(t))}<span class="hint" style="margin-left:6px">${getTagRarity(t)}</span></button>`).join('')}</div>`;
      $$('.tagopt', optBox).forEach((b) => b.addEventListener('click', () => pick(b.dataset.tag)));
    } else if (plan && recipe.length >= plan.rounds) {
      optBox.innerHTML = '<div class="hint">draft complete — the woven skill is below.</div>';
    } else {
      optBox.innerHTML = '';
    }
  }

  function renderCard() {
    const panel = $('[data-card-panel]', el);
    if (!synthesis || !synthesis.skill) { panel.hidden = true; return; }
    panel.hidden = false;
    const sk = synthesis.skill;
    const cost = Object.entries(sk.cost || {}).map(([c, v]) =>
      `<span class="mono" style="color:${COLOR_CSS[c] || 'var(--ink)'};font-weight:700">${v} ${c}</span>`).join(' + ') || 'free';
    const lines = (sk.descriptionLines || String(sk.description || '').split('\n')).map((l) => `<li>${esc(stripMarkup(l))}</li>`).join('');
    const wasted = Object.entries(synthesis.wastedReasons || {}).map(([tag, why]) =>
      `<div class="kv"><span class="k" style="color:var(--warn)">wasted · ${esc(getTagLabel(tag))}</span><span class="v hint">${esc(why)}</span></div>`).join('');
    $('[data-card]', el).innerHTML = `
      <div class="skill-card">
        <div class="skill-name">${esc(sk.name)} <span class="hint mono">cost ${cost}${sk.targeting ? ' · targeted' : ''}</span></div>
        <ul class="skill-lines">${lines}</ul>
        ${wasted}
        <div class="hint mono" style="margin-top:6px">synth power ${f1(synthesis.power)} · recipe [${recipe.map(getTagLabel).join(', ')}]</div>
      </div>`;
    if (lastDistribution) renderDistribution(lastDistribution);
  }

  /* ── measure ── */
  const prog = progressRow({ runLabel: '', onRun: null, onCancel: () => { token && (token.cancelled = true); } });
  prog.el.querySelector('[data-run]').style.display = 'none';
  $('[data-progress]', el).appendChild(prog.el);
  let token = null;

  $('[data-measure]', el).addEventListener('click', async () => {
    if (!synthesis || !synthesis.skill) return;
    token = makeToken();
    const t = token;
    const n = 240;
    const player = { ...store.playerPayload(), characterId: charId() };
    const enemy = store.enemyPayload();
    const aiKey = store.aiKey('player');
    const spec = specForChoice(aiKey);
    const chunk = chunkFor(aiKey);
    const seeds = seedsFor(`gems-weave|${store.cfg.enemy.id}|f${store.cfg.enemy.floor}`, n);
    prog.running(true);
    prog.status(`${charId()} vs ${store.cfg.enemy.id} @ f${store.cfg.enemy.floor} · AI ${aiKey} · n=${n}`);
    try {
      const baseKey = armCacheKey({ player, enemy, spec, seedsNs: 'weave', n });
      const base = await baselineArm(baseKey + '|base', () =>
        runBattleArm({ player, enemy, playerSpec: spec, seeds, chunk, token: t, onProgress: (f) => prog.progress(f / 3) }));
      const slope = await hpSlope({ key: baseKey, player, enemy, playerSpec: spec, seeds, chunk, token: t, onProgress: (f) => prog.progress((1 + f) / 3) });
      const varr = await runBattleArm({
        player: { ...player, customSkills: [...(player.customSkills || []), synthesis.skill] },
        enemy, playerSpec: spec, seeds, chunk, token: t, onProgress: (f) => prog.progress((2 + f) / 3),
      });
      const s = pairedStats(base, varr);
      const eq = slope.slope >= 0.0015 ? s.dWin / slope.slope : null;
      const sig = Math.abs(s.dWin) > s.ci95;
      const chip = !sig ? { cls: 'warn', label: 'unresolved' }
        : s.dWin > 0.12 ? { cls: 'bad', label: 'too strong?' }
        : s.dWin < 0.005 ? { cls: 'info', label: 'no impact' } : { cls: 'good', label: 'healthy' };
      $('[data-measure-out]', el).innerHTML = `<div class="verdict">${tagFor(chip)}
        <span><b>ΔWin ${pp(s.dWin)} ± ${(s.ci95 * 100).toFixed(1)}</b> (${pct1(s.winBase)} → ${pct1(s.winVar)}, paired n=${s.n})
        ${eq != null ? ` · worth ≈ <b>${signed(eq, 1)} max HP</b>` : ''} · casts/fight ${f2(s.castsPerFight)}${s.dCasts < 0.05 ? ' <b style="color:var(--warn)">· barely ever cast</b>' : ''}</span></div>`;
    } catch (e) {
      if (!e || !e.cancelled) prog.status('error: ' + (e && e.message || e));
    }
    prog.running(false);
  });

  /* ── add / save ── */
  $('[data-add]', el).addEventListener('click', () => {
    if (!synthesis || !synthesis.skill) return;
    store.wovenSkills.push({ skill: structuredClone(synthesis.skill), recipe: [...recipe] });
    store.cfg.player.wovenSkillIdx = [...(store.cfg.player.wovenSkillIdx || []), store.wovenSkills.length - 1];
    store.emit();
    $('[data-measure-out]', el).innerHTML = `<div class="verdict">${tagFor({ cls: 'good', label: 'added' })}
      <span><b>${esc(synthesis.skill.name)}</b> is now in the Bench build — ticked under the player panel's "Extra skills"
      (persists across reloads; ✕ there deletes it).</span></div>`;
  });
  $('[data-save]', el).addEventListener('click', () => {
    if (!synthesis || !synthesis.skill) return;
    const sk = structuredClone(synthesis.skill);
    sk.id = `woven_${Date.now().toString(36)}`;
    sk._custom = true;
    customs.skills.push(sk);
    saveCustoms();
    $('[data-measure-out]', el).innerHTML = `<div class="verdict">${tagFor({ cls: 'good', label: 'saved' })}
      <span>Saved as custom skill <b>${esc(sk.id)}</b> — persistent, selectable in Designer/panels.</span></div>`;
  });

  /* ── distribution ── */
  $('[data-dist]', el).addEventListener('click', () => {
    const nD = Math.max(50, Number($('[data-dn]', el).value) || 400);
    const powers = [];
    for (let i = 0; i < nD; i++) {
      const made = makeRandomWovenSkill(charId());
      if (made && made.skill && made.skill.woven) powers.push(made.skill.woven.power);
    }
    powers.sort((a, b) => a - b);
    const refStats = { attack: 5, magic: 5 };
    const catalogPowers = Object.values(SKILL_CATALOG)
      .map((s) => { try { return synthCostEstimate(s, refStats).power; } catch { return null; } })
      .filter((p) => p != null && isFinite(p)).sort((a, b) => a - b);
    lastDistribution = { powers, catalogPowers };
    renderDistribution(lastDistribution);
  });

  function renderDistribution({ powers, catalogPowers }) {
    const pctile = (arr, v) => arr.length ? Math.round(arr.filter((x) => x <= v).length / arr.length * 100) : null;
    const cur = synthesis && synthesis.power;
    const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null;
    $('[data-dist-out]', el).innerHTML = `
      ${histogram(powers, { label: `synth power of ${powers.length} random ${esc(charId())} weaves`, w: 420, h: 130, color: 'var(--t-purple)' })}
      <div class="stats" style="margin-top:8px">
        <div class="stat"><div class="k">Random p10/p50/p90</div><div class="v">${f1(q(powers, 0.1))} / ${f1(q(powers, 0.5))} / ${f1(q(powers, 0.9))}</div></div>
        <div class="stat"><div class="k">Catalog p10/p50/p90</div><div class="v">${f1(q(catalogPowers, 0.1))} / ${f1(q(catalogPowers, 0.5))} / ${f1(q(catalogPowers, 0.9))}</div></div>
        ${cur != null ? `<div class="stat"><div class="k">This draft</div><div class="v">${f1(cur)} <small>p${pctile(powers, cur)} of weaves · p${pctile(catalogPowers, cur)} of catalog</small></div></div>` : ''}
      </div>
      <p class="note">Same power scale the synthesizer prices mana costs from — a high-power draft also costs more,
      so "strong" here means power-per-mana luck. Measure the draft for the ground truth.</p>`;
  }

  renderDraft();
  return { el, onShow() {}, onHide() { token && (token.cancelled = true); } };
}
