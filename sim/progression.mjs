/**
 * sim/progression.mjs — simulate one run, measuring player POWER per floor.
 *
 * A mock character starts at base, and at each floor we measure its power
 * (sim/power.mjs), then "clear" the floor: apply the auto-growth (mirrors
 * BattleScene's placeholder — +4 HP/win, +1 Attack every 2nd win) and grant a
 * random relic (sim/relics.mjs). So the per-floor power curve reflects the
 * actual progression a player experiences (growth + accumulating relics).
 */

import { measurePower } from './power.mjs';
import { grantRandomRelic } from './relics.mjs';
import { makeRng } from './model.mjs';

// Auto-growth mirror — keep in sync with BattleScene GROWTH constants.
const HP_PER_WIN = 4;
const ATTACK_AMOUNT = 1;
const ATTACK_EVERY = 2;

/** A representative mock character (attack-1 starter: a workhorse damage skill + an extra-turn skill). */
function baseMock() {
  return {
    name: 'Mock', maxHp: 30, attack: 1, armor: 0, mana: { red: 4 },
    skills: [
      { id: 'strike', name: 'Strike', cost: { red: 5 }, effects: [{ type: 'damage', amount: 8 }] },
      { id: 'bash', name: 'Bash', cost: { red: 6 }, effects: [{ type: 'damage', amount: 5 }, { type: 'extra_turn' }] },
    ],
    passives: [],
  };
}

/**
 * Run one progression. Returns per-floor power rows.
 * @param {number} seed
 * @param {number} [floors=10]
 * @returns {Array<{floor:number, dpt:number, ehp:number, power:number, ehpCapped:boolean, attack:number, maxHp:number, relics:string[]}>}
 */
export function runProgression(seed, floors = 10) {
  const rng = makeRng(seed);
  const def = baseMock();
  const owned = new Set();
  const rows = [];
  for (let f = 1; f <= floors; f++) {
    const m = measurePower(def, (seed * 1000 + f) >>> 0);
    rows.push({
      floor: f, dpt: m.dpt, ehp: m.ehp, power: m.power, ehpCapped: m.ehpCapped,
      attack: def.attack, maxHp: def.maxHp, relics: [...owned],
    });
    // clear floor f (victory): growth + a relic, ready for floor f+1
    def.maxHp += HP_PER_WIN;
    if (f % ATTACK_EVERY === 0) def.attack += ATTACK_AMOUNT;
    grantRandomRelic(def, rng, owned);
  }
  return rows;
}
