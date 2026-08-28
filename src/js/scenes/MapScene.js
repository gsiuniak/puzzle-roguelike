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
import { enemyHpFloorMult, enemyAttackFloorBonus, enemyArmorFloorMult } from '../data/enemyScaling.js';
import BattleScene from '../ui/BattleScene.js';
import { selectEnemyForNode, markEnemySeen, getEnemyById } from '../data/enemies/index.js';
import { createPlayerBattleState, syncBattleResultsToRunState, MAX_EQUIPPED_SKILLS } from '../data/playerStats.js';
import { createRunState } from '../data/runState.js';
import { resolveSkillIds } from '../data/skills/skillCatalog.js';
import { resolveEnemyRelicIds } from '../data/relics/enemyRelicCatalog.js';
import { clearSpellIconCache } from '../icons/spellIcons.js';

// ── TEMP testing flag ────────────────────────────────────
/**
 * When true, EVERY map node except the boss routes to the SkillWeaveScene
 * (skill reward) instead of its normal behavior — for rapidly testing the
 * weave/synthesis/skill-list flow. Set back to false to restore normal node
 * routing (battles, chests, rests, etc.). Checked in _onNodeEntered.
 */
const DEBUG_ALL_NODES_SKILL_WEAVE = false; // true;

// ── Per-floor enemy HP + ATTACK scaling ──────────────────
// The curves (ENEMY_HP_FLOOR_MULT / ENEMY_ATTACK_FLOOR_BONUS) + these depth-indexed
// helpers now live in the shared, dependency-free source of truth
// src/js/data/enemyScaling.js — imported ABOVE and also by sim/toolbench/engine.mjs,
// so the game and the balance sim can never drift. Retune the curve in that ONE
// file and testing/training picks it up automatically. (See that file for the
// rationale + previous curves.)

// ── Weave color affinity ─────────────────────────────────
const AFFINITY_MANA_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];

/**
 * The mana colors of a character's STARTING skills, in first-seen order — used
 * to bias the Skill Weave tag draw toward the colors the player builds around
 * (Warrior → red/blue, Mage → purple/yellow, Witch Doctor → green/purple).
 * @param {object} characterDef
 * @returns {string[]}
 */
