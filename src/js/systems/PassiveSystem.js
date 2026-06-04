/**
 * PassiveSystem.js — dispatcher for relic-based passive abilities.
 *
 * Battle code (and any future game systems) emits trigger events via
 * `passiveSystem.dispatch(triggerName, payload)`. PassiveSystem looks up
 * the relevant combatant's relics, finds effects whose `trigger` matches,
 * and resolves them through EffectResolver.
 *
 * The system is intentionally simple and data-driven — there is no
 * special-case code per relic. To add a new relic:
 *   1. Define it in `data/relics/relicCatalog.js` with the appropriate
 *      `trigger` + `effectType` on each effect.
 *   2. Reference its id from a character/enemy definition.
 *   No code changes here are required.
 *
 * Triggers are emitted by BattleController; see TriggerTypes.js for the
 * full list and payload conventions.
 *
 * Usage:
 *   const passives = new PassiveSystem({
 *     playerState, enemyState, log, resolver,
 *     onDamage: (info) => { ... }, // optional global damage hook
 *   });
 *   passives.dispatch('onTakeDamage', { side: 'player', amount: 5 });
 */

import { applyEffect } from './EffectResolver.js';

export default class PassiveSystem {
  /**
   * @param {object} ctx
   * @param {object} ctx.playerState — battle state for the player side
   * @param {object} ctx.enemyState  — battle state for the enemy side
   * @param {object} [ctx.log]       — CombatLog instance (for relic effect log lines)
   * @param {object} [ctx.resolver]  — MatchResolver instance (for damage routing)
   * @param {Function} [ctx.onDamage] — fired when an effect deals damage (for shake/SFX)
   * @param {Function} [ctx.onExtraTurn] — fired when an effect grants extra turn
   * @param {Function} [ctx.onBoardEffect] — handler for board-touching effects that
   *     EffectResolver does not recognize (create/destroy tiles etc.).
   *     Signature: (effect, triggerName, payload, ctx) => boolean (true if handled).
   *     Owned by BattleController since these effects drive the cascade machine.
   */
  constructor(ctx) {
    this.playerState   = ctx.playerState;
    this.enemyState    = ctx.enemyState;
    this.log           = ctx.log || null;
    this.resolver      = ctx.resolver || null;
    this.onDamage      = ctx.onDamage || null;
    this.onExtraTurn   = ctx.onExtraTurn || null;
    this.onBoardEffect = ctx.onBoardEffect || null;
    // Fired by EffectResolver's gain_mana so relic-granted mana also triggers
    // onGainMana reactors. Signature: (side, color, amount).
    this.onGainMana    = ctx.onGainMana || null;
    // Fired by EffectResolver's heal/armor effects so the host can animate
    // floating "+x" text. Signature: ({ kind:'heal'|'armor', target, amount }).
    this.onStatChange  = ctx.onStatChange || null;
  }

  /**
   * Emit a passive trigger event. Resolves every matching relic effect
   * on the combatant indicated by `payload.side`.
   *
   * @param {string} triggerName — TRIGGER_TYPES value (e.g. 'onTakeDamage')
   * @param {object} payload — { side: 'player'|'enemy', ...event-specific data }
   */
  dispatch(triggerName, payload) {
    if (!triggerName || !payload || !payload.side) return;

    const owner = this._getSideState(payload.side);
    if (!owner) return;

    const relics = owner.relics || [];
    if (relics.length === 0) return;

    const opponent = this._getSideState(payload.side === 'player' ? 'enemy' : 'player');
    const ctx = {
      caster: owner,
      target: opponent,
      log: this.log,
      resolver: this.resolver,
      onDamage: this.onDamage,
      onExtraTurn: this.onExtraTurn,
      onGainMana: this.onGainMana,
      onStatChange: this.onStatChange,
      // Pass the trigger payload through so mutating effects (e.g.
      // reduce_damage on onIncomingDamage) can modify it in place.
      payload,
      triggerName,
    };

    for (const relic of relics) {
      const effects = relic.effects || [];
      for (const effect of effects) {
        if (effect.trigger !== triggerName) continue;
        // Optional payload gate — lets a relic react only to specific match
        // types / sizes (e.g. Scythe: only skull matches of 3+).
        if (effect.condition && !this._passesCondition(effect.condition, payload)) continue;
        let handled = applyEffect(effect, ctx);
        // Board-touching effects (destroy/create tiles, radius blasts, ...)
        // are routed to the host (BattleController) via onBoardEffect so the
        // cascade phase machine stays the single source of truth for board
        // mutations during a step.
        if (!handled && this.onBoardEffect) {
          handled = !!this.onBoardEffect(effect, triggerName, payload, ctx);
        }
        if (!handled) {
          console.warn(
            `[PassiveSystem] Relic "${relic.id}" used effectType "${effect.effectType}" ` +
            `which is not supported by EffectResolver or onBoardEffect. Skipping.`
          );
        }
      }
    }
  }

  _getSideState(side) {
    if (side === 'player') return this.playerState;
    if (side === 'enemy')  return this.enemyState;
    return null;
  }

  /**
   * Check an effect's optional `condition` against the trigger payload.
   * Supported fields (all optional, ANDed together):
   *   typeId   — payload.typeId must equal this (e.g. 'skull')
   *   minCount — payload.count must be >= this (e.g. 3)
   *   color    — payload.color must equal this (e.g. 'red' for onGainMana)
   * @param {object} condition
   * @param {object} payload
   * @returns {boolean}
   */
  _passesCondition(condition, payload) {
    if (!condition) return true;
    if (condition.typeId != null && payload.typeId !== condition.typeId) return false;
    if (condition.color != null && payload.color !== condition.color) return false;
    if (condition.minCount != null &&
        !(typeof payload.count === 'number' && payload.count >= condition.minCount)) {
      return false;
    }
    return true;
  }
}
