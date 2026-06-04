/**
 * sim/enemy-gen.mjs — "give me a floor → an enemy stat block."
 *
 * Reads sim/out/power.json (produced by run-power.mjs) and turns a floor's
 * player-power budget into a concrete enemy stat block. Pick a ROLE (how much of
 * the player's power the fight should represent) and an ARCHETYPE (how that power
 * is split between durability and damage).
 *
 * Usage:
 *   node sim/enemy-gen.mjs 5                 # floor 5, normal, balanced
 *   node sim/enemy-gen.mjs 7 elite tank
 *   node sim/enemy-gen.mjs 9 boss
 *   node sim/enemy-gen.mjs 5 normal check    # Chokeweed-style scaling DPS check
 *   node sim/enemy-gen.mjs 5 --json          # machine-readable
 *
 * ROLE      = normal | elite | boss          (default normal)
 * ARCHETYPE = balanced | tank | glass | check (default balanced)
 *
 * Power is preserved across archetypes (hpMult × dptMult = 1): a "tank" is the
 * same total threat as a "glass", just front-loaded into HP vs damage.
 */

import { readFileSync } from 'node:fs';

const POWER_PATH = 'sim/out/power.json';

// Archetype = how to split a role's power between EHP and DPT (power-preserving).
const ARCHETYPES = {
  balanced: { hpMult: 1.0,  dptMult: 1.0 },
  tank:     { hpMult: 1.5,  dptMult: 0.67 }, // beefy, hits soft (armor/HP wall)
  glass:    { hpMult: 0.6,  dptMult: 1.67 }, // fragile, hits hard (race/burst)
};

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Build an enemy stat block for a floor.
 * @param {object} data — parsed power.json
 * @param {number} floor
 * @param {'normal'|'elite'|'boss'} role
 * @param {'balanced'|'tank'|'glass'|'check'} archetype
 */
export function makeEnemy(data, floor, role = 'normal', archetype = 'balanced') {
  const fl = data.floors.find((x) => x.floor === floor);
  if (!fl) throw new Error(`No data for floor ${floor} (have 1..${data.floors.length}).`);

  if (archetype === 'check') {
    // Chokeweed-style: moderate HP + ramping attack, no board interaction. A race —
    // kill it before its escalating attack drains you. (Tuned to ~normal pacing.)
    const c = fl.chokeweed;
    return {
      floor, role: 'check', archetype,
      hp: c.hp,
      attack: c.startAttack,
      attackRampPerTurn: c.ramp,
      note: `Deals damage = its (growing) attack each turn (e.g. Briarthorn + Encroach). ` +
            `Kill within ~${c.killTurns} turns or it kills you by ~turn ${c.dieTurns}.`,
    };
  }

  const b = fl.budgets[role];
  if (!b) throw new Error(`Unknown role "${role}". Use normal | elite | boss.`);
  const a = ARCHETYPES[archetype];
  if (!a) throw new Error(`Unknown archetype "${archetype}". Use balanced | tank | glass | check.`);

  const hp = Math.round(b.hp * a.hpMult);
  const dpt = round1(b.dpt * a.dptMult);
  // DPT → attack stat. For a DIRECT-damage enemy (attack hits straight), attack ≈ DPT.
  // For a BOARD enemy that also matches skulls + casts a skill, deliver the rest of
  // the DPT via a skill and keep the attack stat lower (skulls amplify attack).
  const attackDirect = Math.max(1, Math.round(dpt));
  const attackBoard = Math.max(1, Math.round(dpt * 0.5));
  const skillDamageBoard = Math.max(0, Math.round(dpt * 1.5)); // a per-~2-turn skill covering the rest

  return {
    floor, role, archetype,
    hp,
    targetDpt: dpt,
    suggestedAttack: { direct: attackDirect, board: attackBoard },
    suggestedBoardSkillDamage: skillDamageBoard,
    power: Math.round(hp * dpt),
    note: `HP solid. Deliver ~${dpt} dmg/turn: a direct-damage enemy → attack ${attackDirect}; ` +
          `a board enemy → attack ${attackBoard} (skull matches) + a ~${skillDamageBoard}-dmg skill every couple turns.`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a) => a !== '--json');
const asJson = process.argv.includes('--json');
const floor = parseInt(args[0], 10);
const role = args[1] || 'normal';
const archetype = args[2] || 'balanced';

if (!Number.isFinite(floor)) {
  console.log('Usage: node sim/enemy-gen.mjs <floor> [normal|elite|boss] [balanced|tank|glass|check] [--json]');
  process.exit(0);
}

let data;
try {
  data = JSON.parse(readFileSync(POWER_PATH, 'utf8'));
} catch {
  console.error(`Could not read ${POWER_PATH}. Run: node sim/run-power.mjs`);
  process.exit(1);
}

const enemy = makeEnemy(data, floor, role, archetype);
if (asJson) {
  console.log(JSON.stringify(enemy, null, 2));
} else {
  console.log(`\nEnemy for floor ${enemy.floor} — ${enemy.role} / ${enemy.archetype}`);
  console.log('─'.repeat(52));
  for (const [k, v] of Object.entries(enemy)) {
    if (['floor', 'role', 'archetype'].includes(k)) continue;
    console.log(`  ${k.padEnd(22)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  const p = data.floors.find((x) => x.floor === floor).player;
  console.log(`\n  (floor ${floor} player: DPT ${p.dpt}, EHP ${p.ehp})`);
}
