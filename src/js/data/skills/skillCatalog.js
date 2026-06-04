/**
 * skillCatalog.js — central registry of all skills in the game.
 *
 * Each skill is keyed by a unique `id`. Characters and enemies reference
 * skills by ID rather than embedding full definitions, so:
 *   - skill numbers can be tuned in one place
 *   - skills can be shared between characters/enemies
 *   - new skills don't require touching every character file
 *
 * Adding a new skill:
 *   1. Add a new entry below with a unique `id`.
 *   2. Reference the id from a character/enemy definition: `skills: ['bash']`.
 *   3. Register the icon/sound asset keys in main.js ASSET_MAP / SoundConfig.
 *
 * Skill shape:
 * {
 *   id:          string            — unique identifier (kebab/snake_case)
 *   name:        string            — display name
 *   description: string            — UI description (newlines allowed)
 *   icon:        string            — AssetManager key for the icon
 *   sound:       string            — SoundConfig key for the resolve SFX
 *   cost:        { color: amount } — mana cost per color
 *   targeting?:  'board_tile'      — optional, enters TARGETING state
 *   area?:       number|{radius}   — optional, targeting area shape
 *   effects:     EffectDef[]       — list of effects (see MatchResolver.SKILL_EFFECT_TYPES)
 * }
 */

