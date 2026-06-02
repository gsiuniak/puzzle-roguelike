/**
 * Lich — Act 3 boss (final-act). See act1/goblin.js for the full field docs.
 */
const lich = {
  id: 'lich',
  name: 'Lich',
  aiBehavior: null,
  className: 'Boss',
  level: 9,

  act: 3,
  rarity: 'rare',
  type: 'boss',

  hp: 120,
  maxHp: 120,
  attack: 5,
  armor: 3,
  mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
  portrait: 'goblin', // placeholder — reuses the goblin portrait until dedicated art exists
  music: {
    trackKey: 'battle_theme',
    persistAfterBattle: false,
    isSpecialTrack: true,
  },

  skills: ['slash'],
  relics: ['cracked_fang', 'goblin_totem', 'cursed_idol'],
};

export default lich;
