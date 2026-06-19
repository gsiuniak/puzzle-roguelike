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
 *   description: string            — UI description. CONVENTION: each '\n'-
 *                                    separated line must be ONE COMPLETE
 *                                    effect statement ("Deal 5 [[damage]]") —
 *                                    renderers treat each line as its own
 *                                    block and wrap it naturally, so never
 *                                    hand-break a sentence mid-phrase.
 *   descriptionLines?: string[]    — optional structured form (one effect
 *                                    sentence per entry); preferred by the
 *                                    SkillsPane renderer when present
 *                                    (synthesized skills carry it)
 *   icon:        string            — AssetManager key for the icon
 *   sound:       string            — SoundConfig key for the resolve SFX
 *   cost:        { color: amount } — mana cost per color
 *   targeting?:  'board_tile'      — optional, enters TARGETING state
 *   area?:       number|{radius}   — optional, targeting area shape
 *   effects:     EffectDef[]       — list of effects (see MatchResolver.SKILL_EFFECT_TYPES)
 * }
 *
 * Damage scaling: a `damage` effect may carry an individual `scaling` object
 * (`{ attack, magic }`) so its amount grows with the caster's stats — see
 * data/scalingConfig.js. Use `<<n>>` in the description (sibling of `[[kw]]`)
 * to show the LIVE computed amount; pair it with `[[phys]]`/`[[mag]]` to convey
 * the damage type. BOTH character AND enemy skills scale (the bonus uses the
 * effect OWNER's stats); enemy damage/armor skills carry `scaling` too so they
 * ramp with the per-floor enemy-attack bonus (see MapScene). `boom_baby` stays
 * flat (one-shot nuke).
 */

import { DAMAGE_SCALE_PER_POINT, DAMAGE_SCALING_PRESETS } from '../scalingConfig.js';

const SKILL_CATALOG = {
  // ── Warrior ──────────────────────────────────────────
  bash: {
    id: 'bash',
    name: 'Bash',
    description: 'Deal <<5>> [[phys]]\nGain an [[extra turn]]',
    icon: 'skill_bash',
    sound: 'skill_bash',
    cost: { red: 5 },
    effects: [
      // `scaling` is an individual per-effect object (see data/scalingConfig.js):
      // here +1 damage per 3 Magic. The `<<5>>` in the description shows the LIVE
      // computed amount; `[[mag]]` tags it as Magic damage. Use `{ attack: ... }`
      // for a physical (Attack-scaling) skill instead.
      { effectType: 'damage', damage: { amount: 5, scaling: { attack: DAMAGE_SCALING_PRESETS._100 } } },
      { effectType: 'extra_turn' }
    ],
  },
  defend: {
    id: 'defend',
    name: 'Defend',
    description: 'Gain <<6>> [[armor]]\n[[Create]] 3 Blue [[tiles]]',
    icon: 'skill_defend',
    sound: 'skill_defend',
    cost: { blue: 5 },
    effects: [
      // Armor 5→6: sim showed Defend sat under the value curve (~1.2 HPe/mana).
      // Armor scales with Attack at the _33 (×1/3) preset by default.
      { effectType: 'armor', armor: { amount: 6, scaling: { attack: DAMAGE_SCALING_PRESETS._33 } } },
      { effectType: 'create_tiles', createTiles: { amount: 3, type: 'blue' } },
      // { effectType: 'apply_status', applyStatus: { id: 'bleeding', target: 'opponent', turns: 3, attackValue: 1 } },
      // { effectType: 'apply_status', applyStatus: { id: 'berserk', target: 'self', turns: 3 } }
    ],
  },

  // ── Mage ─────────────────────────────────────────────
  fracture: {
    id: 'fracture',
    name: 'Fracture',
    description: '[[Destroy]] 1 row\n[[Create]] 5 purple [[tiles]]',
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
    description: '[[Change]] 1 [[tile]] into Yellow.',
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
    description: '[[Change]] all Yellow [[tiles]] into [[Skulls]]',
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
    description: '[[Heal]] <<6>> HP\nGain 2 [[attack]].',
    icon: 'skill_oungan',
    sound: 'skill_oungan',
    cost: { green: 6 },
    effects: [
      // Heal 5→6: sim showed Oungan was the most under-budget player skill (~0.8 HPe/mana).
      // Healing scales off BOTH Attack and Magic at the _50 (×1/2 each) preset.
      { effectType: 'heal', heal: { amount: 6, scaling: { attack: DAMAGE_SCALING_PRESETS._50, magic: DAMAGE_SCALING_PRESETS._50 } } },
      { effectType: 'gain_attack', gainAttack: { amount: 2 } },
    ],
  },

  // ── Enemies ──────────────────────────────────────────
  // NOTE: skills that combine create_tiles with extra_turn must list the
  // extra_turn effect AFTER create_tiles — create_tiles' _beginResolving resets
  // the extra-turn flag, so it has to be (re)set afterward to survive the
  // cascade. Icons/sounds reuse existing keys until dedicated art exists.
  // ── ENEMY SKILLS ──
  // Enemy damage/armor skills SCALE the same way player skills do — via a
  // `scaling` object on the effect (here Attack, which ramps per floor at spawn,
  // see MapScene ENEMY_ATTACK_FLOOR_BONUS). `<<n>>` shows the live scaled value
  // on the enemy Skills pane. Default damage scaling is _50 (×1/2), armor _33
  // (×1/3) — bump per skill for harder bursts. `boom_baby` stays flat (one-shot).
  slash: {
    id: 'slash',
    name: 'Slash',
    description: 'Deal <<5>> [[damage]].',
    icon: 'skill_slash',
    sound: 'skill_slash',
    cost: { red: 5 },
    effects: [
      { effectType: 'damage', damage: { amount: 5, scaling: { attack: DAMAGE_SCALING_PRESETS._50 } } },
    ],
  },

  // Goblin Sapper
  boom_baby: {
    id: 'boom_baby',
    name: 'Boom Baby!',
    description: 'Deal 999 [[damage]]',
    icon: 'skill_boom_baby',
    sound: 'skill_boom_baby',
    cost: { red: 20 },
    effects: [
      { effectType: 'damage', damage: { amount: 999 } }
    ],
  },
  ignition: {
    id: 'ignition',
    name: 'Ignition',
    description: '[[Create]] 20 Red [[tiles]]',
    icon: 'skill_ignition',
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
    description: 'Deal <<10>> [[damage]].\n[[Create]] 6 Green [[tiles]].',
    icon: 'skill_boulder_throw',
    sound: 'skill_boulder_throw',
    cost: { green: 6 },
    effects: [
      { effectType: 'damage', damage: { amount: 10, scaling: { attack: DAMAGE_SCALING_PRESETS._50 } } },
      { effectType: 'create_tiles', createTiles: { amount: 6, type: 'green' } },
    ],
  },
  smash: {
    id: 'smash',
    name: 'Smash',
    description: 'Deal <<10>> [[damage]].\nGain an [[extra turn]]',
    icon: 'skill_smash',
    sound: 'skill_smash',
    cost: { red: 6 },
    effects: [
      { effectType: 'damage', damage: { amount: 10, scaling: { attack: DAMAGE_SCALING_PRESETS._50 } } },
      { effectType: 'extra_turn' },
    ],
  },

  // Acolyte
  doomsong: {
    id: 'doomsong',
    name: 'Doomsong',
    description: '[[Create]] 10 [[skulls]]',
    icon: 'skill_doomsong',
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
    description: 'Deal <<10>> [[damage]].\n[[Create]] 5 Red [[tiles]].\nGain an [[extra turn]]',
    icon: 'skill_charge',
    sound: 'skill_charge',
    cost: { red: 8 },
    effects: [
      { effectType: 'damage', damage: { amount: 10, scaling: { attack: DAMAGE_SCALING_PRESETS._50 } } },
      { effectType: 'create_tiles', createTiles: { amount: 5, type: 'red' } },
      { effectType: 'extra_turn' },
    ],
  },
  frenzy: {
    id: 'frenzy',
    name: 'Frenzy',
    description: 'Gain <<10>> [[armor]].\nCreate 5 Blue [[tiles]].',
    icon: 'skill_frenzy',
    sound: 'skill_frenzy',
    cost: { blue: 8 },
    effects: [
      { effectType: 'armor', armor: { amount: 10, scaling: { attack: DAMAGE_SCALING_PRESETS._33 } } },
      { effectType: 'create_tiles', createTiles: { amount: 5, type: 'blue' } },
      // { effectType: 'extra_turn' },
    ],
  },

  // Chokeweed — free buff that simply ends the caster's turn. With no
  // extra_turn / cascade effect, the standard skill flow ends the turn
  // immediately after resolving. Empty cost = always castable; SkillButton
  // hides its mana column when the cost is empty.
  encroach: {
    id: 'encroach',
    name: 'Encroach',
    description: 'Gain +1 [[Attack]].\n[[End turn]].',
    icon: 'skill_encroach',
    sound: 'skill_encroach',
    cost: {},
    effects: [
      { effectType: 'gain_attack', gainAttack: { amount: 1 } },
    ],
  },

  // ── Lord Malakor (Act 1 boss) ───────────────────────
  // A skull/curse kit, secondary to his Thrall/harvest relic engine (Usurper's
  // Heart + Baron's Signet — see enemyRelicCatalog.js). Desecrate (green→skull)
  // manufactures skulls to match; Harvest recycles skulls back into Purple to
  // refuel Desecrate. Soul Burn / Exsanguinate are the cripple skills. Each has
  // its own dedicated icon + resolve sound (skill_<id>).
  desecrate: {
    id: 'desecrate',
    name: 'Desecrate',
    description: '[[Convert]] Green [[tiles]] into [[Skulls]].',
    icon: 'skill_desecrate',
    sound: 'skill_desecrate',
    cost: { purple: 7 },
    effects: [
      { effectType: 'convert_tiles_by_type', convertByType: { from: 'green', to: 'skull' } },
      // extra_turn MUST come AFTER the convert: convert_tiles_by_type's
      // _beginResolving resets _extraTurnEarned, so set it afterward to survive
      // the cascade (see AGENT_ENTRYPOINT decision #4).
      // { effectType: 'extra_turn' },
    ],
  },
  soul_burn: {
    id: 'soul_burn',
    name: 'Soul Burn',
    description: 'Drain 5 of Every Mana.\nGain a turn.',
    icon: 'skill_soul_burn',
    sound: 'skill_soul_burn',
    cost: { blue: 9 },
    effects: [
      // Remove 5 of EVERY mana color from the opponent (no color = all).
      { effectType: 'drain_mana', drainMana: { amount: 5 } },
      { effectType: 'extra_turn' },
    ],
  },
  harvest: {
    id: 'harvest',
    name: 'Harvest',
    description: 'Create 10 Green. Turn Skulls into Purple.',
    icon: 'skill_harvest',
    sound: 'skill_harvest',
    cost: { yellow: 7 },
    effects: [
      { effectType: 'create_tiles', createTiles: { amount: 10, type: 'green' } },
      { effectType: 'convert_tiles_by_type', convertByType: { from: 'skull', to: 'purple' } },
      // extra_turn AFTER the convert — see desecrate note above.
      // { effectType: 'extra_turn' },
    ],
  },
  exsanguinate: {
    id: 'exsanguinate',
    name: 'Exsanguinate',
    description: 'Apply [[Cripple]] to the enemy for 1 turn.\nGain a turn.',
    icon: 'skill_exsanguinate',
    sound: 'skill_exsanguinate',
    cost: { red: 3 },
    effects: [
      // Apply Cripple — pin the opponent's attack to 1 for their next turn.
      { effectType: 'apply_status', applyStatus: { id: 'crippled', target: 'opponent', turns: 1, attackValue: 1 } },
      { effectType: 'extra_turn' },
    ],
  },

  // ── Abomination ─────────────────────────────────────
  // Spreads Disease (via Infected Tooth relic on dealing damage) then converts
  // the accumulated Disease into Skulls with Cyst Burst for a skull payoff.
  infected_bite: {
    id: 'infected_bite',
    name: 'Infected Bite',
    description: 'Deal <<3>> [[damage]].\nGain an [[extra turn]].',
    icon: 'skill_infected_bite',
    sound: 'skill_infected_bite',
    cost: { red: 2 },
    effects: [
      { effectType: 'damage', damage: { amount: 1, scaling: { attack: DAMAGE_SCALING_PRESETS._33 } } },
      { effectType: 'extra_turn' },
    ],
  },
  cyst_burst: {
    id: 'cyst_burst',
    name: 'Cyst Burst',
    description: '[[Convert]] all Disease [[tiles]] into [[Skulls]].',
    icon: 'skill_cyst_burst',
    sound: 'skill_cyst_burst',
    cost: { green: 7 },
    effects: [
      { effectType: 'convert_tiles_by_type', convertByType: { from: 'disease', to: 'skull' } },
    ],
  },

  // ── Sanguine Phoenix (Act 1 elite) ──────────────────
  // A self-sustaining vampire. Blood Gorge starves the player of mana while
  // permanently growing the Phoenix's HP pool; Anemic Feast is its skull-fed
  // nuke that refuels Purple and chains turns. Icons/sounds reuse existing
  // enemy-skill keys as placeholders until dedicated art is packed.
  blood_gorge: {
    id: 'blood_gorge',
    name: 'Blood Gorge',
    description: 'Drain 5 of all [[mana]] from the enemy.\nGain 10 Max HP.\n[[Heal]] 10 HP.',
    icon: 'skill_soul_burn',  // placeholder — reuses Soul Burn's drain-themed icon
    sound: 'skill_soul_burn', // placeholder
    cost: { purple: 6 },
    effects: [
      { effectType: 'drain_mana', drainMana: { amount: 5 } },
      // Raises the ceiling first, then the heal fills into the new space.
      { effectType: 'gain_max_hp', gainMaxHp: { amount: 10 } },
      { effectType: 'heal', heal: { amount: 10 } },
    ],
  },
  anemic_feast: {
    id: 'anemic_feast',
    name: 'Anemic Feast',
    // Worded like the synthesizer's `skull + damage` line (skillSynthesizer
    // emitDamage): "Deal <<n>> <type>, plus N per [[Skull]] on the board".
    description: 'Deal <<10>> [[mag]], plus 1 per [[Skull]] on the board.\nGain 6 purple.\nGain an [[extra turn]].',
    icon: 'skill_doomsong',  // placeholder — reuses Doomsong's icon
    sound: 'skill_doomsong', // placeholder
    cost: { red: 10 },
    effects: [
      // perSkull adds the live board Skull count at cast; magic scaling keeps it
      // consistent with the [[mag]] tag (enemy Magic is 0, so <<10>> shows 10).
      { effectType: 'damage', damage: { amount: 10, perSkull: 1, scaling: { magic: DAMAGE_SCALING_PRESETS._50 } } },
      { effectType: 'gain_mana', gainMana: { color: 'purple', amount: 6 } },
      { effectType: 'extra_turn' },
    ],
  },

  // Goresnout Trackers — ramps attack while chipping damage. Pairs with the
  // Goresnout Collars relic (echoes the 2 damage for 4 total).
  hound: {
    id: 'hound',
    name: 'Hound',
    description: 'Gain +1 [[Attack]].\nDeal <<2>> [[damage]].',
    icon: 'skill_hound',
    sound: 'skill_hound',
    cost: { red: 3 },
    effects: [
      { effectType: 'gain_attack', gainAttack: { amount: 1 } },
      { effectType: 'damage', damage: { amount: 2, scaling: { attack: DAMAGE_SCALING_PRESETS._50 } } },
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
