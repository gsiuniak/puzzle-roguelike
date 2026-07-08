/**
 * Sanguine Phoenix — Act 1 ELITE (floors 4-9). A two-phase, near-immortal
 * vampire built entirely from data-driven parts (no bespoke boss code):
 *
 *   - Sanguine Egg relic (onDeath): instead of dying, the Phoenix TRANSFORMS
 *     into the dormant Sanguine Egg form (no skills, keeps its mana) — a NORMAL,
 *     killable low-HP enemy. This starts the TURN-BASED egg minigame
 *     (BattleController egg phase): the player KEEPS the turn (a hidden extra
 *     turn) and has ONE turn (extra turns included) to deal the Egg's HP in
 *     damage. Slay it → victory; fail → at the player's turn end the Egg reverts
 *     to a full-life Phoenix (which then takes its turn). All of it is configured
 *     from the sanguine_egg relic's `transform` payload (revert*); the Egg form
 *     carries no relic of its own.
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
 * relic_sanguine_egg), the phoenix_egg_tile, and the four SFX.
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
  // type: 'minion',
  // floors: [1, 2, 3, 4, 5, 6],
  type: 'elite',
  floors: [4, 5, 6, 7, 8, 9],

  hp: 15, // floor-1-equivalent baseline (MapScene scales maxHp by depth); 2026-07-06: 12→10 (each phase cycles the full pool — see egg hp 3→2 in sanguineEgg.js)
  maxHp: 15,
  attack: 3, // 2026-07-06: 3→2 (measured 51% player win — elite band 65-80%; the two-phase revert already doubles effective HP, so attack is the right lever)
  armor: 0,
  // No starting mana — it must match the board to fuel Blood Gorge / Anemic Feast.
  mana: { red: 3, blue: 0, green: 0, yellow: 0, purple: 3 },
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
