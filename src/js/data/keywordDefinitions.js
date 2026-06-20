/**
 * keywordDefinitions.js — centralized catalog of inline keywords.
 *
 * Any UI description (relics, skills, enemy abilities, stat text, tutorials…)
 * may mark a word or phrase as a keyword with double-bracket syntax:
 *
 *     '[[Create]] 10 [[Skulls]].'
 *
 * The bracket markup is parsed by systems/keywordParser.js and rendered by
 * ui/KeywordText.js. Each bracketed token is resolved (case-insensitively)
 * against this catalog so it can be:
 *   - displayed without the brackets,
 *   - colored with the single shared keyword color (KEYWORD_COLOR), and
 *   - given an automatic explanatory tooltip (TooltipManager chains).
 *
 * Adding a keyword:
 *   1. Add an entry below keyed by its normalized id (lowercase, single spaces).
 *   2. Give it { id, label, description }.
 *   3. (Optional) Add an alias in KEYWORD_ALIASES so other spellings resolve.
 *   4. Reference it from any description with [[Label]] — the label text shown
 *      to the player comes from the `label` field, not from the bracket text.
 *
 * Styling is intentionally NOT per-keyword: every keyword renders in the same
 * KEYWORD_COLOR so keywords read as one consistent, recognizable category.
 *
 * Keyword descriptions may THEMSELVES contain [[keywords]] — the tooltip
 * system builds a depth-limited, de-duplicated chain so nested keywords also
 * get tooltips without infinite recursion.
 */

/** Single shared color for ALL keywords. Change here to retint every keyword. */
export const KEYWORD_COLOR = '#ead431';

/** Fallback color for keyword spans whose definition is missing. */
export const KEYWORD_MISSING_COLOR = '#ff6b6b';

/**
 * Color for DYNAMIC VALUE spans — the `<<n>>` markup (sibling of `[[keyword]]`)
 * that renders a skill/relic's actual computed damage instead of a static
 * number. Distinct from the gold keyword color so the live value reads as "this
 * is the real, stat-scaled amount". Change here to retint every dynamic value.
 */
export const KEYWORD_DYNAMIC_COLOR = '#8fe39b';

/** @deprecated alias kept for back-compat; keywords use KEYWORD_COLOR now. */
export const KEYWORD_DEFAULT_COLOR = KEYWORD_COLOR;

/**
 * Keyword catalog, keyed by normalized id.
 * @type {Record<string, { id:string, label:string, description:string }>}
 */
