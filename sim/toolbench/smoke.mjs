/**
 * toolbench/smoke.mjs — quick sanity check of the headless engine.
 * Run: node sim/toolbench/smoke.mjs
 * (This is a NEW toolbench file, not one of the legacy sim/ scripts.)
 */
import {
  makePlayerCombatant, makeEnemyCombatant, Battle, runBatch, simulateRun,
  ALL_ENEMIES,
} from './engine.mjs';

function line(s) { process.stdout.write(s + '\n'); }

// 1) one verbose battle
{
  const p = makePlayerCombatant({ characterId: 'warrior', victories: 2 });
  const e = makeEnemyCombatant('goblin', 3);
  const r = new Battle(p, e).run();
  line(`single battle: winner=${r.winner} turns=${r.turns} hpFrac=${r.playerHpFrac.toFixed(2)}`);
  if (!['player', 'enemy', 'draw'].includes(r.winner)) throw new Error('bad winner');
}

// 2) batch: reference warrior vs each act-1 enemy at its lowest legal floor
{
  for (const def of ALL_ENEMIES) {
    if (!def.floors || !def.floors.length) continue;
    const floor = def.floors[0];
    const victories = Math.round((floor - 1) * 0.7);
    const agg = runBatch(
      () => makePlayerCombatant({ characterId: 'warrior', victories }),
      () => makeEnemyCombatant(def, floor),
      30
    );
    line(`${def.name.padEnd(20)} f${String(floor).padEnd(2)} win=${(agg.winRate * 100).toFixed(0).padStart(3)}% turns=${agg.turns.mean.toFixed(1).padStart(5)} burst=${(agg.burstShare * 100).toFixed(0)}%`);
    if (!(agg.turns.mean > 0)) throw new Error(`degenerate battle vs ${def.id}`);
  }
}

// 3) full runs
{
  let survived = 0; const N = 10;
  for (let i = 0; i < N; i++) { if (simulateRun({ characterId: 'warrior' }).survived) survived++; }
  line(`runs: ${survived}/${N} survived`);
}

line('SMOKE OK');
