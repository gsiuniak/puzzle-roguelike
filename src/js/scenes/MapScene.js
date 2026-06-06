/**
 * MapScene — the roguelike map traversal scene.
 *
 * Lives between character select and battle encounters.
 *
 * Responsibilities:
 *   - Generate (or load) a MapGraph via MapGenerator
 *   - Manage traversal state via MapTraversalController
 *   - Handle click input for node selection and movement
 *   - Transition to BattleScene when a combat node is selected
 *
 * All visual rendering is delegated to MapView (shared with BattleScene overlay).
 *
 * Extends UIPanel to fit the existing scene architecture.
 *
 * Lifecycle:
 *   onEnter()  — generate map, wire input, create MapView
 *   update(dt) — advance animations, update hover
 *   render(ctx) — delegate to MapView.renderFullscreen()
 *   onExit()   — tear down input
 */

import UIPanel from '../ui/UIPanel.js';
import MapGenerator from '../map/MapGenerator.js';
import MapGraph from '../map/MapGraph.js';
import MapTraversalController from '../map/MapTraversalController.js';
import MapRenderer from '../map/MapRenderer.js';
import MapView from '../map/MapView.js';
import AudioManager from '../audio/AudioManager.js';
import BattleController from '../game/BattleController.js';
import BattleScene from '../ui/BattleScene.js';
import { selectEnemyForNode, markEnemySeen } from '../data/enemies/index.js';
import { createPlayerBattleState, syncBattleResultsToRunState } from '../data/playerStats.js';
import { createRunState } from '../data/runState.js';
import { resolveSkillIds } from '../data/skills/skillCatalog.js';
import { resolveEnemyRelicIds } from '../data/relics/enemyRelicCatalog.js';

// ── Per-floor enemy HP scaling ───────────────────────────
// Enemy `maxHp` in the data files is a FLOOR-1-EQUIVALENT baseline. At spawn it is
// multiplied by this per-depth factor so a given enemy stays appropriately tough
// as the player's power grows over the act. The curve is the measured player-DPT
// ratio from the sim (sim/out/power.json: DPT[floor] / DPT[floor1]); enemy HP is
// budgeted as playerDPT × targetTurns, so HP tracks DPT. Regenerate with
// `node sim/run-power.mjs` if the growth/relic model changes.
// Index = node.depth (0-indexed; depth 0 = floor 1).
const ENEMY_HP_FLOOR_MULT = [1.0, 1.18, 1.53, 1.71, 2.18, 2.47, 3.06, 3.47, 4.18, 4.65];

/** Per-floor HP multiplier for a 0-indexed map depth (clamps past the last floor). */
function enemyHpFloorMult(depth) {
  const d = Math.max(0, depth | 0);
  return ENEMY_HP_FLOOR_MULT[Math.min(d, ENEMY_HP_FLOOR_MULT.length - 1)];
}

export default class MapScene extends UIPanel {
  constructor() {
    super();

    // ── Map system references ──────────────────────────
    /** @type {MapGraph|null} */
    this._graph = null;
    /** @type {MapTraversalController|null} */
    this._traversal = null;
    /** @type {MapRenderer|null} */
    this._renderer = null;
    /** @type {MapView|null} */
    this._mapView = null;

    // ── Seed ───────────────────────────────────────────
    /** @type {string} current run seed */
    this._seed = '';

    // ── Layout cache ────────────────────────────────────
    this._canvasW = 0;
    this._canvasH = 0;

    // ── Input handler references ────────────────────────
    /** @type {Function|null} */
    this._onMouseDown = null;
    /** @type {Function|null} */
    this._onMouseMove = null;
    /** @type {Function|null} */
    this._onKeyDown = null;

    // ── Shared services ────────────────────────────────
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = null;
    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;

    // ── Run state and character definition (persist between battles) ─
    /** @type {object|null} immutable character definition */
    this._characterDef = null;
    /** @type {object|null} player run state with statModifiers and currentHp */
    this._runState = null;

    // ── Transition flag ────────────────────────────────
    this._transitioning = false;

    // ── Saved state for battle return ──────────────────
    /** @type {object|null} serialized traversal state to restore on return */
    this._savedTraversalState = null;
  }

  // ═══════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════

