/**
 * main.js — entry point for the match-3 battle game.
 *
 * Creates shared services (Canvas, AssetManager, InputManager, GameLoop,
 * AudioManager), then instantiates the SceneManager with TitleScreen,
 * CharacterSelectScene, MapScene, and BattleScene (created on demand).
 * The game boots into the title screen first.
 *
 * Flow: TitleScreen → CharacterSelectScene → MapScene → BattleScene → MapScene → ...
 */

import CanvasApp from './engine/CanvasApp.js';
import GameLoop from './engine/GameLoop.js';
import AssetManager from './engine/AssetManager.js';
import InputManager from './engine/InputManager.js';
import SceneManager from './scenes/SceneManager.js';
import TitleScreen from './scenes/TitleScreen.js';
import CharacterSelectScene from './scenes/CharacterSelectScene.js';
import MapScene from './scenes/MapScene.js';
import AudioManager from './audio/AudioManager.js';
import SoundConfig from './audio/SoundConfig.js';

// ── Debug flags ─────────────────────────────────────────
const DEBUG_UI_LAYOUT = false;

/**
 * Global debug mode — enables developer shortcuts across scenes.
 * When true:
 *   - BattleScene: press 'K' to instantly win the battle
 *   - Future debug shortcuts can key off this flag
 */
const DEBUG_MODE = true;

