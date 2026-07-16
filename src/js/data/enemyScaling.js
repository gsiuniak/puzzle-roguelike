/**
 * enemyScaling.js — SHARED per-floor enemy scaling curves (single source of truth).
 *
 * These two arrays used to live as NON-EXPORTED constants in MapScene.js and were
 * hand-MIRRORED in sim/toolbench/engine.mjs. That mirror drifted (the game shipped
 * a steeper HP curve while the balance sim still measured the old one). To make
 * "retune once, reflected everywhere" structural — not a discipline problem — the
 * constants now live HERE, dependency-free (no canvas/DOM/browser imports), and are
 * imported by BOTH:
 *   - src/js/scenes/MapScene.js   (the live game — applies them at enemy spawn)
 *   - sim/toolbench/engine.mjs    (the headless balance sim — feeds trainer/runs/
 *                                  learn/analytic + the drift guard)
 * so testing / training / measurement automatically use the game's real curve.
 * Change a number in THIS file and both sides update — nothing to sync.
 *
 * Index = node.depth (0-indexed; depth 0 = floor 1). engine.mjs also exposes
 * 1-indexed floor helpers over the same arrays.
 */

// ── Per-floor enemy HP scaling ───────────────────────────
// Enemy `maxHp` in the data files is a FLOOR-1-EQUIVALENT baseline. At spawn it is
// multiplied by this per-depth factor so a given enemy stays appropriately tough
// as the player's power grows over the act. The curve tracks the measured player-DPT
// ratio from the sim (enemy HP is budgeted as playerDPT × targetTurns, so HP follows
// DPT). Back-loaded/aggressive: gentle early floors (onboarding) ramping hard late.
// Previous curves, for reference:
//   [1.15, 1.35, 1.7, 1.9, 2.35, 2.65, 3.2, 3.55, 4.25, 4.75]  (front-loaded, older)
// export const ENEMY_HP_FLOOR_MULT = [1.15, 1.45, 1.8, 2.15, 2.7, 3.2, 4.0, 4.7, 5.8, 6.8];
export const ENEMY_HP_FLOOR_MULT = [1.15, 1.45, 1.9, 2.00, 2.7, 3.1, 3.8, 4.6, 5.7, 6.7];


// ── Per-floor enemy ATTACK scaling ───────────────────────
// Attack is the lethality knob (it drives BOTH skill damage and skull-match damage,
// and scales enemy skills via their `scaling` field). It's sharp, so it ramps as a
// small ADDITIVE step bonus on top of the enemy's authored base attack — preserving
// per-enemy identity (a base-3 brute always stays +1 over a base-2 minion).
// STEEPENED 2026-06-23 (≈ +1 every 2 floors): player growth is deterministic and
// always includes Max HP (decision #36), so enemy DAMAGE must scale to stay a threat
// against a steadily growing HP pool. See docs/balance-combat-math.md §4.2 / §7.1.
// export const ENEMY_ATTACK_FLOOR_BONUS = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
export const ENEMY_ATTACK_FLOOR_BONUS = [0, 1, 1, 2, 2, 3, 4, 5, 5, 6];

/** Per-floor HP multiplier for a 0-indexed map depth (clamps past the last floor). */
export function enemyHpFloorMult(depth) {
  const d = Math.max(0, depth | 0);
  return ENEMY_HP_FLOOR_MULT[Math.min(d, ENEMY_HP_FLOOR_MULT.length - 1)];
}

// ── Per-floor enemy ARMOR scaling ────────────────────────
// Authored enemy `armor` is a floor-1-equivalent baseline, exactly like HP:
// armor is a survivability budget. It has its OWN curve (split from the HP
// array 2026-07-16 for independent tuning) — seeded from the HP curve at the
// time of the split, so retune the two separately from here on.
export const ENEMY_ARMOR_FLOOR_MULT = [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8];

/** Per-floor ARMOR multiplier for a 0-indexed map depth (clamps past the last floor). */
export function enemyArmorFloorMult(depth) {
  const d = Math.max(0, depth | 0);
  return ENEMY_ARMOR_FLOOR_MULT[Math.min(d, ENEMY_ARMOR_FLOOR_MULT.length - 1)];
}

/** Per-floor additive attack bonus for a 0-indexed map depth (clamps). */
export function enemyAttackFloorBonus(depth) {
  const d = Math.max(0, depth | 0);
  return ENEMY_ATTACK_FLOOR_BONUS[Math.min(d, ENEMY_ATTACK_FLOOR_BONUS.length - 1)];
}