function startingSkillColors(characterDef) {
  if (!characterDef || !Array.isArray(characterDef.skills)) return [];
  const out = [];
  const seen = new Set();
  for (const s of resolveSkillIds(characterDef.skills)) {
    for (const c of Object.keys((s && s.cost) || {})) {
      if (AFFINITY_MANA_COLORS.includes(c) && !seen.has(c)) { seen.add(c); out.push(c); }
    }
  }
  return out;
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

    // ── Map-transition entry overlay + reveal ──────────
    // CharacterSelectScene hands its still-playing map-transition <video>
    // here (setEntryVideoOverlay, immediately BEFORE an instant switchTo —
    // decision #58 idiom): renderForeground draws it full-canvas over
    // everything at an alpha decaying 1→0 over _entryOverlayFadeMs, then the
    // element is released. The handoff also ARMS the MapView entry reveal
    // (fullscreen splash → container shrink), applied in onEnter once the
    // MapView exists. Deliberately NOT reset in onEnter — the handoff sets
    // these just before onEnter runs; this scene owns the element from the
    // handoff on.
    /** @type {HTMLVideoElement|null} */
    this._entryOverlayVideo = null;
    /** @type {number} ms over which the overlay fades out */
    this._entryOverlayFadeMs = 1;
    /** @type {number} ms since the handoff */
    this._entryOverlayElapsed = 0;
    /** @type {boolean} arm MapView.beginEntryReveal() on the next onEnter */
    this._pendingEntryReveal = false;
  }

  // ═══════════════════════════════════════════════════════
  // Map-transition entry overlay (handed off by CharacterSelectScene)
  // ═══════════════════════════════════════════════════════

  /**
   * Take ownership of the still-playing map-transition <video>, fade it out
   * over this scene, and arm the fullscreen-splash entry reveal. Called by
   * CharacterSelectScene immediately before its instant switchTo here, so
   * onEnter must not (and does not) reset the overlay state.
   * @param {HTMLVideoElement} video — plays out and is released when the fade ends
   * @param {number} fadeMs — fade-out duration
   */
  setEntryVideoOverlay(video, fadeMs) {
    this._destroyEntryOverlay();
    this._entryOverlayVideo = video || null;
    this._entryOverlayFadeMs = Math.max(1, fadeMs || 250);
    this._entryOverlayElapsed = 0;
    this._pendingEntryReveal = true;
  }

  _destroyEntryOverlay() {
    const video = this._entryOverlayVideo;
    if (!video) return;
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
    this._entryOverlayVideo = null;
  }

  /**
   * Draw the map-transition entry overlay ON TOP of everything (full canvas,
   * covering the bars): the handed-off movie's held last frame dissolves into
   * the fullscreen map splash beneath it (the start of the entry reveal).
   */
  renderForeground(_ctx) {
    const video = this._entryOverlayVideo;
    if (!video || video.error || video.readyState < 2) return;
    const app = this._sceneManager && this._sceneManager._app;
    if (!app) return;
    const alpha = Math.max(0, 1 - this._entryOverlayElapsed / this._entryOverlayFadeMs);
    if (alpha <= 0) return;
    app.drawFullCanvasImage(video, alpha);
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

    // Armed by the character-confirm handoff (setEntryVideoOverlay): open with
    // the fullscreen-splash reveal — the transition movie's last frame
    // dissolves into the fullscreen splash, which then shrinks into place.
    if (this._pendingEntryReveal) {
      this._pendingEntryReveal = false;
      if (this._mapView) this._mapView.beginEntryReveal();
    }

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

    // Begin buffering the boss intro video now, so its first frame is already
    // decoded by the time the player reaches the boss (no black-screen stall).
    this._maybePreloadBossIntro();
  }

  /**
   * If this map has a boss node with an intro cutscene, tell the (singleton)
   * BossIntroScene to start buffering its video ahead of time. Idempotent —
   * BossIntroScene.preloadVideo ignores a repeat of the same src — so it's safe
   * to call on every map entry (fresh run + each return from battle).
   */
  _maybePreloadBossIntro() {
    const sm = this._sceneManager;
    if (!sm || !this._graph) return;
    const introScene = sm._scenes && sm._scenes['BossIntroScene'];
    if (!introScene || typeof introScene.preloadVideo !== 'function') return;

    const bossNode = this._graph.allNodes.find((n) => n.type === 'boss');
    if (!bossNode) return;

    let enemyDef = null;
    try {
      // Boss selection is deterministic (one boss per floor), so reading the
      // intro video here matches the enemy the fight will actually use.
      enemyDef = selectEnemyForNode({
        depth: bossNode.depth,
        nodeType: bossNode.type,
        seenByAct: this._runState && this._runState.seenEnemiesByAct,
      });
    } catch (e) {
      return;
    }
    if (enemyDef && enemyDef.introVideo) {
      introScene.preloadVideo(enemyDef.introVideo);
    }
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

    // Safety: release an entry overlay that hasn't finished fading.
    this._destroyEntryOverlay();
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
    // Procedural spell icons embed the run seed — last run's are dead weight.
    clearSpellIconCache();
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
    // Nodes are hidden/fading during the entry reveal — ignore clicks on them.
    if (this._mapView && this._mapView.isEntryRevealActive()) return;
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
    // TEMP testing override: every node except the boss is a skill reward
    // (Weave a Power). Flip DEBUG_ALL_NODES_SKILL_WEAVE (top of file) to
    // restore normal node routing.
    if (DEBUG_ALL_NODES_SKILL_WEAVE && node.type !== 'boss') {
      console.log(`[MapScene] DEBUG_ALL_NODES_SKILL_WEAVE: routing ${node.type} node to SkillWeaveScene.`);
      this._transitionToSkillWeave(node);
      return;
    }

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
        // Training nodes weave a new skill via the "Weave a Power" tag-draft
        // screen (SkillWeaveScene). Skill resolution is a placeholder until
        // skills are implemented, but the screen + node completion are wired.
        this._transitionToSkillWeave(node);
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
  /**
   * Deep-clone an enemy definition and turn it into floor-scaled, resolved
   * battle data: maxHp scaled by depth (ENEMY_HP_FLOOR_MULT), armor scaled by
   * its own curve (ENEMY_ARMOR_FLOOR_MULT via enemyArmorFloorMult), an additive
   * per-floor attack bonus (ENEMY_ATTACK_FLOOR_BONUS × the enemy's attackScale),
   * and skill/relic IDs resolved into full objects (enemy relics from the
   * ENEMY-ONLY pool). Shared by the primary enemy AND every transform form so
   * an enemy that swaps identity mid-battle scales consistently.
   *
   * @param {object} def — enemy definition (shared catalog ref; cloned here)
   * @param {number} depth — map node depth (0-indexed)
   * @returns {object} resolved battle data
   */
  _resolveEnemyBattleData(def, depth) {
    const data = JSON.parse(JSON.stringify(def));
    const hpMult = enemyHpFloorMult(depth);
    data.maxHp = Math.round((data.maxHp || 1) * hpMult);
    data.hp = data.maxHp;
    const attackScale = typeof data.attackScale === 'number' ? data.attackScale : 1;
    data.attack = (data.attack || 0) + Math.round(enemyAttackFloorBonus(depth) * attackScale);
    data.armor = Math.round((data.armor || 0) * enemyArmorFloorMult(depth));
    data.skills = resolveSkillIds(data.skills || []);
    data.relics = resolveEnemyRelicIds(data.relics || []);
    return data;
  }

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
    // Deep-clone + floor-scale + resolve the enemy into battle data.
    const enemyData = this._resolveEnemyBattleData(enemyDef, node.depth);

    // Pre-resolve any mid-battle TRANSFORM forms (Sanguine Phoenix ⇄ Egg). An
    // enemy that can transform lists the alternate enemy ids it may become in
    // `transformForms`; we gather the whole reachable set (BFS, including the
    // primary so a form can revert to a full-life primary) and resolve each the
    // SAME way, then hand the map to the BattleController via `_forms`. Normal
    // enemies have no `transformForms`, so `_forms` stays absent for them.
    if (Array.isArray(enemyDef.transformForms) && enemyDef.transformForms.length) {
      const forms = {};
      const seen = new Set();
      const queue = [enemyDef.id, ...enemyDef.transformForms];
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const fdef = getEnemyById(id);
        if (!fdef) continue;
        forms[id] = this._resolveEnemyBattleData(fdef, node.depth);
        for (const next of (fdef.transformForms || [])) {
          if (!seen.has(next)) queue.push(next);
        }
      }
      enemyData._forms = forms;
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
      // Optional per-enemy battle background asset key (BattleScene falls back
      // to 'battle_background_default' when absent).
      background: enemyData.background || null,
    };

    // Wire onBattleComplete callback so BattleScene reports back
    // without needing to know about MapScene internals.
    battleScene._onBattleComplete = (result) => {
      this._handleBattleComplete(result);
    };

    // Register the battle scene. If this enemy defines an intro cutscene
    // (e.g. the boss), fade to the BossIntroScene first — it plays the video,
    // starts the boss music, then cross-fades into the battle. Otherwise fade
    // straight to the battle.
    sm.registerScene('BattleScene', battleScene);

    const introScene = sm._scenes['BossIntroScene'];
    if (enemyData.introVideo && introScene && typeof introScene.configure === 'function') {
      introScene.configure({
        videoSrc: enemyData.introVideo,
        musicKey: music.trackKey,
        isSpecialTrack: music.isSpecialTrack,
        nextScene: 'BattleScene',
      });
      sm.fadeToScene('BossIntroScene', 400);
    } else {
      sm.fadeToScene('BattleScene', 400);
    }
  }

  /**
   * Transition to the SkillWeaveScene ("Weave a Power") for a training node.
   *
   * Mirrors the battle-transition contract: stash the traversal state, register
   * an onComplete callback that marks the node complete (the same path battle
   * uses via _handleBattleComplete), then fade to the configured scene. On
   * return, MapScene.onEnter consumes _savedTraversalState and reveals the next
   * depth.
   * @param {import('../map/MapNode.js').default} node
   */
  _transitionToSkillWeave(node) {
    if (this._transitioning) return;
    this._transitioning = true;

    const sm = this._sceneManager;
    if (!sm) return;

    // Save traversal state so we can restore + advance on return.
    if (this._traversal) {
      this._savedTraversalState = this._traversal.serialize();
    }

    const weaveScene = sm._scenes['SkillWeaveScene'];
    if (!weaveScene || typeof weaveScene.configure !== 'function') {
      console.warn('[MapScene] SkillWeaveScene unavailable — completing node directly.');
      this._handleBattleComplete({ result: 'complete', nodeId: node.id });
      sm.fadeToScene('MapScene', 400);
      return;
    }

    weaveScene.configure({
      returnScene: 'MapScene',
      runSeed: this._seed,
      // Nudge the tag draw toward the character's starting-skill colors.
      affinityColors: startingSkillColors(this._characterDef),
      onComplete: ({ recipe, synthesis, icon }) => {
        // AWARD: the synthesized skill joins the run — createPlayerBattleState
        // appends runState.skills to the character's catalog skills each battle.
        const skill = synthesis && synthesis.skill;
        if (skill && this._runState) {
          if (!Array.isArray(this._runState.skills)) this._runState.skills = [];
          this._runState.skills.push(JSON.parse(JSON.stringify(skill)));
          // If the player has customized their loadout, auto-equip the new
          // skill while there's room (null = default loadout, which already
          // includes new skills up to the cap).
          const eq = this._runState.equippedSkillIds;
          if (Array.isArray(eq) && eq.length < MAX_EQUIPPED_SKILLS) {
            eq.push(skill.id);
          }
          console.log(`[MapScene] Skill awarded: "${skill.name}" (${skill.id}) — `
            + `${this._runState.skills.length} woven skill(s) this run.`);
        }
        console.log(`[MapScene] Skill weave complete — recipe: [${(recipe || []).join(' + ')}], node: ${node.id}`
          + (icon ? `, icon: ${icon.assetKey}` : ''));
        this._handleBattleComplete({ result: 'complete', nodeId: node.id });
      },
    });

    sm.fadeToScene('SkillWeaveScene', 400);
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

    // Advance the map-transition entry overlay fade; release the video the
    // moment it is fully transparent.
    if (this._entryOverlayVideo) {
      this._entryOverlayElapsed += dt;
      if (this._entryOverlayElapsed >= this._entryOverlayFadeMs) {
        this._destroyEntryOverlay();
      }
    }

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

    // Entry reveal splash (fullscreen → shrinking into the container) —
    // drawn HERE, pre-viewport-clip, so its fullscreen phase covers the bars
    // with exactly the handed-off movie's framing (no size jump at the
    // dissolve). MapView stashes the contents fade-in alpha for render().
    if (this._mapView) {
      this._mapView.renderEntryRevealBackground(
        sm._app.ctx, this._canvasW, this._canvasH, 16, sm._app
      );
    }
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
