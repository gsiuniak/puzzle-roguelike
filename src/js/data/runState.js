/**
 * runState.js — player run state factory and management.
 *
 * The run state tracks all persistent data that survives between battles:
 *   - selected character ID
 *   - current HP (persists between battles)
 *   - stat modifiers (persistent run-level progression from rewards/relics/upgrades)
 *   - relics, upgrades, rewards (placeholder for future systems)
 *
 * This is the data that gets serialized in save/load systems.
 * Battle-only state (mana, armor, temporary buffs) lives in the battle state
 * created by playerStats.createPlayerBattleState() and is NOT stored here.
 *
 * Exports:
 *   createRunState(characterDef)    → fresh run state from character definition
 *   createDefaultStatModifiers()    → zeroed statModifiers template
 */

import { createDefaultStatModifiers } from './playerStats.js';

export { createDefaultStatModifiers };

/**
 * Create a fresh player run state from a character definition.
 * Called at the beginning of a new run (after character select).
 *
 * currentHp is initialized from the effective maxHp (base + zero modifiers),
 * which equals the character's base maxHp at the start of a run.
 *
 * @param {object} characterDef — immutable character definition (from data/characters/)
 * @returns {object} fresh run state
 */
export function createRunState(characterDef) {
  const base = characterDef.baseStats || {};

  return {
    /** @type {string} which character is selected */
    characterId: characterDef.id,

    /**
     * Persistent HP — carries over between battles.
     * Initialized to base maxHp (since modifiers start at 0).
     */
    currentHp: base.maxHp || 0,

    /**
     * Persistent run-level stat modifiers.
     * These accumulate from rewards, relics, upgrades, etc. and persist
     * throughout the entire run. They are added to baseStats each battle
     * to compute effective stats.
     */
    statModifiers: createDefaultStatModifiers(),

    /**
     * Relics acquired during the run (placeholder).
     * Future: each relic can contribute to statModifiers or provide
     * conditional effects.
     * @type {Array<object>}
     */
    relics: [],

    /**
     * Skills acquired during the run — FULL skill objects (not catalog ids),
     * because woven skills are synthesized at the Skill Weave screen and exist
     * nowhere else. Appended to the character's catalog skills each battle by
     * createPlayerBattleState().
     * @type {Array<object>}
     */
    skills: [],

    /**
     * The EQUIPPED battle loadout as an ordered list of skill ids (catalog
     * ids and/or woven skill ids), capped at MAX_EQUIPPED_SKILLS. `null` =
     * never customized → default loadout (first owned skills). Managed by
     * the in-battle Manage Skills modal; read by getEquippedSkills().
     * @type {string[]|null}
     */
    equippedSkillIds: null,

    /**
     * Upgrades purchased/applied during the run (placeholder).
     * @type {Array<object>}
     */
    upgrades: [],

    /**
     * Reward history (placeholder for reward screen / undo support).
     * @type {Array<object>}
     */
    rewards: [],

    /**
     * Enemy ids already encountered this run, bucketed by act number, so the
     * spawn selector can avoid repeating an enemy within the same act (an
     * enemy ideally appears at most once per act). Shape: { [act]: string[] }.
     * Keyed by act (not run) so future multi-act runs track each act
     * independently without needing an explicit reset at act boundaries.
     * @type {Object<number, string[]>}
     */
    seenEnemiesByAct: {},
  };
}

/**
 * Serialize run state for save/load.
 * Only persists the data needed to reconstruct the run between sessions.
 * Battle-only state is intentionally excluded.
 *
 * @param {object} runState
 * @returns {object} plain serializable object
 */
export function serializeRunState(runState) {
  return {
    characterId: runState.characterId,
    currentHp: runState.currentHp,
    statModifiers: JSON.parse(JSON.stringify(runState.statModifiers)),
    relics: JSON.parse(JSON.stringify(runState.relics)),
    skills: JSON.parse(JSON.stringify(runState.skills || [])),
    equippedSkillIds: runState.equippedSkillIds ? runState.equippedSkillIds.slice() : null,
    upgrades: JSON.parse(JSON.stringify(runState.upgrades)),
    rewards: JSON.parse(JSON.stringify(runState.rewards)),
    seenEnemiesByAct: JSON.parse(JSON.stringify(runState.seenEnemiesByAct || {})),
  };
}

/**
 * Deserialize run state from saved data.
 *
 * @param {object} data — output from serializeRunState
 * @returns {object} restored run state
 */
export function deserializeRunState(data) {
  return {
    characterId: data.characterId,
    currentHp: data.currentHp,
    statModifiers: data.statModifiers || createDefaultStatModifiers(),
    relics: data.relics || [],
    skills: data.skills || [],
    equippedSkillIds: data.equippedSkillIds || null,
    upgrades: data.upgrades || [],
    rewards: data.rewards || [],
    seenEnemiesByAct: data.seenEnemiesByAct || {},
  };
}
