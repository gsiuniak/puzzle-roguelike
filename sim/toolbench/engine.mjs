/**
 * toolbench/engine.mjs — headless Monte-Carlo battle engine for the Balance Toolbench.
 *
 * FIDELITY CONTRACT
 * ─────────────────
 * The board layer is the REAL game code, imported live (no copy drift):
 *   BoardModel (wild/inert/lock-aware matching, gravity, refill, spawn boosts),
 *   MatchResolver (skull formulas, rewards, barrier→armor→block→HP),
 *   TileTypes, scalingConfig, and the live data catalogs.
 *
 * The battle layer (turns, skills, passives, statuses, AI) is re-implemented
 * here headlessly, mirroring BattleController's rules:
 *   - 1 action per turn (swap or cast), extra turns as a retain flag (chain-capped)
 *   - both sides use the shipped EnemyAI's greedy 1-ply priorities for swaps
 *     and its skill-first, damage-preferred cast policy (player adds small
 *     "don't waste heals" heuristics)
 *   - damage chokepoint: statuses → mark → onIncomingDamage → barrier→armor→block→HP
 *   - magic mana bonus (+⌊M/9⌋ per matched color), relic mana/skull bonuses
 *   - poison (end of applier's turn, absorbed, halves), statuses (turn-cycle,
 *     armed model), barrier expiry at owner turn start
 *   - the passive triggers used by every SHIPPED relic (player + enemy pools),
 *     incl. board-touching ones (catalyst explode, gorepike, deathbringer,
 *     infected tooth, chokeweed sap, thrall seed/harvest) and the Sanguine
 *     Phoenix egg-phase transform
 *
 * KNOWN SIMPLIFICATIONS (surfaced in the UI, keep this list honest):
 *   - AI is greedy 1-ply (like the shipped standard EnemyAI); no MoveAdvisor
 *     lookahead. Custom AIs (sapper/malakor) approximate to skill-first.
 *   - Targeted skills auto-target: rows/areas pick the most-skull line/cluster,
 *     convert_tile picks the BEST match-making spot (4+/extra-turn preferred)
 *     and a convert-only skill (Arcane Inscription) is HELD — not cast —
 *     unless the convert completes a 4+/extra turn (the competent play; a
 *     3-match cast is a tempo loss, a no-match cast a pure waste).
 *   - onMatch4Plus fires once per cascade step (game: per step w/ centerPos).
 *   - lock/mark/consume/transmute are modeled simply; no woven-skill statuses
 *     beyond the 9 catalog ones.
 *   - RNG flows through Math.random (BoardModel internals too). For seeded /
 *     PAIRED batches wrap battle construction+run in rng.mjs withSeededRandom
 *     (see trainer.mjs); otherwise use batch sizes.
 *
 * POLICY SEAM (trainer.mjs / future trained policies):
 *   new Battle(p, e, { playerPolicy, enemyPolicy }) — a policy is
 *   `(battle, combatant) => action | null` (or `{ chooseAction(battle, c) }`):
 *     { type:'cast', skill, target? }  target = {col,row} for targeted effects
 *     { type:'swap', swap }            swap from board.getValidSwaps()
 *     { type:'pass' }                  spend the action doing nothing
 *     null / undefined                 fall back to the default greedy AI
 *   Policies are trusted harness code: they may call the battle's helpers
 *   (greedySkill/greedySwap/canAfford) and read board/combatants directly.
 *
 * MIRRORED CONSTANTS (not exported by their homes — keep in sync):
 *   ENEMY_HP_FLOOR_MULT / ENEMY_ATTACK_FLOOR_BONUS   ← src/js/scenes/MapScene.js
 *   MAGIC_MANA_PER_POINT (9)                          ← src/js/game/BattleController.js
 *   STATUS_DAMAGE_MODS, POISON_DECAY_DIVISOR (2)      ← src/js/game/BattleController.js
 */

import BoardModel from '../../src/js/game/BoardModel.js';
import MatchResolver, {
  calculateMatchedSkullDamage,
  calculateDestroyedSkullDamage,
} from '../../src/js/game/MatchResolver.js';
import { MANA_COLORS, isSkull, BOARD_COLS, BOARD_ROWS } from '../../src/js/game/TileTypes.js';
import { scaledBonus } from '../../src/js/data/scalingConfig.js';
import SKILL_CATALOG from '../../src/js/data/skills/skillCatalog.js';
import RELIC_CATALOG from '../../src/js/data/relics/relicCatalog.js';
import ENEMY_RELIC_CATALOG from '../../src/js/data/relics/enemyRelicCatalog.js';
import CHARACTERS_BY_ID from '../../src/js/data/characters/index.js';
import ENEMIES_BY_ID, { ALL_ENEMIES, selectEnemyForNode, FLOOR_COUNT } from '../../src/js/data/enemies/index.js';
import { RELIC_RARITY_WEIGHTS, DEFAULT_RELIC_RARITY_WEIGHT } from '../../src/js/data/relics/relicRewards.js';

export { SKILL_CATALOG, RELIC_CATALOG, ENEMY_RELIC_CATALOG, CHARACTERS_BY_ID, ENEMIES_BY_ID, ALL_ENEMIES, FLOOR_COUNT };
export { RELIC_RARITY_WEIGHTS, DEFAULT_RELIC_RARITY_WEIGHT };

/* ── Mirrored MapScene floor curves [CODE mirror — MapScene.js] ─────────── */
export const ENEMY_HP_FLOOR_MULT = [1.15, 1.35, 1.7, 1.9, 2.35, 2.65, 3.2, 3.55, 4.25, 4.75];
export const ENEMY_ATTACK_FLOOR_BONUS = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
/* ── Mirrored BattleController constants ────────────────────────────────── */
export const MAGIC_MANA_PER_POINT = 9;
export const POISON_DECAY_DIVISOR = 2;
export const STATUS_DAMAGE_MODS = { brittleMult: 1.5, intangibleCap: 1, berserkMult: 2 };
export const DEFAULT_GROWTH_PLAN = { maxHp: 4, startingAttack: 1 };

const resolver = new MatchResolver();
const clampFloor = (f) => Math.max(1, Math.min(FLOOR_COUNT, f | 0));
export const hpMultForFloor = (floor) => ENEMY_HP_FLOOR_MULT[clampFloor(floor) - 1];
export const atkBonusForFloor = (floor) => ENEMY_ATTACK_FLOOR_BONUS[clampFloor(floor) - 1];

const deep = (o) => JSON.parse(JSON.stringify(o));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const rint = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rint(arr.length)];

/* ═══════════════════════════ combatant factories ═══════════════════════════ */

function baseCombatant() {
  return {
    name: '', side: 'player',
    hp: 1, maxHp: 1, attack: 1, magic: 0, armor: 0, barrier: 0, block: 0,
    mana: { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 },
    poison: 0, statuses: [], mark: 0,
    skills: [], relics: [],
    // static-modifier bookkeeping
    manaGainBonus: {}, skullDamageBonus: 0, dynAtkRules: [], _dynLast: 0,
    // per-fight ledgers
    dealt: {}, casts: 0, manaGained: 0, extraTurns: 0, maxTurnDamageTaken: 0, _turnDamageTaken: 0,
    _echoGuard: false, _reflectGuard: false, _reactGuard: 0, _deathbringerFired: false,
  };
}

function resolveIds(ids, catalog) {
  return (ids || []).map((id) => catalog[id]).filter(Boolean).map(deep);
}

