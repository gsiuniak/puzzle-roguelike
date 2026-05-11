/**
 * main.js — entry point for the battle scene UI demo.
 *
 * Creates the Canvas, AssetManager, loads assets, builds the BattleScene
 * (player + board + enemy), and runs the game loop.
 */
import CanvasApp from './engine/CanvasApp.js';
import GameLoop from './engine/GameLoop.js';
import AssetManager from './engine/AssetManager.js';
import InputManager from './engine/InputManager.js';
import BattleScene from './ui/BattleScene.js';
import mockCharacter from './data/mockCharacter.js';
import mockEnemy from './data/mockEnemy.js';

// ── Debug flag ──────────────────────────────────────────
const DEBUG_UI_LAYOUT = false;

// ── Asset key → path mapping ───────────────────────────
const ASSET_MAP = {
  // Character pane
  placeholder:               'assets/sprites/placeholder.png',
  character_pane_background: 'assets/sprites/character_pane/background/character_pane_background.png',
  character_pane_skill_row:  'assets/sprites/character_pane/background/character_pane_skill_row.png',
  portrait_warrior:          'assets/sprites/character_pane/portraits/portrait_warrior.png',
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

  // Board grid background
  grid_dark:                 'assets/sprites/grid/grid_dark.png',
  grid_light:                'assets/sprites/grid/grid_light.png',

  // Board tiles
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

// ── Initialize ─────────────────────────────────────────
async function init() {
  // 1. Create AssetManager and register all assets
  const assetManager = new AssetManager();
  for (const [key, path] of Object.entries(ASSET_MAP)) {
    assetManager.add(key, path);
  }

  // 2. Load all assets
  console.log('Loading assets...');
  const loadedCount = await assetManager.loadAll();
  console.log(`Assets loaded: ${loadedCount} / ${assetManager.count}`);

  // 3. Create CanvasApp
  const app = new CanvasApp(null, {
    autoResize: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  // 4. Create BattleScene — player + board + enemy
  const scene = new BattleScene(mockCharacter, mockEnemy, assetManager);

  // 5. Enable debug outlines if flag is set
  if (DEBUG_UI_LAYOUT) {
    setDebugRecursive(scene, true);
  }

  // 6. Create InputManager (future interaction)
  const input = new InputManager(app.canvas);
  input.setRootUI(scene);

  // 7. Layout function — fills browser window
  function layoutScene(canvasW, canvasH) {
    // BattleScene fills the entire canvas
    const margin = scene._resolveMargin();
    scene.rect.x = margin.left;
    scene.rect.y = margin.top;
    scene.rect.w = canvasW - margin.left - margin.right;
    scene.rect.h = canvasH - margin.top - margin.bottom;

    // Layout all descendants
    scene.layoutChildren();
  }

  // 8. Handle resize
  app.onResize = (w, h) => {
    layoutScene(w, h);
  };
  layoutScene(app.width, app.height);

  // 9. Game loop
  const loop = new GameLoop();

  loop.start((dt) => {
    scene.update(dt);
    app.clear('#1a0a0a');
    scene.render(app.ctx);
  });

  console.log('BattleScene demo running!');
  console.log('  - Left:  player CharacterPane (Thorgrim)');
  console.log('  - Center: 8×8 placeholder board');
  console.log('  - Right: enemy CharacterPane (Goblin)');
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
