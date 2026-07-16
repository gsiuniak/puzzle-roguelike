/**
 * Marrow Sentry — Act 1 minion. A fragile skeleton (tiny HP pool) hiding
 * behind an ever-growing shell of bone: its Bone Armor relic grants 2 Armor
 * at each of its turn starts AND deals 3 damage back on every hit it
 * receives (armor-absorbed hits included), and Deadstop cashes the shell in
 * for damage equal to its CURRENT armor. The fight is a race: burst it down
 * early, or keep the armor shaved before it banks 5 Blue.
 *
 * Custom AI (`marrow_sentry` in enemyAiOverrides.js): standard behavior,
 * except it never casts Deadstop while it has 0 armor (the cast would deal
 * nothing).
 *
 * See act1/goblin.js for the full field documentation.
 */
const marrowSentry = {
  id: 'marrow_sentry',
  name: 'Marrow Sentry',
  aiBehavior: 'marrow_sentry',
  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'uncommon',
  type: 'minion',
  // floors: derived from act1/index.js FLOOR_SPAWNS (placement is edited there)

  hp: 5, // floor-1-equivalent baseline — deliberately tiny; survivability comes from Bone Armor
  maxHp: 5,
  attack: 1,
  armor: 15, // baseline armor would floor-scale (enemyArmorFloorMult); the Sentry builds its own via Bone Armor
  // No starting mana — it builds Blue via swaps to afford Deadstop.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'marrow_sentry', // maps to 'portrait_marrow_sentry' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['deadstop'],
  relics: ['bone_armor'],
};

export default marrowSentry;
