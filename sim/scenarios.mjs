/**
 * sim/scenarios.mjs — what to measure on the real-board sim.
 *
 * Combatants no longer carry a `policy` — the engine AI makes localized smart
 * decisions for both sides (evaluate every swap, prefer damage / match-4s /
 * skill build-up). A combatant with no damage skill naturally skull-focuses;
 * one with a good damage skill builds its color then casts.
 *
 * SCENARIOS — fixed matchups (fairness / pacing).
 * SWEEPS    — vary one thing; read the marginal effect on win rate / turns.
 *             `mutate(player, enemy, value)` is applied to a fresh clone per point.
 *
 * Numbers are the recommended Part III baseline — starting points to validate.
 */

export const SKILLS = {
  slash:  { id: 'slash',  name: 'Slash',  cost: { red: 5 }, effects: [{ type: 'damage', amount: 5 }] },
  strike: { id: 'strike', name: 'Strike', cost: { red: 5 }, effects: [{ type: 'damage', amount: 6 }] },
  bash:   { id: 'bash',   name: 'Bash',   cost: { red: 6 }, effects: [{ type: 'damage', amount: 5 }, { type: 'extra_turn' }] },
  defend: { id: 'defend', name: 'Defend', cost: { blue: 5 }, effects: [{ type: 'armor', amount: 6 }] },
  bolt:   { id: 'bolt',   name: 'Bolt',   cost: { purple: 4 }, effects: [{ type: 'damage', amount: 6 }] },
  mend:   { id: 'mend',   name: 'Mend',   cost: { green: 5 }, effects: [{ type: 'heal', amount: 6 }] },
};

export const PLAYERS = {
  durable:  { name: 'Durable',  maxHp: 34, attack: 1, armor: 0, mana: { red: 4 },    skills: [SKILLS.strike, SKILLS.bash] },
  caster:   { name: 'Caster',   maxHp: 26, attack: 1, armor: 0, mana: { purple: 3 }, skills: [SKILLS.bolt] },
  // No damage skill → the AI skull-focuses for damage and heals when hurt.
  skullish: { name: 'Skullish', maxHp: 28, attack: 1, armor: 0, mana: { green: 3 },  skills: [SKILLS.mend] },
  // Single damage skill kit for isolated skill sweeps.
  soloStrike: { name: 'SoloStrike', maxHp: 34, attack: 1, armor: 0, mana: { red: 4 },
    skills: [{ id: 'strike', name: 'Strike', cost: { red: 5 }, effects: [{ type: 'damage', amount: 6 }] }] },
  // ── Mid-act REFERENCE build ──────────────────────────────────────────────
  // A "typical" character a few floors into a run: some Attack (skull damage is
  // meaningful), more HP, and a real 2-skill kit incl. an extra-turn skill.
  // Balance skill/enemy numbers against THIS, not the bare attack-1 kits — those
  // are unrealistically weak for most of a run and skew every table.
  reference: { name: 'Reference (mid-act)', maxHp: 40, attack: 3, armor: 0, mana: { red: 5 },
    skills: [SKILLS.strike, SKILLS.bash] },
};

export const ENEMIES = {
  floor1: { name: 'Floor1 minion', maxHp: 30, attack: 1, armor: 0, skills: [SKILLS.slash] },
  floor5: { name: 'Floor5 minion', maxHp: 46, attack: 2, armor: 0, skills: [SKILLS.slash] },
  floor9: { name: 'Floor9 minion', maxHp: 62, attack: 3, armor: 0, skills: [SKILLS.slash] },
  elite:  { name: 'Elite',         maxHp: 85, attack: 3, armor: 10, skills: [SKILLS.slash] },
  boss:   { name: 'Boss',          maxHp: 170, attack: 3, armor: 0, skills: [SKILLS.slash], passives: [{ trigger: 'onTurnStart', type: 'gain_attack', amount: 1 }] },
};