export const KEYWORD_DEFINITIONS = {
  change: {
    id: 'change',
    label: 'Change',
    description: 'Turns a specified [[Tile]] into a specific type.',
  },
  'sanguine egg': {
    id: 'sanguine egg',
    label: 'Sanguine Egg',
    description: 'A [[wild]] tile. Left on the board when the Sanguine Phoenix is slain; clear them all within one turn or the Phoenix is reborn.',
  },
  'sanguine phoenix': {
    id: 'sanguine phoenix',
    label: 'Sanguine Phoenix',
    description: 'A reborn horror. When slain it becomes a [[Sanguine Egg]]; clear its eggs within one turn to win, or it destroys them and rises again at full life.',
  },
  convert: {
    id: 'convert',
    label: 'Convert',
    description: 'Turns all specified [[Tile]] type into a specific type.',
  },
  create: {
    id: 'create',
    label: 'Create',
    description: 'Add new [[Tiles]] of the specified type directly to the board.',
  },
  destroy: {
    id: 'destroy',
    label: 'Destroy',
    description: 'Remove [[tiles]] or [[skulls]] from the board and gain their effects.',
  },
  thrall: {
    id: 'thrall',
    label: 'Thrall',
    description: 'A wild [[Tile]] that counts as any type for [[matching]] — it completes a [[Match]] with whatever it lines up beside.',
  },
  wild: {
    id: 'wild',
    label: 'Wild',
    description: 'A [[Tile]] that counts as any type for [[matching]] — it completes a [[Match]] with whatever it lines up beside.',
  },
  harvest: {
    id: 'harvest',
    label: 'Harvest',
    description: 'Consume all [[Thrall]] [[tiles]] on the board for their effect.',
  },
  destroying: {
    id: 'destroying',
    label: 'Destroying',
    description: 'Remove [[tiles]] or [[skulls]] from the board and gain their effects.',
  },
  drain: {
    id: 'drain',
    label: 'Drain',
    description: 'Subtract [[mana]] from the enemy totals.',
  },
  'end turn': {
    id: 'end turn',
    label: 'End Turn',
    description: 'Immediately end your turn, foregoing further actions',
  },
  tile: {
    id: 'tile',
    label: 'Tile',
    description: 'The gems on the board. [[Match]] 3 or more of a kind to clear them.',
  },
  tiles: {
    id: 'tiles',
    label: 'Tiles',
    description: 'The gems on the board. [[Match]] 3 or more of a kind to clear them.',
  },
  match: {
    id: 'match',
    label: 'Match',
    description: 'Line up 3 or more [[Tiles]] of the same type to clear them and gain rewards. A match of 4 or more grants an [[Extra Turn]].',
  },
  matched: {
    id: 'matched',
    label: 'Matched',
    description: 'Line up 3 or more [[Tiles]] of the same type to clear them and gain rewards. A match of 4 or more grants an [[Extra Turn]].',
  },
  matching: {
    id: 'matching',
    label: 'Matching',
    description: 'Line up 3 or more [[Tiles]] of the same type to clear them and gain rewards. A match of 4 or more grants an [[Extra Turn]].',
  },
  skulls: {
    id: 'skulls',
    label: 'Skulls',
    description: 'Skull tiles deal [[Damage]] to the enemy when matched or destroyed.',
  },
  // Singular form — a real entry (not an alias) so [[Skull]] renders "Skull",
  // not "Skulls" (a label resolved via alias would show the plural entry's label).
  skull: {
    id: 'skull',
    label: 'Skull',
    description: 'A Skull tile deals [[Damage]] to the enemy when matched or destroyed.',
  },
  mana: {
    id: 'mana',
    label: 'Mana',
    description: 'Spent to cast skills. Each color is gained by matching [[Tiles]] of that color.',
  },
  damage: {
    id: 'damage',
    label: 'Damage',
    description: 'Reduces a combatant\'s HP. [[Armor]] absorbs damage before it reaches HP.',
  },
  armor: {
    id: 'armor',
    label: 'Armor',
    description: 'Absorbs incoming [[Damage]] before it reaches HP. Lasts until depleted.',
  },
  heal: {
    id: 'heal',
    label: 'Heal',
    description: 'Restores HP, up to the combatant\'s maximum.',
  },
  attack: {
    id: 'attack',
    label: 'Attack',
    description: 'Added to the [[Damage]] dealt by [[matching]] or [[destroying]] [[Skulls]] and by some skills. Some skills and relics scale their damage with Attack.',
  },
  magic: {
    id: 'magic',
    label: 'Magic',
    description: 'A spellcasting stat. Increases [[Mana]] gained from [[matching]] (+1 per 3 Magic), and some skills and relics scale their [[Damage]] with Magic.',
  },
  // Damage TYPES — convey which stat the damage scales with (the actual rate
  // lives on the effect's `scaling`). Used as the damage word itself, e.g.
  // "Deal <<5>> [[mag]]".
  phys: {
    id: 'phys',
    label: 'Dmg',
    description: 'Physical [[Damage]] — scales with the dealer\'s [[Attack]].',
  },
  mag: {
    id: 'mag',
    label: 'MDmg',
    description: 'Magical [[Damage]] — scales with the dealer\'s [[Magic]].',
  },
  'extra turn': {
    id: 'extra turn',
    label: 'Extra Turn',
    description: 'Take another turn immediately after this one. Extra turns do not stack.',
  },
  shuffle: {
    id: 'shuffle',
    label: 'Shuffle',
    description: 'Randomly rearrange every [[tile]] on the board into a fresh layout.',
  },

  // ── Status effects (buffs / debuffs) ──────────────────
  silence: {
    id: 'silence',
    label: 'Silence',
    description: 'A debuff: the afflicted cannot cast skills on their turn.',
  },
  cripple: {
    id: 'cripple',
    label: 'Cripple',
    description: 'A debuff: the afflicted\'s [[Attack]] is reduced to 1.',
  },
  enfeeble: {
    id: 'enfeeble',
    label: 'Enfeeble',
    description: 'A debuff: the afflicted cannot gain [[Mana]] on their turn.',
  },
  brittle: {
    id: 'brittle',
    label: 'Brittle',
    description: 'A debuff: the afflicted takes 1.5x [[Damage]].',
  },
  bleed: {
    id: 'bleed',
    label: 'Bleed',
    description: 'A debuff: the afflicted takes [[Damage]] at the start of each of their turns equal to half the attacker\'s [[Attack]].',
  },
  frozen: {
    id: 'frozen',
    label: 'Frozen',
    description: 'A debuff: the afflicted cannot gain [[Extra Turns]].',
  },
  intangible: {
    id: 'intangible',
    label: 'Intangible',
    description: 'A buff: all incoming [[Damage]] is reduced to 1.',
  },
  berserk: {
    id: 'berserk',
    label: 'Berserk',
    description: 'A buff: deal double [[Damage]] and ignore all effects, but take double [[Damage]].',
  },
  barrier: {
    id: 'barrier',
    label: 'Barrier',
    description: 'A buff: blocks the next instance of [[Skull]] [[Damage]].',
  }
};

/**
 * Alternate spellings → canonical keyword id. Lets authors write the most
 * natural word ([[Skull]], [[Gem]]) and still resolve to the right entry.
 * Keys must be normalized (lowercase, single-spaced).
 */
export const KEYWORD_ALIASES = {
  // (no skull→skulls alias: `skull` is now its own singular entry)
  gem: 'tile',
  gems: 'tiles',
  damages: 'damage',
  healing: 'heal',
  'extra-turn': 'extra turn',
  'extra turns': 'extra turn',
  // Damage-type alternate spellings.
  physical: 'phys',
  'physical damage': 'phys',
  magical: 'mag',
  'magic damage': 'mag',
  // Status effect alternate spellings (adjective / verb forms).
  silenced: 'silence',
  crippled: 'cripple',
  enfeebled: 'enfeeble',
  bleeding: 'bleed',
  freeze: 'frozen',
};

/**
 * Normalize a raw bracket token into a lookup key: trimmed, lowercased,
 * internal whitespace collapsed to single spaces.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeKeywordKey(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a raw bracket token (any casing / known alias) to its definition.
 * @param {string} raw
 * @returns {{ id:string, label:string, description:string }|null}
 */
export function getKeywordDefinition(raw) {
  const key = normalizeKeywordKey(raw);
  if (!key) return null;
  // A direct definition always wins over an alias, so a real keyword (e.g.
  // 'tile') is never shadowed by an alias of the same spelling (tile→tiles).
  if (KEYWORD_DEFINITIONS[key]) return KEYWORD_DEFINITIONS[key];
  const canonical = KEYWORD_ALIASES[key];
  return (canonical && KEYWORD_DEFINITIONS[canonical]) || null;
}

export default KEYWORD_DEFINITIONS;
