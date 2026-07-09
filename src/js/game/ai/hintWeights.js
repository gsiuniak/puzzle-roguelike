/**
 * game/ai/hintWeights.js — browser-side loader for the champion formula
 * weights (the trained "high-elo" player used by the in-battle hint system).
 *
 * Fetches src/assets/data/formula-champion.json ONCE per session (module-level
 * cached promise) and validates it through `loadFormulaWeights`. Resolves to
 * `{}` on any failure (offline dev server quirk, headless node, missing file)
 * — makeFormulaPolicy then falls back to DEFAULT_FORMULA_WEIGHTS, so hints
 * degrade gracefully instead of breaking.
 *
 * Callers (BattleScene.onEnter) kick the load early and hand the resolved
 * weights to BattleController.getSuggestedAction({ weights }).
 */

import { CHAMPION_WEIGHTS_PATH, loadFormulaWeights } from './formulaPolicy.js';

let _weightsPromise = null;

/** @returns {Promise<object>} validated formula weights (or {} on failure) */
export function loadHintWeights() {
  if (!_weightsPromise) {
    _weightsPromise = (typeof fetch === 'function'
      ? fetch(CHAMPION_WEIGHTS_PATH)
        .then((res) => (res && res.ok ? res.json() : null))
        .then((json) => (json ? loadFormulaWeights(json) : {}))
      : Promise.resolve({})
    ).catch(() => ({}));
  }
  return _weightsPromise;
}
