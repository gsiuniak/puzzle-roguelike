/**
 * skillWeaveTags.js — tag catalog + rarity-weighted draw for the "Weave a Power"
 * (Skill Weave) reward screen.
 *
 * The Skill Weave screen is a staged tag draft: across a variable number of
 * ROUNDS the player builds a skill by choosing one keyword TAG per round. The
 * chosen tags form a "bag" that is later SYNTHESIZED into a concrete spell (see
 * skillSynthesizer.js). This module is the single source of truth for:
 *   - the tag catalog (id → label + category + rarity + icon), and
 *   - the per-round DRAW (which tags an option round offers).
 *
 * ── Draw model (replaces the old positional grammar) ────────────────────────
 * Tags are no longer drawn by slot position ([action, element, shape]). Each
 * round draws its options from ONE global pool, weighted by tag RARITY (see
 * weaveConfig.RARITY_WEIGHTS), with a single soft guarantee: ROUND 0 always
 * offers at least one ACTION tag, so every synthesized spell has a verb to build
 * around. Tags already committed to the recipe are excluded from later rounds
 * (no duplicate slots). Validity/meaning of the resulting bag is resolved at
 * synthesis time, not here — so any combination the player can pick is allowed.
 *
 * The recipe → concrete-skill step is skillSynthesizer.synthesize, which emits
 * a real, castable skill. This module + weaveConfig only define and feed the
 * tag bag.
 */

import { TAG_RARITY, RARITY_WEIGHTS, pickWeightedEntry } from './weaveConfig.js';

/**
 * Tag category buckets. ACTION tags are the "verbs" (the soft round-0 guarantee
 * draws from these). The rest classify how a tag contributes once synthesized.
 *   ACTION   — the verb (damage, create, drain, …)
 *   ELEMENT  — a color / skull the action operates on
 *   SHAPE    — where the action lands (row, area, tile, …)
 *   MODIFIER — alters the spell (extra turn, wild)
 *   STATUS   — a status effect applied to the enemy (logic added later)
 */
export const TAG_CATEGORY = Object.freeze({
  ACTION: 'action',
  ELEMENT: 'element',
  SHAPE: 'shape',
  MODIFIER: 'modifier',
  STATUS: 'status',
});

/**
 * Tag catalog — keyed by tag id. Each entry:
 *   id       — stable identifier (used in recipes + synthesis)
 *   label    — display text shown on the option plaque + recipe slot
 *   category — TAG_CATEGORY bucket (drives the round-0 action guarantee + synth)
 *   rarity   — TAG_RARITY tier (drives draw frequency via RARITY_WEIGHTS)
 *   icon     — AssetManager key for the small gold icon (null → placeholder)
 *
 * Rarity assignments below are a tunable BASELINE — basic colors/verbs are
 * common, board-warping and status tags are rarer. Adjust freely; the draw and
 * the rarity-suffixed option art both read straight from `rarity`.
 *
 * Icons: tags with art in the `ui_spritesheet_skill_weave_icons` spritesheet
 * point their `icon` at the matching sliced-sprite key (`weave_icon_<id>`,
 * sliced out by AssetManager.addSpriteSheet — see main.js SPRITESHEET_MAP). Tags
 * with NO equivalent sprite keep `icon: null` and fall back to the shared gold-
 * flame placeholder (`skill_weave_tag_test`) via getTagIcon(). Wire more icon
 * keys here as art lands.
 *
 * Hidden value rolls (e.g. `create` → 3..12) are NOT here — they live in
 * weaveConfig.TAG_VALUE_TABLES, keyed by the same id.
 */