  /** Called by SceneManager when this scene becomes active */
  onEnter() {
    const sm = this._sceneManager;
    if (!sm) return;

    this._assetManager = sm.assetManager;

    // ── Returning from battle? ──────────────────────
    // MapScene is a singleton — the graph, renderer, mapView, and traversal
    // controller all survive the scene switch.  When coming back from a
    // battle we just need to advance the traversal state and re-wire input,
    // NOT regenerate the entire map from scratch.
    if (this._savedTraversalState) {
      const saved = this._savedTraversalState;
      this._savedTraversalState = null;

      // Complete the battle node and reveal next depth
      if (saved._needsCompleteAndReveal) {
        this._traversal.completeCurrentAndRevealNext();
        console.log('[MapScene] Current node completed, next depth revealed.');
      }

      console.log('[MapScene] Reusing existing map state (return from battle).');
    } else {
      // ── Fresh entry (from character select) ───────
      // Generate a seed if not set (can be overridden before onEnter)
      if (!this._seed) {
        this._seed = String(Date.now());
      }

      // Generate the map graph (deterministic from seed)
      console.log(`[MapScene] Generating map with seed: "${this._seed}"`);
      this._graph = MapGenerator.generate(this._seed);

      // Create the traversal controller
      this._traversal = new MapTraversalController(this._graph);

      // Create the renderer
      this._renderer = new MapRenderer({ assetManager: this._assetManager });
      this._renderer.setGraph(this._graph);
      this._renderer.setTraversal(this._traversal);

      // Create the reusable MapView (shared rendering with BattleScene overlay)
      this._mapView = new MapView({
        graph: this._graph,
        traversal: this._traversal,
        renderer: this._renderer,
        assetManager: this._assetManager,
      });

      console.log(`[MapScene] Map ready — ${this._graph.size} nodes, ${this._graph.depthCount} depths.`);
    }

    // Cache canvas dimensions
    this._canvasW = sm._app.width;
    this._canvasH = sm._app.height;

    // ── Music ────────────────────────────────────────
    // MapScene does not start music — it keeps whatever
    // is currently playing (or silence if nothing is).
    // In persistent battle music mode, ensure normal battle
    // music is playing at the reduced background volume.
    AudioManager.onRewardsOrMapEntered();

    // ── Wire input ────────────────────────────────────
    this._transitioning = false;

    const input = sm._input;
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onKeyDown = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.canvas.addEventListener('keydown', this._onKeyDown);
    input.canvas.focus();
  }

