/**
 * toolbench/weights-node.mjs — NODE-ONLY weights loading.
 *
 * Split out of formula.mjs (2026-07-08, Balance Bench v2 Phase 0) so formula.mjs
 * carries no `node:` imports and can be loaded by the browser bench. Everything
 * filesystem-flavored about weights lives here; the pure parsing/validation
 * (`loadFormulaWeights`) stays in formula.mjs.
 */

import { readFileSync } from 'node:fs';
import { CHAMPION_WEIGHTS_PATH, loadFormulaWeights } from './formula.mjs';

/** The tracked WORKING champion weights → validated formula-weight object. */
export function loadChampionWeights() {
  return loadFormulaWeights(JSON.parse(readFileSync(CHAMPION_WEIGHTS_PATH, 'utf8')));
}

/** Load + validate any formula-weights JSON file. */
export function loadFormulaWeightsFile(filePath) {
  return loadFormulaWeights(JSON.parse(readFileSync(filePath, 'utf8')));
}
