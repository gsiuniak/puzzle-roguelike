/**
 * toolbench/ui/views/reference.mjs — the REFERENCE tab (ported from v1).
 * Live engine constants + the analytic model's editable calibration, plus a
 * PARITY check: a fixed seeded batch whose digest should match the node CLI.
 */

import { $, $$, h, esc, pct } from '../util.mjs';
import { store } from '../store.mjs';
import { runBattleArm, seedsFor, makeToken } from '../sim.mjs';
import {
  ENEMY_HP_FLOOR_MULT, ENEMY_ATTACK_FLOOR_BONUS, MAGIC_MANA_PER_POINT,
  RELIC_RARITY_WEIGHTS, CHARACTERS_BY_ID, DEFAULT_GROWTH_PLAN,
} from '../../engine.mjs';
import * as A from '../../analytic.mjs';
import { TILE_TYPES } from '../../../../src/js/game/TileTypes.js';
import { DAMAGE_SCALING_PRESETS } from '../../../../src/js/data/scalingConfig.js';

export function referenceView() {
  const el = h(`<div>
    <h2>Reference & Calibration</h2>
    <p class="desc">Left: the exact live constants (imported from source — if the game changes, this changes).
    Right: the analytic model's tunable assumptions. The full framework lives in
    <a href="../docs/balance-power-model.md">docs/balance-power-model.md</a>; the bench design in
    <a href="../docs/balance-bench-v2-design.md">docs/balance-bench-v2-design.md</a>.</p>
    <div class="grid g2">
      <div>
        <div class="panel"><h3>Engine constants [CODE — live]</h3><div data-const></div></div>
        <div class="panel" style="margin-top:12px"><h3>Fidelity notes (what the sim simplifies)</h3>
          <ul class="note" style="padding-left:16px;margin:4px 0">
            <li>The Simple bracket is the shipped greedy AI; custom enemy AIs (sapper, malakor) approximate to skill-first + best swap. The Hard bracket is the trained champion formula policy.</li>
            <li>Targeted skills auto-target (rows/areas pick most skulls; convert_tile prefers a match-enabler spot).</li>
            <li>onMatch4Plus fires once per cascade step; the game dispatches per step with a real center position.</li>
            <li>Egg phase, thrall seed/harvest, disease ramp, echo, deathbringer, dynamic attack are modeled; some woven exotica (greater surges) are not.</li>
            <li><b>All bench batches are SEEDED</b> (rng.mjs) — same seeds in node produce identical results; use Parity below to prove it.</li>
          </ul>
        </div>
        <div class="panel" style="margin-top:12px"><h3>Parity check (browser ↔ node)</h3>
          <p class="note">Runs 30 fixed-seed greedy battles (warrior v2 vs goblin f3) and prints a digest of the
          outcomes. Run the same in node:<br>
          <code>node sim/toolbench/reports/bench-parity.mjs</code> (script is created on demand — see the digest text)
          — the two digests must match exactly.</p>
          <button class="btn" data-parity>Run parity batch</button>
          <pre class="code" data-parity-out style="margin-top:8px;display:none"></pre>
        </div>
      </div>
      <div class="panel"><h3>Calibration [MODEL — editable]</h3>
        <div class="row" style="margin-bottom:8px"><button class="btn small fix" data-reset>Reset defaults</button>
        <span class="hint">changes apply to Audit/Designer analytic scores immediately</span></div>
        <div data-cal style="display:grid;grid-template-columns:1fr 1fr;gap:2px 14px"></div>
      </div>
    </div>
  </div>`);

  function renderConst() {
    const weights = Object.values(TILE_TYPES).filter((t) => t.spawnWeight > 0).map((t) => `${t.id} ${t.spawnWeight}`).join(' · ');
    const growth = Object.values(CHARACTERS_BY_ID).map((c) =>
      `<div class="kv"><span class="k">${esc(c.name)} growth/win</span><span class="v">${esc(JSON.stringify(c.growthPlan || DEFAULT_GROWTH_PLAN))}</span></div>`).join('');
    $('[data-const]', el).innerHTML = `
      <div class="kv"><span class="k">Spawn weights</span><span class="v">${weights}</span></div>
      <div class="kv"><span class="k">Matched skulls</span><span class="v">round(N × (1 + (A−1)/3))</span></div>
      <div class="kv"><span class="k">Destroyed skulls</span><span class="v">N × (1 + ⌊A/3⌋)</span></div>
      <div class="kv"><span class="k">Mitigation</span><span class="v">status → mark → reduce → barrier → armor → block → HP</span></div>
      <div class="kv"><span class="k">Magic → mana</span><span class="v">+⌊M/${MAGIC_MANA_PER_POINT}⌋ per matched color</span></div>
      <div class="kv"><span class="k">Poison</span><span class="v">tick = stacks (absorbed), then ⌊/2⌋, applier's turn end</span></div>
      <div class="kv"><span class="k">Extra turn</span><span class="v">any single match ≥ 4; retain flag</span></div>
      <div class="kv"><span class="k">Enemy HP mult by floor</span><span class="v">${ENEMY_HP_FLOOR_MULT.join(', ')}</span></div>
      <div class="kv"><span class="k">Enemy atk bonus by floor</span><span class="v">${ENEMY_ATTACK_FLOOR_BONUS.join(', ')}</span></div>
      <div class="kv"><span class="k">Relic drop weights</span><span class="v">${esc(JSON.stringify(RELIC_RARITY_WEIGHTS))}</span></div>
      ${growth}
      <div class="kv"><span class="k">Scaling presets</span><span class="v">${Object.keys(DAMAGE_SCALING_PRESETS).join(' ')}</span></div>
      <p class="note" style="margin-top:8px">Floor curves live in the SHARED src/js/data/enemyScaling.js (game + bench read the same file).
      Other mirrored constants are guarded by <code>node sim/toolbench/drift-check.mjs</code>.</p>`;
  }

  function renderCal() {
    const flat = Object.entries(A.CAL).filter(([, v]) => typeof v === 'number');
    $('[data-cal]', el).innerHTML = flat.map(([k, v]) =>
      `<label class="f" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0">
      <span>${esc(k)}</span><input type="number" data-cal-k="${k}" value="${v}" step="0.05" style="width:90px"></label>`).join('');
    $$('[data-cal-k]', el).forEach((i) => i.addEventListener('change', () => {
      A.CAL[i.dataset.calK] = Number(i.value);
    }));
  }

  $('[data-reset]', el).addEventListener('click', () => { A.resetCal(); renderCal(); });

  $('[data-parity]', el).addEventListener('click', async () => {
    const out = $('[data-parity-out]', el);
    out.style.display = '';
    out.textContent = 'running…';
    const results = await runBattleArm({
      player: { characterId: 'warrior', victories: 2 },
      enemy: { id: 'goblin', floor: 3, overrides: {} },
      seeds: seedsFor('gems-parity', 30),
      chunk: 30, token: makeToken(),
    });
    const digest = results.map((r) => `${r.playerWon ? 'W' : (r.winner === 'draw' ? 'D' : 'L')}${r.turns}`).join(' ');
    out.textContent = `digest: ${digest}\n\n// node equivalent (save as sim/toolbench/reports/bench-parity.mjs, run from repo root):
import { Battle, makePlayerCombatant, makeEnemyCombatant } from '../engine.mjs';
import { withSeededRandom, hashSeed } from '../rng.mjs';
const out = [];
for (let i = 0; i < 30; i++) {
  const seed = hashSeed('gems-parity', i);
  const r = withSeededRandom(seed, () => new Battle(
    makePlayerCombatant({ characterId: 'warrior', victories: 2 }),
    makeEnemyCombatant('goblin', 3),
  ).run());
  out.push((r.playerWon ? 'W' : (r.winner === 'draw' ? 'D' : 'L')) + r.turns);
}
console.log('digest:', out.join(' '));`;
  });

  return { el, onShow: () => { renderConst(); renderCal(); }, onHide: () => {} };
}
