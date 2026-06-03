/**
 * sim/scenarios.mjs — the things we want to measure.
 *
 * Two kinds of experiments:
 *   SCENARIOS — a single fixed matchup (player vs enemy), run N times. Reports
 *               win rate, turns, HP remaining, DPT, etc. Use to ask "is THIS
 *               matchup fair / how long does it last?".
 *   SWEEPS    — vary ONE thing across a range, run N times per value. Reports
 *               aggregates per value. Use to ask "what is +1 attack WORTH?"
 *               (read the marginal change in win rate / turns across the range).
 *
 * Everything is plain data so it serializes into the results file. Sweeps carry
 * a `mutate(player, enemy, value)` function applied to a fresh JSON-clone each
 * point (functions are not serialized; the runner records the values array).
 *
 * Numbers below are the RECOMMENDED baseline from
 * docs/balance-scaling-research.md Part III — they are starting points to
 * validate, not the current (mock) game values.
 */

// ── Skill library (sim format; mirrors the catalog, flattened) ───────────────
export const SKILLS = {
  // vanilla 1.0 HPe/mana anchor
  slash:  { id: 'slash',  name: 'Slash',  cost: { red: 5 }, effects: [{ type: 'damage', amount: 5 }] },
  // player workhorse + tempo
  strike: { id: 'strike', name: 'Strike', cost: { red: 5 }, effects: [{ type: 'damage', amount: 6 }] },
  bash:   { id: 'bash',   name: 'Bash',   cost: { red: 6 }, effects: [{ type: 'damage', amount: 5 }, { type: 'extra_turn' }] },
  // defensive
  defend: { id: 'defend', name: 'Defend', cost: { blue: 5 }, effects: [{ type: 'armor', amount: 6 }] },
  // caster nuke
  bolt:   { id: 'bolt',   name: 'Bolt',   cost: { purple: 4 }, effects: [{ type: 'damage', amount: 6 }] },
  // sustain
  mend:   { id: 'mend',   name: 'Mend',   cost: { green: 5 }, effects: [{ type: 'heal', amount: 6 }] },
  // free ramp (Encroach-style)
  encroach: { id: 'encroach', name: 'Encroach', cost: {}, effects: [{ type: 'gain_attack', amount: 1 }] },
};

// ── Reference combatants (recommended baseline, Part III §17 / §13) ──────────
export const PLAYERS = {
  durable:  { name: 'Durable',  maxHp: 34, attack: 1, armor: 0, mana: { red: 4 },    skills: [SKILLS.strike, SKILLS.bash], policy: 'auto' },
  caster:   { name: 'Caster',   maxHp: 26, attack: 1, armor: 0, mana: { purple: 3 }, skills: [SKILLS.bolt],                 policy: 'auto' },
  // Skull-focused: no damage skill, just sustain — measures raw skull/attack value.
  // (Encroach is intentionally omitted; a free "ramp + end turn" skill needs a
  // dedicated policy — see engine.mjs chooseSkill note.)
  skullish: { name: 'Skullish', maxHp: 28, attack: 1, armor: 0, mana: { green: 3 },  skills: [SKILLS.mend], policy: 'skull' },
};

export const ENEMIES = {
  // Recommended Act-1 ramp from research §13.2/§13.3.
  floor1: { name: 'Floor1 minion', maxHp: 30, attack: 1, armor: 0, skills: [SKILLS.slash] },
  floor5: { name: 'Floor5 minion', maxHp: 46, attack: 2, armor: 0, skills: [SKILLS.slash] },
  floor9: { name: 'Floor9 minion', maxHp: 62, attack: 3, armor: 0, skills: [SKILLS.slash] },
  elite:  { name: 'Elite',         maxHp: 85, attack: 3, armor: 10, skills: [SKILLS.slash] },
  boss:   { name: 'Boss',          maxHp: 170, attack: 3, armor: 0, skills: [SKILLS.slash], passives: [{ trigger: 'onTurnStart', type: 'gain_attack', amount: 1 }] },
};

// ── Fixed matchups to sanity-check pacing / fairness ─────────────────────────
export const SCENARIOS = [
  { name: 'durable_vs_floor1', player: PLAYERS.durable,  enemy: ENEMIES.floor1 },
  { name: 'durable_vs_floor5', player: PLAYERS.durable,  enemy: ENEMIES.floor5 },
  { name: 'durable_vs_floor9', player: PLAYERS.durable,  enemy: ENEMIES.floor9 },
  { name: 'caster_vs_floor5',  player: PLAYERS.caster,   enemy: ENEMIES.floor5 },
  { name: 'skullish_vs_floor5',player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
  { name: 'durable_vs_elite',  player: PLAYERS.durable,  enemy: ENEMIES.elite },
  { name: 'durable_vs_boss',   player: PLAYERS.durable,  enemy: ENEMIES.boss },
];

// ── Sweeps to ascertain marginal stat / skill value ──────────────────────────
// Each point JSON-clones the base, applies mutate(player, enemy, v), then runs.
export const SWEEPS = [
  {
    name: 'attack_value_vs_floor5',
    note: 'How much does +1 Attack move win rate / turns vs a mid minion?',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
    varying: 'player.attack',
    values: [1, 2, 3, 4, 5, 6, 8, 10],
    mutate: (p, _e, v) => { p.attack = v; },
  },
  {
    name: 'maxhp_value_vs_floor5',
    note: 'How much does +Max HP move win rate / HP remaining vs a mid minion?',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
    varying: 'player.maxHp',
    values: [16, 20, 24, 28, 32, 36, 40, 48],
    mutate: (p, _e, v) => { p.maxHp = v; },
  },
  {
    name: 'attack_value_vs_boss',
    note: 'Attack value should be HIGHER in long fights (research §11.1).',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.boss },
    varying: 'player.attack',
    values: [1, 2, 3, 4, 5, 6, 8, 10],
    mutate: (p, _e, v) => { p.attack = v; },
  },
  {
    name: 'skill_damage_value',
    note: 'Worth of +1 damage on the workhorse skill (Strike), vs floor5.',
    base: { player: PLAYERS.durable, enemy: ENEMIES.floor5 },
    varying: 'strike.damage',
    values: [3, 4, 5, 6, 7, 8, 10, 12],
    mutate: (p, _e, v) => { p.skills[0].effects[0].amount = v; }, // strike is skills[0]
  },
  {
    name: 'skill_cost_value',
    note: 'Worth of cheaper mana cost on Strike (same 6 damage), vs floor5.',
    base: { player: PLAYERS.durable, enemy: ENEMIES.floor5 },
    varying: 'strike.cost.red',
    values: [3, 4, 5, 6, 7, 8, 10],
    mutate: (p, _e, v) => { p.skills[0].cost.red = v; },
  },
  {
    name: 'enemy_hp_pacing',
    note: 'Turns-to-kill vs enemy HP — pick HP that hits target fight length.',
    base: { player: PLAYERS.durable, enemy: ENEMIES.floor5 },
    varying: 'enemy.maxHp',
    values: [25, 35, 45, 55, 65, 80, 95, 120],
    mutate: (_p, e, v) => { e.maxHp = v; },
  },
  {
    name: 'enemy_attack_lethality',
    note: 'Player HP remaining vs enemy attack — calibrate lethality (§13.3).',
    base: { player: PLAYERS.durable, enemy: ENEMIES.floor5 },
    varying: 'enemy.attack',
    values: [1, 2, 3, 4, 5, 6, 8],
    mutate: (_p, e, v) => { e.attack = v; },
  },
];
