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
import mockEnemy from '../data/mockEnemy.js';
import { createPlayerBattleState, syncBattleResultsToRunState } from '../data/playerStats.js';
import { createRunState } from '../data/runState.js';

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
   * Set the run state and optionally the character definition.
   * Stores both the immutable character def and the persistent run state.
   * When characterDef is null/undefined, the existing _characterDef is preserved.
   * @param {object} runState — created by createRunState()
   * @param {object|null} characterDef — immutable character definition from mockCharacter.js
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

    const enemyData = JSON.parse(JSON.stringify(mockEnemy));

    // Scale enemy difficulty based on depth and node type
    if (node.type === 'elite') {
      enemyData.hp = Math.floor(enemyData.hp * 1.5);
      enemyData.maxHp = enemyData.hp;
      enemyData.name = 'Elite ' + enemyData.name;
    } else if (node.type === 'boss') {
      enemyData.hp = Math.floor(enemyData.hp * 2.5);
      enemyData.maxHp = enemyData.hp;
      enemyData.name = 'Boss ' + enemyData.name;
    }

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
    battleScene.userData = {
      mapSeed: this._seed,
      runState: this._runState,
      nodeId: node.id,
      nodeType: node.type,
      nodeDepth: node.depth,
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
