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
 *   - colored with the keyword's configured color, and
 *   - given an automatic explanatory tooltip (TooltipManager chains).
 *
 * Adding a keyword:
 *   1. Add an entry below keyed by its normalized id (lowercase, single spaces).
 *   2. Give it { id, label, color, description }.
 *   3. (Optional) Add an alias in KEYWORD_ALIASES so other spellings resolve.
 *   4. Reference it from any description with [[Label]] — the label text shown
 *      to the player comes from the `label` field, not from the bracket text.
 *
 * Keyword descriptions may THEMSELVES contain [[keywords]] — the tooltip
 * system builds a depth-limited, de-duplicated chain so nested keywords also
 * get tooltips without infinite recursion.
 */

/** Fallback color for keyword spans whose definition is missing. */
export const KEYWORD_MISSING_COLOR = '#ff6b6b';

/** Default color used when a keyword definition omits its own color. */
export const KEYWORD_DEFAULT_COLOR = '#ffcf5c';

/**
 * Keyword catalog, keyed by normalized id.
 * @type {Record<string, { id:string, label:string, color:string, description:string }>}
 */
export const KEYWORD_DEFINITIONS = {
  create: {
    id: 'create',
    label: 'Create',
    color: '#8fd3ff',
    description: 'Add new [[Tiles]] of the specified type directly to the board.',
  },
  tiles: {
    id: 'tiles',
    label: 'Tiles',
    color: '#cdd6e0',
    description: 'The gems on the board. [[Match]] 3 or more of a kind to clear them.',
  },
  match: {
    id: 'match',
    label: 'Match',
    color: '#ffe08a',
    description: 'Line up 3 or more [[Tiles]] of the same type to clear them and gain rewards. A match of 4 or more grants an [[Extra Turn]].',
  },
  skulls: {
    id: 'skulls',
    label: 'Skulls',
    color: '#d8d2c4',
    description: 'Skull tiles deal [[Damage]] to the enemy when matched or destroyed.',
  },
  mana: {
    id: 'mana',
    label: 'Mana',
    color: '#9d7bff',
    description: 'Spent to cast skills. Each color is gained by matching [[Tiles]] of that color.',
  },
  damage: {
    id: 'damage',
    label: 'Damage',
    color: '#ff7a6b',
    description: 'Reduces a combatant\'s HP. [[Armor]] absorbs damage before it reaches HP.',
  },
  armor: {
    id: 'armor',
    label: 'Armor',
    color: '#7fb0d6',
    description: 'Absorbs incoming [[Damage]] before it reaches HP. Lasts until depleted.',
  },
  heal: {
    id: 'heal',
    label: 'Heal',
    color: '#7ad17a',
    description: 'Restores HP, up to the combatant\'s maximum.',
  },
  attack: {
    id: 'attack',
    label: 'Attack',
    color: '#e8a23d',
    description: 'Added to the [[Damage]] dealt by matched [[Skulls]] and by some skills.',
  },
  'extra turn': {
    id: 'extra turn',
    label: 'Extra Turn',
    color: '#ffd24a',
    description: 'Take another turn immediately after this one. Extra turns do not stack.',
  },
};

/**
 * Alternate spellings → canonical keyword id. Lets authors write the most
 * natural word ([[Skull]], [[Gem]]) and still resolve to the right entry.
 * Keys must be normalized (lowercase, single-spaced).
 */
export const KEYWORD_ALIASES = {
  skull: 'skulls',
  tile: 'tiles',
  gem: 'tiles',
  gems: 'tiles',
  matches: 'match',
  matched: 'match',
  damages: 'damage',
  healing: 'heal',
  'extra-turn': 'extra turn',
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
 * @returns {{ id:string, label:string, color:string, description:string }|null}
 */
export function getKeywordDefinition(raw) {
  const key = normalizeKeywordKey(raw);
  if (!key) return null;
  const canonical = KEYWORD_ALIASES[key] || key;
  return KEYWORD_DEFINITIONS[canonical] || null;
}

export default KEYWORD_DEFINITIONS;
