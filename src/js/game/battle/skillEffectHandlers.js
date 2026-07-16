/**
 * skillEffectHandlers — the skill-effect handler registry (review R2).
 *
 * One handler per SKILL_EFFECT_TYPES entry, keyed by effect type — the same
 * dispatch idiom as enemyAiOverrides.js. BattleController._resolveEffect is a
 * thin lookup into this table, so ADDING A SKILL EFFECT TYPE = adding one
 * registration here (+ the constant in MatchResolver.SKILL_EFFECT_TYPES).
 *
 * Handler signature:
 *   (effect, ctx) => boolean   — true if the effect entered a cascade
 *                                (BattleState.RESOLVING), false otherwise.
 *
 * ctx (built by BattleController._resolveEffect):
 *   c                 — the BattleController (handlers are an extension of it
 *                       and may use its private surface: _applyDamage,
 *                       _executeCreateTiles, board, log, …)
 *   skill             — the parent skill (for log context)
 *   side              — 'player' | 'enemy' (the caster's side)
 *   oppSide           — the other side
 *   src               — caster battle state
 *   tgt               — opponent battle state
 *   enteredResolving  — () => boolean; whether the controller is now RESOLVING
 *                       (used by board-touching handlers to report a cascade)
 *
 * ATOMIC effects that also exist on the relic/passive path (armor, barrier,
 * heal, gain_attack, gain_magic) DELEGATE to systems/EffectResolver.applyEffect
 * so there is exactly ONE implementation of their math (review M3 — the two
 * copies had already begun to drift). Effects that need controller plumbing
 * (the damage chokepoint, mana-gain dispatch, dynamic-attack recompute, the
 * cascade machine) keep their bodies here.
 */

import BoardModel from '../BoardModel.js';
import { SKILL_EFFECT_TYPES } from '../MatchResolver.js';
import { TILE_TYPES, MANA_COLORS } from '../TileTypes.js';
import { getStatusDef } from '../../data/statusEffects.js';
import { scaledBonus } from '../../data/scalingConfig.js';
import { applyEffect as applyAtomicEffect } from '../../systems/EffectResolver.js';

/** Default MARK damage multiplier when the effect omits one (decision #40). */
export const MARK_DEFAULT_MULT = 2;
/** Minimum lock duration in turns (decision #40). */
export const LOCK_MIN_TURNS = 2;

/**
 * Delegate an atomic effect to the shared EffectResolver with the controller's
 * feedback hooks wired (log + floating "+x" stat text over the portrait).
 * @param {object} effect @param {object} ctx
 * @returns {boolean} always false (atomic effects never enter a cascade)
 */
function delegateAtomic(effect, ctx) {
  applyAtomicEffect(effect, {
    caster: ctx.src,
    log: ctx.c.log,
    onStatChange: (info) => ctx.c._emitFloatingStat(ctx.side, info.kind, info.amount),
  });
  return false;
}