/**
 * Build a player combatant.
 * @param {object} opts
 *  characterId       — key of CHARACTERS_BY_ID (or pass `characterDef`)
 *  victories         — growthPlan applications
 *  relicIds          — player-pool relic ids
 *  customRelics      — full relic objects (Designer)
 *  skillIds          — override kit (defaults to the character's kit)
 *  customSkills      — full skill objects appended (Designer / woven)
 *  statDelta         — { maxHp, attack, magic, armor } additive tweaks (sweeps)
 */
export function makePlayerCombatant(opts = {}) {
  const def = opts.characterDef || CHARACTERS_BY_ID[opts.characterId || 'warrior'];
  const bs = def.baseStats || {};
  const g = def.growthPlan || DEFAULT_GROWTH_PLAN;
  const v = Math.max(0, opts.victories || 0);
  const d = opts.statDelta || {};
  const c = baseCombatant();
  c.side = 'player';
  c.name = def.name || def.id;
  c.maxHp = (bs.maxHp || 1) + (g.maxHp || 0) * v + (d.maxHp || 0);
  c.hp = c.maxHp;
  c.attack = (bs.startingAttack || 0) + (g.startingAttack || 0) * v + (d.attack || 0);
  c.magic = (bs.startingMagic || 0) + (g.startingMagic || 0) * v + (d.magic || 0);
  c.armor = (bs.startingArmor || 0) + (d.armor || 0);
  for (const col of MANA_COLORS) c.mana[col] = (bs.startingMana && bs.startingMana[col]) || 0;
  const skillIds = opts.skillIds || def.skills || [];
  c.skills = [...resolveIds(skillIds, SKILL_CATALOG), ...deep(opts.customSkills || [])];
  const relicIds = [...(def.relics || []), ...(opts.relicIds || [])];
  c.relics = [...resolveIds(relicIds, RELIC_CATALOG), ...deep(opts.customRelics || [])];
  if (opts.dropStarterRelics) c.relics = c.relics.filter((r) => r.rarity !== 'starter');
  return c;
}

/**
 * Build a floor-scaled enemy combatant (mirrors MapScene._resolveEnemyBattleData).
 * @param {object|string} defOrId — enemy def object (may be a Designer custom) or id
 * @param {number} floor — 1-indexed
 * @param {object} [overrides] — { hp, attack, armor, attackScale, skillIds, relicIds, customSkills, customRelics }
 */
export function makeEnemyCombatant(defOrId, floor = 1, overrides = {}) {
  const def = typeof defOrId === 'string' ? ENEMIES_BY_ID[defOrId] : defOrId;
  const c = baseCombatant();
  c.side = 'enemy';
  c.name = def.name || def.id;
  c.enemyId = def.id;
  const baseHp = overrides.hp != null ? overrides.hp : (def.hp != null ? def.hp : def.maxHp) || 1;
  const baseAtk = overrides.attack != null ? overrides.attack : def.attack || 0;
  const atkScale = overrides.attackScale != null ? overrides.attackScale
    : (typeof def.attackScale === 'number' ? def.attackScale : 1);
  c.maxHp = Math.round(baseHp * hpMultForFloor(floor));
  c.hp = c.maxHp;
  c.attack = baseAtk + Math.round(atkBonusForFloor(floor) * atkScale);
  c.magic = def.magic || 0;
  c.armor = overrides.armor != null ? overrides.armor : def.armor || 0;
  for (const col of MANA_COLORS) c.mana[col] = (def.mana && def.mana[col]) || 0;
  c.skills = [
    ...resolveIds(overrides.skillIds || def.skills || [], SKILL_CATALOG),
    ...deep(overrides.customSkills || def.customSkills || []),
  ];
  c.relics = [
    ...resolveIds(overrides.relicIds || def.relics || [], ENEMY_RELIC_CATALOG),
    ...deep(overrides.customRelics || def.customRelics || []),
  ];
  c._floor = floor;
  c._def = def;
  return c;
}

/* ═══════════════════════════════ the battle ═══════════════════════════════ */

const MAX_TURN_CYCLES = 80;       // hard cap (each side acting once = 1 cycle)
const MAX_ACTIONS_PER_TURN = 12;  // extra-turn chain cap (safety)
const MAX_CASCADE_STEPS = 30;

export class Battle {
  /**
   * @param {object} player — combatant from makePlayerCombatant
   * @param {object} enemy  — combatant from makeEnemyCombatant
   * @param {object} [opts] — { maxTurns, log:boolean, playerPolicy, enemyPolicy }
   *   (policies: see POLICY SEAM in the file header)
   */
  constructor(player, enemy, opts = {}) {
    this.p = player; this.e = enemy;
    this.opts = opts;
    this.turnCycles = 0;
    this.playerActions = 0;
    this.log = opts.log ? [] : null;
    this.board = new BoardModel(BOARD_COLS, BOARD_ROWS);
    this._pendingSkullDestroy = 0;
    this._eggState = null;
    this._initStatics();
    this.board.initialize();
    // AI mana-color maps (mirrors EnemyAI ctor)
    this._skillColors = { player: this._costColors(this.p), enemy: this._costColors(this.e) };
  }

  _say(msg) { if (this.log) this.log.push(msg); }

  _costColors(c) {
    const m = {};
    for (const s of c.skills) for (const col of Object.keys(s.cost || {})) m[col] = (m[col] || 0) + s.cost[col];
    return m;
  }

  other(c) { return c === this.p ? this.e : this.p; }

  /* ── static modifiers (BattleController._initStaticModifiers) ── */
  _initStatics() {
    const boosts = {};
    for (const c of [this.p, this.e]) {
      for (const relic of c.relics) for (const ef of relic.effects || []) {
        if (ef.trigger !== 'onBattleStart') continue;
        switch (ef.effectType) {
          case 'modify_stat': {
            const m = ef.modifyStat || {};
            if (m.stat && typeof m.amount === 'number') c[m.stat] = (c[m.stat] || 0) + m.amount;
            break;
          }
          case 'modify_spawn_rate': {
            const s = ef.spawnRate || {};
            if (s.tile && typeof s.amount === 'number') boosts[s.tile] = (boosts[s.tile] || 0) + s.amount;
            break;
          }
          case 'modify_mana_gain': {
            const m = ef.manaGain || {};
            if (m.color) c.manaGainBonus[m.color] = (c.manaGainBonus[m.color] || 0) + (m.amount || 0);
            break;
          }
          case 'modify_skull_damage': {
            c.skullDamageBonus += ((ef.skullDamage && ef.skullDamage.amount) || 0);
            break;
          }
          case 'grant_starting_mana': {
            const s = ef.startingMana || {};
            if (s.color) c.mana[s.color] = (c.mana[s.color] || 0) + (s.amount || 0);
            break;
          }
          case 'attack_per_unspent_mana': {
            const r = ef.attackPerMana || {};
            if (r.color && r.per) c.dynAtkRules.push({ color: r.color, per: r.per, amount: r.amount || 1 });
            break;
          }
        }
      }
    }
    this.board.setSpawnRateBoosts(boosts);
  }

  _recomputeDynAtk(c) {
    if (!c.dynAtkRules.length || this._status(c, 'crippled')) return;
    let dyn = 0;
    for (const r of c.dynAtkRules) dyn += Math.floor((c.mana[r.color] || 0) / r.per) * r.amount;
    c.attack += dyn - c._dynLast;
    c._dynLast = dyn;
  }

  /* ── statuses (turn-cycle armed model) ── */
  _status(c, id) { return c.statuses.find((s) => s.id === id) || null; }
  _hasStatus(c, id) { return !!this._status(c, id); }

