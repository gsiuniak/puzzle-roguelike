/**
 * main.js — entry point for the match-3 battle game.
 *
 * Creates Canvas, AssetManager, BattleController, BattleScene,
 * wires input (board drag/swap + skill clicks), and runs the game loop.
 */

import CanvasApp from './engine/CanvasApp.js';
import GameLoop from './engine/GameLoop.js';
import AssetManager from './engine/AssetManager.js';
import InputManager from './engine/InputManager.js';
import BattleScene from './ui/BattleScene.js';
import BattleController, { BattleState } from './game/BattleController.js';
import AudioManager from './audio/AudioManager.js';
import SoundConfig from './audio/SoundConfig.js';
import mockCharacter from './data/mockCharacter.js';
import mockEnemy from './data/mockEnemy.js';

// ── Debug flag ──────────────────────────────────────────
const DEBUG_UI_LAYOUT = false;

// ── Asset key → path mapping ───────────────────────────
const ASSET_MAP = {
  battle_background_default:  'assets/sprites/character_pane/background/battle_background_default.png',
  placeholder:               'assets/sprites/placeholder.png',
  character_pane_background: 'assets/sprites/character_pane/background/character_pane_background.png',
  character_pane_skill_row:  'assets/sprites/character_pane/background/character_pane_skill_row.png',
  portrait_warrior:          'assets/sprites/character_pane/portraits/portrait_warrior.png',
  portrait_mage:          'assets/sprites/character_pane/portraits/portrait_mage.png',
  portrait_goblin:           'assets/sprites/character_pane/portraits/portrait_goblin.png',
  icon_attack:               'assets/sprites/character_pane/icons/icon_attack.png',
  icon_block:                'assets/sprites/character_pane/icons/icon_block.png',
  mana_red:                  'assets/sprites/character_pane/mana/mana_red.png',
  mana_blue:                 'assets/sprites/character_pane/mana/mana_blue.png',
  mana_green:                'assets/sprites/character_pane/mana/mana_green.png',
  mana_yellow:               'assets/sprites/character_pane/mana/mana_yellow.png',
  mana_purple:               'assets/sprites/character_pane/mana/mana_purple.png',
  mana_red_simple:           'assets/sprites/character_pane/mana/mana_red_simple.png',
  mana_blue_simple:          'assets/sprites/character_pane/mana/mana_blue_simple.png',
  mana_green_simple:         'assets/sprites/character_pane/mana/mana_green_simple.png',
  mana_yellow_simple:        'assets/sprites/character_pane/mana/mana_yellow_simple.png',
  mana_purple_simple:        'assets/sprites/character_pane/mana/mana_purple_simple.png',
  mana_amount:               'assets/sprites/character_pane/mana/mana_amount.png',
  skill_slash:               'assets/sprites/character_pane/skills/skill_slash.png',
  skill_bash:                'assets/sprites/character_pane/skills/skill_bash.png',
  skill_defend:              'assets/sprites/character_pane/skills/skill_defend.png',
  skill_explode:             'assets/sprites/character_pane/skills/skill_explode.png',
  skill_fracture:            'assets/sprites/character_pane/skills/skill_fracture.png',
  skill_flair_left:          'assets/sprites/character_pane/flair/skill_flair_left.png',
  skill_flair_right:         'assets/sprites/character_pane/flair/skill_flair_right.png',
  grid_dark:                 'assets/sprites/grid/grid_dark.png',
  grid_light:                'assets/sprites/grid/grid_light.png',
  animated_text_extra_turn:  'assets/sprites/animated_text/animated_text_extra_turn.png',
  animated_text_player_turn: 'assets/sprites/animated_text/animated_text_player_turn.png',
  animated_text_enemy_turn:  'assets/sprites/animated_text/animated_text_enemy_turn.png',
  tile_red:                  'assets/sprites/tiles/red_tile.png',
  tile_blue:                 'assets/sprites/tiles/blue_tile.png',
  tile_green:                'assets/sprites/tiles/green_tile.png',
  tile_yellow:               'assets/sprites/tiles/yellow_tile.png',
  tile_purple:               'assets/sprites/tiles/purple_tile.png',
  tile_skull:                'assets/sprites/tiles/skull_tile.png',
};

// ── Scene sizing ────────────────────────────────────────
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 640;

// ── Board drag/swap input state ────────────────────────
let selectedCell = null;   // { col, row } | null
let hoveredCell = null;    // { col, row } | null
let dragStartCell = null;  // { col, row } | null