// ── Asset key → path mapping ───────────────────────────
const ASSET_MAP = {
  title_screen:               'assets/sprites/title/title_screen.png',
  battle_background_default:  'assets/sprites/battle/battle_background_default.png',
  placeholder:               'assets/sprites/placeholder.png',
  character_pane_background: 'assets/sprites/character_pane/background/character_pane_background.png',
  character_pane_skill_row:  'assets/sprites/character_pane/background/character_pane_skill_row.png',
  portrait_warrior:          'assets/sprites/character_pane/portraits/portrait_warrior.png',
  portrait_mage:             'assets/sprites/character_pane/portraits/portrait_mage.png',
  portrait_witch_doctor:     'assets/sprites/character_pane/portraits/portrait_witch_doctor.png',
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
  skill_summon_dead:         'assets/sprites/character_pane/skills/skill_summon_dead.png',
  skill_oungan:              'assets/sprites/character_pane/skills/skill_oungan.png',
  skill_flair_left:          'assets/sprites/character_pane/flair/skill_flair_left.png',
  skill_flair_right:         'assets/sprites/character_pane/flair/skill_flair_right.png',
  grid_dark:                 'assets/sprites/battle/board/grid/grid_dark.png',
  grid_light:                'assets/sprites/battle/board/grid/grid_light.png',
  animated_text_extra_turn:  'assets/sprites/animated_text/animated_text_extra_turn.png',
  animated_text_player_turn: 'assets/sprites/animated_text/animated_text_player_turn.png',
  animated_text_enemy_turn:  'assets/sprites/animated_text/animated_text_enemy_turn.png',
  tile_red:                  'assets/sprites/battle/board/tiles/red_tile.png',
  tile_blue:                 'assets/sprites/battle/board/tiles/blue_tile.png',
  tile_green:                'assets/sprites/battle/board/tiles/green_tile.png',
  tile_yellow:               'assets/sprites/battle/board/tiles/yellow_tile.png',
  tile_purple:               'assets/sprites/battle/board/tiles/purple_tile.png',
  tile_skull:                'assets/sprites/battle/board/tiles/skull_tile.png',
  // ── Character select scene assets ───────────────────
  character_select_splash_warrior:             'assets/sprites/character_select/character_select_splash_warrior.png',
  character_select_splash_mage:                'assets/sprites/character_select/character_select_splash_mage.png',
  character_select_splash_witch_doctor:        'assets/sprites/character_select/character_select_splash_witch_doctor.png',
  character_select_portrait_warrior:           'assets/sprites/character_select/character_select_portrait_warrior.png',
  character_select_portrait_mage:              'assets/sprites/character_select/character_select_portrait_mage.png',
  character_select_portrait_witch_doctor:      'assets/sprites/character_select/character_select_portrait_witch_doctor.png',
  character_select_info_panel:                 'assets/sprites/character_select/character_select_info_panel.png',
  character_select_heart:                      'assets/sprites/character_select/character_select_heart.png',
  character_select_flair_left:                 'assets/sprites/character_select/character_select_flair_left.png',
  character_select_flair_right:                'assets/sprites/character_select/character_select_flair_right.png',
  character_select_choose_hero_button:         'assets/sprites/character_select/character_select_chooe_hero_button.png',
  character_select_choose_hero_button_hover:   'assets/sprites/character_select/character_select_chooe_hero_button_hover.png',
  character_select_divider:                    'assets/sprites/character_select/character_select_divider.png',
  // ── Map scene assets ────────────────────────────────
  map_splash:       'assets/sprites/map/map_splash.png',
  map_icon_battle:  'assets/sprites/map/map_icon_battle.png',
  map_icon_elite:   'assets/sprites/map/map_icon_elite.png',
  map_icon_chest:   'assets/sprites/map/map_icon_chest.png',
  map_icon_train:   'assets/sprites/map/map_icon_train.png',
  map_icon_rest:    'assets/sprites/map/map_icon_rest.png',
  map_icon_boss:    'assets/sprites/map/map_icon_boss.png',
  // ── Reward screen assets ────────────────────────────
  reward_screen_panel: 'assets/sprites/reward_screen/rewards_panel.png',
  reward_victory_text:      'assets/sprites/reward_screen/rewards_victory_text.png',
  rewards_option_panel:     'assets/sprites/reward_screen/rewards_option_panel.png',
  rewards_option_panel_vertical: 'assets/sprites/reward_screen/rewards_option_panel_vertical.png',
  rewards_title_panel:      'assets/sprites/reward_screen/rewards_title_panel.png',
  rewards_button_confirm:        'assets/sprites/reward_screen/rewards_button_confirm.png',
  rewards_button_confirm_hover:  'assets/sprites/reward_screen/rewards_button_confirm_hover.png',
  rewards_button_skip:           'assets/sprites/reward_screen/rewards_button_skip.png',
  rewards_button_skip_hover:     'assets/sprites/reward_screen/rewards_button_skip_hover.png',
  rewards_background_splash:     'assets/sprites/reward_screen/rewards_background_splash.png',
  // ── New battle screen panel assets ──────────────────
  battle_board_panel:        'assets/sprites/battle/board/battle_board_panel.png',
  combat_log_panel:          'assets/sprites/battle/log/combat_log_panel.png',
  character_pane_panel:      'assets/sprites/battle/character_pane/character_pane_panel.png',
  skill_pane_panel:          'assets/sprites/battle/skills_pane/skill_pane_panel.png',
  skills_button:             'assets/sprites/battle/skills_pane/skills_button.png',
  skills_locked_button:      'assets/sprites/battle/skills_pane/skills_locked_button.png',
  skills_locked_icon:        'assets/sprites/battle/skills_pane/skills_locked_icon.png',
  // ── Relic icons (placeholder until per-relic art is added) ──
  // Relic definitions in data/relics/relicCatalog.js reference these
  // asset keys via their `icon` field. New relics should add their
  // icon key here (pointing at placeholder.png is fine until art exists).
  relic_family_crest:        'assets/sprites/relics/relic_family_crest.png',
  relic_unstable_catalyst:   'assets/sprites/relics/relic_unstable_catalyst.png',
  relic_evil_eye:            'assets/sprites/relics/relic_evil_eye.png',
  // Group A — spawn-rate relics
  relic_flint:               'assets/sprites/relics/relic_flint.png',
  relic_dewstone:            'assets/sprites/relics/relic_dewstone.png',
  relic_fossilized_fern:     'assets/sprites/relics/relic_fossilized_fern.png',
  relic_copper_coil:         'assets/sprites/relics/relic_copper_coil.png',
  relic_obsidian_shard:      'assets/sprites/relics/relic_obsidian_shard.png',
  relic_catacomb_key:        'assets/sprites/relics/relic_catacomb_key.png',
  // Group B — mana-gain relics (+ skull-damage Funerary Bell)
  relic_bellows:             'assets/sprites/relics/relic_bellows.png',
  relic_gourd_flask:         'assets/sprites/relics/relic_gourd_flask.png',
  relic_pestle:              'assets/sprites/relics/relic_pestle.png',
  relic_thimble:             'assets/sprites/relics/relic_thimble.png',
  relic_astrolabe:           'assets/sprites/relics/relic_astrolabe.png',
  relic_funerary_bell:       'assets/sprites/relics/relic_funerary_bell.png',
  // Individual relics
  relic_prism:               'assets/sprites/relics/relic_prism.png',
  relic_blighted_hook:       'assets/sprites/relics/relic_blighted_hook.png',
  relic_trebuchet:           'assets/sprites/relics/relic_trebuchet.png',
  relic_claymore:            'assets/sprites/relics/relic_claymore.png',
  relic_aegis:               'assets/sprites/relics/relic_aegis.png',
  relic_thorned_rose:        'assets/sprites/relics/relic_thorned_rose.png',
  relic_alabaster_flask:     'assets/sprites/relics/relic_alabaster_flask.png',
  // ── General UI ──────────────────────────────────────
  tooltip_panel:             'assets/sprites/general_ui/tooltip_panel.png',
};

