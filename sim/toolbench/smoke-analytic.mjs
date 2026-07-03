/** smoke-analytic.mjs — sanity check of the analytic module. Run: node sim/toolbench/smoke-analytic.mjs */
import * as A from './analytic.mjs';
import SKILL_CATALOG from '../../src/js/data/skills/skillCatalog.js';
import RELIC_CATALOG from '../../src/js/data/relics/relicCatalog.js';

const st = { attack: 5, magic: 5 };
for (const s of Object.values(SKILL_CATALOG)) {
  const r = A.skillSummary(s, st);
  console.log(`${s.name.padEnd(20)} cost=${String(r.cost).padStart(2)} dev=${r.dev.toFixed(1).padStart(6)} v/mana=${(r.cost ? r.vpm : Infinity).toFixed(2).padStart(6)} ${r.band}`);
}
let relics = 0;
for (const r of Object.values(RELIC_CATALOG)) { const s = A.relicDEVPerFight(r, st); if (!isFinite(s.dev)) throw new Error('bad dev ' + r.id); relics++; }
console.log(`relics scored: ${relics}`);
const synth = A.synthCostEstimate(SKILL_CATALOG.bash, st);
console.log('bash synth price:', synth.suggestedCost, 'power', synth.power.toFixed(1));
console.log(A.enemySnippet({ id: 'test_dummy', name: 'Test Dummy', hp: 16, attack: 2, floors: [3, 4] }).split('\n')[1]);
console.log('ANALYTIC OK');
