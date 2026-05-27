/**
 * TriggerTypes.js — canonical list of passive trigger events.
 *
 * BattleController (and any future systems) dispatch these events via
 * PassiveSystem.dispatch(triggerName, payload). Relic effects whose
 * `trigger` field matches the triggerName resolve via EffectResolver.
 *
 * Adding a new trigger:
 *   1. Add a constant here with a clear name (camelCase, `onSomething`).
 *   2. Dispatch it from the appropriate place in BattleController (or
 *      wherever the event semantically originates).
 *   3. Document the payload fields below so relic authors know what
 *      data they can react to.
 *
 * Payload conventions (all triggers receive a `side` field — 'player'
 * or 'enemy' — indicating which combatant's relics should be considered):
 *
 *   onTileMatch          payload: { side, matches: MatchInfo[], tilesDestroyed }
 *                        Fires once per cascade STEP, not per match. Use
 *                        onTileMatchType for per-color reactions.
 *
 *   onTileMatchType      payload: { side, typeId, count, isShape }
 *                        Fires once per individual match. Includes skull
 *                        matches.
 *
 *   onMatch4Plus         payload: { side, typeId, count, centerPos }
 *                        Fires when a single match of 4+ tiles resolves
 *                        (a "big match" — same condition that grants
 *                        the extra turn). `centerPos` is the same
 *                        {col,row} used to anchor the Extra Turn animation
 *                        (swap origin on the initial step, cascade-overlap
 *                        on cascade steps); use it as the focal point for
 *                        radius-based passive effects.
 *
 *   onTurnStart          payload: { side }
 *                        Fires at the start of a turn (after TURN_INTRO).
 *
 *   onTurnEnd            payload: { side }
 *                        Fires when a side's turn ends (before TURN_INTRO
 *                        for the next side).
 *
 *   onIncomingDamage     payload: { side, amount }
 *                        Fires BEFORE damage is applied to a combatant.
 *                        `side` is the SIDE ABOUT TO TAKE damage; effects
 *                        may MUTATE `payload.amount` to reduce or amplify
 *                        the incoming damage (e.g. Evil Eye reduces by 1).
 *                        The final amount is clamped to >= 0 before being
 *                        passed to MatchResolver.applyDamage.
 *
 *   onTakeDamage         payload: { side, amount, blocked, armorDamage }
 *                        Fires when a combatant takes damage that lands
 *                        on HP (i.e., actualDamage > 0). `side` is the
 *                        SIDE THAT TOOK damage.
 *
 *   onDealDamage         payload: { side, amount, target }
 *                        Fires when a combatant deals damage. `side` is
 *                        the SIDE THAT DEALT damage. Fires for the same
 *                        event as onTakeDamage but from the attacker's view.
 */

const TRIGGER_TYPES = {
  ON_TILE_MATCH:       'onTileMatch',
  ON_TILE_MATCH_TYPE:  'onTileMatchType',
  ON_MATCH_4_PLUS:     'onMatch4Plus',
  ON_TURN_START:       'onTurnStart',
  ON_TURN_END:         'onTurnEnd',
  ON_INCOMING_DAMAGE:  'onIncomingDamage',
  ON_TAKE_DAMAGE:      'onTakeDamage',
  ON_DEAL_DAMAGE:      'onDealDamage',
};

export default TRIGGER_TYPES;