  _applyStatus(target, id, { turns = 1, attackValue = null } = {}, applier = null) {
    const existing = this._status(target, id);
    if (existing) { existing.turns = Math.max(existing.turns, turns); return; }
    const st = { id, turns, _armed: target === this._active };
    if (id === 'crippled') {
      st.savedAttack = target.attack;
      target.attack = attackValue != null ? attackValue : 1;
    }
    if (id === 'bleeding') st.tickDamage = Math.max(1, Math.ceil(((applier && applier.attack) || 1) / 2));
    target.statuses.push(st);
  }

  _tickStatuses(c) {
    for (const st of [...c.statuses]) {
      if (st._armed) {
        st.turns--;
        if (st.turns <= 0) {
          if (st.id === 'crippled' && st.savedAttack != null) c.attack = st.savedAttack;
          c.statuses = c.statuses.filter((s) => s !== st);
          continue;
        }
      } else st._armed = true;
      if (st.id === 'bleeding') this._applyDamage(this.other(c), c, st.tickDamage, { tag: 'bleed' });
    }
  }

  _canGainMana(c) { return !this._hasStatus(c, 'enfeebled'); }
  _canGainExtraTurn(c) { return !this._hasStatus(c, 'frozen'); }

  /* ── passive dispatch (subset used by shipped relics) ── */
  _passives(c, trigger, payload = {}) {
    for (const relic of c.relics) for (const ef of relic.effects || []) {
      if (ef.trigger !== trigger) continue;
      const cond = ef.condition || null;
      if (cond) {
        if (cond.typeId && payload.typeId !== cond.typeId) continue;
        if (cond.minCount && (payload.count || 0) < cond.minCount) continue;
        if (cond.color && payload.color !== cond.color) continue;
      }
      this._resolvePassive(c, ef, payload);
    }
  }

