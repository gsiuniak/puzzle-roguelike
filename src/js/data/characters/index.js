/**
 * data/characters/index.js — central import point for character definitions.
 *
 * Adding a new playable character:
 *   1. Create a new file in this directory (e.g. `paladin.js`) that
 *      `export default`s the character definition.
 *   2. Import + re-export it below.
 *   3. Add an entry in CHARACTERS_BY_ID so lookups work.
 *   4. Add an entry in [`characterSelectDefinitions.js`](../characterSelectDefinitions.js)
 *      to make it selectable.
 *   5. Register portrait/skill/relic assets in [`main.js` ASSET_MAP](../../main.js).
 *
 * Each character file is self-contained — it owns its baseStats and references
 * skills/relics by ID via the catalogs in data/skills and data/relics.
 */

import warrior from './warrior.js';
import mage from './mage.js';
import witchDoctor from './witchDoctor.js';

const CHARACTERS_BY_ID = {
  warrior,
  mage,
  witch_doctor: witchDoctor,
};

/**
 * Look up a character definition by id.
 * Returns null (and warns) if no such character is registered.
 * @param {string} id
 * @returns {object|null}
 */
export function getCharacterById(id) {
  const def = CHARACTERS_BY_ID[id];
  if (!def) {
    console.warn(`[characters] Unknown character id: "${id}".`);
    return null;
  }
  return def;
}

export { warrior, mage, witchDoctor };
export default CHARACTERS_BY_ID;
