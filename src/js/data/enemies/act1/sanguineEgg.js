/**
 * Sanguine Egg — the dormant form of the Sanguine Phoenix (act1/sanguinePhoenix.js).
 *
 * This is NOT a stand-alone encounter: its `floors` is empty so the spawn
 * selector never picks it. It exists only as a TRANSFORM target — the Phoenix's
 * Sanguine Egg relic swaps into it on death. MapScene still registers it so the
 * id resolves when pre-building the Phoenix's transform forms.
 *
 * The egg minigame is TURN-BASED and DAMAGE-BASED (BattleController egg phase):
 * when the Phoenix is "killed" it becomes this Egg — a NORMAL, killable low-HP
 * enemy — and the player KEEPS the turn (a hidden extra turn). The player has
 * ONE turn (extra turns included) to deal the Egg's HP in damage:
 *   - slay it → victory (the normal enemy-death path);
 *   - fail   → at the player's turn END the Egg reverts to a full-life Phoenix
 *              (which then takes its turn).
 * The Egg has a small `hp` (floor-scaled like any enemy by MapScene), no skills,
 * inherits the Phoenix's mana, and is DORMANT (it never acts/moves tiles — in
 * normal flow it reverts before it would ever get an enemy turn). Its only relic,
 * `sanguine_chrysalis`, is DISPLAY-ONLY (no effects) — it just tells the player
 * to slay the Egg before their turn ends; the revert is hardcoded in the
 * BattleController egg phase (_resolveEggPhaseAtTurnEnd).
 *
 * `hp` / `maxHp` are the floor-1-equivalent baseline (MapScene scales maxHp by
 * depth). `attack` is cosmetic (the Egg never acts); `attackScale: 0` opts it out
 * of the per-floor attack bonus.
 *
 * See act1/goblin.js for the full field documentation.
 */
const sanguineEgg = {
  id: 'sanguineEgg',
  name: 'Sanguine Egg',
  aiBehavior: null, // standard AI

  className: 'Egg',
  level: 1,

  act: 1,
  rarity: 'rare',
  type: 'elite',
  floors: [], // never spawns on its own — reached only via the Phoenix's transform

  hp: 4, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 3→2 (the egg-check was failed too often — Phoenix measured 51-53% player win vs elite band 65-80%)
  maxHp: 4, // the player must deal this much in ONE turn to slay the Egg
  attack: 1,
  attackScale: 0, // dormant — never attacks; opt out of the per-floor attack bonus
  armor: 0,
  // No starting mana of its own — the Phoenix's mana is carried across the
  // transform in place (see BattleController._transformInto).
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'sanguine_phoenix_egg', // → portrait_sanguine_phoenix_egg (enemy-portraits sheet)
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  // Reverts to the full-life Phoenix if the player fails to slay the Egg before
  // their turn ends (BattleController._resolveEggPhaseAtTurnEnd). The revert is
  // turn-based (driven by the Phoenix's sanguine_egg transform config); the
  // `sanguine_chrysalis` relic here is DISPLAY-ONLY (no effects) — it just tells
  // the player they must slay the Egg this turn.
  transformForms: ['sanguinePhoenix'],

  skills: [],
  relics: ['sanguine_chrysalis'],
};

export default sanguineEgg;
