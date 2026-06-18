/**
 * skillSynthesizer.js — turns a woven tag bag into a concrete, castable skill.
 *
 * Called once by SkillWeaveScene._finishWeave with the player's committed tag
 * recipe (2–4 unique tag ids). Emits a REAL skill object shaped exactly like a
 * skillCatalog.js entry ({ id, name, description, icon, sound, cost,
 * targeting?, area?, effects[] }) — the icon asset key is filled in by the
 * scene (procedural spell icons, §4.8); everything else is decided here.
 *
 * ── Rule model ──────────────────────────────────────────────────────────────
 * Tags are consumed by ROLE, walking the bag's ACTION tags in pick order:
 *   - The FIRST action is the PRIMARY action (drives name flavor, cost-color
 *     affinity, and owns the skill's single targeting configuration).
 *   - Actions consume compatible ELEMENT / SHAPE / MODIFIER tags as they
 *     resolve. `convert` is by-type by DEFAULT (2 elements → all <el1> into
 *     <el2>; 1 element → all <random other color> into <el>); the precise
 *     targeted single-tile convert happens only when the `tile` shape was
 *     explicitly woven (area → targeted 3×3 convert).
 *   - STATUS tags always resolve to apply_status effects (buffs target self,
 *     debuffs the opponent), with rolled durations.
 *   - `extra_turn` appends an extra_turn effect LAST (a create_tiles cascade
 *     resets the flag, so ordering is load-bearing — decision #4).
 *
 * ── Choice-driven downsides (NO injection) ───────────────────────────────────
 * Redundant / incompatible picks DETERMINISTICALLY contribute nothing (pure
 * opportunity cost) and are reported in `wastedReasons` (tag id → reason),
 * surfaced on the result screen so a weak weave reads as "I could have picked
 * better", not a dice roll:
 *   - `wild` with no create        → wasted ("no Create for Wild to empower")
 *   - orphan shape (row/col/area/tile/random) → wasted ("no action used …")
 *   - a 2nd targeted action        → wasted ("only one targeted effect")
 *   - an element no effect/cost used → wasted ("no effect or cost used …")
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
} from './weaveConfig.js';
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
  barrier: 'barrier',
});

/** Status tags that BUFF the caster (apply_status target 'self'). */
const SELF_STATUS_TAGS = new Set(['intangible', 'berserk', 'barrier']);

/** The five mana colors a cost may be paid in (skull is never a cost). */
const COST_COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple']);

/**
 * The `random` tag draws its bonus from EVERY non-color tag (actions, shapes,
 * modifiers, statuses — everything except elements and `random` itself). See
 * synthesize() `emitRandomBonus`.
 */
const NON_COLOR_BONUS_TAGS = Object.freeze(
  Object.values(SKILL_WEAVE_TAGS)
    .filter((t) => t.category !== TAG_CATEGORY.ELEMENT && t.id !== 'random')
    .map((t) => t.id),
);

/** Primary action → cost-color AFFINITY (a weight, not a rule — see
 *  COST_COLOR_WEIGHTS in weaveConfig). */
const ACTION_COST_AFFINITY = Object.freeze({
  damage: 'red', attack: 'blue', explode: 'red', destroy: 'red',
  armor: 'blue', heal: 'green', create: 'green',
  convert: 'purple', change: 'purple', drain: 'purple', shuffle: 'yellow',
});

/**
 * Primary action → resolve SFX (SoundConfig keys). FALLBACK only — used for
 * actions that have NO clip in the generic SFX pool (heal/attack/drain/shuffle).
 * Actions covered by the generic pool get a `sfx_generic_*` clip instead (see
 * pickSkillSound + GENERIC_SOUND_BY_ACTION below).
 */
const ACTION_SOUND = Object.freeze({
  damage: 'skill_bash', attack: 'skill_encroach',
  armor: 'skill_defend', heal: 'skill_oungan',
  create: 'skill_oungan', destroy: 'skill_fracture',
  explode: 'skill_explode', convert: 'skill_explode', change: 'skill_explode',
  drain: 'skill_doomsong', shuffle: 'skill_fracture',
});
const DEFAULT_SOUND = 'sfx_skill_cast';

