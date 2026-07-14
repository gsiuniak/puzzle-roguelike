# Decision #23 — Trigger dispatch points in BattleController:

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Trigger dispatch points in BattleController:**
- `onTileMatch` / `onTileMatchType` / `onMatch4Plus` — fired from `_enterShowMatch` (every cascade step)
- `onTurnStart` — fired from `_completeTurnIntro` (after state is set to PLAYER_TURN/ENEMY_TURN)
- `onTurnEnd` — fired from `_endTurn` (before transitioning to TURN_INTRO)
- `onTakeDamage` / `onDealDamage` — fired by `_dispatchDamageEvent` after every `applyDamage` call that lands `actualDamage > 0` (skill DAMAGE, skull damage in `_doRemove`, skull damage in `_executeDestroyTiles`). **Passive-applied damage** routed through `EffectResolver`'s `damage` case (e.g. Briarthorn's onTurnStart hit, the onGainMana reactor relics) also dispatches these events: EffectResolver's `onDamage` hook now carries `caster`/`target` refs, and BattleController's PassiveSystem `onDamage` callback calls `_dispatchDamageEvent` so defensive reactors like Family Crest (gain mana when damaged) fire for EVERY instance of damage regardless of source. Damage-triggered passives reached this way (echo, Deathbringer) carry their own reentrancy / once-per-action guards, so it can't loop.
