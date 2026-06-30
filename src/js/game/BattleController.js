/**
 * BattleController — top-level orchestrator for match-3 battle gameplay.
 *
 * State machine:
 *   PLAYER_TURN → RESOLVING → ENEMY_TURN → RESOLVING → PLAYER_TURN ...
 *   PLAYER_TURN → TARGETING → RESOLVING → ...
 *
 * Configurable timing via speedMultiplier (1.0 = normal, 2.0 = fast).
 */

import BoardModel from './BoardModel.js';
import MatchResolver, { SKILL_EFFECT_TYPES } from './MatchResolver.js';
import CombatLog from './CombatLog.js';
import EnemyAI from './EnemyAI.js';
import { chooseEnemyAction } from './customEnemyAi.js';
import { TILE_TYPES, isSkull, MANA_COLORS } from './TileTypes.js';
import { getStatusDef } from '../data/statusEffects.js';
import { scaledBonus } from '../data/scalingConfig.js';
import PassiveSystem from '../systems/PassiveSystem.js';
import TRIGGER_TYPES from '../systems/TriggerTypes.js';

/** @enum {string} */
export const BattleState = {
  PLAYER_TURN: 'PLAYER_TURN',
  ENEMY_TURN: 'ENEMY_TURN',
  RESOLVING: 'RESOLVING',
  SWAPPING: 'SWAPPING',
  TURN_INTRO: 'TURN_INTRO',
  TARGETING: 'TARGETING',
  GAME_OVER: 'GAME_OVER',
};

const CascadePhase = {
  SHOW_MATCH: 'SHOW_MATCH',
  REMOVE: 'REMOVE',
  FALL: 'FALL',
};

/** Base durations in ms (scaled by speedMultiplier) */
const BASE_PHASE_MS = { SHOW_MATCH: 400, REMOVE: 200, FALL: 350 };
const ENEMY_BASE_DELAY = 400;
const SWAP_BASE_DURATION = 120;
/**
 * Magic → bonus mana from matching: every this-many Magic adds +1 to the mana
 * gained from each matched color (floor(magic / N)). Stacks with mana-gain
 * relics (Bellows, etc.). Applied per matched color in _applyMatchBonuses.
 */
const MAGIC_MANA_PER_POINT = 9;
/** Turn intro animation delay in ms (NOT scaled — presentation timing) */
const TURN_INTRO_DURATION = 600;
/** Max extra ms the turn will wait on `_turnGate` (damage-delivery animation)
 *  before proceeding anyway — a safety cap so a stuck effect can't hang. */
const TURN_GATE_MAX_HOLD = 2000;
/**
 * How long (ms) the boss waits at turn start while the Usurper's Heart harvest
 * energy tendrils stay connected from each Thrall tile to its portrait before it
 * takes its action. Presentation timing — keep roughly in sync with
 * HarvestTendrilEffect's total duration (form + hold + fade).
 */
const HARVEST_ANIM_DELAY = 900;

export default class BattleController {
  constructor(playerData, enemyData) {
    this.board = new BoardModel();
    this.resolver = new MatchResolver();
    this.log = new CombatLog();

    this.playerState = this._cloneState(playerData);
    this.enemyState = this._cloneState(enemyData);

    /**
     * Pre-resolved alternate enemy battle-data forms keyed by enemy id, for
     * mid-battle transforms (Sanguine Phoenix ⇄ Sanguine Egg). MapScene scales
     * + resolves every reachable form (`transformForms`) the SAME way as the
     * primary enemy and attaches them here, so a transform is a pure in-place
     * identity swap (see _transformInto). null for enemies that never transform.
     * @type {Object<string, object>|null}
     */
    this._enemyForms = (enemyData && enemyData._forms) || null;

    /**
     * One-shot transform signal. Set to the new enemy state when the enemy
     * transforms (death→Egg or Egg→Phoenix revert) so the scene rebuilds the
     * enemy portrait + skills pane. Read & cleared via getState().
     * @type {object|null}
     */
    this._enemyTransformed = null;

    /** One-shot SFX key to play on the next transform (egg spawn / hatch),
     *  taken from the relic's transform `sound` payloads. Read &
     *  cleared via getState(). @type {string|null} */
    this._pendingTransformSfx = null;

    /** Re-entry guard while dispatching onDeath (a transform that leaves HP at
     *  0 must not re-trigger onDeath forever). @type {boolean} */
    this._deathTransformFiring = false;

    /**
     * Sanguine Egg phase state (the turn-based egg minigame — see decision #37 /
     * _applyTransform). When the Phoenix is "killed" it becomes the Egg — a
     * NORMAL, killable low-HP enemy — and the player KEEPS the turn (a hidden
     * extra turn), so they get one turn (extra turns included) to slay it:
     *   - slay it → VICTORY (the normal enemy-death path, _checkGameOver)
     *   - fail    → at the player's turn END the Egg reverts to a full-life
     *               Phoenix (_resolveEggPhaseAtTurnEnd)
     * `_eggForcedExtraTurn` suppresses the "extra turn" announcement so the
     * retained turn stays hidden.
     */
    this._eggPhaseActive = false;
    this._eggForcedExtraTurn = false;
    /** `{ revertEnemyId, revertSound }` — copied from the Sanguine Egg relic's
     *  `transform` payload when the phase begins. */
    this._eggPhaseConfig = null;

    this.enemyAI = null;

    /** @type {BattleState} */
    this.state = BattleState.TURN_INTRO;
    this.pendingExtraTurn = false;
    this.activeSide = 'player';

    /** Set when entering TURN_INTRO so the scene spawns an announcement effect.
     *  'player' | 'enemy' | null — read & cleared by getState(). */
    this._turnAnnouncement = 'player';
    /** Persists the target side through the intro so _completeTurnIntro
     *  can transition correctly even after the scene clears _turnAnnouncement.
     *  'player' | 'enemy' | null — NOT cleared by getState(). */
    this._nextTurnSide = 'player';
    /** Timer for TURN_INTRO delay before transitioning to the actual turn. */
    this._turnIntroTimer = 0;
    /**
     * Optional gate the scene can set so the turn does NOT pass until a
     * just-dealt-damage delivery animation (the flying damage counter) has
     * impacted the target portrait. `() => true` holds the TURN_INTRO; capped
     * by TURN_GATE_MAX_HOLD so a stuck animation can never freeze the battle.
     */
    this._turnGate = null;
    this._turnGateHold = 0;
    /**
     * TURN_INTRO runs in two phases: (A) a silent hold while a just-dealt
     * damage counter flies to + impacts the target portrait (no announcement),
     * then (B) the "Player/Enemy Turn" announcement + the normal intro delay.
     * `_introAnnounced` flips false→true at the A→B handoff. Starts true so the
     * very first turn (no damage pending) announces immediately as before.
     */
    this._introAnnounced = true;

    /**
     * Board position (col, row) of the swap that triggered the current
     * resolution cascade. Used as origin for extra-turn visual effects.
     * @type {{col:number, row:number}|null}
     */
    this._swapTriggerPos = null;

    /**
     * Set when a 4+ match is found during resolution. The scene
     * reads and clears this each frame to spawn visual effects.
     * Updated for every cascade step that contains a 4+ match.
     * @type {{col:number, row:number}|null}
     */
    this.extraTurnTriggerPos = null;

    /**
     * Accumulated per-match floating text triggers for the current
     * cascade step. Each entry: { typeId, count, position: {col, row} }.
     * The scene reads and clears this each frame to spawn "+3"/"+4"/etc
     * floating text effects for every match found.
     * Updated for every cascade step.
     * @type {Array<{typeId:string, count:number, position:{col:number, row:number}}>}
     */
    this._matchTextTriggers = [];

    /**
     * Accumulated combat-stat floating text events for the current frame.
     * Each entry: { side: 'player'|'enemy', kind: 'damage'|'heal'|'armor', amount }.
     * The scene reads and clears this each frame (via getState()) to animate
     * "-x" (red, damage) / "+x" (green, heal) / "+x" (blue, armor) over the
     * affected character's portrait. Emitted via _emitFloatingStat() from the
     * single damage chokepoint (_applyDamage) and the heal/armor handlers
     * (skill effects + passive relic effects).
     * @type {Array<{side:string, kind:string, amount:number}>}
     */
    this._floatingStatEvents = [];

    /**
     * Relic-trigger events for the current frame. Each entry:
     * { side: 'player'|'enemy', relicId }. Emitted whenever a relic's passive
     * effect fires (via PassiveSystem's onRelicTrigger callback); read & cleared
     * each frame via getState() so BattleScene can "jiggle" the relic's icon.
     * @type {Array<{side:string, relicId:string}>}
     */
    this._relicTriggerEvents = [];

    /**
     * Speed multiplier for all animation timing.
     * 1.0 = normal, 2.0 = fast, 0.5 = slow.
     * Scales phase durations, enemy delay, and swap duration.
     */
    this.speedMultiplier = 1.5;

    // ── Cascade step-by-step ──
    this._cascadePhase = null;
    this._phaseTimer = 0;
    /** @type {import('./MatchResolver.js').MatchAnalysis|null} */
    this._analysis = null;
    this._allSteps = [];
    this._extraTurnEarned = false;

    /**
     * Positions that were empty (removed) in the previous cascade step.
     * Saved before gravity so we can compute the "cause" position for
     * cascade 4+ match effects by intersecting with new match positions.
     * @type {Array<{col:number, row:number}>|null}
     */
    this._previousEmptyCells = null;

    // ── Visual state (exposed for BoardPlaceholder) ──
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];

    // ── Swap animation ──
    /** @type {{from:{col:number,row:number},to:{col:number,row:number},progress:number,duration:number,valid:boolean}|null} */
    this.swapAnim = null;

    // ── Targeting state (for skills like Explode!) ──
    /** @type {object|null} skill being targeted (copy of skill def) */
    this._targetingSkill = null;
    /** @type {{col:number, row:number}|null} hovered cell during targeting */
    this._targetHoverCell = null;
    /** @type {Array<{col:number, row:number}>} cells in targeting overlay */
    this._targetingOverlayCells = [];

    /** @type {Array<{col:number, row:number}>} tiles destroyed by skill (for REMOVE phase visual) */
    this._skillDestroyedPositions = [];

    /**
     * Tiles destroyed in the current cascade step. Captured BEFORE
     * removeTiles() so the scene can spawn matching-color particle bursts.
     * Each entry: { col, row, typeId }.
     * Read & cleared by BattleScene via getState().
     * @type {Array<{col:number, row:number, typeId:string}>|null}
     */
    this._destroyedTilesThisStep = null;

    /**
     * Tiles converted by a CREATE_TILES skill effect.
     * Each entry: { col, row, typeId } where typeId is the new tile type.
     * Read & cleared by BattleScene via getState() so it can spawn
     * a conversion shimmer effect on each converted tile.
     * @type {Array<{col:number, row:number, typeId:string}>|null}
     */
    this._convertedTilePositions = null;

    /**
     * Pending Thrall-harvest animation events (Baron's Signet). Each entry
     * captures the Thrall tile positions (BEFORE they are converted to skulls)
     * and the side harvesting them, so BattleScene can spiral red "tendril"
     * effects from each Thrall toward the harvester's portrait. Read & cleared
     * by BattleScene via getState().
     * @type {Array<{side:'player'|'enemy', positions:Array<{col:number,row:number}>, color:string}>}
     */
    this._harvestEvents = [];

    /**
     * One-shot flag: set when a `create_tiles` passive summons Thrall tiles
     * (Baron's Signet) so BattleScene can play the Thrall-summon SFX exactly
     * once. Read & cleared by getState().
     * @type {boolean}
     */
    this._thrallSummoned = false;

    /**
     * One-shot flag: set when a SHUFFLE effect reshuffles the board so
     * BattleScene plays the board-shuffle animation exactly once. Read &
     * cleared by getState().
     * @type {boolean}
     */
    this._boardShuffled = false;

    /**
     * Extra delay (ms) added to the enemy's pre-action wait for the CURRENT
     * turn only, so a turn-START spectacle (the Usurper's Heart harvest
     * tendrils, fired on the boss's onTurnStart) can play out before the boss
     * acts. Reset at each turn intro (before onTurnStart dispatch so the harvest
     * can set it); applied in update()'s ENEMY_TURN branch.
     * @type {number}
     */
    this._extraEnemyTurnDelay = 0;

    /**
     * Pending screen-shake intensity (0-1). Set when damage is dealt,
     * read & cleared by BattleScene each frame via getState().
     * @type {number}
     */
    this._pendingShakeIntensity = 0;

    /**
     * Counter for skull damage events during resolution. The scene
     * reads and clears this each frame to play skull_damage SFX.
     * Using a counter instead of a boolean so rapid cascade events
     * are not lost between getState() calls.
     * @type {number}
     */
    this._skullDamageCount = 0;

    /**
     * One-shot per-side "dealt DIRECT damage" flags (skill DAMAGE/CONSUME effects
     * + skull damage — NOT incidental damage like reflect / relic echo / poison /
     * bleed / passive reactors, which mark nothing). Set via _markDirectDamage();
     * read-and-cleared each frame in getState(). Drives the attack-animation POC.
     * @type {{player: boolean, enemy: boolean}}
     */
    this._directDamageBySide = { player: false, enemy: false };

    /**
     * Pending skill resolve sound key. Set when a skill actually resolves
     * (not on button click). The scene reads and clears this each frame.
     * If the skill has no `sound` field, remains null (no error).
     * @type {string|null}
     */
    this._pendingSkillSound = null;

    // ── Enemy turn ──
    this._enemyTimer = 0;
    this._enemyFired = false;

    // Deferred skull destructions requested by passive relics (Deathbringer).
    // Accumulated when the owner deals damage (onDealDamage) and drained at a
    // safe boundary (end of resolution / end of an instant skill) so the board
    // mutation doesn't happen mid-cascade. See _maybeStartPendingSkullDestroy.
    this._pendingSkullDestroy = 0;
    // Recursion guard: Deathbringer may fire at most ONCE per action (turn).
    // The skull damage its destruction deals would otherwise re-trigger it via
    // onDealDamage. Set when it queues; reset at each (extra-)turn start.
    this._deathbringerFiredThisAction = false;

    // Reentrancy guard for echo_damage relics (Goresnout Collars): the echo
    // deals damage which re-fires onDealDamage; without this in-stack flag the
    // relic would echo its own echo forever. Set true only while an echo is
    // being applied so the nested onDealDamage can't spawn another echo.
    this._echoDamageActive = false;

    // Set when a turn-start passive board effect (e.g. Chokeweed Sap) creates
    // a match and kicks off a cascade DURING onTurnStart. The active side
    // hasn't taken its action yet, so when that cascade finishes we resume its
    // normal turn instead of ending it (the default _finishResolving routing).
    this._resumeTurnAfterResolve = false;

    // ── Callbacks ──
    this.onStateChange = null;

    // ── Passive system ──
    // Dispatcher for relic-based passive abilities. Battle code emits
    // TRIGGER events; PassiveSystem looks up the affected side's relics
    // and resolves matching effects via EffectResolver.
    //
    // The resolver passed to PassiveSystem is a *wrapper* that routes
    // applyDamage through `_applyDamage` so passive-applied damage (e.g.
    // a future "deal X damage on trigger" relic) gets the same
    // onIncomingDamage pre-mitigation pass that regular damage receives.
    // Only methods that EffectResolver actually calls on the resolver
    // need to be re-exported here — currently just applyDamage.
    const passiveResolver = {
      applyDamage: (target, amount) => this._applyDamage(target, amount),
    };
    this.passives = new PassiveSystem({
      playerState: this.playerState,
      enemyState: this.enemyState,
      log: this.log,
      resolver: passiveResolver,
      // Any damage dealt by a relic effect routes screen shake + SFX
      // through the same hooks that normal damage uses.
      onDamage: (info) => {
        const target = info.target || (info.side === 'target' ? this._currentRelicTarget : null);
        if (target) {
          this._setShakeFromDamage(info.actualDamage, target.maxHp);
        }
        // Passive-applied damage (e.g. Briarthorn's onTurnStart hit) must fire
        // the SAME onTakeDamage / onDealDamage triggers that skill & match damage
        // do, so defensive reactors like Family Crest (gain mana when damaged)
        // respond to every instance of damage regardless of its source. Damage-
        // triggered passives invoked from here (echo, Deathbringer) carry their
        // own reentrancy / once-per-action guards, so this can't loop.
        if (info.caster && info.target && info.actualDamage > 0) {
          const attackerSide = info.caster === this.playerState ? 'player' : 'enemy';
          const targetSide = info.target === this.playerState ? 'player' : 'enemy';
          this._dispatchDamageEvent(attackerSide, targetSide, info);
        }
      },
      onExtraTurn: () => {
        // Frozen blocks ALL extra-turn grants for the active side, including
        // passive/relic-granted ones routed through here.
        if (this._canGainExtraTurn(this.activeSide)) this._extraTurnEarned = true;
      },
      // Board-touching passive effects (e.g. destroy_tiles_radius from
      // Unstable Catalyst) are routed here so the cascade phase machine
      // stays in charge of board mutations.
      onBoardEffect: (effect, triggerName, payload, ctx) =>
        this._handlePassiveBoardEffect(effect, triggerName, payload, ctx),
      // Relic-granted mana (Familiars, Family Crest, Prism) routes back here so
      // onGainMana reactors (Tuning Rod, Flaming Arrow, …) fire for it too. Depth-
      // guarded so a hypothetical gain-mana-on-gain-mana relic can't loop forever.
      onGainMana: (side, color, amount) => {
        if (this._manaGainDepth >= 4) return;
        this._manaGainDepth++;
        this._dispatchManaGain(side, color, amount);
        this._manaGainDepth--;
      },
      // Passive heal/armor effects (e.g. Goblin Totem armor, Soul Eater heal)
      // animate floating "+x" text over the owner's portrait, same as skill
      // heal/armor. info: { kind:'heal'|'armor', target, amount }.
      onStatChange: (info) => {
        const side = info.target === this.playerState ? 'player' : 'enemy';
        this._emitFloatingStat(side, info.kind, info.amount);
      },
      // A relic's passive fired — queue a "jiggle" animation for its icon.
      onRelicTrigger: (relicId, side) => {
        if (relicId) this._relicTriggerEvents.push({ side, relicId });
      },
    });
    /** Set during a relic dispatch so onDamage can reference the right side. */
    this._currentRelicTarget = null;
    /** Reentrancy depth for relic-triggered onGainMana dispatches. */
    this._manaGainDepth = 0;

    // ── Static passive modifiers (onBattleStart) ──
    // Aggregate persistent relic modifiers (attack, spawn rate, mana gain,
    // skull damage) from both sides BEFORE the board is built so spawn-rate
    // boosts shape the starting board.
    this._initStaticModifiers();