  _resolvePassive(c, ef, payload) {
    const opp = this.other(c);
    switch (ef.effectType) {
      case 'damage': {
        // no amount → falls back to caster.attack (Briarthorn)
        const d = ef.damage || {};
        const amt = (d.amount == null ? c.attack : d.amount) + scaledBonus(d.scaling, c);
        if (amt > 0) this._applyDamage(c, opp, amt, { tag: 'passive' });
        break;
      }
      case 'armor': {
        const a = ef.armor || {};
        c.armor += (a.amount || 0) + scaledBonus(a.scaling, c);
        break;
      }
      case 'barrier': {
        const b = ef.barrier || {};
        c.barrier += (b.amount || 0) + scaledBonus(b.scaling, c);
        break;
      }
      case 'heal': {
        const h = ef.heal || {};
        c.hp = Math.min(c.maxHp, c.hp + (h.amount || 0) + scaledBonus(h.scaling, c));
        break;
      }
      case 'gain_attack': c.attack += ((ef.gainAttack && ef.gainAttack.amount) || 1); break;
      case 'gain_mana': {
        const g = ef.gainMana || {};
        if (g.color && this._canGainMana(c)) {
          c.mana[g.color] = (c.mana[g.color] || 0) + (g.amount || 0);
          c.manaGained += (g.amount || 0);
          this._onGainMana(c, g.color, g.amount || 0);
        }
        break;
      }
      case 'drain_mana': {
        const d = ef.drainMana || {};
        for (const col of d.color ? [d.color] : MANA_COLORS) {
          opp.mana[col] = Math.max(0, (opp.mana[col] || 0) - (d.amount || 0));
        }
        break;
      }
      case 'reduce_damage': break; // handled inline in _applyDamage
      case 'apply_poison': {
        // Poison Vial: floor(damage dealt × fraction), gated on isSkull
        const p = ef.poison || {};
        if (p.requireSkull && !payload.isSkull) break;
        const stacks = Math.floor((payload.amount || 0) * (p.fraction != null ? p.fraction : 1));
        if (stacks > 0) opp.poison += stacks;
        break;
      }
      case 'echo_damage': {
        if (c._echoGuard) break;
        c._echoGuard = true;
        this._applyDamage(c, opp, payload.amount || 0, { tag: 'echo' });
        c._echoGuard = false;
        break;
      }
      case 'destroy_random_skulls': {
        this._pendingSkullDestroy += ((ef.destroySkulls && ef.destroySkulls.amount) || 1);
        break;
      }
      case 'create_tiles': {
        // Infected Tooth (disease), Baron's Signet (thrall, avoidMatches)
        const ct = ef.createTiles || {};
        this._passiveCreateTiles(c, ct);
        break;
      }
      case 'convert_random_tiles': {
        // Chokeweed Sap — convert in place; a lined-up match resolves w/o extra turn
        const cv = ef.convertTiles || {};
        const from = this.board.getTilesOfType(cv.from || 'skull');
        const chosen = BoardModel.pickRandomTiles(from, cv.amount || 1);
        this.board.convertTilesToType(chosen, cv.to || 'green');
        this._resolveCascade(c, { suppressExtraTurn: true });
        break;
      }
      case 'harvest_tiles': {
        // Usurper's Heart — +attackPer per thrall, convert to skulls
        const h = ef.harvestTiles || {};
        const tiles = this.board.getTilesOfType(h.type || 'thrall');
        if (tiles.length) {
          c.attack += tiles.length * (h.attackPer || 1);
          this.board.convertTilesToType(tiles, h.toType || 'skull');
        }
        break;
      }
      case 'destroy_tiles_radius': {
        // Unstable Catalyst — explode around a matched center (payload.centerPos)
        const r = (ef.area && ef.area.radius) || 1;
        const cp = payload.centerPos || { col: rint(BOARD_COLS), row: rint(BOARD_ROWS) };
        const positions = [];
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
          const col = cp.col + dx, row = cp.row + dy;
          if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS && !this.board.isEmpty(col, row)) {
            positions.push({ col, row });
          }
        }
        payload._extraDestroy = (payload._extraDestroy || []).concat(positions);
        break;
      }
      case 'destroy_random_row': {
        const row = rint(BOARD_ROWS);
        const positions = [];
        for (let col = 0; col < BOARD_COLS; col++) if (!this.board.isEmpty(col, row)) positions.push({ col, row });
        payload._extraDestroy = (payload._extraDestroy || []).concat(positions);
        break;
      }
      case 'transform': break; // onDeath — handled in _checkDeath
      default: break; // unknown passive types are ignored (surface via UI fidelity note)
    }
  }

  _passiveCreateTiles(c, ct) {
    const type = ct.type || 'skull';
    const amount = ct.amount || 1;
    const candidates = this.board.getTilesNotOfType(type);
    const chosen = [];
    if (ct.avoidMatches) {
      const shuffled = BoardModel.pickRandomTiles(candidates, candidates.length);
      for (const pos of shuffled) {
        if (chosen.length >= amount) break;
        if (!this.board.positionCreatesMatch(pos.col, pos.row, type)) chosen.push(pos);
      }
      while (chosen.length < amount && shuffled.length > chosen.length) {
        const extra = shuffled.find((p) => !chosen.includes(p));
        if (!extra) break; chosen.push(extra);
      }
    } else {
      chosen.push(...BoardModel.pickRandomTiles(candidates, amount));
    }
    this.board.convertTilesToType(chosen, type);
    // onTileCreated (Severed Maxilla)
    for (let i = 0; i < chosen.length; i++) this._passives(c, 'onTileCreated', { typeId: type, count: 1 });
  }

  _onGainMana(c, color, amount) {
    if (c._reactGuard > 2) return; // depth guard (mirrors _manaGainDepth)
    c._reactGuard++;
    this._passives(c, 'onGainMana', { color, amount });
    c._reactGuard--;
  }

  /* ── the damage chokepoint ── */
  _applyDamage(attacker, target, amount, { isSkull = false, isReflect = false, tag = 'hit' } = {}) {
    if (amount <= 0 || target.hp <= 0) return 0;
    let dmg = amount;
    const attackerBerserk = attacker && this._hasStatus(attacker, 'berserk');
    if (attackerBerserk) dmg *= STATUS_DAMAGE_MODS.berserkMult;
    else {
      if (this._hasStatus(target, 'brittle')) dmg = Math.round(dmg * STATUS_DAMAGE_MODS.brittleMult);
      if (this._hasStatus(target, 'intangible')) dmg = Math.min(dmg, STATUS_DAMAGE_MODS.intangibleCap);
    }
    if (this._hasStatus(target, 'berserk')) dmg *= STATUS_DAMAGE_MODS.berserkMult;
    if (attacker && attacker.mark > 1 && !isReflect) { dmg = Math.round(dmg * attacker.mark); attacker.mark = 0; }
    // onIncomingDamage (Evil Eye)
    for (const relic of target.relics) for (const ef of relic.effects || []) {
      if (ef.trigger === 'onIncomingDamage' && ef.effectType === 'reduce_damage') {
        dmg = Math.max(0, dmg - ((ef.reduceDamage && ef.reduceDamage.amount) || 0));
      }
    }
    if (dmg <= 0) return 0;
    const res = resolver.applyDamage(target, dmg);
    const actual = res.actualDamage;
    if (actual > 0) {
      attacker && (attacker.dealt[tag] = (attacker.dealt[tag] || 0) + actual);
      target._turnDamageTaken += actual;
      // onTakeDamage / onDealDamage reactive passives (guarded against loops)
      if (target._reactGuard < 3) {
        target._reactGuard++;
        this._passives(target, 'onTakeDamage', { amount: actual });
        target._reactGuard--;
      }
      if (attacker && attacker._reactGuard < 3) {
        attacker._reactGuard++;
        this._passives(attacker, 'onDealDamage', { amount: actual, isSkull });
        attacker._reactGuard--;
      }
      // Reflecting: target deals the landed amount back
      if (this._hasStatus(target, 'reflecting') && attacker && !this._reflectGuard) {
        this._reflectGuard = true;
        this._applyDamage(target, attacker, actual, { isReflect: true, tag: 'reflect' });
        this._reflectGuard = false;
      }
    }
    this._checkDeath(target);
    return actual;
  }

  _checkDeath(c) {
    if (c.hp > 0) return;
    // Sanguine Phoenix egg transform (onDeath)
    if (c.side === 'enemy' && !this._eggState) {
      const relic = c.relics.find((r) => (r.effects || []).some((e) => e.trigger === 'onDeath' && e.effectType === 'transform'));
      if (relic) {
        const ef = relic.effects.find((e) => e.effectType === 'transform');
        const eggDef = ENEMIES_BY_ID[(ef.transform && ef.transform.intoEnemyId) || 'sanguineEgg'];
        const floor = c._floor || 1;
        this._eggState = { phoenixMaxHp: c.maxHp, phoenixAttack: c.attack, phoenixSkills: c.skills, phoenixRelics: c.relics };
        c.name = (eggDef && eggDef.name) || 'Egg';
        c.maxHp = Math.round((((eggDef && eggDef.hp) || 3)) * hpMultForFloor(floor));
        c.hp = c.maxHp;
        c.skills = []; c.relics = []; c.isEgg = true; c.statuses = [];
        // player keeps the turn — hidden extra turn
        this._forcedExtra = true;
      }
    }
  }

  _resolveEggAtPlayerTurnEnd() {
    const e = this.e;
    if (!e.isEgg) return;
    if (e.hp > 0 && this._eggState) {
      // reborn at full life
      e.name = 'Sanguine Phoenix';
      e.maxHp = this._eggState.phoenixMaxHp;
      e.hp = e.maxHp;
      e.attack = this._eggState.phoenixAttack;
      e.skills = this._eggState.phoenixSkills;
      e.relics = this._eggState.phoenixRelics;
      e.isEgg = false;
      // a reborn Phoenix can be re-killed into a FRESH egg phase (mirrors the game)
      this._eggState = null;
      this._say('Phoenix reborn');
    }
  }

  /* ── cascade resolution (SHOW_MATCH → REMOVE → FALL loop, headless) ── */
  _resolveCascade(active, { suppressExtraTurn = false } = {}) {
    const opp = this.other(active);
    let extraTurn = false;
    for (let step = 0; step < MAX_CASCADE_STEPS; step++) {
      const a = resolver.analyzeMatches(this.board, active);
      if (!a) break;
      // static match bonuses (_applyMatchBonuses)
      const magicMana = Math.floor((active.magic || 0) / MAGIC_MANA_PER_POINT);
      for (const color of Object.keys(a.mana)) {
        if (a.mana[color] > 0) a.mana[color] += (active.manaGainBonus[color] || 0) + magicMana;
      }
      if (active.skullDamageBonus > 0) {
        const skullMatches = a.matches.filter((m) => isSkull(m.typeId)).length;
        a.skullDamage += skullMatches * active.skullDamageBonus;
      }
      // per-match triggers
      const payload4 = { count: 0, centerPos: null, _extraDestroy: [] };
      let any4 = false;
      for (const m of a.matches) {
        this._passives(active, 'onTileMatchType', { typeId: m.typeId, count: m.count });
        if (m.count >= 4) { any4 = true; payload4.count = m.count; payload4.centerPos = m.positions[0]; }
      }
      if (any4) this._passives(active, 'onMatch4Plus', payload4);
      // extra destruction from board-touching 4+ relics (catalyst / gorepike)
      let extraSkullDmg = 0;
      if (payload4._extraDestroy.length) {
        const seen = new Set(a.positions.map((p) => `${p.col},${p.row}`));
        const extras = payload4._extraDestroy.filter((p) => !seen.has(`${p.col},${p.row}`));
        if (extras.length) {
          const rw = resolver.resolveDestroyedTileRewards(this.board, extras, active);
          for (const [color, n] of Object.entries(rw.mana)) a.mana[color] = (a.mana[color] || 0) + n;
          extraSkullDmg = rw.skullDamage;
          a.positions = a.positions.concat(extras);
        }
      }
      // grant mana
      if (this._canGainMana(active)) {
        for (const [color, n] of Object.entries(a.mana)) {
          if (n > 0) {
            active.mana[color] = (active.mana[color] || 0) + n;
            active.manaGained += n;
            this._onGainMana(active, color, n);
          }
        }
      }
      // skull damage
      const skullTotal = a.skullDamage + extraSkullDmg;
      if (skullTotal > 0) this._applyDamage(active, opp, skullTotal, { isSkull: true, tag: 'skull' });
      if (a.extraTurnTrigger && !suppressExtraTurn && this._canGainExtraTurn(active)) extraTurn = true;
      // remove / fall / refill
      this.board.removeTiles(a.positions);
      this.board.applyGravity();
      this.board.refill();
      if (this.p.hp <= 0 || (this.e.hp <= 0 && !this.e.isEgg)) break;
    }
    // drain pending skull destroys (Deathbringer / Death Familiar)
    if (this._pendingSkullDestroy > 0) {
      const n = this._pendingSkullDestroy; this._pendingSkullDestroy = 0;
      const skulls = BoardModel.pickRandomTiles(this.board.getTilesOfType('skull'), n);
      if (skulls.length) {
        const rw = resolver.resolveDestroyedTileRewards(this.board, skulls, active);
        if (rw.skullDamage > 0) this._applyDamage(active, opp, rw.skullDamage, { isSkull: true, tag: 'skullDestroy' });
        this.board.removeTiles(skulls);
        this.board.applyGravity();
        this.board.refill();
        if (this._resolveCascade(active, { suppressExtraTurn })) extraTurn = true;
      }
    }
    return extraTurn;
  }

  /* ── skills ── */
  _canAfford(c, skill) {
    for (const [col, amt] of Object.entries(skill.cost || {})) if ((c.mana[col] || 0) < amt) return false;
    return true;
  }

  _spend(c, skill) {
    for (const [col, amt] of Object.entries(skill.cost || {})) c.mana[col] = Math.max(0, (c.mana[col] || 0) - amt);
  }

  _isDamageSkill(skill) { return (skill.effects || []).some((e) => e.effectType === 'damage'); }

  /**
   * cast → returns true if an extra turn was earned.
   * `target` ({col,row}, optional) overrides auto-targeting for targeted
   * effects (convert_tile spot, destroy_tiles center, row/column line).
   */
  _castSkill(c, skill, target = null) {
    const opp = this.other(c);
    this._spend(c, skill);
    c.casts++;
    let extraTurn = false, needCascade = false;
    for (const ef of skill.effects || []) {
      switch (ef.effectType) {
        case 'damage': {
          const d = ef.damage || {};
          const skulls = d.perSkull ? this.board.getTilesOfType('skull').length : 0;
          const amt = (d.amount == null ? c.attack : d.amount) + (d.perSkull || 0) * skulls + scaledBonus(d.scaling, c);
          const actual = this._applyDamage(c, opp, amt, { tag: 'skill' });
          if (d.leech && actual > 0) c.hp = Math.min(c.maxHp, c.hp + Math.floor(actual * d.leech));
          break;
        }
        case 'armor': { const a = ef.armor || {}; c.armor += (a.amount || 0) + scaledBonus(a.scaling, c); break; }
        case 'barrier': { const b = ef.barrier || {}; c.barrier += (b.amount || 0) + scaledBonus(b.scaling, c); break; }
        case 'heal': { const h = ef.heal || {}; c.hp = Math.min(c.maxHp, c.hp + (h.amount || 0) + scaledBonus(h.scaling, c)); break; }
        case 'gain_max_hp': { const g = ef.gainMaxHp || {}; c.maxHp += (g.amount || 0); break; }
        case 'extra_turn': if (this._canGainExtraTurn(c)) extraTurn = true; break;
        case 'gain_attack': c.attack += ((ef.gainAttack && ef.gainAttack.amount) || 1); break;
        case 'gain_magic': c.magic += ((ef.gainMagic && ef.gainMagic.amount) || 1); break;
        case 'self_destruct': c.hp = 0; break;
        case 'drain_mana': {
          const d = ef.drainMana || {};
          for (const col of d.color ? [d.color] : MANA_COLORS) opp.mana[col] = Math.max(0, (opp.mana[col] || 0) - (d.amount || 0));
          break;
        }
        case 'gain_mana': {
          const g = ef.gainMana || {};
          if (g.color && this._canGainMana(c)) {
            c.mana[g.color] = (c.mana[g.color] || 0) + (g.amount || 0);
            this._onGainMana(c, g.color, g.amount || 0);
          }
          break;
        }
        case 'silence': this._applyStatus(opp, 'silenced', { turns: (ef.silence && ef.silence.turns) || 1 }, c); break;
        case 'set_attack': {
          const s = ef.setAttack || {};
          this._applyStatus(opp, 'crippled', { turns: s.turns || 1, attackValue: s.value != null ? s.value : 1 }, c);
          break;
        }
        case 'apply_status': {
          const s = ef.applyStatus || {};
          const target = s.target === 'self' ? c : opp;
          this._applyStatus(target, s.id, { turns: s.turns || 1, attackValue: s.attackValue }, c);
          break;
        }
        case 'apply_poison': {
          const p = ef.poison || {};
          const skulls = p.perSkull ? this.board.getTilesOfType('skull').length : 0;
          const stacks = (p.amount || 0) + Math.min(p.perSkull ? skulls * p.perSkull : 0, skulls) + scaledBonus(p.scaling, c);
          const target = p.target === 'self' ? c : opp;
          if (stacks > 0) target.poison += stacks;
          break;
        }
        case 'shuffle': this.board.shuffle(); break;
        case 'create_tiles': {
          const ct = ef.createTiles || {};
          const candidates = this.board.getTilesNotOfType(ct.type || 'red');
          const chosen = BoardModel.pickRandomTiles(candidates, ct.amount || 1);
          this.board.convertTilesToType(chosen, ct.type || 'red');
          needCascade = true;
          break;
        }
        case 'convert_tile': {
          // targeted single-tile recolor — pick the BEST match-making spot
          // (4+/extra-turn first, then biggest clear); random only as a last
          // resort (a multi-effect skill was cast for its other effects).
          const type = (ef.convertTile && ef.convertTile.type) || 'red';
          let spot = target && !this.board.isEmpty(target.col, target.row) ? target : null;
          if (!spot) spot = this._bestConvertSpot(c, type);
          if (!spot) {
            const candidates = this.board.getTilesNotOfType(type);
            if (candidates.length) spot = pick(candidates);
          }
          if (spot) { this.board.convertTilesToType([spot], type); needCascade = true; }
          break;
        }
        case 'convert_tiles_by_type': {
          const cb = ef.convertByType || {};
          const tiles = this.board.getTilesOfType(cb.from);
          if (tiles.length) { this.board.convertTilesToType(tiles, cb.to || 'skull'); needCascade = true; }
          break;
        }
        case 'destroy_tiles_row': {
          // target the row with the most skulls (or the policy-chosen row)
          let bestRow = 0, bestScore = -1;
          for (let row = 0; row < BOARD_ROWS; row++) {
            let s = 0;
            for (let col = 0; col < BOARD_COLS; col++) if (isSkull(this.board.get(col, row) || '')) s++;
            if (s > bestScore) { bestScore = s; bestRow = row; }
          }
          if (target && target.row >= 0 && target.row < BOARD_ROWS) bestRow = target.row;
          const rows = 1 + (typeof skill.area === 'number' ? skill.area - 1 : 0);
          const positions = [];
          for (let r = 0; r < rows; r++) {
            const row = Math.min(BOARD_ROWS - 1, bestRow + r);
            for (let col = 0; col < BOARD_COLS; col++) if (!this.board.isEmpty(col, row)) positions.push({ col, row });
          }
          this._destroyPositions(c, positions);
          needCascade = true;
          break;
        }
        case 'destroy_tiles_column': {
          let bestCol = 0, bestScore = -1;
          for (let col = 0; col < BOARD_COLS; col++) {
            let s = 0;
            for (let row = 0; row < BOARD_ROWS; row++) if (isSkull(this.board.get(col, row) || '')) s++;
            if (s > bestScore) { bestScore = s; bestCol = col; }
          }
          if (target && target.col >= 0 && target.col < BOARD_COLS) bestCol = target.col;
          const positions = [];
          for (let row = 0; row < BOARD_ROWS; row++) if (!this.board.isEmpty(bestCol, row)) positions.push({ col: bestCol, row });
          this._destroyPositions(c, positions);
          needCascade = true;
          break;
        }
        case 'destroy_tiles': {
          // area destroy — target the densest skull 3×3 (radius from skill.area)
          const r = (skill.area && skill.area.radius != null) ? skill.area.radius : 1;
          let best = { col: rint(BOARD_COLS), row: rint(BOARD_ROWS) }, bestScore = -1;
          for (let col = 0; col < BOARD_COLS; col++) for (let row = 0; row < BOARD_ROWS; row++) {
            let s = 0;
            for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
              const t = this.board.get(col + dx, row + dy);
              if (t && isSkull(t)) s++;
            }
            if (s > bestScore) { bestScore = s; best = { col, row }; }
          }
          if (target && target.col >= 0 && target.col < BOARD_COLS && target.row >= 0 && target.row < BOARD_ROWS) best = target;
          const positions = [];
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            const col = best.col + dx, row = best.row + dy;
            if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS && !this.board.isEmpty(col, row)) positions.push({ col, row });
          }
          this._destroyPositions(c, positions);
          needCascade = true;
          break;
        }
        case 'destroy_tiles_by_type': {
          const db = ef.destroyByType || {};
          let tiles = this.board.getTilesOfType(db.type || 'skull');
          if (db.amount != null) tiles = BoardModel.pickRandomTiles(tiles, db.amount);
          this._destroyPositions(c, tiles);
          needCascade = true;
          break;
        }
        case 'transmute_mana': {
          const t = ef.transmuteMana || {};
          let remaining = t.amount || 0;
          for (const col of MANA_COLORS) {
            if (col === t.color || remaining <= 0) continue;
            const take = Math.min(c.mana[col] || 0, remaining);
            c.mana[col] -= take; remaining -= take;
            if (t.color && this._canGainMana(c)) c.mana[t.color] = (c.mana[t.color] || 0) + take;
          }
          break;
        }
        case 'consume': {
          const cs = ef.consume || {};
          const div = Math.max(2, cs.divisor || 2);
          let pool = 0;
          if (cs.resource === 'armor') { pool = c.armor; c.armor = 0; }
          else if (cs.resource === 'barrier') { pool = c.barrier; c.barrier = 0; }
          else if (cs.color) { pool = c.mana[cs.color] || 0; c.mana[cs.color] = 0; }
          else { for (const col of MANA_COLORS) { pool += c.mana[col] || 0; c.mana[col] = 0; } }
          const dmg = Math.floor(pool / div);
          if (dmg > 0) this._applyDamage(c, opp, dmg, { tag: 'skill' });
          break;
        }
        case 'mark': c.mark = Math.max(c.mark, (ef.mark && ef.mark.multiplier) || 2); break;
        case 'lock_color': {
          const l = ef.lockColor || {};
          let color = l.color;
          if (!color) { // opponent's most abundant color
            let best = MANA_COLORS[0], bn = -1;
            for (const col of MANA_COLORS) { const n = this.board.getTilesOfType(col).length; if (n > bn) { bn = n; best = col; } }
            color = best;
          }
          this.board.lockColor(color, Math.max(2, l.turns || 2));
          break;
        }
        default: break;
      }
      if (this.p.hp <= 0 || (this.e.hp <= 0 && !this.e.isEgg)) break;
    }
    if (needCascade && this.p.hp > 0 && (this.e.hp > 0 || this.e.isEgg)) {
      if (this._resolveCascade(c)) extraTurn = true;
    }
    return extraTurn;
  }

  _destroyPositions(c, positions) {
    if (!positions.length) return;
    const opp = this.other(c);
    const rw = resolver.resolveDestroyedTileRewards(this.board, positions, c);
    if (this._canGainMana(c)) {
      for (const [color, n] of Object.entries(rw.mana)) {
        if (n > 0) {
          c.mana[color] = (c.mana[color] || 0) + n;
          c.manaGained += n;
          this._onGainMana(c, color, n);
        }
      }
    }
    if (rw.skullDamage > 0) this._applyDamage(c, opp, rw.skullDamage, { isSkull: true, tag: 'skullDestroy' });
    this.board.removeTiles(positions);
    this.board.applyGravity();
    this.board.refill();
  }

  /* ── AI (mirrors EnemyAI's greedy priorities for both sides) ── */

  /**
   * Best board spot to convert a tile INTO `type`: only match-making spots
   * qualify, preferring one whose resulting match grants an extra turn (4+),
   * then the biggest clear. Returns {col,row,extraTurn} or null (no spot).
   */
  _bestConvertSpot(c, type) {
    let best = null, bestScore = -1;
    for (const p of this.board.getTilesNotOfType(type)) {
      if (!this.board.positionCreatesMatch(p.col, p.row, type)) continue;
      const clone = this.board.clone();
      clone.convertTilesToType([p], type);
      const a = resolver.analyzeMatches(clone, c);
      if (!a) continue;
      const score = (a.extraTurnTrigger ? 1000 : 0) + a.positions.length;
      if (score > bestScore) { bestScore = score; best = { col: p.col, row: p.row, extraTurn: !!a.extraTurnTrigger }; }
    }
    return best;
  }

  _chooseSkill(c) {
    if (this._hasStatus(c, 'silenced')) return null;
    const opp = this.other(c);
    let best = null, bestIsDamage = false;
    for (const skill of c.skills) {
      if (!this._canAfford(c, skill)) continue;
      // convert-only skill (Arcane Inscription): HOLD it unless the convert
      // completes a 4+ (extra turn) — that's the competent play. A 3-match
      // cast spends the whole action + mana for ~3 tiles (a tempo loss),
      // and a no-match cast is a pure waste.
      const effects = skill.effects || [];
      const convertOnly = effects.length > 0 && effects.every((e) => e.effectType === 'convert_tile');
      if (convertOnly) {
        const type = (effects[0].convertTile && effects[0].convertTile.type) || 'red';
        const spot = this._bestConvertSpot(c, type);
        if (!spot || !spot.extraTurn) continue;
      }
      // player-side "don't waste it" heuristics
      if (c.side === 'player') {
        const healAmt = sum((skill.effects || []).filter((e) => e.effectType === 'heal')
          .map((e) => ((e.heal && e.heal.amount) || 0) + scaledBonus(e.heal && e.heal.scaling, c)));
        const isPureHeal = healAmt > 0 && !this._isDamageSkill(skill)
          && !(skill.effects || []).some((e) => ['extra_turn', 'create_tiles', 'convert_tiles_by_type', 'gain_attack'].includes(e.effectType));
        if (isPureHeal && (c.maxHp - c.hp) < healAmt * 0.6) continue;
        if (healAmt > 0 && this._isDamageSkill(skill) === false && (c.maxHp - c.hp) < healAmt * 0.4
          && !(skill.effects || []).some((e) => e.effectType !== 'heal')) continue;
      }
      const isDamage = this._isDamageSkill(skill);
      if (!best || (isDamage && !bestIsDamage)) { best = skill; bestIsDamage = isDamage; }
    }
    return best;
  }

  _scoreSwapBoard(c, board) {
    // verbatim port of EnemyAI._scoreBoard priorities
    const matches = board.findAllConnectedMatches();
    if (matches.length === 0) return -1;
    const opp = this.other(c);
    const myColors = this._skillColors[c.side];
    const oppColors = this._skillColors[opp.side];
    let score = 0;
    const gained = {};
    for (const color of Object.keys(myColors)) gained[color] = 0;
    if (matches.some((m) => m.count >= 4)) score += 10000;
    for (const m of matches) {
      if (isSkull(m.typeId)) {
        score += calculateMatchedSkullDamage(c, m.count) * 100;
      } else {
        score += m.count * 5;
        if (gained[m.typeId] !== undefined) { gained[m.typeId] += m.count; score += m.count * 12; }
        if (oppColors[m.typeId]) score += m.count * 4;
      }
      if (m.isShape) score += 15;
    }
    for (const skill of c.skills) {
      if (!skill.cost || !Object.keys(skill.cost).length) continue;
      let can = true;
      for (const [color, amt] of Object.entries(skill.cost)) {
        if (((c.mana[color] || 0) + (gained[color] || 0)) < amt) { can = false; break; }
      }
      if (can) score += this._isDamageSkill(skill) ? 200 : 120;
    }
    const totalTiles = matches.reduce((s, m) => s + m.count, 0);
    if (totalTiles >= 5) score += 25;
    if (totalTiles >= 8) score += 40;
    return score;
  }

  _chooseSwap(c) {
    const swaps = this.board.getValidSwaps();
    let best = null, bestScore = 0;
    for (const sw of swaps) {
      const clone = this.board.clone();
      clone.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      const score = this._scoreSwapBoard(c, clone);
      // score is -1 when the swap makes no match — only match-making swaps are legal
      if (score > bestScore) { bestScore = score; best = sw; }
    }
    return best;
  }

  /* ── turn structure ── */
  _turnStart(c) {
    this._active = c;
    c.barrier = 0;                       // one-round shield expires
    c._turnDamageTaken = 0;
    c._deathbringerFired = false;
    this.board.tickLocks();
    this._tickStatuses(c);
    if (this.p.hp <= 0 || (this.e.hp <= 0 && !this.e.isEgg)) return;
    this._passives(c, 'onTurnStart', {});
    this._recomputeDynAtk(c);
  }

  _turnEnd(c) {
    const opp = this.other(c);
    // poison the APPLIER placed ticks at the applier's turn end
    if (opp.poison > 0) {
      this._applyDamage(null, opp, opp.poison, { tag: 'poisonTick' });
      opp.poison = Math.floor(opp.poison / POISON_DECAY_DIVISOR);
    }
    this._passives(c, 'onTurnEnd', {});
    if (c === this.p) this._resolveEggAtPlayerTurnEnd();
    opp.maxTurnDamageTaken = Math.max(opp.maxTurnDamageTaken, opp._turnDamageTaken);
    c.maxTurnDamageTaken = Math.max(c.maxTurnDamageTaken, c._turnDamageTaken);
  }

  /* ── public policy helpers (for opts.playerPolicy / opts.enemyPolicy) ── */
  canAfford(c, skill) { return this._canAfford(c, skill); }
  greedySkill(c) { return this._chooseSkill(c); }
  greedySwap(c) { return this._chooseSwap(c); }

  _performSwap(c, sw) {
    this.board.swap(sw.col1, sw.row1, sw.col2, sw.row2);
    return this._resolveCascade(c);
  }

  _act(c) {
    // one action: policy seam first (see header), else greedy. Returns extraTurn.
    const policy = c === this.p ? this.opts.playerPolicy : this.opts.enemyPolicy;
    if (policy) {
      const action = typeof policy === 'function' ? policy(this, c) : policy.chooseAction(this, c);
      if (action) {
        if (action.type === 'cast' && action.skill
            && this._canAfford(c, action.skill) && !this._hasStatus(c, 'silenced')) {
          return this._castSkill(c, action.skill, action.target || null);
        }
        if (action.type === 'swap' && action.swap) return this._performSwap(c, action.swap);
        if (action.type === 'pass') return false;
      }
      // null / invalid action → fall back to greedy
    }
    return this._greedyAct(c);
  }

  _greedyAct(c) {
    // prefer skill (damage-first), else best swap
    const skill = this._chooseSkill(c);
    if (skill) return this._castSkill(c, skill);
    const sw = this._chooseSwap(c);
    if (!sw) { // no legal move — reshuffle (mirrors auto-pass/reshuffle behavior)
      this.board.reshuffle();
      return false;
    }
    return this._performSwap(c, sw);
  }

  _alive() { return this.p.hp > 0 && (this.e.hp > 0 || this.e.isEgg); }
  _over() { return this.p.hp <= 0 || (this.e.hp <= 0 && !this.e.isEgg) || (this.e.hp <= 0 && this.e.isEgg); }

  /** Run to completion. Returns a result summary. */
  run() {
    const maxCycles = this.opts.maxTurns || MAX_TURN_CYCLES;
    let side = this.p; // player acts first
    while (this.turnCycles < maxCycles) {
      this.turnCycles += (side === this.p) ? 1 : 0;
      this._turnStart(side);
      if (this._done()) break;
      let actions = 0;
      let extra = true;
      while (extra && actions < MAX_ACTIONS_PER_TURN) {
        extra = this._act(side);
        actions++;
        if (side === this.p) this.playerActions++;
        if (side === this.p) side.extraTurns += extra ? 1 : 0;
        if (this._done()) break;
        // forced hidden extra turn (egg phase) — player keeps the turn
        if (side === this.p && this._forcedExtra) { this._forcedExtra = false; extra = true; }
      }
      if (this._done()) break;
      this._turnEnd(side);
      if (this._done()) break;
      side = this.other(side);
    }
    const playerWon = this.p.hp > 0 && (this.e.hp <= 0);
    return {
      winner: this.p.hp <= 0 ? 'enemy' : (this.e.hp <= 0 ? 'player' : 'draw'),
      playerWon,
      turns: this.playerActions,
      turnCycles: this.turnCycles,
      playerHpFrac: Math.max(0, this.p.hp) / this.p.maxHp,
      enemyHpFrac: Math.max(0, this.e.hp) / this.e.maxHp,
      playerDealt: { ...this.p.dealt },
      enemyDealt: { ...this.e.dealt },
      playerCasts: this.p.casts,
      enemyCasts: this.e.casts,
      playerManaGained: this.p.manaGained,
      playerExtraTurns: this.p.extraTurns,
      playerMaxTurnDamageTaken: this.p.maxTurnDamageTaken,
      playerMaxHp: this.p.maxHp,
    };
  }

  _done() {
    if (this.p.hp <= 0) return true;
    if (this.e.hp <= 0 && !this.e.isEgg) return true;
    if (this.e.isEgg && this.e.hp <= 0) return true;
    return false;
  }
}

