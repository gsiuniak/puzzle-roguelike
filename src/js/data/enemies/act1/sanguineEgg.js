/**
 * Sanguine Egg — the dormant form of the Sanguine Phoenix (act1/sanguinePhoenix.js).
 *
 * This is NOT a stand-alone encounter: its `floors` is empty so the spawn
 * selector never picks it. It exists only as a TRANSFORM target — the Phoenix's
 * Sanguine Egg relic swaps into it on death. MapScene still registers it so the
 * id resolves when pre-building the Phoenix's transform forms.
 *
 * The egg minigame is TURN-BASED and TILE-BASED (BattleController egg phase):
 * when the Phoenix is "killed" it becomes this Egg and 2 wild Sanguine Egg tiles
 * are seeded. The player has ONE turn (extra turns included) to clear BOTH:
 *   - clear them → instant victory;
 *   - fail      → the leftover eggs burst and the Egg reverts to a full-life
 *                 Phoenix (which then forfeits that turn).
 * The Egg is INVULNERABLE (its HP bar is purely cosmetic — the win condition is
 * the tiles, NOT damage), has no skills/relics, inherits the Phoenix's mana, and
 * is DORMANT (its turns drive the grace/deadline of the minigame — see
 * BattleController._doEnemyTurn / _resolveEggDeadline). So it never moves tiles.
 *
 * `hp` / `attack` are cosmetic only (the Egg is invulnerable and never acts).
 * `attackScale: 0` opts it out of the per-floor attack bonus.
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

  hp: 999, // cosmetic only — BattleController pins the Egg to 999/999 on transform
  maxHp: 999, // (it's invulnerable for the whole egg phase; the bar is decorative)
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

  // Reverts to the full-life Phoenix if the player fails to clear the egg tiles
  // in time (BattleController._resolveEggDeadline). No relics — the revert/win is
  // purely turn-based, driven by the Phoenix's sanguine_egg transform config.
  transformForms: ['sanguinePhoenix'],

  skills: [],
  relics: [],
};

export default sanguineEgg;
