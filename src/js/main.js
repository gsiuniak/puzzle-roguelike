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
import LoadingScene from './scenes/LoadingScene.js';
import TitleScreen from './scenes/TitleScreen.js';
import CharacterSelectScene from './scenes/CharacterSelectScene.js';
import MapScene from './scenes/MapScene.js';
import GameOverScene from './scenes/GameOverScene.js';
import BossIntroScene from './scenes/BossIntroScene.js';
import SkillWeaveScene from './scenes/SkillWeaveScene.js';
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
  battle_background_malakor:  'assets/sprites/battle/battle_background_malakor.png',
  battle_background_game_over: 'assets/sprites/battle/battle_background_game_over.png',
  placeholder:               'assets/sprites/placeholder.png',
  character_pane_background: 'assets/sprites/character_pane/background/character_pane_background.png',
  character_pane_skill_row:  'assets/sprites/character_pane/background/character_pane_skill_row.png',
  // Battle portraits (player + enemy) now come from the
  // `ui_spritesheet_player_portraits` / `ui_spritesheet_enemy_portraits`
  // spritesheets (sprite names match the `portrait_<id>` keys directly — see
  // SPRITESHEET_MAP). NOTE: the CharacterSelect scene uses its own separate
  // `character_select_portrait_*` / `character_select_splash_*` keys (unaffected).
  // icon_attack / icon_block, mana_<color>, mana_<color>_simple, and mana_amount
  // now come from the `ui_spritesheet_character_pane` spritesheet (sprite names
  // match these keys directly — see SPRITESHEET_MAP).
  skill_slash:               'assets/sprites/character_pane/skills/skill_slash.png',
  skill_bash:                'assets/sprites/character_pane/skills/skill_bash.png',
  skill_defend:              'assets/sprites/character_pane/skills/skill_defend.png',
  skill_explode:             'assets/sprites/character_pane/skills/skill_explode.png',
  skill_fracture:            'assets/sprites/character_pane/skills/skill_fracture.png',
  skill_summon_dead:         'assets/sprites/character_pane/skills/skill_summon_dead.png',
  skill_oungan:              'assets/sprites/character_pane/skills/skill_oungan.png',
  skill_encroach:            'assets/sprites/character_pane/skills/skill_encroach.png',
  skill_hound:               'assets/sprites/character_pane/skills/skill_hound.png',
  skill_desecrate:           'assets/sprites/character_pane/skills/skill_desecrate.png',
  skill_soul_burn:           'assets/sprites/character_pane/skills/skill_soul_burn.png',
  skill_harvest:             'assets/sprites/character_pane/skills/skill_harvest.png',
  skill_exsanguinate:        'assets/sprites/character_pane/skills/skill_exsanguinate.png',
  skill_infected_bite:       'assets/sprites/character_pane/skills/skill_infected_bite.png',
  skill_cyst_burst:          'assets/sprites/character_pane/skills/skill_cyst_burst.png',
  skill_flair_left:          'assets/sprites/character_pane/flair/skill_flair_left.png',
  skill_flair_right:         'assets/sprites/character_pane/flair/skill_flair_right.png',
  // grid_dark / grid_light (board background tiles) now come from the
  // `ui_spritesheet_tiles` spritesheet (sprite names match the keys directly).
  animated_text_extra_turn:  'assets/sprites/animated_text/animated_text_extra_turn.png',
  animated_text_player_turn: 'assets/sprites/animated_text/animated_text_player_turn.png',
  animated_text_enemy_turn:  'assets/sprites/animated_text/animated_text_enemy_turn.png',
  // Board tiles + wild border now come from the `ui_spritesheet_tiles`
  // spritesheet (see SPRITESHEET_MAP). The board still requests `tile_<type>`
  // keys; those are aliased onto the packed sprite names in init() (TILE_ALIASES).
  // `wild_tile_border` matches the sprite name directly, so it needs no alias.
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
  reward_divider_common:    'assets/sprites/reward_screen/reward_divider_common.png',
  reward_divider_uncommon:  'assets/sprites/reward_screen/reward_divider_uncommon.png',
  reward_divider_rare:      'assets/sprites/reward_screen/reward_divider_rare.png',
  reward_divider_legendary: 'assets/sprites/reward_screen/reward_divider_legendary.png',
  rewards_button_confirm:        'assets/sprites/reward_screen/rewards_button_confirm.png',
  rewards_button_confirm_hover:  'assets/sprites/reward_screen/rewards_button_confirm_hover.png',
  rewards_button_skip:           'assets/sprites/reward_screen/rewards_button_skip.png',
  rewards_button_skip_hover:     'assets/sprites/reward_screen/rewards_button_skip_hover.png',
  battle_button_skip:            'assets/sprites/temp/skip_button.png',
  battle_button_map:             'assets/sprites/temp/map_button.png',
  rewards_background_splash:     'assets/sprites/reward_screen/rewards_background_splash.png',
  // ── New battle screen panel assets ──────────────────
  battle_board_panel:        'assets/sprites/battle/board/battle_board_panel.png',
  // combat_log_panel:          'assets/sprites/battle/log/combat_log_panel.png',
  // character_pane_panel / skill_pane_panel / skills_button / skills_locked_icon
  // now come from the `ui_spritesheet_character_pane` spritesheet (names match
  // directly — see SPRITESHEET_MAP). skills_locked_button is NOT in the sheet.
  skills_locked_button:      'assets/sprites/battle/skills_pane/skills_locked_button.png',
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
  // "+attack per unspent mana" relics (one per color)
  relic_cestus:              'assets/sprites/relics/relic_cestus.png',
  relic_harpoon:             'assets/sprites/relics/relic_harpoon.png',
  relic_club:                'assets/sprites/relics/relic_club.png',
  relic_stiletto:            'assets/sprites/relics/relic_stiletto.png',
  relic_wand:                'assets/sprites/relics/relic_wand.png',
  // Attack / sustain / board-control legendaries
  relic_scythe:              'assets/sprites/relics/relic_scythe.png',
  relic_tsunami:             'assets/sprites/relics/relic_tsunami.png',
  relic_soul_eater:          'assets/sprites/relics/relic_soul_eater.png',
  relic_reckoning:           'assets/sprites/relics/relic_reckoning.png',
  relic_gorepike:            'assets/sprites/relics/relic_gorepike.png',
  relic_deathbringer:        'assets/sprites/relics/relic_deathbringer.png',
  // Potions — grant starting mana (one per color)
  relic_potion_red:          'assets/sprites/relics/relic_potion_red.png',
  relic_potion_blue:         'assets/sprites/relics/relic_potion_blue.png',
  relic_potion_green:        'assets/sprites/relics/relic_potion_green.png',
  relic_potion_yellow:       'assets/sprites/relics/relic_potion_yellow.png',
  relic_potion_purple:       'assets/sprites/relics/relic_potion_purple.png',
  // Mana-gain reactors — deal 1 damage when gaining a color (one per color)
  relic_flaming_arrow:       'assets/sprites/relics/relic_flaming_arrow.png',
  relic_water_balloon:       'assets/sprites/relics/relic_water_balloon.png',
  relic_thorned_branch:      'assets/sprites/relics/relic_thorned_branch.png',
  relic_static_comb:         'assets/sprites/relics/relic_static_comb.png',
  relic_tuning_fork:         'assets/sprites/relics/relic_tuning_fork.png',
  // Familiars — gain +1 mana of a color on any 3+ match (one per color)
  relic_familiar_red:        'assets/sprites/relics/relic_familiar_red.png',
  relic_familiar_blue:       'assets/sprites/relics/relic_familiar_blue.png',
  relic_familiar_green:      'assets/sprites/relics/relic_familiar_green.png',
  relic_familiar_yellow:     'assets/sprites/relics/relic_familiar_yellow.png',
  relic_familiar_purple:     'assets/sprites/relics/relic_familiar_purple.png',
  // Individual relics
  relic_slingshot:           'assets/sprites/relics/relic_slingshot.png',
  relic_familiar_skull:      'assets/sprites/relics/relic_familiar_skull.png',
  // Enemy-only relics (enemyRelicCatalog.js)
  relic_briarthorn:          'assets/sprites/relics/relic_briarthorn.png',
  relic_chokeweed_sap:       'assets/sprites/relics/relic_chokeweed_sap.png',
  relic_goresnout_collars:   'assets/sprites/relics/relic_goresnout_collars.png',
  relic_sulfur:              'assets/sprites/relics/relic_sulfur.png',
  relic_heart_of_usurper:    'assets/sprites/relics/relic_heart_of_usurper.png',
  relic_barons_signet:       'assets/sprites/relics/relic_barons_signet.png',
  relic_infected_tooth:      'assets/sprites/relics/relic_infected_tooth.png',
  relic_severed_maxilla:     'assets/sprites/relics/relic_severed_maxilla.png',
  // ── Skill Weave ("Weave a Power") screen assets ─────
  skill_weave_background:               'assets/sprites/skill_weave/skill_weave_background.png',
  ui_skill_weave_option_container:      'assets/sprites/skill_weave/ui_skill_weave_option_container.png',
  ui_skill_weave_option_container_uncommon:  'assets/sprites/skill_weave/ui_skill_weave_option_container_uncommon.png',
  ui_skill_weave_option_container_rare:      'assets/sprites/skill_weave/ui_skill_weave_option_container_rare.png',
  ui_skill_weave_option_container_legendary: 'assets/sprites/skill_weave/ui_skill_weave_option_container_legendary.png',
  ui_skill_weave_container:             'assets/sprites/skill_weave/ui_skill_weave_container.png',
  ui_skill_weave_container_wide:        'assets/sprites/skill_weave/ui_skill_weave_container_wide.png',
  ui_skill_weave_selection_container:   'assets/sprites/skill_weave/ui_skill_weave_selection_container.png',
  ui_skill_weave_selection_blank_container: 'assets/sprites/skill_weave/ui_skill_weave_selection_blank_container.png',
  ui_skill_weave_button:                'assets/sprites/skill_weave/ui_skill_weave_button.png',
  ui_skill_weave_button_confirm:        'assets/sprites/skill_weave/ui_skill_weave_button_confirm.png',
  skill_weave_tag_test:                 'assets/sprites/skill_weave/ui_skill_weave_tag_test.png',
  // ── General UI ──────────────────────────────────────
  tooltip_panel:             'assets/sprites/general_ui/tooltip_panel.png',
};

