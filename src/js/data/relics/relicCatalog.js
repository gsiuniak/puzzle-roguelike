/**
 * relicCatalog.js — central registry of all relics in the game.
 *
 * Relics grant passive abilities that automatically trigger on battle/game
 * events (see systems/TriggerTypes.js for the list of supported triggers).
 *
 * Each relic is keyed by a unique `id`. Characters and enemies reference
 * relics by ID rather than embedding full definitions, so:
 *   - relic numbers can be tuned in one place
 *   - relics can be shared between characters/enemies
 *   - new relics don't require touching every character file
 *
 * Adding a new relic:
 *   1. Add a new entry below with a unique `id`.
 *   2. Reference the id from a character/enemy definition: `relics: ['family_crest']`.
 *   3. Register the icon asset key in main.js ASSET_MAP.
 *
 * Relic shape:
 * {
 *   id:          string         — unique identifier (kebab/snake_case)
 *   name:        string         — display name
 *   description: string         — UI tooltip / description
 *   icon:        string         — AssetManager key for the icon
 *   rarity:      string         — RELIC_RARITY value (starter|common|uncommon|rare|legendary)
 *   area?:       any            — reserved for future area-based relics
 *   effects: [
 *     {
 *       trigger:     string     — TRIGGER_TYPES key (e.g. 'onTakeDamage')
 *       effectType:  string     — EFFECT_TYPES key (e.g. 'gain_mana')
 *       <effect data fields>    — type-specific payload, e.g. gainMana: { color, amount }
 *     }, ...
 *   ]
 * }
 *
 * Each effect carries its own trigger, so a single relic can mix several
 * trigger→effect pairs (e.g. "on damage taken: gain mana; on turn start:
 * deal 1 damage").
 *
 * ── Static-modifier relics ──────────────────────────────────────────────
 * Some relics are persistent passive modifiers rather than event reactions
 * (e.g. "+3 attack", "+10% red spawn rate", "+1 red mana per match"). These
 * use the `onBattleStart` trigger and one of the static-modifier effect
 * types, aggregated once at battle setup by
 * BattleController._initStaticModifiers():
 *   modify_stat         — { modifyStat: { stat, amount } }   (e.g. attack +3)
 *   modify_spawn_rate   — { spawnRate: { tile, amount } }    (percentage points)
 *   modify_mana_gain    — { manaGain: { color, amount } }    (bonus mana per match)
 *   modify_skull_damage — { skullDamage: { amount } }        (bonus matched-skull dmg)
 *   grant_starting_mana — { startingMana: { color, amount } }(one-time mana at setup)
 * These do NOT flow through EffectResolver (they need board / reward access).
 *
 * ── Damage scaling ──────────────────────────────────────────────────────────
 * A `damage` effect may carry an individual `scaling` object (`{ attack, magic }`)
 * so its amount grows with the OWNER's stats (see data/scalingConfig.js;
 * `DAMAGE_SCALE_PER_POINT` = "+1 per 3 stat"). Descriptions use `<<n>>` to show
 * the LIVE computed amount and `[[phys]]`/`[[mag]]` to convey the damage type
 * (Physical scales with Attack, Magic with Magic).
 */

import { DAMAGE_SCALE_PER_POINT, DAMAGE_SCALING_PRESETS } from '../scalingConfig.js';

/**
 * Relic rarity tiers. Used for reward pools / drop weighting and UI framing.
 * @enum {string}
 */
export const RELIC_RARITY = {
  STARTER:   'starter',
  COMMON:    'common',
  UNCOMMON:  'uncommon',
  RARE:      'rare',
  LEGENDARY: 'legendary',
};