export const SKILL_EFFECT_HANDLERS = {
  [SKILL_EFFECT_TYPES.DAMAGE]: (effect, { c, side, oppSide, src, tgt }) => {
    const base = (effect.damage && typeof effect.damage.amount === 'number')
      ? effect.damage.amount
      : (src.attack || 1);
    // `perSkull` (woven `skull + damage`): + N damage for every Skull tile
    // currently on the board, read at cast time.
    const perSkull = (effect.damage && typeof effect.damage.perSkull === 'number')
      ? effect.damage.perSkull : 0;
    const skullCount = perSkull > 0 ? c.board.getTilesOfType('skull').length : 0;
    // `perArmor` (Deadstop): + N damage per point of the CASTER's current
    // armor, read at cast time. Armor is NOT consumed (contrast: consume).
    const perArmor = (effect.damage && typeof effect.damage.perArmor === 'number')
      ? effect.damage.perArmor : 0;
    // Opt-in stat scaling (effect.damage.scaling): + floored Attack/Magic
    // bonus from the caster. No `scaling` field → flat (unchanged). Both
    // character AND enemy skills carry it (bonus uses the caster's stats).
    const scaleBonus = scaledBonus(effect.damage && effect.damage.scaling, src);
    const amount = base + perSkull * skullCount + perArmor * (src.armor || 0) + scaleBonus;
    const r = c._applyDamage(tgt, amount);
    c.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
    c._setShakeFromDamage(r.actualDamage, tgt.maxHp);
    c._markDirectDamage(side, r.actualDamage);
    c._dispatchDamageEvent(side, oppSide, r);
    // LEECH (woven modifier): heal the caster for a fraction of the damage
    // dealt. `leech` is a 0..1 fraction attached to the damage payload by the
    // synthesizer. See decision #40.
    c._applyLeech(src, side, r.actualDamage, effect.damage && effect.damage.leech);
    return false;
  },

  // Atomic — single implementation lives in systems/EffectResolver.
  [SKILL_EFFECT_TYPES.ARMOR]: delegateAtomic,
  [SKILL_EFFECT_TYPES.BARRIER]: delegateAtomic,
  [SKILL_EFFECT_TYPES.GAIN_ATTACK]: delegateAtomic,
  [SKILL_EFFECT_TYPES.GAIN_MAGIC]: delegateAtomic,

  [SKILL_EFFECT_TYPES.HEAL]: (effect, ctx) => {
    const base = (effect.heal && typeof effect.heal.amount === 'number')
      ? effect.heal.amount : 0;
    if (base <= 0) {
      ctx.c.log.add(`${ctx.skill.name} has no heal amount configured.`);
      return false;
    }
    return delegateAtomic(effect, ctx);
  },

  [SKILL_EFFECT_TYPES.GAIN_MAX_HP]: (effect, { c, src }) => {
    // Permanently raise the caster's MAX HP. Does NOT heal — a paired HEAL
    // effect fills the new space (e.g. Blood Gorge: +10 max HP, then heal 10).
    const amount = (effect.gainMaxHp && typeof effect.gainMaxHp.amount === 'number')
      ? effect.gainMaxHp.amount : 0;
    if (amount !== 0) {
      src.maxHp = Math.max(1, (src.maxHp || 0) + amount);
      c.log.add(`${src.name} gains ${amount} max HP.`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.CREATE_TILES]: (effect, ctx) => {
    ctx.c._executeCreateTiles(effect, ctx.side, ctx.skill.name);
    return ctx.enteredResolving();
  },

  [SKILL_EFFECT_TYPES.CONVERT_TILES_BY_TYPE]: (effect, ctx) => {
    ctx.c._executeConvertTilesByType(effect, ctx.side, ctx.skill.name);
    return ctx.enteredResolving();
  },

  [SKILL_EFFECT_TYPES.DESTROY_TILES_BY_TYPE]: (effect, ctx) => {
    // Destroy tiles of a given type board-wide (non-targeted). `amount`
    // omitted = ALL of that type; set = up to N random ones. Routes through
    // the shared destroy path (mana + skull damage + cascade).
    const { c, skill } = ctx;
    const cfg = effect.destroyByType || {};
    const type = cfg.type;
    if (!type || !TILE_TYPES[String(type).toUpperCase()]) {
      console.warn(`[DESTROY_TILES_BY_TYPE] Unknown type "${type}". Skipping.`);
      return false;
    }
    let positions = c.board.getTilesOfType(type);
    if (typeof cfg.amount === 'number') {
      positions = BoardModel.pickRandomTiles(positions, cfg.amount);
    }
    if (!positions.length) {
      c.log.add(`${skill.name}: no ${type} tiles to destroy.`);
      return false;
    }
    c._executeDestroyTiles(positions, positions[0].col, positions[0].row, skill.name);
    return ctx.enteredResolving();
  },

  [SKILL_EFFECT_TYPES.EXTRA_TURN]: (effect, { c, side, src }) => {
    if (c._canGainExtraTurn(side)) {
      c._extraTurnEarned = true;
      c.log.add(`${src.name} gains an extra turn!`);
    } else {
      c.log.add(`${src.name} is Frozen and cannot gain an extra turn.`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.SELF_DESTRUCT]: (effect, { c, src }) => {
    // Caster dies. The post-effect _checkGameOver detects hp <= 0 and ends
    // the battle (if the same skill also killed the opponent, the player's
    // death is checked first, so a mutual-kill still resolves as a loss).
    src.hp = 0;
    c.log.add(`${src.name} self-destructs!`);
    return false;
  },

  [SKILL_EFFECT_TYPES.DRAIN_MANA]: (effect, { c, tgt }) => {
    // Remove mana from the OPPONENT (tgt). `color` optional — omit to drain
    // `amount` of every color (Soul Burn). The caster does NOT gain it.
    const dm = effect.drainMana || {};
    const amount = typeof dm.amount === 'number' ? dm.amount : 1;
    if (amount > 0) {
      if (!tgt.mana) tgt.mana = {};
      const colors = dm.color ? [dm.color] : MANA_COLORS;
      let drained = 0;
      for (const color of colors) {
        const before = tgt.mana[color] || 0;
        tgt.mana[color] = Math.max(0, before - amount);
        drained += before - tgt.mana[color];
      }
      // Draining unspent mana can lower the opponent's dynamic attack.
      c._recomputeDynamicAttack(tgt);
      if (drained > 0) c.log.add(`${tgt.name} is drained of ${drained} mana.`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.GAIN_MANA]: (effect, { c, side, src }) => {
    // Grant the CASTER mana (synthesized "gain" skills). Gated by Enfeebled
    // like every other in-battle mana credit; fires onGainMana so reactor
    // relics (Flaming Arrow, …) see it — same as cascade/skill-destroy gains.
    const gm = effect.gainMana || {};
    const amount = typeof gm.amount === 'number' ? gm.amount : 0;
    const color = gm.color;
    if (amount > 0 && color) {
      if (c._canGainMana(side)) {
        if (!src.mana) src.mana = {};
        src.mana[color] = (src.mana[color] || 0) + amount;
        c._recomputeDynamicAttack(src);
        c.log.add(`${src.name} gains ${amount} ${color} mana.`);
        c._dispatchManaGain(side, color, amount);
      } else {
        c.log.add(`${src.name} is Enfeebled and gains no mana.`);
      }
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.SILENCE]: (effect, { c, side, tgt }) => {
    // Legacy alias → unified Silence status on the OPPONENT.
    const turns = (effect.silence && typeof effect.silence.turns === 'number')
      ? effect.silence.turns : 1;
    c._applyStatus(tgt, 'silenced', { turns }, side);
    return false;
  },

  [SKILL_EFFECT_TYPES.SET_ATTACK]: (effect, { c, side, tgt }) => {
    // Legacy alias → Cripple status (attack pinned to `value`) on the OPPONENT.
    const cfg = effect.setAttack || {};
    const value = typeof cfg.value === 'number' ? cfg.value : 1;
    const turns = typeof cfg.turns === 'number' ? cfg.turns : 1;
    c._applyStatus(tgt, 'crippled', { turns, attackValue: value }, side);
    return false;
  },

  [SKILL_EFFECT_TYPES.APPLY_STATUS]: (effect, { c, side, src, tgt }) => {
    // General, data-driven status application. Payload applyStatus:
    // { id, target:'self'|'opponent', turns, attackValue? }.
    const cfg = effect.applyStatus || {};
    if (!cfg.id || !getStatusDef(cfg.id)) {
      console.warn(`[BattleController] apply_status: unknown status id "${cfg.id}". Skipping.`);
      return false;
    }
    const turns = typeof cfg.turns === 'number' ? cfg.turns : 1;
    const targetState = cfg.target === 'self' ? src : tgt;
    c._applyStatus(targetState, cfg.id, { turns, attackValue: cfg.attackValue }, side);
    return false;
  },

  [SKILL_EFFECT_TYPES.SHUFFLE]: (effect, { c, side, skill }) => {
    c._executeShuffle(side, skill && skill.name);
    // Never enters RESOLVING — shuffle yields a no-match board (the paired
    // extra_turn effect resolves inline afterward).
    return false;
  },

  [SKILL_EFFECT_TYPES.APPLY_POISON]: (effect, { c, src, tgt }) => {
    // Apply POISON stacks (default to the OPPONENT). The number of stacks
    // applied scales with the caster's stats (Poison Dart: base 3 + Magic
    // _50). The stacks themselves deal flat damage = stack count at the
    // applier's turn end (_tickPoison). See decision #39.
    const cfg = effect.poison || {};
    const base = (typeof cfg.amount === 'number') ? cfg.amount : 0;
    // `perSkull` (woven `skull + poison`): +N stacks per Skull on the board.
    const perSkull = (typeof cfg.perSkull === 'number') ? cfg.perSkull : 0;
    const skullCount = perSkull > 0 ? c.board.getTilesOfType('skull').length : 0;
    const stacks = base + perSkull * skullCount + scaledBonus(cfg.scaling, src);
    const targetState = cfg.target === 'self' ? src : tgt;
    c._applyPoison(targetState, stacks);
    return false;
  },

  [SKILL_EFFECT_TYPES.TRANSMUTE_MANA]: (effect, { c, side, src }) => {
    // Convert the caster's OTHER mana into a destination color — a battery
    // for next turn. Pulls from the most-abundant other colors first; finite,
    // so it can't loop. Fires onGainMana so reactor relics see the gain.
    // See decision #40.
    const cfg = effect.transmuteMana || {};
    const dest = cfg.color;
    let budget = (typeof cfg.amount === 'number') ? cfg.amount : 0;
    if (!dest || budget <= 0) return false;
    if (!c._canGainMana(side)) {
      c.log.add(`${src.name} is Enfeebled and cannot transmute mana.`);
      return false;
    }
    if (!src.mana) src.mana = {};
    const others = MANA_COLORS.filter((col) => col !== dest)
      .sort((a, b) => (src.mana[b] || 0) - (src.mana[a] || 0));
    let moved = 0;
    for (const col of others) {
      if (budget <= 0) break;
      const take = Math.min(src.mana[col] || 0, budget);
      if (take > 0) { src.mana[col] -= take; budget -= take; moved += take; }
    }
    if (moved > 0) {
      src.mana[dest] = (src.mana[dest] || 0) + moved;
      c._recomputeDynamicAttack(src);
      c.log.add(`${src.name} transmutes ${moved} mana into ${dest}.`);
      c._dispatchManaGain(side, dest, moved);
    } else {
      c.log.add(`${src.name} has no other mana to transmute.`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.CONSUME]: (effect, { c, side, oppSide, src, tgt }) => {
    // Spend a built-up pool for damage = floor(poolSize / divisor) — 1 damage
    // per `divisor` units. 'mana' (with a color = that color's leftover, no
    // color = ALL leftover mana); 'armor'/'barrier' = that shield pool (a
    // Shield Bash). No stat scaling. See decision #40.
    const cfg = effect.consume || {};
    const divisor = Math.max(1, cfg.divisor || 2);
    let units = 0;
    if (cfg.resource === 'armor') { units = src.armor || 0; src.armor = 0; }
    else if (cfg.resource === 'barrier') { units = src.barrier || 0; src.barrier = 0; }
    else {
      if (!src.mana) src.mana = {};
      const cols = cfg.color ? [cfg.color] : MANA_COLORS;
      for (const col of cols) { units += src.mana[col] || 0; src.mana[col] = 0; }
      c._recomputeDynamicAttack(src);
    }
    const amount = Math.floor(units / divisor);
    if (amount > 0) {
      const r = c._applyDamage(tgt, amount);
      c.log.add(`${src.name} consumes ${units} ${cfg.resource || 'mana'}, dealing ${r.actualDamage} damage.`);
      c._setShakeFromDamage(r.actualDamage, tgt.maxHp);
      c._markDirectDamage(side, r.actualDamage);
      c._dispatchDamageEvent(side, oppSide, r);
    } else {
      c.log.add(`${src.name} has nothing to consume.`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.MARK]: (effect, { c, src }) => {
    // Arm a one-time damage MULTIPLIER on the caster's NEXT damage instance
    // (consumed in _applyDamage). Persists until consumed (no timer). The
    // larger multiplier wins if re-applied. See decision #40.
    const mult = (effect.mark && typeof effect.mark.multiplier === 'number')
      ? effect.mark.multiplier : MARK_DEFAULT_MULT;
    if (mult > 1) {
      src.mark = Math.max(src.mark || 0, mult);
      c.log.add(`${src.name} marks the next strike (x${mult}).`);
    }
    return false;
  },

  [SKILL_EFFECT_TYPES.LOCK_COLOR]: (effect, { c, src }) => {
    // NON-targeted lock fallback (the `random`-bonus variant, which carries a
    // preset color). The woven `lock` action is TARGETED and resolves via
    // _executeLockColor (clicked tile's color); this path only fires for an
    // instant skill with a preset `cfg.color`, else most-abundant. Decision #40.
    const cfg = effect.lockColor || {};
    const turns = (typeof cfg.turns === 'number' && cfg.turns >= LOCK_MIN_TURNS)
      ? cfg.turns : LOCK_MIN_TURNS;
    let color = cfg.color;
    if (!color) color = c._mostAbundantBoardColor();
    if (color) {
      c.board.lockColor(color, turns);
      c.log.add(`${src.name} locks ${color} tiles for ${turns} turns.`);
    }
    return false;
  },
};

export default SKILL_EFFECT_HANDLERS;
