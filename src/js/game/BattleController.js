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
import { TILE_TYPES, isSkull } from './TileTypes.js';
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
/** Turn intro animation delay in ms (NOT scaled — presentation timing) */
const TURN_INTRO_DURATION = 600;

export default class BattleController {
  constructor(playerData, enemyData) {
    this.board = new BoardModel();
    this.resolver = new MatchResolver();
    this.log = new CombatLog();

    this.playerState = this._cloneState(playerData);
    this.enemyState = this._cloneState(enemyData);

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
        const target = info.side === 'target' ? this._currentRelicTarget : null;
        if (target) {
          this._setShakeFromDamage(info.actualDamage, target.maxHp);
        }
      },
      onExtraTurn: () => { this._extraTurnEarned = true; },
      // Board-touching passive effects (e.g. destroy_tiles_radius from
      // Unstable Catalyst) are routed here so the cascade phase machine
      // stays in charge of board mutations.
      onBoardEffect: (effect, triggerName, payload, ctx) =>
        this._handlePassiveBoardEffect(effect, triggerName, payload, ctx),
    });
    /** Set during a relic dispatch so onDamage can reference the right side. */
    this._currentRelicTarget = null;

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
    if (analysis.mana) {
      for (const color of Object.keys(analysis.mana)) {
        const b = manaBonus[color] || 0;
        if (b > 0 && analysis.mana[color] > 0) {
          analysis.mana[color] += b;
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
      hp: d.hp, maxHp: d.maxHp, attack: d.attack, armor: d.armor, block: 0,
      mana: d.mana ? { ...d.mana } : {},
      portrait: d.portrait || '',
      skills: (d.skills || []).map(s => ({ ...s })),
      // Clone relics + their effect arrays so per-battle mutations
      // (e.g. consumed/charged relics in the future) don't leak back
      // into the catalog or the persistent run state.
      relics: (d.relics || []).map(r => ({
        ...r,
        effects: (r.effects || []).map(e => ({ ...e })),
      })),
      // Preserve custom AI behavior key from enemy definition (if any)
      aiBehavior: d.aiBehavior || null,
    };
  }

  // ── Timing Helpers ────────────────────────────────────

  _phaseMs(phase) { return BASE_PHASE_MS[phase] / this.speedMultiplier; }
  _enemyDelay()    { return ENEMY_BASE_DELAY / this.speedMultiplier; }
  _swapDuration()  { return SWAP_BASE_DURATION / this.speedMultiplier; }

  // ── Public API ────────────────────────────────────────

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

    return {
      state: this.state, activeSide: this.activeSide,
      playerState: this.playerState, enemyState: this.enemyState,
      board: this.board, log: this.log,
      pendingExtraTurn: this.pendingExtraTurn,
      extraTurnTriggerPos: triggerPos,
      matchTextTriggers,
      shakeIntensity,
      skullDamageDealt,
      turnAnnouncement,
      destroyedTiles,
      convertedTiles,
      pendingSkillSound,
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
    if (this.playerState.hp <= 0) return 'enemy';
    if (this.enemyState.hp <= 0) return 'player';
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
    if (!this._affordable(this.playerState, skill)) {
      this.log.add(`Not enough mana for ${skill.name}.`);
      return false;
    }

    // Skills that require board targeting enter TARGETING state first
    if (skill.targeting === 'board_tile') {
      this.state = BattleState.TARGETING;
      this._targetingSkill = { ...skill };
      this._targetHoverCell = null;
      this._targetingOverlayCells = [];
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

    // If an EXTRA_TURN effect was resolved, stay on the same side
    if (this._extraTurnEarned) {
      this._extraTurnEarned = false;
      this.pendingExtraTurn = true;
      this.log.add('--- Extra Turn (Player) ---');
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
    this._targetHoverCell = null;
    this._targetingOverlayCells = [];
    if (this.onStateChange) this.onStateChange();
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
          this._executeDestroyTiles(area, col, row, skill.name);
          enteredCascade = true;
          break;
        case SKILL_EFFECT_TYPES.CONVERT_TILE:
          if (this._executeConvertTile(area, effect, skill.name)) {
            enteredCascade = true;
          }
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
      this.log.add('--- Extra Turn (Player) ---');
      if (this.onStateChange) this.onStateChange();
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

    // Row-based targeting (DESTROY_TILES_ROW): area is a number (1, 3, 5, ...)
    // representing the total number of rows affected centered on the hovered row.
    if (typeof skill.area === 'number') {
      return this._computeRowArea(col, row, skill.area);
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

    // 2. Award mana from colored gems
    for (const [color, count] of Object.entries(rewards.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana from destroyed gems.`);
        this._dispatchManaGain(this.activeSide, color, count);
      }
    }

    // 3. Deal skull damage
    if (rewards.skullDamage > 0) {
      const r = this._applyDamage(targetState, rewards.skullDamage);
      this.log.add(`Destroyed skulls deal ${r.actualDamage} damage to ${targetState.name}.`);
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      this._dispatchDamageEvent(
        this.activeSide,
        this.activeSide === 'player' ? 'enemy' : 'player',
        r
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
    let causePos = null;
    if (analysis.extraTurnTrigger) {
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
      const r = this._applyDamage(targetState, a.skullDamage);
      this.log.add(`Skull damage: ${r.actualDamage} dealt.`);
      // Trigger screen shake scaled by damage % of target's max HP
      this._setShakeFromDamage(r.actualDamage, targetState.maxHp);
      this._skullDamageCount++;
      this._dispatchDamageEvent(
        this.activeSide,
        this.activeSide === 'player' ? 'enemy' : 'player',
        r
      );
      // Check for immediate game over — stop cascade if target died
      if (this._checkGameOver()) return;
    }

    for (const [color, count] of Object.entries(a.mana)) {
      if (count > 0) {
        activeState.mana[color] = (activeState.mana[color] || 0) + count;
        this.log.add(`${activeState.name} gains ${count} ${color} mana.`);
        this._dispatchManaGain(this.activeSide, color, count);
      }
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

    if (this._extraTurnEarned) {
      this.pendingExtraTurn = true;
      // extraTurnTriggerPos was already set in _enterShowMatch — the
      // scene is already animating the effect concurrently with cascades.
      this.log.add(`${this._activeState().name} gets an extra turn!`);
      this._extraTurnEarned = false;
    }

    this._analysis = null;
    this._allSteps = [];
    this.highlightCells = [];
    this.emptyCells = [];
    this.fallCells = [];
    this._previousEmptyCells = null;

    if (this._checkGameOver()) return;

    if (this.pendingExtraTurn) {
      this._phaseTimer = 0;
      this._enemyFired = false;
      // Extra turn = new action: re-arm Deathbringer's once-per-action guard
      // (extra turns bypass _completeTurnIntro).
      this._deathbringerFiredThisAction = false;
      if (this.activeSide === 'player') {
        this.state = BattleState.PLAYER_TURN;
        this.log.add('--- Extra Turn (Player) ---');
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
    // Dispatch onTurnEnd BEFORE we mutate state for the next turn so
    // relic effects see the correct active-side context.
    this.passives.dispatch(TRIGGER_TYPES.ON_TURN_END, { side });

    this.pendingExtraTurn = false;
    this._swapTriggerPos = null;
    // Enter turn-intro animation before the actual turn begins.
    // The scene reads _turnAnnouncement to spawn the appropriate
    // floating image effect (Player Turn / Enemy Turn).
    const nextSide = side === 'player' ? 'enemy' : 'player';
    this.state = BattleState.TURN_INTRO;
    this._turnAnnouncement = nextSide;
    this._nextTurnSide = nextSide;
    this._turnIntroTimer = 0;
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

    // Dispatch onTurnStart AFTER state is set so relic effects can
    // observe the active side correctly.
    this.passives.dispatch(TRIGGER_TYPES.ON_TURN_START, { side });

    if (this.onStateChange) this.onStateChange();
  }

  _activeState() {
    return this.activeSide === 'player' ? this.playerState : this.enemyState;
  }
  _opponentState() {
    return this.activeSide === 'player' ? this.enemyState : this.playerState;
  }

  // ── Update ────────────────────────────────────────────

  update(dt) {
    // Keep dynamic attack (Group A: +attack per unspent mana) in sync with
    // the current mana pools each frame. Idempotent (delta-based).
    this._recomputeDynamicAttack(this.playerState);
    this._recomputeDynamicAttack(this.enemyState);

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
      this._turnIntroTimer += dt;
      if (this._turnIntroTimer >= TURN_INTRO_DURATION) {
        this._completeTurnIntro();
      }
    }

    // ── Enemy turn delay ──
    if (this.state === BattleState.ENEMY_TURN && !this._enemyFired) {
      this._enemyTimer += dt;
      if (this._enemyTimer >= this._enemyDelay()) {
        this._enemyFired = true;
        this._doEnemyTurn();
      }
    }
  }

  // ── Enemy ─────────────────────────────────────────────

  _doEnemyTurn() {
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
        this._extraTurnEarned = false;
        this.pendingExtraTurn = true;
        this.log.add('--- Extra Turn (Enemy) ---');
        if (this.onStateChange) this.onStateChange();
        return;
      }

      this._endTurn('enemy');
      return;
    }

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
        this._extraTurnEarned = false;
        this.pendingExtraTurn = true;
        this.log.add('--- Extra Turn (Enemy) ---');
        if (this.onStateChange) this.onStateChange();
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
        const amount = (effect.damage && typeof effect.damage.amount === 'number')
          ? effect.damage.amount
          : (src.attack || 1);
        const r = this._applyDamage(tgt, amount);
        this.log.add(`${src.name} deals ${r.actualDamage} damage to ${tgt.name}.`);
        this._setShakeFromDamage(r.actualDamage, tgt.maxHp);
        this._dispatchDamageEvent(side, side === 'player' ? 'enemy' : 'player', r);
        return false;
      }

      case SKILL_EFFECT_TYPES.ARMOR: {
        const amount = (effect.armor && typeof effect.armor.amount === 'number')
          ? effect.armor.amount
          : (src.attack || 1);
        src.armor += amount;
        this.log.add(`${src.name} gains ${amount} armor.`);
        return false;
      }

      case SKILL_EFFECT_TYPES.HEAL: {
        const amount = (effect.heal && typeof effect.heal.amount === 'number')
          ? effect.heal.amount
          : 0;
        if (amount <= 0) {
          this.log.add(`${skill.name} has no heal amount configured.`);
          return false;
        }
        const beforeHp = src.hp;
        src.hp = Math.min(src.maxHp, src.hp + amount);
        const actualHeal = src.hp - beforeHp;
        this.log.add(`${src.name} heals for ${actualHeal} HP.`);
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

      case SKILL_EFFECT_TYPES.EXTRA_TURN: {
        this._extraTurnEarned = true;
        this.log.add(`${src.name} gains an extra turn!`);
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

      default:
        console.warn(`[BattleController] Unknown effect type: "${effect.effectType}". Skipping.`);
        return false;
    }
  }

  // ── Game Over ────────────────────────────────────────

  _checkGameOver() {
    if (this.playerState.hp <= 0) {
      this.state = BattleState.GAME_OVER;
      this.log.add(`${this.playerState.name} has been defeated...`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    if (this.enemyState.hp <= 0) {
      this.state = BattleState.GAME_OVER;
      this.log.add(`Victory! ${this.enemyState.name} has been slain!`);
      if (this.onStateChange) this.onStateChange();
      return true;
    }
    return false;
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
  _applyDamage(target, amount) {
    const side = target === this.playerState ? 'player' : 'enemy';
    const payload = { side, amount };
    // Set _currentRelicTarget so any onDamage-style hooks fired during
    // dispatch can reference the side being damaged. Cleared after.
    const prevRelicTarget = this._currentRelicTarget;
    this._currentRelicTarget = target;
    this.passives.dispatch(TRIGGER_TYPES.ON_INCOMING_DAMAGE, payload);
    this._currentRelicTarget = prevRelicTarget;
    const finalAmount = Math.max(0, payload.amount | 0);
    return this.resolver.applyDamage(target, finalAmount);
  }

  /**
   * Dispatch onTakeDamage / onDealDamage passive triggers if any damage
   * landed (actualDamage > 0). Safe to call after every applyDamage call.
   *
   * @param {'player'|'enemy'} attackerSide
   * @param {'player'|'enemy'} targetSide
   * @param {{actualDamage:number, blocked:number, armorDamage:number}} result
   */
  _dispatchDamageEvent(attackerSide, targetSide, result) {
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
   * Only the primary gameplay mana-gain sites (cascade match rewards in
   * _doRemove and skill tile-destruction rewards in _executeDestroyTiles)
   * call this — starting mana (Potions) and relic-granted bonus mana
   * (Familiars, Prism) intentionally do not, to avoid passive chaining.
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