/* ═══════════════════════════ batch + aggregation ═══════════════════════════ */

/**
 * Run one matchup n times. `makePlayer`/`makeEnemy` are FACTORIES so each
 * battle gets fresh state. Synchronous — callers chunk it for UI responsiveness.
 */
export function runBatch(makePlayer, makeEnemy, n = 100, opts = {}) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const b = new Battle(makePlayer(), makeEnemy(), opts);
    results.push(b.run());
  }
  return aggregate(results);
}

export function aggregate(results) {
  const n = results.length || 1;
  const wins = results.filter((r) => r.playerWon);
  const turnsArr = results.map((r) => r.turns).sort((a, b) => a - b);
  const q = (p) => turnsArr[Math.min(turnsArr.length - 1, Math.floor(p * turnsArr.length))] || 0;
  const meanOf = (f) => sum(results.map(f)) / n;
  const dealtTotals = {};
  for (const r of results) for (const [k, v] of Object.entries(r.playerDealt)) dealtTotals[k] = (dealtTotals[k] || 0) + v;
  const enemyDealtTotals = {};
  for (const r of results) for (const [k, v] of Object.entries(r.enemyDealt)) enemyDealtTotals[k] = (enemyDealtTotals[k] || 0) + v;
  const totalTurns = Math.max(1, sum(results.map((r) => r.turns)));
  return {
    n,
    winRate: wins.length / n,
    drawRate: results.filter((r) => r.winner === 'draw').length / n,
    turns: { mean: meanOf((r) => r.turns), median: q(0.5), p10: q(0.1), p90: q(0.9) },
    hpLeftOnWin: wins.length ? sum(wins.map((r) => r.playerHpFrac)) / wins.length : 0,
    playerDPT: sum(results.map((r) => sum(Object.values(r.playerDealt)))) / totalTurns,
    enemyDPT: sum(results.map((r) => sum(Object.values(r.enemyDealt)))) / Math.max(1, sum(results.map((r) => r.turnCycles))),
    castsPerFight: meanOf((r) => r.playerCasts),
    manaPerTurn: sum(results.map((r) => r.playerManaGained)) / totalTurns,
    extraTurnRate: sum(results.map((r) => r.playerExtraTurns)) / totalTurns,
    burstShare: meanOf((r) => r.playerMaxTurnDamageTaken / Math.max(1, r.playerMaxHp)),
    damageShares: dealtTotals,
    enemyDamageShares: enemyDealtTotals,
    results,
  };
}

