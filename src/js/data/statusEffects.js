/**
 * statusEffects.js — catalog of buff / debuff status effects.
 *
 * A status effect is a temporary, named condition applied to a combatant for a
 * number of turn CYCLES (a cycle = that combatant holding control once). The
 * battle logic (apply / query / tick / per-status behavior) lives in
 * BattleController; this module is the pure DATA catalog — the single place that
 * defines the roster, each status' visual (the `icon`), its kind, and its
 * player-facing text.
 *
 * Mirrors the shape of skillCatalog.js / relicCatalog.js (id-keyed plain object,
 * resolved by id). To add a status: add an entry below (no code changes needed
 * in the catalog itself), then teach BattleController how it behaves.
 *
 * `icon` is the sprite name in `ui_spritesheet_status_effects` (registered in
 * main.js). The sprite names match these keys directly, so they resolve through
 * AssetManager.get() with no alias.
 *
 * Descriptions may use [[Keyword]] markup (see data/keywordDefinitions.js).
 */

/** Status kinds. Buffs frame the portrait; debuffs cross over it (different art). */
export const STATUS_KIND = {
  BUFF:   'buff',
  DEBUFF: 'debuff',
};

/**
 * Status catalog, keyed by normalized id.
 * @type {Record<string, { id:string, kind:string, name:string, icon:string, description:string }>}
 */
export const STATUS_EFFECTS = {
  // ── Debuffs ──────────────────────────────────────────
  silenced: {
    id: 'silenced',
    kind: STATUS_KIND.DEBUFF,
    name: 'Silence',
    icon: 'debuff_silenced',
    description: 'Cannot cast skills.',
  },
  crippled: {
    id: 'crippled',
    kind: STATUS_KIND.DEBUFF,
    name: 'Cripple',
    icon: 'debuff_crippled',
    description: '[[Attack]] is reduced to 1.',
  },
  enfeebled: {
    id: 'enfeebled',
    kind: STATUS_KIND.DEBUFF,
    name: 'Enfeeble',
    icon: 'debuff_enfeebled',
    description: 'Cannot gain [[Mana]].',
  },
  brittle: {
    id: 'brittle',
    kind: STATUS_KIND.DEBUFF,
    name: 'Brittle',
    icon: 'debuff_brittle',
    description: 'Takes 1.5x [[Damage]].',
  },
  bleeding: {
    id: 'bleeding',
    kind: STATUS_KIND.DEBUFF,
    name: 'Bleed',
    icon: 'debuff_bleeding',
    description: 'Takes [[Damage]] at the start of each turn equal to half the attacker\'s [[Attack]].',
  },
  frozen: {
    id: 'frozen',
    kind: STATUS_KIND.DEBUFF,
    name: 'Frozen',
    icon: 'debuff_frozen',
    description: 'Cannot gain [[Extra Turns]].',
  },

  // ── Buffs ────────────────────────────────────────────
  intangible: {
    id: 'intangible',
    kind: STATUS_KIND.BUFF,
    name: 'Intangible',
    icon: 'buff_intangible',
    description: 'All incoming [[Damage]] is reduced to 1.',
  },
  berserk: {
    id: 'berserk',
    kind: STATUS_KIND.BUFF,
    name: 'Berserk',
    icon: 'buff_berserk',
    description: 'Deal double [[Damage]] and ignore all effects, but take double [[Damage]].',
  },
  // The woven `reflect` buff. Carries a per-instance `reflectValue` (set on the
  // status entry by _applyStatus) = flat damage dealt back to attackers per hit.
  // Reuses the now-unused barrier crest art as a placeholder. See decision #40.
  reflecting: {
    id: 'reflecting',
    kind: STATUS_KIND.BUFF,
    name: 'Reflect',
    icon: 'buff_barrier',
    description: 'Reflects [[Damage]] back to attackers.',
  },
  // NOTE: Barrier is NO LONGER a status effect. It is now a one-round numeric
  // shield pool (state.barrier) that absorbs damage like armor and renders as a
  // purple "temporary HP" bar overlay — NOT a portrait overlay. See decision #38
  // (BattleController barrier handling, UIProgressBar/CharacterInfoPane rendering).
};

/**
 * Resolve a status id to its definition.
 * @param {string} id
 * @returns {{ id:string, kind:string, name:string, icon:string, description:string }|null}
 */
export function getStatusDef(id) {
  return (id && STATUS_EFFECTS[id]) || null;
}

/** Whether a status id is a buff. */
export function isBuff(id) {
  const def = getStatusDef(id);
  return !!def && def.kind === STATUS_KIND.BUFF;
}

/** Whether a status id is a debuff. */
export function isDebuff(id) {
  const def = getStatusDef(id);
  return !!def && def.kind === STATUS_KIND.DEBUFF;
}

export default STATUS_EFFECTS;
