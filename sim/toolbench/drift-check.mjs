/**
 * toolbench/drift-check.mjs — MIRROR DRIFT GUARD. Run before any training /
 * measurement session: parses the LIVE src files for the constants that
 * engine.mjs (and analytic.mjs) mirror, and fails LOUDLY on any mismatch.
 *
 *   node sim/toolbench/drift-check.mjs      → per-constant PASS/FAIL, exit 1 on drift
 *
 * This guards the CONSTANT class of drift only. Semantic drift (a behavior
 * change in BattleController's turn/effect logic) is not detectable here —
 * the stronger fixes, in order: (1) extract these constants into a pure shared
 * module both sides import (kills this whole class); (2) a seeded golden-battle
 * parity harness driving the REAL BattleController headlessly vs engine.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENEMY_HP_FLOOR_MULT, ENEMY_ARMOR_FLOOR_MULT, ENEMY_ATTACK_FLOOR_BONUS,
  MAGIC_MANA_PER_POINT, STATUS_DAMAGE_MODS, POISON_DECAY_DIVISOR, DEFAULT_GROWTH_PLAN,
  FUNGAL_SPREAD_PER_TILE,
} from './engine.mjs';
import { DEBUFF_POWER_MULT } from '../../src/js/data/skillSynthesizer.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Strip line comments (`// …` to EOL) so a COMMENTED-OUT alternate value (e.g. a
// prior curve kept for reference) can't be mistaken for the live definition —
// the regex parsers below match the first `NAME = …` and would otherwise grab
// it. These sources have no `//` inside the constant literals we parse, so this
// is safe. (Block comments don't contain `NAME = [...]` patterns here.)
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\/[^\n]*/g, '');
let failures = 0;

function check(name, mirrored, parsed) {
  const ok = JSON.stringify(mirrored) === JSON.stringify(parsed);
  console.log(`${ok ? '  ok ' : 'DRIFT'} ${name}${ok ? '' : `\n      src:    ${JSON.stringify(parsed)}\n      mirror: ${JSON.stringify(mirrored)}`}`);
  if (!ok) failures++;
}

/** Parse `NAME = [nums...]` from source text. */
function parseArray(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  return m ? m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : null;
}
/** Parse `NAME = <number>` from source text. */
function parseNumber(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
  return m ? Number(m[1]) : null;
}
/** Parse a flat `{ key: num, ... }` object literal following NAME. */
function parseObject(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(?:Object\\.freeze\\()?\\{([^}]+)\\}`));
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(',')) {
    const kv = part.match(/([A-Za-z_]\w*)\s*:\s*([0-9.]+)/);
    if (kv) out[kv[1]] = Number(kv[2]);
  }
  return out;
}

// ENEMY_HP_FLOOR_MULT / ENEMY_ATTACK_FLOOR_BONUS are now a SHARED module that BOTH
// engine.mjs and MapScene.js import (src/js/data/enemyScaling.js) — structurally
// undriftable. Checked here only to catch someone re-hardcoding engine's re-export.
const enemyScaling = read('src/js/data/enemyScaling.js');
check('ENEMY_HP_FLOOR_MULT (enemyScaling)', ENEMY_HP_FLOOR_MULT, parseArray(enemyScaling, 'ENEMY_HP_FLOOR_MULT'));
check('ENEMY_ARMOR_FLOOR_MULT (enemyScaling)', ENEMY_ARMOR_FLOOR_MULT, parseArray(enemyScaling, 'ENEMY_ARMOR_FLOOR_MULT'));
check('ENEMY_ATTACK_FLOOR_BONUS (enemyScaling)', ENEMY_ATTACK_FLOOR_BONUS, parseArray(enemyScaling, 'ENEMY_ATTACK_FLOOR_BONUS'));

const bc = read('src/js/game/BattleController.js');
check('MAGIC_MANA_PER_POINT (BattleController)', MAGIC_MANA_PER_POINT, parseNumber(bc, 'MAGIC_MANA_PER_POINT'));
check('POISON_DECAY_DIVISOR (BattleController)', POISON_DECAY_DIVISOR, parseNumber(bc, 'POISON_DECAY_DIVISOR'));
check('STATUS_DAMAGE_MODS (BattleController)', STATUS_DAMAGE_MODS, parseObject(bc, 'STATUS_DAMAGE_MODS'));
check('FUNGAL_SPREAD_PER_TILE (BattleController)', FUNGAL_SPREAD_PER_TILE, parseNumber(bc, 'FUNGAL_SPREAD_PER_TILE'));

const bs = read('src/js/ui/BattleScene.js');
check('DEFAULT_GROWTH_PLAN (BattleScene)', DEFAULT_GROWTH_PLAN, parseObject(bs, 'DEFAULT_GROWTH_PLAN'));

// analytic.mjs's inline mirror of the synthesizer's per-status pricing
const analytic = read('sim/toolbench/analytic.mjs');
const inline = parseObject(analytic, 'const mult');
if (inline) {
  const subset = {};
  for (const k of Object.keys(inline)) subset[k] = DEBUFF_POWER_MULT[k];
  check('DEBUFF_POWER_MULT (analytic inline mirror)', inline, subset);
} else {
  console.log('DRIFT DEBUFF_POWER_MULT — analytic inline map not found (pattern changed?)');
  failures++;
}

// analytic SYNTH_POWER mirrors the synthesizer's non-exported POWER table —
// compare the overlapping keys by parsing both object literals from source
const synthSrc = read('src/js/data/skillSynthesizer.js');
const powerSrc = parseObject(synthSrc, 'const POWER');
const synthMirror = parseObject(analytic, 'const SYNTH_POWER');
if (powerSrc && synthMirror) {
  const KEY_MAP = { perDamage: 'perDamage', perArmor: 'perArmor', perHeal: 'perHeal', perAttack: 'perAttack', perMagic: 'perMagic', perTileCreated: 'perTileCreated', extraTurn: 'extraTurn', perPoisonStack: 'perPoisonStack', perManaGained: 'perManaGained' };
  const src = {}, mir = {};
  for (const [pk, ak] of Object.entries(KEY_MAP)) {
    if (powerSrc[pk] != null && synthMirror[ak] != null) { src[pk] = powerSrc[pk]; mir[pk] = synthMirror[ak]; }
  }
  check('SYNTH_POWER (analytic ↔ synthesizer POWER, shared keys)', mir, src);
} else {
  console.log('DRIFT SYNTH_POWER — could not parse one side (pattern changed?)');
  failures++;
}

console.log(failures ? `\nDRIFT DETECTED (${failures}) — fix mirrors before trusting any measurement` : '\nNO DRIFT — mirrors match live src');
process.exitCode = failures ? 1 : 0;
