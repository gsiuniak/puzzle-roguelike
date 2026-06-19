/**
 * Sanguine Phoenix — Act 1 ELITE (floors 4-9). A two-phase, near-immortal
 * vampire built entirely from data-driven parts (no bespoke boss code):
 *
 *   - Sanguine Egg relic (onDeath): instead of dying, the Phoenix TRANSFORMS
 *     into the dormant, KILLABLE Sanguine Egg enemy (its own HP bar, no skills,
 *     keeps its mana) and seeds the board with 2 wild Sanguine Egg tiles.
 *   - The Egg's Sanguine Chrysalis relic (also onDeath — fires when the EGG is
 *     killed): if any egg tiles still remain, they burst (liquid blood) and the
 *     Egg is REBORN as a full-life Phoenix; if the player cleared every egg
 *     first, it perishes. So clear BOTH egg tiles before the killing blow. Both
 *     transforms run through the same onDeath path — deterministic, no turn
 *     trigger, no incubation (which mis-behaved with extra turns).
 *   - Blood Gorge (6 Purple): drain 5 of every enemy mana, +10 Max HP, heal 10
 *     — a snowballing HP pool that punishes a slow kill.
 *   - Anemic Feast (10 Red): skull-fed Magic nuke that refuels Purple and gains
 *     an extra turn.
 *
 * `transformForms` lists the alternate enemy ids this fight can become; MapScene
 * pre-resolves each (same floor scaling) and hands them to the BattleController,
 * which swaps the enemy identity in place on transform (see decision in
 * AGENT_ENTRYPOINT). Uses the standard EnemyAI.
 *
 * All art is dedicated: portraits (portrait_sanguine_phoenix /
 * portrait_sanguine_phoenix_egg), skill icons (skill_blood_gorge /
 * skill_anemic_feast), relic icons (relic_sanguine_egg /
 * relic_sanguine_chrysalis), the phoenix_egg_tile, and the four SFX.
 *
 * See act1/goblin.js for the full field documentation.
 */
const sanguinePhoenix = {
  id: 'sanguinePhoenix',
  name: 'Sanguine Phoenix',
  aiBehavior: null, // standard AI

  className: 'Elite',
  level: 1,

  act: 1,
  rarity: 'common',
  type: 'minion',
  floors: [1, 2, 3, 4, 5, 6],
  // type: 'elite',
  // floors: [4, 5, 6, 7, 8, 9],

  hp: 1, // floor-1-equivalent baseline (MapScene scales maxHp by depth)
  maxHp: 1,
  attack: 1,
  armor: 0,
  // No starting mana — it must match the board to fuel Blood Gorge / Anemic Feast.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'sanguine_phoenix', // → portrait_sanguine_phoenix (enemy-portraits sheet)
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  // Alternate forms this enemy can become mid-battle (pre-resolved by MapScene).
  transformForms: ['sanguineEgg'],

  skills: ['blood_gorge', 'anemic_feast'],
  relics: ['sanguine_egg'],
};

export default sanguinePhoenix;
