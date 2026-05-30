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
 * Selection is currently uniform-random (pickRandomRelics). The structure is
 * intentionally split so a future rarity-weighted selector
 * (selectRelicRewardsByRarity) can replace the random pick without touching
 * callers.
 */

import RELIC_CATALOG, { RELIC_RARITY } from './relicCatalog.js';

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
 * Generate the relic reward options to offer after a battle.
 *
 * Excludes starter relics and any relics the player already owns, then picks
 * `count` at random. Swap the pickRandomRelics call for
 * selectRelicRewardsByRarity() to move to rarity-weighted odds later.
 *
 * @param {object} [opts]
 * @param {number} [opts.count=3]
 * @param {object|null} [opts.playerRunState] — run state (reads .relics for ownership)
 * @returns {object[]} relic definitions to display as reward options
 */
export function generateRelicRewardOptions({ count = 3, playerRunState = null } = {}) {
  const ownedIds = collectOwnedRelicIds(playerRunState);
  const eligible = getEligibleRelicRewards({
    excludeStarterRelics: true,
    excludeOwnedIds: ownedIds,
  });
  return pickRandomRelics(eligible, count);
}

/**
 * Future: rarity-weighted reward selection.
 * Will weight the eligible pool by per-rarity odds before picking, so rarer
 * relics appear less often. Callers should keep using
 * generateRelicRewardOptions(); this is the planned drop-in replacement for
 * its internal pickRandomRelics step.
 *
 * @returns {object[]} (stub — returns [] until implemented)
 */
export function selectRelicRewardsByRarity(/* { count, playerRunState, rarityOdds } */) {
  // TODO: implement rarity-weighted odds (e.g. common 70% / uncommon 25% / rare 5%).
  return [];
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
