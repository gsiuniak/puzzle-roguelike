/**
 * Ogre — Act 2 boss. See act1/goblin.js for the full field docs.
 */
const ogre = {
  id: 'ogre',
  name: 'Ogre',
  aiBehavior: null,
  className: 'Boss',
  level: 6,

  act: 2,
  rarity: 'rare',
  type: 'boss',

  hp: 90,
  maxHp: 90,
  attack: 4,
  armor: 2,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin', // placeholder — reuses the goblin portrait until dedicated art exists
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: false,
    isSpecialTrack: true,
  },

  skills: ['slash'],
  relics: ['goblin_totem', 'cursed_idol'],
};

export default ogre;
