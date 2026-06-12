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
 *     resolve (e.g. `convert` + 2 elements → convert all <el1> into <el2>;
 *     `create` + `wild` → create Thrall tiles; `destroy` + `row` → targeted
 *     row destruction).
 *   - STATUS tags always resolve to apply_status effects (buffs target self,
 *     debuffs the opponent), with rolled durations.
 *   - `extra_turn` appends an extra_turn effect LAST (a create_tiles cascade
 *     resets the flag, so ordering is load-bearing — decision #4).
 *   - NOT every tag is used: `lock` has no battle mechanic yet, `wild` without
 *     `create` does nothing, shapes need a compatible action, 3rd+ elements
 *     drop, and only ONE action may claim board targeting. Unused tags are
 *     reported in `unusedTags` (the weave scene shows them as inert).
 *
 * ── RNG ─────────────────────────────────────────────────────────────────────
 * All magnitudes are HIDDEN per-tag rolls from weaveConfig.TAG_VALUE_TABLES
 * (the "high-roll" layer — e.g. create rolls 3–12 tiles), and the mana cost is
 * rolled from weaveConfig.MANA_COST_CONFIG: a 5..8 band whose floor AND
 * ceiling rise as the spell's computed POWER score passes tier thresholds.
 * Rolls happen exactly once, here — the resulting skill is a plain stored
 * object and never re-rolls.
 *
 * Power weights / name tables / cost-color affinities are the tunable
 * constants below; roll tables live in weaveConfig.js.
 */

import { rollTagValue, rollManaCost } from './weaveConfig.js';
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

/** Primary action → cost color when the bag has no usable element. */
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

/** Element tag → name adjective. */
const ELEMENT_ADJ = Object.freeze({
  red: 'Crimson', blue: 'Tidal', green: 'Verdant',
  yellow: 'Storm', purple: 'Umbral', skull: 'Deathly',
});

/** Primary action → name noun candidates (one is picked at random). */
const ACTION_NOUNS = Object.freeze({
  damage: ['Strike', 'Lash', 'Rend'],
  armor: ['Bulwark', 'Aegis', 'Ward'],
  heal: ['Mending', 'Renewal', 'Restoration'],
  create: ['Genesis', 'Wellspring', 'Conjuring'],
  destroy: ['Ruin', 'Shatter', 'Unmaking'],
  convert: ['Transmutation', 'Alchemy', 'Reshaping'],
  gain: ['Boon', 'Font', 'Windfall'],
  drain: ['Siphon', 'Leeching', 'Hunger'],
  attack: ['Ferocity', 'Whetstone', 'Bloodlust'],
  explode: ['Cataclysm', 'Detonation', 'Conflagration'],
});
const DEFAULT_NOUNS = ['Weaving', 'Working', 'Rite'];

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

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
  /** Consume a shape tag if present and no other action claimed targeting. */
  const takeShape = (...candidates) => {
    for (const s of candidates) {
      if (shapes.has(s) && !used.has(s)) { used.add(s); return s; }
    }
    return null;
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
        // wild + create → Thrall tiles (the joker). Otherwise the element's
        // tile type (skull allowed — creating Skulls is a real strategy);
        // with neither, a color is rolled once now.
        const amount = roll('create', 3);
        let type;
        if (modifiers.has('wild') && !used.has('wild')) {
          used.add('wild');
          type = 'thrall';
        } else {
          type = takeElement() || pickRandom(COST_COLORS);
        }
        effects.push({ effectType: 'create_tiles', createTiles: { amount, type } });
        if (type === 'thrall') lines.push(`[[Create]] ${amount} [[Thrall]] [[tiles]]`);
        else if (type === 'skull') lines.push(`[[Create]] ${amount} [[Skulls]]`);
        else lines.push(`[[Create]] ${amount} ${TILE_LABEL[type]} [[tiles]]`);
        power += amount * POWER.perTileCreated * (type === 'thrall' ? POWER.thrallTileMult : 1);
        break;
      }
      case 'convert': {
        const from = takeElement();
        const to = takeElement();
        if (from && to) {
          // Two elements → convert ALL of one type into the other (the
          // red+convert+green special: order = pick order).
          effects.push({ effectType: 'convert_tiles_by_type', convertByType: { from, to } });
          lines.push(`[[Change]] all ${from === 'skull' ? '[[Skulls]]' : `${TILE_LABEL[from]} [[tiles]]`} into ${to === 'skull' ? '[[Skulls]]' : TILE_LABEL[to]}`);
          power += POWER.convertByType;
        } else {
          // One (or zero) element → targeted convert. Needs the skill's single
          // targeting slot; if another action claimed it, convert goes unused.
          if (targeting) { used.delete(action); break; }
          const toColor = from || pickRandom(COST_COLORS);
          const radius = takeShape('area') ? 1 : 0;
          if (radius === 0) takeShape('tile'); // single-tile is the default shape
          targeting = { targeting: 'board_tile', area: { radius } };
          effects.push({ effectType: 'convert_tile', convertTile: { type: toColor } });
          const what = radius > 0 ? '[[tiles]] in a 3x3 area' : 'a [[tile]]';
          lines.push(`[[Change]] ${what} into ${toColor === 'skull' ? '[[Skulls]]' : TILE_LABEL[toColor]}`);
          power += radius > 0 ? POWER.convertArea : POWER.convertTile;
        }
        break;
      }
      case 'destroy':
      case 'explode': {
        // Board destruction is targeted; only one action gets the targeting slot.
        if (targeting) { used.delete(action); break; }
        const isExplode = action === 'explode';
        const shape = takeShape(...(isExplode ? ['area'] : ['row', 'column', 'area', 'tile']));
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
          // area shape widens an explode to 5×5; default is 3×3
          const radius = isExplode && shape === 'area' ? 2 : 1;
          targeting = { targeting: 'board_tile', area: { radius } };
          effects.push({ effectType: 'destroy_tiles' });
          lines.push(`[[Destroy]] [[tiles]] in a ${radius * 2 + 1}x${radius * 2 + 1} area`);
          power += radius === 2 ? POWER.destroyAreaWide : POWER.destroyArea;
        }
        break;
      }
      default:
        used.delete(action);
        break;
    }
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

  // ── extra_turn LAST (create_tiles' cascade resets the flag — decision #4) ──
  if (modifiers.has('extra_turn')) {
    used.add('extra_turn');
    effects.push({ effectType: 'extra_turn' });
    lines.push('Gain an [[extra turn]]');
    power += POWER.extraTurn;
  }

  // ── Cost: color from the bag's elements (consumed or not — they flavor the
  //    spell), falling back to the primary action's affinity. Skull is never
  //    a cost color, but a skull element still counts as "used" when it
  //    shaped an effect above. ──
  const costRoll = rollManaCost(power);
  const costColor = elements.find((el) => COST_COLORS.includes(el))
    || ACTION_COST_AFFINITY[primaryAction]
    || pickRandom(COST_COLORS);
  // An element whose only job is coloring the cost still counts as used.
  if (elements.includes(costColor)) used.add(costColor);
  const cost = { [costColor]: costRoll.cost };

  // ── Name: element adjective + primary-action noun ──
  const adjEl = elements.find((el) => used.has(el)) || elements[0] || null;
  const noun = pickRandom(ACTION_NOUNS[primaryAction] || DEFAULT_NOUNS);
  const name = adjEl ? `${ELEMENT_ADJ[adjEl]} ${noun}` : `Woven ${noun}`;

  // ── Assemble ──
  const usedTags = tagIds.filter((id) => used.has(id));
  const unusedTags = tagIds.filter((id) => !used.has(id));
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
    woven: { recipe: tagIds, rolledValues, power },
  };

  const summary = tagIds
    .map((tid) => (tid in rolledValues ? `${getTagLabel(tid)}(${rolledValues[tid]})` : getTagLabel(tid)))
    .join(' + ');
  console.log(`[SkillSynth] Woven "${name}" — [${summary}] → power ${Math.round(power)}, `
    + `cost ${costRoll.cost} ${costColor}${unusedTags.length ? `, inert: ${unusedTags.join(', ')}` : ''}`);

  return { recipe: tagIds, groups, rolledValues, usedTags, unusedTags, power, skill, summary };
}
