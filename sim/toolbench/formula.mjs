/**
 * toolbench/formula.mjs — RE-EXPORT SHIM (2026-07-08).
 *
 * The deterministic formula policy was PROMOTED to the game source —
 * src/js/game/ai/formulaPolicy.js — so the live game's hint system
 * (BattleController.getSuggestedAction) can play the trained champion.
 * Same module, same exports, one source of truth (the enemyScaling.js
 * pattern: shared code lives in src, sim imports it). Everything in the
 * toolbench keeps importing './formula.mjs' unchanged.
 *
 * The tracked champion weights moved with it: src/assets/data/
 * formula-champion.json (a GAME asset, shipped by the Vite build).
 * CHAMPION_WEIGHTS_PATH — re-exported here — points there; node loading
 * still goes through weights-node.mjs `loadChampionWeights()`, browser
 * loading through fetch (bench ui/store.mjs, game ai/hintWeights.js).
 */

export * from '../../src/js/game/ai/formulaPolicy.js';
