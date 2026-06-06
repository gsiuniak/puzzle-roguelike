/**
 * Abomination — Act 1 minion (floors 7-9). A diseased horror with a two-part
 * gimmick:
 *   - Infected Tooth relic: every time it deals damage it creates a Disease
 *     tile (an inert tile that does nothing when matched — see TileTypes).
 *   - Severed Maxilla relic: each Disease tile created grants +1 Attack, so
 *     the more it bites, the harder it hits.
 *   - Infected Bite skill (1 Red): deal 1 damage + gain a turn — cheap, so it
 *     can chain bites, spamming Disease tiles and ramping attack each time.
 *   - Cyst Burst skill (10 Green): turns all accumulated Disease into Skulls,
 *     converting the board clutter into a skull payoff (matched at its grown
 *     attack for heavy damage).
 *
 * Uses the standard EnemyAI (no aiBehavior).
 *
 * See act1/goblin.js for the full field documentation.
 */
const abomination = {
  id: 'abomination',
  name: 'Flesh Mongrel',
  aiBehavior: null, // standard AI

  className: 'Minion',
  level: 1,

  act: 1,
  rarity: 'uncommon',
  type: 'minion',
  floors: [7, 8, 9],

  hp: 30, // floor-1-equivalent baseline (MapScene scales maxHp by depth)
  maxHp: 30,
  attack: 3,
  armor: 0,
  // Starts with 1 Red so it can Infected Bite on turn one; builds Green via
  // board matches toward Cyst Burst's 10-green cost.
  mana: { red: 1, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'abomination', // maps to 'portrait_abomination' asset key
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: true,
    isSpecialTrack: false,
  },

  skills: ['infected_bite', 'cyst_burst'],
  relics: ['infected_tooth', 'severed_maxilla'],
};

export default abomination;