// ── Game viewport configuration ─────────────────────────
// The game renders against a fixed design resolution and is uniformly
// scaled to fit the device window. Black bars (letterbox/pillarbox) fill
// any unused space outside the aspect-correct viewport.
const DESIGN_WIDTH  = 1920;
const DESIGN_HEIGHT = 1080;

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
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,
  });

  // 4. InputManager — receives `app` so pointer events convert to design space
  const input = new InputManager(app.canvas, app);

  // 5. GameLoop
  const loop = new GameLoop();

  // 6. SceneManager — owns all shared services
  const sceneManager = new SceneManager(app, loop, input, assetManager);
  sceneManager.setAudioManager(AudioManager);

  // 7. TitleScreen
  const titleScreen = new TitleScreen();
  titleScreen.assetManager = assetManager;

  // 8. CharacterSelectScene — MapScene is created on demand when "Choose Hero" is clicked
  const characterSelectScene = new CharacterSelectScene();

  // 9. MapScene — created once, reused between battle returns
  const mapScene = new MapScene();

  // 10. Register scenes
  sceneManager.registerScene('TitleScreen', titleScreen);
  sceneManager.registerScene('CharacterSelectScene', characterSelectScene);
  sceneManager.registerScene('MapScene', mapScene);
  // BattleScene is registered lazily by MapScene._transitionToBattle()

  // 11. Wire the fullscreen toggle button.
  // The Fullscreen API requires a user gesture, so we attach a tap/click
  // handler rather than auto-entering. On iOS Safari the API is unavailable
  // outside <video>, but the apple-mobile-web-app-capable meta tag in
  // index.html makes "Add to Home Screen" launch the app fullscreen.
  setupFullscreenButton();

  // 12. Boot into title screen
  sceneManager.switchTo('TitleScreen');

  // 13. Start the game loop
  sceneManager.start();

  // Attach debug flags to window for runtime access across modules
  window.__DEBUG_MODE = DEBUG_MODE;
  window.__DEBUG_UI_LAYOUT = DEBUG_UI_LAYOUT;

  console.log('Match-3 Battle ready!');
  console.log('  - Press any key or click at the title screen');
  console.log('  - Select your hero: Warrior or Mage');
  console.log('  - Click portraits to switch, click Choose Hero to start');
  console.log('  - Traverse the map, choose your path');
  console.log('  - Drag adjacent tiles to swap');
  console.log('  - Match 3+ tiles to gain mana / deal skull damage');
  console.log('  - Match 5+ connected tiles for extra turn');
  console.log('  - Click skills on player pane to use them');
  console.log(`  - DEBUG_MODE = ${DEBUG_MODE} (press K in battle to win instantly)`);
  console.log(`  - DEBUG_UI_LAYOUT = ${DEBUG_UI_LAYOUT}`);
}

// ── Debug helper ───────────────────────────────────────
function setDebugRecursive(element, enabled) {
  element.debug = enabled;
  for (const child of element.children) {
    setDebugRecursive(child, enabled);
  }
}

// ── Fullscreen toggle ──────────────────────────────────
function setupFullscreenButton() {
  const btn = document.getElementById('fullscreen-btn');
  if (!btn) return;

  const docEl = document.documentElement;
  const reqFs  = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen;

  // Hide the button entirely on browsers that don't support the API
  // (e.g. iOS Safari outside of <video>). The home-screen-install path
  // via apple-mobile-web-app-capable still provides fullscreen there.
  if (!reqFs) {
    btn.style.display = 'none';
    return;
  }

  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  const toggle = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (isFs()) {
      if (exitFs) exitFs.call(document).catch(() => {});
    } else {
      reqFs.call(docEl).catch(() => {});
    }
  };

  btn.addEventListener('click', toggle);
  // touchend instead of touchstart so it doesn't fire during a scroll/drag
  btn.addEventListener('touchend', toggle, { passive: false });

  const syncState = () => {
    btn.classList.toggle('is-fs', isFs());
  };
  document.addEventListener('fullscreenchange', syncState);
  document.addEventListener('webkitfullscreenchange', syncState);
  syncState();
}

// ── Boot ───────────────────────────────────────────────
init().catch(err => {
  console.error('Failed to initialize:', err);
});
