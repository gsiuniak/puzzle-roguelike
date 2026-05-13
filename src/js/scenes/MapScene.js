/**
 * MapScene — the roguelike map traversal scene.
 *
 * Lives between character select and battle encounters.
 *
 * Responsibilities:
 *   - Generate (or load) a MapGraph via MapGenerator
 *   - Manage traversal state via MapTraversalController
 *   - Render the map via MapRenderer
 *   - Handle click input for node selection and movement
 *   - Transition to BattleScene when a combat node is selected
 *
 * Extends UIPanel to fit the existing scene architecture.
 *
 * Lifecycle:
 *   onEnter()  — generate map, wire input
 *   update(dt) — advance animations, update hover
 *   render(ctx) — delegate to MapRenderer
 *   onExit()   — tear down input
 */

import UIPanel from '../ui/UIPanel.js';
import MapGenerator from '../map/MapGenerator.js';
import MapGraph from '../map/MapGraph.js';
import MapTraversalController from '../map/MapTraversalController.js';
import MapRenderer from '../map/MapRenderer.js';
import AudioManager from '../audio/AudioManager.js';
import BattleController from '../game/BattleController.js';
import BattleScene from '../ui/BattleScene.js';
import mockEnemy from '../data/mockEnemy.js';

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

    // ── Player character data (passed from character select) ─
    /** @type {object|null} */
    this._playerData = null;

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

    // Generate a seed if not set (can be overridden before onEnter)
    if (!this._seed) {
      this._seed = String(Date.now());
    }

    // Generate the map graph (deterministic from seed)
    console.log(`[MapScene] Generating map with seed: "${this._seed}"`);
    this._graph = MapGenerator.generate(this._seed);

    // Create the traversal controller
    this._traversal = new MapTraversalController(this._graph);

    // Restore traversal state if returning from battle
    if (this._savedTraversalState) {
      this._traversal.deserialize(this._savedTraversalState);
      this._savedTraversalState = null;
      console.log('[MapScene] Restored traversal state from battle return.');
    }

    // Create the renderer
    this._renderer = new MapRenderer({ assetManager: this._assetManager });
    this._renderer.setGraph(this._graph);
    this._renderer.setTraversal(this._traversal);

    // Cache canvas dimensions
    this._canvasW = sm._app.width;
    this._canvasH = sm._app.height;

    // ── Music ────────────────────────────────────────
    AudioManager.playMusic('main_theme', { fadeIn: 600 });

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

    console.log(`[MapScene] Map ready — ${this._graph.size} nodes, ${this._graph.depthCount} depths.`);
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
   * Set the player character data (passed from CharacterSelectScene).
   * @param {object} playerData
   */
  setPlayerData(playerData) {
    this._playerData = playerData;
  }

  // ═══════════════════════════════════════════════════════
  // Input
  // ═══════════════════════════════════════════════════════

  /**
   * @param {number} x
   * @param {number} y
   */
  _handleMouseDown(x, y) {
    if (this._transitioning) return;
    if (!this._renderer || !this._traversal) return;

    const hit = this._renderer.hitTest(this._canvasW, this._canvasH, x, y);
    if (!hit) return;

    // Allow clicking on the current node (to start/resume its encounter)
    if (hit.state.current) {
      console.log(`[MapScene] Entering current node: ${hit.id} (type: ${hit.type}, depth: ${hit.depth})`);
      AudioManager.playSfx('character_select_pick');
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
    AudioManager.playSfx('character_select_pick');

    // Handle node type
    this._onNodeEntered(hit);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  _handleMouseMove(x, y) {
    if (!this._renderer) return;
    this._renderer.updateHover(this._canvasW, this._canvasH, x, y);
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
      case 'elite':
        this._transitionToBattle(node);
        break;

      case 'boss':
        this._transitionToBattle(node);
        break;

      case 'rest':
        // Future: trigger rest scene / healing
        console.log('[MapScene] Rest node entered — healing (placeholder)');
        // For now, mark the node as completed and stay on map
        break;

      case 'chest':
        // Future: trigger chest reward
        console.log('[MapScene] Chest node entered — reward (placeholder)');
        break;

      case 'training':
        // Future: trigger training scene
        console.log('[MapScene] Training node entered — upgrade (placeholder)');
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

    // Build player data if not already set
    const playerData = this._playerData || this._getDefaultPlayerData();
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
      JSON.parse(JSON.stringify(playerData)),
      enemyData
    );

    const battleScene = new BattleScene(
      playerData,
      enemyData,
      this._assetManager,
      battleController
    );
    battleScene.setAudioManager(sm.audioManager);

    // Store minimal map context for battle scene (seed for regeneration)
    battleScene.userData = {
      mapSeed: this._seed,
      playerData: this._playerData,
      nodeType: node.type,
      nodeDepth: node.depth,
    };

    // Register and switch
    sm.registerScene('BattleScene', battleScene);
    sm.switchTo('BattleScene');
  }

  /**
   * Get a default player data object if none was passed.
   * @returns {object}
   */
  _getDefaultPlayerData() {
    // Return a reasonable default character
    return {
      name: 'Adventurer',
      className: 'Warrior',
      hp: 100,
      maxHp: 100,
      mana: { red: 5, blue: 5, green: 5, yellow: 5, purple: 5 },
      skills: [],
      description: 'A brave adventurer.',
    };
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

    // Check if we returned from battle (happens when BattleScene switches back)
    if (this._transitioning) {
      // Check if we're back (BattleScene switched to another scene and we became active again)
      // This is handled by onEnter being called again
    }
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  /**
   * Override render to use MapRenderer instead of standard UI child rendering.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;

    // Delegate all rendering to MapRenderer
    if (this._renderer) {
      this._renderer.render(ctx, this._canvasW, this._canvasH, 16); // dt ~16ms for 60fps animation base
    }

    // Draw depth labels
    this._drawDepthLabels(ctx);

    // Draw current node info at bottom
    this._drawNodeInfo(ctx);

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }

  /**
   * Draw depth/floor indicators along the top.
   */
  _drawDepthLabels(ctx) {
    if (!this._graph) return;

    const positioned = this._renderer.layoutNodes(this._canvasW, this._canvasH);
    if (positioned.length === 0) return;

    ctx.save();
    ctx.fillStyle = 'rgba(180, 160, 120, 0.4)';
    ctx.font = '15px "Marcellus SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Group by depth and draw label above topmost node
    const depthMap = new Map();
    for (const { node, x, y } of positioned) {
      if (!depthMap.has(node.depth)) {
        depthMap.set(node.depth, { x, topY: y });
      } else {
        const prev = depthMap.get(node.depth);
        if (y < prev.topY) prev.topY = y;
      }
    }

    for (const [depth, info] of depthMap) {
      const label = depth === 0 ? 'START'
        : depth === this._graph.depthCount - 1 ? 'BOSS'
        : `FLOOR ${depth}`;
      ctx.fillText(label, info.x, Math.max(8, info.topY - 42));
    }

    ctx.restore();
  }

  /**
   * Draw info about the current node / legend at the bottom.
   */
  _drawNodeInfo(ctx) {
    const traversal = this._traversal;
    if (!traversal) return;

    const current = traversal.currentNode;
    if (!current) return;

    const typeName = current.type.charAt(0).toUpperCase() + current.type.slice(1);
    const text = `${typeName} — Depth ${current.depth + 1}`;

    ctx.save();
    ctx.fillStyle = 'rgba(220, 200, 160, 0.7)';
    ctx.font = '18px "Marcellus SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, this._canvasW / 2, this._canvasH - 20);
    ctx.restore();
  }
}
