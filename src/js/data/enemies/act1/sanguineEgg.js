/**
 * Sanguine Egg — the dormant form of the Sanguine Phoenix (act1/sanguinePhoenix.js).
 *
 * This is NOT a stand-alone encounter: its `floors` is empty so the spawn
 * selector never picks it. It exists only as a TRANSFORM target — the Phoenix's
 * Sanguine Egg relic swaps into it on death. MapScene still registers it so the
 * id resolves when pre-building the Phoenix's transform forms.
 *
 * A 999-HP wall the player cannot realistically kill: the goal during the Egg
 * phase is to clear the 2 wild Sanguine Egg TILES (created on the Phoenix's
 * death) before the Egg's Sanguine Chrysalis relic blooms. It has no skills and
 * inherits the Phoenix's mana across the transform. Uses the standard EnemyAI
 * (it can only swap tiles — there is no skill to cast).
 *
 * `attackScale: 0` opts the Egg out of the per-floor attack bonus so it stays a
 * near-harmless wall regardless of depth.
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

  hp: 999,
  maxHp: 999,
  attack: 1,
  attackScale: 0, // a wall: don't add the per-floor attack bonus
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
