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
 *   onBattleStart        payload: { side }
 *                        Conceptually fires once when the battle is set up.
 *                        Used by STATIC-MODIFIER relics (spawn rate, attack,
 *                        mana gain, skull damage). These effect types do NOT
 *                        flow through EffectResolver/PassiveSystem dispatch —
 *                        they are aggregated directly at battle setup by
 *                        BattleController._initStaticModifiers() because they
 *                        need board / reward access. The trigger string is
 *                        kept for shape consistency and discoverability.
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
 *   onGainMana           payload: { side, color, amount }
 *                        Fires when a combatant gains mana of a color in battle:
 *                        cascade match rewards, skill tile destruction, AND
 *                        relic-granted mana (Familiars, Family Crest, Prism — via
 *                        EffectResolver.gain_mana → PassiveSystem onGainMana
 *                        callback). Fires ONCE per color per gain event (not once
 *                        per mana point). NOT fired for one-time battle-start
 *                        starting mana / Potion grants (grant_starting_mana).
 *                        Relic-triggered dispatches are depth-guarded
 *                        (BattleController._manaGainDepth) against loops. `side`
 *                        is the side that gained the mana (e.g. Tuning Rod deals
 *                        1 damage when its owner gains purple mana).
 *
 *   onTileCreated        payload: { side, typeId, count }
 *                        Fires when a tile is placed on the board by an
 *                        effect (not by a natural match/refill) — e.g.
 *                        Infected Tooth creating a Disease tile. Dispatched
 *                        once per created tile so reactors (Severed Maxilla →
 *                        +1 attack per Disease tile) fire per tile. `side` is
 *                        the side whose effect created the tile. Use an effect
 *                        `condition: { typeId }` to react to a specific tile.
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
 *
 *   onDeath              payload: { side }
 *                        Fires when a combatant's HP reaches 0, BEFORE the
 *                        battle is declared over (dispatched from
 *                        BattleController._checkGameOver). A relic effect may
 *                        REVIVE/TRANSFORM the owner (e.g. the Sanguine Phoenix's
 *                        Sanguine Egg relic swaps the enemy into the Egg form);
 *                        if after dispatch the owner is no longer dead, the
 *                        battle continues instead of ending. `side` is the side
 *                        that died. Guarded against re-entry so a transform that
 *                        leaves HP at 0 can't loop.
 */

const TRIGGER_TYPES = {
  ON_BATTLE_START:     'onBattleStart',
  ON_TILE_MATCH:       'onTileMatch',
  ON_TILE_MATCH_TYPE:  'onTileMatchType',
  ON_MATCH_4_PLUS:     'onMatch4Plus',
  ON_GAIN_MANA:        'onGainMana',
  ON_TILE_CREATED:     'onTileCreated',
  ON_TURN_START:       'onTurnStart',
  ON_TURN_END:         'onTurnEnd',
  ON_INCOMING_DAMAGE:  'onIncomingDamage',
  ON_TAKE_DAMAGE:      'onTakeDamage',
  ON_DEAL_DAMAGE:      'onDealDamage',
  ON_DEATH:            'onDeath',
};

export default TRIGGER_TYPES;