const RELIC_CATALOG = {
  family_crest: {
    id: 'family_crest',
    name: 'Family Crest',
    description: 'When you take [[damage]], gain 2 red [[mana]].',
    icon: 'relic_family_crest',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      {
        trigger: 'onTakeDamage',
        effectType: 'gain_mana',
        gainMana: { color: 'red', amount: 2 },
      },
    ],
  },

  unstable_catalyst: {
    id: 'unstable_catalyst',
    name: 'Unstable Catalyst',
    description: 'Explode [[tiles]] in radius 1 when matching 4+ tiles.',
    icon: 'relic_unstable_catalyst',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      // Board-touching effect — handled by BattleController via the
      // PassiveSystem.onBoardEffect callback (EffectResolver ignores it).
      // The center of the explosion is the same position used to spawn
      // the "Extra Turn" animation (payload.centerPos on onMatch4Plus).
      {
        trigger: 'onMatch4Plus',
        effectType: 'destroy_tiles_radius',
        area: { radius: 1 },
      },
    ],
  },

  evil_eye: {
    id: 'evil_eye',
    name: 'Evil Eye',
    description: 'Reduce all [[damage]] taken by 1.',
    icon: 'relic_evil_eye',
    rarity: RELIC_RARITY.STARTER,
    effects: [
      // Fires before damage is applied; mutates the mutable `amount`
      // field of the trigger payload via EffectResolver's reduce_damage.
      {
        trigger: 'onIncomingDamage',
        effectType: 'reduce_damage',
        reduceDamage: { amount: 1 },
      },
    ],
  },

  // ── Group A: spawn-rate relics ──────────────────────────────────────────
  // Each raises its tile's spawn chance by 10 percentage points. The board
  // redistributes the remaining probability across the other tiles in
  // proportion to their base rates (BoardModel.getEffectiveWeights).
  flint: {
    id: 'flint',
    name: 'Flint',
    description: 'Increase the chance of Red [[tiles]] appearing.',
    icon: 'relic_flint',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'red', amount: 10 } },
    ],
  },

  dewstone: {
    id: 'dewstone',
    name: 'Dewstone',
    description: 'Increase the chance of Blue [[tiles]] appearing.',
    icon: 'relic_dewstone',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'blue', amount: 10 } },
    ],
  },

  fossilized_fern: {
    id: 'fossilized_fern',
    name: 'Fossilized Fern',
    description: 'Increase the chance of Green [[tiles]] appearing.',
    icon: 'relic_fossilized_fern',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'green', amount: 10 } },
    ],
  },

  copper_coil: {
    id: 'copper_coil',
    name: 'Copper Coil',
    description: 'Increase the chance of Yellow [[tiles]] appearing.',
    icon: 'relic_copper_coil',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'yellow', amount: 10 } },
    ],
  },

  obsidian_shard: {
    id: 'obsidian_shard',
    name: 'Obsidian Shard',
    description: 'Increase the chance of Purple [[tiles]] appearing.',
    icon: 'relic_obsidian_shard',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'purple', amount: 10 } },
    ],
  },

  catacomb_key: {
    id: 'catacomb_key',
    name: 'Catacomb Key',
    description: 'Increase the chance of [[Skulls]] appearing.',
    icon: 'relic_catacomb_key',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_spawn_rate', spawnRate: { tile: 'skull', amount: 10 } },
    ],
  },

  // ── Group B: mana-gain relics ───────────────────────────────────────────
  // Each grants +1 bonus mana of its color whenever that color is matched.
  bellows: {
    id: 'bellows',
    name: 'Bellows',
    description: 'Increase the [[mana]] gained when [[matching]] Red [[tiles]] by 1.',
    icon: 'relic_bellows',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'red', amount: 1 } },
    ],
  },

  gourd_flask: {
    id: 'gourd_flask',
    name: 'Gourd Flask',
    description: 'Increase the [[mana]] gained when [[matching]] Blue [[tiles]] by 1.',
    icon: 'relic_gourd_flask',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'blue', amount: 1 } },
    ],
  },

  pestle: {
    id: 'pestle',
    name: 'Pestle',
    description: 'Increase the [[mana]] gained when [[matching]] Green [[tiles]] by 1.',
    icon: 'relic_pestle',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'green', amount: 1 } },
    ],
  },

  thimble: {
    id: 'thimble',
    name: 'Thimble',
    description: 'Increase the [[mana]] gained when [[matching]] Yellow [[tiles]] by 1.',
    icon: 'relic_thimble',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'yellow', amount: 1 } },
    ],
  },

  astrolabe: {
    id: 'astrolabe',
    name: 'Astrolabe',
    description: 'Increase the [[mana]] gained when [[matching]] Purple [[tiles]] by 1.',
    icon: 'relic_astrolabe',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_mana_gain', manaGain: { color: 'purple', amount: 1 } },
    ],
  },

  funerary_bell: {
    id: 'funerary_bell',
    name: 'Funerary Bell',
    description: 'Increases [[damage]] dealt of [[matched]] [[skulls]] by 2.',
    icon: 'relic_funerary_bell',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_skull_damage', skullDamage: { amount: 2 } },
    ],
  },

  // ── Individual relics ───────────────────────────────────────────────────
  prism: {
    id: 'prism',
    name: 'Prism',
    description: 'Gain 1 of each [[mana]] when [[matching]] 4+ [[tiles]].',
    icon: 'relic_prism',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'red', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'blue', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'green', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'yellow', amount: 1 } },
      { trigger: 'onMatch4Plus', effectType: 'gain_mana', gainMana: { color: 'purple', amount: 1 } },
    ],
  },

  blighted_hook: {
    id: 'blighted_hook',
    name: 'Blighted Hook',
    description: '[[Drain]] 1 of each [[mana]] from the opponent when [[matching]] 4+ [[tiles]].',
    icon: 'relic_blighted_hook',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      // Removes mana from the opponent — the player does not gain it.
      { trigger: 'onMatch4Plus', effectType: 'drain_mana', drainMana: { amount: 1 } },
    ],
  },

  trebuchet: {
    id: 'trebuchet',
    name: 'Trebuchet',
    description: 'Deal <<1>> [[mag]] to the opponent when [[matching]] 4+ [[tiles]].',
    icon: 'relic_trebuchet',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onMatch4Plus', effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  claymore: {
    id: 'claymore',
    name: 'Claymore',
    description: 'Gain +2 [[Attack]].',
    icon: 'relic_claymore',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'modify_stat', modifyStat: { stat: 'attack', amount: 3 } },
    ],
  },

  aegis: {
    id: 'aegis',
    name: 'Aegis',
    description: 'Gain <<1>> [[Armor]] at the start of each turn.',
    icon: 'relic_aegis',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      // Armor scales with Attack at the _33 (×1/3) preset by default.
      { trigger: 'onTurnStart', effectType: 'armor', armor: { amount: 1, scaling: { attack: DAMAGE_SCALING_PRESETS._33 } } },
    ],
  },

  thorned_rose: {
    id: 'thorned_rose',
    name: 'Thorned Rose',
    description: 'Deal <<1>> [[phys]] to the enemy whenever you take damage.',
    icon: 'relic_thorned_rose',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTakeDamage', effectType: 'damage', damage: { amount: 1, scaling: { attack: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  alabaster_flask: {
    id: 'alabaster_flask',
    name: 'Alabaster Flask',
    description: '[[Heal]] <<2>> HP at the start of each of your turns.',
    icon: 'relic_alabaster_flask',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      // Heal scales off BOTH Attack and Magic at the _50 (×1/2 each) preset. (Amount
      // aligned to the long-standing "2 HP" description; was previously 1.)
      { trigger: 'onTurnStart', effectType: 'heal', heal: { amount: 2, scaling: { attack: DAMAGE_SCALING_PRESETS._50, magic: DAMAGE_SCALING_PRESETS._50 } } },
    ],
  },

  // ── Group C: "+attack per unspent mana" relics (one per color) ───────────
  // Dynamic attack bonus: +1 Attack per 3 unspent mana of the color. The
  // bonus rises/falls as mana is gained/spent, reconciled each frame by
  // BattleController._recomputeDynamicAttack (effectType attack_per_unspent_mana).
  cestus: {
    id: 'cestus',
    name: 'Cestus',
    description: 'Gain +1 [[Attack]] for every 3 unspent Red [[mana]].',
    icon: 'relic_cestus',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'red', per: 3, amount: 1 } },
    ],
  },

  harpoon: {
    id: 'harpoon',
    name: 'Harpoon',
    description: 'Gain +1 [[Attack]] for every 3 unspent Blue [[mana]].',
    icon: 'relic_harpoon',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'blue', per: 3, amount: 1 } },
    ],
  },

  club: {
    id: 'club',
    name: 'Club',
    description: 'Gain +1 [[Attack]] for every 3 unspent Green [[mana]].',
    icon: 'relic_club',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'green', per: 3, amount: 1 } },
    ],
  },

  stiletto: {
    id: 'stiletto',
    name: 'Stiletto',
    description: 'Gain +1 [[Attack]] for every 3 unspent Yellow [[mana]].',
    icon: 'relic_stiletto',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'yellow', per: 3, amount: 1 } },
    ],
  },

  wand: {
    id: 'wand',
    name: 'Wand',
    description: 'Gain +1 [[Attack]] for every 3 unspent Purple [[mana]].',
    icon: 'relic_wand',
    rarity: RELIC_RARITY.RARE,
    effects: [
      { trigger: 'onBattleStart', effectType: 'attack_per_unspent_mana', attackPerMana: { color: 'purple', per: 3, amount: 1 } },
    ],
  },

  // ── More individual relics ───────────────────────────────────────────────
  scythe: {
    id: 'scythe',
    name: 'Scythe',
    description: 'Gain +1 [[Attack]] whenever you [[match]] 3+ [[skulls]].',
    icon: 'relic_scythe',
    rarity: RELIC_RARITY.RARE,
    effects: [
      // Fires per skull match of 3+ (the condition gates on the match payload).
      {
        trigger: 'onTileMatchType',
        condition: { typeId: 'skull', minCount: 3 },
        effectType: 'gain_attack',
        gainAttack: { amount: 1 },
      },
    ],
  },

  tsunami: {
    id: 'tsunami',
    name: 'Tsunami',
    description: 'Gain +2 [[Attack]] at the start of each turn.',
    icon: 'relic_tsunami',
    rarity: RELIC_RARITY.LEGENDARY,
    effects: [
      { trigger: 'onTurnStart', effectType: 'gain_attack', gainAttack: { amount: 2 } },
    ],
  },

  soul_eater: {
    id: 'soul_eater',
    name: 'Soul Eater',
    description: '[[Heal]] <<3>> life whenever you deal [[damage]].',
    icon: 'relic_soul_eater',
    rarity: RELIC_RARITY.LEGENDARY,
    effects: [
      // onDealDamage fires with side = the attacker, so heal restores the owner.
      // Heal scales off BOTH Attack and Magic at the _50 (×1/2 each) preset.
      { trigger: 'onDealDamage', effectType: 'heal', heal: { amount: 3, scaling: { attack: DAMAGE_SCALING_PRESETS._50, magic: DAMAGE_SCALING_PRESETS._50 } } },
    ],
  },

  reckoning: {
    id: 'reckoning',
    name: 'Reckoning',
    description: 'Gain +1 [[Attack]] whenever you take [[damage]].',
    icon: 'relic_reckoning',
    rarity: RELIC_RARITY.LEGENDARY,
    effects: [
      { trigger: 'onTakeDamage', effectType: 'gain_attack', gainAttack: { amount: 1 } },
    ],
  },

  gorepike: {
    id: 'gorepike',
    name: 'Gorepike',
    description: '[[Destroy]] a random row whenever you match 4+ [[tiles]].',
    icon: 'relic_gorepike',
    rarity: RELIC_RARITY.LEGENDARY,
    effects: [
      // Board-touching — augments the in-flight cascade step's analysis with
      // a full random row (handled by BattleController._handlePassiveBoardEffect).
      { trigger: 'onMatch4Plus', effectType: 'destroy_random_row' },
    ],
  },

  deathbringer: {
    id: 'deathbringer',
    name: 'Deathbringer',
    description: '[[Destroy]] up to 2 random [[skulls]] whenever you deal [[damage]].',
    icon: 'relic_deathbringer',
    rarity: RELIC_RARITY.LEGENDARY,
    effects: [
      // Board-touching — queues a deferred skull destruction drained after the
      // current resolution settles (BattleController._maybeStartPendingSkullDestroy).
      { trigger: 'onDealDamage', effectType: 'destroy_random_skulls', destroySkulls: { amount: 2 } },
    ],
  },

  // ── Potions: grant starting mana of a color (one per color) ──────────────
  // One-time mana grant at battle setup via the grant_starting_mana static
  // modifier (aggregated in BattleController._initStaticModifiers, applied
  // before the board is built). Does not fire onGainMana.
  red_potion: {
    id: 'red_potion',
    name: 'Red Potion',
    description: 'Gain 5 red [[mana]] at the start of battle.',
    icon: 'relic_potion_red',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'red', amount: 5 } },
    ],
  },

  blue_potion: {
    id: 'blue_potion',
    name: 'Blue Potion',
    description: 'Gain 5 blue [[mana]] at the start of battle.',
    icon: 'relic_potion_blue',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'blue', amount: 5 } },
    ],
  },

  green_potion: {
    id: 'green_potion',
    name: 'Green Potion',
    description: 'Gain 5 green [[mana]] at the start of battle.',
    icon: 'relic_potion_green',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'green', amount: 5 } },
    ],
  },

  yellow_potion: {
    id: 'yellow_potion',
    name: 'Yellow Potion',
    description: 'Gain 5 yellow [[mana]] at the start of battle.',
    icon: 'relic_potion_yellow',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'yellow', amount: 5 } },
    ],
  },

  purple_potion: {
    id: 'purple_potion',
    name: 'Purple Potion',
    description: 'Gain 5 purple [[mana]] at the start of battle.',
    icon: 'relic_potion_purple',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onBattleStart', effectType: 'grant_starting_mana', startingMana: { color: 'purple', amount: 5 } },
    ],
  },

  // ── Mana-gain reactors: deal 1 damage when you gain a color (one per color) ─
  // Each reacts to the onGainMana trigger gated by color (PassiveSystem's
  // condition.color). Fires once per color per gain event from cascade/skill
  // mana (not from starting mana or relic-granted bonus mana).
  flaming_arrow: {
    id: 'flaming_arrow',
    name: 'Flaming Arrow',
    description: 'Deal <<1>> [[mag]] whenever you gain red [[mana]].',
    icon: 'relic_flaming_arrow',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onGainMana', condition: { color: 'red' }, effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  water_balloon: {
    id: 'water_balloon',
    name: 'Water Balloon',
    description: 'Deal <<1>> [[mag]] whenever you gain blue [[mana]].',
    icon: 'relic_water_balloon',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onGainMana', condition: { color: 'blue' }, effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  thorned_branch: {
    id: 'thorned_branch',
    name: 'Thorned Branch',
    description: 'Deal <<1>> [[mag]] whenever you gain green [[mana]].',
    icon: 'relic_thorned_branch',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onGainMana', condition: { color: 'green' }, effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  static_comb: {
    id: 'static_comb',
    name: 'Static Comb',
    description: 'Deal <<1>> [[mag]] whenever you gain yellow [[mana]].',
    icon: 'relic_static_comb',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onGainMana', condition: { color: 'yellow' }, effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  tuning_rod: {
    id: 'tuning_rod',
    name: 'Tuning Rod',
    description: 'Deal <<1>> [[mag]] whenever you gain purple [[mana]].',
    icon: 'relic_tuning_fork',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onGainMana', condition: { color: 'purple' }, effectType: 'damage', damage: { amount: 1, scaling: { magic: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  // ── Familiars: gain +1 mana of a color on any 3+ match (one per color) ────
  // React to onTileMatchType (fires per individual match, all of which are
  // 3+ tiles) and grant +1 mana of the relic's color via EffectResolver's
  // gain_mana. The granted color is fixed regardless of the matched color.
  familiar_red: {
    id: 'familiar_red',
    name: 'Fire Familiar',
    description: 'Gain 1 red [[mana]] whenever you [[match]] 3 or more [[tiles]].',
    icon: 'relic_familiar_red',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTileMatchType', condition: { minCount: 3 }, effectType: 'gain_mana', gainMana: { color: 'red', amount: 1 } },
    ],
  },

  familiar_blue: {
    id: 'familiar_blue',
    name: 'Water Familiar',
    description: 'Gain 1 blue [[mana]] whenever you [[match]] 3 or more [[tiles]].',
    icon: 'relic_familiar_blue',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTileMatchType', condition: { minCount: 3 }, effectType: 'gain_mana', gainMana: { color: 'blue', amount: 1 } },
    ],
  },

  familiar_green: {
    id: 'familiar_green',
    name: 'Earth Familiar',
    description: 'Gain 1 green [[mana]] whenever you match 3 or more [[tiles]].',
    icon: 'relic_familiar_green',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTileMatchType', condition: { minCount: 3 }, effectType: 'gain_mana', gainMana: { color: 'green', amount: 1 } },
    ],
  },

  familiar_yellow: {
    id: 'familiar_yellow',
    name: 'Energy Familiar',
    description: 'Gain 1 yellow [[mana]] whenever you [[match]] 3 or more [[tiles]].',
    icon: 'relic_familiar_yellow',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTileMatchType', condition: { minCount: 3 }, effectType: 'gain_mana', gainMana: { color: 'yellow', amount: 1 } },
    ],
  },

  familiar_purple: {
    id: 'familiar_purple',
    name: 'Arcane Familiar',
    description: 'Gain 1 purple [[mana]] whenever you match 3 or more [[tiles]].',
    icon: 'relic_familiar_purple',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      { trigger: 'onTileMatchType', condition: { minCount: 3 }, effectType: 'gain_mana', gainMana: { color: 'purple', amount: 1 } },
    ],
  },

  // ── Standalone relics (turn-start damage / skull destruction) ────────────
  slingshot: {
    id: 'slingshot',
    name: 'Slingshot',
    description: 'Deal <<1>> [[phys]] at the start of your turn.',
    icon: 'relic_slingshot',
    rarity: RELIC_RARITY.COMMON,
    effects: [
      { trigger: 'onTurnStart', effectType: 'damage', damage: { amount: 1, scaling: { attack: DAMAGE_SCALE_PER_POINT } } },
    ],
  },

  death_familiar: {
    id: 'death_familiar',
    name: 'Death Familiar',
    description: '[[Destroy]] a random [[skull]] whenever you [[match]] 4 or more [[tiles]].',
    icon: 'relic_familiar_skull',
    rarity: RELIC_RARITY.UNCOMMON,
    effects: [
      // Board-touching — queues a deferred skull destruction (same path as
      // Deathbringer) but on a match trigger; bypasses the once-per-action
      // recursion guard so it can fire per qualifying match.
      { trigger: 'onTileMatchType', condition: { minCount: 4 }, effectType: 'destroy_random_skulls', destroySkulls: { amount: 1 } },
    ],
  },
};

/**
 * Look up a relic by ID.
 * Returns null and warns if not found.
 * @param {string} id
 * @returns {object|null}
 */
export function getRelicById(id) {
  const relic = RELIC_CATALOG[id];
  if (!relic) {
    console.warn(`[relicCatalog] Unknown relic id: "${id}".`);
    return null;
  }
  return relic;
}

/**
 * Resolve an array of relic IDs into full relic objects (shallow-cloned
 * so callers cannot accidentally mutate the catalog; effects array is
 * also cloned).
 *
 * Unknown IDs are skipped with a console warning.
 * @param {string[]} ids
 * @returns {object[]}
 */
export function resolveRelicIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const relic = getRelicById(id);
    if (relic) {
      out.push({
        ...relic,
        effects: (relic.effects || []).map(e => ({ ...e })),
      });
    }
  }
  return out;
}

export default RELIC_CATALOG;
