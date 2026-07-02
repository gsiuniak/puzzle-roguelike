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
import SpriteSheetAnimation from './ui/SpriteSheetAnimation.js';

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
// Standalone (non-spritesheet) assets only — large backgrounds/splashes plus a
// few one-off elements. The bulk of per-screen UI art (portraits, skill/relic
// icons, tiles, panels, map icons, reward + weave + character-select elements,
// etc.) now loads from packed spritesheets — see SPRITESHEET_MAP below.
const ASSET_MAP = {
  // ── Backgrounds / splashes (large, kept standalone) ──
  title_screen:                         'assets/sprites/title/title_screen.jpg',
  battle_background_default:            'assets/sprites/battle/backgrounds/battle_background_default.jpg',
  battle_background_malakor:            'assets/sprites/battle/backgrounds/battle_background_malakor.jpg',
  battle_background_game_over:          'assets/sprites/battle/backgrounds/battle_background_game_over.jpg',
  map_splash:                           'assets/sprites/map/map_splash.jpg',
  character_select_splash_warrior:      'assets/sprites/character_select/character_select_splash_warrior.jpg',
  character_select_splash_mage:         'assets/sprites/character_select/character_select_splash_mage.jpg',
  character_select_splash_witch_doctor: 'assets/sprites/character_select/character_select_splash_witch_doctor.jpg',
  // ── Battle panels / buttons ──
  battle_board_panel:                   'assets/sprites/battle/board/battle_board_panel.png',
  battle_board_panel_overlay:           'assets/sprites/battle/board/battle_board_panel_overlay.png',
  battle_button_skip:                   'assets/sprites/temp/skip_button.png',
  battle_button_map:                    'assets/sprites/temp/map_button.png',
  // ── Skill Weave (background + default tag icon; UI elements are in a sheet) ──
  skill_weave_background:               'assets/sprites/skill_weave/skill_weave_background.png',
  skill_weave_tag_test:                 'assets/sprites/skill_weave/ui_skill_weave_tag_test.png',
  // ── General UI ──
  placeholder:                          'assets/sprites/placeholder.png',
  tooltip_panel:                        'assets/sprites/general_ui/tooltip_panel.png',
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
    trim:  false, // sprites named `<id>_portrait_floating` → aliased to `portrait_<id>` (see ASSET_ALIASES)
  },
  ui_spritesheet_enemy_portraits: {
    image: 'assets/sprites/battle/portraits/ui_spritesheet_enemy_portraits.png',
    json:  'assets/sprites/battle/portraits/ui_spritesheet_enemy_portraits.json',
    trim:  false, // sprites named `<id>_portrait_floating` → aliased to `portrait_<id>` (see ASSET_ALIASES)
  },
  ui_spritesheet_player_skills: {
    image: 'assets/sprites/skills/player/ui_spritesheet_player_skills.png',
    json:  'assets/sprites/skills/player/ui_spritesheet_player_skills.json',
    trim:  false, // sprite names match the skill `icon` keys directly (no aliases)
  },
  ui_spritesheet_enemy_skills: {
    image: 'assets/sprites/skills/enemy/ui_spritesheet_enemy_skills.png',
    json:  'assets/sprites/skills/enemy/ui_spritesheet_enemy_skills.json',
    trim:  false, // sprite names match the skill `icon` keys directly (no aliases)
  },
  ui_spritesheet_animated_text: {
    image: 'assets/sprites/battle/animated_text/ui_spritesheet_animated_text.png',
    json:  'assets/sprites/battle/animated_text/ui_spritesheet_animated_text.json',
    trim:  false, // sprite names match the `animated_text_*` keys directly (no aliases)
  },
  // Combat-damage counter art (DamageCounterEffect): the "DAMAGE / CHAIN X" label
  // (ui_animated_text_damage_chain) + the gold digit glyphs (digit_0 … digit_9)
  // used for the big damage total AND the chain count.
  ui_spritesheet_combat_damage: {
    image: 'assets/sprites/battle/animated_text/ui_spritesheet_combat_damage.png',
    json:  'assets/sprites/battle/animated_text/ui_spritesheet_combat_damage.json',
    trim:  false, // sprite names (ui_animated_text_damage_chain / digit_<n>) used directly
  },
  // Spell-icon compositing layers (icons/spellIconRecipe.js + spellIconCompositor.js):
  //   weave_base    — circular colored mana-orb backgrounds (weave_base_<color>[_n])
  //   weave_generic — effect foreground sprites (weave_generic_<tag>[_n]) + icon_border_2
  // Sliced per-sprite by AssetManager and fetched by key at icon render time.
  ui_spritesheet_weave_base: {
    image: 'assets/sprites/skill_weave/ui_spritesheet_weave_base.png',
    json:  'assets/sprites/skill_weave/ui_spritesheet_weave_base.json',
    trim:  false, // sprite names match the weave_base_<color> keys directly (no aliases)
  },
  ui_spritesheet_weave_generic: {
    image: 'assets/sprites/skill_weave/ui_spritesheet_weave_generic.png',
    json:  'assets/sprites/skill_weave/ui_spritesheet_weave_generic.json',
    trim:  false, // sprite names match the weave_generic_<tag> / icon_border_2 keys directly
  },
  ui_spritesheet_skill_weave_elements: {
    image: 'assets/sprites/skill_weave/ui_spritesheet_skill_weave_elements.png',
    json:  'assets/sprites/skill_weave/ui_spritesheet_skill_weave_elements.json',
    trim:  false, // sprite names match the `ui_skill_weave_*` keys directly (no aliases)
  },
  ui_spritesheet_reward_screen_elements: {
    image: 'assets/sprites/reward_screen/ui_spritesheet_reward_screen_elements.png',
    json:  'assets/sprites/reward_screen/ui_spritesheet_reward_screen_elements.json',
    trim:  false, // sprite names match the reward-screen keys directly (no aliases)
  },
  ui_spritesheet_level_up_screen_elements: {
    image: 'assets/sprites/level_up_screen/ui_spritesheet_level_up_screen_elements.png',
    json:  'assets/sprites/level_up_screen/ui_spritesheet_level_up_screen_elements.json',
    trim:  false, // sprite names match the `ui_level_up_*` keys directly (no aliases)
  },
  ui_spritesheet_map_elements: {
    image: 'assets/sprites/map/ui_spritesheet_map_elements.png',
    json:  'assets/sprites/map/ui_spritesheet_map_elements.json',
    trim:  false, // sprite names match the `map_icon_*` keys directly (no aliases)
  },
  ui_spritesheet_character_select_elements: {
    image: 'assets/sprites/character_select/ui_spritesheet_character_select_elements.png',
    json:  'assets/sprites/character_select/ui_spritesheet_character_select_elements.json',
    trim:  false, // sprite names match the `character_select_*` keys directly (no aliases)
  },
  ui_spritesheet_character_select_portraits: {
    image: 'assets/sprites/character_select/ui_spritesheet_character_select_portraits.png',
    json:  'assets/sprites/character_select/ui_spritesheet_character_select_portraits.json',
    trim:  false, // sprite names match the `character_select_portrait_<id>` keys directly
  },
  ui_spritesheet_relics: {
    image: 'assets/sprites/relics/ui_spritesheet_relics.png',
    json:  'assets/sprites/relics/ui_spritesheet_relics.json',
    trim:  false, // sprite names match the `relic_<id>` keys directly (no aliases)
  },
  ui_spritesheet_status_effects: {
    image: 'assets/sprites/battle/status_effects/ui_spritesheet_status_effects.png',
    json:  'assets/sprites/battle/status_effects/ui_spritesheet_status_effects.json',
    trim:  false, // packer emits tight per-sprite frames; sprite names match the
                  // status `icon` keys (buff_*/debuff_*) directly (no aliases)
  },
  // PROOF OF CONCEPT — per-character attack flash played over the portrait on a
  // skull match (see SpriteSheetAnimation.js + BattleScene ATTACK_ANIMATIONS).
  // DISABLED: the animations are turned off (ATTACK_ANIMATIONS `enabled: false`),
  // so their sheets are UNREGISTERED here — no download, decode, or boot-warm
  // pinning happens (the `*_attack_animation` preload loop below iterates
  // SPRITESHEET_MAP, so with no entries it warms nothing). To re-enable a
  // character: flip its `enabled` in BattleScene ATTACK_ANIMATIONS AND restore
  // its entry here (with `slice: false` — the animation blits the full sheet,
  // so per-frame slicing would allocate dozens of large unused canvases):
  //   ui_spritesheet_<char>_attack_animation: {
  //     image: 'assets/sprites/battle/character_pane/ui_spritesheet_<char>_attack_animation.png',
  //     json:  'assets/sprites/battle/character_pane/ui_spritesheet_<char>_attack_animation.json',
  //     trim:  false,
  //     slice: false,
  //   },
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
  tile_wild:    'wild_tile',
  // Sanguine Egg tiles (the Sanguine Phoenix's wild tile) — dedicated art lives
  // in the tiles sheet as `phoenix_egg_tile`; the board requests `tile_<type>`.
  tile_sanguine_egg: 'phoenix_egg_tile',
  // ── Battle portraits ──
  // The player/enemy portrait sheets now name their sprites `<id>_portrait_floating`
  // (was `portrait_<id>`). The battle panes still request the stable `portrait_<id>`
  // keys (derived from each def's `portrait` field), so remap them here. Most map
  // 1:1; a couple of sprite names diverge from the def's `portrait` value and are
  // mapped explicitly (sanguine egg, chokeweed).
  portrait_warrior:      'warrior_portrait_floating',
  portrait_mage:         'mage_portrait_floating',
  portrait_witch_doctor: 'witch_doctor_portrait_floating',
  portrait_orc_taskmaster:    'orc_taskmaster_portrait_floating',
  portrait_sanguine_phoenix:  'sanguine_phoenix_portrait_floating',
  portrait_sanguine_phoenix_egg: 'sanguine_egg_portrait_floating', // def portrait id differs from sprite name
  portrait_chokeweed:         'chokeweed_sapper_portrait_floating', // def portrait id differs from sprite name
  portrait_goblin_sapper:     'goblin_sapper_portrait_floating',
  portrait_cyclops:           'cyclops_portrait_floating',
  portrait_goblin:            'goblin_portrait_floating',
  portrait_malakor:           'malakor_portrait_floating',
  portrait_goresnout_trackers: 'goresnout_trackers_portrait_floating',
  portrait_acolyte:           'acolyte_portrait_floating',
  portrait_abomination:       'abomination_portrait_floating',
  portrait_thrall:            'thrall_portrait_floating',
  // NOTE: orc / shadow_weaver / stone_gargoyle have no portrait in the new sheets,
  // so their panes fall back to the `placeholder` asset until art is added.
};