export const SKILL_WEAVE_TAGS = Object.freeze({
  // ── Elements (the match-3 colors + skull) ──
  red:    { id: 'red',    label: 'Red',    category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_red' },
  blue:   { id: 'blue',   label: 'Blue',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: null },
  green:  { id: 'green',  label: 'Green',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_green' },
  yellow: { id: 'yellow', label: 'Yellow', category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_yellow' },
  purple: { id: 'purple', label: 'Purple', category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_purple' },
  skull:  { id: 'skull',  label: 'Skull',  category: TAG_CATEGORY.ELEMENT, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_skull' },

  // ── Actions (the verb the skill performs) ──
  // Damage comes in two TYPES: Strike is a damaging spell that scales with
  // Attack, Blast is a damaging spell that scales with Magic (the scaling
  // MULTIPLIER is rolled at synthesis — see weaveConfig DAMAGE_SCALING_WEIGHTS).
  // Both reuse the damage icon for now. These are distinct from the `attack` /
  // `magic` action tags below, which permanently RAISE those stats.
  strike: { id: 'strike', label: 'Strike', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON, icon: 'weave_icon_damage' },
  blast:  { id: 'blast',  label: 'Blast',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON, icon: 'weave_icon_damage' },
  // `poison` is the THIRD damage-type action — a damage-over-time: it applies
  // POISON stacks (which tick for their count at turn end, then halve). Its
  // preferred cost color is GREEN, the application scales with Magic, and (like
  // strike/blast) `greater` amplifies it and `skull` adds "+N per Skull on the
  // board". Synthesized into an apply_poison effect. See decision #39.
  // DISABLED: poison is currently excluded from the weave draw + synthesis (the
  // `disabled` flag drops it from DRAWABLE_TAG_IDS and the synthesizer's random/
  // surge pool). All poison machinery (emitPoison, the apply_poison effect, the
  // Poison Dart skill, Poison Vial relic) is LEFT INTACT — remove `disabled` to
  // re-enable woven poison. See decision #39.
  poison:  { id: 'poison',  label: 'Poison',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_damage', disabled: true },
  armor:   { id: 'armor',   label: 'Armor',   category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_armor' },
  // `barrier` is a one-round MAGIC shield (an ACTION, not a status): like armor
  // it absorbs damage as a temporary-HP pool, but scales with Magic (twice as
  // effectively as armor scales with Attack) and expires at the caster's next
  // turn. Synthesized into a `barrier` effect. No dedicated icon yet → placeholder.
  barrier: { id: 'barrier', label: 'Barrier', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  create:  { id: 'create',  label: 'Create',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_create' },
  destroy: { id: 'destroy', label: 'Destroy', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  convert: { id: 'convert', label: 'Convert', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE, icon: 'weave_icon_convert' },
  // `change` is the targeted single-tile recolor (à la the Mage's Arcane
  // Inscription) — change one tile into a color INFLUENCED by a woven element.
  change:  { id: 'change',  label: 'Change',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_convert' },
  heal:    { id: 'heal',    label: 'Heal',    category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  drain:   { id: 'drain',   label: 'Drain',   category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE,     icon: null },
  attack:  { id: 'attack',  label: 'Attack',  category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_attack' },
  // `magic` is the counterpart to `attack`: it permanently raises the caster's
  // Magic stat for the rest of the battle (boosting Blast + any magic-scaling
  // effect). No dedicated icon yet → placeholder.
  magic:   { id: 'magic',   label: 'Magic',   category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  explode: { id: 'explode', label: 'Explode', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE,     icon: 'weave_icon_explode' },
  // Shuffle randomizes the board and ALWAYS grants an extra turn (synthesizer-forced).
  shuffle: { id: 'shuffle', label: 'Shuffle', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.LEGENDARY,     icon: null },
  // `transmute` is a MANA-pool economy action: it converts your OTHER mana into a
  // woven destination color (a battery for next turn). No board targeting — see
  // skillSynthesizer emitTransmute. See decision #40.
  transmute: { id: 'transmute', label: 'Transmute', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE, icon: 'weave_icon_convert' },
  // `consume` deals damage scaling with a built-up pool it then SPENDS — leftover
  // mana of the cost color (or all leftover mana if no color is woven). The same
  // effect type backs an armor/barrier-eating Shield Bash skill. See decision #40.
  consume: { id: 'consume', label: 'Consume', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE, icon: 'weave_icon_damage' },
  // `mark` banks a FLAT bonus onto your NEXT damage instance — persists until
  // consumed, so it never depends on Extra Turn. See decision #40.
  mark: { id: 'mark', label: 'Mark', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.UNCOMMON, icon: null },
  // `lock` is a TARGETED control tool: the player clicks a tile and every tile
  // of that color becomes unmatchable + unmovable (for BOTH sides) for 2-3 turns.
  // Claims the single targeting slot. See decision #40.
  lock: { id: 'lock', label: 'Lock', category: TAG_CATEGORY.ACTION, rarity: TAG_RARITY.RARE, icon: null },

  // ── Shapes / targets (where the action lands) ──
  row:    { id: 'row',    label: 'Row',    category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_row' },
  column: { id: 'column', label: 'Column', category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.UNCOMMON, icon: 'weave_icon_column' },
  area:   { id: 'area',   label: 'Area',   category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.RARE,     icon: 'weave_icon_area' },
  tile:   { id: 'tile',   label: 'Tile',   category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_tile', disabled: true },
  random: { id: 'random', label: 'Random', category: TAG_CATEGORY.SHAPE, rarity: TAG_RARITY.COMMON,   icon: 'weave_icon_random' },

  // ── Modifiers (alter the spell as a whole) ──
  extra_turn: { id: 'extra_turn', label: 'Extra Turn', category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.LEGENDARY, icon: 'weave_icon_extra_turn' },
  // `wild` reads as a TILE TYPE in synthesis (a create/convert/change target);
  // its floor is "create Wild tiles", so it never fizzles.
  wild:       { id: 'wild',       label: 'Wild',       category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.LEGENDARY, icon: null },
  // `all` is a scope qualifier: it upgrades `change`→mass convert, `destroy`+a
  // color→board-wide color wipe, and boosts `create`'s tile count.
  all:        { id: 'all',        label: 'All',        category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.UNCOMMON,  icon: null },
  // `greater` is a magnitude qualifier: it multiplies a magnitude verb's output
  // (Create / Strike / Blast / Attack / Magic / Armor / Heal / Drain) OR widens an
  // area destruction (3x3 → 5x5), AND has a chance to surge (extra synergy effect).
  greater:    { id: 'greater',    label: 'Greater',    category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.UNCOMMON,  icon: null },
  // `leech` is a lifesteal qualifier: it heals the caster for a PERCENT of the
  // damage a Strike/Blast in the same weave deals. Needs a damage verb to attach
  // to (else it's a wasted pick). See decision #40.
  leech:      { id: 'leech',      label: 'Leech',      category: TAG_CATEGORY.MODIFIER, rarity: TAG_RARITY.UNCOMMON,  icon: null },

  // ── Status effects (synthesized into apply_status effects — debuffs hit the
  //    enemy, buffs (intangible/berserk) buff the caster) ──
  silence:    { id: 'silence',    label: 'Silence',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  cripple:    { id: 'cripple',    label: 'Cripple',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  enfeeble:   { id: 'enfeeble',   label: 'Enfeeble',   category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  brittle:    { id: 'brittle',    label: 'Brittle',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  intangible: { id: 'intangible', label: 'Intangible', category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.LEGENDARY, icon: null },
  berserk:    { id: 'berserk',    label: 'Berserk',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.LEGENDARY, icon: null },
  bleed:      { id: 'bleed',      label: 'Bleed',      category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null, disabled: true },
  frozen:     { id: 'frozen',     label: 'Frozen',     category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.RARE,      icon: null },
  // `reflect` is a self BUFF: for N turns the caster STILL takes damage but
  // ALSO deals the same amount back to the attacker (see statusEffects
  // `reflecting`). The rolled value is its DURATION. Decision #40.
  reflect:    { id: 'reflect',    label: 'Reflect',    category: TAG_CATEGORY.STATUS, rarity: TAG_RARITY.UNCOMMON,      icon: null },
});

/** Default tag-icon asset key (gold flame placeholder from the mock). */
export const DEFAULT_TAG_ICON = 'skill_weave_tag_test';

/** All tag ids, frozen. */
const ALL_TAG_IDS = Object.freeze(Object.keys(SKILL_WEAVE_TAGS));
/** The global DRAW pool — all tags except any flagged `disabled` (e.g. poison). */
const DRAWABLE_TAG_IDS = Object.freeze(ALL_TAG_IDS.filter((id) => !SKILL_WEAVE_TAGS[id].disabled));

// ═══════════════════════════════════════════════════════════
// Catalog lookups
// ═══════════════════════════════════════════════════════════

/**
 * Resolve a tag id to its catalog entry.
 * @param {string} id
 * @returns {object|null}
 */
export function getTag(id) {
  return SKILL_WEAVE_TAGS[id] || null;
}

/**
 * Display label for a tag id (falls back to the raw id).
 * @param {string} id
 * @returns {string}
 */
export function getTagLabel(id) {
  const tag = getTag(id);
  return tag ? tag.label : String(id || '');
}

/**
 * Icon asset key for a tag id (falls back to the shared placeholder).
 * @param {string} id
 * @returns {string}
 */
export function getTagIcon(id) {
  const tag = getTag(id);
  return (tag && tag.icon) || DEFAULT_TAG_ICON;
}

/**
 * Rarity tier for a tag id (falls back to common).
 * @param {string} id
 * @returns {string} a TAG_RARITY value
 */
export function getTagRarity(id) {
  const tag = getTag(id);
  return (tag && tag.rarity) || TAG_RARITY.COMMON;
}

// ═══════════════════════════════════════════════════════════
// Rarity-weighted draw
// ═══════════════════════════════════════════════════════════

/**
 * Pick one tag id from `ids`, weighted by each tag's rarity. Pure; returns null
 * for an empty pool.
 * @param {string[]} ids
 * @returns {string|null}
 */
function pickByRarity(ids, colorBias = null) {
  const entries = ids.map((id) => {
    let w = RARITY_WEIGHTS[getTagRarity(id)] || 0;
    // Slight per-color nudge toward the player's affinity colors (element tags
    // only; non-color tags carry no bias entry → multiplier 1).
    if (colorBias && colorBias[id]) w *= colorBias[id];
    return [id, w];
  });
  return pickWeightedEntry(entries);
}

/** Fisher–Yates shuffle on a copy. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draw the option tags for one round, rarity-weighted, with no repeats within
 * the round and excluding tags already committed to the recipe.
 *
 * Soft action guarantee: when `guaranteeAction` is true (default for round 0)
 * at least one ACTION-category tag is included, so the bag always has a verb.
 *
 * @param {object} opts
 * @param {number}   [opts.roundIndex=0]  0-based round number
 * @param {string[]} [opts.chosen=[]]     tag ids already committed (excluded)
 * @param {number}   [opts.count=3]       how many options to show (2–4)
 * @param {boolean}  [opts.guaranteeAction] force ≥1 action (defaults to round 0)
 * @param {Object<string,number>} [opts.colorBias] per-color draw-weight multiplier
 *   (element tag id → factor) — nudges the draw toward the player's affinity colors.
 * @returns {string[]} the drawn tag ids (shuffled display order)
 */
export function drawTagsForRound({ roundIndex = 0, chosen = [], count = 3, guaranteeAction, colorBias = null } = {}) {
  const exclude = new Set(chosen);
  const wantAction = guaranteeAction != null ? guaranteeAction : roundIndex === 0;
  const picks = [];

  // Soft guarantee: seed one rarity-weighted ACTION tag first (no color bias —
  // actions aren't colors).
  if (wantAction) {
    const actionPool = DRAWABLE_TAG_IDS.filter(
      (id) => !exclude.has(id) && SKILL_WEAVE_TAGS[id].category === TAG_CATEGORY.ACTION,
    );
    const a = pickByRarity(actionPool);
    if (a) { picks.push(a); exclude.add(a); }
  }

  // Fill the rest from the global pool (element tags nudged by colorBias).
  while (picks.length < count) {
    const pool = DRAWABLE_TAG_IDS.filter((id) => !exclude.has(id));
    const id = pickByRarity(pool, colorBias);
    if (!id) break;
    picks.push(id);
    exclude.add(id);
  }

  // Shuffle so a guaranteed action isn't always in the first slot.
  return shuffle(picks);
}
