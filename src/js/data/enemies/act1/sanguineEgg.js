/**
 * Sanguine Egg — the dormant form of the Sanguine Phoenix (act1/sanguinePhoenix.js).
 *
 * This is NOT a stand-alone encounter: its `floors` is empty so the spawn
 * selector never picks it. It exists only as a TRANSFORM target — the Phoenix's
 * Sanguine Egg relic swaps into it on death. MapScene still registers it so the
 * id resolves when pre-building the Phoenix's transform forms.
 *
 * A KILLABLE second health bar — the Egg's Sanguine Chrysalis relic fires on the
 * Egg's DEATH (not a turn trigger): if any wild Sanguine Egg tiles remain it is
 * reborn as a full-life Phoenix; if the player cleared them all first, it
 * perishes. So the player must clear both egg tiles BEFORE landing the killing
 * blow on the Egg. It has no skills and inherits the Phoenix's mana across the
 * transform; it is DORMANT (passes its turns — see BattleController._doEnemyTurn)
 * so it never moves tiles.
 *
 * `hp` is the second-bar size — tune it. It must be high enough that the
 * Phoenix-killing cascade doesn't immediately also kill the Egg (else the Egg
 * phase is skipped) but low enough to grind down over a couple of turns while
 * clearing the eggs. `attackScale: 0` opts the Egg out of the per-floor attack
 * bonus (it never attacks anyway, being dormant).
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

  hp: 20,  // killable second health bar (floor-scaled like any enemy) — tunable
  maxHp: 20,
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

  // Reverts to the full-life Phoenix when its chrysalis blooms with eggs present.
  transformForms: ['sanguinePhoenix'],

  skills: [],
  relics: ['sanguine_chrysalis'],
};

export default sanguineEgg;
