/**
 * Lord Malakor — Act 1 BOSS (floor 10). The act's sole boss.
 *
 * A skull/curse tyrant. His engine is now the Thrall/harvest pair: each turn
 * Usurper's Heart seeds the board with 3 Thrall (wild) tiles and Baron's Signet
 * harvests any Thralls left behind — gaining +1 Attack per Thrall and turning
 * them into Skulls. Thralls help the PLAYER make matches, but every one left on
 * the board feeds the boss permanent Attack and skull pressure. He still carries
 * his skills (Desecrate > Harvest > Soul Burn > Exsanguinate, each granting an
 * extra turn) and casts them opportunistically when board matches fund the cost;
 * his custom AI (aiBehavior: 'malakor', see enemyAiOverrides.js) otherwise ranks
 * skull-building swaps.
 *
 * Starts with NO mana — he must match the board to fuel his skills.
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
  // Enemy-only pool (enemyRelicCatalog.js). Order matters: Baron's Signet
  // harvests LAST turn's Thralls BEFORE Usurper's Heart seeds 3 new ones
  // (onTurnStart effects resolve in relic-array order).
  relics: ['barons_signet', 'heart_of_usurper'],
};

export default lordMalakor;