  /** Called by SceneManager when leaving this scene */
  onExit() {
    const sm = this._sceneManager;
    if (!sm) return;

    const input = sm._input;
    if (this._onMouseDown) {
      input.off('mousedown', this._onMouseDown);
      this._onMouseDown = null;
    }
    if (this._onMouseMove) {
      input.off('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Seed control (call before onEnter to set a specific seed)
  // ═══════════════════════════════════════════════════════

  /**
   * Set the seed to use for map generation.
   * Must be called before the scene is entered.
   * @param {string} seed
   */
  setSeed(seed) {
    this._seed = seed;
  }

  /**
   * Reset all map/traversal state for a brand-new run. Called by
   * CharacterSelectScene when a hero is chosen so the next `onEnter`
   * regenerates a fresh map from the new seed instead of taking the
   * "return from battle" fast path.
   *
   * This matters because `_transitionToBattle` stashes `_savedTraversalState`
   * up front, but a run that ends in DEFEAT routes to GameOverScene and never
   * runs `_handleBattleComplete`/`_returnToMap` — so that saved state would
   * otherwise linger and the next run would reuse the old map, position, and
   * revealed nodes. (Run-state/HP is replaced separately via setRunState.)
   */
  resetForNewRun() {
    this._savedTraversalState = null;
    this._graph = null;
    this._traversal = null;
    this._renderer = null;
    this._mapView = null;
    this._seed = '';
    this._transitioning = false;
  }

  /**
   * Set the run state and optionally the character definition.
   * Stores both the immutable character def and the persistent run state.
   * When characterDef is null/undefined, the existing _characterDef is preserved.
   * @param {object} runState — created by createRunState()
   * @param {object|null} characterDef — immutable character definition from data/characters/
   */
  setRunState(runState, characterDef) {
    this._runState = runState;
    if (characterDef) {
      this._characterDef = characterDef;
    }
  }

  /**
   * Set the player character data from post-battle healing.
   * Updates runState.currentHp from the healed value.
   * @param {object} healedData — { hp, ... } from BattleScene
   */
  setPlayerData(healedData) {
    if (this._runState && typeof healedData.hp === 'number') {
      this._runState.currentHp = healedData.hp;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Input
  // ═══════════════════════════════════════════════════════

  /**
   * @param {number} x — canvas-space mouse X
   * @param {number} y — canvas-space mouse Y
   */
  _handleMouseDown(x, y) {
    if (this._transitioning) return;
    if (!this._mapView || !this._traversal) return;

    // MapView.hitTest handles container-offset internally
    const hit = this._mapView.hitTest(this._canvasW, this._canvasH, x, y);
    if (!hit) return;

    // Allow clicking on the current node (to start/resume its encounter)
    if (hit.state.current) {
      console.log(`[MapScene] Entering current node: ${hit.id} (type: ${hit.type}, depth: ${hit.depth})`);
      AudioManager.playSfx('sfx_map_click_node');
      this._onNodeEntered(hit);
      return;
    }

    // Only allow clicking on reachable nodes
    if (!hit.state.reachable) return;

    // Move to the node
    const success = this._traversal.moveTo(hit.id);
    if (!success) return;

    console.log(`[MapScene] Moved to node: ${hit.id} (type: ${hit.type}, depth: ${hit.depth})`);

    // Play node select sound
    AudioManager.playSfx('sfx_map_click_node');

    // Handle node type
    this._onNodeEntered(hit);
  }

  /**
   * @param {number} x — canvas-space mouse X
   * @param {number} y — canvas-space mouse Y
   */
  _handleMouseMove(x, y) {
    if (!this._mapView) return;
    this._mapView.updateHover(this._canvasW, this._canvasH, x, y);
  }

  /**
   * @param {KeyboardEvent} e
   */
  _handleKeyDown(e) {
    if (this._transitioning) return;

    if (e.key === 'Escape') {
      // Could add pause menu here
      return;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Node entry handling
  // ═══════════════════════════════════════════════════════

  /**
   * Called when the player enters (moves to) a node.
   * Handles different node types.
   * @param {import('../map/MapNode.js').default} node
   */
  _onNodeEntered(node) {
    switch (node.type) {
      case 'battle':
        this._transitionToBattle(node);
        break;

      case 'elite':
        // For now, elite nodes route to battle (enemy scaled up)
        this._transitionToBattle(node);
        break;

      case 'boss':
        this._transitionToBattle(node);
        break;

      case 'rest':
        // Future: trigger rest scene / healing
        console.log('[MapScene] Rest node entered — healing (placeholder)');
        // For now, route to Goblin battle for testing
        if (window.__DEBUG_MODE) {
          console.log('[MapScene] DEBUG: routing rest node to Goblin battle for testing.');
          this._transitionToBattle(node);
        }
        break;

      case 'chest':
        // Future: trigger chest reward
        console.log('[MapScene] Chest node entered — reward (placeholder)');
        if (window.__DEBUG_MODE) {
          console.log('[MapScene] DEBUG: routing chest node to Goblin battle for testing.');
          this._transitionToBattle(node);
        }
        break;

      case 'training':
        // Future: trigger training scene
        console.log('[MapScene] Training node entered — upgrade (placeholder)');
        if (window.__DEBUG_MODE) {
          console.log('[MapScene] DEBUG: routing training node to Goblin battle for testing.');
          this._transitionToBattle(node);
        }
        break;

      default:
        console.warn(`[MapScene] Unknown node type: ${node.type}`);
        break;
    }
  }

  /**
   * Transition to the BattleScene for combat nodes.
   * @param {import('../map/MapNode.js').default} node
   */
  _transitionToBattle(node) {
    if (this._transitioning) return;
    this._transitioning = true;

    const sm = this._sceneManager;
    if (!sm) return;

    // Save traversal state so we can restore on return
    if (this._traversal) {
      this._savedTraversalState = this._traversal.serialize();
    }

    // Ensure we have a run state and character def
    if (!this._runState || !this._characterDef) {
      this._initDefaultRunState();
    }

    // Create a fresh player battle state from effective stats + persistent HP
    const playerBattleState = createPlayerBattleState(this._characterDef, this._runState);

    // Select the enemy for this node based on its act (depth) and the enemy
    // type the node calls for (battle→minion, elite→elite, boss→boss).
    // `seenEnemiesByAct` steers the selector away from enemies already fought
    // this act (ideally each is seen at most once per act). The selector
    // returns a shared catalog reference, so deep-clone before use.
    const enemyDef = selectEnemyForNode({
      depth: node.depth,
      nodeType: node.type,
      seenByAct: this._runState.seenEnemiesByAct,
    });
    // Record the pick so later nodes this act avoid repeating it.
    markEnemySeen(this._runState, enemyDef);
    const enemyData = JSON.parse(JSON.stringify(enemyDef));

    // Per-floor HP scaling: enemy maxHp in data is a floor-1-equivalent baseline;
    // scale it up by depth so it tracks the player's growing power (see
    // ENEMY_HP_FLOOR_MULT). Attack is NOT auto-scaled (lethality is sharp — it's
    // authored per enemy + roster floor-gating provides the attack ramp).
    const hpMult = enemyHpFloorMult(node.depth);
    enemyData.maxHp = Math.round((enemyData.maxHp || 1) * hpMult);
    enemyData.hp = enemyData.maxHp;

    // Resolve enemy skill/relic IDs into full objects via the catalogs.
    // Characters/enemies store IDs; the BattleController operates on resolved
    // objects. Enemy relics resolve against the ENEMY-ONLY relic pool.
    enemyData.skills = resolveSkillIds(enemyData.skills || []);
    enemyData.relics = resolveEnemyRelicIds(enemyData.relics || []);

    // Create battle controller and scene
    const battleController = new BattleController(
      JSON.parse(JSON.stringify(playerBattleState)),
      enemyData
    );

    const battleScene = new BattleScene(
      playerBattleState,
      enemyData,
      this._assetManager,
      battleController
    );
    battleScene.setAudioManager(sm.audioManager);

    // Store map context for battle scene (seed for regeneration + node tracking)
    // Also pass music metadata so BattleScene can use the correct track.
    const music = enemyData.music || {
      trackKey: 'battle_theme',
      persistAfterBattle: true,
      isSpecialTrack: false,
    };
    battleScene.userData = {
      mapSeed: this._seed,
      runState: this._runState,
      nodeId: node.id,
      nodeType: node.type,
      nodeDepth: node.depth,
      music,
    };

    // Wire onBattleComplete callback so BattleScene reports back
    // without needing to know about MapScene internals.
    battleScene._onBattleComplete = (result) => {
      this._handleBattleComplete(result);
    };

    // Register and fade transition to battle
    sm.registerScene('BattleScene', battleScene);
    sm.fadeToScene('BattleScene', 400);
  }

  /**
   * Handle battle completion callback from BattleScene.
   * Called BEFORE the scene transition back to MapScene (so MapScene
   * may still be inactive).  Updates the serialized traversal state
   * in-place so that when onEnter fires and regenerates the graph,
   * the battle node is already marked completed and the next nodes
   * are reachable.
   * @param {{result:string, nodeId:string}} result
   */
  _handleBattleComplete(result) {
    console.log(`[MapScene] Battle complete — result: ${result.result}, node: ${result.nodeId}`);

    if (!this._savedTraversalState) {
      console.warn('[MapScene] No saved traversal state to update on battle completion.');
      return;
    }

    const saved = this._savedTraversalState;

    // The saved state has the battle node as 'current'.
    // When MapScene.onEnter restores and calls completeCurrentAndRevealNext(),
    // it will mark the current node as completed and reveal outgoing nodes.
    // We don't need to modify the saved state here — the graph will be
    // regenerated in onEnter, and completeCurrentAndRevealNext operates on
    // the regenerated graph's node references.
    //
    // We store a flag to ensure onEnter calls completeCurrentAndRevealNext.
    saved._needsCompleteAndReveal = true;

    // Save the updated state back
    this._savedTraversalState = saved;
  }

  /**
   * Initialize a default run state and character def if none was set.
   * Used as a fallback when MapScene is entered without character select
   * (e.g., during development/testing).
   */
  _initDefaultRunState() {
    const defaultDef = {
      id: 'warrior',
      name: 'Adventurer',
      className: 'Warrior',
      level: 1,
      portrait: 'warrior',
      baseStats: {
        maxHp: 30,
        startingAttack: 1,
        startingArmor: 0,
        startingMana: { red: 0, blue: 5, green: 0, yellow: 0, purple: 0 },
      },
      skills: [],
      relics: [],
      description: 'A brave adventurer.',
    };
    this._characterDef = defaultDef;
    this._runState = createRunState(defaultDef);
  }

  // ═══════════════════════════════════════════════════════
  // Update
  // ═══════════════════════════════════════════════════════

  /** @param {number} dt — delta time in ms */
  update(dt) {
    const sm = this._sceneManager;
    if (!sm) return;

    // Update canvas dims
    this._canvasW = sm._app.width;
    this._canvasH = sm._app.height;

    super.update(dt);
  }

  // ═══════════════════════════════════════════════════════
  // Render — delegated to MapView
  // ═══════════════════════════════════════════════════════

  /**
   * Paint the battle_background_default + dark backdrop across the entire
   * physical canvas (covers letterbox/pillarbox bars). The map container,
   * parchment splash, and node graph stay inside the design viewport via
   * render() → MapView.renderFullscreen().
   */
  renderBackground(_ctx) {
    const sm = this._sceneManager;
    const am = this._assetManager;
    if (!sm || !am) return;
    const bgImg = am.get('battle_background_default');
    if (bgImg) sm._app.drawFullCanvasImage(bgImg, 1.0);
    sm._app.fillFullCanvas('rgba(0, 0, 0, 0.75)');
  }

  /**
   * Override render to use MapView for all visual output.
   * MapView provides the identical map screen whether rendered
   * standalone (here) or as a battle overlay (BattleScene).
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;

    const dt = 16; // ~60fps animation base

    if (this._mapView) {
      this._mapView.renderFullscreen(ctx, this._canvasW, this._canvasH, dt);
    }

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }
}
