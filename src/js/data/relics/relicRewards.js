/**
 * relicRewards.js — post-battle relic reward pool selection.
 *
 * Builds the pool of relics eligible to appear as post-battle rewards and
 * picks a random subset for the reward overlay. Kept separate from
 * relicCatalog.js so the catalog stays a pure data registry.
 *
 * Eligibility rules (see getEligibleRelicRewards):
 *   - Starter relics (rarity 'starter', e.g. character starting relics) are
 *     excluded from the general reward pool.
 *   - Relics the player already owns (runState.relics) are excluded.
 *
 * Selection is RARITY-WEIGHTED (selectRelicRewardsByRarity): each eligible
 * relic's draw chance is proportional to its rarity's weight in
 * RELIC_RARITY_WEIGHTS, so rarer relics show up less often. Tune the drop
 * rates by editing that one table — no other code changes needed.
 * pickRandomRelics (uniform) is kept available for callers that explicitly
 * want unweighted picks.
 */

import RELIC_CATALOG, { RELIC_RARITY } from './relicCatalog.js';

/**
 * Relative drop weights per rarity for reward selection. Higher = more likely
 * to appear. A relic's chance to be drawn ≈ its rarity weight ÷ the summed
 * weight of all eligible relics, so e.g. with the defaults a given common is
 * ~25× as likely to appear as a given legendary.
 *
 * ★ THIS IS THE KNOB ★ — adjust these numbers to retune relic drop rarity.
 * Values are relative (not percentages), so only their ratios matter; scale
 * them however is convenient. A weight of 0 means "never offered as a reward".
 */
export const RELIC_RARITY_WEIGHTS = {
  [RELIC_RARITY.COMMON]:    70,
  [RELIC_RARITY.UNCOMMON]:   20,
  [RELIC_RARITY.RARE]:       15,
  [RELIC_RARITY.LEGENDARY]:   4,
  // Starter relics are filtered out of the pool already; 0 is a safety net.
  [RELIC_RARITY.STARTER]:     0,
};

/**
 * Fallback weight for a relic whose rarity isn't present in
 * RELIC_RARITY_WEIGHTS (e.g. a typo or a new tier not yet added to the table).
 * Keeps such relics offerable rather than silently dropping them.
 */
export const DEFAULT_RELIC_RARITY_WEIGHT = 10;

/**
 * Get all relics eligible to be offered as rewards.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.excludeStarterRelics=true] — drop rarity 'starter' relics
 * @param {string[]} [opts.excludeOwnedIds=[]] — relic ids the player already has
 * @returns {object[]} array of relic definitions (catalog references — do not mutate)
 */
export function getEligibleRelicRewards({ excludeStarterRelics = true, excludeOwnedIds = [] } = {}) {
  const owned = new Set(excludeOwnedIds || []);
  return Object.values(RELIC_CATALOG).filter((relic) => {
    if (excludeStarterRelics && relic.rarity === RELIC_RARITY.STARTER) return false;
    if (owned.has(relic.id)) return false;
    return true;
  });
}

/**
 * Pick up to `count` unique relics at random from the given list.
 * Uses a partial Fisher–Yates shuffle so the result is unbiased and never
 * contains duplicates. Returns fewer than `count` if the pool is too small.
 *
 * @param {object[]} relics
 * @param {number} count
 * @returns {object[]}
 */
