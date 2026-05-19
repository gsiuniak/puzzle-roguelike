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

    // ── Transition state ──────────────────────────────
    /** @type {boolean} */
    this._transitioning = false;
    /** @type {string|null} target scene name */
    this._transitionTarget = null;
    /** @type {'fade'} */
    this._transitionType = 'fade';
    /** @type {number} transition duration in ms (total: fade-out + fade-in) */
    this._transitionDuration = 400;
    /** @type {number} elapsed time in current transition half */
    this._transitionTimer = 0;
    /** @type {'out'|'in'} which half of the transition */
    this._transitionPhase = 'out';
    /** @type {number} current overlay alpha (0–1) */
    this._transitionAlpha = 0;
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
   *
   * If a transition is already in progress, the call is ignored
   * to prevent double-triggering.
   *
   * @param {string} name
   */
  switchTo(name) {
    if (this._transitioning) {
      console.warn(`SceneManager: ignoring switchTo("${name}") — transition in progress.`);
      return;
    }

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

  /**
   * Fade to black, switch scene, fade in — centralized soft transition.
   * Input is blocked during the entire transition to prevent
   * double-triggering or gameplay logic running twice.
   *
   * @param {string} name         — target scene name
   * @param {number} [duration=400] — total transition duration in ms
   */
  fadeToScene(name, duration = 400) {
    if (this._transitioning) {
      console.warn(`SceneManager: ignoring fadeToScene("${name}") — transition in progress.`);
      return;
    }

    const nextScene = this._scenes[name];
    if (!nextScene) {
      console.error(`SceneManager: unknown scene "${name}"`);
      return;
    }

    this._transitioning = true;
    this._transitionTarget = name;
    this._transitionType = 'fade';
    this._transitionDuration = duration;
    this._transitionTimer = 0;
    this._transitionPhase = 'out';
    this._transitionAlpha = 0;
  }

  /**
   * Returns true if a scene transition is currently in progress.
   * Scenes can check this to block input during transitions.
   * @returns {boolean}
   */
  isTransitioning() {
    return this._transitioning;
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
    // ── Handle transition animation ─────────────────
    if (this._transitioning) {
      this._transitionTimer += dt;
      const halfDuration = this._transitionDuration / 2;
      const halfProgress = Math.min(1, this._transitionTimer / halfDuration);

      if (this._transitionPhase === 'out') {
        // Fade to black: alpha 0 → 1
        this._transitionAlpha = halfProgress;

        // Still update current scene while fading out
        if (this._currentScene) {
          this._currentScene.update(dt);
          this._layoutCurrentScene();
        }

        // Render current scene with darkening overlay
        this._app.clear();
        if (this._currentScene) {
          this._renderSceneBackground();
          this._app.beginViewportClip();
          this._currentScene.render(this._app.ctx);
          this._app.endViewportClip();
          this._renderSceneForeground();
        }
        this._renderTransitionOverlay();

        // At full black, switch scenes
        if (halfProgress >= 1) {
          this._executeSceneSwitch(this._transitionTarget);
          this._transitionPhase = 'in';
          this._transitionTimer = 0;
        }
      } else {
        // Fade in: alpha 1 → 0
        this._transitionAlpha = 1 - halfProgress;

        // Update and render new scene
        if (this._currentScene) {
          this._currentScene.update(dt);
          this._layoutCurrentScene();
        }

        this._app.clear();
        if (this._currentScene) {
          this._renderSceneBackground();
          this._app.beginViewportClip();
          this._currentScene.render(this._app.ctx);
          this._app.endViewportClip();
          this._renderSceneForeground();
        }
        this._renderTransitionOverlay();

        // Done
        if (halfProgress >= 1) {
          this._transitioning = false;
          this._transitionTarget = null;
          this._transitionAlpha = 0;
          console.log('SceneManager: transition complete.');
        }
      }
      return;
    }

    if (!this._currentScene) return;

    // Update
    this._currentScene.update(dt);

    // Layout (recalculate on every frame for responsiveness)
    this._layoutCurrentScene();

    // Render
    this._app.clear();
    this._renderSceneBackground();
    this._app.beginViewportClip();
    this._currentScene.render(this._app.ctx);
    this._app.endViewportClip();
    this._renderSceneForeground();
  }

  /**
   * Invoke the current scene's optional `renderBackground(ctx)` hook,
   * which runs after `clear()` but before the design-space viewport clip
   * is applied. Use it to paint full-canvas backgrounds (covering the
   * letterbox/pillarbox bars) without escaping the clip from inside render().
   */
  _renderSceneBackground() {
    const scene = this._currentScene;
    if (scene && typeof scene.renderBackground === 'function') {
      scene.renderBackground(this._app.ctx);
    }
  }

  /**
   * Invoke the current scene's optional `renderForeground(ctx)` hook,
   * which runs after the design-space viewport clip is closed. Use it to
   * paint full-canvas overlays that sit on top of the scene's UI — e.g.
   * a darkened map overlay or a post-battle reward splash that must cover
   * both the design space AND the letterbox/pillarbox bars.
   */
  _renderSceneForeground() {
    const scene = this._currentScene;
    if (scene && typeof scene.renderForeground === 'function') {
      scene.renderForeground(this._app.ctx);
    }
  }

  /**
   * Execute the actual scene switch (called at the midpoint of fade-to-black).
   * @param {string} name
   */
  _executeSceneSwitch(name) {
    const nextScene = this._scenes[name];
    if (!nextScene) return;

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

  /**
   * Draw a full-canvas black overlay at the current transition alpha.
   * Covers the entire physical canvas (including the letterbox/pillarbox
   * bars) so scene-driven full-canvas backgrounds fade out cleanly.
   */
  _renderTransitionOverlay() {
    if (this._transitionAlpha <= 0) return;
    this._app.fillFullCanvas(`rgba(0, 0, 0, ${this._transitionAlpha})`);
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
