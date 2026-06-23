/**
 * skillSynthesizer.js — turns a woven tag bag into a concrete, castable skill.
 *
 * Called once by SkillWeaveScene._finishWeave with the player's committed tag
 * recipe (2–4 unique tag ids). Emits a REAL skill object shaped exactly like a
 * skillCatalog.js entry ({ id, name, description, icon, sound, cost,
 * targeting?, area?, effects[] }) — the icon asset key is filled in by the
 * scene (procedural spell icons, §4.8); everything else is decided here.
 *
 * ── Reading grammar ──────────────────────────────────────────────────────────
 * The recipe reads as a sentence and the sentence IS the spell — structure is
 * resolved DETERMINISTICALLY from the tags (RNG only sets magnitudes + cost).
 * Binding is ORDER-TOLERANT: a verb binds to the tile-types/shapes present
 * wherever they sit (`convert red yellow` ≡ `red convert yellow`); only
 * conversion DIRECTION uses relative type order.
 *   - TILE TYPES = the 5 colors + `skull` + `wild`. Consumed by tile-verbs
 *     (create/convert/change); a color used by no verb is "dangling" → it only
 *     pays the COST; `wild`/`skull` can't be cost, so their floor is "create"
 *     (they never fizzle).
 *   - convert (MASS by-type) / change (TARGETED single) read "… → destination",
 *     where the LAST woven type is the destination and the preceding one the
 *     source (rolled at synthesis if absent). `change + all` → mass convert; a
 *     `tile`/`area` shape on convert → targeted; `area` on change → 3×3.
 *   - destroy/explode + shape → shaped targeted destruction (`+tile` = one tile
 *     for a cascade). `skull + destroy` (no shape) → destroy N Skulls;
 *     `destroy + all + <color>` → board-wide color wipe.
 *   - `skull + damage` → damage ALSO scales per Skull on the board.
 *   - `all` boosts `create`'s count; STATUS tags → apply_status (buff→self,
 *     debuff→opponent); `extra_turn` appends LAST (decision #4); `random` pulls
 *     a bonus from the non-color pool (never wasted).
 *
 * ── Choice-driven downsides (NO injection) ───────────────────────────────────
 * Only genuine contradictions DETERMINISTICALLY contribute nothing (pure
 * opportunity cost), reported in `wastedReasons` (tag id → reason) and surfaced
 * on the result screen so a weak weave reads as "I could have picked better":
 *   - an orphan shape (no verb used it)  → "no action used this shape"
 *   - a 2nd targeted action              → "only one targeted effect"
 *   - `all` with nothing to amplify      → "no Change/Destroy/Create to amplify"
 *   - a color no effect/cost could use   → "no effect or cost used this color"
 * The old "weave surges" injection (which rescued mistakes with free effects
 * and silently inflated power) is GONE — `injectedTags` is retained but stays
 * empty.
 *
 * ── RNG / cost ───────────────────────────────────────────────────────────────
 * Magnitudes are HIDDEN per-tag rolls from weaveConfig.TAG_VALUE_TABLES (e.g.
 * create rolls 3–12). The TOTAL mana cost is CONTINUOUS in the spell's POWER —
 * weaveConfig.computeManaCostTotal ≈ clamp(round(power / K)), calibrated against
 * the authored catalog so woven spells share their power-per-mana band. The
 * total is SPLIT across the woven element colors in PICK ORDER (the first
 * element pays the most — see buildCost), so multi-element spells are genuinely
 * harder to fund and color order matters; a bag with no element tag falls back
 * to the weighted COST_COLOR_WEIGHTS roll. Rolls happen once, here.
 *
 * Power weights / name tables / cost-color affinities are the tunable
 * constants below; all probability tables live in weaveConfig.js.
 */

import {
  rollTagValue,
  computeManaCostTotal,
  pickWeightedEntry,
  COST_COLOR_WEIGHTS,
  MANA_COST_CONFIG,
  rollDamageScalingPreset,
  DAMAGE_SCALING_POWER,
  DAMAGE_COLOR_SKEW,
  GREATER_CONFIG,
  COST_AFFINITY_SUBSIDY,
} from './weaveConfig.js';
import { DAMAGE_SCALING_PRESETS, DAMAGE_SCALE_PER_POINT } from './scalingConfig.js';
import { SKILL_WEAVE_TAGS, getTag, getTagLabel, TAG_CATEGORY } from './skillWeaveTags.js';

// ═══════════════════════════════════════════════════════════
// Tunables
// ═══════════════════════════════════════════════════════════

/** Weave tag id → statusEffects.js catalog id. */
const STATUS_TAG_TO_ID = Object.freeze({
  silence: 'silenced',
  cripple: 'crippled',
  enfeeble: 'enfeebled',
  brittle: 'brittle',
  bleed: 'bleeding',
  frozen: 'frozen',
  intangible: 'intangible',
  berserk: 'berserk',
  // NOTE: `barrier` is NOT here — it's no longer a status. It's an ACTION that
  // emits a `barrier` shield effect (see emitBarrier / the action switch).
});

/** Status tags that BUFF the caster (apply_status target 'self'). */
const SELF_STATUS_TAGS = new Set(['intangible', 'berserk']);

/** The five mana colors a cost may be paid in (skull is never a cost). */
const COST_COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple']);

/**
 * The `random` tag draws its bonus from EVERY non-color tag (actions, shapes,
 * modifiers, statuses — everything except elements and `random` itself). See
 * synthesize() `emitRandomBonus`.
 */
const NON_COLOR_BONUS_TAGS = Object.freeze(
  Object.values(SKILL_WEAVE_TAGS)
    // `greater` is a qualifier (no standalone effect), so it's never a `random` bonus.
    .filter((t) => t.category !== TAG_CATEGORY.ELEMENT && t.id !== 'random' && t.id !== 'greater')
    .map((t) => t.id),
);

/** The two damage tags (each rolls a scaling multiplier on its stat). */
const DAMAGE_TAGS = Object.freeze(['strike', 'blast']);
/** Damage tag → the stat its rolled scaling multiplier applies to. */
const DAMAGE_TAG_STAT = Object.freeze({ strike: 'attack', blast: 'magic' });
/** Damage tag → the inline keyword used in the description ("Deal <<n>> [[mag]]"). */
const DAMAGE_TAG_KEYWORD = Object.freeze({ strike: '[[phys]]', blast: '[[mag]]' });

/** Multiplier applied to woven poison's rolled magic-scaling preset. Poison's
 *  halving decay ≈ doubles each stack's lifetime value, so we HALVE the scaling
 *  rate to keep its effective scaling in line with direct damage. See decision #39. */
const POISON_SCALING_FACTOR = 0.5;

/**
 * Primary action → curated SYNERGY pool for the `greater` surge (one is rolled
 * and emitted as a bonus when Greater surges). Falls back to the generic
 * non-color bonus pool for actions not listed.
 */
const SYNERGY_BY_ACTION = Object.freeze({
  strike:   ['attack', 'bleed', 'extra_turn'],
  blast:    ['extra_turn', 'brittle', 'drain'],
  poison:   ['bleed', 'enfeeble', 'blast'],
  create:   ['wild', 'extra_turn'],
  armor:    ['barrier', 'heal'],
  barrier:  ['armor', 'heal'],
  heal:     ['armor', 'extra_turn'],
  destroy:  ['extra_turn', 'strike'],
  explode:  ['extra_turn', 'blast'],
  convert:  ['extra_turn', 'create'],
  change:   ['create', 'extra_turn'],
  drain:    ['enfeeble', 'blast'],
  attack:   ['strike', 'extra_turn'],
  magic:    ['blast', 'extra_turn'],
});

/** Primary action → cost-color AFFINITY (a weight, not a rule — see
 *  COST_COLOR_WEIGHTS in weaveConfig). */
// NOTE: the two damage tags (strike/blast) use the gradient DAMAGE_COLOR_SKEW
// (weaveConfig) in rollCostColor instead of a single affinity color.
const ACTION_COST_AFFINITY = Object.freeze({
  attack: 'blue', magic: 'purple', explode: 'red', destroy: 'red',
  armor: 'blue', heal: 'green', create: 'green',
  convert: 'purple', change: 'purple', drain: 'purple', shuffle: 'yellow',
  // Poison's preferred cost color is GREEN (the rot/attrition color).
  poison: 'green',
});

// ── Generic SFX pool (sfx_audio_generic_sprite — see SoundConfig.js) ──
// A synthesized skill picks ONE clip from this authored pool at creation time
// (here, once) and reuses it for the rest of the run. The clip is chosen by the
// skill's PRIMARY action (the "most relevant effect"); families with multiple
// authored versions pick one at random; color-aware families (damage/create)
// pick the relevant tile color. Every action maps to a generic clip (directly or
// via GENERIC_SOUND_FALLBACK_BY_ACTION), so a woven spell is never silent.

/** SoundConfig key prefix for the generic pool clips. */
const GENERIC_SOUND_PREFIX = 'sfx_generic_';
/** Colors with authored `damage_<color>` clips. */
const GENERIC_DAMAGE_COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple']);
/** Tile flavors with authored `create_<flavor>` clips. */
const GENERIC_CREATE_FLAVORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'skull', 'wild']);
/**
 * Primary action → generic-sound descriptor.
 *   family   — clip family stem (`<family>[_<color>]_<version>`)
 *   versions — number of authored versions (a random one is rolled)
 *   colored  — pick a `damage_<color>` clip from the cost color
 *   create   — pick a `create_<flavor>` clip from the created tile type
 * Actions whose own family isn't in the generic pool (heal/attack/magic/drain/
 * shuffle) are voiced by their closest-fitting family via
 * GENERIC_SOUND_FALLBACK_BY_ACTION, so EVERY woven spell still gets a generic clip.
 */