    // ── Init ──
    this.board.initialize();
    this.log.add('Battle begins! Your turn.');
  }

  /**
   * Aggregate static-modifier relic effects (trigger `onBattleStart`) from
   * both sides and apply them once at battle setup. These are persistent
   * passives that don't fit the event-dispatch model:
   *   modify_stat        — add to a combatant stat (e.g. attack +3)
   *   modify_spawn_rate  — boost a tile's board spawn % (board-global)
   *   modify_mana_gain   — bonus mana per match of a color (per side)
   *   modify_skull_damage— bonus matched-skull damage (per side)
   *
   * Data-driven: dispatched by `effectType`, never by relic id. Spawn-rate
   * boosts are board-global (the board is shared) so they aggregate across
   * both sides; the other modifiers are stored per-combatant.
   */
  _initStaticModifiers() {
    const boardBoosts = {};

    for (const side of [this.playerState, this.enemyState]) {
      // Per-side bonus tables read during reward granting (_applyMatchBonuses).
      side._manaGainBonus = {};
      side._skullDamageBonus = 0;
      // Dynamic-attack-from-unspent-mana rules (Group A: Cestus/Harpoon/...).
      // Each rule grants `amount` attack per `per` unspent mana of `color`.
      // The bonus is recomputed live (it changes as mana is spent/gained);
      // _lastDynamicAttack tracks the amount currently folded into `attack`.
      side._attackPerManaRules = [];
      side._lastDynamicAttack = 0;

      for (const relic of side.relics || []) {
        for (const effect of relic.effects || []) {
          if (effect.trigger !== TRIGGER_TYPES.ON_BATTLE_START) continue;
          switch (effect.effectType) {
            case 'modify_stat': {
              const m = effect.modifyStat || {};
              if (m.stat && typeof m.amount === 'number') {
                side[m.stat] = (side[m.stat] || 0) + m.amount;
              }
              break;
            }
            case 'attack_per_unspent_mana': {
              const m = effect.attackPerMana || {};
              if (m.color && typeof m.amount === 'number' && typeof m.per === 'number' && m.per > 0) {
                side._attackPerManaRules.push({ color: m.color, per: m.per, amount: m.amount });
              }
              break;
            }
            case 'grant_starting_mana': {
              // One-time mana grant at battle setup (Group: Red/Blue/.../Purple
              // Potion). Intentionally does NOT fire onGainMana — it's setup,
              // not a gameplay gain.
              const m = effect.startingMana || {};
              if (m.color && typeof m.amount === 'number') {
                if (!side.mana) side.mana = {};
                side.mana[m.color] = (side.mana[m.color] || 0) + m.amount;
              }
              break;
            }
            case 'modify_spawn_rate': {
              const m = effect.spawnRate || {};
              if (m.tile && typeof m.amount === 'number') {
                boardBoosts[m.tile] = (boardBoosts[m.tile] || 0) + m.amount;
              }
              break;
            }
            case 'modify_mana_gain': {
              const m = effect.manaGain || {};
              if (m.color && typeof m.amount === 'number') {
                side._manaGainBonus[m.color] = (side._manaGainBonus[m.color] || 0) + m.amount;
              }
              break;
            }
            case 'modify_skull_damage': {
              const m = effect.skullDamage || {};
              if (typeof m.amount === 'number') {
                side._skullDamageBonus += m.amount;
              }
              break;
            }
            default:
              break;
          }
        }
      }
    }

    if (Object.keys(boardBoosts).length > 0) {
      this.board.setSpawnRateBoosts(boardBoosts);
    }

    // Fold in the initial dynamic-attack bonus from starting mana.
    this._recomputeDynamicAttack(this.playerState);
    this._recomputeDynamicAttack(this.enemyState);
  }

  /**
   * Reconcile a side's attack with its dynamic "+attack per N unspent mana"
   * rules (Group A relics). Idempotent and delta-based: it adds only the
   * CHANGE since the last call, so it composes with permanent attack gains
   * (gain_attack from Tsunami/Reckoning/Scythe) without clobbering them.
   * Safe to call every frame and after any mana mutation.
   * @param {object} side — combatant battle state
   */
  _recomputeDynamicAttack(side) {
    if (!side) return;
    // While Cripple (attack override) is active, the side's attack is pinned to
    // a fixed value — freeze dynamic recompute so mana changes don't fight it.
    // _lastDynamicAttack stays put, so on expiry the saved attack and the
    // resumed delta math reconcile correctly against the current mana.
    if (this._hasStatus(side, 'crippled')) return;
    const rules = side._attackPerManaRules;
    if (!rules || rules.length === 0) return;
    let bonus = 0;
    for (const rule of rules) {
      const mana = (side.mana && side.mana[rule.color]) || 0;
      bonus += rule.amount * Math.floor(mana / rule.per);
    }
    const delta = bonus - (side._lastDynamicAttack || 0);
    if (delta !== 0) {
      side.attack = (side.attack || 0) + delta;
      side._lastDynamicAttack = bonus;
    }
  }

  /**
   * Apply the active side's static match bonuses (mana gain per matched
   * color, bonus matched-skull damage) to a cascade-step analysis IN PLACE,
   * before its rewards are granted in _doRemove. Bonuses come from
   * _initStaticModifiers (Group B mana relics, Funerary Bell).
   *
   * Mana bonus is added once per matched color that the side has a bonus
   * for; skull bonus is added per skull match in the step.
   * @param {import('./MatchResolver.js').MatchAnalysis} analysis
   * @param {object} state — the active combatant whose relics apply
   */
  _applyMatchBonuses(analysis, state) {
    if (!analysis || !state) return;

    const manaBonus = state._manaGainBonus || {};
    // Magic boosts mana gained from matches: +1 per matched color for every
    // MAGIC_MANA_PER_POINT Magic (stacks with per-color mana-gain relics).
    const magicMana = Math.floor((state.magic || 0) / MAGIC_MANA_PER_POINT);
    if (analysis.mana) {
      for (const color of Object.keys(analysis.mana)) {
        if (analysis.mana[color] > 0) {
          const b = (manaBonus[color] || 0) + magicMana;
          if (b > 0) analysis.mana[color] += b;
        }
      }
    }

    const skullBonus = state._skullDamageBonus || 0;
    if (skullBonus > 0 && analysis.skullDamage > 0) {
      let skullMatches = 0;
      for (const m of analysis.matches || []) {
        if (isSkull(m.typeId)) skullMatches++;
      }
      if (skullMatches > 0) analysis.skullDamage += skullBonus * skullMatches;
    }
  }

  _cloneState(d) {
    return {
      name: d.name, className: d.className, level: d.level,
      hp: d.hp, maxHp: d.maxHp, attack: d.attack, magic: d.magic || 0, armor: d.armor, block: 0,
      // One-round magic shield pool (absorbs damage like armor; expires at the
      // owner's next turn start). Runtime-only — always starts at 0. See decision #38.
      barrier: 0,
      // POISON stack pool. At the end of the APPLIER's turn this combatant takes
      // armor-piercing damage equal to the stack count, then the stacks halve.
      // Runtime-only — always starts at 0. See _applyPoison / _tickPoison.
      poison: 0,
      // MARK pool: a flat bonus banked onto this combatant's NEXT damage
      // instance, consumed in _applyDamage. Persists until consumed (no timer).
      // Runtime-only — always starts at 0. See decision #40.
      mark: 0,
      mana: d.mana ? { ...d.mana } : {},
      portrait: d.portrait || '',
      skills: (d.skills || []).map(s => ({ ...s })),
      // The FULL owned-skill pool (equipped + reserve) — the Manage Skills
      // modal's inventory. Without carrying it through the clone, the modal
      // falls back to the equipped list and unequipping a skill "trashes" it
      // for the rest of the battle.
      allSkills: (d.allSkills || d.skills || []).map(s => ({ ...s })),
      // Clone relics + their effect arrays so per-battle mutations
      // (e.g. consumed/charged relics in the future) don't leak back
      // into the catalog or the persistent run state.
      relics: (d.relics || []).map(r => ({
        ...r,
        effects: (r.effects || []).map(e => ({ ...e })),
      })),
      // Active status effects (buffs/debuffs). Runtime-only — always starts
      // empty for a fresh battle state. See the status-effect section below.
      statuses: [],
      // Preserve custom AI behavior key from enemy definition (if any)
      aiBehavior: d.aiBehavior || null,
    };
  }

  // ── Timing Helpers ────────────────────────────────────

  _phaseMs(phase) { return BASE_PHASE_MS[phase] / this.speedMultiplier; }
  _enemyDelay()    { return ENEMY_BASE_DELAY / this.speedMultiplier; }
  _swapDuration()  { return SWAP_BASE_DURATION / this.speedMultiplier; }

  // ── Public API ────────────────────────────────────────

  /**
   * Supply a gate predicate that holds the turn from passing while it returns
   * true (e.g. the scene's flying damage counter has not yet impacted the
   * target portrait). Capped by TURN_GATE_MAX_HOLD. Pass null to clear.
   * @param {(() => boolean)|null} fn
   */
  setTurnGate(fn) {
    this._turnGate = typeof fn === 'function' ? fn : null;
  }

  getState() {
    // Capture extraTurnTriggerPos and clear it so scene only
    // spawns one effect per trigger.
    const triggerPos = this.extraTurnTriggerPos;
    this.extraTurnTriggerPos = null;

    // Capture match text triggers and clear so scene spawns once per step.
    const matchTextTriggers = this._matchTextTriggers;
    this._matchTextTriggers = [];

    // Capture shakeIntensity and clear it so scene only
    // triggers one shake per damage event.
    const shakeIntensity = this._pendingShakeIntensity;
    this._pendingShakeIntensity = 0;

    // Capture skull damage count and clear so scene plays SFX.
    const skullDamageDealt = this._skullDamageCount > 0;
    this._skullDamageCount = 0;

    // Capture + clear the one-shot direct-damage flags (drives the attack-anim POC).
    const directDamageBySide = this._directDamageBySide;
    this._directDamageBySide = { player: false, enemy: false };

    // Capture turn announcement and clear so scene spawns once per intro.
    const turnAnnouncement = this._turnAnnouncement;
    this._turnAnnouncement = null;

    // Capture destroyed tile info and clear so scene spawns
    // particle bursts once per destruction step.
    const destroyedTiles = this._destroyedTilesThisStep;
    this._destroyedTilesThisStep = null;

    // Capture converted tile info and clear so scene spawns
    // conversion shimmer effects once per CREATE_TILES resolution.
    const convertedTiles = this._convertedTilePositions;
    this._convertedTilePositions = null;

    // Capture pending skill resolve sound and clear so scene
    // plays it once per skill resolution.
    const pendingSkillSound = this._pendingSkillSound;
    this._pendingSkillSound = null;

    // Capture combat-stat floating text events and clear so the scene spawns
    // each "-x"/"+x" portrait animation exactly once.
    const floatingStatEvents = this._floatingStatEvents;
    this._floatingStatEvents = [];

    // Capture relic-trigger events and clear so the scene starts each icon
    // jiggle exactly once per trigger.
    const relicTriggers = this._relicTriggerEvents;
    this._relicTriggerEvents = [];

    // Capture Thrall-harvest animation events and clear so the scene spawns
    // each tendril effect exactly once per harvest.
    const harvestEvents = this._harvestEvents;
    this._harvestEvents = [];

    // One-shot Thrall-summon SFX flag (Baron's Signet), cleared on read.
    const thrallSummoned = this._thrallSummoned;
    this._thrallSummoned = false;

    // One-shot board-shuffle animation flag (SHUFFLE effect), cleared on read.
    const boardShuffled = this._boardShuffled;
    this._boardShuffled = false;

    // One-shot reflect SFX flag (the `reflecting` buff fired), cleared on read.
    const reflectTriggered = this._reflectTriggered;
    this._reflectTriggered = false;

    // One-shot enemy-transform signal (Sanguine Phoenix ⇄ Egg): the new enemy
    // state so the scene rebuilds the portrait + skills pane. Cleared on read.
    const enemyTransformed = this._enemyTransformed;
    this._enemyTransformed = null;

    // One-shot transform SFX (egg spawn / hatch), cleared on read.
    const transformSfx = this._pendingTransformSfx;
    this._pendingTransformSfx = null;

    return {
      state: this.state, activeSide: this.activeSide,
      playerState: this.playerState, enemyState: this.enemyState,
      board: this.board, log: this.log,
      pendingExtraTurn: this.pendingExtraTurn,
      extraTurnTriggerPos: triggerPos,
      matchTextTriggers,
      shakeIntensity,
      skullDamageDealt,
      directDamageBySide,
      turnAnnouncement,
      destroyedTiles,
      convertedTiles,
      pendingSkillSound,
      floatingStatEvents,
      relicTriggers,
      harvestEvents,
      thrallSummoned,
      boardShuffled,
      reflectTriggered,
      enemyTransformed,
      transformSfx,
      gameOver: this.state === BattleState.GAME_OVER,
      winner: this._winner(),
      highlightCells: this.highlightCells,
      emptyCells: this.emptyCells,
      fallCells: this.fallCells,
      cascadePhase: this._cascadePhase,
      swapAnim: this.swapAnim,
      targetingActive: this.state === BattleState.TARGETING,
      targetingOverlayCells: this._targetingOverlayCells || [],
      targetingSkill: this._targetingSkill,
    };
  }

  getTurnLabel() {
    switch (this.state) {
      case BattleState.PLAYER_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Player Turn';
      case BattleState.ENEMY_TURN:
        return this.pendingExtraTurn ? 'Extra Turn' : 'Enemy Turn';
      case BattleState.TURN_INTRO:
        return this._turnAnnouncement === 'player' ? 'Player Turn' : 'Enemy Turn';
      case BattleState.TARGETING:
        return 'Select a board tile...';
      case BattleState.SWAPPING:
        return 'Swapping...';
      case BattleState.RESOLVING:
        return this._cascadePhase === CascadePhase.SHOW_MATCH ? 'Match!'
          : this._cascadePhase === CascadePhase.REMOVE ? 'Clearing...'
          : this._cascadePhase === CascadePhase.FALL ? 'Falling...'
          : 'Resolving Board';
      case BattleState.GAME_OVER:
        return this._winner() === 'player' ? 'Victory!' : 'Defeat';
      default: return '';
    }
  }

  _winner() {
    // Player checked first: if both fell (or the player was ever reduced to 0),
    // it's a defeat. `_defeated` makes a 0-HP moment stick through later heals.
    if (this.playerState.hp <= 0 || this.playerState._defeated) return 'enemy';
    if (this.enemyState.hp <= 0 || this.enemyState._defeated) return 'player';
    return null;
  }

  // ── Player Actions ────────────────────────────────────

  /**
   * Initiate a swap with animation.
   * The actual logical swap and match check happen after the animation completes.
   */
  tryPlayerSwap(col1, row1, col2, row2) {
    if (this.state !== BattleState.PLAYER_TURN) return false;
    if (!this.board.isAdjacent(col1, row1, col2, row2)) return false;
    if (!this.board.get(col1, row1) || !this.board.get(col2, row2)) return false;
    // Locked tiles (woven `lock`) can't be moved by either side. See decision #40.
    if (this.board.isColorLocked(this.board.get(col1, row1))
      || this.board.isColorLocked(this.board.get(col2, row2))) {
      this.log.add('Those tiles are locked and cannot be moved.');
      return false;
    }

    // Do pre-check: would this swap create a match?
    this.board.swap(col1, row1, col2, row2);
    const analysis = this.resolver.analyzeMatches(this.board, this.playerState);
    const valid = analysis !== null;
    this.board.swap(col1, row1, col2, row2); // revert

    // Start swap animation
    this.state = BattleState.SWAPPING;
    this.swapAnim = {
      from: { col: col1, row: row1 },
      to: { col: col2, row: row2 },
      progress: 0,
      duration: this._swapDuration(),
      valid,
    };

    if (!valid) {
      this.log.add('No match. Swap cancelled.');
    }
    return true;
  }

  tryPlayerSkill(skill) {
    if (this.state !== BattleState.PLAYER_TURN || !skill) return false;
    if (this._isSilenced(this.playerState)) {
      this.log.add(`${this.playerState.name} is Silenced and cannot cast skills.`);
      return false;
    }
    if (!this._affordable(this.playerState, skill)) {
      this.log.add(`Not enough mana for ${skill.name}.`);
      return false;
    }

    // Skills that require board targeting enter TARGETING state first
    if (skill.targeting === 'board_tile') {
      this.state = BattleState.TARGETING;
      this._targetingSkill = { ...skill };
      // Seed a default target (board center) so the area preview is visible and
      // Confirm works immediately; the player taps/drags to reposition.
      this._setDefaultTarget();
      this.log.add(`Select a board tile for ${skill.name}...`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }

    // Instant-effect skills: spend cost, play sound once, then resolve all effects
    this._spendCost(this.playerState, skill);
    this._setSkillSound(skill);
    this.log.add(`${this.playerState.name} uses ${skill.name}.`);

    let enteredCascade = false;
    for (const effect of (skill.effects || [])) {
      if (this._resolveEffect(effect, skill, 'player')) {
        enteredCascade = true;
      }
    }

    // If any effect entered a cascade (e.g. CREATE_TILES), let it resolve
    if (enteredCascade) return true;

    // Check for game over before proceeding to next turn
    if (this._checkGameOver()) return true;

    // Deathbringer: skill damage may have queued skull destructions.
    if (this._pendingSkullDestroy > 0 && this._maybeStartPendingSkullDestroy()) return true;

    // If an EXTRA_TURN effect was resolved (or the egg phase forced a retained
    // turn), stay on the same side.
    if (this._extraTurnEarned) {
      this._extraTurnEarned = false;
      this.pendingExtraTurn = true;
      if (!this._eggForcedExtraTurn) this.log.add('--- Extra Turn (Player) ---');
      this._eggForcedExtraTurn = false;
      if (this.onStateChange) this.onStateChange();
      return true;
    }

    this._endTurn('player');
    return true;
  }

  /**
   * Enter targeting mode for board-targeted skills.
   * Called when player clicks a skill with targeting: 'board_tile'.
   * @param {object} skill
   */
  enterTargeting(skill) {
    this.state = BattleState.TARGETING;
    this._targetingSkill = { ...skill };
    this._setDefaultTarget();
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Seed the targeting preview at the board center so the area overlay is
   * visible immediately and Confirm works without first positioning. The
   * player taps/drags a tile (setTargetHover) to reposition before confirming.
   */
  _setDefaultTarget() {
    const col = Math.floor((this.board ? this.board.cols : 8) / 2);
    const row = Math.floor((this.board ? this.board.rows : 8) / 2);
    this._targetHoverCell = { col, row };
    this._targetingOverlayCells = this._computeTargetingArea(col, row);
  }

  /** The current targeting preview cell, or null. */
  getTargetHoverCell() {
    return this._targetHoverCell || null;
  }

  /**
   * Confirm the targeted skill at the current preview cell (the Confirm button
   * / Enter). No-op unless targeting with a preview set.
   * @returns {boolean} true if the cast was resolved
   */
  confirmTarget() {
    if (this.state !== BattleState.TARGETING || !this._targetHoverCell) return false;
    return this.tryTargetTile(this._targetHoverCell.col, this._targetHoverCell.row);
  }

  /**
   * Update the hovered cell during TARGETING state.
   * Called each frame from main.js mousemove handler.
   * @param {number|null} col
   * @param {number|null} row
   */
  setTargetHover(col, row) {
    if (this.state !== BattleState.TARGETING) return;
    this._targetHoverCell = col != null && row != null ? { col, row } : null;
    this._targetingOverlayCells = this._computeTargetingArea(col, row);
  }

  /**
   * Handle a board tile click during TARGETING state.
   * @param {number} col
   * @param {number} row
   * @returns {boolean} true if targeting was resolved
   */
  tryTargetTile(col, row) {
    if (this.state !== BattleState.TARGETING || !this._targetingSkill) return false;

    const skill = this._targetingSkill;

    // Spend the cost
    this._spendCost(this.playerState, skill);
    this._setSkillSound(skill);
    this.log.add(`${this.playerState.name} uses ${skill.name}.`);

    // Compute affected tiles
    const area = this._computeTargetingArea(col, row);

    // Clear targeting state
    this._targetingSkill = null;
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];

    // Dispatch each effect by type. Targeting-aware effects (destroy / convert)
    // get the area; everything else routes through the standard _resolveEffect.
    // Track whether any effect entered RESOLVING — if so, the cascade machine
    // ends the turn; otherwise we end it inline here, mirroring tryPlayerSkill.
    let enteredCascade = false;
    for (const effect of (skill.effects || [])) {
      switch (effect.effectType) {
        case SKILL_EFFECT_TYPES.DESTROY_TILES:
        case SKILL_EFFECT_TYPES.DESTROY_TILES_ROW:
        case SKILL_EFFECT_TYPES.DESTROY_TILES_COLUMN:
          this._executeDestroyTiles(area, col, row, skill.name);
          enteredCascade = true;
          break;
        case SKILL_EFFECT_TYPES.CONVERT_TILE:
          if (this._executeConvertTile(area, effect, skill.name)) {
            enteredCascade = true;
          }
          break;
        case SKILL_EFFECT_TYPES.LOCK_COLOR:
          // Targeted lock: lock the CLICKED tile's color (and every tile of it).
          this._executeLockColor(col, row, effect, skill.name);
          break;
        default:
          if (this._resolveEffect(effect, skill, 'player')) {
            enteredCascade = true;
          }
          break;
      }
    }

    if (enteredCascade) return true;
    if (this._checkGameOver()) return true;
    // Deathbringer: skill damage may have queued skull destructions.
    if (this._pendingSkullDestroy > 0 && this._maybeStartPendingSkullDestroy()) return true;
    if (this._extraTurnEarned) {
      this._extraTurnEarned = false;
      this.pendingExtraTurn = true;
      // CRITICAL: return to PLAYER_TURN. We entered via TARGETING; a targeted
      // skill that grants an extra turn WITHOUT a cascade (e.g. lock + extra_turn)
      // would otherwise leave the state stuck in TARGETING (the "kept targeting"
      // bug). Cascade-entering targeted skills route through _finishResolving
      // which sets PLAYER_TURN, so they were unaffected.
      this.state = BattleState.PLAYER_TURN;
      this.activeSide = 'player';
      if (!this._eggForcedExtraTurn) this.log.add('--- Extra Turn (Player) ---');
      this._eggForcedExtraTurn = false;
      if (this.onStateChange) this.onStateChange();
      // The extra turn may begin with no possible move (e.g. board now heavily
      // locked) — auto-pass if truly stuck.
      this._maybeAutoPassPlayer();
      return true;
    }
    this._endTurn('player');
    return true;
  }

  /**
   * Cancel board targeting and return to PLAYER_TURN.
   * No skill resolve sound is played — the skill was not executed.
   */
  cancelTargeting() {
    if (this.state !== BattleState.TARGETING) return false;
    this._targetingSkill = null;
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];
    this.state = BattleState.PLAYER_TURN;
    this.log.add('Targeting cancelled.');
    if (this.onStateChange) this.onStateChange();
    return true;
  }

  /**
   * Compute the affected area for a board-targeted skill.
   * Radius 1 = 3x3 area centered on (col, row), clamped to board bounds.
   * @param {number|null} col center column
   * @param {number|null} row center row
   * @returns {Array<{col:number, row:number}>}
   */
  _computeTargetingArea(col, row) {
    if (col == null || row == null) return [];
    const skill = this._targetingSkill;
    if (!skill || !skill.area) return [];

    // Line-based targeting (DESTROY_TILES_ROW / _COLUMN): area is a number
    // (1, 3, 5, ...) = how many rows/columns are affected, centered on the
    // hovered cell. Column variant is discriminated by the effect type.
    if (typeof skill.area === 'number') {
      const isColumn = (skill.effects || []).some(
        (e) => e.effectType === SKILL_EFFECT_TYPES.DESTROY_TILES_COLUMN,
      );
      return isColumn
        ? this._computeColumnArea(col, row, skill.area)
        : this._computeRowArea(col, row, skill.area);
    }

    // Radius-based targeting (DESTROY_TILES): area.radius defines a square
    const radius = skill.area.radius || 0;
    const cells = [];
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && c < this.board.cols && r >= 0 && r < this.board.rows) {
          // Only include cells that have a tile
          if (this.board.get(c, r)) {
            cells.push({ col: c, row: r });
          }
        }
      }
    }
    return cells;
  }

  /**
   * Compute the affected tiles for a row-based destruction skill.
   * areaCount rows are affected, centered on centerRow, spanning all columns.
   * @param {number} centerCol - center column (for hover position context, unused for row area)
   * @param {number} centerRow - center row
   * @param {number} areaCount - number of rows to affect (1, 3, 5, ...)
   * @returns {Array<{col:number, row:number}>}
   */
  _computeRowArea(centerCol, centerRow, areaCount) {
    const halfSpan = Math.floor(areaCount / 2);
    const cells = [];
    for (let r = centerRow - halfSpan; r <= centerRow + halfSpan; r++) {
      if (r < 0 || r >= this.board.rows) continue;
      for (let c = 0; c < this.board.cols; c++) {
        if (this.board.get(c, r)) {
          cells.push({ col: c, row: r });
        }
      }
    }
    return cells;
  }

  /**
   * Column mirror of _computeRowArea: areaCount full columns centered on
   * centerCol, spanning all rows.
   * @param {number} centerCol - center column
   * @param {number} centerRow - center row (hover context, unused for column area)
   * @param {number} areaCount - number of columns to affect (1, 3, 5, ...)
   * @returns {Array<{col:number, row:number}>}
   */
  _computeColumnArea(centerCol, centerRow, areaCount) {
    const halfSpan = Math.floor(areaCount / 2);
    const cells = [];
    for (let c = centerCol - halfSpan; c <= centerCol + halfSpan; c++) {
      if (c < 0 || c >= this.board.cols) continue;
      for (let r = 0; r < this.board.rows; r++) {
        if (this.board.get(c, r)) {
          cells.push({ col: c, row: r });
        }
      }
    }
    return cells;
  }

  /**
   * Execute a DESTROY_TILES effect on the given positions.
   * Awards tile rewards (mana/skull damage), removes tiles, then enters
   * the standard board collapse → refill → cascade resolution flow.
   * @param {Array<{col:number, row:number}>} positions
   * @param {number} centerCol - center of explosion (for log message)
   * @param {number} centerRow - center of explosion (for log message)
   */
  _executeDestroyTiles(positions, centerCol, centerRow, skillName = 'Skill') {
    const activeState = this._activeState();
    const targetState = this._opponentState();

    // 1. Compute tile rewards using shared path
    const rewards = this.resolver.resolveDestroyedTileRewards(this.board, positions, activeState);

    // 2. Award mana from colored gems (suppressed entirely while Enfeebled —
    //    tiles are still destroyed and skull damage still dealt below).
    if (this._canGainMana(this.activeSide)) {
      for (const [color, count] of Object.entries(rewards.mana)) {
        if (count > 0) {
          activeState.mana[color] = (activeState.mana[color] || 0) + count;
          this.log.add(`${activeState.name} gains ${count} ${color} mana from destroyed gems.`);
          this._dispatchManaGain(this.activeSide, color, count);
        }
      }
    } else {
      this.log.add(`${activeState.name} is Enfeebled and gains no mana.`);
    }

    // 3. Deal skull damage (isSkull → Barrier can block this instance)
    if (rewards.skullDamage > 0) {
      const r = this._applyDamage(targetState, rewards.skullDamage, { isSkull: true });
      this.log.add(`Destroyed skulls deal ${r.actualDamage} damage to ${targetState.name}.`);
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      this._markDirectDamage(this.activeSide, r.actualDamage);
      this._dispatchDamageEvent(
        this.activeSide,
        this.activeSide === 'player' ? 'enemy' : 'player',
        r,
        { isSkull: true }
      );
      // Check for immediate game over — don't enter cascade if target died
      if (this._checkGameOver()) return;
    }

    // 4. Capture tile types BEFORE removal for particle burst effects
    this._destroyedTilesThisStep = [];
    for (const pos of positions) {
      const typeId = this.board.get(pos.col, pos.row);
      if (typeId) {
        this._destroyedTilesThisStep.push({ col: pos.col, row: pos.row, typeId });
      }
    }

    // 5. Remove tiles from board
    const removedCount = this.board.removeTiles(positions);
    this.log.add(`${removedCount} tiles destroyed by ${skillName}!`);

    // 6. Enter RESOLVING directly at REMOVE phase (skip SHOW_MATCH — no match to highlight)
    // Preserve any skill-granted extra turn before resetting cascade state,
    // so that e.g. a DESTROY_TILES+EXTRA_TURN multi-effect skill works correctly.
    const skillExtraTurn = this._extraTurnEarned;
    this.state = BattleState.RESOLVING;
    this.activeSide = 'player';
    this._allSteps = [];
    this._extraTurnEarned = skillExtraTurn;
    this.pendingExtraTurn = false;
    this._matchTextTriggers = [];
    this._previousEmptyCells = null;
    this._swapTriggerPos = null;

    // Create a synthetic analysis entry for _allSteps tracking
    this._analysis = null;
    this._allSteps.push({
      matches: [],
      positions: [...positions],
      mana: rewards.mana,
      skullDamage: rewards.skullDamage,
      extraTurnTrigger: false,
      tilesDestroyed: removedCount,
    });

    // Show empty cells as the REMOVE phase visual
    this.highlightCells = [];
    this.emptyCells = [...positions];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.REMOVE;
    this._phaseTimer = 0;
  }

  /**
   * Execute a CONVERT_TILE effect on the given targeted positions.
   * Converts each board cell to the configured tile type, captures the
   * positions for the conversion shimmer effect, and enters RESOLVING if
   * the conversion produced any matches.
   *
   * Does NOT award mana or deal damage on its own — when the converted
   * tiles match, the normal cascade flow handles rewards.
   *
   * @param {Array<{col:number,row:number}>} positions targeted cells
   * @param {object} effect - { convertTile: { type } }
   * @param {string} skillName - for log messages
   * @returns {boolean} true if a cascade was entered
   */
  _executeConvertTile(positions, effect, skillName) {
    const cfg = effect && effect.convertTile;
    if (!cfg || !cfg.type) {
      console.warn('[CONVERT_TILE] Missing convertTile.type on effect:', effect);
      return false;
    }
    const targetType = cfg.type;
    if (!TILE_TYPES[targetType.toUpperCase()]) {
      console.warn(`[CONVERT_TILE] Unknown tile type: "${targetType}". Skipping.`);
      return false;
    }
    if (!positions || positions.length === 0) {
      this.log.add(`${skillName}: no tile selected.`);
      return false;
    }

    const convertedCount = this.board.convertTilesToType(positions, targetType);
    if (convertedCount === 0) {
      this.log.add(`${skillName}: nothing to convert.`);
      return false;
    }
    this.log.add(`${skillName} converts ${convertedCount} tile(s) to ${targetType}.`);

    // Capture for visual feedback (shimmer / particle burst handled by
    // BattleScene's _spawnTileConvertParticles, same as CREATE_TILES).
    this._convertedTilePositions = positions.map(p => ({
      col: p.col, row: p.row, typeId: targetType,
    }));

    // If the conversion created matches, run the standard cascade.
    const analysis = this.resolver.analyzeMatches(this.board, this.playerState);
    if (analysis) {
      this._swapTriggerPos = null;
      this._beginResolving('player', analysis);
      return true;
    }
    return false;
  }

  /**
   * Execute a CREATE_TILES effect: convert random non-target tiles into
   * the requested type. Does NOT award mana or deal damage.
   * After conversion, checks for matches and enters RESOLVING if any found.
   * @param {object} effect - effect definition with createTiles: { amount, type }
   * @param {string} side - 'player' or 'enemy'
   * @param {string} skillName - skill name for log messages
   */
  _executeCreateTiles(effect, side, skillName) {
    const createTiles = effect.createTiles;
    if (!createTiles || typeof createTiles.amount !== 'number' || !createTiles.type) {
      console.warn('[CREATE_TILES] Missing or invalid createTiles config on effect:', effect);
      return;
    }

    const targetType = createTiles.type;
    const amount = createTiles.amount;

    // Validate the target type exists
    if (!TILE_TYPES[targetType.toUpperCase()]) {
      console.warn(`[CREATE_TILES] Unknown target tile type: "${targetType}". Skipping.`);
      return;
    }

    // 1. Find tiles NOT already of the target type
    const candidates = this.board.getTilesNotOfType(targetType);

    if (candidates.length === 0) {
      this.log.add(`No tiles to convert for ${skillName} — board is all ${targetType}.`);
      return;
    }

    // 2. Randomly select up to `amount`
    const selected = BoardModel.pickRandomTiles(candidates, amount);

    // 3. Convert the selected tiles
    const convertedCount = this.board.convertTilesToType(selected, targetType);
    this.log.add(`${skillName} converts ${convertedCount} tiles to ${targetType}.`);

    // 4. Capture converted positions for visual feedback (BEFORE _beginResolving clears highlightCells)
    this._convertedTilePositions = [];
    for (const pos of selected.slice(0, convertedCount)) {
      this._convertedTilePositions.push({ col: pos.col, row: pos.row, typeId: targetType });
    }

    // 5. Check if conversion created any matches
    const activeState = side === 'player' ? this.playerState : this.enemyState;
    const analysis = this.resolver.analyzeMatches(this.board, activeState);
    if (analysis) {
      // Save swap trigger pos for cascade effects; null since no swap occurred
      this._swapTriggerPos = null;
      this._beginResolving(side, analysis);
    }
  }

  /**
   * Execute a CONVERT_TILES_BY_TYPE effect: convert EVERY tile of one type
   * (`convertByType.from`) into another type (`convertByType.to`) across the
   * whole board. Does NOT award mana or deal damage directly. After conversion,
   * checks for matches and enters RESOLVING if any are found (so converting to
   * skulls can immediately cascade and deal skull damage).
   * @param {object} effect - effect with convertByType: { from, to }
   * @param {string} side - 'player' or 'enemy'
   * @param {string} skillName - skill name for log messages
   */
  _executeConvertTilesByType(effect, side, skillName) {
    const cfg = effect.convertByType;
    if (!cfg || !cfg.from || !cfg.to) {
      console.warn('[CONVERT_TILES_BY_TYPE] Missing convertByType.from/to on effect:', effect);
      return;
    }
    const fromType = cfg.from;
    const toType = cfg.to;
    if (!TILE_TYPES[String(fromType).toUpperCase()] || !TILE_TYPES[String(toType).toUpperCase()]) {
      console.warn(`[CONVERT_TILES_BY_TYPE] Unknown tile type from="${fromType}" to="${toType}". Skipping.`);
      return;
    }

    const positions = this.board.getTilesOfType(fromType);
    if (positions.length === 0) {
      this.log.add(`${skillName}: no ${fromType} tiles to convert.`);
      return;
    }

    const convertedCount = this.board.convertTilesToType(positions, toType);
    this.log.add(`${skillName} converts ${convertedCount} ${fromType} tile(s) to ${toType}.`);

    // Capture converted positions for visual feedback (BEFORE _beginResolving
    // clears highlightCells), same as CREATE_TILES / CONVERT_TILE.
    this._convertedTilePositions = positions.slice(0, convertedCount).map(p => ({
      col: p.col, row: p.row, typeId: toType,
    }));

    // If the conversion created matches, run the standard cascade.
    const activeState = side === 'player' ? this.playerState : this.enemyState;
    const analysis = this.resolver.analyzeMatches(this.board, activeState);
    if (analysis) {
      this._swapTriggerPos = null;
      this._beginResolving(side, analysis);
    }
  }

  // ── Resolution ────────────────────────────────────────

  _beginResolving(side, firstAnalysis) {
    this.state = BattleState.RESOLVING;
    this.activeSide = side;
    this._allSteps = [];
    this._extraTurnEarned = false;
    this.pendingExtraTurn = false;
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._matchTextTriggers = [];
    this._previousEmptyCells = null;

    if (firstAnalysis) {
      // Log initial match
      this.log.add('Match found!');
      this._enterShowMatch(firstAnalysis);
    } else {
      // Try to find first match
      this._finishStep();
    }
  }

  _enterShowMatch(analysis) {
    this._analysis = analysis;
    this._allSteps.push(analysis);

    // Apply the active side's static match bonuses (Group B mana relics,
    // Funerary Bell) BEFORE dispatching passive triggers so the granted
    // rewards in _doRemove include them and downstream additions (e.g.
    // radius destruction) aren't double-counted.
    this._applyMatchBonuses(analysis, this._activeState());

    // Compute the "cause" position FIRST (before dispatching passive
    // triggers) so passive effects (e.g. radius destruction relics) can
    // use it as their focal point via the onMatch4Plus payload.
    //
    // For the initial swap step: _swapTriggerPos was computed by
    // _computeSwapCausePos which finds which swapped tile landed in the
    // 4+ group (handles both click-order scenarios correctly).
    // For cascade steps: find which match position overlaps with the
    // previously-empty cells (the tile that fell into place).
    // A turn-start cascade (Chokeweed Sap) is part of turn setup, not the
    // side's action — it must not grant or animate an extra turn even if the
    // conversion lines up a 4+ match. Suppress the extra-turn flag/visual when
    // resuming the turn after this resolution.
    let causePos = null;
    if (analysis.extraTurnTrigger && !this._resumeTurnAfterResolve
        && this._canGainExtraTurn(this.activeSide)) {
      this._extraTurnEarned = true;
      if (this._previousEmptyCells && this._previousEmptyCells.length > 0) {
        causePos = this._findCascadeCausePos(analysis, this._previousEmptyCells);
      }
      if (!causePos && this._swapTriggerPos) {
        causePos = { col: this._swapTriggerPos.col, row: this._swapTriggerPos.row };
      }
      // Fallback: use first match position
      if (!causePos && analysis.positions.length > 0) {
        causePos = { col: analysis.positions[0].col, row: analysis.positions[0].row };
      }
      this.extraTurnTriggerPos = causePos;
    }

    // Dispatch match-related passive triggers AFTER causePos is known
    // (so onMatch4Plus payload can carry it) but BEFORE the visual phase
    // so any analysis mutations (extra cells from radius destruction,
    // mana grants, etc.) feed into the same SHOW_MATCH/REMOVE cycle.
    this._dispatchMatchEvents(this.activeSide, analysis, causePos);

    // Generate floating text triggers for every match (3+ tiles).
    // Each match gets a "+N" text effect at its first position.
    for (const match of analysis.matches) {
      if (match.positions.length > 0) {
        this._matchTextTriggers.push({
          typeId: match.typeId,
          count: match.count,
          position: { col: match.positions[0].col, row: match.positions[0].row },
          // All matched cells — source points for the mana-stream flourish
          // (BattleScene flies wisps from these to the matching mana orb).
          positions: match.positions.map((p) => ({ col: p.col, row: p.row })),
        });
      }
    }

    const activeName = this._activeState().name;
    for (const m of analysis.matches) {
      const tn = m.typeId.charAt(0).toUpperCase() + m.typeId.slice(1);
      const sh = m.isShape ? ' (L/T shape)' : '';
      if (m.typeId === 'skull') {
        this.log.add(`Skull match: ${m.count} tiles${sh} — damage incoming!`);
      } else {
        this.log.add(`${tn} match: ${m.count} tiles${sh} — +${m.count} mana.`);
      }
    }

    this.highlightCells = [...analysis.positions];
    this.emptyCells = [];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.SHOW_MATCH;
    this._phaseTimer = 0;
  }

  /**
   * After a swap, determine which of the two swapped positions is part of
   * a 4+ match (the tile that "caused" the extra turn). Falls back to 'to'
   * for non-extra-turn swaps, or the first match position.
   * @param {{col:number, row:number}} from - swap source
   * @param {{col:number, row:number}} to - swap destination
   * @param {import('./MatchResolver.js').MatchAnalysis|null} analysis
   * @returns {{col:number, row:number}|null}
   */
  _computeSwapCausePos(from, to, analysis) {
    if (!analysis) return null;

    // If this step triggers an extra turn (4+ match), find which of the
    // two swapped tiles landed in a 4+ connected group.
    if (analysis.extraTurnTrigger) {
      for (const match of analysis.matches) {
        if (match.count >= 4 || (match.isShape && match.count >= 4)) {
          const matchSet = new Set(match.positions.map(p => `${p.col},${p.row}`));
          // Check 'from' first — the tile originally at 'to' lands here
          if (matchSet.has(`${from.col},${from.row}`)) {
            return { col: from.col, row: from.row };
          }
          // Check 'to' — the tile originally at 'from' lands here
          if (matchSet.has(`${to.col},${to.row}`)) {
            return { col: to.col, row: to.row };
          }
        }
      }
    }

    // Fallback for non-extra-turn matches: use the first position in the
    // analysis that overlaps with either swapped cell.
    const analysisSet = new Set(analysis.positions.map(p => `${p.col},${p.row}`));
    if (analysisSet.has(`${from.col},${from.row}`)) {
      return { col: from.col, row: from.row };
    }
    if (analysisSet.has(`${to.col},${to.row}`)) {
      return { col: to.col, row: to.row };
    }

    // Absolute fallback: first match position
    if (analysis.positions.length > 0) {
      return { col: analysis.positions[0].col, row: analysis.positions[0].row };
    }
    return { col: to.col, row: to.row };
  }

  /**
   * Find a position in the new match that overlaps with the previously
   * empty (removed) cells — this is where a falling tile "caused" the
   * cascade match. Returns null if no overlap found.
   * @param {import('./MatchResolver.js').MatchAnalysis} analysis
   * @param {Array<{col:number, row:number}>} previousEmpty
   * @returns {{col:number, row:number}|null}
   */
  _findCascadeCausePos(analysis, previousEmpty) {
    const prevSet = new Set(previousEmpty.map(p => `${p.col},${p.row}`));
    for (const pos of analysis.positions) {
      if (prevSet.has(`${pos.col},${pos.row}`)) {
        return { col: pos.col, row: pos.row };
      }
    }
    return null;
  }

  _doRemove() {
    const a = this._analysis;
    const activeState = this._activeState();
    const targetState = this._opponentState();

    if (a.skullDamage > 0) {
      const r = this._applyDamage(targetState, a.skullDamage, { isSkull: true });
      this.log.add(`Skull damage: ${r.actualDamage} dealt.`);
      // Trigger screen shake scaled by damage % of target's max HP
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      this._markDirectDamage(this.activeSide, r.actualDamage);
      this._dispatchDamageEvent(
        this.activeSide,
        this.activeSide === 'player' ? 'enemy' : 'player',
        r,
        { isSkull: true }
      );
      // Check for immediate game over — stop cascade if target died
      if (this._checkGameOver()) return;
    }

    // Mana from matched gems — suppressed entirely while Enfeebled (the tiles
    // still clear and skull damage above is unaffected).
    if (this._canGainMana(this.activeSide)) {
      for (const [color, count] of Object.entries(a.mana)) {
        if (count > 0) {
          activeState.mana[color] = (activeState.mana[color] || 0) + count;
          this.log.add(`${activeState.name} gains ${count} ${color} mana.`);
          this._dispatchManaGain(this.activeSide, color, count);
        }
      }
    } else if (Object.values(a.mana).some(c => c > 0)) {
      this.log.add(`${activeState.name} is Enfeebled and gains no mana.`);
    }

    // Capture tile types BEFORE removal so the scene can spawn
    // matching-color particle bursts for every destroyed tile.
    this._destroyedTilesThisStep = [];
    for (const pos of a.positions) {
      const typeId = this.board.get(pos.col, pos.row);
      if (typeId) {
        this._destroyedTilesThisStep.push({ col: pos.col, row: pos.row, typeId });
      }
    }

    this.board.removeTiles(a.positions);
    this.highlightCells = [];
    this.emptyCells = [...a.positions];
    this.fallCells = [];
    this._cascadePhase = CascadePhase.REMOVE;
    this._phaseTimer = 0;
  }

  _doFall() {
    // Save the empty cells before clearing — needed by _enterShowMatch
    // to compute the "cause" position for cascade 4+ match effects.
    this._previousEmptyCells = [...this.emptyCells];

    const preGravityGrid = this.board.grid.map(col => [...col]);
    this.board.applyGravity();
    this.board.refill();
    const animations = this.board.generateFallAnimations(preGravityGrid);

    this.emptyCells = [];
    this.fallCells = animations;
    this._cascadePhase = CascadePhase.FALL;
    this._phaseTimer = 0;
  }

  _finishStep() {
    this.fallCells = [];
    this._cascadePhase = null;

    const next = this.resolver.analyzeMatches(this.board, this._activeState());
    if (next) {
      this._enterShowMatch(next);
    } else {
      this._finishResolving();
    }
  }

  _finishResolving() {
    // Deathbringer: if damage dealt during this resolution queued skull
    // destructions, run them as a follow-up resolution before ending the
    // turn (skip if the battle already ended).
    if (this.playerState.hp > 0 && this.enemyState.hp > 0 &&
        this._pendingSkullDestroy > 0 && this._maybeStartPendingSkullDestroy()) {
      return;
    }

    const totalDestroyed = this._allSteps.reduce((s, a) => s + a.tilesDestroyed, 0);
    if (this._allSteps.length > 0) {
      this.log.add(`${totalDestroyed} tiles destroyed across ${this._allSteps.length} cascade(s).`);
    }

    this._analysis = null;
    this._allSteps = [];
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._previousEmptyCells = null;

    // Check game over BEFORE converting the extra-turn flag below. A damage
    // EFFECT resolved as part of this action (e.g. Fracture's direct damage
    // alongside its row destroy) can kill the enemy without the death being
    // noticed until now — and the death-transform (Sanguine Egg, decision #37)
    // fires INSIDE _checkGameOver and FORCES _extraTurnEarned so the player
    // retains the turn to slay the Egg. If this ran AFTER the extra-turn check,
    // that forced flag would be missed and the turn would end, instantly
    // reverting the Egg to a full-life Phoenix (the bug). For skull-match kills
    // the transform fires earlier (in _doRemove), so this is also a no-op
    // safety re-check for those paths.
    if (this._checkGameOver()) return;

    // A turn-start cascade (e.g. Chokeweed Sap) resolves as part of the turn
    // setup, NOT as the side's action — so it never grants an extra turn (that
    // would double the turn). Suppress the extra-turn grant when resuming.
    if (this._extraTurnEarned && !this._resumeTurnAfterResolve) {
      this.pendingExtraTurn = true;
      // extraTurnTriggerPos was already set in _enterShowMatch — the
      // scene is already animating the effect concurrently with cascades.
      // Suppress the announcement for the hidden egg-phase retained turn.
      if (!this._eggForcedExtraTurn) {
        this.log.add(`${this._activeState().name} gets an extra turn!`);
      }
    }
    this._extraTurnEarned = false;

    if (this._resumeTurnAfterResolve) {
      // The cascade came from a turn-start passive; the active side still
      // needs to take its normal action. Resume its turn (do NOT end it, do
      // NOT re-dispatch onTurnStart — that already fired before the cascade).
      this._resumeTurnAfterResolve = false;
      this.pendingExtraTurn = false;
      this._phaseTimer = 0;
      this._deathbringerFiredThisAction = false;
      if (this.activeSide === 'player') {
        this.state = BattleState.PLAYER_TURN;
      } else {
        this.state = BattleState.ENEMY_TURN;
        this._enemyTimer = 0;
        this._enemyFired = false;
      }
    } else if (this.pendingExtraTurn) {
      this._phaseTimer = 0;
      this._enemyFired = false;
      // Extra turn = new action: re-arm Deathbringer's once-per-action guard
      // (extra turns bypass _completeTurnIntro).
      this._deathbringerFiredThisAction = false;
      if (this.activeSide === 'player') {
        this.state = BattleState.PLAYER_TURN;
        // Hidden egg-phase retained turn: skip the announcement, then consume the flag.
        if (!this._eggForcedExtraTurn) this.log.add('--- Extra Turn (Player) ---');
        this._eggForcedExtraTurn = false;
      } else {
        this.state = BattleState.ENEMY_TURN;
        this._enemyTimer = 0;
        this.log.add('--- Extra Turn (Enemy) ---');
      }
    } else {
      this._endTurn(this.activeSide);
    }
    if (this.onStateChange) this.onStateChange();
  }

  _endTurn(side) {
    // Egg-phase DEADLINE: the player retained the turn after killing the Phoenix
    // (a hidden extra turn) to slay the Egg. If they're ending that turn with the
    // phase still live, the Egg survived — it reverts to a full-life Phoenix IN
    // PLACE (a slain Egg would already have ended the battle via _checkGameOver),
    // and this _endTurn then proceeds normally so the reborn Phoenix takes the
    // enemy turn.
    if (side === 'player' && this._eggPhaseActive) {
      this._resolveEggPhaseAtTurnEnd();
    }

    // Dispatch onTurnEnd BEFORE we mutate state for the next turn so
    // relic effects see the correct active-side context.
    this.passives.dispatch(TRIGGER_TYPES.ON_TURN_END, { side });

    // NOTE: status effects are ticked at the START of the affected side's turn
    // (_tickStatusesAtTurnStart in _completeTurnIntro), not here.

    // POISON ticks at the END of the APPLIER's turn: the side ending its turn
    // applied poison to its opponent, so deal the opponent's poison now (then
    // halve the stacks). Poison damage can be lethal — re-check game over and
    // stop before the turn transition if so. See decision #39.
    this._tickPoison(side === 'player' ? 'enemy' : 'player');
    if (this._checkGameOver()) {
      if (this.onStateChange) this.onStateChange();
      return;
    }

    this.pendingExtraTurn = false;
    this._swapTriggerPos = null;
    // Enter turn-intro animation before the actual turn begins.
    // The scene reads _turnAnnouncement to spawn the appropriate
    // floating image effect (Player Turn / Enemy Turn).
    const nextSide = side === 'player' ? 'enemy' : 'player';
    this.state = BattleState.TURN_INTRO;
    // Announcement is DEFERRED to phase B (after damage delivery) — see update().
    this._turnAnnouncement = null;
    this._nextTurnSide = nextSide;
    this._introAnnounced = false;
    this._turnIntroTimer = 0;
    this._turnGateHold = 0;
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Phase A → B of TURN_INTRO: damage delivery is done, so now raise the
   * "Player/Enemy Turn" announcement (the scene reads `_turnAnnouncement` to
   * spawn the popup + sound) and start the normal intro delay before the turn.
   */
  _beginTurnAnnouncement() {
    this._introAnnounced = true;
    this._turnAnnouncement = this._nextTurnSide;
    this._turnIntroTimer = 0;
    this._turnGateHold = 0;
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Called when the TURN_INTRO delay expires. Transitions to the
   * actual turn state (PLAYER_TURN or ENEMY_TURN).
   */
  _completeTurnIntro() {
    // Use _nextTurnSide which persists through getState() clearing
    const side = (this._nextTurnSide === 'player' || this._nextTurnSide === 'enemy')
      ? this._nextTurnSide : 'player';

    // New turn = new action: re-arm Deathbringer's once-per-action guard.
    this._deathbringerFiredThisAction = false;
    // A fresh (non-extra) turn must NEVER inherit a pending extra-turn grant.
    // Legitimate extra turns continue via _finishResolving / _beginEnemyExtraTurn,
    // which set PLAYER_TURN / ENEMY_TURN directly and BYPASS this intro — so any
    // _extraTurnEarned still set when a normal TURN_INTRO completes is STALE.
    // Clearing it here enforces the invariant and stops a leaked flag from
    // silently swallowing the next turn (the "I cast a spell and the turn just
    // doesn't pass, with no extra-turn indication" bug — a pure instant skill
    // has no way to set this mid-turn, so a stuck flag can only be stale).
    this._extraTurnEarned = false;
    this.pendingExtraTurn = false;
    // Reset before dispatching onTurnStart so a turn-start passive (Usurper's
    // Heart harvest) can extend the enemy's pre-action wait for this turn.
    this._extraEnemyTurnDelay = 0;

    this.log.nextTurn();
    if (side === 'enemy') {
      this.state = BattleState.ENEMY_TURN;
      this.activeSide = 'enemy';
      this._enemyTimer = 0;
      this._enemyFired = false;
      this.log.add(`--- ${this.enemyState.name}'s Turn ---`);
    } else {
      this.enemyState.block = 0;
      this.playerState.block = 0;
      this.state = BattleState.PLAYER_TURN;
      this.activeSide = 'player';
      this.log.add('--- Your Turn ---');
    }

    // Tick status effects at the START of this side's turn (arm/decrement,
    // expire, and apply per-turn effects like Bleed). Bleed can be lethal, so
    // re-check game over before the side acts / passives fire.
    this._tickStatusesAtTurnStart(side);
    if (this._checkGameOver()) {
      if (this.onStateChange) this.onStateChange();
      return;
    }

    // Barrier (one-round magic shield) expires here at the START of the owner's
    // turn. It's granted mid-turn (after this intro), so it survives the owner's
    // turn + the opponent's turn and is cleared one full round later. Placed
    // BEFORE the onTurnStart dispatch so a future turn-start grant survives. Extra
    // turns bypass _completeTurnIntro, so barrier doesn't expire mid-chain. See
    // decision #38.
    const turnState = this._getStateBySide(side);
    if (turnState && turnState.barrier > 0) {
      this.log.add(`${turnState.name}'s Barrier fades.`);
      turnState.barrier = 0;
    }

    // Tick down any locked colors (woven `lock`) once per turn start, so a lock
    // cast on one turn covers the opponent's next turn then expires. See decision #40.
    this.board.tickLocks();

    // Dispatch onTurnStart AFTER state is set so relic effects can
    // observe the active side correctly.
    this.passives.dispatch(TRIGGER_TYPES.ON_TURN_START, { side });

    // If the player's turn begins with no possible move and no castable skill
    // (e.g. the board is fully locked), auto-pass so the turn cycles and locks
    // tick down rather than soft-locking. See decision #40.
    if (side === 'player' && this._maybeAutoPassPlayer()) return;

    if (this.onStateChange) this.onStateChange();
  }

  _activeState() {
    return this.activeSide === 'player' ? this.playerState : this.enemyState;
  }
  _opponentState() {
    return this.activeSide === 'player' ? this.enemyState : this.playerState;
  }

  // ── Status effects (buffs / debuffs) ─────────────────
  //
  // A status lasts N turn CYCLES of the AFFECTED combatant; a cycle = that
  // combatant holding control once. Statuses live on `state.statuses` (an array
  // of { id, kind, turns, _armed, sourceSide, attackValue?, savedAttack?,
  // tickDamage? }) and are ticked at the START of the affected side's turn
  // (_tickStatusesAtTurnStart, called from _completeTurnIntro).
  //
  // Each carries an `_armed` flag set at application time:
  //   - SELF-applied (affected side IS the active side): _armed = true — the
  //     current turn is already cycle 1, underway. The next own-turn-start
  //     decrements it.
  //   - OPPONENT-applied (affected side is NOT active): _armed = false — cycle 1
  //     begins at their next turn start (which arms it without decrementing).
  // Tick per status: if armed → turns--, else arm it; remove when turns<=0
  // (before any per-turn effect), otherwise apply per-turn effects (Bleed).
  // "Active" for every game-logic check = the status is PRESENT in the list.
  //
  // Silence (Soul Burn) and Cripple (Exsanguinate's attack-pin) are migrated
  // onto this system — there is no separate turn-scoped-debuff path anymore.

  /** The status entry for `id` on `state`, or null. */
  _getStatus(state, id) {
    if (!state || !state.statuses) return null;
    return state.statuses.find(s => s.id === id) || null;
  }

  /** Whether `state` currently has status `id` active. */
  _hasStatus(state, id) {
    return !!this._getStatus(state, id);
  }

  /** Whether `state` currently cannot cast skills (Silence). */
  _isSilenced(state) {
    return this._hasStatus(state, 'silenced');
  }

  /** Whether the side may gain mana this turn (false while Enfeebled). */
  _canGainMana(side) {
    return !this._hasStatus(this._getStateBySide(side), 'enfeebled');
  }

  /** Whether the side may gain an extra turn (false while Frozen). */
  _canGainExtraTurn(side) {
    return !this._hasStatus(this._getStateBySide(side), 'frozen');
  }

  /**
   * Apply status `id` to `targetState` for `turns` cycles. Determines _armed
   * from whether the target is currently the active side (see section header).
   * Refreshing an existing status keeps the longer remaining duration and the
   * original saved data (e.g. Cripple's savedAttack), so stacking casts don't
   * bake a forced value in.
   * @param {object} targetState — the combatant receiving the status
   * @param {string} id          — status id (data/statusEffects.js)
   * @param {object} params      — { turns?, attackValue? }
   * @param {'player'|'enemy'} applierSide — who applied it (for Bleed source)
   */
  _applyStatus(targetState, id, params = {}, applierSide = null) {
    const def = getStatusDef(id);
    if (!targetState || !def) return;
    if (!targetState.statuses) targetState.statuses = [];

    const turns = Math.max(1, (typeof params.turns === 'number' ? params.turns : 1));
    const selfApplied = targetState === this._activeState();

    let st = this._getStatus(targetState, id);
    if (st) {
      // Refresh — extend to the longer duration; keep existing arming/saved data.
      st.turns = Math.max(st.turns, turns);
    } else {
      st = {
        id,
        kind: def.kind,
        turns,
        _armed: selfApplied,
        sourceSide: applierSide,
      };
      targetState.statuses.push(st);

      // Per-status application side effects:
      if (id === 'crippled') {
        // Pin attack to attackValue (default 1). Snapshot the pre-cripple attack
        // so it can be restored on expiry; freeze dynamic-attack recompute while
        // active (see _recomputeDynamicAttack / _enforceStatusAttack).
        st.attackValue = (typeof params.attackValue === 'number') ? params.attackValue : 1;
        st.savedAttack = targetState.attack;
        targetState.attack = st.attackValue;
      } else if (id === 'bleeding') {
        // Snapshot the applier's attack at apply time → half (rounded up) per tick.
        const applier = this._getStateBySide(applierSide);
        const atk = (applier && applier.attack) || 1;
        st.tickDamage = Math.max(1, Math.ceil(atk / 2));
      }
      // `reflecting` needs no per-instance data — it reflects whatever damage is
      // taken (see _applyDamage). Its only parameter is duration (turns).
    }
    if (def.kind === 'buff') this.log.add(`${targetState.name} gains ${def.name}.`);
    else this.log.add(`${targetState.name} is afflicted with ${def.name}.`);
  }

  /** Remove status `id` from `state`, running any cleanup (Cripple restore). */
  _removeStatus(state, id) {
    if (!state || !state.statuses) return;
    const idx = state.statuses.findIndex(s => s.id === id);
    if (idx < 0) return;
    const st = state.statuses[idx];
    state.statuses.splice(idx, 1);
    if (id === 'crippled') {
      // Hand attack back to the dynamic-attack recompute, which reconciles
      // against the side's current mana on the next frame.
      if (typeof st.savedAttack === 'number') state.attack = st.savedAttack;
      this.log.add(`${state.name}'s attack returns to normal.`);
    } else {
      const def = getStatusDef(id);
      this.log.add(`${state.name}'s ${def ? def.name : id} wears off.`);
    }
  }

  /** Re-pin a side's attack to its Cripple value (called each frame). */
  _enforceStatusAttack(state) {
    const st = this._getStatus(state, 'crippled');
    if (st && typeof st.attackValue === 'number') state.attack = st.attackValue;
  }

  /**
   * Tick the statuses on `side` at the START of its turn (see section header).
   * Arms or decrements each, removes expired ones, and applies per-turn effects
   * (Bleed) for still-active statuses. Bleed may be lethal — the caller
   * (_completeTurnIntro) re-checks game over afterward.
   * @param {'player'|'enemy'} side
   */
  _tickStatusesAtTurnStart(side) {
    const state = this._getStateBySide(side);
    if (!state || !state.statuses || state.statuses.length === 0) return;

    // Snapshot the list — _removeStatus mutates it and per-turn effects must
    // see the pre-tick membership.
    const current = [...state.statuses];
    const expired = [];
    for (const st of current) {
      if (st._armed) st.turns -= 1;
      else st._armed = true;
      if (st.turns <= 0) { expired.push(st.id); continue; }
      this._applyStatusTurnStartEffect(st, side, state);
    }
    for (const id of expired) this._removeStatus(state, id);
  }

  /** Per-turn-start effect for a still-active status (today: Bleed damage). */
  _applyStatusTurnStartEffect(st, side, state) {
    if (st.id !== 'bleeding') return;
    const dmg = Math.max(1, st.tickDamage || 1);
    const attackerSide = st.sourceSide || (side === 'player' ? 'enemy' : 'player');
    const r = this._applyDamage(state, dmg, { attackerSide });
    if (r.actualDamage > 0) {
      this.log.add(`${state.name} takes ${r.actualDamage} bleed damage.`);
      this._setShakeFromDamage(r.actualDamage, state.maxHp);
      this._dispatchDamageEvent(attackerSide, side, r);
    }
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    // Keep dynamic attack (Group A: +attack per unspent mana) in sync with
    // the current mana pools each frame. Idempotent (delta-based).
    this._recomputeDynamicAttack(this.playerState);
    this._recomputeDynamicAttack(this.enemyState);

    // Keep an active Cripple attack-pin enforced — catches stray mutations
    // (e.g. a relic's gain_attack firing during the crippled turn) so the
    // "attack = N this turn" guarantee holds.
    this._enforceStatusAttack(this.playerState);
    this._enforceStatusAttack(this.enemyState);

    // ── Swap animation ──
    if (this.state === BattleState.SWAPPING && this.swapAnim) {
      this.swapAnim.progress += dt / this.swapAnim.duration;
      if (this.swapAnim.progress >= 1) {
        this.swapAnim.progress = 1;
        // Perform the logical swap
        const { from, to, valid } = this.swapAnim;
        this.board.swap(from.col, from.row, to.col, to.row);
        this.swapAnim = null;

        if (valid) {
          const analysis = this.resolver.analyzeMatches(this.board, this.playerState);
          // Determine which swapped position caused the 4+ match
          this._swapTriggerPos = this._computeSwapCausePos(from, to, analysis);
          this._beginResolving('player', analysis);
        } else {
          // Revert after animation
          this.board.swap(from.col, from.row, to.col, to.row);
          this._swapTriggerPos = null;
          this.state = BattleState.PLAYER_TURN;
        }
      }
      return; // Don't process other states during swap animation
    }

    // ── Cascade sub-phases ──
    if (this.state === BattleState.RESOLVING && this._cascadePhase) {
      this._phaseTimer += dt;
      const phaseMs = this._phaseMs(this._cascadePhase);

      if (this._cascadePhase === CascadePhase.SHOW_MATCH && this._phaseTimer >= phaseMs) {
        this._doRemove();
      } else if (this._cascadePhase === CascadePhase.REMOVE && this._phaseTimer >= phaseMs) {
        this._doFall();
      } else if (this._cascadePhase === CascadePhase.FALL && this._phaseTimer >= phaseMs) {
        this._finishStep();
      }
    }

    // ── Turn intro delay ──
    if (this.state === BattleState.TURN_INTRO) {
      if (!this._introAnnounced) {
        // Phase A: hold SILENTLY (no announcement) while a just-dealt damage
        // counter is still flying to + impacting the target portrait. Capped by
        // TURN_GATE_MAX_HOLD so a stuck effect can never freeze the battle.
        if (this._turnGate && this._turnGate()) {
          this._turnGateHold += dt;
          if (this._turnGateHold >= TURN_GATE_MAX_HOLD) this._beginTurnAnnouncement();
        } else {
          this._beginTurnAnnouncement();
        }
      } else {
        // Phase B: the announcement is up; run the intro delay then transition.
        this._turnIntroTimer += dt;
        if (this._turnIntroTimer >= TURN_INTRO_DURATION) {
          this._completeTurnIntro();
        }
      }
    }

    // ── Enemy turn delay ──
    // _extraEnemyTurnDelay lets a turn-start spectacle (Usurper's Heart harvest
    // tendrils) finish before the boss acts; it's consumed once per turn.
    if (this.state === BattleState.ENEMY_TURN && !this._enemyFired) {
      this._enemyTimer += dt;
      if (this._enemyTimer >= this._enemyDelay() + this._extraEnemyTurnDelay) {
        this._enemyFired = true;
        this._extraEnemyTurnDelay = 0;
        this._doEnemyTurn();
      }
    }
  }

  // ── Enemy ─────────────────────────────────────────────

  _doEnemyTurn() {
    // ── 0a. Dormant Sanguine Egg: SAFETY pass. In normal flow the egg phase
    //    resolves at the player's turn END (_endTurn → _resolveEggPhaseAtTurnEnd:
    //    slain → victory, or revert to the Phoenix BEFORE this enemy turn), so the
    //    Egg never actually reaches its own enemy turn. If it somehow does, it must
    //    NOT act (it would fall through to _doEnemySwap and shuffle the board) — it
    //    simply passes.
    if (this.enemyState._isDormantEgg) {
      this.log.add(`The ${this.enemyState.name} lies dormant.`);
      this._endTurn('enemy');
      return;
    }

    // ── 0b. Silence: skip ALL skill casting (custom + standard AI) and fall
    //    straight to the swap path. Forward-looking guard — no content silences
    //    the enemy yet, but this keeps the status uniform across both sides.
    const silenced = this._isSilenced(this.enemyState);
    if (silenced) {
      this.log.add(`${this.enemyState.name} is Silenced and cannot cast skills.`);
      this.enemyAI = new EnemyAI(this.enemyState, this.playerState);
      this._doEnemySwap();
      return;
    }

    // ── 1. Try custom AI handler (if any) ──────────────────
    const customAction = chooseEnemyAction(this.enemyState, {
      enemy: this.enemyState,
      player: this.playerState,
      board: this.board,
      battleState: this,
    });

    if (customAction) {
      this._dispatchCustomEnemyAction(customAction);
      return;
    }

    // ── 2. Standard AI fallback ────────────────────────────
    this.enemyAI = new EnemyAI(this.enemyState, this.playerState);

    const skill = this.enemyAI.findBestSkill();
    if (skill) {
      this._spendCost(this.enemyState, skill);
      this._setSkillSound(skill);
      this.log.add(`${this.enemyState.name} uses ${skill.name}.`);

      let enteredCascade = false;
      for (const effect of (skill.effects || [])) {
        if (this._resolveEffect(effect, skill, 'enemy')) {
          enteredCascade = true;
        }
      }

      // If any effect entered a cascade (e.g. CREATE_TILES), let it resolve
      if (enteredCascade) return;

      // Check for game over before proceeding to next turn
      if (this._checkGameOver()) return;

      // If an EXTRA_TURN effect was resolved, stay on the same side
      if (this._extraTurnEarned) {
        this._beginEnemyExtraTurn();
        return;
      }

      this._endTurn('enemy');
      return;
    }

    this._doEnemySwap();
  }

  /**
   * The enemy's board-swap action (standard-AI fallback, also used directly
   * when the enemy is Silenced). Requires `this.enemyAI` to be set.
   * @private
   */
  _doEnemySwap() {
    const swap = this.enemyAI.findBestSwap(this.board);
    if (swap) {
      this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
      this.log.add(`${this.enemyState.name} swaps tiles.`);
      const analysis = this.resolver.analyzeMatches(this.board, this.enemyState);
      if (analysis) {
        // Determine which swapped position caused the 4+ match
        const from = { col: swap.col1, row: swap.row1 };
        const to = { col: swap.col2, row: swap.row2 };
        this._swapTriggerPos = this._computeSwapCausePos(from, to, analysis);
        this._beginResolving('enemy', analysis);
      } else {
        this.board.swap(swap.col1, swap.row1, swap.col2, swap.row2);
        this._swapTriggerPos = null;
        this.log.add('No valid match. Board reshuffled.');
        this.board.reshuffle();
        this._endTurn('enemy');
      }
      return;
    }

    this.log.add('No valid moves. Board reshuffled.');
    this.board.reshuffle();
    this._endTurn('enemy');
  }

  /**
   * Safety net for a fully-stuck PLAYER turn: if there is no tile the player can
   * move (getValidSwaps excludes locked tiles, so an all-locked board yields
   * none) AND no skill they can cast, auto-pass the turn so it cycles and locks
   * tick down (locks expire each turn start, so the board frees up within a few
   * turns). No-op when any swap or castable skill exists. See decision #40.
   * @returns {boolean} true if the turn was auto-passed
   */
  _maybeAutoPassPlayer() {
    if (this.state !== BattleState.PLAYER_TURN) return false;
    if (this.board.getValidSwaps().length > 0) return false; // a tile can still move
    const canCast = !this._isSilenced(this.playerState)
      && (this.playerState.skills || []).some((s) => this._affordable(this.playerState, s));
    if (canCast) return false; // a skill can still be cast
    this.log.add('No moves available — turn passed.');
    this.pendingExtraTurn = false;
    this._endTurn('player');
    return true;
  }

  /**
   * Grant the enemy an extra turn after an INSTANT skill (no cascade) whose
   * effects included extra_turn (e.g. Cyclops' Smash).
   *
   * The enemy turn is TIMER-driven, so — unlike the player's input-driven
   * extra-turn path — we must re-arm the enemy fire gate (`_enemyFired` /
   * `_enemyTimer`) and stay in ENEMY_TURN. Otherwise the update loop's
   * `state === ENEMY_TURN && !_enemyFired` guard never lets the enemy act
   * again and the battle freezes. Mirrors the enemy branch of
   * `_finishResolving`'s extra-turn handling.
   * @private
   */
  _beginEnemyExtraTurn() {
    this._extraTurnEarned = false;
    this.pendingExtraTurn = true;
    this.state = BattleState.ENEMY_TURN;
    this._enemyFired = false;
    this._enemyTimer = 0;
    // Extra turn = new action: re-arm Deathbringer's once-per-action guard.
    this._deathbringerFiredThisAction = false;
    this.log.add('--- Extra Turn (Enemy) ---');
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Dispatch a custom AI action returned by an enemyAiOverrides handler.
   * Supports three action types: 'skill', 'swap', and 'pass'.
   * @param {object} action — { action: 'skill'|'swap'|'pass', skill?, swap? }
   * @private
   */
  _dispatchCustomEnemyAction(action) {
    if (action.action === 'skill' && action.skill) {
      this._spendCost(this.enemyState, action.skill);
      this._setSkillSound(action.skill);
      this.log.add(`${this.enemyState.name} uses ${action.skill.name}.`);

      let enteredCascade = false;
      for (const effect of (action.skill.effects || [])) {
        if (this._resolveEffect(effect, action.skill, 'enemy')) {
          enteredCascade = true;
        }
      }

      if (enteredCascade) return;
      if (this._checkGameOver()) return;

      if (this._extraTurnEarned) {
        this._beginEnemyExtraTurn();
        return;
      }

      this._endTurn('enemy');
      return;
    }

    if (action.action === 'swap' && action.swap) {
      const sw = action.swap;
      this.board.swap(sw.col1, sw.row1, sw.col2, sw.row2);
      this.log.add(`${this.enemyState.name} swaps tiles.`);
      const analysis = this.resolver.analyzeMatches(this.board, this.enemyState);
      if (analysis) {
        const from = { col: sw.col1, row: sw.row1 };
        const to = { col: sw.col2, row: sw.row2 };
        this._swapTriggerPos = this._computeSwapCausePos(from, to, analysis);
        this._beginResolving('enemy', analysis);
      } else {
        this.board.swap(sw.col1, sw.row1, sw.col2, sw.row2);
        this._swapTriggerPos = null;
        this.log.add('No valid match. Board reshuffled.');
        this.board.reshuffle();
        this._endTurn('enemy');
      }
      return;
    }

    // action === 'pass' or unrecognized action type
    // Treat as a deliberate pass — do nothing, end the turn
    if (action.action === 'pass') {
      this.log.add(`${this.enemyState.name} waits.`);
    } else {
      console.warn(
        `[BattleController] Custom AI returned unrecognized action: "${action.action}". ` +
        `Treating as pass.`
      );
      this.log.add(`${this.enemyState.name} waits.`);
    }
    this._endTurn('enemy');
  }

  // ── Skill Helpers ────────────────────────────────────

  /**
   * Record the skill's resolve sound key so the scene can play it.
   * Safe to call with any skill — if skill.sound is missing, this is a no-op.
   * @param {object} skill
   */
  _setSkillSound(skill) {
    if (skill && typeof skill.sound === 'string' && skill.sound.length > 0) {
      this._pendingSkillSound = skill.sound;
    }
  }

  _affordable(state, skill) {
    if (!skill.cost) return true;
    for (const [c, a] of Object.entries(skill.cost)) {
      if ((state.mana[c] || 0) < a) return false;
    }
    return true;
  }
  _spendCost(state, skill) {
    if (!skill.cost) return;
    for (const [c, a] of Object.entries(skill.cost)) {
      state.mana[c] = Math.max(0, (state.mana[c] || 0) - a);
    }
    // Spending mana lowers any "+attack per unspent mana" bonus immediately.
    this._recomputeDynamicAttack(state);
  }
  /**
   * Resolve a single effect from a skill's effects[] array.
   * Spends mana and plays sound are handled ONCE at the skill level before
   * this is called for each effect.
   *
   * @param {object} effect - { effectType, damage?, armor?, heal?, createTiles? }
   * @param {object} skill - the parent skill (for log context)
   * @param {string} side - 'player' or 'enemy'
   * @returns {boolean} true if a cascade was entered (e.g. CREATE_TILES)
   */
  _resolveEffect(effect, skill, side) {
    const src = side === 'player' ? this.playerState : this.enemyState;
    const tgt = side === 'player' ? this.enemyState : this.playerState;

    switch (effect.effectType) {
      case SKILL_EFFECT_TYPES.DAMAGE: {
        const base = (effect.damage && typeof effect.damage.amount === 'number')
          ? effect.damage.amount
          : (src.attack || 1);
        // `perSkull` (woven `skull + damage`): + N damage for every Skull tile
        // currently on the board, read at cast time.
        const perSkull = (effect.damage && typeof effect.damage.perSkull === 'number')
          ? effect.damage.perSkull : 0;
        const skullCount = perSkull > 0 ? this.board.getTilesOfType('skull').length : 0;
        // Opt-in stat scaling (effect.damage.scaling): + floored Attack/Magic
        // bonus from the caster. No `scaling` field → flat (unchanged). Both
        // character AND enemy skills carry it (bonus uses the caster's stats).
        const scaleBonus = scaledBonus(effect.damage && effect.damage.scaling, src);
        const amount = base + perSkull * skullCount + scaleBonus;
        const r = this._applyDamage(tgt, amount);
        this.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
        this._setShakeFromDamage(r.actualDamage, tgt.maxHp);
        this._markDirectDamage(side, r.actualDamage);
        this._dispatchDamageEvent(side, side === 'player' ? 'enemy' : 'player', r);
        // LEECH (woven modifier): heal the caster for a fraction of the damage
        // dealt. `leech` is a 0..1 fraction attached to the damage payload by the
        // synthesizer. See decision #40.
        this._applyLeech(src, side, r.actualDamage, effect.damage && effect.damage.leech);
        return false;
      }

      case SKILL_EFFECT_TYPES.ARMOR: {
        const base = (effect.armor && typeof effect.armor.amount === 'number')
          ? effect.armor.amount
          : (src.attack || 1);
        // Opt-in stat scaling (effect.armor.scaling): + floored Attack bonus.
        const amount = base + scaledBonus(effect.armor && effect.armor.scaling, src);
        src.armor += amount;
        this._emitFloatingStat(side, 'armor', amount);
        this.log.add(`${src.name} gains ${amount} armor.`);
        return false;
      }

      case SKILL_EFFECT_TYPES.BARRIER: {
        // One-round magic shield. Default scaling is Magic (twice as effective as
        // armor's Attack scaling — see scalingConfig _66). Absorbs damage like
        // armor (MatchResolver.applyDamage) and expires at the caster's next turn
        // start (_completeTurnIntro). See decision #38.
        const base = (effect.barrier && typeof effect.barrier.amount === 'number')
          ? effect.barrier.amount
          : 0;
        const amount = base + scaledBonus(effect.barrier && effect.barrier.scaling, src);
        if (amount > 0) {
          src.barrier = (src.barrier || 0) + amount;
          this._emitFloatingStat(side, 'barrier', amount);
          this.log.add(`${src.name} gains ${amount} barrier.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.HEAL: {
        const base = (effect.heal && typeof effect.heal.amount === 'number')
          ? effect.heal.amount
          : 0;
        if (base <= 0) {
          this.log.add(`${skill.name} has no heal amount configured.`);
          return false;
        }
        // Opt-in stat scaling (effect.heal.scaling): + floored Magic bonus.
        const amount = base + scaledBonus(effect.heal && effect.heal.scaling, src);
        const beforeHp = src.hp;
        src.hp = Math.min(src.maxHp, src.hp + amount);
        const actualHeal = src.hp - beforeHp;
        this._emitFloatingStat(side, 'heal', actualHeal);
        this.log.add(`${src.name} heals for ${actualHeal} HP.`);
        return false;
      }

      case SKILL_EFFECT_TYPES.GAIN_MAX_HP: {
        // Permanently raise the caster's MAX HP. Does NOT heal — a paired HEAL
        // effect fills the new space (e.g. Blood Gorge: +10 max HP, then heal 10).
        const amount = (effect.gainMaxHp && typeof effect.gainMaxHp.amount === 'number')
          ? effect.gainMaxHp.amount : 0;
        if (amount !== 0) {
          src.maxHp = Math.max(1, (src.maxHp || 0) + amount);
          this.log.add(`${src.name} gains ${amount} max HP.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.CREATE_TILES: {
        this._executeCreateTiles(effect, side, skill.name);
        return this.state === BattleState.RESOLVING;
      }

      case SKILL_EFFECT_TYPES.CONVERT_TILES_BY_TYPE: {
        this._executeConvertTilesByType(effect, side, skill.name);
        return this.state === BattleState.RESOLVING;
      }

      case SKILL_EFFECT_TYPES.DESTROY_TILES_BY_TYPE: {
        // Destroy tiles of a given type board-wide (non-targeted). `amount`
        // omitted = ALL of that type; set = up to N random ones. Routes through
        // the shared destroy path (mana + skull damage + cascade).
        const cfg = effect.destroyByType || {};
        const type = cfg.type;
        if (!type || !TILE_TYPES[String(type).toUpperCase()]) {
          console.warn(`[DESTROY_TILES_BY_TYPE] Unknown type "${type}". Skipping.`);
          return false;
        }
        let positions = this.board.getTilesOfType(type);
        if (typeof cfg.amount === 'number') {
          positions = BoardModel.pickRandomTiles(positions, cfg.amount);
        }
        if (!positions.length) {
          this.log.add(`${skill.name}: no ${type} tiles to destroy.`);
          return false;
        }
        this._executeDestroyTiles(positions, positions[0].col, positions[0].row, skill.name);
        return this.state === BattleState.RESOLVING;
      }

      case SKILL_EFFECT_TYPES.EXTRA_TURN: {
        if (this._canGainExtraTurn(side)) {
          this._extraTurnEarned = true;
          this.log.add(`${src.name} gains an extra turn!`);
        } else {
          this.log.add(`${src.name} is Frozen and cannot gain an extra turn.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.GAIN_ATTACK: {
        // Permanent attack gain (Chokeweed's Encroach). Delta-based dynamic
        // attack (Group A relics) composes with this without clobbering it.
        const amount = (effect.gainAttack && typeof effect.gainAttack.amount === 'number')
          ? effect.gainAttack.amount
          : 0;
        if (amount !== 0) {
          src.attack = (src.attack || 0) + amount;
          this.log.add(`${src.name} gains ${amount} attack.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.GAIN_MAGIC: {
        // Permanent magic gain (the woven `magic` tag). Magic isn't dynamically
        // recomputed, so a flat add persists cleanly for the rest of the battle.
        const amount = (effect.gainMagic && typeof effect.gainMagic.amount === 'number')
          ? effect.gainMagic.amount
          : 0;
        if (amount !== 0) {
          src.magic = (src.magic || 0) + amount;
          this.log.add(`${src.name} gains ${amount} magic.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.SELF_DESTRUCT: {
        // Caster dies. The post-effect _checkGameOver detects hp <= 0 and ends
        // the battle (if the same skill also killed the opponent, the player's
        // death is checked first, so a mutual-kill still resolves as a loss).
        src.hp = 0;
        this.log.add(`${src.name} self-destructs!`);
        return false;
      }

      case SKILL_EFFECT_TYPES.DRAIN_MANA: {
        // Remove mana from the OPPONENT (tgt). `color` optional — omit to drain
        // `amount` of every color (Soul Burn). The caster does NOT gain it.
        const dm = effect.drainMana || {};
        const amount = typeof dm.amount === 'number' ? dm.amount : 1;
        if (amount > 0) {
          if (!tgt.mana) tgt.mana = {};
          const colors = dm.color ? [dm.color] : MANA_COLORS;
          let drained = 0;
          for (const color of colors) {
            const before = tgt.mana[color] || 0;
            tgt.mana[color] = Math.max(0, before - amount);
            drained += before - tgt.mana[color];
          }
          // Draining unspent mana can lower the opponent's dynamic attack.
          this._recomputeDynamicAttack(tgt);
          if (drained > 0) this.log.add(`${tgt.name} is drained of ${drained} mana.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.GAIN_MANA: {
        // Grant the CASTER mana (synthesized "gain" skills). Gated by Enfeebled
        // like every other in-battle mana credit; fires onGainMana so reactor
        // relics (Flaming Arrow, …) see it — same as cascade/skill-destroy gains.
        const gm = effect.gainMana || {};
        const amount = typeof gm.amount === 'number' ? gm.amount : 0;
        const color = gm.color;
        if (amount > 0 && color) {
          if (this._canGainMana(side)) {
            if (!src.mana) src.mana = {};
            src.mana[color] = (src.mana[color] || 0) + amount;
            this._recomputeDynamicAttack(src);
            this.log.add(`${src.name} gains ${amount} ${color} mana.`);
            this._dispatchManaGain(side, color, amount);
          } else {
            this.log.add(`${src.name} is Enfeebled and gains no mana.`);
          }
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.SILENCE: {
        // Legacy alias → unified Silence status on the OPPONENT.
        const turns = (effect.silence && typeof effect.silence.turns === 'number')
          ? effect.silence.turns : 1;
        this._applyStatus(tgt, 'silenced', { turns }, side);
        return false;
      }

      case SKILL_EFFECT_TYPES.SET_ATTACK: {
        // Legacy alias → Cripple status (attack pinned to `value`) on the OPPONENT.
        const cfg = effect.setAttack || {};
        const value = typeof cfg.value === 'number' ? cfg.value : 1;
        const turns = typeof cfg.turns === 'number' ? cfg.turns : 1;
        this._applyStatus(tgt, 'crippled', { turns, attackValue: value }, side);
        return false;
      }

      case SKILL_EFFECT_TYPES.APPLY_STATUS: {
        // General, data-driven status application. Payload applyStatus:
        // { id, target:'self'|'opponent', turns, attackValue? }.
        const cfg = effect.applyStatus || {};
        if (!cfg.id || !getStatusDef(cfg.id)) {
          console.warn(`[BattleController] apply_status: unknown status id "${cfg.id}". Skipping.`);
          return false;
        }
        const turns = typeof cfg.turns === 'number' ? cfg.turns : 1;
        const targetState = cfg.target === 'self' ? src : tgt;
        this._applyStatus(targetState, cfg.id, { turns, attackValue: cfg.attackValue }, side);
        return false;
      }

      case SKILL_EFFECT_TYPES.SHUFFLE: {
        this._executeShuffle(side, skill && skill.name);
        // Never enters RESOLVING — shuffle yields a no-match board (the paired
        // extra_turn effect resolves inline afterward).
        return false;
      }

      case SKILL_EFFECT_TYPES.APPLY_POISON: {
        // Apply POISON stacks (default to the OPPONENT). The number of stacks
        // applied scales with the caster's stats (Poison Dart: base 3 + Magic
        // _50). The stacks themselves deal flat damage = stack count at the
        // applier's turn end (_tickPoison). See decision #39.
        const cfg = effect.poison || {};
        const base = (typeof cfg.amount === 'number') ? cfg.amount : 0;
        // `perSkull` (woven `skull + poison`): +N stacks per Skull on the board.
        const perSkull = (typeof cfg.perSkull === 'number') ? cfg.perSkull : 0;
        const skullCount = perSkull > 0 ? this.board.getTilesOfType('skull').length : 0;
        const stacks = base + perSkull * skullCount + scaledBonus(cfg.scaling, src);
        const targetState = cfg.target === 'self' ? src : tgt;
        this._applyPoison(targetState, stacks);
        return false;
      }

      case SKILL_EFFECT_TYPES.TRANSMUTE_MANA: {
        // Convert the caster's OTHER mana into a destination color — a battery
        // for next turn. Pulls from the most-abundant other colors first; finite,
        // so it can't loop. Fires onGainMana so reactor relics see the gain.
        // See decision #40.
        const cfg = effect.transmuteMana || {};
        const dest = cfg.color;
        let budget = (typeof cfg.amount === 'number') ? cfg.amount : 0;
        if (!dest || budget <= 0) return false;
        if (!this._canGainMana(side)) {
          this.log.add(`${src.name} is Enfeebled and cannot transmute mana.`);
          return false;
        }
        if (!src.mana) src.mana = {};
        const others = MANA_COLORS.filter((c) => c !== dest)
          .sort((a, b) => (src.mana[b] || 0) - (src.mana[a] || 0));
        let moved = 0;
        for (const c of others) {
          if (budget <= 0) break;
          const take = Math.min(src.mana[c] || 0, budget);
          if (take > 0) { src.mana[c] -= take; budget -= take; moved += take; }
        }
        if (moved > 0) {
          src.mana[dest] = (src.mana[dest] || 0) + moved;
          this._recomputeDynamicAttack(src);
          this.log.add(`${src.name} transmutes ${moved} mana into ${dest}.`);
          this._dispatchManaGain(side, dest, moved);
        } else {
          this.log.add(`${src.name} has no other mana to transmute.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.CONSUME: {
        // Spend a built-up pool for damage = floor(poolSize / divisor) — 1 damage
        // per `divisor` units. 'mana' (with a color = that color's leftover, no
        // color = ALL leftover mana); 'armor'/'barrier' = that shield pool (a
        // Shield Bash). No stat scaling. See decision #40.
        const cfg = effect.consume || {};
        const divisor = Math.max(1, cfg.divisor || 2);
        let units = 0;
        if (cfg.resource === 'armor') { units = src.armor || 0; src.armor = 0; }
        else if (cfg.resource === 'barrier') { units = src.barrier || 0; src.barrier = 0; }
        else {
          if (!src.mana) src.mana = {};
          const cols = cfg.color ? [cfg.color] : MANA_COLORS;
          for (const c of cols) { units += src.mana[c] || 0; src.mana[c] = 0; }
          this._recomputeDynamicAttack(src);
        }
        const amount = Math.floor(units / divisor);
        if (amount > 0) {
          const r = this._applyDamage(tgt, amount);
          this.log.add(`${src.name} consumes ${units} ${cfg.resource || 'mana'}, dealing ${r.actualDamage} damage.`);
          this._setShakeFromDamage(r.actualDamage, tgt.maxHp);
          this._markDirectDamage(side, r.actualDamage);
          this._dispatchDamageEvent(side, side === 'player' ? 'enemy' : 'player', r);
        } else {
          this.log.add(`${src.name} has nothing to consume.`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.MARK: {
        // Arm a one-time damage MULTIPLIER on the caster's NEXT damage instance
        // (consumed in _applyDamage). Persists until consumed (no timer). The
        // larger multiplier wins if re-applied. See decision #40.
        const mult = (effect.mark && typeof effect.mark.multiplier === 'number')
          ? effect.mark.multiplier : 2;
        if (mult > 1) {
          src.mark = Math.max(src.mark || 0, mult);
          this.log.add(`${src.name} marks the next strike (x${mult}).`);
        }
        return false;
      }

      case SKILL_EFFECT_TYPES.LOCK_COLOR: {
        // NON-targeted lock fallback (the `random`-bonus variant, which carries a
        // preset color). The woven `lock` action is TARGETED and resolves via
        // _executeLockColor (clicked tile's color); this path only fires for an
        // instant skill with a preset `cfg.color`, else most-abundant. Decision #40.
        const cfg = effect.lockColor || {};
        const turns = (typeof cfg.turns === 'number' && cfg.turns >= 2) ? cfg.turns : 2;
        let color = cfg.color;
        if (!color) color = this._mostAbundantBoardColor();
        if (color) {
          this.board.lockColor(color, turns);
          this.log.add(`${src.name} locks ${color} tiles for ${turns} turns.`);
        }
        return false;
      }

      default:
        console.warn(`[BattleController] Unknown effect type: "${effect.effectType}". Skipping.`);
        return false;
    }
  }

  /**
   * Heal the caster for a fraction of damage just dealt (woven `leech`). No-op
   * when there's no leech fraction or no damage landed. See decision #40.
   * @param {object} src @param {'player'|'enemy'} side
   * @param {number} dealt @param {number|undefined} fraction — 0..1
   */
  _applyLeech(src, side, dealt, fraction) {
    if (!src || !(fraction > 0) || !(dealt > 0)) return;
    const heal = Math.floor(dealt * fraction);
    if (heal <= 0) return;
    const before = src.hp;
    src.hp = Math.min(src.maxHp, src.hp + heal);
    const actual = src.hp - before;
    if (actual > 0) {
      this._emitFloatingStat(side, 'heal', actual);
      this.log.add(`${src.name} leeches ${actual} HP.`);
    }
  }

  /**
   * The most abundant matchable (non-skull, non-wild, non-inert, non-locked)
   * tile color on the board — used as the default `lock` target when no color
   * is woven. Returns null if the board has no matchable color.
   * @returns {string|null}
   */
  _mostAbundantBoardColor() {
    const counts = {};
    for (const color of MANA_COLORS) {
      if (this.board.isColorLocked(color)) continue;
      const n = this.board.getTilesOfType(color).length;
      if (n > 0) counts[color] = n;
    }
    let best = null, bestN = 0;
    for (const [c, n] of Object.entries(counts)) {
      if (n > bestN) { best = c; bestN = n; }
    }
    return best;
  }

  /**
   * Targeted `lock`: lock the color of the CLICKED tile (and every tile of that
   * color), board-wide, for `turns`. Locks any matchable type the player clicks
   * (the 5 mana colors + skull); a non-lockable click (wild/disease/empty) falls
   * back to the effect's `color` or the most-abundant color. See decision #40.
   * @param {number} col @param {number} row
   * @param {object} effect — { lockColor: { color?, turns } }
   * @param {string} skillName
   */
  _executeLockColor(col, row, effect, skillName) {
    const cfg = effect.lockColor || {};
    const turns = (typeof cfg.turns === 'number' && cfg.turns >= 2) ? cfg.turns : 2;
    const LOCKABLE = [...MANA_COLORS, 'skull'];
    let color = this.board.get(col, row);
    if (!color || !LOCKABLE.includes(color)) {
      color = (cfg.color && LOCKABLE.includes(cfg.color)) ? cfg.color : this._mostAbundantBoardColor();
    }
    if (color && LOCKABLE.includes(color)) {
      this.board.lockColor(color, turns);
      this.log.add(`${skillName || 'A spell'} locks all ${color} tiles for ${turns} turns.`);
    } else {
      this.log.add(`${skillName || 'A spell'}: no valid tile to lock.`);
    }
  }

  /**
   * Execute a SHUFFLE effect: randomize the board into a fresh no-match
   * arrangement and flag the scene to play the shuffle animation. Non-cascade
   * (the board has no immediate matches), so it does NOT enter RESOLVING.
   *
   * Guard: if a cascade is already in flight (a rare combo where shuffle is
   * woven alongside a create/destroy that already kicked off resolution),
   * skip the shuffle rather than corrupt the in-flight board state.
   * @param {string} side - 'player' or 'enemy'
   * @param {string} [skillName]
   */
  _executeShuffle(side, skillName) {
    if (this.state === BattleState.RESOLVING) {
      this.log.add(`${skillName || 'Shuffle'} fizzles — the board is still resolving.`);
      return;
    }
    this.board.shuffle();
    this.log.add(`${skillName || 'A spell'} shuffles the board!`);
    this._boardShuffled = true; // one-shot flag → BattleScene plays the animation
  }

  // ── Game Over ────────────────────────────────────────

  _checkGameOver() {
    // Player first + sticky `_defeated` so a 0-HP moment is a loss even if a
    // heal revived HP before this check ran.
    if (this.playerState.hp <= 0 || this.playerState._defeated) {
      this.state = BattleState.GAME_OVER;
      this.log.add(`${this.playerState.name} has been defeated...`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    if (this.enemyState.hp <= 0 || this.enemyState._defeated) {
      // Death-transform (Sanguine Egg relic): the enemy may cheat death by
      // transforming instead of dying. If it does, the battle continues.
      if (this._tryEnemyDeathTransform()) return false;
      // A real death — if the Egg itself was just slain, clear any lingering
      // egg-phase state so the turn-end deadline can't fire after victory.
      this._endEggPhase();
      this.state = BattleState.GAME_OVER;
      this.log.add(`Victory! ${this.enemyState.name} has been slain!`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    return false;
  }

  /**
   * Give the enemy a chance to transform-on-death (Sanguine Phoenix's Sanguine
   * Egg relic) before victory is declared. Dispatches the `onDeath` trigger; a
   * `transform` board-effect swaps the enemy identity in place and restores its
   * HP, so afterward the enemy is no longer dead and the battle continues.
   *
   * Re-entry guarded: the swap leaves the NEW form alive, but the guard also
   * stops a hypothetical transform that left HP at 0 from looping. Returns true
   * iff the enemy is no longer dead after the dispatch.
   * @returns {boolean}
   */
  _tryEnemyDeathTransform() {
    if (this._deathTransformFiring) return false;
    this._deathTransformFiring = true;
    this.passives.dispatch(TRIGGER_TYPES.ON_DEATH, { side: 'enemy' });
    this._deathTransformFiring = false;
    return !(this.enemyState.hp <= 0 || this.enemyState._defeated);
  }

  // ── Passive Trigger Dispatch ─────────────────────────
  //
  // Helpers that fan out battle events to PassiveSystem so relic effects
  // can react. All trigger dispatch should go through these helpers so
  // future agents have one place to look when adding a new event source.

  _getStateBySide(side) {
    return side === 'player' ? this.playerState : this.enemyState;
  }

  /**
   * Queue a floating combat-stat text event for the scene to animate over a
   * portrait. Read & cleared each frame via getState(). No-op for amount <= 0.
   *
   * @param {'player'|'enemy'} side — the affected combatant
   * @param {'damage'|'heal'|'armor'|'barrier'} kind — drives color & sign in BattleScene
   * @param {number} amount — magnitude shown (always positive)
   */
  _emitFloatingStat(side, kind, amount) {
    if (!amount || amount <= 0) return;
    this._floatingStatEvents.push({ side, kind, amount: amount | 0 });
  }

  /**
   * Mark that `side` dealt DIRECT damage this frame (a damaging spell, or skull
   * damage) — i.e. the character's own attack, NOT incidental damage (reflect,
   * relic echo, poison, bleed, passive reactors). One-shot, read-and-cleared in
   * getState(); drives the attack-animation POC. No-op for amount <= 0 so a fully
   * blocked hit doesn't count as a landed attack.
   * @param {'player'|'enemy'} side — the attacker
   * @param {number} amount — actual damage dealt
   */
  _markDirectDamage(side, amount) {
    if (amount > 0 && this._directDamageBySide) this._directDamageBySide[side] = true;
  }

  /**
   * Apply damage to `target` with a pre-mitigation pass for defensive
   * passives. Dispatches `onIncomingDamage` so relics like Evil Eye can
   * mutate the mutable `amount` field before MatchResolver.applyDamage
   * runs its armor → block → HP math.
   *
   * Every damage call site (skill DAMAGE effects, skull cascade damage,
   * destroyed-tile skull damage, passive damage relics via the wrapped
   * resolver) goes through this method so the mitigation applies uniformly.
   *
   * @param {object} target — battle state of the side being damaged
   * @param {number} amount — raw damage before mitigation
   * @returns {{actualDamage:number, blocked:number, armorDamage:number}}
   */
  _applyDamage(target, amount, opts = {}) {
    const side = target === this.playerState ? 'player' : 'enemy';
    const attackerSide = opts.attackerSide || (side === 'player' ? 'enemy' : 'player');
    const attacker = this._getStateBySide(attackerSide);
    const payload = { side, amount };
    // Set _currentRelicTarget so any onDamage-style hooks fired during
    // dispatch can reference the side being damaged. Cleared after.
    const prevRelicTarget = this._currentRelicTarget;
    this._currentRelicTarget = target;
    this.passives.dispatch(TRIGGER_TYPES.ON_INCOMING_DAMAGE, payload);
    this._currentRelicTarget = prevRelicTarget;

    // ── Status-effect damage modifiers ──
    // Order: a Berserk ATTACKER deals double and "ignores all effects" (bypasses
    // the target's defensive statuses: Brittle/Intangible). Otherwise the target's
    // mitigations apply (Brittle ×1.5, then Intangible clamps to 1 — it wins over
    // Brittle). A Berserk TARGET always takes double (its own downside, can't be
    // ignored). Berserk is not yet applied by any content — these multipliers are
    // tunable. (Barrier is NOT a status — it's a numeric shield pool absorbed in
    // resolver.applyDamage AFTER this mitigation, alongside armor. See decision #38.)
    let dmg = Math.max(0, payload.amount | 0);
    // MARK (woven): the attacker's banked one-time MULTIPLIER (×2, or ×3 with
    // Greater) is applied to this hit's raw damage, then consumed. Skipped for
    // reflected damage so reflect can't burn a mark. See decision #40.
    if (attacker && attacker.mark > 1 && !opts.isReflect) {
      dmg = Math.round(dmg * attacker.mark);
      attacker.mark = 0;
    }
    const attackerBerserk = !!attacker && this._hasStatus(attacker, 'berserk');
    if (attackerBerserk) {
      dmg *= 2;
    } else {
      if (this._hasStatus(target, 'brittle'))    dmg = Math.round(dmg * 1.5);
      if (this._hasStatus(target, 'intangible')) dmg = Math.min(dmg, 1);
    }
    if (this._hasStatus(target, 'berserk')) dmg *= 2;

    const finalAmount = Math.max(0, dmg | 0);
    const result = this.resolver.applyDamage(target, finalAmount);

    // REFLECT (woven buff): if the target carries the `reflecting` buff, deal its
    // all the damage taken back to the attacker. Guarded against recursion (a
    // reflected hit can't itself reflect). The nested _applyDamage handles the
    // attacker's floating "-x" + sticky death; we add log + shake here. Decision #40.
    if (result.actualDamage > 0 && attacker && !opts.isReflect && !this._reflecting) {
      // Reflect ALL of the damage just taken back to the attacker (the target
      // still took it above). See decision #40.
      if (this._hasStatus(target, 'reflecting')) {
        this._reflecting = true;
        const rr = this._applyDamage(attacker, result.actualDamage, { attackerSide: side, isReflect: true });
        this._reflecting = false;
        this._reflectTriggered = true; // one-shot → BattleScene plays the reflect SFX
        if (rr.actualDamage > 0) {
          this.log.add(`${target.name} reflects ${rr.actualDamage} damage to ${attacker.name}.`);
          this._setShakeFromDamage(rr.actualDamage, attacker.maxHp);
        }
      }
    }
    // Floating "-x" damage text over the damaged side's portrait. This is the
    // single chokepoint for ALL damage (skill, skull, passive), so every hit
    // animates here. Uses actualDamage to match the combat-log number.
    this._emitFloatingStat(side, 'damage', result.actualDamage);
    // Death is STICKY: once a side's HP is reduced to 0 it has lost, even if a
    // later heal in the same resolution window (Soul Eater, Alabaster Flask,
    // Oungan, …) brings HP back above 0. Without this, lethal-damage-then-heal
    // could flip a loss into a recorded victory. Honored by _winner/_checkGameOver.
    if (target.hp <= 0) target._defeated = true;
    return result;
  }

  /**
   * Dispatch onTakeDamage / onDealDamage passive triggers if any damage
   * landed (actualDamage > 0). Safe to call after every applyDamage call.
   *
   * @param {'player'|'enemy'} attackerSide
   * @param {'player'|'enemy'} targetSide
   * @param {{actualDamage:number, blocked:number, armorDamage:number}} result
   */
  _dispatchDamageEvent(attackerSide, targetSide, result, opts = {}) {
    if (!result || result.actualDamage <= 0) return;
    this._currentRelicTarget = this._getStateBySide(targetSide);
    this.passives.dispatch(TRIGGER_TYPES.ON_TAKE_DAMAGE, {
      side: targetSide,
      amount: result.actualDamage,
      blocked: result.blocked,
      armorDamage: result.armorDamage,
    });
    this.passives.dispatch(TRIGGER_TYPES.ON_DEAL_DAMAGE, {
      side: attackerSide,
      amount: result.actualDamage,
      target: targetSide,
      // Whether this was SKULL damage — lets onDealDamage relics gate on it
      // (Poison Vial only poisons on skull damage). See decision #39.
      isSkull: !!opts.isSkull,
    });
    this._currentRelicTarget = null;
  }

  /**
   * Dispatch onGainMana for a single color the active side just gained.
   * Lets relics react to mana gain (e.g. Flaming Arrow deals 1 damage when
   * its owner gains red mana). Sets _currentRelicTarget to the opponent so
   * any damage dealt by the reacting relic routes screen shake to the right
   * side.
   *
   * Called for ALL in-battle mana gains: board match rewards (_doRemove), skill
   * tile-destruction rewards (_executeDestroyTiles), AND relic-granted mana
   * (Familiars, Family Crest, Prism) via the PassiveSystem onGainMana callback —
   * so onGainMana reactors (Tuning Rod, Flaming Arrow) fire for relic mana too.
   * Starting mana / one-time Potion grants (grant_starting_mana) do NOT call this.
   *
   * @param {'player'|'enemy'} side — the side that gained mana
   * @param {string} color — mana color gained
   * @param {number} amount — amount gained (must be > 0)
   */
  _dispatchManaGain(side, color, amount) {
    if (!color || amount <= 0) return;
    const targetSide = side === 'player' ? 'enemy' : 'player';
    const prev = this._currentRelicTarget;
    this._currentRelicTarget = this._getStateBySide(targetSide);
    this.passives.dispatch(TRIGGER_TYPES.ON_GAIN_MANA, { side, color, amount });
    this._currentRelicTarget = prev;
  }

  /**
   * Dispatch onTileMatch / onTileMatchType / onMatch4Plus for a cascade
   * step. Fires once per analysis with one `onTileMatch`, then one
   * `onTileMatchType` per individual match, plus `onMatch4Plus` for any
   * match of 4+ tiles.
   *
   * @param {'player'|'enemy'} side — the active side that triggered the match
   * @param {import('./MatchResolver.js').MatchAnalysis} analysis
   * @param {{col:number,row:number}|null} [causePos] — focal point of the 4+
   *     match (swap origin or cascade-overlap tile); forwarded to passives
   *     via the onMatch4Plus payload's `centerPos` field.
   */
  _dispatchMatchEvents(side, analysis, causePos = null) {
    if (!analysis) return;
    this.passives.dispatch(TRIGGER_TYPES.ON_TILE_MATCH, {
      side,
      matches: analysis.matches,
      tilesDestroyed: analysis.tilesDestroyed,
    });
    for (const m of analysis.matches) {
      this.passives.dispatch(TRIGGER_TYPES.ON_TILE_MATCH_TYPE, {
        side,
        typeId: m.typeId,
        count: m.count,
        isShape: !!m.isShape,
      });
      if (m.count >= 4) {
        this.passives.dispatch(TRIGGER_TYPES.ON_MATCH_4_PLUS, {
          side,
          typeId: m.typeId,
          count: m.count,
          centerPos: causePos,
        });
      }
    }
  }

  // ── Passive board effects ─────────────────────────────

  /**
   * Handle a board-touching passive effect that EffectResolver doesn't
   * cover. Dispatched from PassiveSystem via the onBoardEffect callback.
   * Returning true means "I handled this"; false lets PassiveSystem warn.
   *
   * Effect types handled here:
   *   destroy_tiles_radius — augments the in-flight cascade step's
   *     analysis with tiles in a square radius around payload.centerPos.
   *   destroy_random_row — augments the in-flight cascade step's analysis
   *     with every tile in a randomly chosen row (Gorepike, onMatch4Plus).
   *   Both flow through the normal SHOW_MATCH → REMOVE cycle, awarding
   *     mana / skull-damage like a destroy_tiles skill.
   *   destroy_random_skulls — queues a deferred skull destruction
   *     (Deathbringer, onDealDamage); drained after the current resolution
   *     settles so it doesn't mutate the board mid-cascade.
   *
   * @param {object} effect      — relic effect definition
   * @param {string} triggerName — trigger event name (e.g. 'onMatch4Plus')
   * @param {object} payload     — trigger payload (carries `centerPos` for 4+)
   * @returns {boolean} true if the effect was recognized and applied
   */
  _handlePassiveBoardEffect(effect, triggerName, payload /*, ctx */) {
    if (!effect || !effect.effectType) return false;

    switch (effect.effectType) {
      case 'destroy_tiles_radius':
        return this._applyPassiveDestroyRadius(effect, payload);
      case 'destroy_random_row':
        return this._applyPassiveDestroyRandomRow(effect, payload);
      case 'convert_random_tiles':
        return this._applyPassiveConvertRandomTiles(effect);
      case 'create_tiles':
        return this._applyPassiveCreateTiles(effect, payload);
      case 'harvest_tiles':
        return this._applyPassiveHarvest(effect, payload);
      case 'transform':
        return this._applyTransform(effect, payload);
      case 'echo_damage':
        return this._applyPassiveEchoDamage(effect, payload);
      case 'apply_poison':
        return this._applyPassivePoison(effect, payload);
      case 'destroy_random_skulls': {
        // The once-per-action recursion guard applies ONLY to damage-triggered
        // destroyers (Deathbringer, onDealDamage): the skull damage their
        // destruction deals fires onDealDamage again, so without the guard they
        // would re-queue and loop. Match-triggered destroyers (Death Familiar,
        // onTileMatchType) don't recurse on their own damage, so they bypass
        // the guard and fire per qualifying match.
        const isDamageTriggered = triggerName === TRIGGER_TYPES.ON_DEAL_DAMAGE;
        if (isDamageTriggered && this._deathbringerFiredThisAction) return true;
        const amount = (effect.destroySkulls && typeof effect.destroySkulls.amount === 'number')
          ? effect.destroySkulls.amount
          : 1;
        if (isDamageTriggered) this._deathbringerFiredThisAction = true;
        this._pendingSkullDestroy += Math.max(0, amount);
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Augment the current cascade step's analysis with the cells in a
   * square radius around `payload.centerPos`. Returns true even when no
   * extra cells were added — we still "handled" the effect.
   *
   * @param {object} effect — { area: { radius } }
   * @param {object} payload — { side, centerPos: {col,row}, ... }
   * @returns {boolean}
   */
  _applyPassiveDestroyRadius(effect, payload) {
    if (!this._analysis) return true;
    const center = payload && payload.centerPos;
    if (!center) return true;
    const radius = (effect.area && typeof effect.area.radius === 'number')
      ? effect.area.radius
      : 1;

    const cells = [];
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        cells.push({ col: center.col + dc, row: center.row + dr });
      }
    }
    this._addCellsToAnalysis(cells);
    return true;
  }

  /**
   * Augment the current cascade step's analysis with every tile in a
   * randomly chosen row (Gorepike). Returns true even if nothing was added.
   * @param {object} effect — unused (kept for signature consistency)
   * @param {object} payload — { side, ... }
   * @returns {boolean}
   */
  _applyPassiveDestroyRandomRow(effect, payload) {
    if (!this._analysis) return true;
    const row = Math.floor(Math.random() * this.board.rows);
    const cells = [];
    for (let c = 0; c < this.board.cols; c++) {
      cells.push({ col: c, row });
    }
    this._addCellsToAnalysis(cells);
    this.log.add(`A row is destroyed!`);
    return true;
  }

  /**
   * Convert up to N random tiles of one type into another type
   * (Chokeweed Sap: 2 Skulls → Green on turn start).
   *
   * This fires from onTurnStart. If the conversion lines up a match, the
   * cascade IS resolved (awarding the active side mana / skull damage), then
   * the active side resumes its NORMAL turn via the _resumeTurnAfterResolve
   * flag — _finishResolving must not end the turn or grant an extra turn,
   * since the side hasn't acted yet. If no match forms, the tiles are just
   * converted in place. Converted positions are surfaced via
   * _convertedTilePositions so the scene spawns the conversion shimmer.
   *
   * @param {object} effect — { convertTiles: { from, to, amount } }
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyPassiveConvertRandomTiles(effect) {
    const cfg = (effect && effect.convertTiles) || {};
    const from = cfg.from;
    const to = cfg.to;
    const amount = typeof cfg.amount === 'number' ? cfg.amount : 1;
    if (!from || !to || amount <= 0) return true;
    if (!TILE_TYPES[String(from).toUpperCase()] || !TILE_TYPES[String(to).toUpperCase()]) {
      console.warn(`[convert_random_tiles] Unknown tile type from="${from}" to="${to}". Skipping.`);
      return true;
    }

    const candidates = this.board.getTilesOfType(from);
    if (candidates.length === 0) return true;

    const chosen = BoardModel.pickRandomTiles(candidates, amount);
    const count = this.board.convertTilesToType(chosen, to);
    if (count <= 0) return true;

    this._convertedTilePositions = chosen.slice(0, count).map(p => ({
      col: p.col, row: p.row, typeId: to,
    }));
    this.log.add(`${count} ${from} converted to ${to}.`);

    // Only resolve a resulting match when this fires at the START of a turn
    // (its sole use today — onTurnStart). The turn-state guard keeps a future
    // mid-cascade trigger from clobbering an in-flight resolution.
    const atTurnStart = this.state === BattleState.PLAYER_TURN ||
                        this.state === BattleState.ENEMY_TURN;
    if (atTurnStart) {
      const analysis = this.resolver.analyzeMatches(this.board, this._activeState());
      if (analysis) {
        this._swapTriggerPos = null;
        this._resumeTurnAfterResolve = true;
        this._beginResolving(this.activeSide, analysis);
      }
    }
    return true;
  }

  /**
   * Create N tiles of a type by converting random non-matching tiles in place
   * (Infected Tooth: "create a Disease tile after dealing damage", on
   * onDealDamage). Unlike the CREATE_TILES skill, this does NOT analyze for
   * matches or kick off a cascade — it just stamps the tiles down. It can fire
   * mid-cascade (skull damage re-fires onDealDamage); an in-place type change of
   * one tile is harmless to the running phase machine (the tile is still removed
   * normally if it was already part of the active step). Each created tile
   * dispatches onTileCreated so reactors (Severed Maxilla) fire per tile.
   *
   * When cfg.avoidMatches is true (e.g. Thrall tiles from Usurper's Heart),
   * tiles are placed one at a time, each preferring a position that would NOT
   * immediately form a match — re-evaluated after every placement so two new
   * tiles can't accidentally complete a run together. If no safe position
   * exists at a step it falls back to any replaceable tile.
   *
   * @param {object} effect — { createTiles: { type, amount, avoidMatches? } }
   * @param {object} payload — trigger payload { side, ... } (the creating side)
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyPassiveCreateTiles(effect, payload) {
    const cfg = (effect && effect.createTiles) || {};
    const type = cfg.type;
    const amount = typeof cfg.amount === 'number' ? cfg.amount : 1;
    const avoidMatches = !!cfg.avoidMatches;
    if (!type || amount <= 0) return true;
    if (!TILE_TYPES[String(type).toUpperCase()]) {
      console.warn(`[create_tiles passive] Unknown tile type="${type}". Skipping.`);
      return true;
    }

    // Place tiles one at a time so safe-spawn checks see prior placements.
    const placed = [];
    for (let i = 0; i < amount; i++) {
      let candidates = this.board.getTilesNotOfType(type);
      if (candidates.length === 0) break;
      if (avoidMatches) {
        const safe = candidates.filter(
          (p) => !this.board.positionCreatesMatch(p.col, p.row, type)
        );
        // Fall back to any replaceable tile when no safe spot remains.
        if (safe.length > 0) candidates = safe;
      }
      const [chosen] = BoardModel.pickRandomTiles(candidates, 1);
      if (!chosen) break;
      if (this.board.convertTilesToType([chosen], type) > 0) placed.push(chosen);
    }

    const count = placed.length;
    if (count <= 0) return true;

    // Surface the new tiles for the conversion shimmer (concat so we don't
    // clobber any pending conversions from the action that triggered us).
    const created = placed.map((p) => ({ col: p.col, row: p.row, typeId: type }));
    this._convertedTilePositions = (this._convertedTilePositions || []).concat(created);
    this.log.add(`${count} ${type} tile(s) created.`);

    // Flag Thrall summons (Baron's Signet) so the scene plays the summon SFX.
    if (String(type).toLowerCase() === 'thrall') this._thrallSummoned = true;

    // Notify onTileCreated reactors — once per created tile so per-tile effects
    // (Severed Maxilla → +1 attack) accumulate correctly.
    const side = payload && payload.side;
    if (side) {
      for (let i = 0; i < count; i++) {
        this.passives.dispatch(TRIGGER_TYPES.ON_TILE_CREATED, { side, typeId: type, count: 1 });
      }
    }
    return true;
  }

  /**
   * Harvest every tile of one type on the board (Baron's Signet): the owner
   * gains `attackPer` attack per harvested tile, then each harvested tile is
   * converted into another type (Thrall → Skull). No tiles are harvested ⇒
   * nothing happens (no attack, no animation) — the action flow just continues.
   *
   * The board mutation is applied immediately (synchronous passive dispatch),
   * but the Thrall positions are captured BEFORE conversion and surfaced via
   * _harvestEvents so BattleScene can spiral "tendril" effects from each Thrall
   * to the harvester's portrait. This fires on the boss's turn START (before it
   * acts), so we extend its pre-action wait (_extraEnemyTurnDelay) to let the
   * tendrils play out first — matching the "harvest animation runs before other
   * boss actions" requirement within the synchronous turn machine.
   *
   * @param {object} effect — { harvestTiles: { type, toType, attackPer, tendrilColor? } }
   * @param {object} payload — trigger payload { side, ... } (the harvesting side)
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyPassiveHarvest(effect, payload) {
    const cfg = (effect && effect.harvestTiles) || {};
    const fromType = cfg.type || 'thrall';
    const toType = cfg.toType || 'skull';
    const attackPer = typeof cfg.attackPer === 'number' ? cfg.attackPer : 1;
    if (!TILE_TYPES[String(fromType).toUpperCase()] || !TILE_TYPES[String(toType).toUpperCase()]) {
      console.warn(`[harvest_tiles] Unknown tile type from="${fromType}" to="${toType}". Skipping.`);
      return true;
    }

    const side = (payload && payload.side) || this.activeSide;
    const harvester = this._getStateBySide(side);
    if (!harvester) return true;

    const positions = this.board.getTilesOfType(fromType);
    const count = positions.length;
    if (count === 0) return true; // No Thralls — do nothing, no animation.

    // 1) Animation event — capture positions BEFORE conversion so the tendrils
    //    originate from where the Thralls were.
    this._harvestEvents.push({
      side,
      positions: positions.map((p) => ({ col: p.col, row: p.row })),
      color: cfg.tendrilColor || '#d22a2a',
    });
    // Harvest fires at the boss's turn START, so extend its pre-action wait to
    // give the tendrils time to reach the portrait before the boss acts.
    if (side === 'enemy') this._extraEnemyTurnDelay += HARVEST_ANIM_DELAY;

    // 2) Gain attack per harvested Thrall (permanent for the battle — same
    //    semantics as EffectResolver's gain_attack; safe to add directly).
    const attackGain = attackPer * count;
    if (attackGain > 0) harvester.attack = (harvester.attack || 0) + attackGain;

    // 3) Convert the harvested Thralls into the target type (Skulls) in place.
    //    Surface them as a conversion shimmer (concat so we don't clobber other
    //    pending conversions). No cascade — the new Skulls sit as a threat.
    this.board.convertTilesToType(positions, toType);
    const converted = positions.map((p) => ({ col: p.col, row: p.row, typeId: toType }));
    this._convertedTilePositions = (this._convertedTilePositions || []).concat(converted);

    this.log.add(`${harvester.name} harvests ${count} Thrall(s), gaining ${attackGain} Attack.`);
    return true;
  }

  /**
   * Swap the enemy's identity to a pre-resolved alternate form IN PLACE
   * (Sanguine Phoenix ⇄ Sanguine Egg). The new form arrives at FULL life and
   * keeps the current mana; everything else (name, portrait, HP pool, skills,
   * relics, AI) is replaced from the form data MapScene pre-resolved into
   * `_enemyForms`.
   *
   * In-place mutation is REQUIRED: PassiveSystem caches the exact `enemyState`
   * object reference, so replacing the object would orphan the dispatcher. We
   * mutate fields instead and signal the scene (via _enemyTransformed) to
   * rebuild the portrait + skills pane; the relic bar re-reads relics each frame.
   *
   * @param {string} intoEnemyId — key into _enemyForms
   * @returns {boolean} true if the swap happened
   */
  _transformInto(intoEnemyId) {
    const form = this._enemyForms && this._enemyForms[intoEnemyId];
    if (!form) {
      console.warn(`[transform] No pre-resolved form "${intoEnemyId}". Skipping.`);
      return false;
    }
    const cloned = this._cloneState(form); // fresh resolved state at full HP
    const e = this.enemyState;
    const keptMana = e.mana ? { ...e.mana } : {};

    e.name = cloned.name;
    e.className = cloned.className;
    e.level = cloned.level;
    e.maxHp = cloned.maxHp;
    e.hp = cloned.maxHp;            // the new form arrives at full life
    e.attack = cloned.attack;
    e.magic = cloned.magic || 0;
    e.armor = cloned.armor || 0;
    e.block = 0;
    e.barrier = 0;                 // a fresh body — clear any magic shield
    e.mark = 0;                    // clear any banked damage mark
    e.portrait = cloned.portrait;
    e.skills = cloned.skills;
    e.allSkills = cloned.allSkills;
    e.relics = cloned.relics;
    e.aiBehavior = cloned.aiBehavior;
    e.statuses = [];               // a fresh body — clear any debuffs
    e._defeated = false;
    e._isDormantEgg = false;       // cleared here; the Egg form re-sets it (below)
    e.mana = keptMana;             // mana carries across the transform

    // Reset per-side static-modifier bookkeeping for the new relic set. The
    // transform forms carry no onBattleStart static relics, so a clean slate is
    // correct; re-aggregating (over BOTH sides) would double-apply the player's
    // static modifiers, so we deliberately don't.
    e._manaGainBonus = {};
    e._skullDamageBonus = 0;
    e._attackPerManaRules = [];
    e._lastDynamicAttack = 0;

    // One-shot scene signal: rebuild the enemy portrait + skills pane. Carry the
    // form's portraitVideo (dropped by _cloneState) so a future video form works.
    this._enemyTransformed = {
      name: e.name,
      portrait: e.portrait,
      portraitVideo: form.portraitVideo || null,
      skills: e.skills,
    };
    return true;
  }

  /**
   * Death-transform board effect (Sanguine Egg relic, onDeath): when the Phoenix
   * is "killed" it does NOT die — it swaps into its DORMANT Egg form (a NORMAL,
   * killable low-HP enemy at its full floor-scaled HP, set by _transformInto) and
   * RETAINS the player's turn (a hidden extra turn). This starts the EGG PHASE:
   * the player has that one turn (extra turns included) to deal the Egg's HP in
   * damage. Slay it → victory (the normal enemy-death path); fail → at the
   * player's turn end the Egg reverts to a full-life Phoenix
   * (_resolveEggPhaseAtTurnEnd).
   *
   * @param {object} effect — { transform: { intoEnemyId, sound?, revertEnemyId?,
   *                            revertSound? } }
   * @param {object} payload — { side } (the dying side)
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyTransform(effect, payload) {
    const cfg = (effect && effect.transform) || {};
    if (!cfg.intoEnemyId || !this._transformInto(cfg.intoEnemyId)) return true;

    const e = this.enemyState;
    // Safety: the Egg never acts. In normal flow it never even gets an enemy turn
    // (the player keeps the turn, then the deadline fires at the player's turn end
    // and either the Egg is slain — victory — or it reverts to the Phoenix before
    // the enemy turn). _transformInto already gave the Egg its full floor-scaled
    // HP — it is a NORMAL, killable enemy now (no longer invulnerable).
    e._isDormantEgg = true;

    // Begin the egg phase (re-initialised every time, so a reborn Phoenix can be
    // re-killed into a fresh egg).
    this._eggPhaseActive = true;
    this._eggPhaseConfig = {
      revertEnemyId: cfg.revertEnemyId || 'sanguinePhoenix',
      revertSound: cfg.revertSound || null,
    };

    // The player KEEPS the turn after the killing blow (a "hidden" extra turn):
    // forcing _extraTurnEarned makes EVERY kill path retain the player's turn
    // instead of passing to the enemy — cascade skull-match kills (via
    // _finishResolving), instant skills like Bash, and targeted destroys — so the
    // player gets one turn (extra turns included) to slay the Egg.
    // _eggForcedExtraTurn suppresses the extra-turn log so it stays hidden.
    this._extraTurnEarned = true;
    this._eggForcedExtraTurn = true;

    if (cfg.sound) this._pendingTransformSfx = cfg.sound;
    this.log.add(`${e.name} emerges!`);
    return true;
  }

  /**
   * Egg-phase DEADLINE — called from _endTurn when the player ENDS their (retained)
   * turn with the egg phase still live. A slain Egg would already have ended the
   * battle (via _checkGameOver) before reaching here, so in practice the Egg
   * SURVIVED: it reverts to a full-life Sanguine Phoenix IN PLACE, then the caller
   * (_endTurn) proceeds normally so the reborn Phoenix takes its turn next. The
   * dead-Egg branch is a defensive guard only.
   */
  _resolveEggPhaseAtTurnEnd() {
    if (this.enemyState.hp <= 0 || this.enemyState._defeated) {
      // Defensive: the Egg was slain but victory wasn't declared — let normal flow
      // handle it; just clear the phase so the deadline never re-fires.
      this._endEggPhase();
      return;
    }

    const cfg = this._eggPhaseConfig || {};
    if (cfg.revertSound) this._pendingTransformSfx = cfg.revertSound;
    this._endEggPhase();
    this._transformInto(cfg.revertEnemyId || 'sanguinePhoenix');
    this.log.add(`${this.enemyState.name} hatches, reborn!`);
  }

  /** Clear all egg-phase state (on a slain Egg or a revert). Flags reset for any
   *  future cycle. */
  _endEggPhase() {
    this._eggPhaseActive = false;
    this._eggForcedExtraTurn = false;
    this._eggPhaseConfig = null;
  }

  /**
   * Re-deal the damage that just landed (Goresnout Collars: "when dealing
   * damage, deal the same damage again"). Triggered from onDealDamage, whose
   * payload carries the actual damage and the side that dealt it.
   *
   * This is an atomic (non-board) effect, but it lives here rather than in the
   * stateless EffectResolver because it needs the controller's reentrancy guard
   * (_echoDamageActive): the echo is dispatched as a FULL damage event
   * (_dispatchDamageEvent), so it re-fires onDealDamage and would otherwise
   * echo its own echo forever. The guard caps it at exactly one echo per hit.
   *
   * @param {object} effect — { echoDamage?: { multiplier } } (multiplier default 1)
   * @param {object} payload — onDealDamage payload { side, amount, target }
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyPassiveEchoDamage(effect, payload) {
    if (this._echoDamageActive) return true; // already echoing — stop recursion
    const baseAmount = (payload && typeof payload.amount === 'number') ? payload.amount : 0;
    if (baseAmount <= 0) return true;

    const mult = (effect && effect.echoDamage && typeof effect.echoDamage.multiplier === 'number')
      ? effect.echoDamage.multiplier
      : 1;
    const echoAmount = Math.max(0, Math.round(baseAmount * mult));
    if (echoAmount <= 0) return true;

    const attackerSide = payload.side;
    const targetSide = attackerSide === 'player' ? 'enemy' : 'player';
    const target = this._getStateBySide(targetSide);
    if (!target) return true;

    this._echoDamageActive = true;
    const r = this._applyDamage(target, echoAmount);
    if (r.actualDamage > 0) {
      this.log.add(`Goresnout Collars echoes ${r.actualDamage} damage to ${target.name}.`);
      this._setShakeFromDamage(r.actualDamage, target.maxHp);
      // Full damage event: re-fires onDealDamage (guarded above) + onTakeDamage.
      this._dispatchDamageEvent(attackerSide, targetSide, r);
    }
    this._echoDamageActive = false;
    return true;
  }

  // ── Poison ────────────────────────────────────────────
  //
  // Poison is a numeric STACK pool on a combatant (state.poison), distinct from
  // the duration-based status system. Stacks are applied to the opponent (by a
  // skill or relic); at the END of the applier's turn (_endTurn) the poisoned
  // side takes armor-piercing damage equal to the current stack count, then the
  // stacks are halved (floor). Application scales with Magic (skills) or equals
  // the skull damage dealt (Poison Vial relic). See decision #39.

  /**
   * Add `stacks` poison to `targetState` (rounded). No immediate damage — the
   * pool ticks at the applier's turn end.
   * @param {object} targetState
   * @param {number} stacks
   */
  _applyPoison(targetState, stacks) {
    const n = Math.round(stacks || 0);
    if (!targetState || n <= 0) return;
    targetState.poison = (targetState.poison || 0) + n;
    this.log.add(`${targetState.name} is poisoned (${targetState.poison} stacks).`);
  }

  /**
   * Relic-driven poison application (Poison Vial, onDealDamage). Applies poison
   * equal to the damage just dealt to the damaged side. Gated on `requireSkull`
   * so only SKULL damage poisons (payload.isSkull is set at the skull-damage
   * dispatch sites). Host-handled (like echo_damage) because it reads the
   * trigger payload's amount/target.
   * @param {object} effect  — { poison: { requireSkull? } }
   * @param {object} payload — onDealDamage { side, amount, target, isSkull }
   * @returns {boolean} always true (effect recognized/handled)
   */
  _applyPassivePoison(effect, payload) {
    const cfg = (effect && effect.poison) || {};
    if (cfg.requireSkull && !(payload && payload.isSkull)) return true;
    const dealt = (payload && typeof payload.amount === 'number') ? payload.amount : 0;
    if (dealt <= 0) return true;
    // Poison = floor(damage dealt × fraction). `fraction` defaults to 1.
    const fraction = (typeof cfg.fraction === 'number') ? cfg.fraction : 1;
    const stacks = Math.floor(dealt * fraction);
    if (stacks <= 0) return true;
    const targetSide = (payload && payload.target)
      || (payload && payload.side === 'player' ? 'enemy' : 'player');
    this._applyPoison(this._getStateBySide(targetSide), stacks);
    return true;
  }

  /**
   * Tick the poison on `targetSide`: deal armor-piercing damage equal to the
   * stack count (bypasses _applyDamage so armor/barrier don't absorb it), then
   * halve the stacks. Called from _endTurn for the side that just acted's
   * opponent (poison ticks at the APPLIER's turn end). Can be lethal — the
   * caller re-checks game over.
   * @param {'player'|'enemy'} targetSide
   */
  _tickPoison(targetSide) {
    const t = this._getStateBySide(targetSide);
    if (!t || !t.poison || t.poison <= 0) return;

    // Poison is NO LONGER armor-piercing — route through the resolver so the
    // poisoned side's barrier → armor → block absorb it like any other damage.
    const r = this.resolver.applyDamage(t, t.poison);
    if (t.hp <= 0) t._defeated = true;
    if (r.actualDamage > 0) {
      this.log.add(`${t.name} takes ${r.actualDamage} poison damage.`);
      this._setShakeFromDamage(r.actualDamage, t.maxHp);
      // Green floating "-N" over the portrait (kind 'poison' → green in BattleScene).
      this._emitFloatingStat(targetSide, 'poison', r.actualDamage);
    }
    // Stacks halve (rounded down) after ticking — even if armor absorbed the hit.
    t.poison = Math.floor(t.poison / 2);
  }

  /**
   * Merge a set of cells into the in-flight cascade step's analysis so they
   * are highlighted, removed, and award mana / skull-damage via the normal
   * SHOW_MATCH → REMOVE flow. Skips cells already in the analysis and empty
   * cells; clamps to the board. Shared by radius / row passive board effects.
   * @param {Array<{col:number,row:number}>} cells
   */
  _addCellsToAnalysis(cells) {
    if (!this._analysis || !cells || cells.length === 0) return;
    const existing = new Set(this._analysis.positions.map(p => `${p.col},${p.row}`));
    const extras = [];
    for (const c of cells) {
      if (c.col < 0 || c.col >= this.board.cols || c.row < 0 || c.row >= this.board.rows) continue;
      const key = `${c.col},${c.row}`;
      if (existing.has(key)) continue;
      if (!this.board.get(c.col, c.row)) continue;
      extras.push({ col: c.col, row: c.row });
      existing.add(key);
    }
    if (extras.length === 0) return;

    // Compute rewards from the extra cells via the shared path so mana
    // and skull damage match what destroy_tiles skills would award.
    const attacker = this._activeState();
    const extraRewards = this.resolver.resolveDestroyedTileRewards(this.board, extras, attacker);

    this._analysis.positions.push(...extras);
    this._analysis.tilesDestroyed = (this._analysis.tilesDestroyed || 0) + extras.length;
    this._analysis.skullDamage = (this._analysis.skullDamage || 0) + extraRewards.skullDamage;
    if (!this._analysis.mana) this._analysis.mana = {};
    for (const [color, count] of Object.entries(extraRewards.mana)) {
      this._analysis.mana[color] = (this._analysis.mana[color] || 0) + count;
    }
  }

  /**
   * Drain any pending Deathbringer skull destructions by starting a
   * follow-up resolution: remove up to N random skull tiles (which deal
   * destroyed-skull damage to the opponent), then let the board collapse +
   * cascade through the normal phase machine. The destruction's damage fires
   * onDealDamage, but the once-per-action guard (_deathbringerFiredThisAction)
   * stops it from re-triggering Deathbringer and looping.
   *
   * @returns {boolean} true if a follow-up resolution was started (caller
   *   should treat the action as still resolving and not end the turn)
   */
  _maybeStartPendingSkullDestroy() {
    const n = this._pendingSkullDestroy;
    this._pendingSkullDestroy = 0;
    if (n <= 0) return false;

    const skulls = this.board.getTilesOfType('skull');
    if (skulls.length === 0) return false;

    const chosen = BoardModel.pickRandomTiles(skulls, n);
    if (chosen.length === 0) return false;

    this.log.add(`Deathbringer destroys ${chosen.length} skull(s).`);

    // Compute destroyed-skull damage via the shared reward path (same formula
    // as destroy_tiles skills). Skulls award no mana. _doRemove applies the
    // skullDamage + dispatches onDealDamage/onTakeDamage when this step runs.
    const rewards = this.resolver.resolveDestroyedTileRewards(this.board, chosen, this._activeState());

    // Synthetic single-step analysis: skull damage only, no mana.
    this._analysis = {
      matches: [],
      positions: [...chosen],
      mana: {},
      skullDamage: rewards.skullDamage,
      extraTurnTrigger: false,
      tilesDestroyed: chosen.length,
    };
    this.state = BattleState.RESOLVING;
    this._doRemove();
    if (this.onStateChange) this.onStateChange();
    return true;
  }

  // ── Screen Shake ──────────────────────────────────────

  /**
   * Compute screen-shake intensity from damage dealt and set the
   * pending shake value. Scales linearly from 0 at 0% to 1.0 at
   * 20%+ of the target's max HP.
   * @param {number} actualDamage
   * @param {number} targetMaxHp
   */
  _setShakeFromDamage(actualDamage, targetMaxHp) {
    if (!targetMaxHp || actualDamage <= 0) return;
    const percent = actualDamage / targetMaxHp;
    const intensity = Math.min(1.0, percent / 0.20);
    // Keep the highest intensity if multiple damage events occur
    // before the scene reads it.
    if (intensity > this._pendingShakeIntensity) {
      this._pendingShakeIntensity = intensity;
    }
  }

  // ── Board Position ────────────────────────────────────

  screenToBoard(px, py, boardW, boardH) {
    const cw = boardW / this.board.cols;
    const ch = boardH / this.board.rows;
    const col = Math.floor(px / cw);
    const row = Math.floor(py / ch);
    if (col < 0 || col >= this.board.cols || row < 0 || row >= this.board.rows) return null;
    return { col, row };
  }
}