const SKILL_CATALOG = {
  // ── Warrior ──────────────────────────────────────────
  bash: {
    id: 'bash',
    name: 'Bash',
    description: 'Deal 5 damage\nGain a turn',
    icon: 'skill_bash',
    sound: 'skill_bash',
    cost: { red: 5 },
    effects: [
      { effectType: 'damage', damage: { amount: 5 } },
      { effectType: 'extra_turn' },
    ],
  },
  defend: {
    id: 'defend',
    name: 'Defend',
    description: 'Gain 6 armor\nCreate 3 blue',
    icon: 'skill_defend',
    sound: 'skill_defend',
    cost: { blue: 5 },
    effects: [
      // Armor 5→6: sim showed Defend sat under the value curve (~1.2 HPe/mana).
      { effectType: 'armor', armor: { amount: 6 } },
      { effectType: 'create_tiles', createTiles: { amount: 3, type: 'blue' } },
    ],
  },

  // ── Mage ─────────────────────────────────────────────
  fracture: {
    id: 'fracture',
    name: 'Fracture',
    description: 'Destroy 1 row\nCreate 5 purple',
    icon: 'skill_fracture',
    sound: 'skill_fracture',
    targeting: 'board_tile',
    area: 1,
    cost: { yellow: 5 },
    effects: [
      { effectType: 'destroy_tiles_row' },
      { effectType: 'create_tiles', createTiles: { amount: 5, type: 'purple' } },
    ],
  },
  // Old Explode skill — kept commented out for easy revert.
  // explode: {
  //   id: 'explode',
  //   name: 'Explode',
  //   description: 'Destroy tiles in a 3x3 area',
  //   icon: 'skill_explode',
  //   sound: 'skill_explode',
  //   targeting: 'board_tile',
  //   area: { radius: 1 },
  //   cost: { purple: 8 },
  //   effects: [
  //     { effectType: 'destroy_tiles' },
  //   ],
  // },
  arcane_inscription: {
    id: 'arcane_inscription',
    name: 'Arcane Inscription',
    description: 'Change 1 tile into Yellow',
    // Re-uses the explode icon/sound for now — swap to a dedicated
    // skill_arcane_inscription asset whenever new art is added.
    icon: 'skill_explode',
    sound: 'skill_explode',
    targeting: 'board_tile',
    area: { radius: 0 },
    cost: { purple: 3 },
    effects: [
      { effectType: 'convert_tile', convertTile: { type: 'yellow' } },
    ],
  },

  // ── Witch Doctor ─────────────────────────────────────
  summon_dead: {
    id: 'summon_dead',
    name: 'Summon Dead',
    description: 'Change all Yellow into Skulls',
    icon: 'skill_summon_dead',
    sound: 'skill_create_skull',
    cost: { purple: 4 },
    effects: [
      { effectType: 'convert_tiles_by_type', convertByType: { from: 'yellow', to: 'skull' } },
    ],
  },
  oungan: {
    id: 'oungan',
    name: 'Oungan',
    description: 'Heal 6 HP\nCreate 5 green',
    icon: 'skill_oungan',
    sound: 'skill_oungan',
    cost: { green: 6 },
    effects: [
      // Heal 5→6: sim showed Oungan was the most under-budget player skill (~0.8 HPe/mana).
      { effectType: 'heal', heal: { amount: 6 } },
      { effectType: 'create_tiles', createTiles: { amount: 3, type: 'green' } },
    ],
  },

  // ── Enemies ──────────────────────────────────────────
  // NOTE: skills that combine create_tiles with extra_turn must list the
  // extra_turn effect AFTER create_tiles — create_tiles' _beginResolving resets
  // the extra-turn flag, so it has to be (re)set afterward to survive the
  // cascade. Icons/sounds reuse existing keys until dedicated art exists.
  slash: {
    id: 'slash',
    name: 'Slash',
    description: 'Deal 5 damage.',
    icon: 'skill_slash',
    sound: 'skill_slash',
    cost: { red: 5 },
    effects: [
      { effectType: 'damage', damage: { amount: 5 } },
    ],
  },

  // Goblin Sapper
  boom_baby: {
    id: 'boom_baby',
    name: 'Boom Baby!',
    description: 'Deal 999 damage.\nDie',
    icon: 'skill_slash',
    sound: 'skill_boom_baby',
    cost: { red: 20 },
    effects: [
      { effectType: 'damage', damage: { amount: 999 } },
      { effectType: 'self_destruct' },
    ],
  },
  ignition: {
    id: 'ignition',
    name: 'Ignition',
    description: 'Create 20 Red',
    icon: 'skill_slash',
    sound: 'skill_ignition',
    cost: { yellow: 10 },
    effects: [
      { effectType: 'create_tiles', createTiles: { amount: 20, type: 'red' } },
    ],
  },

  // Cyclops
  boulder_throw: {
    id: 'boulder_throw',
    name: 'Boulder Throw',
    description: 'Deal 10 damage.\nCreate 6 Green',
    icon: 'skill_slash',
    sound: 'skill_boulder_throw',
    cost: { green: 6 },
    effects: [
      { effectType: 'damage', damage: { amount: 10 } },
      { effectType: 'create_tiles', createTiles: { amount: 6, type: 'green' } },
    ],
  },
  smash: {
    id: 'smash',
    name: 'Smash',
    description: 'Deal 10 damage.\nGain a turn',
    icon: 'skill_bash',
    sound: 'skill_smash',
    cost: { red: 6 },
    effects: [
      { effectType: 'damage', damage: { amount: 10 } },
      { effectType: 'extra_turn' },
    ],
  },

  // Acolyte
  doomsong: {
    id: 'doomsong',
    name: 'Doomsong',
    description: 'Create 10 skulls',
    icon: 'skill_summon_dead',
    sound: 'skill_doomsong',
    cost: { purple: 7 },
    effects: [
      { effectType: 'create_tiles', createTiles: { amount: 10, type: 'skull' } },
    ],
  },

  // Orc Taskmaster
  charge: {
    id: 'charge',
    name: 'Charge!',
    description: 'Deal 10 damage.\nCreate 5 Red.\nGain a turn',
    icon: 'skill_bash',
    sound: 'skill_charge',
    cost: { red: 8 },
    effects: [
      { effectType: 'damage', damage: { amount: 10 } },
      { effectType: 'create_tiles', createTiles: { amount: 5, type: 'red' } },
      { effectType: 'extra_turn' },
    ],
  },
  frenzy: {
    id: 'frenzy',
    name: 'Frenzy',
    description: 'Gain 10 armor.\nCreate 5 Blue.\nGain a turn',
    icon: 'skill_defend',
    sound: 'skill_frenzy',
    cost: { blue: 8 },
    effects: [
      { effectType: 'armor', armor: { amount: 10 } },
      { effectType: 'create_tiles', createTiles: { amount: 5, type: 'blue' } },
      { effectType: 'extra_turn' },
    ],
  },

  // Chokeweed — free buff that simply ends the caster's turn. With no
  // extra_turn / cascade effect, the standard skill flow ends the turn
  // immediately after resolving. Empty cost = always castable; SkillButton
  // hides its mana column when the cost is empty.
  encroach: {
    id: 'encroach',
    name: 'Encroach',
    description: 'Gain +1 Attack.\nEnd turn.',
    icon: 'skill_encroach',
    sound: 'skill_encroach',
    cost: {},
    effects: [
      { effectType: 'gain_attack', gainAttack: { amount: 1 } },
    ],
  },

  // Goresnout Trackers — ramps attack while chipping damage. Pairs with the
  // Goresnout Collars relic (echoes the 2 damage for 4 total).
  hound: {
    id: 'hound',
    name: 'Hound',
    description: 'Gain +1 Attack.\nDeal 2 damage.',
    icon: 'skill_hound',
    sound: 'skill_hound',
    cost: { red: 3 },
    effects: [
      { effectType: 'gain_attack', gainAttack: { amount: 1 } },
      { effectType: 'damage', damage: { amount: 2 } },
    ],
  },
};

/**
 * Look up a skill by ID.
 * Returns null and warns if not found.
 * @param {string} id
 * @returns {object|null}
 */
export function getSkillById(id) {
  const skill = SKILL_CATALOG[id];
  if (!skill) {
    console.warn(`[skillCatalog] Unknown skill id: "${id}".`);
    return null;
  }
  return skill;
}

/**
 * Resolve an array of skill IDs into full skill objects (shallow-cloned
 * so callers cannot accidentally mutate the catalog).
 *
 * Unknown IDs are skipped with a console warning.
 * @param {string[]} ids
 * @returns {object[]}
 */
export function resolveSkillIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const skill = getSkillById(id);
    if (skill) out.push({ ...skill });
  }
  return out;
}

export default SKILL_CATALOG;