// ── Generic SFX pool (sfx_audio_generic_sprite — see SoundConfig.js) ──
// A synthesized skill picks ONE clip from this authored pool at creation time
// (here, once) and reuses it for the rest of the run. The clip is chosen by the
// skill's PRIMARY action (the "most relevant effect"); families with multiple
// authored versions pick one at random; color-aware families (damage/create)
// pick the relevant tile color. Actions absent here fall back to ACTION_SOUND.

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
 * Actions NOT listed (heal/attack/drain/shuffle) have no generic clip → ACTION_SOUND.
 */
const GENERIC_SOUND_BY_ACTION = Object.freeze({
  damage:  { family: 'damage',  versions: 3, colored: true },
  explode: { family: 'destroy', versions: 5 },
  destroy: { family: 'destroy', versions: 5 },
  armor:   { family: 'armor',   versions: 2 },
  convert: { family: 'convert', versions: 3 },
  change:  { family: 'change',  versions: 3 },
  create:  { family: 'create',  versions: 2, create: true },
});

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
  perManaDrainedAllColors: 2.5,
  perAttack: 1,          // permanent for the battle
  perTileCreated: 1.5,
  thrallTileMult: 1.5,   // wild tiles are worth more per tile
  destroyTile: 2,        // single-tile snipe
  destroyRow: 8,
  destroyColumn: 8,
  destroyArea: 9,        // 3×3
  destroyAreaWide: 16,   // 5×5 (explode + area)
  convertByType: 8,      // all of one color → another
  convertTile: 3,        // targeted single tile
  convertArea: 8,        // targeted 3×3
  perDebuffTurn: 4,
  perBuffTurn: 4,
  extraTurn: 8,
  shuffleBoard: 10,       // whole-board reshuffle (always paired with an extra turn)
});

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

