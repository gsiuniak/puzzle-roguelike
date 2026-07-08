/**
 * toolbench/run-core.mjs — the BROWSER-SAFE full-run simulation core.
 *
 * Extracted from runs.mjs (2026-07-08, Balance Bench v2 Phase 0): everything
 * needed to play ONE seeded, policy-driven, reward-logging 10-floor run — no
 * node: imports, so the browser bench worker and the node pool worker execute
 * the exact same code. runs.mjs keeps the CLI (JSONL I/O, pool fan-out,
 * report printing) and re-exports these for back-compat.
 *
 * Design invariants (see runs.mjs header for the full rationale):
 *  - random-of-offered reward picks → every reward node is an RCT
 *  - weave training floors run the REAL drawTagsForRound/synthesize pipeline
 *  - fully seeded (rng.mjs withSeededRandom) → any run is replayable by seed
 */

import { simulateRun, CHARACTERS_BY_ID, SKILL_CATALOG } from './engine.mjs';
import { withSeededRandom } from './rng.mjs';
import { drawTagsForRound } from '../../src/js/data/skillWeaveTags.js';
import { rollRoundsPerWeave, rollTagsPerRound, COLOR_AFFINITY_WEIGHT } from '../../src/js/data/weaveConfig.js';
import { synthesize } from '../../src/js/data/skillSynthesizer.js';

/** The character's affinity colors = colors appearing in its kit skills' costs
 *  (mirrors what SkillWeaveScene passes to the synthesizer). */
export function affinityColorsFor(characterId) {
  const def = CHARACTERS_BY_ID[characterId];
  const colors = new Set();
  for (const id of (def && def.skills) || []) {
    const skill = SKILL_CATALOG[id];
    for (const col of Object.keys((skill && skill.cost) || {})) colors.add(col);
  }
  return [...colors];
}

/** The game's draw bias: affinity-color element tags drawn ×COLOR_AFFINITY_WEIGHT
 *  (mirrors SkillWeaveScene._rollWeavePlan's colorBias construction). */
export function colorBiasFor(characterId) {
  const bias = {};
  for (const c of affinityColorsFor(characterId)) bias[c] = COLOR_AFFINITY_WEIGHT;
  return bias;
}

/**
 * One random-of-offered weave draft through the REAL roll tables + synthesizer.
 * Returns { skill, recipe, events } or null. `events` = one per draft round:
 * { round, offered, picked } (floor stamped by the caller). Exported so
 * learn.mjs can deal realistic woven skills into its training battles.
 */
export function makeRandomWovenSkill(characterId) {
  const affinityColors = affinityColorsFor(characterId);
  const colorBias = colorBiasFor(characterId);
  const rounds = rollRoundsPerWeave();
  const recipe = [];
  const events = [];
  for (let r = 0; r < rounds; r++) {
    const options = drawTagsForRound({ roundIndex: r, chosen: recipe, count: rollTagsPerRound(), colorBias });
    if (!options.length) break;
    const picked = options[Math.floor(Math.random() * options.length)];
    events.push({ round: r, offered: options, picked });
    recipe.push(picked);
  }
  if (!recipe.length) return null;
  // synthesize() logs each woven skill — mute it for bulk runs
  const origLog = console.log;
  let synthesis;
  console.log = () => {};
  try { synthesis = synthesize(recipe, { affinityColors }); } finally { console.log = origLog; }
  if (!synthesis || !synthesis.skill) return null;
  return { skill: synthesis.skill, recipe, events };
}

/** simulateRun weave hook: random-of-offered draft + per-round event logging. */
export function makeWeaveHook(characterId, weaveEvents) {
  return {
    makeSkill({ floor }) {
      const made = makeRandomWovenSkill(characterId);
      if (!made) return null;
      weaveEvents.push(...made.events.map((e) => ({ floor, ...e })));
      return { skill: made.skill, meta: { recipe: made.recipe, name: made.skill.name } };
    },
  };
}

/** ONE fully seeded run → serializable record (shared by the runs.mjs serial
 *  path, pool-worker.mjs 'run' tasks, and the browser bench worker). */
export function runOneRun({ seed, characterId, fightChance = 0.75, weaveFloors = 2 }, playerPolicy = null) {
  const rewards = [];
  const weaveEvents = [];
  const run = withSeededRandom(seed, () => simulateRun({
    characterId,
    fightChance,
    relicPickPolicy: 'random',
    battleOpts: playerPolicy ? { playerPolicy } : {},
    onReward: (ev) => rewards.push(ev),
    weave: { floors: weaveFloors, makeSkill: makeWeaveHook(characterId, weaveEvents).makeSkill },
  }));
  return { seed, characterId, ...run, rewards, weaveEvents };
}