/* ═══════════════════════════ full-run simulation ═══════════════════════════ */

/** weighted pick from {key: weight} */
function weightedKey(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = sum(entries.map(([, w]) => w));
  let roll = Math.random() * total;
  for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
  return entries.length ? entries[entries.length - 1][0] : null;
}

/** Pick reward options like relicRewards.generateRelicRewardOptions (rarity-weighted, no dupes/owned/starter). */
export function pickRelicRewards(ownedIds, count = 3) {
  const eligible = Object.values(RELIC_CATALOG).filter((r) => r.rarity !== 'starter' && !ownedIds.includes(r.id));
  const options = [];
  const pool = [...eligible];
  while (options.length < count && pool.length) {
    const weights = {};
    for (let i = 0; i < pool.length; i++) {
      weights[i] = RELIC_RARITY_WEIGHTS[pool[i].rarity] != null ? RELIC_RARITY_WEIGHTS[pool[i].rarity] : DEFAULT_RELIC_RARITY_WEIGHT;
    }
    const k = weightedKey(weights);
    if (k == null) break;
    options.push(pool[Number(k)]);
    pool.splice(Number(k), 1);
  }
  return options;
}

/**
 * Simulate ONE full run: floors 1..10. Node types: boss at floor 10, two elite
 * floors sampled from 5..9, others battles — with `fightChance` odds a non-boss
 * floor is a fight at all (chest/rest/training density knob). A non-fight floor
 * may be a TRAINING node when `cfg.weave` is supplied (grants a woven skill).
 *
 * The player starts with ONLY the character's kit; everything else arrives
 * in-run (relic rewards after victories, woven skills at training nodes).
 *
 * @param {object} cfg
 *  characterId, fightChance (default 0.75), relicPickPolicy: 'random'|'first'|'none',
 *  eliteFloors (default: sample 2 of 5..9), maxTurns,
 *  battleOpts    — extra Battle opts (playerPolicy/enemyPolicy — see POLICY SEAM),
 *  onReward(ev)  — called per relic reward: { floor, offered: string[], picked: string }
 *                  (offered = the real rarity-weighted 3-option roll — logging this
 *                  is what makes random-pick runs a randomized trial per item),
 *  weave         — { floors?, chance?, makeSkill({floor}) → { skill, meta? } | null }:
 *                  training-node model. `floors: N` pre-samples N distinct
 *                  TRAINING floors from 2..9 (excluding elites — a training
 *                  node REPLACES that floor's fight, like a real map path;
 *                  design target: ~2 weaves per act). `floors: [..]` pins
 *                  them. Legacy `chance` instead makes each NON-fight floor a
 *                  training node with that probability. The returned full
 *                  skill object joins the player's kit for the rest of the
 *                  run (deep-cloned per battle by the factory).
 * @returns per-floor records + final outcome (+ wovenSkills)
 */
