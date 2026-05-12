/**
 * main.js — entry point for the match-3 battle game.
 *
 * Creates shared services (Canvas, AssetManager, InputManager, GameLoop,
 * AudioManager), then instantiates the SceneManager with TitleScreen
 * and BattleScene. The game boots into the title screen first.
 */

import CanvasApp from './engine/CanvasApp.js';
import GameLoop from './engine/GameLoop.js';
import AssetManager from './engine/AssetManager.js';
import InputManager from './engine/InputManager.js';
import SceneManager from './scenes/SceneManager.js';
import TitleScreen from './scenes/TitleScreen.js';
import BattleScene from './ui/BattleScene.js';
import BattleController from './game/BattleController.js';
import AudioManager from './audio/AudioManager.js';
import SoundConfig from './audio/SoundConfig.js';
import mockCharacter from './data/mockCharacter.js';
import mockEnemy from './data/mockEnemy.js';

// ── Debug flag ──────────────────────────────────────────
const DEBUG_UI_LAYOUT = false;

// ── Asset key → path mapping ───────────────────────────
const ASSET_MAP = {
  title_screen:               'assets/sprites/title/title_screen.png',
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

  // 2. AudioManager — initialize with sound config
  AudioManager.init(SoundConfig);
  console.log('[AudioManager] Sound system ready.');

  // 3. CanvasApp
  const app = new CanvasApp(null, {
    autoResize: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  // 4. InputManager
  const input = new InputManager(app.canvas);

  // 5. GameLoop
  const loop = new GameLoop();

  // 6. SceneManager — owns all shared services
  const sceneManager = new SceneManager(app, loop, input, assetManager);
  sceneManager.setAudioManager(AudioManager);

  // 7. BattleController — the game logic engine (shared across scenes)
  const battleController = new BattleController(mockCharacter, mockEnemy);

  // 8. TitleScreen
  const titleScreen = new TitleScreen();
  titleScreen.assetManager = assetManager;

  // 9. BattleScene
  const battleScene = new BattleScene(mockCharacter, mockEnemy, assetManager, battleController);
  battleScene.setAudioManager(AudioManager);

  if (DEBUG_UI_LAYOUT) {
    setDebugRecursive(battleScene, true);
  }

  // 10. Register scenes
  sceneManager.registerScene('TitleScreen', titleScreen);
  sceneManager.registerScene('BattleScene', battleScene);

  // 11. Boot into title screen
  sceneManager.switchTo('TitleScreen');

  // 12. Start the game loop
  sceneManager.start();

  console.log('Match-3 Battle ready!');
  console.log('  - Press any key or click to start');
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