export const SCENARIOS = [
  { name: 'durable_vs_floor1', player: PLAYERS.durable,  enemy: ENEMIES.floor1 },
  { name: 'durable_vs_floor5', player: PLAYERS.durable,  enemy: ENEMIES.floor5 },
  { name: 'durable_vs_floor9', player: PLAYERS.durable,  enemy: ENEMIES.floor9 },
  { name: 'caster_vs_floor5',  player: PLAYERS.caster,   enemy: ENEMIES.floor5 },
  { name: 'skullish_vs_floor5',player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
  { name: 'durable_vs_elite',  player: PLAYERS.durable,  enemy: ENEMIES.elite },
  { name: 'durable_vs_boss',   player: PLAYERS.durable,  enemy: ENEMIES.boss },
  // mid-act reference build across the curve
  { name: 'reference_vs_floor5', player: PLAYERS.reference, enemy: ENEMIES.floor5 },
  { name: 'reference_vs_floor9', player: PLAYERS.reference, enemy: ENEMIES.floor9 },
  { name: 'reference_vs_elite',  player: PLAYERS.reference, enemy: ENEMIES.elite },
  { name: 'reference_vs_boss',   player: PLAYERS.reference, enemy: ENEMIES.boss },
];

// Helper: a single-skill kit on the mid-act REFERENCE stat line (attack 3,
// 40 HP), so a skill's value is measured against a realistic skull baseline
// rather than the unrealistically weak attack-1 kit.
const ratioPlayer = (cost, dmg) => ({
  name: 'RatioKit', maxHp: 40, attack: 3, armor: 0, mana: {},
  skills: [{ id: 'nuke', name: 'Nuke', cost: { red: cost }, effects: [{ type: 'damage', amount: dmg }] }],
});

export const SWEEPS = [
  {
    name: 'attack_value_vs_floor5',
    note: '+1 Attack vs a mid minion (skull build).',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
    varying: 'player.attack', values: [1, 2, 3, 4, 5, 6, 8, 10],
    mutate: (p, _e, v) => { p.attack = v; },
  },
  {
    name: 'maxhp_value_vs_floor5',
    note: '+Max HP vs a mid minion (skull build).',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.floor5 },
    varying: 'player.maxHp', values: [16, 20, 24, 28, 32, 36, 40, 48],
    mutate: (p, _e, v) => { p.maxHp = v; },
  },
  {
    name: 'attack_value_vs_boss',
    note: 'Attack value in a long fight (should be higher).',
    base: { player: PLAYERS.skullish, enemy: ENEMIES.boss },
    varying: 'player.attack', values: [1, 2, 3, 4, 5, 6, 8, 10],
    mutate: (p, _e, v) => { p.attack = v; },
  },
  {
    name: 'skill_ratio_value_cost5',
    note: 'Skill VALUE DENSITY: fixed cost 5, vary damage/cost ratio. Shows how '
        + 'good a skill must be (vs the skull baseline) to be worth building.',
    base: { player: ratioPlayer(5, 5), enemy: ENEMIES.floor5 },
    varying: 'ratio@cost5', values: [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5, 3.0],
    mutate: (p, _e, v) => { p.skills[0].cost.red = 5; p.skills[0].effects[0].amount = Math.round(5 * v); },
  },
  {
    name: 'skill_ratio_value_cost8',
    note: 'Same ratio sweep at a higher cost (8) — expensive skills need a higher '
        + 'ratio to justify the longer charge / variance.',
    base: { player: ratioPlayer(8, 8), enemy: ENEMIES.floor5 },
    varying: 'ratio@cost8', values: [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5, 3.0],
    mutate: (p, _e, v) => { p.skills[0].cost.red = 8; p.skills[0].effects[0].amount = Math.round(8 * v); },
  },
  {
    name: 'skill_cost_at_fixed_value',
    note: 'Fix damage 8, vary cost — isolates the tempo cost of an expensive skill.',
    base: { player: ratioPlayer(5, 8), enemy: ENEMIES.floor5 },
    varying: 'cost@dmg8', values: [3, 4, 5, 6, 8, 10, 12],
    mutate: (p, _e, v) => { p.skills[0].cost.red = v; p.skills[0].effects[0].amount = 8; },
  },
  {
    name: 'enemy_hp_pacing',
    note: 'Turns-to-kill vs enemy HP for the mid-act reference build (pick HP for target length).',
    base: { player: PLAYERS.reference, enemy: ENEMIES.floor5 },
    varying: 'enemy.maxHp', values: [25, 35, 45, 55, 65, 80, 95, 120, 150],
    mutate: (_p, e, v) => { e.maxHp = v; },
  },
  {
    name: 'enemy_attack_lethality',
    note: 'Reference-build HP left vs enemy attack (smart enemy matches skulls).',
    base: { player: PLAYERS.reference, enemy: ENEMIES.floor5 },
    varying: 'enemy.attack', values: [1, 2, 3, 4, 5, 6, 8],
    mutate: (_p, e, v) => { e.attack = v; },
  },
];
