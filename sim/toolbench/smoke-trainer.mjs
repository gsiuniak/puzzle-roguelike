/**
 * toolbench/smoke-trainer.mjs — sanity checks for the trainer layer:
 * seeded-RNG determinism (rng.mjs), the Battle policy seam, and a mini
 * paired-uplift measurement. Run: node sim/toolbench/smoke-trainer.mjs
 */
import { Battle, makePlayerCombatant, makeEnemyCombatant } from './engine.mjs';
import { withSeededRandom, hashSeed, mulberry32 } from './rng.mjs';
import { makeValuePolicy, loadWeights, DEFAULT_VALUE_WEIGHTS, WEIGHT_KEYS } from './policy.mjs';

const line = (s) => process.stdout.write(s + '\n');
const assert = (cond, msg) => { if (!cond) throw new Error(`SMOKE FAIL: ${msg}`); };

// 1) seeded determinism: same seed → bit-identical battle result; restore works
{
  const original = Math.random;
  const mk = () => new Battle(
    makePlayerCombatant({ characterId: 'mage', victories: 2 }),
    makeEnemyCombatant('goblin', 3),
  ).run();
  const a = withSeededRandom(12345, mk);
  const b = withSeededRandom(12345, mk);
  assert(JSON.stringify(a) === JSON.stringify(b), 'same seed must reproduce the same battle');
  assert(Math.random === original, 'Math.random must be restored after withSeededRandom');
  const prng = mulberry32(hashSeed('x', 1));
  const v = prng();
  assert(v >= 0 && v < 1, 'mulberry32 must yield [0,1)');
  line(`determinism: OK (winner=${a.winner} turns=${a.turns})`);
}

// 2) policy seam: a pass-only player must lose
{
  const r = withSeededRandom(7, () => new Battle(
    makePlayerCombatant({ characterId: 'warrior' }),
    makeEnemyCombatant('goblin', 1),
    { playerPolicy: () => ({ type: 'pass' }) },
  ).run());
  assert(r.winner === 'enemy', `pass-only player should lose (got ${r.winner})`);
  line('policy pass: OK');
}

// 3) policy fallback: a null-returning policy must equal the greedy default
{
  const mk = (opts) => new Battle(
    makePlayerCombatant({ characterId: 'warrior', victories: 1 }),
    makeEnemyCombatant('thrall', 2),
    opts,
  ).run();
  const g = withSeededRandom(777, () => mk({}));
  const p = withSeededRandom(777, () => mk({ playerPolicy: () => null }));
  assert(JSON.stringify(g) === JSON.stringify(p), 'null policy must match greedy exactly');
  line('policy fallback: OK');
}

// 4) policy actions: explicit swap/cast route works end-to-end
{
  const policy = (battle, c) => {
    const skill = battle.greedySkill(c);
    if (skill) return { type: 'cast', skill };
    const sw = battle.greedySwap(c);
    return sw ? { type: 'swap', swap: sw } : { type: 'pass' };
  };
  const r = withSeededRandom(42, () => new Battle(
    makePlayerCombatant({ characterId: 'witch_doctor', victories: 2 }),
    makeEnemyCombatant('goblin', 3),
    { playerPolicy: policy },
  ).run());
  assert(['player', 'enemy', 'draw'].includes(r.winner), 'policy-driven battle must complete');
  line(`policy actions: OK (winner=${r.winner})`);
}

// 5) mini paired uplift: arcane_inscription added to the mage kit
{
  const N = 60, frame = { floor: 3, enemy: 'thrall', victories: 1 };
  let dSum = 0, wB = 0, wV = 0, casts = 0;
  for (let i = 0; i < N; i++) {
    const seed = hashSeed('smoke-uplift', i);
    const rB = withSeededRandom(seed, () => new Battle(
      makePlayerCombatant({ characterId: 'mage', victories: frame.victories, skillIds: ['fracture'] }),
      makeEnemyCombatant(frame.enemy, frame.floor),
    ).run());
    const rV = withSeededRandom(seed, () => new Battle(
      makePlayerCombatant({ characterId: 'mage', victories: frame.victories, skillIds: ['fracture', 'arcane_inscription'] }),
      makeEnemyCombatant(frame.enemy, frame.floor),
    ).run());
    dSum += (rV.playerWon ? 1 : 0) - (rB.playerWon ? 1 : 0);
    wB += rB.playerWon ? 1 : 0; wV += rV.playerWon ? 1 : 0;
    casts += rV.playerCasts;
  }
  assert(Number.isFinite(dSum), 'uplift must be finite');
  line(`mini uplift (arcane_inscription on mage): base=${((wB / N) * 100).toFixed(0)}% var=${((wV / N) * 100).toFixed(0)}% ΔWin=${((dSum / N) * 100).toFixed(1)}pp casts/fight=${(casts / N).toFixed(1)}`);
}

// 6) value policy: battles complete on all hosts; weights round-trip
{
  assert(WEIGHT_KEYS.length > 10, 'weight vector should be non-trivial');
  const loaded = loadWeights({ weights: { extraTurn: 9.5, bogus: 3 } });
  assert(loaded.extraTurn === 9.5 && !('bogus' in loaded), 'loadWeights must filter to known keys');
  const policy = makeValuePolicy({});
  for (const host of ['warrior', 'mage', 'witch_doctor']) {
    const r = withSeededRandom(hashSeed('vp', host), () => new Battle(
      makePlayerCombatant({ characterId: host, victories: 2 }),
      makeEnemyCombatant('goblin', 3),
      { playerPolicy: policy, enemyPolicy: policy },  // both sides — side-agnostic
    ).run());
    assert(['player', 'enemy', 'draw'].includes(r.winner), `value-policy battle must complete (${host})`);
  }
  line('value policy: OK');
}

// 7) value policy vs greedy: paired comparison on a mid frame (informational)
{
  const N = 60;
  const policy = makeValuePolicy({});
  let wG = 0, wV = 0;
  for (let i = 0; i < N; i++) {
    const seed = hashSeed('vp-vs-greedy', i);
    const mk = (opts) => new Battle(
      makePlayerCombatant({ characterId: 'warrior', victories: 3 }),
      makeEnemyCombatant('cyclops', 5),
      opts,
    ).run();
    if (withSeededRandom(seed, () => mk({})).playerWon) wG++;
    if (withSeededRandom(seed, () => mk({ playerPolicy: policy })).playerWon) wV++;
  }
  line(`value vs greedy (warrior f5 cyclops): greedy=${((wG / N) * 100).toFixed(0)}% value=${((wV / N) * 100).toFixed(0)}%`);
}

line('SMOKE-TRAINER OK');