const GENERIC_SOUND_BY_ACTION = Object.freeze({
  strike:  { family: 'damage', versions: 3, colored: true },
  blast:   { family: 'damage', versions: 3, colored: true },
  damage:  { family: 'damage',  versions: 3, colored: true },
  explode: { family: 'destroy', versions: 5 },
  destroy: { family: 'destroy', versions: 5 },
  armor:   { family: 'armor',   versions: 2 },
  barrier: { family: 'barrier', versions: 1 },
  convert: { family: 'convert', versions: 3 },
  change:  { family: 'change',  versions: 3 },
  create:  { family: 'create',  versions: 2, create: true },
});

/**
 * Closest-fitting generic family for actions that have NO dedicated clip family
 * of their own. Used as a SECOND pass in pickSkillSound so a spell built purely
 * from these (e.g. a heal, a stat-buff, a drain, a shuffle) still draws a sound
 * from the generic pool instead of an old `skill_*` clip (the "defaults to
 * encroach" bug) or silence.
 */
const GENERIC_SOUND_FALLBACK_BY_ACTION = Object.freeze({
  heal:    { family: 'armor',   versions: 2 },               // supportive/defensive feel
  attack:  { family: 'armor',   versions: 2 },               // self-buff
  magic:   { family: 'change',  versions: 3 },               // arcane shimmer
  drain:   { family: 'damage',  versions: 3, colored: true }, // siphon ≈ damage
  shuffle: { family: 'convert', versions: 3 },               // board transformation
  poison:  { family: 'damage',  versions: 3, colored: true }, // venom ≈ damage (green cost color)
});

/** Last-resort generic family when a bag has no action that maps to any of the
 *  above — guarantees a generic-pool clip rather than silence. */
const GENERIC_SOUND_DEFAULT = Object.freeze({ family: 'damage', versions: 3, colored: true });

/**
 * Power-score weights — how much each emitted effect contributes to the
 * spell's POWER (which drives the mana-cost tier via MANA_COST_CONFIG).
 */
const POWER = Object.freeze({
  perDamage: 0.5,
  perArmor: 0.4,
  perHeal: 0.3,
  perManaGained: 0.5,
  perManaDrainedOneColor: 1,
  perManaDrainedAllColors: 1.5,
  perAttack: 1,          // permanent for the battle
  perMagic: 1,           // permanent for the battle (counterpart to perAttack)
  perTileCreated: 1.5,
  thrallTileMult: 1.5,   // wild tiles are worth more per tile
  destroyTile: 2,        // single-tile snipe
  destroyRow: 6,
  destroyColumn: 6,
  destroyArea: 9,        // 3×3
  destroyAreaWide: 14,   // 5×5 (explode + area)
  // Mass / area conversions into ONE color near-guarantee a 5+ match (→ free
  // extra turn) AND dump a flood of that color's mana — priced high so they cost
  // a lot (and, paired with the no-same-color-cost rule, can't self-fund a loop).
  convertByType: 8,     // all of one color → another (board-wide flood)
  convertTile: 3,        // targeted single tile
  convertArea: 16,       // targeted 3×3 (9 tiles → one color = guaranteed big match)
  perDebuffTurn: 3,
  perBuffTurn: 3,
  extraTurn: 8,
  shuffleBoard: 10,       // whole-board reshuffle (always paired with an extra turn)
  perPoisonStack: 2.0,    // `apply N poison`: each stack ≈ 2× damage over the halving decay tail — priced for the real value
  perSkullDamage: 0.5,    // `skull + damage`: weight per "+N per Skull" (× est. skulls)
  destroySkull: 2,        // `skull + destroy`: weight per Skull tile destroyed
  destroyByColor: 9,      // `destroy + all + color`: board-wide color wipe
});

/**
 * Canonical RESOLUTION + DESCRIPTION order for a woven skill's effects. The
 * battle engine resolves a skill's `effects` array top-to-bottom and the card
 * renders `descriptionLines` in that same order — but the synthesizer EMITS in
 * TAG PICK order, so a recipe could otherwise read (and resolve) in a jumbled
 * sequence. Before assembling the skill we sort the emitted effects AND their
 * paired description lines into this fixed order, so every woven spell resolves
 * and READS the same sensible way: board-shaping first (shuffle → create →
 * convert → destroy), then damage, then defense/heal, then stat / mana / status
 * riders. `extra_turn` stays LAST — decision #4: it must follow any create_tiles
 * whose cascade resets the extra-turn flag. Lower number = earlier; effect types
 * not listed here sort just before extra_turn (EFFECT_ORDER_DEFAULT), preserving
 * their relative order. The description line for an effect is reordered in
 * lockstep, so what the player reads is exactly what resolves.
 */
const EFFECT_RESOLUTION_ORDER = Object.freeze({
  shuffle: 10,
  create_tiles: 20,
  convert_tiles_by_type: 30,
  convert_tile: 35,
  destroy_tiles_row: 40,
  destroy_tiles_column: 41,
  destroy_tiles: 42,
  destroy_tiles_by_type: 45,
  damage: 50,
  apply_poison: 52,
  gain_max_hp: 58,
  heal: 60,
  armor: 65,
  barrier: 68,
  gain_attack: 70,
  gain_magic: 72,
  drain_mana: 80,
  gain_mana: 82,
  apply_status: 90,
  extra_turn: 1000,
});
/** Sort key for an effect type absent from EFFECT_RESOLUTION_ORDER (lands just
 *  before extra_turn, after every classified effect). */
const EFFECT_ORDER_DEFAULT = 500;

/** Tile types a tile-verb (create/convert/change) can operate on — the 5 mana
 *  colors + skull + wild. Membership-based so synthesis is order-tolerant and
 *  independent of TAG_CATEGORY (wild/skull read as types here). */
const TILE_TYPE_IDS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'skull', 'wild']);
/** Targeting shapes a destroy/convert verb can consume. */
const SHAPE_IDS = Object.freeze(['row', 'column', 'area', 'tile']);
/** Assumed Skull count for power-weighting `skull + damage` (board varies). */
const EST_SKULLS_ON_BOARD = 4;

// ── Name generation pools ──
// Plenty of variety on purpose: adjectives per element × nouns per action ×
// suffixes per tag × patterns. Extend freely — names are pure flavor.

/** Element tag → name adjectives (one is picked at random). */
const ELEMENT_ADJ = Object.freeze({
  red: [
    'Crimson', 'Scarlet', 'Searing', 'Ember', 'Blood-Forged', 'Cindering', 'Pyric',
    'Molten', 'Infernal', 'Smoldering', 'Volcanic', 'Hellfire', 'Charred', 'Burning',
    'Magma', 'Ashen', 'Blazing', 'Furnace', 'Sanguine', 'Roaring', 'Kindled', 'Embered',
  ],
  blue: [
    'Tidal', 'Azure', 'Abyssal', 'Frost-Wreathed', 'Drowned', 'Riptide', 'Mistbound',
    'Glacial', 'Oceanic', 'Frozen', 'Briny', 'Tempest', 'Sapphire', 'Deepwater',
    'Hailborn', 'Cerulean', 'Surging', 'Tidewrought', 'Cresting', 'Frigid', 'Stormfed',
  ],
  green: [
    'Verdant', 'Thorned', 'Wildgrown', 'Briar', 'Sporebound', 'Evergreen', 'Rooted',
    'Venomous', 'Mossgrown', 'Bramblewood', 'Toxic', 'Feral', 'Overgrown', 'Sylvan',
    'Bloomtouched', 'Blighted', 'Creeping', 'Vinewrought', 'Wildwood', 'Festering',
  ],
  yellow: [
    'Storm-Called', 'Gilded', 'Radiant', 'Thundering', 'Sunforged', 'Static', 'Dazzling',
    'Voltaic', 'Golden', 'Solar', 'Blinding', 'Galvanic', 'Brilliant', 'Stormlit',
    'Levin', 'Searing', 'Arcing', 'Sparking', 'Sunbright', 'Skyborn', 'Fulgent',
  ],
  purple: [
    'Umbral', 'Void-Touched', 'Eldritch', 'Duskwoven', 'Starless', 'Occult', 'Whispering',
    'Shadowed', 'Arcane', 'Nightbound', 'Hexen', 'Spectral', 'Twilight', 'Forbidden',
    'Maddening', 'Witchwoven', 'Gloaming', 'Cursed', 'Phantasmal', 'Unhallowed', 'Veiled',
  ],
  skull: [
    'Deathly', 'Grave-Born', 'Skeletal', 'Dread', 'Charnel', 'Tombward', 'Mortal',
    'Necrotic', 'Sepulchral', 'Ghastly', 'Cadaverous', 'Wraithlike', 'Bonewrought',
    'Funereal', 'Plagued', 'Withered', 'Rotbound', 'Ossuary', 'Lichborn', 'Hollowed',
  ],
});

/** Shared damage-family noun pool (used by both strike + blast tags). */
const DAMAGE_NOUNS = Object.freeze([
  'Strike', 'Lash', 'Rend', 'Reckoning', 'Scourge', 'Sundering', 'Spike', 'Verdict',
  'Smite', 'Onslaught', 'Lance', 'Wrath', 'Cleave', 'Havoc', 'Punishment', 'Blow',
  'Laceration', 'Maul', 'Skewer', 'Judgment', 'Impalement', 'Carnage',
]);

