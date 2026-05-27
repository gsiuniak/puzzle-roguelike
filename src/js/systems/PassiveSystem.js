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
   */
  constructor(ctx) {
    this.playerState = ctx.playerState;
    this.enemyState  = ctx.enemyState;
    this.log         = ctx.log || null;
    this.resolver    = ctx.resolver || null;
    this.onDamage    = ctx.onDamage || null;
    this.onExtraTurn = ctx.onExtraTurn || null;
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
    };

    for (const relic of relics) {
      const effects = relic.effects || [];
      for (const effect of effects) {
        if (effect.trigger !== triggerName) continue;
        const handled = applyEffect(effect, ctx);
        if (!handled) {
          console.warn(
            `[PassiveSystem] Relic "${relic.id}" used effectType "${effect.effectType}" ` +
            `which is not supported by EffectResolver. Skipping.`
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
}