export function simulateRun(cfg = {}) {
  const characterId = cfg.characterId || 'warrior';
  const fightChance = cfg.fightChance != null ? cfg.fightChance : 0.75;
  const relicPolicy = cfg.relicPickPolicy || 'random';
  const battleOpts = { maxTurns: cfg.maxTurns || MAX_TURN_CYCLES, ...(cfg.battleOpts || {}) };
  let victories = 0;
  const ownedRelicIds = [];
  const customSkills = [];
  const seenByAct = {};
  const floors = [];
  // elite placement: 2 distinct floors in 5..9 (approximates MapGenerator's two reachable elites)
  let eliteFloors = cfg.eliteFloors;
  if (!eliteFloors) {
    const cand = [5, 6, 7, 8, 9];
    const a = cand.splice(rint(cand.length), 1)[0];
    const b = cand.splice(rint(cand.length), 1)[0];
    eliteFloors = [a, b];
  }
  // training-floor placement (weave.floors mode): N distinct floors in 2..9,
  // never on an elite floor — a training node replaces that floor's fight
  let trainingFloors = null;
  if (cfg.weave && typeof cfg.weave.makeSkill === 'function' && cfg.weave.floors != null) {
    if (Array.isArray(cfg.weave.floors)) trainingFloors = cfg.weave.floors;
    else {
      trainingFloors = [];
      const cand = [2, 3, 4, 5, 6, 7, 8, 9].filter((f) => !eliteFloors.includes(f));
      for (let k = 0; k < cfg.weave.floors && cand.length; k++) trainingFloors.push(cand.splice(rint(cand.length), 1)[0]);
    }
  }
  const grantWeave = (floor) => {
    const made = cfg.weave.makeSkill({ floor });
    if (made && made.skill) {
      customSkills.push(made.skill);
      floors.push({ floor, type: 'training', weave: made.meta || null });
      return true;
    }
    return false;
  };
  let alive = true;
  for (let floor = 1; floor <= FLOOR_COUNT && alive; floor++) {
    const isBoss = floor === FLOOR_COUNT;
    const isElite = eliteFloors.includes(floor);
    if (trainingFloors && trainingFloors.includes(floor) && !isBoss && !isElite) {
      if (grantWeave(floor)) continue;
    }
    const isFight = isBoss || isElite || Math.random() < fightChance;
    if (!isFight) {
      // legacy chance mode: some non-fight floors grant a woven skill
      if (cfg.weave && typeof cfg.weave.makeSkill === 'function' && !trainingFloors
          && Math.random() < (cfg.weave.chance || 0) && grantWeave(floor)) continue;
      floors.push({ floor, type: 'skip' });
      continue;
    }
    const nodeType = isBoss ? 'boss' : (isElite ? 'elite' : 'battle');
    const def = selectEnemyForNode({ floor, nodeType, seenByAct });
    const act = def.act || 1;
    (seenByAct[act] = seenByAct[act] || []).push(def.id);
    const player = makePlayerCombatant({ characterId, victories, relicIds: ownedRelicIds, customSkills });
    const enemy = makeEnemyCombatant(def, floor);
    const res = new Battle(player, enemy, battleOpts).run();
    floors.push({ floor, type: nodeType, enemyId: def.id, enemyName: def.name, won: res.playerWon, turns: res.turns, hpFrac: res.playerHpFrac, casts: res.playerCasts });
    if (!res.playerWon) { alive = false; break; }
    victories++;
    if (relicPolicy !== 'none') {
      const options = pickRelicRewards(ownedRelicIds, 3);
      if (options.length) {
        const chosen = relicPolicy === 'first' ? options[0] : pick(options);
        ownedRelicIds.push(chosen.id);
        if (typeof cfg.onReward === 'function') {
          cfg.onReward({ floor, offered: options.map((o) => o.id), picked: chosen.id });
        }
      }
    }
  }
  return {
    survived: alive,
    deathFloor: alive ? null : floors[floors.length - 1].floor,
    victories,
    relics: [...ownedRelicIds],
    wovenSkills: customSkills.map((s) => ({ id: s.id, name: s.name, recipe: (s.woven && s.woven.recipe) || null })),
    floors,
  };
}