/** Primary action → name noun candidates. */
const ACTION_NOUNS = Object.freeze({
  strike: DAMAGE_NOUNS,
  blast: DAMAGE_NOUNS,
  damage: DAMAGE_NOUNS,
  poison: [
    'Venom', 'Blight', 'Plague', 'Toxin', 'Rot', 'Contagion', 'Pestilence', 'Miasma',
    'Corruption', 'Affliction', 'Sickness', 'Decay', 'Bane', 'Virulence', 'Murk',
    'Festering', 'Putrescence', 'Canker', 'Taint', 'Envenoming',
  ],
  armor: [
    'Bulwark', 'Aegis', 'Ward', 'Carapace', 'Rampart', 'Shell', 'Vigil', 'Bastion',
    'Mantle', 'Fortress', 'Redoubt', 'Guardian', 'Palisade', 'Barricade', 'Aegida',
    'Buttress', 'Sanctuary', 'Embrace', 'Phalanx',
  ],
  // Barrier is a MAGIC shield — lean arcane/ethereal vs armor's martial nouns.
  barrier: [
    'Barrier', 'Ward', 'Aegis', 'Veil', 'Bubble', 'Membrane', 'Bastion', 'Mantle',
    'Shroud', 'Sphere', 'Bulwark', 'Sanctuary', 'Aura', 'Halo', 'Nimbus',
  ],
  heal: [
    'Mending', 'Renewal', 'Restoration', 'Blessing', 'Salve', 'Communion', 'Respite',
    'Solace', 'Rebirth', 'Grace', 'Reprieve', 'Recovery', 'Benediction', 'Suture',
    'Balm', 'Convalescence', 'Tonic', 'Mercy',
  ],
  create: [
    'Genesis', 'Wellspring', 'Conjuring', 'Blooming', 'Summons', 'Manifest', 'Seeding',
    'Spawning', 'Bloom', 'Emergence', 'Birthing', 'Yield', 'Outgrowth', 'Flourishing',
    'Quickening', 'Begetting', 'Calling',
  ],
  destroy: [
    'Ruin', 'Shatter', 'Unmaking', 'Collapse', 'Erasure', 'Demolition', 'Cull',
    'Annihilation', 'Obliteration', 'Wreckage', 'Razing', 'Devastation', 'Breaking',
    'Doom', 'Undoing', 'Pulverization', 'Rending',
  ],
  convert: [
    'Transmutation', 'Alchemy', 'Reshaping', 'Inversion', 'Metamorphosis', 'Refrain',
    'Transfiguration', 'Rebinding', 'Permutation', 'Recasting', 'Conversion', 'Shift',
    'Reforging', 'Sublimation', 'Reweaving',
  ],
  change: [
    'Inscription', 'Glyph', 'Sigil', 'Mark', 'Rune', 'Reshaping', 'Etching',
    'Inscribing', 'Brand', 'Imprint', 'Tracing', 'Scribing', 'Cipher', 'Seal',
  ],
  drain: [
    'Siphon', 'Leeching', 'Hunger', 'Theft', 'Tithe', 'Parch', 'Drought',
    'Withering', 'Sapping', 'Devouring', 'Famine', 'Atrophy', 'Consumption',
    'Draining', 'Sustenance', 'Glutton',
  ],
  attack: [
    'Ferocity', 'Whetstone', 'Bloodlust', 'Warcry', 'Honing', 'Frenzy', 'Edge',
    'Savagery', 'Bloodrage', 'Fury', 'Sharpening', 'Onset', 'Vigor', 'Bloodthirst',
    'Rampage', 'Berserking', 'Goad',
  ],
  // Magic is the arcane counterpart to attack — lean intellect/eldritch nouns.
  magic: [
    'Insight', 'Attunement', 'Ascendance', 'Epiphany', 'Acumen', 'Clarity', 'Focus',
    'Awakening', 'Empowerment', 'Channeling', 'Mastery', 'Genius', 'Enlightenment',
    'Resonance', 'Ascension', 'Communion', 'Potency', 'Sagacity',
  ],
  explode: [
    'Cataclysm', 'Detonation', 'Conflagration', 'Starburst', 'Eruption', 'Concussion',
    'Blast', 'Implosion', 'Firestorm', 'Rupture', 'Combustion', 'Shockwave', 'Nova',
    'Burst', 'Fulmination', 'Discharge',
  ],
  shuffle: [
    'Upheaval', 'Maelstrom', 'Tumult', 'Churn', 'Disorder', 'Reshuffle', 'Cataclysm',
    'Pandemonium', 'Vortex', 'Whirl', 'Turmoil', 'Scramble', 'Chaos', 'Cascade',
    'Convulsion', 'Riot',
  ],
});
const DEFAULT_NOUNS = Object.freeze([
  'Weaving', 'Working', 'Rite', 'Invocation', 'Sigil', 'Incantation', 'Hex', 'Charm',
  'Spell', 'Conjuration', 'Glyph', 'Enchantment', 'Casting', 'Ritual', 'Augury', 'Cantrip',
]);

/**
 * Any bag tag → optional name suffixes ("Strike of Winter"). Kept SHORT and
 * "the"-free on purpose — names must fit NAME_MAX_LENGTH (~20 chars of UI
 * space on the skill button).
 */
const TAG_SUFFIXES = Object.freeze({
  // Elements — so even a plain element+action bag can earn an evocative suffix.
  red:        ['of Cinders', 'of Flame', 'of Ash', 'of Embers'],
  blue:       ['of Tides', 'of Frost', 'of the Deep', 'of Brine'],
  green:      ['of Thorns', 'of Blight', 'of the Wild', 'of Spores'],
  yellow:     ['of Storms', 'of Thunder', 'of Light', 'of the Sun'],
  purple:     ['of Shadows', 'of the Void', 'of Whispers', 'of Dusk'],
  skull:      ['of Graves', 'of Bone', 'of the Dead', 'of Rot'],
  // Actions.
  strike:     ['of Wrath', 'Unleashed', 'of Ruin'],
  blast:      ['of Power', 'Arcane', 'of the Arcane'],
  damage:     ['of Wrath', 'Unleashed', 'of Ruin'],
  poison:     ['of Rot', 'Festering', 'of Blight', 'of Venom'],
  armor:      ['of Wardens', 'Enduring', 'of Vigil'],
  heal:       ['of Mercy', 'Restoring', 'of Grace'],
  create:     ['of Genesis', 'Unfolding', 'of Seeds'],
  destroy:    ['of Ruin', 'Undone', 'of Collapse'],
  convert:    ['of Change', 'Shifting', 'of Flux'],
  change:     ['of Marks', 'Inscribed', 'of Runes'],
  drain:      ['of Hunger', 'Withering', 'of Famine'],
  attack:     ['of Fury', 'Rising', 'of Bloodlust'],
  magic:      ['of Power', 'Ascendant', 'of the Arcane'],
  explode:    ['of Cataclysm', 'Bursting', 'of the Blast'],
  // Modifiers / shapes / statuses.
  greater:    ['Greater', 'Empowered', 'of Might'],
  extra_turn: ['of Haste', 'of Tempo', 'Quickening'],
  wild:       ['Unbound', 'of Chaos', 'of the Wyld'],
  shuffle:    ['of Chaos', 'Scattering', 'of Upheaval'],
  row:        ['of Lines', 'Sweeping', 'of the Row'],
  column:     ['of Pillars', 'Falling', 'of the Spire'],
  area:       ['of Storms', 'Vast', 'of the Maw'],
  random:     ['of Fortune', 'of Dice', 'of Whim'],
  tile:       ['of Marks', 'Precise', 'of the Sigil'],
  silence:    ['of Hush', 'Muting', 'of Silence'],
  cripple:    ['of Maiming', 'Laming', 'of the Cripple'],
  enfeeble:   ['of Frailty', 'Sapping', 'of Weakness'],
  brittle:    ['of Glass', 'Cracking', 'of Shards'],
  bleed:      ['of Wounds', 'Rending', 'of Bloodletting'],
  frozen:     ['of Winter', 'of Frost', 'of the Glacier'],
  intangible: ['of Mist', 'Phantom', 'of Phantoms'],
  berserk:    ['of Fury', 'Raging', 'of the Berserker'],
  barrier:    ['of Shells', 'Warding', 'of Bulwarks'],
});

/**
 * Name pattern → relative weight (patterns needing a missing part are
 * skipped; candidates longer than NAME_MAX_LENGTH are rerolled).
 */
const NAME_PATTERN_WEIGHTS = Object.freeze({
  adj_noun: 45,        // "Crimson Strike"
  adj_noun_suffix: 15, // "Ember Lash of Frost"
  noun_suffix: 25,     // "Strike of Winter"
  plain_noun: 10,      // "Reckoning"
});

/** Hard cap on generated name length (skill-button space budget). */
const NAME_MAX_LENGTH = 38;
/** How many random candidates to try before falling back to the bare noun.
 *  Higher now that the pools are large + suffixes are common, so a longer combo
 *  that overflows NAME_MAX_LENGTH gets re-rolled into a fitting one more often. */
const NAME_ATTEMPTS = 18;

/** Display names for tile types in descriptions. */
const TILE_LABEL = Object.freeze({
  red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow', purple: 'Purple',
});

// ═══════════════════════════════════════════════════════════
// Internals
// ═══════════════════════════════════════════════════════════

/**
 * Group an ordered list of tag ids by their catalog category.
 * @param {string[]} tagIds
 * @returns {Object<string, string[]>} category → tag ids (in pick order)
 */
