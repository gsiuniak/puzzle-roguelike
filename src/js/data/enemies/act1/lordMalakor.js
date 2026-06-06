/**
 * Lord Malakor — Act 1 BOSS (floor 10). The act's sole boss.
 *
 * A skull/curse tyrant. Every skill grants an extra turn ("Gain a turn"), and
 * his Heart of the Usurper relic feeds him 2 of every mana at the start of each
 * turn, so he chains casts down a fixed priority: Desecrate (Green→Skulls, the
 * skull engine) > Harvest (Skulls→Purple, refuels Desecrate) > Soul Burn (drain
 * 5 of every enemy mana) > Exsanguinate (reduce the player's attack to 1). His
 * custom AI (aiBehavior: 'malakor', see enemyAiOverrides.js) drives that plan,
 * falling back to board matching when no cast is affordable.
 *
 * Starts with NO mana — the relic refills him on his first turn.
 *
 * See act1/goblin.js for the full field documentation.
 */
const lordMalakor = {
  id: 'lordMalakor',
  name: 'Lord Malakor',
  aiBehavior: 'malakor', // custom AI — see enemyAiOverrides.js
  className: 'Boss',
  level: 1,

  act: 1,
  rarity: 'rare',
  type: 'boss',
  floors: [10], // floor 10 = the boss node (depth 9)

  hp: 70, // floor-1-equivalent baseline (MapScene scales maxHp by depth)
  maxHp: 70,
  attack: 10,
  armor: 0,
  // No starting mana — he must match to fuel his 7-cost skills.
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'malakor', // maps to 'portrait_malakor' asset key
  // Battle background asset key (registered in main.js ASSET_MAP). When absent
  // the BattleScene falls back to 'battle_background_default'.
  background: 'battle_background_malakor',
  // Full-canvas, no-audio cutscene played before this fight via BossIntroScene.
  // URL is relative to index.html. The boss music starts as the video plays.
  introVideo: 'assets/audio/video/video_malakor_intro.mp4',
  music: {
    trackKey: 'battle_theme_act_1_lord_malakor',
    persistAfterBattle: false,
    isSpecialTrack: true,
  },

  skills: ['desecrate', 'soul_burn', 'harvest', 'exsanguinate'],
  relics: ['heart_of_usurper'], // enemy-only pool (enemyRelicCatalog.js)
};

export default lordMalakor;
