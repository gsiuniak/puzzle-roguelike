/**
 * main.js — entry point for the character pane UI demo.
 *
 * Creates the Canvas, AssetManager, loads assets, builds the CharacterPane,
 * and runs the game loop.
 */
import CanvasApp from './engine/CanvasApp.js';
import GameLoop from './engine/GameLoop.js';
import AssetManager from './engine/AssetManager.js';
import InputManager from './engine/InputManager.js';
import CharacterPane from './ui/CharacterPane.js';
import mockCharacter from './data/mockCharacter.js';

// ── Debug flag ──────────────────────────────────────────
const DEBUG_UI_LAYOUT = true;

// ── Asset key → path mapping ───────────────────────────
const ASSET_MAP = {
  placeholder:               'assets/sprites/placeholder.png',
  character_pane_background: 'assets/sprites/character_pane/background/character_pane_background.png',
  portrait_warrior:          'assets/sprites/character_pane/portraits/portrait_warrior.png',
  portrait_goblin:           'assets/sprites/character_pane/portraits/portrait_goblin.png',
  icon_attack:               'assets/sprites/character_pane/icons/icon_attack.png',
  icon_block:                'assets/sprites/character_pane/icons/icon_block.png',
  mana_red:                  'assets/sprites/character_pane/mana/mana_red.png',
  mana_blue:                 'assets/sprites/character_pane/mana/mana_blue.png',
  mana_green:                'assets/sprites/character_pane/mana/mana_green.png',
  mana_yellow:               'assets/sprites/character_pane/mana/mana_yellow.png',
  mana_purple:               'assets/sprites/character_pane/mana/mana_purple.png',
  skill_slash:               'assets/sprites/character_pane/skills/skill_slash.png',
  skill_bash:                'assets/sprites/character_pane/skills/skill_bash.png',
  skill_defend:              'assets/sprites/character_pane/skills/skill_defend.png',
};

// ── Pane sizing ────────────────────────────────────────
const PANE_WIDTH = 400;
const PANE_MAX_HEIGHT_RATIO = 0.95;
const PANE_MAX_HEIGHT = 800;

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
    minWidth: 400,
    minHeight: 600,
  });

  // 4. Create CharacterPane
  const pane = new CharacterPane(mockCharacter, assetManager);
  pane.setStyle({
    width: PANE_WIDTH,
    height: null,
    minHeight: 200,
    maxHeight: PANE_MAX_HEIGHT,
    backgroundAssetKey: 'character_pane_background',
    borderColor: '#554422',
    borderWidth: 2,
    cornerRadius: 8,
    padding: { top: 12, right: 14, bottom: 14, left: 14 },
    gap: 8,
  });

  // Enable debug outlines if flag is set
  if (DEBUG_UI_LAYOUT) {
    setDebugRecursive(pane, true);
  }

  // 5. Create InputManager
  const input = new InputManager(app.canvas);
  input.setRootUI(pane);

  // 6. Layout function — positions the root pane and lays out children
  function layoutPane(canvasW, canvasH) {
    const maxH = Math.min(canvasH * PANE_MAX_HEIGHT_RATIO, PANE_MAX_HEIGHT);
    pane.maxHeight = maxH;

    const px = (canvasW - PANE_WIDTH) / 2;
    const py = Math.max(10, (canvasH - maxH) / 2);

    // Set root rect directly (no parent to position it)
    const margin = pane._resolveMargin();
    pane.rect.x = px + margin.left;
    pane.rect.y = py + margin.top;
    pane.rect.w = PANE_WIDTH - margin.left - margin.right;
    pane.rect.h = maxH - margin.top - margin.bottom;

    // Layout all descendants
    pane.layoutChildren();
  }

  // 7. Handle resize
  app.onResize = (w, h) => {
    layoutPane(w, h);
  };
  layoutPane(app.width, app.height);

  // 8. Game loop
  const loop = new GameLoop();

  loop.start((dt) => {
    pane.update(dt);
    app.clear('#1a0a0a');
    pane.render(app.ctx);
  });

  console.log('CharacterPane demo running!');
  console.log('  - Change mockCharacter.js values and reload to see updates');
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