function groupByCategory(tagIds) {
  const groups = {
    [TAG_CATEGORY.ACTION]: [],
    [TAG_CATEGORY.ELEMENT]: [],
    [TAG_CATEGORY.SHAPE]: [],
    [TAG_CATEGORY.MODIFIER]: [],
    [TAG_CATEGORY.STATUS]: [],
  };
  for (const id of tagIds) {
    const tag = getTag(id);
    if (tag && groups[tag.category]) groups[tag.category].push(id);
  }
  return groups;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Roll a 1..n version number (for the multi-version generic SFX clips). */
function rollVersion(n) {
  return 1 + Math.floor(Math.random() * Math.max(1, n));
}

/**
 * Build a concrete generic-pool SoundConfig key for one action descriptor:
 * resolves the color/create flavor and rolls a random version.
 * @param {object} desc — a GENERIC_SOUND_BY_ACTION entry
 * @param {object[]} effects — the emitted effect list (for the create flavor)
 * @param {string} costColor — the rolled cost color (damage clip color)
 * @returns {string} a `sfx_generic_*` SoundConfig key
 */
function buildGenericSound(desc, effects, costColor) {
  let stem = desc.family;
  if (desc.colored) {
    const color = GENERIC_DAMAGE_COLORS.includes(costColor) ? costColor : pickRandom(GENERIC_DAMAGE_COLORS);
    stem = `${desc.family}_${color}`;
  } else if (desc.create) {
    const createEff = effects.find((e) => e.effectType === 'create_tiles');
    let flavor = createEff && createEff.createTiles ? createEff.createTiles.type : null;
    if (flavor === 'thrall') flavor = 'wild'; // Thrall is the enemy-flavored wild
    if (!GENERIC_CREATE_FLAVORS.includes(flavor)) {
      flavor = GENERIC_CREATE_FLAVORS.includes(costColor) ? costColor : 'red';
    }
    stem = `${desc.family}_${flavor}`;
  }
  return `${GENERIC_SOUND_PREFIX}${stem}_${rollVersion(desc.versions)}`;
}

/**
 * Choose the resolve SFX for a synthesized skill — preferring the generic SFX
 * pool (sfx_audio_generic_sprite), with a random version, so the spell's "most
 * relevant effect" is voiced. The bag's ACTIONS are walked in pick order and
 * the FIRST one that has a generic clip wins — so a multi-action spell whose
 * PRIMARY action has no generic clip (e.g. `attack`, which voiced an old
 * `skill_encroach` before) still draws from the generic pool via its other
 * actions (damage / create / …). Color-aware families pick the relevant tile
 * color (damage → cost color; create → the created tile flavor). Actions whose
 * own family isn't in the pool (heal/attack/magic/drain/shuffle) fall back to a
 * closest-fitting generic family, and a bag with no usable action at all falls
 * back to the generic default — so EVERY woven spell gets a generic-pool clip
 * (never silence or an old `skill_*` sound). Called ONCE here, so the chosen
 * clip persists for the rest of the run.
 *
 * @param {string[]} actions — the spell's action tags, in pick order
 * @param {object[]} effects — the emitted effect list (for the create flavor)
 * @param {string} costColor — the rolled cost color (damage clip color)
 * @returns {string} a SoundConfig key (always a `sfx_generic_*` clip)
 */
function pickSkillSound(actions, effects, costColor) {
  const list = Array.isArray(actions) ? actions : [];
  // 1) Prefer an action with its own dedicated generic family.
  for (const action of list) {
    const desc = GENERIC_SOUND_BY_ACTION[action];
    if (desc) return buildGenericSound(desc, effects, costColor);
  }
  // 2) Else voice the first action that maps to a closest-fitting family.
  for (const action of list) {
    const desc = GENERIC_SOUND_FALLBACK_BY_ACTION[action];
    if (desc) return buildGenericSound(desc, effects, costColor);
  }
  // 3) No usable action — still draw SOMETHING from the generic pool.
  return buildGenericSound(GENERIC_SOUND_DEFAULT, effects, costColor);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Weighted cost-color roll: every color gets a baseline weight; bag elements
 * and the primary action's affinity ADD weight (influence, not a hard rule).
 * Only used as the FALLBACK when a bag has no cost-eligible element tag (a
 * multi-element bag's cost colors are deterministic — see buildCost).
 * `excludeColors` (loop-risk colors the spell refunds) are dropped from the roll
 * so a spell can never cost a color it refunds — no infinite mana loop.
 * `favorColors` (colors the spell creates) get a slight added weight.
 */
function rollCostColor(elements, primaryAction, affinityColors = [], excludeColors = null, favorColors = null) {
  const exclude = excludeColors instanceof Set ? excludeColors : new Set(excludeColors || []);
  const favor = favorColors instanceof Set ? favorColors : new Set(favorColors || []);
  const eligible = COST_COLORS.filter((c) => !exclude.has(c));
  // If every color is excluded (degenerate), fall back to the full set so we
  // still produce a cost rather than nothing.
  const pool = eligible.length ? eligible : COST_COLORS;
  const weights = {};
  for (const c of pool) weights[c] = COST_COLOR_WEIGHTS.anyColor;
  let first = true;
  for (const el of elements) {
    if (weights[el] == null) continue; // skull / excluded colors aren't in the pool
    weights[el] += first ? COST_COLOR_WEIGHTS.firstElement : COST_COLOR_WEIGHTS.otherElement;
    first = false;
  }
  // Damage tags gradient the whole color spread (Strike→red…purple,
  // Blast→purple…red); other actions add a single affinity color's weight.
  const skew = DAMAGE_COLOR_SKEW[primaryAction];
  if (skew) {
    for (const c of pool) weights[c] += skew[c] || 0;
  } else {
    const affinity = ACTION_COST_AFFINITY[primaryAction];
    if (affinity && weights[affinity] != null) weights[affinity] += COST_COLOR_WEIGHTS.actionAffinity;
  }
  // CHARACTER affinity: lean the cost toward the colors the character generates
  // (their starting-skill colors), so woven spells feel fundable for that class.
  for (const c of affinityColors) {
    if (weights[c] != null) weights[c] += COST_COLOR_WEIGHTS.characterAffinity;
  }
  // CREATED colors: slightly encourage costing a color the spell makes tiles of
  // ("create 3 Blue" → can cost Blue).
  for (const c of favor) {
    if (weights[c] != null) weights[c] += COST_COLOR_WEIGHTS.createdColor;
  }
  return pickWeightedEntry(Object.entries(weights)) || pickRandom(pool);
}

/**
 * Build the fallback cost (no woven element dictates it): roll an affinity-
 * weighted primary color, then — if it landed OFF the character's affinity —
 * SUBSIDIZE it by moving a fraction of the total into their primary affinity
 * color, yielding an easier-to-fund 2-color cost. Single-color when the primary
 * is already an affinity color, there's no affinity, or the total is small.
 * @param {number} total
 * @param {string[]} elements — bag element tags (cost-roll influence)
 * @param {string} primaryAction
 * @param {string[]} affinityColors — character's starting-skill colors, in order
 * @param {Set<string>} [excludeColors] — loop-risk colors (never cost them)
 * @param {Set<string>} [favorColors] — colors the spell creates (slight cost bias)
 * @returns {Object<string,number>}
 */
function buildAffinityCost(total, elements, primaryAction, affinityColors, excludeColors = null, favorColors = null) {
  const exclude = excludeColors instanceof Set ? excludeColors : new Set(excludeColors || []);
  const aff = (affinityColors || []).filter((c) => COST_COLORS.includes(c) && !exclude.has(c));
  const primary = rollCostColor(elements, primaryAction, aff, exclude, favorColors);
  if (aff.includes(primary) || aff.length === 0 || total < COST_AFFINITY_SUBSIDY.minTotal) {
    return { [primary]: total };
  }
  // Off-color → split a subsidy portion into the primary affinity color.
  const subsidyColor = aff[0];
  const subsidy = Math.max(1, Math.min(total - 1, Math.round(total * COST_AFFINITY_SUBSIDY.affinityFraction)));
  return { [primary]: total - subsidy, [subsidyColor]: subsidy };
}

/**
 * Split a total mana cost across the woven element colors, in PICK ORDER — the
 * FIRST element pays the most, so color order is a real decision and multi-color
 * spells are genuinely harder to fund. Capped at MANA_COST_CONFIG.maxColors, and
 * naturally at `total` (each color pays ≥1). Returns a { color: amount } cost,
 * or null when there is no cost-eligible element color (caller falls back to the
 * weighted single-color roll).
 *
 * @param {number} total — the computed total cost
 * @param {string[]} elementColorsInOrder — woven element tags, in pick order
 * @returns {Object<string,number>|null}
 */
function buildCost(total, elementColorsInOrder) {
  const colors = [];
  for (const c of elementColorsInOrder) {
    if (COST_COLORS.includes(c) && !colors.includes(c)) colors.push(c); // skull excluded
  }
  if (!colors.length) return null;
  const maxColors = MANA_COST_CONFIG.maxColors || 1;
  const use = colors.slice(0, Math.max(1, Math.min(maxColors, total)));
  if (use.length === 1) return { [use[0]]: total };

  const n = use.length;
  const weights = use.map((_, i) => n - i); // [n, n-1, …, 1] — first element heaviest
  const wsum = weights.reduce((a, b) => a + b, 0);
  const alloc = use.map((_, i) => Math.max(1, Math.round((total * weights[i]) / wsum)));

  // Reconcile rounding so the parts sum to EXACTLY `total`.
  let diff = total - alloc.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 999) {
    if (diff > 0) { alloc[0] += 1; diff--; }              // surplus → the primary color
    else {
      let trimmed = false;                                 // deficit → trim lowest-priority spare
      for (let i = n - 1; i >= 0; i--) {
        if (alloc[i] > 1) { alloc[i] -= 1; diff++; trimmed = true; break; }
      }
      if (!trimmed) break;
    }
  }
  const cost = {};
  use.forEach((c, i) => { cost[c] = alloc[i]; });
  return cost;
}

/**
 * Colors a spell must NEVER cost — those it would REFUND for at least the cost,
 * enabling an infinite loop. CONVERT (mass / area / single) floods a region into
 * one color → a guaranteed match that returns more of that color than was spent;
 * GAIN_MANA hands the color back directly. Both are excluded from the cost.
 * CREATE is deliberately NOT here (see createdCostColors) — created tiles are
 * placed avoiding matches with no forced cascade, so they aren't a guaranteed
 * refund. Wild is excluded too (player-chosen color, requires manual setup).
 * @param {object[]} effects — the emitted effect list
 * @returns {Set<string>}
 */
function loopRiskColors(effects) {
  const gen = new Set();
  const add = (c) => { if (COST_COLORS.includes(c)) gen.add(c); };
  for (const e of effects) {
    switch (e.effectType) {
      case 'convert_tile': if (e.convertTile) add(e.convertTile.type); break;
      case 'convert_tiles_by_type': if (e.convertByType) add(e.convertByType.to); break;
      case 'gain_mana': if (e.gainMana) add(e.gainMana.color); break;
      default: break;
    }
  }
  return gen;
}

/**
 * Colors the spell CREATES tiles of (create_tiles). Costing such a color is
 * ALLOWED and slightly ENCOURAGED (COST_COLOR_WEIGHTS.createdColor) — making
 * tiles isn't a free refund, but a "make Blue, spend Blue" spell reads nicely.
 * @param {object[]} effects — the emitted effect list
 * @returns {Set<string>}
 */
function createdCostColors(effects) {
  const made = new Set();
  for (const e of effects) {
    if (e.effectType === 'create_tiles' && e.createTiles && COST_COLORS.includes(e.createTiles.type)) {
      made.add(e.createTiles.type);
    }
  }
  return made;
}

/**
 * Generate a flavor name from the bag (pattern × adjective × noun × suffix).
 * Re-rolls all parts per attempt until a candidate fits NAME_MAX_LENGTH;
 * falls back to the bare action noun (every noun fits on its own).
 */
function generateName(tagIds, groups, primaryAction) {
  const elements = groups[TAG_CATEGORY.ELEMENT];
  const nounPool = ACTION_NOUNS[primaryAction] || DEFAULT_NOUNS;
  const suffixPool = tagIds.filter((id) => TAG_SUFFIXES[id]);
  let noun = pickRandom(nounPool);

  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
    const adj = elements.length ? pickRandom(ELEMENT_ADJ[pickRandom(elements)] || []) : null;
    noun = pickRandom(nounPool);
    const suffix = suffixPool.length ? pickRandom(TAG_SUFFIXES[pickRandom(suffixPool)]) : null;

    const candidates = Object.entries(NAME_PATTERN_WEIGHTS).filter(([pattern]) => {
      if (pattern.includes('adj') && !adj) return false;
      if (pattern.includes('suffix') && !suffix) return false;
      return true;
    });
    const pattern = pickWeightedEntry(candidates) || 'plain_noun';
    let name;
    switch (pattern) {
      case 'adj_noun': name = `${adj} ${noun}`; break;
      case 'adj_noun_suffix': name = `${adj} ${noun} ${suffix}`; break;
      case 'noun_suffix': name = `${noun} ${suffix}`; break;
      default: name = noun; break;
    }
    if (name.length <= NAME_MAX_LENGTH) return name;
  }
  return noun; // every bare noun fits the budget
}

// ═══════════════════════════════════════════════════════════
// Synthesis
// ═══════════════════════════════════════════════════════════

/**
 * Synthesize a woven tag bag into a concrete skill.
 *
 * @param {string[]} recipe — committed tag ids, in pick order
 * @param {object} [options]
 * @param {string[]} [options.affinityColors] — the character's starting-skill
 *   colors; the FALLBACK cost-color roll leans toward them and off-color costs
 *   are subsidized into them (see buildAffinityCost). Empty → neutral (old behavior).
 * @returns {{
 *   recipe: string[],
 *   groups: Object<string, string[]>,
 *   rolledValues: Object<string, number>,
 *   usedTags: string[],
 *   unusedTags: string[],
 *   wastedReasons: Object<string, string>,
 *   injectedTags: string[],
 *   power: number,
 *   skill: object,
 *   summary: string,
 * }}
 */
export function synthesize(recipe, options = {}) {
  const tagIds = Array.isArray(recipe) ? recipe.slice() : [];
  const affinityColors = Array.isArray(options.affinityColors) ? options.affinityColors : [];
  const groups = groupByCategory(tagIds);

  // Roll every hidden value up front (also exposed for inspection/debugging).
  const rolledValues = {};
  for (const id of tagIds) {
    const v = rollTagValue(id);
    if (v != null) rolledValues[id] = v;
  }
  const roll = (id, fallback = 1) => (rolledValues[id] != null ? rolledValues[id] : fallback);

  // ── Consumption state ──
  const used = new Set();
  const injected = new Set(); // retained for compat; stays empty (no injection)
  const wastedReasons = {};   // tag id → WHY it contributed nothing (choice-driven downside)
  /** Flag a picked tag as wasted with a player-facing reason (first reason wins). */
  const markWasted = (tagId, reason) => {
    if (!used.has(tagId) && !(tagId in wastedReasons)) wastedReasons[tagId] = reason;
  };
  const effects = [];
  const lines = [];      // description lines
  let power = 0;
  let targeting = null;  // { targeting: 'board_tile', area } — one per skill
  let forceExtraTurn = false; // set by `shuffle` (always grants an extra turn)
  const elements = groups[TAG_CATEGORY.ELEMENT].slice(); // colors + skull (for name flavor + cost fallback)
  const shapes = new Set(groups[TAG_CATEGORY.SHAPE]);
  const modifiers = new Set(groups[TAG_CATEGORY.MODIFIER]);
  // Tile types in PICK ORDER (colors + skull + wild) — membership-based so the
  // grammar is order-tolerant and reads wild/skull as types, not dangling tags.
  const tileTypes = tagIds.filter((id) => TILE_TYPE_IDS.includes(id));

  /** Take the FIRST unconsumed tile type (create's single type). */
  const takeType = () => {
    for (const t of tileTypes) if (!used.has(t)) { used.add(t); return t; }
    return null;
  };
  /** Take the LAST unconsumed tile type — used for conversion DESTINATION, since
   *  the last type "reads" as the target ("convert red → yellow"). Call again
   *  for the source (now-last). */
  const takeLastType = () => {
    for (let i = tileTypes.length - 1; i >= 0; i--) {
      const t = tileTypes[i];
      if (!used.has(t)) { used.add(t); return t; }
    }
    return null;
  };
  /** Take the first unconsumed COLOR type (skull/wild excluded). */
  const takeColorType = () => {
    for (const t of tileTypes) if (!used.has(t) && COST_COLORS.includes(t)) { used.add(t); return t; }
    return null;
  };
  /** Consume the `all` qualifier if present (first verb to want it wins). */
  const consumeAll = () => {
    if (tagIds.includes('all') && !used.has('all')) { used.add('all'); return true; }
    return false;
  };
  /** Consume the `greater` qualifier if present (first magnitude verb wins). */
  let greaterUsed = false;
  const consumeGreater = () => {
    if (tagIds.includes('greater') && !used.has('greater')) {
      used.add('greater'); greaterUsed = true; return true;
    }
    return false;
  };
  /** Greater's magnitude boost — always at least +1 so small gains still grow. */
  const greaterBoost = (a) => Math.max((a || 0) + 1, Math.round((a || 0) * GREATER_CONFIG.damageMult));
  /** Provenance: damage tag id → rolled scaling preset key (e.g. '_150'). */
  const scalingRolls = {};
  /** Is there an unconsumed targeting shape (row/column/area/tile) in the bag? */
  const anyUnusedShape = () => SHAPE_IDS.some((s) => shapes.has(s) && !used.has(s));
  /** Consume a shape tag if present and unconsumed (in candidate order). */
  const takeShape = (...candidates) => {
    for (const s of candidates) {
      if (shapes.has(s) && !used.has(s)) { used.add(s); return s; }
    }
    return null;
  };
  /** Label for a conversion SOURCE ("all <X>") — always the plural/tiles form. */
  const srcLabel = (t) => {
    if (t === 'skull') return '[[Skulls]]';
    if (t === 'wild') return '[[Wild]] [[tiles]]';
    return `${TILE_LABEL[t]} [[tiles]]`;
  };
  /** Label for a conversion DESTINATION ("into <X>"). plural=true when MANY tiles
   *  become it (mass / 3×3) → "Skulls"; a single tile → "Skull". Colors and wild
   *  read the same either way (a destination never trails "tiles"). */
  const destLabel = (t, plural = false) => {
    if (t === 'skull') return plural ? '[[Skulls]]' : '[[Skull]]';
    if (t === 'wild') return '[[Wild]]';
    return TILE_LABEL[t];
  };

  /** Emit a create_tiles effect (shared by the action and injections). */
  const emitCreate = (amount, type) => {
    effects.push({ effectType: 'create_tiles', createTiles: { amount, type } });
    if (type === 'wild') lines.push(`[[Create]] ${amount} [[Wild]] [[tiles]]`);
    else if (type === 'thrall') lines.push(`[[Create]] ${amount} [[Thrall]] [[tiles]]`);
    else if (type === 'skull') lines.push(`[[Create]] ${amount} [[Skulls]]`);
    else lines.push(`[[Create]] ${amount} ${TILE_LABEL[type]} [[tiles]]`);
    const isWildType = type === 'wild' || type === 'thrall';
    power += amount * POWER.perTileCreated * (isWildType ? POWER.thrallTileMult : 1);
  };

  /**
   * Emit a damage effect of a given TYPE (strike → Attack scaling, blast →
   * Magic scaling). The scaling MULTIPLIER is rolled from a weighted preset; the
   * description uses `<<amount>>` (live computed value) + the [[phys]]/[[mag]]
   * keyword. Cost rises with the multiplier but non-linearly (a random luck
   * discount on the scaling's power contribution). `perSkull` adds the board-
   * dependent "+N per Skull" rider (not reflected in the dynamic value).
   * @param {'strike'|'blast'} type
   * @param {number} amount — base damage (already greater-multiplied if applicable)
   * @param {{perSkull?:number}} [opts]
   */
  const emitDamage = (type, amount, opts = {}) => {
    const presetKey = rollDamageScalingPreset();
    const mult = DAMAGE_SCALING_PRESETS[presetKey] != null
      ? DAMAGE_SCALING_PRESETS[presetKey] : DAMAGE_SCALE_PER_POINT;
    const stat = DAMAGE_TAG_STAT[type] || 'magic';
    const scaling = { [stat]: mult };
    scalingRolls[type] = presetKey;

    const dmg = { amount, scaling };
    const perSkull = opts.perSkull || 0;
    if (perSkull > 0) dmg.perSkull = perSkull;
    effects.push({ effectType: 'damage', damage: dmg });

    const kw = DAMAGE_TAG_KEYWORD[type] || '[[mag]]';
    lines.push(perSkull > 0
      ? `Deal <<${amount}>> ${kw}, plus ${perSkull} per [[Skull]] on the board`
      : `Deal <<${amount}>> ${kw}`);

    // Power = flat base + estimated scaled contribution (× a random cost-luck
    // factor so a big multiplier can land under-priced) + per-Skull rider.
    const sp = DAMAGE_SCALING_POWER;
    const luck = sp.luckMin + Math.random() * Math.max(0, sp.luckMax - sp.luckMin);
    const scaledPower = mult * sp.estStat * sp.perScaledPoint * luck;
    power += amount * POWER.perDamage + scaledPower + perSkull * EST_SKULLS_ON_BOARD * POWER.perSkullDamage;
  };

  /**
   * Emit an apply_poison effect — the DoT damage-type action (the green
   * counterpart to strike/blast). Applies `amount` poison STACKS to the opponent;
   * the stacks tick for their count at turn end then halve. The application
   * scales with Magic via a rolled MULTIPLIER preset (like blast), the
   * description uses `<<amount>>` (live value) + [[Poison]], and `skull + poison`
   * adds the board-dependent "+N per Skull" rider. See decision #39.
   * @param {number} amount — base stacks (already greater-multiplied if applicable)
   * @param {{perSkull?:number}} [opts]
   */
  const emitPoison = (amount, opts = {}) => {
    const presetKey = rollDamageScalingPreset();
    const rolledMult = DAMAGE_SCALING_PRESETS[presetKey] != null
      ? DAMAGE_SCALING_PRESETS[presetKey] : DAMAGE_SCALE_PER_POINT;
    // HALF the rolled multiplier: poison's halving decay already ≈ doubles each
    // stack's lifetime value, so a half-rate magic scaling keeps its EFFECTIVE
    // scaling in line with strike/blast instead of doubling it. See decision #39.
    const mult = rolledMult * POISON_SCALING_FACTOR;
    const scaling = { magic: mult };
    scalingRolls.poison = presetKey;

    const poison = { amount, target: 'opponent', scaling };
    const perSkull = opts.perSkull || 0;
    if (perSkull > 0) poison.perSkull = perSkull;
    effects.push({ effectType: 'apply_poison', poison });

    lines.push(perSkull > 0
      ? `Apply <<${amount}>> [[Poison]], plus ${perSkull} per [[Skull]] on the board`
      : `Apply <<${amount}>> [[Poison]]`);

    // Power: each stack ≈ 2× damage over the decay tail (DoT-discounted via
    // perPoisonStack) + the scaled contribution + per-Skull rider.
    const sp = DAMAGE_SCALING_POWER;
    const luck = sp.luckMin + Math.random() * Math.max(0, sp.luckMax - sp.luckMin);
    const scaledPower = mult * sp.estStat * sp.perScaledPoint * luck;
    power += amount * POWER.perPoisonStack + scaledPower + perSkull * EST_SKULLS_ON_BOARD * POWER.perSkullDamage;
  };

  /**
   * Emit a heal effect. Healing scales off BOTH Attack and Magic at the fixed
   * `_50` (×1/2 each) preset; the description uses `<<amount>>` (live computed
   * value) + the [[Heal]] keyword.
   * @param {number} amount — base heal (already greater-multiplied if applicable)
   */
  const emitHeal = (amount) => {
    const scaling = { attack: DAMAGE_SCALING_PRESETS._50, magic: DAMAGE_SCALING_PRESETS._50 };
    effects.push({ effectType: 'heal', heal: { amount, scaling } });
    lines.push(`[[Heal]] <<${amount}>> HP`);
    // base + estimated scaled contribution from both stats (deterministic preset).
    power += amount * POWER.perHeal
      + (scaling.attack + scaling.magic) * DAMAGE_SCALING_POWER.estStat * DAMAGE_SCALING_POWER.perScaledPoint;
  };

  /**
   * Emit an armor effect. Armor gain scales with Attack at the fixed `_33`
   * (×1/3) preset by default; the description uses `<<amount>>` + [[armor]].
   * @param {number} amount — base armor (already greater-multiplied if applicable)
   */
  const emitArmor = (amount) => {
    const scaling = { attack: DAMAGE_SCALING_PRESETS._33 };
    effects.push({ effectType: 'armor', armor: { amount, scaling } });
    lines.push(`Gain <<${amount}>> [[armor]]`);
    power += amount * POWER.perArmor
      + scaling.attack * DAMAGE_SCALING_POWER.estStat * DAMAGE_SCALING_POWER.perScaledPoint;
  };

  /**
   * Emit a barrier effect — a one-round MAGIC shield. Like armor it's a temporary
   * HP pool that absorbs damage, but it scales with Magic at the `_66` (×2/3)
   * preset (twice as effectively as armor scales with Attack) and expires at the
   * caster's next turn. Description uses `<<amount>>` (live value) + [[barrier]].
   * @param {number} amount — base barrier (already greater-multiplied if applicable)
   */
  const emitBarrier = (amount) => {
    const scaling = { magic: DAMAGE_SCALING_PRESETS._66 };
    effects.push({ effectType: 'barrier', barrier: { amount, scaling } });
    lines.push(`Gain <<${amount}>> [[barrier]]`);
    power += amount * POWER.perArmor
      + scaling.magic * DAMAGE_SCALING_POWER.estStat * DAMAGE_SCALING_POWER.perScaledPoint;
  };

  /**
   * Emit a shaped board destruction, claiming the skill's single targeting
   * slot (shared by destroy/explode actions and the orphan-shape injection).
   * @returns {boolean} false when the targeting slot was already taken
   */
  const emitDestroyShaped = (shape, isExplode = false) => {
    if (targeting) return false;
    if (shape === 'row') {
      targeting = { targeting: 'board_tile', area: 1 };
      effects.push({ effectType: 'destroy_tiles_row' });
      lines.push('[[Destroy]] a row of [[tiles]]');
      power += POWER.destroyRow;
    } else if (shape === 'column') {
      targeting = { targeting: 'board_tile', area: 1 };
      effects.push({ effectType: 'destroy_tiles_column' });
      lines.push('[[Destroy]] a column of [[tiles]]');
      power += POWER.destroyColumn;
    } else if (shape === 'tile') {
      targeting = { targeting: 'board_tile', area: { radius: 0 } };
      effects.push({ effectType: 'destroy_tiles' });
      lines.push('[[Destroy]] a [[tile]]');
      power += POWER.destroyTile;
    } else {
      let radius = isExplode && shape === 'area' ? 2 : 1;
      // `greater` widens an area destruction from 3x3 (radius 1) to 5x5 (radius 2).
      if (radius < 2 && consumeGreater()) radius = 2;
      targeting = { targeting: 'board_tile', area: { radius } };
      effects.push({ effectType: 'destroy_tiles' });
      lines.push(`[[Destroy]] [[tiles]] in a ${radius * 2 + 1}x${radius * 2 + 1} area`);
      power += radius === 2 ? POWER.destroyAreaWide : POWER.destroyArea;
    }
    return true;
  };

  /**
   * Emit a self-contained BONUS effect for one non-color tag — the payload of
   * the `random` wildcard. Returns false when the tag can't apply right now
   * (a destroy/shape when the single targeting slot is already taken), so the
   * caller can try another rolled tag. `extra_turn`/`shuffle` only set the flag;
   * the extra_turn effect is appended later (kept LAST — decision #4).
   * @param {string} tag — a NON_COLOR_BONUS_TAGS id
   * @returns {boolean} whether a bonus was emitted
   */
  const emitRandomBonus = (tag) => {
    switch (tag) {
      case 'strike': case 'blast': { emitDamage(tag, rollTagValue(tag) || 5); return true; }
      case 'poison': { emitPoison(rollTagValue('poison') || 4); return true; }
      case 'armor': { emitArmor(rollTagValue('armor') || 5); return true; }
      case 'barrier': { emitBarrier(rollTagValue('barrier') || 5); return true; }
      case 'heal': { emitHeal(rollTagValue('heal') || 5); return true; }
      case 'attack': { const a = rollTagValue('attack') || 1; effects.push({ effectType: 'gain_attack', gainAttack: { amount: a } }); lines.push(`Gain ${a} [[attack]]`); power += a * POWER.perAttack; return true; }
      case 'magic': { const a = rollTagValue('magic') || 1; effects.push({ effectType: 'gain_magic', gainMagic: { amount: a } }); lines.push(`Gain ${a} [[magic]]`); power += a * POWER.perMagic; return true; }
      case 'drain': { const a = rollTagValue('drain') || 2; effects.push({ effectType: 'drain_mana', drainMana: { amount: a } }); lines.push(`Drain ${a} [[mana]] of every color from the enemy`); power += a * POWER.perManaDrainedAllColors; return true; }
      case 'create': { emitCreate(rollTagValue('create') || 3, pickRandom(COST_COLORS)); return true; }
      case 'wild': { emitCreate(Math.max(2, Math.round((rollTagValue('create') || 3) * 0.75)), 'wild'); return true; }
      case 'convert':
      case 'change': {
        const to = pickRandom(COST_COLORS);
        const from = pickRandom(COST_COLORS.filter((c) => c !== to));
        effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from, to } });
        lines.push(`[[Change]] all ${TILE_LABEL[from]} [[tiles]] into ${TILE_LABEL[to]}`);
        power += POWER.convertByType;
        return true;
      }
      case 'shuffle': { effects.push({ effectType: 'shuffle' }); lines.push('[[Shuffle]] the board'); forceExtraTurn = true; power += POWER.shuffleBoard; return true; }
      case 'extra_turn': { forceExtraTurn = true; return true; }
      case 'destroy': case 'explode': {
        const shape = pickRandom(tag === 'explode' ? ['area'] : ['row', 'column', 'area', 'tile']);
        return emitDestroyShaped(shape, tag === 'explode'); // false if targeting taken
      }
      case 'row': case 'column': case 'area': case 'tile': {
        return emitDestroyShaped(tag); // a bare shape's bonus is a destroy of it
      }
      default: {
        const statusId = STATUS_TAG_TO_ID[tag];
        if (!statusId) return false;
        const turns = rollTagValue(tag) || 2;
        const isSelf = SELF_STATUS_TAGS.has(tag);
        const applyStatus = { id: statusId, target: isSelf ? 'self' : 'opponent', turns };
        if (statusId === 'crippled') applyStatus.attackValue = 1;
        effects.push({ effectType: 'apply_status', applyStatus });
        const turnsText = turns === 1 ? '1 turn' : `${turns} turns`;
        lines.push(isSelf ? `Gain [[${capitalize(tag)}]] for ${turnsText}` : `Apply [[${capitalize(tag)}]] for ${turnsText}`);
        power += turns * (isSelf ? POWER.perBuffTurn : POWER.perDebuffTurn);
        return true;
      }
    }
  };

  // ── Actions, in pick order (first = primary) ──
  const actions = groups[TAG_CATEGORY.ACTION];
  const primaryAction = actions[0] || null;

  for (const action of actions) {
    used.add(action);
    switch (action) {
      case 'strike':
      case 'blast': {
        let amount = roll(action, 5);
        // `greater` multiplies the base amount (and may surge a synergy later).
        if (consumeGreater()) amount = greaterBoost(amount);
        // skull + damage → ALSO "+N per Skull on the board" (read at cast).
        let perSkull = 0;
        if (tileTypes.includes('skull') && !used.has('skull')) {
          used.add('skull');
          perSkull = Math.random() < 0.35 ? 2 : 1;
        }
        emitDamage(action, amount, { perSkull });
        break;
      }
      case 'poison': {
        let amount = roll('poison', 3);
        // `greater` multiplies the base stacks (like strike/blast).
        if (consumeGreater()) amount = greaterBoost(amount);
        // skull + poison → ALSO "+1 stack per Skull on the board" (read at cast).
        // CAPPED at 1 (unlike strike/blast which can roll 2) — poison + skull on
        // a skull-heavy board would otherwise compound too hard. See decision #39.
        let perSkull = 0;
        if (tileTypes.includes('skull') && !used.has('skull')) {
          used.add('skull');
          perSkull = 1;
        }
        emitPoison(amount, { perSkull });
        break;
      }
      case 'armor': {
        let amount = roll('armor', 5);
        if (consumeGreater()) amount = greaterBoost(amount);
        emitArmor(amount);
        break;
      }
      case 'barrier': {
        let amount = roll('barrier', 5);
        if (consumeGreater()) amount = greaterBoost(amount);
        emitBarrier(amount);
        break;
      }
      case 'heal': {
        let amount = roll('heal', 5);
        if (consumeGreater()) amount = greaterBoost(amount);
        emitHeal(amount);
        break;
      }
      case 'attack': {
        let amount = roll('attack', 1);
        if (consumeGreater()) amount = greaterBoost(amount);
        effects.push({ effectType: 'gain_attack', gainAttack: { amount } });
        lines.push(`Gain ${amount} [[attack]]`);
        power += amount * POWER.perAttack;
        break;
      }
      case 'magic': {
        let amount = roll('magic', 1);
        if (consumeGreater()) amount = greaterBoost(amount);
        effects.push({ effectType: 'gain_magic', gainMagic: { amount } });
        lines.push(`Gain ${amount} [[magic]]`);
        power += amount * POWER.perMagic;
        break;
      }
      case 'shuffle': {
        // Randomize the whole board. Always paired with an extra turn (the
        // append below honors forceExtraTurn), so a fresh board isn't a tempo
        // loss. No magnitude / targeting — it reshuffles everything.
        effects.push({ effectType: 'shuffle' });
        lines.push('[[Shuffle]] the board');
        forceExtraTurn = true;
        power += POWER.shuffleBoard;
        break;
      }
      case 'drain': {
        // Color-agnostic: drains EVERY color. A color woven alongside doesn't
        // target the drain — it's dangling and simply influences the cost.
        let amount = roll('drain', 2);
        if (consumeGreater()) amount = greaterBoost(amount);
        effects.push({ effectType: 'drain_mana', drainMana: { amount } });
        lines.push(`Drain ${amount} [[mana]] of every color from the enemy`);
        power += amount * POWER.perManaDrainedAllColors;
        break;
      }
      case 'create': {
        // Create tiles of the woven type (any tile type — color, skull, or
        // wild); none → a rolled color. `all` boosts the count.
        let amount = roll('create', 3);
        if (consumeAll()) amount += Math.max(2, Math.round(amount * 0.5));
        if (consumeGreater()) amount = Math.round(amount * GREATER_CONFIG.createMult);
        const type = takeType() || pickRandom(COST_COLORS);
        emitCreate(amount, type);
        break;
      }
      case 'convert': {
        // MASS by-type conversion. Reads "convert all <source> → <destination>":
        // the LAST woven tile-type is the destination, the preceding one the
        // source (rolled at synthesis if absent). A `tile`/`area` shape makes it
        // a targeted recolor instead of board-wide.
        const dest = takeLastType() || pickRandom(COST_COLORS);
        const shape = !targeting ? takeShape('tile', 'area') : null;
        if (shape) {
          const radius = shape === 'area' ? 1 : 0;
          targeting = { targeting: 'board_tile', area: { radius } };
          effects.push({ effectType: 'convert_tile', convertTile: { type: dest } });
          const what = radius > 0 ? '[[tiles]] in a 3x3 area' : 'a [[tile]]';
          lines.push(`[[Change]] ${what} into ${destLabel(dest, radius > 0)}`);
          power += radius > 0 ? POWER.convertArea : POWER.convertTile;
        } else {
          let from = takeLastType();
          if (!from) from = pickRandom([...COST_COLORS, 'skull'].filter((c) => c !== dest));
          effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from, to: dest } });
          lines.push(`[[Change]] all ${srcLabel(from)} into ${destLabel(dest, true)}`);
          power += POWER.convertByType;
        }
        break;
      }
      case 'change': {
        // TARGETED single-tile recolor → the LAST woven tile-type. An `area`
        // shape widens it to 3×3; `all` promotes it to a mass by-type conversion
        // (≈ convert). Direction reads exactly as written: last type = target.
        const dest = takeLastType() || pickRandom(COST_COLORS);
        if (consumeAll()) {
          let from = takeLastType();
          if (!from) from = pickRandom([...COST_COLORS, 'skull'].filter((c) => c !== dest));
          effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from, to: dest } });
          lines.push(`[[Change]] all ${srcLabel(from)} into ${destLabel(dest, true)}`);
          power += POWER.convertByType;
          break;
        }
        if (targeting) {
          used.delete('change');
          markWasted('change', 'spell can have only one targeted effect');
          break;
        }
        const radius = takeShape('area', 'tile') === 'area' ? 1 : 0;
        targeting = { targeting: 'board_tile', area: { radius } };
        effects.push({ effectType: 'convert_tile', convertTile: { type: dest } });
        const what = radius > 0 ? '[[tiles]] in a 3x3 area' : 'a [[tile]]';
        lines.push(`[[Change]] ${what} into ${destLabel(dest, radius > 0)}`);
        power += radius > 0 ? POWER.convertArea : POWER.convertTile;
        break;
      }
      case 'destroy':
      case 'explode': {
        const isExplode = action === 'explode';
        // all + color → board-wide color wipe (non-targeted), reads "destroy all Red".
        if (!isExplode && tagIds.includes('all') && !used.has('all')) {
          const color = takeColorType();
          if (color) {
            used.add('all');
            effects.push({ effectType: 'destroy_tiles_by_type', destroyByType: { type: color } });
            lines.push(`[[Destroy]] all ${TILE_LABEL[color]} [[tiles]]`);
            power += POWER.destroyByColor;
            break;
          }
        }
        // skull + destroy (and NO shape to consume) → destroy N Skull tiles.
        if (!isExplode && tileTypes.includes('skull') && !used.has('skull') && !anyUnusedShape()) {
          used.add('skull');
          const n = 3 + Math.floor(Math.random() * 4); // 3..6
          effects.push({ effectType: 'destroy_tiles_by_type', destroyByType: { type: 'skull', amount: n } });
          lines.push(`[[Destroy]] ${n} [[Skulls]]`);
          power += n * POWER.destroySkull;
          break;
        }
        // Otherwise a shaped, TARGETED destruction (one targeting slot only).
        if (targeting) {
          used.delete(action);
          markWasted(action, 'spell can have only one targeted effect');
          break;
        }
        const shape = takeShape(...(isExplode ? ['area'] : ['row', 'column', 'area', 'tile'])) || 'default';
        emitDestroyShaped(shape === 'default' ? 'area-default' : shape, isExplode);
        break;
      }
      default:
        used.delete(action);
        break;
    }
  }

  // ── Tile-type floors: `wild` ALWAYS at least creates Wild tiles, and a lone
  //    `skull` creates Skulls — neither can be a cost color, so creation is
  //    their irreducible minimum (they never just fizzle). Only fires when a
  //    verb didn't already consume them. ──
  if (tileTypes.includes('wild') && !used.has('wild')) {
    used.add('wild');
    emitCreate(2 + Math.floor(Math.random() * 3), 'wild'); // 2..4 Wild tiles
  }
  if (tileTypes.includes('skull') && !used.has('skull')) {
    used.add('skull');
    emitCreate(2 + Math.floor(Math.random() * 3), 'skull'); // 2..4 Skulls
  }

  // ── `greater` SURGE: consuming Greater can ALSO emit one extra synergistic
  //    effect — a controlled re-introduction of "the weave surges", gated by the
  //    Greater tag (not random injection). The bonus is drawn from a curated
  //    synergy pool for the primary action (falls back to the generic pool), and
  //    recorded in `injected` for provenance. ──
  if (greaterUsed && Math.random() < GREATER_CONFIG.surgeChance) {
    const synergyPool = (SYNERGY_BY_ACTION[primaryAction] || NON_COLOR_BONUS_TAGS).slice();
    for (let i = synergyPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [synergyPool[i], synergyPool[j]] = [synergyPool[j], synergyPool[i]];
    }
    for (const t of synergyPool) {
      if (t === 'greater' || t === 'random') continue;
      if (emitRandomBonus(t)) { injected.add(t); break; }
    }
  }

  // ── `random` wildcard: ALWAYS pulls a BONUS effect from the non-color tag
  //    pool (actions / shapes / modifiers / statuses). One tag is rolled (the
  //    pool is shuffled and the first that can apply wins, so a destroy/shape
  //    that needs the already-taken targeting slot simply rerolls). This is the
  //    tag's function — not a "mistake", so it's never wasted. ──
  if (shapes.has('random') && !used.has('random')) {
    used.add('random');
    const pool = NON_COLOR_BONUS_TAGS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let emitted = false;
    for (const t of pool) { if (emitRandomBonus(t)) { emitted = true; break; } }
    if (!emitted) { // safety: only destroy/shape rolled AND targeting taken
      emitDamage(pickRandom(DAMAGE_TAGS), rollTagValue('damage') || 4);
    }
  }

  // (No injection pass otherwise — other redundant/incompatible picks become
  //  CHOICE-DRIVEN downsides surfaced after the cost is known; see below.)

  // ── Statuses (always used; buffs → self, debuffs → opponent) ──
  for (const tag of groups[TAG_CATEGORY.STATUS]) {
    const statusId = STATUS_TAG_TO_ID[tag];
    if (!statusId) continue;
    used.add(tag);
    const turns = roll(tag, 1);
    const isSelf = SELF_STATUS_TAGS.has(tag);
    const applyStatus = { id: statusId, target: isSelf ? 'self' : 'opponent', turns };
    if (statusId === 'crippled') applyStatus.attackValue = 1;
    effects.push({ effectType: 'apply_status', applyStatus });
    const turnsText = turns === 1 ? '1 turn' : `${turns} turns`;
    lines.push(isSelf
      ? `Gain [[${capitalize(tag)}]] for ${turnsText}`
      : `Apply [[${capitalize(tag)}]] for ${turnsText}`);
    power += turns * (isSelf ? POWER.perBuffTurn : POWER.perDebuffTurn);
  }

  // ── Fallback: a verb-less bag (the round-0 action guarantee is SOFT) still
  //    has to do SOMETHING — the raw weave lashes out. ──
  if (effects.length === 0) {
    emitDamage(pickRandom(DAMAGE_TAGS), rollTagValue('damage') || 4);
  }

  // ── extra_turn LAST (create_tiles' cascade resets the flag — decision #4).
  //    Granted by the extra_turn modifier OR forced by `shuffle`. ──
  if (modifiers.has('extra_turn') || forceExtraTurn) {
    if (modifiers.has('extra_turn')) used.add('extra_turn');
    effects.push({ effectType: 'extra_turn' });
    lines.push('Gain an [[extra turn]]');
    power += POWER.extraTurn;
  }

  // ── Cost: continuous TOTAL from the final POWER, SPLIT across woven colors ──
  // Total ≈ round(power / K), clamped; a multi-element bag divides it across its
  // colors in PICK ORDER (first element pays the most), so big multi-color
  // spells are genuinely harder to fund. With no element tag, the color is the
  // weighted affinity roll.
  const total = computeManaCostTotal(power);
  // A spell must never cost a color it would REFUND — convert/gain hand back at
  // least the cost, enabling an infinite loop, so those colors are EXCLUDED from
  // every cost path. CREATE is exempt (not a guaranteed refund) and its colors
  // are instead slightly FAVORED.
  const excluded = loopRiskColors(effects);
  const favored = createdCostColors(effects);
  // Only DANGLING colors (not consumed by a tile-verb, not loop-risk) pay the
  // cost — one word, one job. Split in pick order (first pays most).
  const danglingColors = tileTypes.filter(
    (t) => COST_COLORS.includes(t) && !used.has(t) && !excluded.has(t),
  );
  let cost = buildCost(total, danglingColors);
  // No woven element dictates the cost → fall back to an affinity-weighted roll
  // (excluding loop-risk colors, favoring created colors), subsidizing an
  // off-color result into the character's primary color.
  if (!cost) cost = buildAffinityCost(total, elements, primaryAction, affinityColors, excluded, favored);
  // Paying with a color COUNTS as using it (it isn't wasted).
  for (const c of Object.keys(cost)) if (tileTypes.includes(c)) used.add(c);
  // Dominant (most-paid) cost color — drives the resolve-sound color + logging.
  const costColor = Object.entries(cost).sort((a, b) => b[1] - a[1])[0][0];

  // ── Choice-driven downsides: redundant/incompatible picks contribute NOTHING
  //    (opportunity cost) and are surfaced with a reason. Deterministic, so a
  //    weak weave reads as "I could have picked better", not a dice roll.
  //    (wild/skull are floored above, so they never reach here.) ──
  for (const shape of SHAPE_IDS) {
    if (shapes.has(shape) && !used.has(shape)) markWasted(shape, 'no action used this shape');
  }
  if (tagIds.includes('all') && !used.has('all')) {
    markWasted('all', 'no Change/Destroy/Create to amplify');
  }
  if (tagIds.includes('greater') && !used.has('greater')) {
    markWasted('greater', 'no magnitude effect (Create/damage/gain) or area to amplify');
  }
  for (const t of tileTypes) {
    if (!used.has(t)) markWasted(t, 'no effect or cost used this color');
  }

  // ── Canonical effect order ──
  // Reorder the emitted effects AND their paired description lines in lockstep
  // into the standard resolution order (EFFECT_RESOLUTION_ORDER), so the skill
  // resolves and reads consistently regardless of the tag pick order. Throughout
  // synthesis effects[i] and lines[i] are pushed as a unit (one effect ⇒ one
  // line), so a stable sort of shared indices keeps them aligned. Guarded on a
  // length match so a future 1:1-breaking change degrades to the emit order
  // rather than mis-pairing lines with effects.
  if (effects.length === lines.length && effects.length > 1) {
    const rank = (t) => (EFFECT_RESOLUTION_ORDER[t] != null ? EFFECT_RESOLUTION_ORDER[t] : EFFECT_ORDER_DEFAULT);
    const order = effects.map((_, i) => i).sort((a, b) => {
      const d = rank(effects[a].effectType) - rank(effects[b].effectType);
      return d !== 0 ? d : a - b; // stable within a tier — keep emit order
    });
    const newEffects = order.map((i) => effects[i]);
    const newLines = order.map((i) => lines[i]);
    effects.length = 0; effects.push(...newEffects);
    lines.length = 0; lines.push(...newLines);
  }

  // ── Assemble ──
  const name = generateName(tagIds, groups, primaryAction);
  const usedTags = tagIds.filter((id) => used.has(id));
  const unusedTags = tagIds.filter((id) => !used.has(id));
  // Every unused tag gets a reason (generic fallback for anything not flagged).
  for (const id of unusedTags) if (!(id in wastedReasons)) wastedReasons[id] = 'found no synergy in this weave';
  const injectedTags = [...injected];
  const id = `woven_${tagIds.join('_')}_${Date.now().toString(36)}`;

  const skill = {
    id,
    name,
    // STRUCTURED effect lines — one complete gameplay sentence per entry
    // (renderers wrap each naturally; never insert manual breaks inside one).
    descriptionLines: lines.slice(),
    // Joined form for consumers that take a single string (tooltips, scenes).
    description: lines.join('\n') || 'It does... something?',
    icon: null, // filled by SkillWeaveScene from the procedural spell icon
    // Resolve SFX — walk the bag's actions for the first with a generic-pool
    // clip (random version), chosen once here and reused for the run. A verb-
    // less bag lashes out as damage, so voice it from the damage family.
    sound: pickSkillSound(
      actions.length ? actions : (effects.some((e) => e.effectType === 'damage') ? ['damage'] : []),
      effects,
      costColor,
    ),
    cost,
    ...(targeting || {}),
    effects,
    // Synthesis provenance — lets the icon be regenerated and the skill be
    // inspected later (not read by battle logic).
    woven: { recipe: tagIds, rolledValues, power, injectedTags, scalingRolls },
  };

  const summary = tagIds
    .map((tid) => (tid in rolledValues ? `${getTagLabel(tid)}(${rolledValues[tid]})` : getTagLabel(tid)))
    .join(' + ');
  const costStr = Object.entries(cost).map(([c, a]) => `${a} ${c}`).join(' + ');
  console.log(`[SkillSynth] Woven "${name}" — [${summary}] → power ${Math.round(power)}, cost ${costStr}`
    + (unusedTags.length ? `, wasted: ${unusedTags.map((t) => `${t} (${wastedReasons[t]})`).join('; ')}` : ''));

  return { recipe: tagIds, groups, rolledValues, usedTags, unusedTags, wastedReasons, injectedTags, power, skill, summary };
}
