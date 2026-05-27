/**
 * playerStats.js — centralized stat resolution for the player stat architecture.
 *
 * Core principle:
 *   characterDefinition.baseStats  (immutable character template)
 *   + playerRunState.statModifiers (persistent run-level progression)
 *   = effectiveStats               (computed, used to seed battle state)
 *
 * Then:
 *   effectiveStats + playerRunState.currentHp = playerBattleState (fresh each battle)
 *
 * This module is the SINGLE source of truth for resolving effective stats.
 * No other file should scatter "base + modifier" math throughout the codebase.
 *
 * Skills and relics are also resolved here — characterDef.skills / .relics
 * are string-id arrays that are expanded into full objects via the catalogs
 * in data/skills and data/relics.
 *
 * Exports:
 *   getEffectivePlayerStats(characterDef, runState) → effectiveStats object
 *   createPlayerBattleState(characterDef, runState) → fresh battle state object
 *   syncBattleResultsToRunState(runState, battleState) → updates runState.currentHp
 *   createDefaultStatModifiers() → zeroed statModifiers template
 *   applyRunModifier(runState, statPath, amount) → mutates runState.statModifiers
 */

import { resolveSkillIds } from './skills/skillCatalog.js';
import { resolveRelicIds } from './relics/relicCatalog.js';

// ── Stat Modifier Templates ────────────────────────────────────────────────

/**
 * Create a default (zeroed) statModifiers object.
 * @returns {object}
 */
export function createDefaultStatModifiers() {
  return {
    maxHp: 0,
    startingMana: {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
      purple: 0,
    },
    startingArmor: 0,
    startingAttack: 0,
    // Future extension points
    additive: {},
    multipliers: {},
    flags: {},
  };
}

// ── Effective Stat Resolution ──────────────────────────────────────────────

/**
 * Compute effective player stats from character base stats + run modifiers.
 *
 * This is the SINGLE centralized function for resolving what a character's
 * actual stats are given their immutable template and run progression.
 * All UI, battle creation, and stat previews should use this.
 *
 * @param {object} characterDef — immutable character definition (from mockCharacter.js)
 * @param {object} runState     — player run state (from runState.js)
 * @returns {object} effective stats ready for use
 */
export function getEffectivePlayerStats(characterDef, runState) {
  const base = characterDef.baseStats;
  const mods = runState.statModifiers;

  if (!base) {
    console.warn('[playerStats] characterDef.baseStats is missing. Using zeroed fallback.');
    return _zeroedEffectiveStats();
  }

  // Resolve starting mana: base + modifier per color
  const baseMana = base.startingMana || {};
  const modMana = (mods && mods.startingMana) ? mods.startingMana : {};
  const resolvedMana = {};
  for (const color of ['red', 'blue', 'green', 'yellow', 'purple']) {
    resolvedMana[color] = (baseMana[color] || 0) + (modMana[color] || 0);
  }

  return {
    maxHp: (base.maxHp || 0) + ((mods && mods.maxHp) ? mods.maxHp : 0),
    startingMana: resolvedMana,
    startingArmor: (base.startingArmor || 0) + ((mods && mods.startingArmor) ? mods.startingArmor : 0),
    startingAttack: (base.startingAttack || 0) + ((mods && mods.startingAttack) ? mods.startingAttack : 0),
  };
}

/**
 * Create a fresh player battle state from character definition + run state.
 * Called at the beginning of each battle encounter.
 *
 * Battle state is TEMPORARY — it is NOT serialized and does NOT persist.
 * Only currentHp is synced back to runState after battle via syncBattleResultsToRunState.
 *
 * @param {object} characterDef — immutable character definition
 * @param {object} runState     — player run state
 * @returns {object} fresh battle state for the player combatant
 */
export function createPlayerBattleState(characterDef, runState) {
  const effective = getEffectivePlayerStats(characterDef, runState);

  // Combine starting relic ids from the character def with any relics
  // acquired during the run (stored on runState.relics as id strings).
  const relicIds = [
    ...(characterDef.relics || []),
    ...(runState && Array.isArray(runState.relics) ? runState.relics : []),
  ];

  return {
    name: characterDef.name,
    className: characterDef.className,
    level: characterDef.level,
    portrait: characterDef.portrait || '',

    // Persistent HP carried over from run state
    hp: runState.currentHp,
    maxHp: effective.maxHp,

    // Reset each battle to resolved starting values
    mana: { ...effective.startingMana },
    armor: effective.startingArmor,
    attack: effective.startingAttack,
    block: 0,

    // Resolved skill objects (cloned from skill catalog)
    skills: resolveSkillIds(characterDef.skills || []),

    // Resolved relic objects (cloned from relic catalog)
    relics: resolveRelicIds(relicIds),

    // Temporary battle-only state
    temporaryEffects: [],
    temporaryBuffs: [],
    temporaryDebuffs: [],
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

/**
 * Sync persistent battle results back to the run state.
 * Currently only currentHp persists between battles.
 *
 * Battle mana, armor, attack, and temporary effects are NOT synced —
 * they reset each battle from effective stats.
 *
 * @param {object} runState    — player run state (mutated in place)
 * @param {object} battleState — player battle state from the concluded battle
 */
export function syncBattleResultsToRunState(runState, battleState) {
  if (!runState || !battleState) return;
  runState.currentHp = battleState.hp;
}

// ── Run Modifier Application ───────────────────────────────────────────────

/**
 * Apply a persistent run modifier to the run state.
 * This is how rewards, relics, upgrades, etc. affect the player's stats.
 *
 * Modifies playerRunState.statModifiers — NOT character base stats.
 *
 * Supported stat paths:
 *   'maxHp'             → statModifiers.maxHp += amount
 *   'startingArmor'     → statModifiers.startingArmor += amount
 *   'startingAttack'    → statModifiers.startingAttack += amount
 *   'startingMana.red'  → statModifiers.startingMana.red += amount
 *   'startingMana.blue' → etc.
 *
 * @param {object} runState — player run state (mutated in place)
 * @param {string} statPath — dotted path to the stat (e.g. 'startingMana.purple')
 * @param {number} amount   — amount to add (positive or negative)
 * @returns {boolean} true if the modifier was applied successfully
 */
export function applyRunModifier(runState, statPath, amount) {
  if (!runState || !runState.statModifiers) {
    console.warn('[playerStats] applyRunModifier: runState or statModifiers is missing.');
    return false;
  }

  const parts = statPath.split('.');
  const mods = runState.statModifiers;

  if (parts.length === 1) {
    // Top-level stat: maxHp, startingArmor, startingAttack
    const key = parts[0];
    if (typeof mods[key] === 'number') {
      mods[key] += amount;
      return true;
    }
    console.warn(`[playerStats] applyRunModifier: unknown stat path "${statPath}".`);
    return false;
  }

  if (parts.length === 2 && parts[0] === 'startingMana') {
    // Mana sub-stat: startingMana.red, etc.
    const color = parts[1];
    if (mods.startingMana && typeof mods.startingMana[color] === 'number') {
      mods.startingMana[color] += amount;
      return true;
    }
    console.warn(`[playerStats] applyRunModifier: unknown mana color "${color}".`);
    return false;
  }

  console.warn(`[playerStats] applyRunModifier: unsupported stat path "${statPath}".`);
  return false;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function _zeroedEffectiveStats() {
  return {
    maxHp: 0,
    startingMana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
    startingArmor: 0,
    startingAttack: 0,
  };
}
