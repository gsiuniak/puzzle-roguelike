/**
 * sim/relics.mjs — sim-format relic pool for progression runs.
 *
 * A representative subset of the game's relics, expressed with the passive
 * triggers/effects the engine supports (see engine.mjs firePassives + the
 * onBattleStart static modifiers). Used by the progression sim to grant the
 * mock character a random relic per floor and watch its power climb.
 *
 * NOT modeled yet (skipped from the pool): board-touching relics (Gorepike,
 * Unstable Catalyst, Deathbringer/Death Familiar), onTileMatchType relics
 * (Familiars, Scythe — engine doesn't fire that trigger), and
 * attack_per_unspent_mana (Cestus group — dynamic). Add them when the engine
 * grows support; the power numbers will rise accordingly.
 */

// Each entry: { id, rarity, passives: [ {trigger, type, ...payload} ] }
export const RELIC_POOL = [
  // ── attack / damage ──
  { id: 'claymore',       rarity: 'common',    passives: [{ trigger: 'onBattleStart', type: 'modify_stat', stat: 'attack', amount: 3 }] },
  { id: 'tsunami',        rarity: 'legendary', passives: [{ trigger: 'onTurnStart', type: 'gain_attack', amount: 2 }] },
  { id: 'reckoning',      rarity: 'legendary', passives: [{ trigger: 'onTakeDamage', type: 'gain_attack', amount: 1 }] },
  { id: 'slingshot',      rarity: 'common',    passives: [{ trigger: 'onTurnStart', type: 'damage', amount: 1 }] },
  { id: 'trebuchet',      rarity: 'uncommon',  passives: [{ trigger: 'onMatch4Plus', type: 'damage', amount: 1 }] },
  { id: 'thorned_rose',   rarity: 'common',    passives: [{ trigger: 'onTakeDamage', type: 'damage', amount: 1 }] },
  { id: 'funerary_bell',  rarity: 'common',    passives: [{ trigger: 'onBattleStart', type: 'modify_skull_damage', amount: 2 }] },
  // ── defense / sustain ──
  { id: 'aegis',          rarity: 'common',    passives: [{ trigger: 'onTurnStart', type: 'armor', amount: 1 }] },
  { id: 'alabaster_flask',rarity: 'common',    passives: [{ trigger: 'onTurnStart', type: 'heal', amount: 1 }] },
  { id: 'soul_eater',     rarity: 'legendary', passives: [{ trigger: 'onDealDamage', type: 'heal', amount: 3 }] },
  { id: 'evil_eye',       rarity: 'starter',   passives: [{ trigger: 'onIncomingDamage', type: 'reduce_damage', amount: 1 }] },
  // ── economy (mana / spawn) ──
  { id: 'bellows',        rarity: 'common',    passives: [{ trigger: 'onBattleStart', type: 'modify_mana_gain', color: 'red', amount: 1 }] },
  { id: 'flint',          rarity: 'common',    passives: [{ trigger: 'onBattleStart', type: 'modify_spawn_rate', tile: 'red', amount: 10 }] },
  { id: 'catacomb_key',   rarity: 'common',    passives: [{ trigger: 'onBattleStart', type: 'modify_spawn_rate', tile: 'skull', amount: 10 }] },
  { id: 'family_crest',   rarity: 'starter',   passives: [{ trigger: 'onTakeDamage', type: 'gain_mana', color: 'red', amount: 2 }] },
  { id: 'flaming_arrow',  rarity: 'common',    passives: [{ trigger: 'onGainMana', condition: { color: 'red' }, type: 'damage', amount: 1 }] },
  { id: 'prism',          rarity: 'rare',      passives: [
    { trigger: 'onMatch4Plus', type: 'gain_mana', color: 'red', amount: 1 },
    { trigger: 'onMatch4Plus', type: 'gain_mana', color: 'blue', amount: 1 },
    { trigger: 'onMatch4Plus', type: 'gain_mana', color: 'green', amount: 1 },
    { trigger: 'onMatch4Plus', type: 'gain_mana', color: 'yellow', amount: 1 },
    { trigger: 'onMatch4Plus', type: 'gain_mana', color: 'purple', amount: 1 },
  ] },
];

/**
 * Append a random not-yet-owned relic's passives to a combatant DEFINITION
 * (mutates def.passives). Mirrors the game (each relic offered once); falls back
 * to allowing a repeat only once the pool is exhausted.
 * @param {object} def     — combatant definition (mutated)
 * @param {() => number} rng
 * @param {Set<string>} owned — ids already taken (mutated)
 * @returns {string|null} the granted relic id
 */
export function grantRandomRelic(def, rng, owned) {
  const available = RELIC_POOL.filter((r) => !owned.has(r.id));
  const pool = available.length ? available : RELIC_POOL;
  const relic = pool[Math.floor(rng() * pool.length)];
  if (!relic) return null;
  def.passives = [...(def.passives || []), ...relic.passives.map((p) => ({ ...p }))];
  owned.add(relic.id);
  return relic.id;
}
