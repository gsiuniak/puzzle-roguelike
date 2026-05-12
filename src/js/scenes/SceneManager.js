/**
 * SceneManager — owns shared services and routes lifecycle, input, update, and
 * render calls to the active scene.
 *
 * Shared services (owned once, passed to scenes):
 *   - CanvasApp, GameLoop, InputManager, AssetManager, AudioManager
 *
 * Lifecycle:
 *   registerScene(name, scene)  — add a scene
 *   switchTo(name)              — exit current, enter new
 *   start()                     — begin game loop
 *
 * Each scene receives a reference to this SceneManager via `this._sceneManager`
 * and can call `this._sceneManager.switchTo('someScene')` to transition.
 */

export default class SceneManager {
  /**
   * @param {import('../engine/CanvasApp.js').default} canvasApp
   * @param {import('../engine/GameLoop.js').default} gameLoop
   * @param {import('../engine/InputManager.js').default} inputManager
   * @param {import('../engine/AssetManager.js').default} assetManager
   */
  constructor(canvasApp, gameLoop, inputManager, assetManager) {
    /** @type {import('../engine/CanvasApp.js').default} */
    this._app = canvasApp;

    /** @type {import('../engine/GameLoop.js').default} */
    this._loop = gameLoop;

    /** @type {import('../engine/InputManager.js').default} */
    this._input = inputManager;

    /** @type {import('../engine/AssetManager.js').default} */
    this._assetManager = assetManager;

    /** @type {import('../audio/AudioManager.js').default|null} */
    this._audioManager = null;

    /** @type {Object<string, import('./Scene.js').default>} */
    this._scenes = {};

    /** @type {import('./Scene.js').default|null} */
    this._currentScene = null;

    /** @type {string|null} */
    this._currentSceneName = null;

    /** @type {boolean} */
    this._running = false;
  }

  // ── Service accessors ─────────────────────────────────

  get app() { return this._app; }
  get loop() { return this._loop; }
  get input() { return this._input; }
  get assetManager() { return this._assetManager; }
  get audioManager() { return this._audioManager; }

  /** @param {import('../audio/AudioManager.js').default} am */
  setAudioManager(am) {
    this._audioManager = am;
  }

  // ── Scene registry ────────────────────────────────────

  /**
   * Register a scene instance under a given name.
   * Sets the back-reference so scenes can call switchTo().
   * @param {string} name
   * @param {import('./Scene.js').default} scene
   */
  registerScene(name, scene) {
    this._scenes[name] = scene;
    scene._sceneManager = this;
  }

  /**
   * Transition from the current scene to the named scene.
   * Calls onExit() on the old scene, onEnter() on the new scene,
   * and clears all input listeners in between.
   * @param {string} name
   */
  switchTo(name) {
    const nextScene = this._scenes[name];
    if (!nextScene) {
      console.error(`SceneManager: unknown scene "${name}"`);
      return;
    }

    // Exit current scene
    if (this._currentScene && typeof this._currentScene.onExit === 'function') {
      this._currentScene.onExit();
    }

    // Clear all input listeners from previous scene
    this._input.clearAllListeners();

    // Swap
    this._currentScene = nextScene;
    this._currentSceneName = name;

    // Enter new scene
    if (typeof nextScene.onEnter === 'function') {
      nextScene.onEnter();
    }

    // Layout immediately for the new scene
    this._layoutCurrentScene();

    console.log(`SceneManager: switched to "${name}"`);
  }

  // ── Game loop ─────────────────────────────────────────

  /**
   * Start the game loop. Call after registering scenes and
   * switching to the initial scene.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Wire resize → layout
    this._app.onResize = (w, h) => {
      this._layoutCurrentScene();
    };

    // Game loop tick
    this._loop.start((dt) => {
      this._tick(dt);
    });
  }

  /** Stop the game loop (for teardown / debugging) */
  stop() {
    this._running = false;
    this._loop.stop();
  }

  /** @param {number} dt — delta time in ms */
  _tick(dt) {
    if (!this._currentScene) return;

    // Update
    this._currentScene.update(dt);

    // Layout (recalculate on every frame for responsiveness)
    this._layoutCurrentScene();

    // Render
    this._app.clear('#1a0a0a');
    this._currentScene.render(this._app.ctx);
  }

  // ── Layout ────────────────────────────────────────────

  _layoutCurrentScene() {
    const scene = this._currentScene;
    if (!scene) return;

    scene.rect.x = 0;
    scene.rect.y = 0;
    scene.rect.w = this._app.width;
    scene.rect.h = this._app.height;
    scene.layoutChildren();
  }
}