// ── Initialize ─────────────────────────────────────────
async function init() {
  // 1. AssetManager
  const assetManager = new AssetManager();
  for (const [key, path] of Object.entries(ASSET_MAP)) {
    assetManager.add(key, path);
  }

  console.log('Loading assets...');
  const loadedCount = await assetManager.loadAll();
  console.log(`Assets loaded: ${loadedCount} / ${assetManager.count}`);

  // 1b. AudioManager — initialize with sound config
  AudioManager.init(SoundConfig);
  console.log('[AudioManager] Sound system ready.');

  // 2. CanvasApp
  const app = new CanvasApp(null, {
    autoResize: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  // 3. BattleController — the game logic engine
  const battleController = new BattleController(mockCharacter, mockEnemy);

  // 4. BattleScene — the UI
  const scene = new BattleScene(mockCharacter, mockEnemy, assetManager, battleController);
  scene.setAudioManager(AudioManager);

  if (DEBUG_UI_LAYOUT) {
    setDebugRecursive(scene, true);
  }

  // 5. InputManager
  const input = new InputManager(app.canvas);
  input.setRootUI(scene);

  // ── Wire skill clicks ────────────────────────────────
  const playerPane = scene.getPlayerPane();
  if (playerPane) {
    playerPane.onSkillClick = (skill) => {
      battleController.tryPlayerSkill(skill);
    };
  }

  // ── Wire board drag/swap input ───────────────────────
  const board = scene.getBoard();

  /** Allow board input during PLAYER_TURN (swap) or TARGETING (target tile) */
  function canAct() {
    return battleController.state === BattleState.PLAYER_TURN
        || battleController.state === BattleState.TARGETING;
  }

  /** True when the game expects the player to act on the board */
  function isTargeting() {
    return battleController.state === BattleState.TARGETING;
  }

  input.on('mousedown', (x, y) => {
    if (!board) return;

    if (isTargeting()) {
      // During targeting: click on board tile executes the skill
      const cell = board.screenToCell(x, y);
      if (cell) {
        battleController.tryTargetTile(cell.col, cell.row);
      }
      return;
    }

    if (!canAct()) return;
    const cell = board.screenToCell(x, y);
    if (cell) {
      selectedCell = cell;
      dragStartCell = cell;
      board.selectedCell = cell;
    } else {
      // Click outside board — try skill hit test
      const hit = scene.hitTest(x, y);
      if (hit && hit.onClick) {
        hit.onClick();
      }
      selectedCell = null;
      dragStartCell = null;
      if (board) board.selectedCell = null;
    }
  });

  input.on('mousemove', (x, y) => {
    if (!board) return;

    if (isTargeting()) {
      // During targeting: update hover for overlay
      const cell = board.screenToCell(x, y);
      if (cell) {
        battleController.setTargetHover(cell.col, cell.row);
      } else {
        battleController.setTargetHover(null, null);
      }
      board.hoveredCell = cell;
      return;
    }

    const cell = canAct() ? board.screenToCell(x, y) : null;
    hoveredCell = cell;
    board.hoveredCell = cell;

    // Skill row hover feedback
    const hit = scene.hitTest(x, y);
    if (playerPane) {
      for (const row of playerPane._skillRows) {
        row._hovered = (hit === row && row.onClick && canAct());
      }
    }
  });

  input.on('mouseup', (x, y) => {
    if (!board || !selectedCell || !canAct() || isTargeting()) {
      selectedCell = null;
      dragStartCell = null;
      if (board) board.selectedCell = null;
      return;
    }

    const releaseCell = board.screenToCell(x, y);

    if (releaseCell && dragStartCell) {
      const dc = Math.abs(releaseCell.col - dragStartCell.col);
      const dr = Math.abs(releaseCell.row - dragStartCell.row);

      if ((dc === 1 && dr === 0) || (dc === 0 && dr === 1)) {
        battleController.tryPlayerSwap(
          dragStartCell.col, dragStartCell.row,
          releaseCell.col, releaseCell.row
        );
      }
    }

    selectedCell = null;
    dragStartCell = null;
    if (board) board.selectedCell = null;
  });

  // ── Right-click / Escape to cancel targeting ────────
  input.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isTargeting()) {
      battleController.cancelTargeting();
    }
  });

  input.canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isTargeting()) {
      battleController.cancelTargeting();
    }
  });
  // Canvas needs tabindex for keydown to work
  input.canvas.setAttribute('tabindex', '0');
  input.canvas.style.outline = 'none';

  // ── Layout ───────────────────────────────────────────
  function layoutScene(canvasW, canvasH) {
    scene.rect.x = 0;
    scene.rect.y = 0;
    scene.rect.w = canvasW;
    scene.rect.h = canvasH;
    scene.layoutChildren();
  }

  app.onResize = (w, h) => {
    layoutScene(w, h);
  };
  layoutScene(app.width, app.height);

  // ── Game loop ────────────────────────────────────────
  const loop = new GameLoop();

  loop.start((dt) => {
    // dt is in milliseconds from GameLoop
    // Update game logic
    battleController.update(dt);

    // Update UI from game state
    scene.updateFromController();

    // Update scene (animations, etc.)
    scene.update(dt);

    // Layout (recalculate on every frame for responsiveness)
    layoutScene(app.width, app.height);

    // Render
    app.clear('#1a0a0a');
    scene.render(app.ctx);
  });

  console.log('Match-3 Battle running!');
  console.log('  - Drag adjacent tiles to swap');
  console.log('  - Match 3+ tiles to gain mana / deal skull damage');
  console.log('  - Match 5+ connected tiles for extra turn');
  console.log('  - Click skills on player pane to use them');
  console.log(`  - DEBUG_UI_LAYOUT = ${DEBUG_UI_LAYOUT}`);
}

// ── Debug helper ───────────────────────────────────────
function setDebugRecursive(element, enabled) {
  element.debug = enabled;
  for (const child of element.children) {
    setDebugRecursive(child, enabled);
  }
}

// ── Boot ───────────────────────────────────────────────
init().catch(err => {
  console.error('Failed to initialize:', err);
});
