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
 * ── Injection ("the weave surges") ──────────────────────────────────────────
 * Tags should almost never go inert — when a tag has nothing to attach to, the
 * weave INJECTS a complementary effect instead (per-rule chances live in
 * weaveConfig.INJECTION_CONFIG):
 *   - `wild` with no create        → conjures Thrall tiles anyway
 *   - `lock` (no mechanic yet)     → "locks down" the enemy: applies Frozen
 *   - orphan shape (row/col/area/tile) → injects a destroy of that shape
 *   - orphan `random`              → chaotic surge: gain rolled-color mana
 *   - element used by NOTHING (not even the cost color) → conjures its tiles
 *   - a 2nd targeted action        → vents as direct damage instead
 *   - a PURE damage spell          → surges an Extra Turn (damage alone feels
 *                                    weak — the surge makes it tempo-positive)
 * Injected contributions are reported in `injectedTags` (shown as "The weave
 * surged" on the result screen); whatever still resolves to nothing lands in
 * `unusedTags` ("Inert threads") — rare by design.
 *
 * ── RNG ─────────────────────────────────────────────────────────────────────
 * All magnitudes are HIDDEN per-tag rolls from weaveConfig.TAG_VALUE_TABLES
 * (the "high-roll" layer — e.g. create rolls 3–12). The mana cost AMOUNT is
 * rolled from weaveConfig.MANA_COST_CONFIG (5..8 band, floor+ceiling rise with
 * the computed POWER score). The cost COLOR is a weighted roll
 * (weaveConfig.COST_COLOR_WEIGHTS): bag elements weigh heavily and the primary
 * action's affinity moderately, but neither is a hard rule. Rolls happen
 * exactly once, here — the resulting skill is a plain stored object.
 *
 * Power weights / name tables / cost-color affinities are the tunable
 * constants below; all probability tables live in weaveConfig.js.
 */

import {
  rollTagValue,
  rollManaCost,
  pickWeightedEntry,
  INJECTION_CONFIG,
  COST_COLOR_WEIGHTS,
} from './weaveConfig.js';
import { getTag, getTagLabel, TAG_CATEGORY } from './skillWeaveTags.js';

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

/** Primary action → cost-color AFFINITY (a weight, not a rule — see
 *  COST_COLOR_WEIGHTS in weaveConfig). */
const ACTION_COST_AFFINITY = Object.freeze({
  damage: 'red', attack: 'red', explode: 'red', destroy: 'red',
  armor: 'blue', heal: 'green', create: 'green',
  gain: 'yellow', convert: 'purple', drain: 'purple',
});

/** Primary action → resolve SFX (SoundConfig keys). */
const ACTION_SOUND = Object.freeze({
  damage: 'skill_bash', attack: 'skill_encroach',
  armor: 'skill_defend', heal: 'skill_oungan',
  create: 'skill_oungan', destroy: 'skill_fracture',
  explode: 'skill_explode', convert: 'skill_explode',
  gain: 'skill_oungan', drain: 'skill_doomsong',
});
const DEFAULT_SOUND = 'sfx_skill_cast';

/**
 * Power-score weights — how much each emitted effect contributes to the
 * spell's POWER (which drives the mana-cost tier via MANA_COST_CONFIG).
 */
const POWER = Object.freeze({
  perDamage: 1,
  perArmor: 0.9,
  perHeal: 0.8,
  perManaGained: 1,
  perManaDrainedOneColor: 1,
  perManaDrainedAllColors: 2.5,
  perAttack: 5,          // permanent for the battle
  perTileCreated: 1,
  thrallTileMult: 1.5,   // wild tiles are worth more per tile
  destroyTile: 2,        // single-tile snipe
  destroyRow: 8,
  destroyColumn: 8,
  destroyArea: 9,        // 3×3
  destroyAreaWide: 16,   // 5×5 (explode + area)
  convertByType: 8,      // all of one color → another
  convertTile: 3,        // targeted single tile
  convertArea: 7,        // targeted 3×3
  perDebuffTurn: 4,
  perBuffTurn: 3,
  extraTurn: 8,
});

// ── Name generation pools ──
// Plenty of variety on purpose: adjectives per element × nouns per action ×
// suffixes per tag × patterns. Extend freely — names are pure flavor.

/** Element tag → name adjectives (one is picked at random). */
const ELEMENT_ADJ = Object.freeze({
  red:    ['Crimson', 'Scarlet', 'Searing', 'Ember', 'Blood-Forged', 'Cindering', 'Pyric'],
  blue:   ['Tidal', 'Azure', 'Abyssal', 'Frost-Wreathed', 'Drowned', 'Riptide', 'Mistbound'],
  green:  ['Verdant', 'Thorned', 'Wildgrown', 'Briar', 'Sporebound', 'Evergreen', 'Rooted'],
  yellow: ['Storm-Called', 'Gilded', 'Radiant', 'Thundering', 'Sunforged', 'Static', 'Dazzling'],
  purple: ['Umbral', 'Void-Touched', 'Eldritch', 'Duskwoven', 'Starless', 'Occult', 'Whispering'],
  skull:  ['Deathly', 'Grave-Born', 'Skeletal', 'Dread', 'Charnel', 'Tombward', 'Mortal'],
});

/** Primary action → name noun candidates. */
const ACTION_NOUNS = Object.freeze({
  damage:  ['Strike', 'Lash', 'Rend', 'Reckoning', 'Scourge', 'Sundering', 'Spike', 'Verdict'],
  armor:   ['Bulwark', 'Aegis', 'Ward', 'Carapace', 'Rampart', 'Shell', 'Vigil', 'Bastion'],
  heal:    ['Mending', 'Renewal', 'Restoration', 'Blessing', 'Salve', 'Communion', 'Respite'],
  create:  ['Genesis', 'Wellspring', 'Conjuring', 'Blooming', 'Summons', 'Manifest', 'Seeding'],
  destroy: ['Ruin', 'Shatter', 'Unmaking', 'Collapse', 'Erasure', 'Demolition', 'Cull'],
  convert: ['Transmutation', 'Alchemy', 'Reshaping', 'Inversion', 'Metamorphosis', 'Refrain'],
  gain:    ['Boon', 'Font', 'Windfall', 'Tribute', 'Harvest', 'Offering', 'Bounty'],
  drain:   ['Siphon', 'Leeching', 'Hunger', 'Theft', 'Tithe', 'Parch', 'Drought'],
  attack:  ['Ferocity', 'Whetstone', 'Bloodlust', 'Warcry', 'Honing', 'Frenzy', 'Edge'],
  explode: ['Cataclysm', 'Detonation', 'Conflagration', 'Starburst', 'Eruption', 'Concussion'],
});
const DEFAULT_NOUNS = Object.freeze(['Weaving', 'Working', 'Rite', 'Invocation', 'Sigil', 'Incantation']);

/**
 * Any bag tag → optional name suffixes ("Strike of Winter"). Kept SHORT and
 * "the"-free on purpose — names must fit NAME_MAX_LENGTH (~20 chars of UI
 * space on the skill button).
 */
const TAG_SUFFIXES = Object.freeze({
  extra_turn: ['of Haste', 'of Tempo'],
  wild:       ['Unbound', 'of Chaos'],
  lock:       ['of Binding', 'of Seals'],
  row:        ['of Lines', 'Sweeping'],
  column:     ['of Pillars', 'Falling'],
  area:       ['of Storms', 'Vast'],
  random:     ['of Fortune', 'of Dice'],
  tile:       ['of Marks', 'Precise'],
  skull:      ['of Graves', 'of Bone'],
  silence:    ['of Hush', 'Muting'],
  cripple:    ['of Maiming', 'Laming'],
  enfeeble:   ['of Frailty', 'Sapping'],
  brittle:    ['of Glass', 'Cracking'],
  bleed:      ['of Wounds', 'Rending'],
  frozen:     ['of Winter', 'of Frost'],
  intangible: ['of Mist', 'Phantom'],
  berserk:    ['of Fury', 'Raging'],
  barrier:    ['of Shells', 'Warding'],
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
const NAME_MAX_LENGTH = 20;
/** How many random candidates to try before falling back to the bare noun. */
const NAME_ATTEMPTS = 10;

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

/** Roll a 0–100 percentage chance from INJECTION_CONFIG. */
function chance(pct) {
  return Math.random() * 100 < pct;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Weighted cost-color roll: every color gets a baseline weight; bag elements
 * and the primary action's affinity ADD weight (influence, not a hard rule).
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
  const injected = new Set(); // tag ids describing what the weave injected
  const effects = [];
  const lines = [];      // description lines
  let power = 0;
  let targeting = null;  // { targeting: 'board_tile', area } — one per skill
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
      case 'gain': {
        // Gain mana of the element's color; with no usable element the color
        // is rolled once now (skull can't be a mana color).
        const amount = roll('gain', 3);
        const color = takeElement({ allowSkull: false }) || pickRandom(COST_COLORS);
        effects.push({ effectType: 'gain_mana', gainMana: { color, amount } });
        lines.push(`Gain ${amount} ${TILE_LABEL[color]} [[mana]]`);
        power += amount * POWER.perManaGained;
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
      case 'destroy':
      case 'explode': {
        const isExplode = action === 'explode';
        const shape = takeShape(...(isExplode ? ['area'] : ['row', 'column', 'area', 'tile'])) || 'default';
        if (!emitDestroyShaped(shape === 'default' ? 'area-default' : shape, isExplode)) {
          // Targeting slot already claimed → the destruction VENTS as raw
          // damage instead of fizzling (injection rule).
          if (chance(INJECTION_CONFIG.ventedActionDamages)) {
            const amount = Math.max(3, Math.round((rollTagValue('damage') || 5) * 0.75));
            effects.push({ effectType: 'damage', damage: { amount } });
            lines.push(`Deal ${amount} [[damage]]`);
            power += amount * POWER.perDamage;
            injected.add('damage');
          } else {
            used.delete(action);
          }
        }
        break;
      }
      default:
        used.delete(action);
        break;
    }
  }

  // ── Injection pass ("the weave surges") — see file header ──

  // wild with no create → conjures Wild tiles anyway.
  if (modifiers.has('wild') && !used.has('wild') && chance(INJECTION_CONFIG.wildCreates)) {
    used.add('wild');
    injected.add('create');
    emitCreate(Math.max(2, Math.round((rollTagValue('create') || 3) * 0.75)), 'wild');
  }

  // lock (no board mechanic yet) → locks the ENEMY down: applies Frozen.
  if (modifiers.has('lock') && !used.has('lock') && chance(INJECTION_CONFIG.lockFreezes)) {
    used.add('lock');
    injected.add('frozen');
    effects.push({ effectType: 'apply_status', applyStatus: { id: 'frozen', target: 'opponent', turns: 1 } });
    lines.push('Apply [[Frozen]] for 1 turn');
    power += POWER.perDebuffTurn;
  }

  // Orphan shapes → inject a destroy of that shape (first one wins targeting).
  for (const shape of ['row', 'column', 'area', 'tile']) {
    if (!shapes.has(shape) || used.has(shape) || targeting) continue;
    if (!chance(INJECTION_CONFIG.orphanShapeDestroys)) continue;
    used.add(shape);
    injected.add('destroy');
    emitDestroyShaped(shape);
    break;
  }

  // Orphan `random` → chaotic mana surge.
  if (shapes.has('random') && !used.has('random') && chance(INJECTION_CONFIG.orphanRandomGains)) {
    used.add('random');
    injected.add('gain');
    const amount = Math.max(2, Math.round((rollTagValue('gain') || 3) * 0.6));
    const color = pickRandom(COST_COLORS);
    effects.push({ effectType: 'gain_mana', gainMana: { color, amount } });
    lines.push(`Gain ${amount} ${TILE_LABEL[color]} [[mana]]`);
    power += amount * POWER.perManaGained;
  }

  // ── Cost COLOR (weighted roll — elements/affinity influence, not dictate) ──
  const costColor = rollCostColor(elements, primaryAction);
  // An element whose job is coloring the cost counts as used.
  if (elements.includes(costColor)) used.add(costColor);

  // Elements consumed by NOTHING (not an action, not the cost) → conjure
  // their own tiles instead of going inert.
  for (const el of elements) {
    if (used.has(el) || !chance(INJECTION_CONFIG.unusedElementCreates)) continue;
    used.add(el);
    injected.add('create');
    emitCreate(Math.max(2, Math.round((rollTagValue('create') || 3) * 0.6)), el);
  }

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

  // ── Pure damage spells surge an Extra Turn (damage alone is weak tempo) ──
  const isPureDamage = effects.length > 0 && effects.every((e) => e.effectType === 'damage');
  if (isPureDamage && !modifiers.has('extra_turn') && chance(INJECTION_CONFIG.pureDamageExtraTurn)) {
    injected.add('extra_turn');
    effects.push({ effectType: 'extra_turn' });
    lines.push('Gain an [[extra turn]]');
    power += POWER.extraTurn;
  }

  // ── extra_turn LAST (create_tiles' cascade resets the flag — decision #4) ──
  if (modifiers.has('extra_turn')) {
    used.add('extra_turn');
    effects.push({ effectType: 'extra_turn' });
    lines.push('Gain an [[extra turn]]');
    power += POWER.extraTurn;
  }

  // ── Cost AMOUNT from the final power score ──
  const costRoll = rollManaCost(power);
  const cost = { [costColor]: costRoll.cost };

  // ── Assemble ──
  const name = generateName(tagIds, groups, primaryAction);
  const usedTags = tagIds.filter((id) => used.has(id));
  const unusedTags = tagIds.filter((id) => !used.has(id));
  const injectedTags = [...injected];
  const id = `woven_${tagIds.join('_')}_${Date.now().toString(36)}`;

  const skill = {
    id,
    name,
    description: lines.join('\n') || 'It does... something?',
    icon: null, // filled by SkillWeaveScene from the procedural spell icon
    sound: ACTION_SOUND[primaryAction] || DEFAULT_SOUND,
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
  console.log(`[SkillSynth] Woven "${name}" — [${summary}] → power ${Math.round(power)}, `
    + `cost ${costRoll.cost} ${costColor}`
    + (injectedTags.length ? `, surged: ${injectedTags.join(', ')}` : '')
    + (unusedTags.length ? `, inert: ${unusedTags.join(', ')}` : ''));

  return { recipe: tagIds, groups, rolledValues, usedTags, unusedTags, injectedTags, power, skill, summary };
}
