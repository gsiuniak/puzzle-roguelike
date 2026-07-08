/**
 * scalingConfig.js — damage scaling from combatant stats + dynamic value text.
 *
 * Skills and relics can make a damage effect grow with the OWNER's stats by
 * giving the effect's `damage` payload an individual `scaling` object:
 *
 *     { effectType: 'damage', damage: { amount: 1, scaling: { magic: 1/3 } } }
 *
 * The bonus added on top of the flat `amount` is:
 *
 *     bonus = floor( caster.attack * scaling.attack + caster.magic * scaling.magic )
 *
 * So a per-point multiplier of `1/3` means "+1 per 3 of that stat" (floored).
 * `scaling` is normally an inline `{ attack, magic }` object so each skill/relic
 * tunes its own rate; the shared default rate lives in `DAMAGE_SCALE_PER_POINT`
 * (import it so "+1 per 3" can be retuned globally in one place). A preset name
 * (`'magic'` / `'physical'`) is also accepted for convenience.
 *
 * Scaling is OPT-IN: a damage effect with no `scaling` field is flat. The bonus
 * uses the stats of whoever OWNS the effect (caster / relic owner), so the same
 * field serves players and enemies — enemy effects just omit `scaling` today.
 *
 * ── Dynamic value text (`<<n>>`) ──
 * A description may show the ACTUAL computed amount with `<<n>>` markup (sibling
 * of the `[[keyword]]` system), e.g. "Deal <<1>> [[mag]]". `resolveDynamicText`
 * rewrites each `<<n>>` token with the live `amount + scaledBonus` for the
 * owning combatant; KeywordText renders the result in the dynamic-value color.
 * With no caster it shows the base amount.
 *
 * This is the single place to tune scaling rates.
 */

/**
 * Default per-point scaling multiplier — "+1 damage per 3 of the stat" (floored).
 * Edit this one number to retune every effect that references it.
 */
export const DAMAGE_SCALE_PER_POINT = 1 / 3;

export const DAMAGE_SCALING_PRESETS = {
  _300: 3,
  _250: 2.5,
  _200: 2,
  _150: 1.5,
  _100: 1,
  _75: 3 / 4, // "+3 per 4 of the stat"
  _66: 2 / 3, // "+1 per 1.5 of the stat" — twice as effective as _33 (Barrier/Magic)
  _50: 1 / 2,
  _33: 1/3,
  _25: 1/4,
  _20: 1/5,
  _10: 1/10, // "+1 per 10 of the stat" — Soul Eater + the mana-gain reactor relics
}

/**
 * Convenience presets (so an effect can write `scaling: 'magic'` instead of an
 * inline object). Both forms resolve identically.
 * @type {Record<string, { attack:number, magic:number }>}
 */
export const SCALING_PRESETS = {
  magic:    { attack: 0,                     magic: DAMAGE_SCALE_PER_POINT },
  physical: { attack: DAMAGE_SCALE_PER_POINT, magic: 0                     },
};

/** Matches a <<...>> dynamic-value token (inner has no angle brackets). */
const DYNAMIC_TOKEN_RE = /<<([^<>]*)>>/g;

/**
 * Resolve a `scaling` descriptor (inline object OR preset name) to a concrete
 * `{ attack, magic }` multiplier. Returns null when there is no scaling.
 * @param {string|{attack?:number, magic?:number}|null|undefined} scaling
 * @returns {{ attack:number, magic:number }|null}
 */
export function resolveScaling(scaling) {
  if (!scaling) return null;
  if (typeof scaling === 'string') return SCALING_PRESETS[scaling] || null;
  if (typeof scaling === 'object') return scaling;
  return null;
}

/**
 * The (floored, non-negative) bonus a scaling adds for a given caster.
 * @param {string|object|null|undefined} scaling
 * @param {{attack?:number, magic?:number}|null} caster
 * @returns {number}
 */
export function scaledBonus(scaling, caster) {
  const s = resolveScaling(scaling);
  if (!s || !caster) return 0;
  const fromAttack = (caster.attack || 0) * (s.attack || 0);
  const fromMagic  = (caster.magic  || 0) * (s.magic  || 0);
  const bonus = Math.floor(fromAttack + fromMagic);
  return bonus > 0 ? bonus : 0;
}

/**
 * Final amount for a scalable damage effect: flat base + scaled bonus.
 * @param {number} baseAmount
 * @param {string|object|null|undefined} scaling
 * @param {{attack?:number, magic?:number}|null} caster
 * @returns {number}
 */
export function scaledAmount(baseAmount, scaling, caster) {
  return (baseAmount || 0) + scaledBonus(scaling, caster);
}

/**
 * Rewrite `<<n>>` dynamic-value tokens in a description with the live computed
 * amount of the effects' damage. Each token (in order) pairs with the next
 * scalable `damage` effect; its value becomes `amount + scaledBonus(caster)`.
 * The `<<>>` wrapper is preserved so KeywordText still renders it as a
 * dynamic-colored value. Tokens with no matching effect keep their authored
 * inner text (the base). With no caster the base amount is shown.
 *
 * @param {string} raw — description text (may contain `<<n>>` and `[[kw]]`)
 * @param {Array<object>} effects — the skill/relic effects (damage ones are used)
 * @param {{attack?:number, magic?:number}|null} caster — the effect owner
 * @param {{i:number}} [cursor] — shared occurrence cursor (for multi-line skills)
 * @returns {string}
 */
export function resolveDynamicText(raw, effects, caster, cursor = { i: 0 }) {
  if (raw == null) return raw;
  // Scalable effect types — today damage, heal, armor. Each `<<n>>` token pairs
  // (in order) with the next scalable effect. Authored data never places a
  // non-tokened scalable effect BEFORE a tokened one in the same skill (skills
  // with no `<<n>>` at all, e.g. boom_baby, are simply left untouched), so the
  // by-order pairing never misfires.
  const scalable = (effects || [])
    .map((e) => scalablePayload(e))
    .filter(Boolean);
  return String(raw).replace(DYNAMIC_TOKEN_RE, (full, inner) => {
    const payload = scalable[cursor.i++];
    if (!payload) return full; // no effect to bind → leave authored base
    const val = scaledAmount(payload.amount || 0, payload.scaling, caster);
    return `<<${val}>>`;
  });
}

/**
 * Extract the scalable `{ amount, scaling }` payload from an effect, or null if
 * the effect isn't a scalable type. Keep this in sync with the effect types that
 * use `<<n>>` markup (damage, heal, armor, barrier, apply_poison).
 * @param {object} e
 * @returns {{amount?:number, scaling?:any}|null}
 */
function scalablePayload(e) {
  if (!e) return null;
  if (e.effectType === 'damage' && e.damage) return e.damage;
  if (e.effectType === 'heal' && e.heal) return e.heal;
  if (e.effectType === 'armor' && e.armor) return e.armor;
  if (e.effectType === 'barrier' && e.barrier) return e.barrier;
  // Poison application stacks scale with the caster's stat (Magic). See decision #39.
  if (e.effectType === 'apply_poison' && e.poison) return e.poison;
  // NOTE: `consume` is NOT scalable — it deals 1 damage per N pool units (a fixed
  // divisor, no stat scaling), so it has no `<<n>>` value. See decision #40.
  return null;
}