// ── Game viewport configuration ─────────────────────────
// The game renders against a fixed design resolution and is uniformly
// scaled to fit the device window. Black bars (letterbox/pillarbox) fill
// any unused space outside the aspect-correct viewport.
const DESIGN_WIDTH  = 1920;
const DESIGN_HEIGHT = 1080;

// ── Initialize ─────────────────────────────────────────
async function init() {
  // 0. Warm the custom display fonts so the first damage-counter draw isn't a
  //    fallback-face flash (canvas can't trigger a font load on its own). Fire
  //    and forget — they decode while assets stream behind the loading screen.
  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 100px "Cinzel"');      // damage numbers
    document.fonts.load('400 100px "ExtraOld"');    // DAMAGE/CHAIN words
  }

  // 1. AssetManager — register every asset, but do NOT block on loading yet.
  //    The loading screen below appears immediately and the assets stream in
  //    behind it (see step 12).
  const assetManager = new AssetManager();
  for (const [key, path] of Object.entries(ASSET_MAP)) {
    assetManager.add(key, path);
  }
  for (const [key, paths] of Object.entries(SPRITESHEET_MAP)) {
    assetManager.addSpriteSheet(key, paths.image, paths.json, { trim: paths.trim, slice: paths.slice });
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
    // Spell icons composite from the weave_base / weave_generic sheets at render
    // time (icons/spellIcons.js) — no boot-time glyph registration needed.

    // Pre-warm the per-character attack-animation sheets NOW (once the sheet PNGs
    // are loaded), instead of on battle-enter. This PINS a decoded ImageBitmap of
    // each big packed sheet (immune to browser image-cache eviction — no mid-battle
    // re-decode ever) and prefetches their JSON frame maps up front, so the first
    // attack flash never hitches mid-combat for ANY registered character.
    // Idempotent per sheet (SpriteSheetAnimation.preload guards on the bitmap
    // cache + a frame cache), so BattleScene._preloadAttackAnim() becomes a
    // retry-if-missed no-op. Derived from the `*_attack_animation` entries in
    // SPRITESHEET_MAP so adding a character's sheet there auto-warms it.
    // Removing the POC: delete those entries (this loop then warms nothing) —
    // see SpriteSheetAnimation.js / BattleScene.
    for (const [key, paths] of Object.entries(SPRITESHEET_MAP)) {
      if (key.endsWith('_attack_animation')) {
        SpriteSheetAnimation.preload(key, paths.json, assetManager);
      }
    }
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