/** Primary action → name noun candidates. */
const ACTION_NOUNS = Object.freeze({
  damage: [
    'Strike', 'Lash', 'Rend', 'Reckoning', 'Scourge', 'Sundering', 'Spike', 'Verdict',
    'Smite', 'Onslaught', 'Lance', 'Wrath', 'Cleave', 'Havoc', 'Punishment', 'Blow',
    'Laceration', 'Maul', 'Skewer', 'Judgment', 'Impalement', 'Carnage',
  ],
  armor: [
    'Bulwark', 'Aegis', 'Ward', 'Carapace', 'Rampart', 'Shell', 'Vigil', 'Bastion',
    'Mantle', 'Fortress', 'Redoubt', 'Guardian', 'Palisade', 'Barricade', 'Aegida',
    'Buttress', 'Sanctuary', 'Embrace', 'Phalanx',
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
  damage:     ['of Wrath', 'Unleashed', 'of Ruin'],
  armor:      ['of Wardens', 'Enduring', 'of Vigil'],
  heal:       ['of Mercy', 'Restoring', 'of Grace'],
  create:     ['of Genesis', 'Unfolding', 'of Seeds'],
  destroy:    ['of Ruin', 'Undone', 'of Collapse'],
  convert:    ['of Change', 'Shifting', 'of Flux'],
  change:     ['of Marks', 'Inscribed', 'of Runes'],
  drain:      ['of Hunger', 'Withering', 'of Famine'],
  attack:     ['of Fury', 'Rising', 'of Bloodlust'],
  explode:    ['of Cataclysm', 'Bursting', 'of the Blast'],
  // Modifiers / shapes / statuses.
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
 * color (damage → cost color; create → the created tile flavor). Only when NO
 * bag action maps to the generic pool (pure attack/heal/drain/shuffle) does it
 * fall back to the per-action authored sound. Called ONCE here, so the chosen
 * clip persists for the rest of the run.
 *
 * @param {string[]} actions — the spell's action tags, in pick order
 * @param {object[]} effects — the emitted effect list (for the create flavor)
 * @param {string} costColor — the rolled cost color (damage clip color)
 * @returns {string} a SoundConfig key
 */
function pickSkillSound(actions, effects, costColor) {
  const list = Array.isArray(actions) ? actions : [];
  for (const action of list) {
    const desc = GENERIC_SOUND_BY_ACTION[action];
    if (desc) return buildGenericSound(desc, effects, costColor);
  }
  // No bag action has a generic clip — fall back to the primary action's
  // authored sound (else the silent default).
  return ACTION_SOUND[list[0]] || DEFAULT_SOUND;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Weighted cost-color roll: every color gets a baseline weight; bag elements
 * and the primary action's affinity ADD weight (influence, not a hard rule).
 * Only used as the FALLBACK when a bag has no cost-eligible element tag (a
 * multi-element bag's cost colors are deterministic — see buildCost).
 */
function rollCostColor(elements, primaryAction) {
  const weights = {};
  for (const c of COST_COLORS) weights[c] = COST_COLOR_WEIGHTS.anyColor;
  let first = true;
  for (const el of elements) {
    if (!COST_COLORS.includes(el)) continue; // skull is never a cost color
    weights[el] += first ? COST_COLOR_WEIGHTS.firstElement : COST_COLOR_WEIGHTS.otherElement;
    first = false;
  }
  const affinity = ACTION_COST_AFFINITY[primaryAction];
  if (affinity) weights[affinity] += COST_COLOR_WEIGHTS.actionAffinity;
  return pickWeightedEntry(Object.entries(weights)) || pickRandom(COST_COLORS);
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
export function synthesize(recipe) {
  const tagIds = Array.isArray(recipe) ? recipe.slice() : [];
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
  const elements = groups[TAG_CATEGORY.ELEMENT].slice();
  const shapes = new Set(groups[TAG_CATEGORY.SHAPE]);
  const modifiers = new Set(groups[TAG_CATEGORY.MODIFIER]);

  /** Take the next unconsumed element (optionally excluding skull). */
  const takeElement = ({ allowSkull = true } = {}) => {
    for (const el of elements) {
      if (used.has(el)) continue;
      if (!allowSkull && el === 'skull') continue;
      used.add(el);
      return el;
    }
    return null;
  };
  /** Consume a shape tag if present and unconsumed. */
  const takeShape = (...candidates) => {
    for (const s of candidates) {
      if (shapes.has(s) && !used.has(s)) { used.add(s); return s; }
    }
    return null;
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
      const radius = isExplode && shape === 'area' ? 2 : 1;
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
      case 'damage': { const a = rollTagValue('damage') || 5; effects.push({ effectType: 'damage', damage: { amount: a } }); lines.push(`Deal ${a} [[damage]]`); power += a * POWER.perDamage; return true; }
      case 'armor': { const a = rollTagValue('armor') || 5; effects.push({ effectType: 'armor', armor: { amount: a } }); lines.push(`Gain ${a} [[armor]]`); power += a * POWER.perArmor; return true; }
      case 'heal': { const a = rollTagValue('heal') || 5; effects.push({ effectType: 'heal', heal: { amount: a } }); lines.push(`[[Heal]] ${a} HP`); power += a * POWER.perHeal; return true; }
      case 'attack': { const a = rollTagValue('attack') || 1; effects.push({ effectType: 'gain_attack', gainAttack: { amount: a } }); lines.push(`Gain ${a} [[attack]]`); power += a * POWER.perAttack; return true; }
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
      case 'damage': {
        const amount = roll('damage', 5);
        effects.push({ effectType: 'damage', damage: { amount } });
        lines.push(`Deal ${amount} [[damage]]`);
        power += amount * POWER.perDamage;
        break;
      }
      case 'armor': {
        const amount = roll('armor', 5);
        effects.push({ effectType: 'armor', armor: { amount } });
        lines.push(`Gain ${amount} [[armor]]`);
        power += amount * POWER.perArmor;
        break;
      }
      case 'heal': {
        const amount = roll('heal', 5);
        effects.push({ effectType: 'heal', heal: { amount } });
        lines.push(`[[Heal]] ${amount} HP`);
        power += amount * POWER.perHeal;
        break;
      }
      case 'attack': {
        const amount = roll('attack', 1);
        effects.push({ effectType: 'gain_attack', gainAttack: { amount } });
        lines.push(`Gain ${amount} [[attack]]`);
        power += amount * POWER.perAttack;
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
        // With an element: drain that color. Without: drain EVERY color
        // (stronger, weighted accordingly in the power score).
        const amount = roll('drain', 2);
        const color = takeElement({ allowSkull: false });
        const drainMana = color ? { amount, color } : { amount };
        effects.push({ effectType: 'drain_mana', drainMana });
        lines.push(color
          ? `Drain ${amount} ${TILE_LABEL[color]} [[mana]] from the enemy`
          : `Drain ${amount} [[mana]] of every color from the enemy`);
        power += amount * (color ? POWER.perManaDrainedOneColor : POWER.perManaDrainedAllColors);
        break;
      }
      case 'create': {
        // wild + create → WILD tiles (the standard player joker — Malakor's
        // Thrall is the enemy-flavored variant). Otherwise the element's tile
        // type (skull allowed — creating Skulls is a real strategy); with
        // neither, a color is rolled once now.
        const amount = roll('create', 3);
        let type;
        if (modifiers.has('wild') && !used.has('wild')) {
          used.add('wild');
          type = 'wild';
        } else {
          type = takeElement() || pickRandom(COST_COLORS);
        }
        emitCreate(amount, type);
        break;
      }
      case 'convert': {
        // By-type conversion is the DEFAULT read of "convert": with two
        // elements all <el1> become <el2> (pick order); with one element a
        // random other color becomes it. The precise targeted convert only
        // happens when the player explicitly wove a `tile` (single) or
        // `area` (3×3) shape.
        const from = takeElement();
        const wantsTargeted = (shapes.has('tile') && !used.has('tile'))
          || (shapes.has('area') && !used.has('area'));
        if (wantsTargeted && !targeting) {
          const toColor = from || pickRandom(COST_COLORS);
          const radius = takeShape('area') ? 1 : 0;
          if (radius === 0) takeShape('tile');
          targeting = { targeting: 'board_tile', area: { radius } };
          effects.push({ effectType: 'convert_tile', convertTile: { type: toColor } });
          const what = radius > 0 ? '[[tiles]] in a 3x3 area' : 'a [[tile]]';
          lines.push(`[[Change]] ${what} into ${toColor === 'skull' ? '[[Skulls]]' : TILE_LABEL[toColor]}`);
          power += radius > 0 ? POWER.convertArea : POWER.convertTile;
        } else {
          const second = takeElement();
          let fromType = from;
          let toType = second;
          if (fromType && !toType) {
            // One element: it's the DESTINATION; convert a random other color.
            toType = fromType;
            fromType = pickRandom(COST_COLORS.filter((c) => c !== toType));
          } else if (!fromType) {
            // No elements: roll both (distinct).
            toType = pickRandom(COST_COLORS);
            fromType = pickRandom(COST_COLORS.filter((c) => c !== toType));
          }
          effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from: fromType, to: toType } });
          lines.push(`[[Change]] all ${fromType === 'skull' ? '[[Skulls]]' : `${TILE_LABEL[fromType]} [[tiles]]`} into ${toType === 'skull' ? '[[Skulls]]' : TILE_LABEL[toType]}`);
          power += POWER.convertByType;
        }
        break;
      }
      case 'change': {
        // Targeted single-tile recolor (à la the Mage's Arcane Inscription).
        // The destination COLOR is influenced by a woven element (else rolled);
        // an `area` shape widens it to a 3×3. If the single targeting slot is
        // already claimed, it degrades to a by-type recolor (no targeting).
        const toColor = takeElement({ allowSkull: true }) || pickRandom(COST_COLORS);
        const toLabel = toColor === 'skull' ? '[[Skulls]]' : TILE_LABEL[toColor];
        if (!targeting) {
          const radius = takeShape('area') ? 1 : 0;
          if (radius === 0) takeShape('tile');
          targeting = { targeting: 'board_tile', area: { radius } };
          effects.push({ effectType: 'convert_tile', convertTile: { type: toColor } });
          const what = radius > 0 ? '[[tiles]] in a 3x3 area' : 'a [[tile]]';
          lines.push(`[[Change]] ${what} into ${toLabel}`);
          power += radius > 0 ? POWER.convertArea : POWER.convertTile;
        } else {
          const fromType = pickRandom(COST_COLORS.filter((c) => c !== toColor));
          effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from: fromType, to: toColor } });
          lines.push(`[[Change]] all ${TILE_LABEL[fromType]} [[tiles]] into ${toLabel}`);
          power += POWER.convertByType;
        }
        break;
      }
      case 'destroy':
      case 'explode': {
        if (targeting) {
          // A spell has only ONE targeted slot — a second targeted action is a
          // wasted pick (a downside the player could have avoided), NOT a free
          // vent into damage.
          used.delete(action);
          markWasted(action, 'spell can have only one targeted effect');
          break;
        }
        const isExplode = action === 'explode';
        const shape = takeShape(...(isExplode ? ['area'] : ['row', 'column', 'area', 'tile'])) || 'default';
        emitDestroyShaped(shape === 'default' ? 'area-default' : shape, isExplode);
        break;
      }
      default:
        used.delete(action);
        break;
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
      const a = rollTagValue('damage') || 4;
      effects.push({ effectType: 'damage', damage: { amount: a } });
      lines.push(`Deal ${a} [[damage]]`);
      power += a * POWER.perDamage;
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
    const amount = rollTagValue('damage') || 4; // fresh roll — 'damage' isn't in the bag
    effects.push({ effectType: 'damage', damage: { amount } });
    lines.push(`Deal ${amount} [[damage]]`);
    power += amount * POWER.perDamage;
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
  const elementColors = elements.filter((c) => COST_COLORS.includes(c)); // pick order, skull excluded
  let cost = buildCost(total, elementColors);
  if (!cost) cost = { [rollCostColor(elements, primaryAction)]: total };
  // Paying with a color COUNTS as using that element tag (it isn't wasted).
  for (const c of Object.keys(cost)) if (elements.includes(c)) used.add(c);
  // Dominant (most-paid) cost color — drives the resolve-sound color + logging.
  const costColor = Object.entries(cost).sort((a, b) => b[1] - a[1])[0][0];

  // ── Choice-driven downsides: redundant/incompatible picks contribute NOTHING
  //    (opportunity cost) and are surfaced with a reason. Deterministic, so a
  //    weak weave reads as "I could have picked better", not a dice roll. ──
  if (modifiers.has('wild') && !used.has('wild')) {
    markWasted('wild', 'no Create for Wild to empower');
  }
  for (const shape of ['row', 'column', 'area', 'tile']) {
    if (shapes.has(shape) && !used.has(shape)) markWasted(shape, 'no action used this shape');
  }
  for (const el of elements) {
    if (!used.has(el)) {
      markWasted(el, el === 'skull' ? 'Skull cannot pay a cost' : 'no effect or cost used this color');
    }
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
    woven: { recipe: tagIds, rolledValues, power, injectedTags },
  };

  const summary = tagIds
    .map((tid) => (tid in rolledValues ? `${getTagLabel(tid)}(${rolledValues[tid]})` : getTagLabel(tid)))
    .join(' + ');
  const costStr = Object.entries(cost).map(([c, a]) => `${a} ${c}`).join(' + ');
  console.log(`[SkillSynth] Woven "${name}" — [${summary}] → power ${Math.round(power)}, cost ${costStr}`
    + (unusedTags.length ? `, wasted: ${unusedTags.map((t) => `${t} (${wastedReasons[t]})`).join('; ')}` : ''));

  return { recipe: tagIds, groups, rolledValues, usedTags, unusedTags, wastedReasons, injectedTags, power, skill, summary };
}
