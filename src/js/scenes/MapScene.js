/**
 * MapScene — the roguelike map traversal scene.
 *
 * Lives between character select and battle encounters.
 *
 * Responsibilities:
 *   - Generate (or load) a MapGraph via MapGenerator
 *   - Manage traversal state via MapTraversalController
 *   - Render the map via MapRenderer inside a centered container
 *   - Handle click input for node selection and movement
 *   - Transition to BattleScene when a combat node is selected
 *
 * Extends UIPanel to fit the existing scene architecture.
 *
 * Lifecycle:
 *   onEnter()  — generate map, wire input
 *   update(dt) — advance animations, update hover
 *   render(ctx) — draw overlay + container, delegate to MapRenderer
 *   onExit()   — tear down input
 */

// ── Container layout constants ──────────────────────
/** Fraction of canvas width the container occupies */
const CONTAINER_WIDTH_FRAC = 0.85;
/** Fraction of canvas height the container occupies */
const CONTAINER_HEIGHT_FRAC = 0.82;
/** Minimum horizontal padding from edges */
const CONTAINER_MIN_H_PAD = 40;
/** Minimum vertical padding from edges */
const CONTAINER_MIN_V_PAD = 24;
/** Container corner radius */
const CONTAINER_RADIUS = 16;
/** Container border width */
const CONTAINER_BORDER = 2;
/** Overlay alpha */
const OVERLAY_ALPHA = 0.55;

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

    // ── Container rect cache (recomputed each frame) ────
    /** @type {{x:number,y:number,w:number,h:number}} */
    this._containerRect = { x: 0, y: 0, w: 0, h: 0 };

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
  // Container layout
  // ═══════════════════════════════════════════════════════

  /** Target aspect ratio (16:9) */
  static CONTAINER_ASPECT = 16 / 9;

  /**
   * Compute the centered map container rect from the current canvas size.
   * Enforces a 16:9 aspect ratio, fitting within the canvas bounds.
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  _getContainerRect() {
    const w = this._canvasW;
    const h = this._canvasH;

    // Max available area respecting padding constraints
    const maxW = Math.min(w * CONTAINER_WIDTH_FRAC, w - CONTAINER_MIN_H_PAD * 2);
    const maxH = Math.min(h * CONTAINER_HEIGHT_FRAC, h - CONTAINER_MIN_V_PAD * 2);
    const targetRatio = MapScene.CONTAINER_ASPECT;

    let cw, ch;
    if (maxW / maxH > targetRatio) {
      // Canvas is wider than 16:9 — constrain by height
      ch = maxH;
      cw = ch * targetRatio;
    } else {
      // Canvas is taller than 16:9 — constrain by width
      cw = maxW;
      ch = cw / targetRatio;
    }

    const cx = Math.floor((w - cw) / 2);
    const cy = Math.floor((h - ch) / 2);

    this._containerRect = { x: cx, y: cy, w: cw, h: ch };
    return this._containerRect;
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

      // Complete the node we just battled at and reveal the next depth
      this._traversal.completeCurrentAndRevealNext();
      console.log('[MapScene] Current node completed, next depth revealed.');
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
   * @param {number} x — canvas-space mouse X
   * @param {number} y — canvas-space mouse Y
   */
  _handleMouseDown(x, y) {
    if (this._transitioning) return;
    if (!this._renderer || !this._traversal) return;

    // Offset into container-local coordinates
    const cr = this._containerRect;
    const lx = x - cr.x;
    const ly = y - cr.y;

    // Ignore clicks outside the container
    if (lx < 0 || ly < 0 || lx > cr.w || ly > cr.h) return;

    const hit = this._renderer.hitTest(cr.w, cr.h, lx, ly);
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
   * @param {number} x — canvas-space mouse X
   * @param {number} y — canvas-space mouse Y
   */
  _handleMouseMove(x, y) {
    if (!this._renderer) return;

    // Offset into container-local coordinates
    const cr = this._containerRect;
    const lx = x - cr.x;
    const ly = y - cr.y;

    // Ignore moves outside the container (clear hover)
    if (lx < 0 || ly < 0 || lx > cr.w || ly > cr.h) {
      this._renderer.updateHover(cr.w, cr.h, -999, -999);
      return;
    }

    this._renderer.updateHover(cr.w, cr.h, lx, ly);
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
   * Override render to use MapRenderer inside a centered container.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;

    const cr = this._getContainerRect();
    const dt = 16; // ~60fps animation base

    // ── 1. Semi-transparent black overlay across entire canvas ──
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${OVERLAY_ALPHA})`;
    ctx.fillRect(0, 0, this._canvasW, this._canvasH);
    ctx.restore();

    // ── 2. Container background panel ──────────────────────
    ctx.save();
    this._drawContainerPanel(ctx, cr);
    ctx.restore();

    // ── 3. Clip & translate to container interior ──────────
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.clip();
    ctx.translate(cr.x, cr.y);

    // ── 4. Delegate map rendering within container bounds ──
    if (this._renderer) {
      this._renderer.render(ctx, cr.w, cr.h, dt);
    }

    // ── 5. Depth labels (container-relative) ───────────────
    this._drawDepthLabels(ctx, cr.w, cr.h);

    // ── 6. Node info at bottom (container-relative) ────────
    this._drawNodeInfo(ctx, cr.w, cr.h);

    ctx.restore();

    // ── 7. Container border (on top, after clip restore) ───
    ctx.save();
    this._drawContainerBorder(ctx, cr);
    ctx.restore();

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }

  /**
   * Draw the container background fill using the map_splash image.
   * The splash is scaled to cover the entire container area.
   */
  _drawContainerPanel(ctx, cr) {
    // Try to draw the splash image as container background
    const splashImg = this._assetManager ? this._assetManager.get('map_splash') : null;

    if (splashImg && splashImg.complete) {
      // Scale to cover the container, maintaining aspect ratio with overflow
      const imgW = splashImg.width;
      const imgH = splashImg.height;
      const scale = Math.max(cr.w / imgW, cr.h / imgH);
      const sw = imgW * scale;
      const sh = imgH * scale;
      const sx = cr.x + (cr.w - sw) / 2;
      const sy = cr.y + (cr.h - sh) / 2;

      ctx.save();
      ctx.beginPath();
      this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
      ctx.clip();
      ctx.drawImage(splashImg, sx, sy, sw, sh);
      ctx.restore();
    } else {
      // Fallback: dark semi-transparent fill
      ctx.fillStyle = 'rgba(18, 14, 8, 0.92)';
      ctx.beginPath();
      this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
      ctx.fill();
    }
  }

  /**
   * Draw the container border stroke.
   */
  _drawContainerBorder(ctx, cr) {
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.35)';
    ctx.lineWidth = CONTAINER_BORDER;
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.stroke();

    // Subtle inner border for depth
    const inset = 3;
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this._roundRect(ctx, cr.x + inset, cr.y + inset, cr.w - inset * 2, cr.h - inset * 2, CONTAINER_RADIUS - 1);
    ctx.stroke();
  }

  /**
   * Helper: draw a rounded rectangle path.
   */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /**
   * Draw depth/floor indicators along the top of the container.
   * @param {CanvasRenderingContext2D} ctx — already translated to container origin
   * @param {number} cw — container width
   * @param {number} ch — container height
   */
  _drawDepthLabels(ctx, cw, ch) {
    if (!this._graph) return;

    const positioned = this._renderer.layoutNodes(cw, ch);
    if (positioned.length === 0) return;

    ctx.save();
    ctx.fillStyle = 'rgba(180, 160, 120, 0.45)';
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
   * Draw info about the current node / legend at the bottom of the container.
   * @param {CanvasRenderingContext2D} ctx — already translated to container origin
   * @param {number} cw — container width
   * @param {number} ch — container height
   */
  _drawNodeInfo(ctx, cw, ch) {
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
    ctx.fillText(text, cw / 2, ch - 12);
    ctx.restore();
  }
}