// ── Spritesheet key → { image, json } mapping ──────────
// A spritesheet is one packed PNG + a JSON sidecar describing each sprite's
// frame. AssetManager.addSpriteSheet loads both and slices every named sprite
// into its own retrievable asset (by the sprite name in the JSON's `sprites`),
// so individual sprites are used exactly like standalone images.
//   trim: true → AssetManager crops each sprite to its non-transparent bounds.
//   Only needed when the SHEET isn't already alpha-trimmed. The weave-icon sheet
//   is packed tight by the upstream packer (each frame's w/h is the glyph's
//   content box), so trimming is left OFF and the packed bounds are honored.
const SPRITESHEET_MAP = {
  ui_spritesheet_skill_weave_icons: {
    image: 'assets/sprites/skill_weave/ui_spritesheet_skill_weave_icons.png',
    json:  'assets/sprites/skill_weave/ui_spritesheet_skill_weave_icons.json',
    trim:  false,
  },
  ui_spritesheet_tiles: {
    image: 'assets/sprites/battle/board/tiles/ui_spritesheet_tiles.png',
    json:  'assets/sprites/battle/board/tiles/ui_spritesheet_tiles.json',
    trim:  false, // packer already emits tight per-sprite frames
  },
  ui_spritesheet_character_pane: {
    image: 'assets/sprites/battle/character_pane/ui_spritesheet_character_pane.png',
    json:  'assets/sprites/battle/character_pane/ui_spritesheet_character_pane.json',
    trim:  false, // sprite names match the existing keys directly (no aliases)
  },
  ui_spritesheet_player_portraits: {
    image: 'assets/sprites/battle/portraits/ui_spritesheet_player_portraits.png',
    json:  'assets/sprites/battle/portraits/ui_spritesheet_player_portraits.json',
    trim:  false, // sprite names match the `portrait_<id>` keys directly (no aliases)
  },
  ui_spritesheet_enemy_portraits: {
    image: 'assets/sprites/battle/portraits/ui_spritesheet_enemy_portraits.png',
    json:  'assets/sprites/battle/portraits/ui_spritesheet_enemy_portraits.json',
    trim:  false, // sprite names match the `portrait_<id>` keys directly (no aliases)
  },
};

