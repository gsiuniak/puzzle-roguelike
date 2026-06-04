/**
 * sim/power.mjs — measure a build's combat POWER and turn it into enemy budgets.
 *
 * Power model (Lanchester): a combatant's strength ≈ EHP × DPT — how much damage
 * it can take times how much it deals per turn. We measure each independently
 * with calibration fights, then derive enemy stat budgets per floor from the
 * player's measured power.
 *
 *   DPT  — vs an inert punching-bag (huge HP, never attacks): damage dealt / turn.
 *   EHP  — vs a "metronome" dealing a fixed D damage/round: total damage the player
 *          withstands before dying (captures armor / heal / reduce-damage relics,
 *          which extend survival and thus raise the total raw damage absorbed).
 */

import { runBattle } from './engine.mjs';

export const POWER_CFG = {
  DPT_WINDOW: 20,        // turns to average offense over
  // Fixed damage/round for the defense test. Higher = per-turn sustain relics
  // (heal/armor/reduce) are a smaller fraction, so EHP isn't over-inflated by
  // sustain stacks. 8 ≈ a representative enemy hit; no-sustain builds still read
  // EHP ≈ maxHP. (Was 5, which over-valued sustain.)
  EHP_METRONOME_DMG: 8,
  EHP_MAX_ROUNDS: 100,   // cap (a build that out-sustains 8/round reports EHP ≥ 800)
};

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Measure {dpt, ehp, power} for a player definition.
 * @param {object} playerDef
 * @param {number} seed
 * @returns {{dpt:number, ehp:number, power:number, ehpCapped:boolean}}
 */
export function measurePower(playerDef, seed) {
  // ── DPT: vs an inert huge-HP bag ──
  const bag = { name: 'Bag', maxHp: 1e7, attack: 0 };
  const off = runBattle(playerDef, bag, seed, { inertEnemy: true, maxRounds: POWER_CFG.DPT_WINDOW });
  const dpt = off.playerDPT;

  // ── EHP: vs a fixed-damage metronome ──
  const D = POWER_CFG.EHP_METRONOME_DMG;
  const metronome = { name: 'Metronome', maxHp: 1e7, attack: 0 };
  const def = runBattle(playerDef, metronome, seed + 7, { enemyFixedDamage: D, maxRounds: POWER_CFG.EHP_MAX_ROUNDS });
  const ehp = def.playerDmgTaken;           // total raw damage withstood before death
  const ehpCapped = def.winner !== 'enemy'; // survived the whole window → lower bound

  return { dpt: round1(dpt), ehp, power: Math.round(dpt * ehp), ehpCapped };
}

// ── Enemy budget derivation ──────────────────────────────────────────────────

/** Target fight shape per role: length (turns) and how much player EHP it should cost. */
export const ROLE_TARGETS = {
  normal: { turns: 8,  lossFrac: 0.35 },
  elite:  { turns: 14, lossFrac: 0.55 },
  boss:   { turns: 24, lossFrac: 0.80 },
};

/**
 * Given the player's measured DPT/EHP at a floor, produce enemy stat budgets.
 *
 * enemyEHP (HP, scaled by target length so the fight lasts ~turns):
 *   enemyEHP ≈ playerDPT × turns
 * enemyDPT (how hard it hits, scaled so the player loses ~lossFrac of EHP):
 *   enemyDPT ≈ lossFrac × playerEHP / turns
 *
 * @param {{dpt:number, ehp:number}} player — measured player power at this floor
 * @returns {Object<string, {hp:number, dpt:number, power:number, attackApprox:number}>}
 */
export function enemyBudgets(player) {
  const out = {};
  for (const [role, t] of Object.entries(ROLE_TARGETS)) {
    const hp = Math.round(player.dpt * t.turns);
    const dpt = round1((t.lossFrac * player.ehp) / t.turns);
    // Approx enemy Attack if its damage is mostly direct (e.g. a "check" enemy that
    // deals damage = attack/turn, like Chokeweed via Briarthorn). For a board-based
    // enemy, most of its DPT comes from skull matches + a skill; treat as a guide.
    const attackApprox = Math.max(1, Math.round(dpt));
    out[role] = { hp, dpt, power: Math.round(hp * dpt), attackApprox };
  }
  return out;
}

/**
 * Design a Chokeweed-style "scaling DPS/sustain check": an enemy with moderate HP
 * and a RAMPING attack (no board interaction). It's a race — the player must deal
 * the enemy's EHP (kill it) before the enemy's escalating damage drains the
 * player's EHP. Sized so a player AT this floor's power passes with a small margin.
 *
 *   enemyEHP  = playerDPT × killTurns   (killable in ~killTurns if at-power)
 *   ramp      = +1 attack/turn (the escalation)
 *   startAtk  chosen so cumulative damage over (killTurns + margin) ≈ playerEHP
 *             → the player who kills it in time survives; a slower player dies.
 *
 * Cumulative damage of a ramp over T turns = startAtk·T + ramp·T·(T-1)/2.
 * @param {{dpt:number, ehp:number}} player
 * @param {{killTurns?:number, margin?:number, ramp?:number}} [opts]
 */
export function chokeweedCheck(player, { killTurns = 8, margin = 3, ramp = 1 } = {}) {
  const dieTurns = killTurns + margin;
  const hp = Math.round(player.dpt * killTurns);
  // solve startAtk from: startAtk·dieTurns + ramp·dieTurns·(dieTurns-1)/2 = playerEHP
  const rampTotal = ramp * dieTurns * (dieTurns - 1) / 2;
  const startAtk = Math.max(1, Math.round((player.ehp - rampTotal) / dieTurns));
  return { hp, startAttack: startAtk, ramp, killTurns, dieTurns };
}
