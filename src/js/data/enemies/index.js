/**
 * data/enemies/index.js — central import point for enemy definitions.
 *
 * Adding a new enemy:
 *   1. Create a new file in this directory (e.g. `orc.js`) that
 *      `export default`s the enemy definition.
 *   2. Import + re-export it below.
 *   3. Add an entry in ENEMIES_BY_ID so lookups work.
 *   4. Register portrait/skill assets in [`main.js` ASSET_MAP](../../main.js).
 *   5. Route map node types to the enemy in [`MapScene._transitionToBattle`](../../scenes/MapScene.js)
 *      when ready to actually spawn it.
 *
 * Each enemy file is self-contained — it references skills/relics by ID
 * via the catalogs in data/skills and data/relics.
 */

import goblin from './goblin.js';

const ENEMIES_BY_ID = {
  goblin,
};

/**
 * Look up an enemy definition by id.
 * Returns null (and warns) if no such enemy is registered.
 * @param {string} id
 * @returns {object|null}
 */
export function getEnemyById(id) {
  const def = ENEMIES_BY_ID[id];
  if (!def) {
    console.warn(`[enemies] Unknown enemy id: "${id}".`);
    return null;
  }
  return def;
}

export { goblin };
export default ENEMIES_BY_ID;