// ── Asset aliases (existing key → spritesheet sprite name) ──
// The board requests `tile_<type>` keys; the packed sprites are named
// `<color>_tile`. Alias the two so consumers stay unchanged. (`wild_tile_border`
// matches its sprite name, so it resolves from the sheet without an alias.)
const ASSET_ALIASES = {
  tile_red:     'red_tile',
  tile_blue:    'blue_tile',
  tile_green:   'green_tile',
  tile_yellow:  'yellow_tile',
  tile_purple:  'purple_tile',
  tile_skull:   'skull_tile',
  tile_disease: 'diseased_tile',
  tile_thrall:  'thrall_tile',
};

// ── Game viewport configuration ─────────────────────────
// The game renders against a fixed design resolution and is uniformly
// scaled to fit the device window. Black bars (letterbox/pillarbox) fill
// any unused space outside the aspect-correct viewport.
const DESIGN_WIDTH  = 1920;
const DESIGN_HEIGHT = 1080;

// ── Initialize ─────────────────────────────────────────
async function init() {
  // 1. AssetManager — register every asset, but do NOT block on loading yet.
  //    The loading screen below appears immediately and the assets stream in
  //    behind it (see step 12).
  const assetManager = new AssetManager();
  for (const [key, path] of Object.entries(ASSET_MAP)) {
    assetManager.add(key, path);
  }
  for (const [key, paths] of Object.entries(SPRITESHEET_MAP)) {
    assetManager.addSpriteSheet(key, paths.image, paths.json, { trim: paths.trim });
  }
  for (const [aliasKey, targetKey] of Object.entries(ASSET_ALIASES)) {
    assetManager.alias(aliasKey, targetKey);
  }

  // 2. CanvasApp
  const app = new CanvasApp(null, {
    autoResize: true,
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,
  });

  // 3. InputManager — receives `app` so pointer events convert to design space
  const input = new InputManager(app.canvas, app);

  // 4. GameLoop
  const loop = new GameLoop();

  // 5. SceneManager — owns all shared services
  const sceneManager = new SceneManager(app, loop, input, assetManager);
  sceneManager.setAudioManager(AudioManager);

  // 6. LoadingScene — shown first, polls AssetManager progress, fades to Title
  const loadingScene = new LoadingScene();
  loadingScene.setAssetManager(assetManager);

  // 7. TitleScreen
  const titleScreen = new TitleScreen();
  titleScreen.assetManager = assetManager;

  // 8. CharacterSelectScene — MapScene is created on demand when "Choose Hero" is clicked
  const characterSelectScene = new CharacterSelectScene();

  // 9. MapScene — created once, reused between battle returns
  const mapScene = new MapScene();

  // 9b. GameOverScene — shown on player defeat; any input → CharacterSelect
  const gameOverScene = new GameOverScene();

  // 9c. BossIntroScene — full-canvas video cutscene played before a boss fight
  //     (configured on demand by MapScene._transitionToBattle).
  const bossIntroScene = new BossIntroScene();

  // 9d. SkillWeaveScene — "Weave a Power" tag-draft skill reward screen
  //     (configured on demand by MapScene when entering a training node).
  const skillWeaveScene = new SkillWeaveScene();

  // 10. Register scenes
  sceneManager.registerScene('LoadingScene', loadingScene);
  sceneManager.registerScene('TitleScreen', titleScreen);
  sceneManager.registerScene('CharacterSelectScene', characterSelectScene);
  sceneManager.registerScene('MapScene', mapScene);
  sceneManager.registerScene('GameOverScene', gameOverScene);
  sceneManager.registerScene('BossIntroScene', bossIntroScene);
  sceneManager.registerScene('SkillWeaveScene', skillWeaveScene);
  // BattleScene is registered lazily by MapScene._transitionToBattle()

  // 11. Wire the fullscreen toggle button.
  // The Fullscreen API requires a user gesture, so we attach a tap/click
  // handler rather than auto-entering. On iOS Safari the API is unavailable
  // outside <video>, but the apple-mobile-web-app-capable meta tag in
  // index.html makes "Add to Home Screen" launch the app fullscreen.
  setupFullscreenButton();

  // 12. Boot into the loading screen and start the loop immediately so the
  //     screen is visible while assets load.
  sceneManager.switchTo('LoadingScene');
  sceneManager.start();

  // 13. Kick off asset + audio loading in the background. The LoadingScene
  //     polls `assetManager.progress` each frame and fades to TitleScreen when
  //     loading completes — we never block the loop on it.
  console.log('Loading assets...');
  assetManager.loadAll().then((loadedCount) => {
    console.log(`Assets loaded: ${loadedCount} / ${assetManager.count}`);
  });

  // AudioManager initialization runs in parallel (Howler lazily streams audio).
  AudioManager.init(SoundConfig);
  console.log('[AudioManager] Sound system ready.');

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
