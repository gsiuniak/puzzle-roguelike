/**
 * EffectResolver.js — shared resolver for atomic effects.
 *
 * Both skill effects and relic-passive effects share a common "effect"
 * vocabulary. The simple, non-board-touching effects (damage, armor, heal,
 * gain_mana, extra_turn) are resolved here so BattleController and
 * PassiveSystem do not duplicate state-mutation logic.
 *
 * Board-touching effects (create_tiles, destroy_tiles, destroy_tiles_row)
 * stay in BattleController because they need to drive the cascade phase
 * machine — they should not be invoked from a relic effect.
 *
 * Context shape:
 *   {
 *     caster:     CombatantState   — the owner of the effect (relic owner or skill user)
 *     target:     CombatantState   — opponent (for damage effects)
 *     log?:       CombatLog        — optional log for adding text entries
 *     resolver?:  MatchResolver    — used for applyDamage (armor → block → HP)
 *     onDamage?:  (info) => void   — optional callback fired after damage lands
 *                                    info: { side: 'caster'|'target', actualDamage, blocked, armorDamage }
 *     onExtraTurn?: () => void     — optional callback fired when extra_turn effect resolves
 *     payload?:   object           — the original trigger payload, exposed so
 *                                    mutating effects (reduce_damage) can edit it
 *     triggerName?: string         — the trigger event name for debug context
 *   }
 */

import { MANA_COLORS } from '../game/TileTypes.js';

/** Effect type vocabulary supported by EffectResolver (atomic effects only). */
export const EFFECT_TYPES = {
  DAMAGE:        'damage',
  ARMOR:         'armor',
  HEAL:          'heal',
  GAIN_MANA:     'gain_mana',
  DRAIN_MANA:    'drain_mana',
  GAIN_ATTACK:   'gain_attack',
  EXTRA_TURN:    'extra_turn',
  REDUCE_DAMAGE: 'reduce_damage',
};

/**
 * Apply a single atomic effect to the given context.
 *
 * Returns true if the effect was recognized and applied, false otherwise.
 * Unrecognized effects are returned as `false` so the caller (e.g. BattleController)
 * can fall back to its own handler for board-touching effects.
 *
 * @param {object} effect — { effectType, damage?, armor?, heal?, gainMana? }
 * @param {object} ctx    — see file header
 * @returns {boolean} true if handled, false if not recognized
 */
export function applyEffect(effect, ctx) {
  if (!effect || !effect.effectType) return false;
  const { caster, target, log, resolver, onDamage, onExtraTurn } = ctx;

  switch (effect.effectType) {
    case EFFECT_TYPES.DAMAGE: {
      if (!resolver || !target) {
        console.warn('[EffectResolver] damage effect requires ctx.resolver and ctx.target.');
        return true;
      }
      const amount = (effect.damage && typeof effect.damage.amount === 'number')
        ? effect.damage.amount
        : (caster && caster.attack) || 1;
      const r = resolver.applyDamage(target, amount);
      if (log && caster && target) {
        log.add(`${caster.name} deals ${r.actualDamage} damage to ${target.name}.`);
      }
      if (onDamage && r.actualDamage > 0) {
        onDamage({ side: 'target', ...r });
      }
      return true;
    }

    case EFFECT_TYPES.ARMOR: {
      if (!caster) return true;
      const amount = (effect.armor && typeof effect.armor.amount === 'number')
        ? effect.armor.amount
        : (caster.attack || 1);
      caster.armor = (caster.armor || 0) + amount;
      if (log) log.add(`${caster.name} gains ${amount} armor.`);
      return true;
    }

    case EFFECT_TYPES.HEAL: {
      if (!caster) return true;
      const amount = (effect.heal && typeof effect.heal.amount === 'number')
        ? effect.heal.amount
        : 0;
      if (amount <= 0) return true;
      const before = caster.hp;
      caster.hp = Math.min(caster.maxHp, caster.hp + amount);
      const actual = caster.hp - before;
      if (log && actual > 0) log.add(`${caster.name} heals for ${actual} HP.`);
      return true;
    }

    case EFFECT_TYPES.GAIN_MANA: {
      if (!caster) return true;
      const gm = effect.gainMana || {};
      const color = gm.color;
      const amount = typeof gm.amount === 'number' ? gm.amount : 0;
      if (!color || amount <= 0) return true;
      if (!caster.mana) caster.mana = {};
      caster.mana[color] = (caster.mana[color] || 0) + amount;
      if (log) log.add(`${caster.name} gains ${amount} ${color} mana.`);
      // Notify the host so onGainMana reactors (e.g. Tuning Rod / Flaming Arrow)
      // fire for RELIC-granted mana too (Familiars, Family Crest, Prism), not
      // just board-matched mana. ctx.payload.side identifies who gained it.
      if (ctx.onGainMana && ctx.payload && ctx.payload.side) {
        ctx.onGainMana(ctx.payload.side, color, amount);
      }
      return true;
    }

    case EFFECT_TYPES.DRAIN_MANA: {
      // Removes mana from the OPPONENT (ctx.target). The caster does NOT
      // gain it — the opponent simply loses it. `color` is optional; when
      // omitted, drains `amount` of EVERY mana color (e.g. Blighted Hook).
      if (!target) return true;
      const dm = effect.drainMana || {};
      const amount = typeof dm.amount === 'number' ? dm.amount : 1;
      if (amount <= 0) return true;
      if (!target.mana) target.mana = {};
      const colors = dm.color ? [dm.color] : MANA_COLORS;
      let totalDrained = 0;
      for (const color of colors) {
        const before = target.mana[color] || 0;
        target.mana[color] = Math.max(0, before - amount);
        totalDrained += before - target.mana[color];
      }
      if (log && totalDrained > 0) {
        log.add(`${target.name} is drained of ${totalDrained} mana.`);
      }
      return true;
    }

    case EFFECT_TYPES.GAIN_ATTACK: {
      // Permanently increases the caster's attack for the rest of the battle.
      // Safe to combine with dynamic attack bonuses (e.g. Group A relics)
      // because those are reconciled via a separate delta in BattleController.
      if (!caster) return true;
      const amount = (effect.gainAttack && typeof effect.gainAttack.amount === 'number')
        ? effect.gainAttack.amount
        : 0;
      if (amount === 0) return true;
      caster.attack = (caster.attack || 0) + amount;
      if (log) log.add(`${caster.name} gains ${amount} attack.`);
      return true;
    }

    case EFFECT_TYPES.EXTRA_TURN: {
      if (log && caster) log.add(`${caster.name} gains an extra turn!`);
      if (onExtraTurn) onExtraTurn();
      return true;
    }

    case EFFECT_TYPES.REDUCE_DAMAGE: {
      // Mutates the trigger payload's `amount` in place so the caller
      // (typically BattleController._applyDamage) reads the reduced value
      // before passing it to applyDamage. Only meaningful when invoked
      // from a trigger that exposes a mutable `amount` field — namely
      // `onIncomingDamage`.
      const payload = ctx.payload;
      if (!payload || typeof payload.amount !== 'number') return true;
      const reduction = (effect.reduceDamage && typeof effect.reduceDamage.amount === 'number')
        ? effect.reduceDamage.amount
        : 1;
      const before = payload.amount;
      payload.amount = Math.max(0, before - reduction);
      const actual = before - payload.amount;
      if (log && actual > 0 && caster) {
        log.add(`${caster.name} reduces incoming damage by ${actual}.`);
      }
      return true;
    }

    default:
      return false;
  }
}