export function pickRandomRelics(relics, count) {
  const pool = Array.isArray(relics) ? [...relics] : [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}

/**
 * The weight a single relic contributes to a weighted draw, looked up from its
 * rarity. Unknown rarities fall back to DEFAULT_RELIC_RARITY_WEIGHT.
 * @param {object} relic
 * @param {Object<string, number>} weights — rarity → weight table
 * @returns {number}
 */
function relicRarityWeight(relic, weights) {
  const w = weights[relic && relic.rarity];
  return typeof w === 'number' ? w : DEFAULT_RELIC_RARITY_WEIGHT;
}

/**
 * Pick up to `count` unique relics, weighted by rarity (weighted sampling
 * WITHOUT replacement — no duplicates). Each remaining relic's chance is its
 * rarity weight over the summed weight of all remaining relics; the chosen
 * relic is removed before the next draw. Returns fewer than `count` if the
 * pool is too small.
 *
 * Relics whose weight is 0 are only ever picked as a last resort (once all
 * positively-weighted relics are exhausted), so a 0 weight effectively means
 * "don't offer this" while still degrading gracefully if the pool is tiny.
 *
 * @param {object[]} relics
 * @param {number} count
 * @param {Object<string, number>} [weights=RELIC_RARITY_WEIGHTS]
 * @returns {object[]}
 */
export function pickWeightedRelics(relics, count, weights = RELIC_RARITY_WEIGHTS) {
  const pool = Array.isArray(relics) ? [...relics] : [];
  const n = Math.min(count, pool.length);
  const result = [];

  for (let k = 0; k < n; k++) {
    const total = pool.reduce((sum, r) => sum + relicRarityWeight(r, weights), 0);

    let chosenIdx;
    if (total <= 0) {
      // Every remaining relic has weight 0 — fall back to a uniform pick so we
      // still fill the requested count rather than returning short.
      chosenIdx = Math.floor(Math.random() * pool.length);
    } else {
      let roll = Math.random() * total;
      chosenIdx = pool.length - 1; // safety for float rounding
      for (let i = 0; i < pool.length; i++) {
        roll -= relicRarityWeight(pool[i], weights);
        if (roll < 0) { chosenIdx = i; break; }
      }
    }

    result.push(pool.splice(chosenIdx, 1)[0]);
  }

  return result;
}

/**
 * Generate the relic reward options to offer after a battle.
 *
 * Excludes starter relics and any relics the player already owns, then picks
 * `count` weighted by rarity (see selectRelicRewardsByRarity /
 * RELIC_RARITY_WEIGHTS).
 *
 * Ownership: pass `ownedRelicIds` for the authoritative set the player holds
 * (character starting relics + run-acquired relics — e.g. the resolved ids on
 * the battle player's state). If omitted, falls back to `playerRunState.relics`
 * (run-acquired only — does NOT include character starting relics).
 *
 * @param {object} [opts]
 * @param {number} [opts.count=3]
 * @param {object|null} [opts.playerRunState] — run state (fallback ownership source)
 * @param {string[]|null} [opts.ownedRelicIds] — explicit owned relic ids (preferred)
 * @returns {object[]} relic definitions to display as reward options
 */
export function generateRelicRewardOptions({ count = 3, playerRunState = null, ownedRelicIds = null } = {}) {
  return selectRelicRewardsByRarity({ count, playerRunState, ownedRelicIds });
}

/**
 * Rarity-weighted reward selection. Builds the eligible pool (starter relics +
 * owned relics excluded) and draws `count` unique relics weighted by
 * RELIC_RARITY_WEIGHTS so rarer relics appear less often. Pass a custom
 * `rarityWeights` table to override the defaults for a specific call (e.g. a
 * "boss reward" with richer odds).
 *
 * @param {object} [opts]
 * @param {number} [opts.count=3]
 * @param {object|null} [opts.playerRunState] — run state (fallback ownership source)
 * @param {string[]|null} [opts.ownedRelicIds] — explicit owned relic ids (preferred)
 * @param {Object<string, number>} [opts.rarityWeights=RELIC_RARITY_WEIGHTS]
 * @returns {object[]} relic definitions to display as reward options
 */
export function selectRelicRewardsByRarity({
  count = 3,
  playerRunState = null,
  ownedRelicIds = null,
  rarityWeights = RELIC_RARITY_WEIGHTS,
} = {}) {
  const ownedIds = Array.isArray(ownedRelicIds)
    ? ownedRelicIds
    : collectOwnedRelicIds(playerRunState);
  const eligible = getEligibleRelicRewards({
    excludeStarterRelics: true,
    excludeOwnedIds: ownedIds,
  });
  return pickWeightedRelics(eligible, count, rarityWeights);
}

/**
 * Normalize a run state's owned relics to an array of id strings.
 * runState.relics may hold id strings (current convention) or full objects.
 * @param {object|null} playerRunState
 * @returns {string[]}
 */
function collectOwnedRelicIds(playerRunState) {
  if (!playerRunState || !Array.isArray(playerRunState.relics)) return [];
  return playerRunState.relics
    .map((r) => (typeof r === 'string' ? r : r && r.id))
    .filter(Boolean);
}
