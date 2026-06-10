import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';
import {
  RECIPE_LENGTH,
  getValidTagsForStep,
  isRecipeComplete,
  sampleTags,
  getTagLabel,
  getTagIcon,
} from '../data/skillWeaveTags.js';

/**
 * SkillWeaveScene — the "Weave a Power" skill reward screen.
 *
 * Staged TAG DRAFT: the player shapes a new skill by clicking one keyword tag
 * per step, filling a fixed-length recipe ([action, element, shape] today).
 * Each step shows up to 3 tags sampled from the valid pool for that slot (see
 * skillWeaveTags.js — the pool is grammar-derived so every path leads to a real
 * combo). When the recipe is full, Confirm resolves the final skill.
 *
 * Full-screen ritual scene (NOT a modal), modeled on TitleScreen/GameOverScene:
 * a looping background VIDEO (`video_skill_select_screen_bg`, an off-DOM muted
 * <video> drawn full-canvas each frame in renderBackground, same approach as
 * BossIntroScene/VideoPortrait) sits behind everything, falling back to the
 * static `skill_weave_background` image until the first frame decodes (or if
 * autoplay is blocked). All interactive UI is drawn + hit-tested manually in
 * design space from render()/_computeLayout().
 *
 * ── Animation system ───────────────────────────────────────────────────────
 * A lightweight animation layer (`_anim`) sits over the draft state. Input is
 * locked while an animation plays. Three animations:
 *   - INTRO  — the step's tags fan/grow OUT from a central focal point (the
 *              middle of their radius) to their rest positions. Played on enter
 *              and after every commit/back resolves.
 *   - COMMIT — the clicked tag flies + "pops" into the recipe slot it fills,
 *              while the other (unpicked) tags fade out. Then the next step's
 *              tags INTRO in.
 *   - BACK   — the reverse: the current step's tags collapse back toward the
 *              focal point (reverse INTRO), then the most-recent recipe tag
 *              pops out of its slot and flies back to its option position while
 *              the previous step's siblings fade back in.
 *
 * NOTE: skills are not implemented yet — _finishWeave is a placeholder that logs
 * the resolved tag recipe, then returns to the map (or fires _onComplete).
 *
 * Entry/exit: MapScene routes the `training` node here and sets `_onComplete` +
 * `_returnScene` so finishing completes the node and returns to the map.
 */

// ═══════════════════════════════════════════════════════════
// Tunable layout constants (design space: 1920×1080)
// ═══════════════════════════════════════════════════════════

const DESIGN_W = 1920;
const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

/**
 * Looping background video (rendered to canvas each frame). Path is relative to
 * index.html. NOT an AssetManager entry — the scene owns its own <video> (same
 * approach as BossIntroScene / VideoPortrait). The static `skill_weave_background`
 * image is the fallback until the first video frame decodes / if autoplay is blocked.
 */
const BACKGROUND_VIDEO_SRC = 'assets/audio/video/video_skill_select_screen_bg.mp4';

// ── Title / subtitle ──
const TITLE_TEXT = 'Weave a Power';
const TITLE_Y = 108;
const TITLE_SIZE = 70;
const TITLE_COLOR = '#e7c878';
const SUBTITLE_Y = 156;
const SUBTITLE_SIZE = 30;
const SUBTITLE_COLOR = '#9a86b8';
const SUBTITLE_CHOOSE = 'Choose a Tag';
const SUBTITLE_COMPLETE = 'Recipe Complete';

// ── Tag option plaques ──
const OPTION_W = 296;                 // height derives from the plaque art aspect
const OPTION_ICON_HEIGHT_FRAC = 0.34; // icon height as a fraction of plaque height
const OPTION_ICON_CENTER_FRAC = 0.36; // icon vertical center within the plaque
const OPTION_LABEL_CENTER_FRAC = 0.66;// label vertical center within the plaque
const OPTION_LABEL_SIZE = 33;
const OPTION_LABEL_COLOR = '#e2cd92';
const OPTION_HOVER_SCALE = 1.05;
const OPTION_GLOW_COLOR = 'rgba(185, 120, 255, 0.95)';

// ── Recipe container + slots ──
const RECIPE_W = 840;                 // height derives from the container art aspect
const RECIPE_TOP_Y = 560;
const RECIPE_HEADER_TEXT = 'Recipe';
const RECIPE_HEADER_SIZE = 31;
const RECIPE_HEADER_COLOR = '#d9c389';
const RECIPE_HEADER_CENTER_FRAC = 0.31; // header vertical center within container
const SLOT_W = 196;                   // height derives from the slot art aspect
const SLOT_GAP = 66;                  // gap between slots (a gold "+" sits here)
const SLOT_CENTER_FRAC = 0.63;        // slots vertical center within container
const SLOT_LABEL_SIZE = 31;
const SLOT_LABEL_COLOR = '#e2cd92';
const SLOT_PLUS_SIZE = 46;
const SLOT_PLUS_COLOR = '#c0a868';

// ── Bottom buttons ──
const BUTTON_W = 366;                 // height derives from the button art aspect
const BUTTON_GAP = 44;
const BUTTON_Y = 930;
const BUTTON_LABEL_SIZE = 32;
const BACK_LABEL = 'Back';
const CONFIRM_LABEL = 'Confirm';
const WEAVE_LABEL = 'Weave Power';

// ── Scene fade-in ──
const FADE_IN_DURATION = 420;         // ms
const INPUT_GRACE = 200;              // ms — ignore input right after entering
const PULSE_SPEED = 0.004;            // hover glow breathing speed

// ── Animation timings / feel ──
/** Per-tag fan-out duration (ms). */
const INTRO_OPTION_DUR = 320;
/** Stagger between successive tags fanning out (ms). */
const INTRO_STAGGER = 80;
/** Scale a tag starts at (at the focal point) before it grows to full. */
const INTRO_START_SCALE = 0.22;
/** Commit fly-to-slot duration (ms). */
const COMMIT_DUR = 380;
/** Fraction of COMMIT_DUR over which the unpicked tags finish fading out. */
const COMMIT_FADE_FRAC = 0.6;
/** Reverse-intro collapse duration on Back (ms). */
const BACK_COLLAPSE_DUR = 240;
/** Tag-returns-from-slot duration on Back (ms). */
const BACK_RETURN_DUR = 360;
/** Pop overshoot amount applied to the flying tag near its landing/exit. */
const FLY_POP = 0.14;

export default class SkillWeaveScene extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;

    this.backgroundAssetKey = 'skill_weave_background'; // static fallback for the video
    this.smoothing = true;

    // ── Background video (drawn full-canvas; falls back to the static image) ──
    /** @type {HTMLVideoElement|null} off-DOM looping video, painted each frame */
    this._bgVideo = null;

    // ── Fade-in / input grace ──
    this._elapsed = 0;
    this._fadeInDone = false;

    // ── Draft state ──
    /** @type {string[]} committed tag ids (length 0..RECIPE_LENGTH) */
    this._recipe = [];
    /**
     * Per-step option state, indexed by step (= _recipe.length while drafting).
     * Each entry: { options: string[], picked?: number }. `picked` records which
     * option index was committed at that step (set on commit) so Back can fly
     * the tag back to the right plaque. Kept across Back so the previous step's
     * exact options are restored (not re-sampled).
     * @type {Array<{options:string[], picked?:number}>}
     */
    this._steps = [];

    /** Guard so the final weave/transition fires exactly once. */
    this._finishing = false;

    /**
     * Active animation, or null when idle. Shapes by kind:
     *   intro: { kind, time, total, focal:{x,y}, items:[{tagId, rect}] }
     *   commit:{ kind, time, flying:{tagId, from, to}, fading:[{tagId, rect}],
     *            landingSlot, nextIntro }
     *   back:  { kind, time, phase:1|2, focal:{x,y}, collapsing:[{tagId, rect}],
     *            hold:{tagId, slotRect}, returning:{tagId, from, to},
     *            fadingIn:[{tagId, rect}], returningSlot }
     * @type {object|null}
     */
    this._anim = null;

    // ── Hover state (idle only) ──
    this._hoverOption = -1;            // index into the current step's options
    this._hoverButton = null;         // 'back' | 'confirm' | null

    /** Total elapsed time for the hover glow pulse (ms). */
    this._pulseTime = 0;

    // ── Integration callback (set by MapScene; optional) ──
    /** Called once when the weave is confirmed: ({ recipe: string[] }) => void */
    this._onComplete = null;
    /** Scene to return to when finished (default: the map). */
    this._returnScene = 'MapScene';

    this._handleMouseDown = this._onMouseDown.bind(this);
    this._handleMouseMove = this._onMouseMove.bind(this);
    this._handleKeyDown = this._onKeyDown.bind(this);

    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  /**
   * Configure the scene before fading to it.
   * @param {object} opts
   * @param {Function} [opts.onComplete] — invoked when the weave is confirmed
   * @param {string}   [opts.returnScene] — scene to fade to on finish
   */
  configure({ onComplete = null, returnScene = 'MapScene' } = {}) {
    this._onComplete = typeof onComplete === 'function' ? onComplete : null;
    this._returnScene = returnScene || 'MapScene';
  }

  // ═══════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════

  onEnter() {
    this._elapsed = 0;
    this._fadeInDone = false;
    this._pulseTime = 0;

    // Fresh draft each entry.
    this._recipe = [];
    this._steps = [];
    this._finishing = false;
    this._anim = null;
    this._hoverOption = -1;
    this._hoverButton = null;
    this._buildStep();
    this._startIntro();   // fan the first step's tags out on load

    // The skill-weave background is drawn full-canvas in renderBackground;
    // clear any battle bar-fill image so it doesn't show through the bars.
    const app = this._sceneManager && this._sceneManager._app;
    if (app && app.setBackgroundImage) app.setBackgroundImage(null);

    // Spin up the looping background video (muted, off-DOM, drawn to canvas).
    this._createBackgroundVideo();

    AudioManager.playSfx('sfx_rewards_open');

    const input = this._sceneManager._input;
    input.on('mousedown', this._handleMouseDown);
    input.on('mousemove', this._handleMouseMove);
    input.on('keydown', this._handleKeyDown);
    input.canvas.focus();
  }

  onExit() {
    const input = this._sceneManager._input;
    input.off('mousedown', this._handleMouseDown);
    input.off('mousemove', this._handleMouseMove);
    input.off('keydown', this._handleKeyDown);
    this._destroyBackgroundVideo();
  }

  // ── Background video setup / teardown ──────────────────────

  /**
   * Create + play the looping, muted, off-DOM background video. Its frames are
   * drawn full-canvas in renderBackground. The static image fallback stays up
   * until the first frame decodes (or permanently if autoplay is blocked).
   */
  _createBackgroundVideo() {
    this._destroyBackgroundVideo();

    const video = document.createElement('video');
    video.src = BACKGROUND_VIDEO_SRC;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;  // smooth inline playback on mobile
    video.preload = 'auto';
    video.loop = true;         // background loops for as long as the scene is up

    // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the video's
    // intrinsic size so the cover-fit math works for the <video>.
    video.addEventListener('loadedmetadata', () => {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    });

    this._bgVideo = video;

    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      // Autoplay blocked / load failure — the static image fallback remains.
      playResult.catch(() => {});
    }
  }

  _destroyBackgroundVideo() {
    if (!this._bgVideo) return;
    try { this._bgVideo.pause(); } catch (e) { /* ignore */ }
    this._bgVideo.removeAttribute('src');
    try { this._bgVideo.load(); } catch (e) { /* ignore */ }
    this._bgVideo = null;
  }

  // ═══════════════════════════════════════════════════════════
  // Draft state machine
  // ═══════════════════════════════════════════════════════════

  /** Build the option set for the current step (samples up to 3 valid tags). */
  _buildStep() {
    if (isRecipeComplete(this._recipe)) return;
    const pool = getValidTagsForStep(this._recipe);
    const options = sampleTags(pool, 3);
    this._steps[this._recipe.length] = { options };
  }

  /** @returns {{options:string[], picked?:number}|null} current step state */
  _currentStep() {
    if (isRecipeComplete(this._recipe)) return null;
    return this._steps[this._recipe.length] || null;
  }

  get _complete() {
    return isRecipeComplete(this._recipe);
  }

  get _animBusy() {
    return this._anim !== null;
  }

  get _backEnabled() {
    return this._recipe.length > 0 && !this._finishing && !this._animBusy;
  }

  /** Confirm is only the final "create the skill" action — active once full. */
  get _confirmEnabled() {
    return this._complete && !this._finishing && !this._animBusy;
  }

  /**
   * Pick an option — commits it into the next recipe slot and advances. Tags are
   * chosen by clicking; only the final CONFIRM (recipe full) resolves the skill.
   * Kicks off the COMMIT animation; the model is mutated up-front so the slot/
   * next-step data the animation needs already exists.
   */
  _pickOption(index) {
    if (this._finishing || this._complete || this._animBusy) return;
    const step = this._currentStep();
    if (!step || index < 0 || index >= step.options.length) return;

    const committedStep = this._recipe.length;
    const count = step.options.length;
    const restRects = this._optionRestRects(count);
    const tagId = step.options[index];
    const slotRect = this._slotRects()[committedStep];

    const fading = [];
    for (let j = 0; j < count; j++) {
      if (j === index) continue;
      fading.push({ tagId: step.options[j], rect: restRects[j] });
    }

    // ── Mutate the model up-front ──
    step.picked = index;
    this._recipe.push(tagId);
    const nextIntro = !this._complete;
    if (nextIntro) this._buildStep();

    AudioManager.playSfx('sfx_map_click_node');
    this._hoverOption = -1;
    this._hoverButton = null;

    this._anim = {
      kind: 'commit',
      time: 0,
      flying: { tagId, from: restRects[index], to: slotRect },
      fading,
      landingSlot: committedStep,
      nextIntro,
    };
  }

  /** Confirm = resolve the completed recipe (no-op until full). */
  _confirm() {
    if (!this._confirmEnabled) return;
    this._finishWeave();
  }

  /**
   * Remove the most recent tag (reverse of a commit). Kicks off the BACK
   * animation: the current step's tags collapse toward the focal point, then
   * the popped tag flies from its slot back to its plaque while the previous
   * step's siblings fade in.
   */
  _back() {
    if (!this._backEnabled) return;

    const leavingStepIndex = this._recipe.length;      // step we're abandoning
    const prevStepIndex = leavingStepIndex - 1;
    const prevStep = this._steps[prevStepIndex];
    if (!prevStep) return;

    const pickedIndex = Number.isInteger(prevStep.picked) ? prevStep.picked : 0;
    const prevCount = prevStep.options.length;
    const prevRects = this._optionRestRects(prevCount);
    const tagId = this._recipe[prevStepIndex];
    const slotRect = this._slotRects()[prevStepIndex];

    // Current (now-leaving) step's tags collapse back to their focal point.
    const leavingStep = this._steps[leavingStepIndex];
    let collapsing = [];
    let focal;
    if (leavingStep) {
      const curRects = this._optionRestRects(leavingStep.options.length);
      focal = this._focalFor(curRects);
      collapsing = leavingStep.options.map((tid, i) => ({ tagId: tid, rect: curRects[i] }));
    } else {
      // Backing out of the completed state — nothing to collapse.
      focal = this._focalFor(prevRects);
    }

    const fadingIn = [];
    for (let j = 0; j < prevCount; j++) {
      if (j === pickedIndex) continue;
      fadingIn.push({ tagId: prevStep.options[j], rect: prevRects[j] });
    }

    // ── Mutate the model up-front ──
    this._recipe.pop();
    this._steps.length = leavingStepIndex;   // drop the leaving step
    delete prevStep.picked;

    AudioManager.playSfx('sfx_map_overlay_close');
    this._hoverOption = -1;
    this._hoverButton = null;

    this._anim = {
      kind: 'back',
      time: 0,
      phase: collapsing.length > 0 ? 1 : 2,
      focal,
      collapsing,
      hold: { tagId, slotRect },
      returning: { tagId, from: slotRect, to: prevRects[pickedIndex] },
      fadingIn,
      returningSlot: prevStepIndex,
    };
  }

  /**
   * Resolve the completed recipe into a skill reward (PLACEHOLDER).
   *
   * Skills are not implemented yet, so this only logs the chosen tag path,
   * fires the optional onComplete callback (so the host can grant/record the
   * reward + complete the map node), and returns to the map.
   */
  _finishWeave() {
    if (this._finishing) return;
    this._finishing = true;

    const recipe = this._recipe.slice();
    console.log(`[SkillWeave] Recipe woven: [${recipe.join(' + ')}] — skill resolution is a placeholder.`);
    AudioManager.playSfx('sfx_extra_turn');

    if (this._onComplete) {
      this._onComplete({ recipe });
    }

    const sm = this._sceneManager;
    if (sm && typeof sm.fadeToScene === 'function') {
      sm.fadeToScene(this._returnScene, 450);
    }
  }

  // ── Animation kick-off / advance ───────────────────────────

  /** Start the fan-out INTRO for the current step's tags (no-op if complete). */
  _startIntro() {
    const step = this._currentStep();
    if (!step) { this._anim = null; return; }
    const count = step.options.length;
    const rects = this._optionRestRects(count);
    const focal = this._focalFor(rects);
    this._anim = {
      kind: 'intro',
      time: 0,
      total: INTRO_OPTION_DUR + INTRO_STAGGER * Math.max(0, count - 1),
      focal,
      items: step.options.map((tagId, i) => ({ tagId, rect: rects[i] })),
    };
  }

  /** Advance the active animation; transition to the next phase/animation. */
  _advanceAnim(dt) {
    const a = this._anim;
    if (!a) return;
    a.time += dt;

    if (a.kind === 'intro') {
      if (a.time >= a.total) this._anim = null;
    } else if (a.kind === 'commit') {
      if (a.time >= COMMIT_DUR) {
        if (a.nextIntro) this._startIntro();   // fan the next step's tags in
        else this._anim = null;                // recipe complete — settle
      }
    } else if (a.kind === 'back') {
      if (a.phase === 1 && a.time >= BACK_COLLAPSE_DUR) {
        a.phase = 2;
        a.time = 0;
      } else if (a.phase === 2 && a.time >= BACK_RETURN_DUR) {
        this._anim = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Input
  // ═══════════════════════════════════════════════════════════

  _onMouseDown(x, y) {
    if (!this._inputReady()) return;
    const layout = this._computeLayout();

    // Tag options — clicking commits the tag straight into the recipe.
    for (let i = 0; i < layout.options.length; i++) {
      if (this._inRect(x, y, layout.options[i])) {
        this._pickOption(i);
        return;
      }
    }

    if (this._backEnabled && this._inRect(x, y, layout.backButton)) {
      this._back();
      return;
    }

    if (this._confirmEnabled && this._inRect(x, y, layout.confirmButton)) {
      this._confirm();
    }
  }

  _onMouseMove(x, y) {
    if (!this._inputReady()) {
      this._hoverOption = -1;
      this._hoverButton = null;
      return;
    }
    const layout = this._computeLayout();

    let newOption = -1;
    for (let i = 0; i < layout.options.length; i++) {
      if (this._inRect(x, y, layout.options[i])) { newOption = i; break; }
    }

    let newButton = null;
    if (this._inRect(x, y, layout.backButton)) newButton = 'back';
    else if (this._inRect(x, y, layout.confirmButton)) newButton = 'confirm';

    // Hover sfx when moving onto a fresh, interactable target.
    const changed = newOption !== this._hoverOption || newButton !== this._hoverButton;
    const onInteractable =
      newOption >= 0 ||
      (newButton === 'back' && this._backEnabled) ||
      (newButton === 'confirm' && this._confirmEnabled);
    if (changed && onInteractable) {
      AudioManager.playSfx('ui_button_hover');
    }

    this._hoverOption = newOption;
    this._hoverButton = newButton;
  }

  _onKeyDown(e) {
    if (!this._inputReady()) return;
    const key = e && (e.key || e.code);
    if (key === 'Enter' && this._confirmEnabled) this._confirm();
    else if ((key === 'Backspace' || key === 'Escape') && this._backEnabled) this._back();
  }

  _inputReady() {
    if (!this._sceneManager || this._sceneManager._currentScene !== this) return false;
    if (this._sceneManager.isTransitioning && this._sceneManager.isTransitioning()) return false;
    if (this._finishing || this._animBusy) return false;
    return this._elapsed >= INPUT_GRACE;
  }

  _inRect(x, y, r) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ═══════════════════════════════════════════════════════════
  // Update
  // ═══════════════════════════════════════════════════════════

  update(dt) {
    this._elapsed += dt;
    this._pulseTime += dt;
    if (this._elapsed >= FADE_IN_DURATION) this._fadeInDone = true;
    this._advanceAnim(dt);
    super.update(dt);
  }

  // ═══════════════════════════════════════════════════════════
  // Layout
  // ═══════════════════════════════════════════════════════════

  _asset(key) {
    const am = this._sceneManager && this._sceneManager.assetManager;
    return am ? am.get(key) : null;
  }

  _aspect(key, fallback) {
    const img = this._asset(key);
    return (img && img.width && img.height) ? img.width / img.height : fallback;
  }

  /** Triangle / row anchors for the option plaques, by visible count. */
  _optionAnchors(count) {
    const cx = DESIGN_W / 2;
    if (count <= 1) return [{ cx, cy: 360 }];
    if (count === 2) return [{ cx: cx - 226, cy: 398 }, { cx: cx + 226, cy: 398 }];
    return [
      { cx, cy: 296 },
      { cx: cx - 250, cy: 472 },
      { cx: cx + 250, cy: 472 },
    ];
  }

  /** Rest rects for `count` option plaques (no tag/index — pure geometry). */
  _optionRestRects(count) {
    const optionAspect = this._aspect('ui_skill_weave_option_container', 1121 / 680);
    const optW = OPTION_W;
    const optH = optW / optionAspect;
    const anchors = this._optionAnchors(count);
    const rects = [];
    for (let i = 0; i < count; i++) {
      const a = anchors[i] || anchors[anchors.length - 1];
      rects.push({ x: a.cx - optW / 2, y: a.cy - optH / 2, w: optW, h: optH });
    }
    return rects;
  }

  /** The focal point a set of option rects fans out from (centroid of centers). */
  _focalFor(rects) {
    if (!rects.length) return { x: DESIGN_W / 2, y: 430 };
    let sx = 0;
    let sy = 0;
    for (const r of rects) { sx += r.x + r.w / 2; sy += r.y + r.h / 2; }
    return { x: sx / rects.length, y: sy / rects.length };
  }

  /** Recipe container rect. */
  _recipeRect() {
    const recipeAspect = this._aspect('ui_skill_weave_container', 1376 / 570);
    const recW = RECIPE_W;
    const recH = recW / recipeAspect;
    return { x: (DESIGN_W - recW) / 2, y: RECIPE_TOP_Y, w: recW, h: recH };
  }

  /** The RECIPE_LENGTH slot rects centered in the recipe container. */
  _slotRects() {
    const recipe = this._recipeRect();
    const slotAspect = this._aspect('ui_skill_weave_selection_blank_container', 989 / 593);
    const slotW = SLOT_W;
    const slotH = slotW / slotAspect;
    const slotsTotalW = RECIPE_LENGTH * slotW + (RECIPE_LENGTH - 1) * SLOT_GAP;
    const slotsStartX = recipe.x + (recipe.w - slotsTotalW) / 2;
    const slotsCenterY = recipe.y + recipe.h * SLOT_CENTER_FRAC;
    const slots = [];
    for (let i = 0; i < RECIPE_LENGTH; i++) {
      slots.push({
        x: slotsStartX + i * (slotW + SLOT_GAP),
        y: slotsCenterY - slotH / 2,
        w: slotW,
        h: slotH,
      });
    }
    return slots;
  }

  /**
   * Compute every interactive rect (options, recipe container + slots, buttons).
   * Used for hit-testing (idle) + static recipe/button rendering.
   */
  _computeLayout() {
    const step = this._currentStep();
    const optionTags = step ? step.options : [];
    const rects = this._optionRestRects(optionTags.length);
    const options = optionTags.map((tagId, i) => ({
      x: rects[i].x, y: rects[i].y, w: rects[i].w, h: rects[i].h, tagId, index: i,
    }));

    const recipe = this._recipeRect();
    const slots = this._slotRects();

    const btnAspect = this._aspect('ui_skill_weave_button', 1349 / 288);
    const btnW = BUTTON_W;
    const btnH = btnW / btnAspect;
    const pairW = btnW * 2 + BUTTON_GAP;
    const pairStartX = (DESIGN_W - pairW) / 2;
    const backButton = { x: pairStartX, y: BUTTON_Y, w: btnW, h: btnH };
    const confirmButton = { x: pairStartX + btnW + BUTTON_GAP, y: BUTTON_Y, w: btnW, h: btnH };

    return { options, recipe, slots, backButton, confirmButton };
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  /**
   * Full-canvas cover-fit background (covers letterbox bars), with fade-in.
   * Draws the looping background video once its first frame is decodable;
   * falls back to the static `skill_weave_background` image until then (or
   * permanently if autoplay was blocked / the video errored).
   */
  renderBackground(ctx) {
    const sm = this._sceneManager;
    if (!sm) return;
    const alpha = this._fadeInDone ? 1 : Math.min(1, this._elapsed / FADE_IN_DURATION);

    const video = this._bgVideo;
    if (video && video.readyState >= 2) { // 2 = HAVE_CURRENT_DATA
      sm._app.drawFullCanvasImage(video, alpha);
      return;
    }

    const img = this._asset(this.backgroundAssetKey);
    if (img) sm._app.drawFullCanvasImage(img, alpha);
  }

  render(ctx) {
    const alpha = this._fadeInDone ? 1 : Math.min(1, this._elapsed / FADE_IN_DURATION);
    const layout = this._computeLayout();

    ctx.save();
    ctx.globalAlpha = alpha;

    this._renderTitle(ctx);
    this._renderOptions(ctx, layout);
    this._renderRecipe(ctx, layout);
    this._renderFlyingTag(ctx);     // commit/back travelling tag — on top of recipe
    this._renderButtons(ctx, layout);

    ctx.restore();
  }

  /** No flex children — everything is drawn manually in render(). */
  renderSelf(_ctx) {}

  // ── Render: title ──────────────────────────────────────────

  _renderTitle(ctx) {
    const cx = DESIGN_W / 2;
    this._drawText(ctx, TITLE_TEXT, cx, TITLE_Y, {
      size: TITLE_SIZE, color: TITLE_COLOR, bold: false,
      letterSpacing: 4, shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.7)',
    });
    const subtitle = this._complete ? SUBTITLE_COMPLETE : SUBTITLE_CHOOSE;
    this._drawText(ctx, subtitle, cx, SUBTITLE_Y, {
      size: SUBTITLE_SIZE, color: SUBTITLE_COLOR, letterSpacing: 3,
      shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.6)',
    });
  }

  // ── Render: option plaques (anim-aware) ────────────────────

  _renderOptions(ctx, layout) {
    const a = this._anim;
    const pulse = 0.5 + 0.5 * Math.sin(this._pulseTime * PULSE_SPEED);

    if (!a) {
      // Idle: current step at rest, with hover grow + glow.
      for (const opt of layout.options) {
        const hovered = this._hoverOption === opt.index;
        const scale = hovered ? OPTION_HOVER_SCALE : 1;
        const glow = hovered ? 26 + pulse * 16 : 0;
        this._drawOptionTransformed(ctx, opt, opt.tagId,
          { center: this._center(opt), scale, alpha: 1, glow, bright: hovered });
      }
      return;
    }

    if (a.kind === 'intro') {
      for (let i = 0; i < a.items.length; i++) {
        const it = a.items[i];
        const local = this._clamp01((a.time - i * INTRO_STAGGER) / INTRO_OPTION_DUR);
        const e = this._easeOutCubic(local);
        const scale = this._lerp(INTRO_START_SCALE, 1, e);
        const center = this._lerpPt(a.focal, this._center(it.rect), e);
        const alpha = this._clamp01(local * 1.5);
        this._drawOptionTransformed(ctx, it.rect, it.tagId, { center, scale, alpha });
      }
      return;
    }

    if (a.kind === 'commit') {
      // The unpicked tags fade out (the picked one flies — see _renderFlyingTag).
      const ft = this._clamp01(a.time / (COMMIT_DUR * COMMIT_FADE_FRAC));
      const alpha = 1 - this._easeOutCubic(ft);
      const scale = 1 - 0.12 * ft;
      for (const it of a.fading) {
        this._drawOptionTransformed(ctx, it.rect, it.tagId,
          { center: this._center(it.rect), scale, alpha });
      }
      return;
    }

    if (a.kind === 'back') {
      if (a.phase === 1) {
        // Reverse INTRO: the leaving step's tags collapse toward the focal point.
        const p = this._clamp01(a.time / BACK_COLLAPSE_DUR);
        const e = this._easeInCubic(p);
        const scale = this._lerp(1, INTRO_START_SCALE, e);
        const alpha = 1 - this._clamp01(p * 1.3);
        for (const it of a.collapsing) {
          const center = this._lerpPt(this._center(it.rect), a.focal, e);
          this._drawOptionTransformed(ctx, it.rect, it.tagId, { center, scale, alpha });
        }
      } else {
        // The previous step's siblings fade back in at rest (returning tag flies).
        const p = this._clamp01(a.time / BACK_RETURN_DUR);
        const e = this._easeOutCubic(p);
        const scale = this._lerp(0.85, 1, e);
        for (const it of a.fadingIn) {
          this._drawOptionTransformed(ctx, it.rect, it.tagId,
            { center: this._center(it.rect), scale, alpha: e });
        }
      }
    }
  }

  /**
   * Draw a tag plaque (plaque art + icon + label) anchored at `restRect`, but
   * scaled about its center and repositioned so its center sits at `center`,
   * with `alpha` and an optional glow. Used by every option animation path.
   */
  _drawOptionTransformed(ctx, restRect, tagId, { center, scale = 1, alpha = 1, glow = 0, bright = false }) {
    if (alpha <= 0.001) return;
    const c0 = this._center(restRect);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(center.x, center.y);
    ctx.scale(scale, scale);
    ctx.translate(-c0.x, -c0.y);
    this._paintOption(ctx, restRect, tagId, { glow, bright });
    ctx.restore();
  }

  /** Paint an option plaque at `rect` (no transform/alpha — caller owns those). */
  _paintOption(ctx, rect, tagId, { glow = 0, bright = false } = {}) {
    const img = this._asset('ui_skill_weave_option_container');

    if (glow > 0 && img) {
      ctx.save();
      ctx.shadowColor = OPTION_GLOW_COLOR;
      ctx.shadowBlur = glow;
      this._drawImageRect(ctx, img, rect);
      ctx.restore();
    }

    if (img) this._drawImageRect(ctx, img, rect);
    else this._drawFallbackPlaque(ctx, rect);

    this._paintIcon(ctx, rect, tagId);

    this._drawText(ctx, getTagLabel(tagId),
      rect.x + rect.w / 2, rect.y + rect.h * OPTION_LABEL_CENTER_FRAC, {
        size: OPTION_LABEL_SIZE * (rect.w / OPTION_W),
        color: bright ? '#f4e6b8' : OPTION_LABEL_COLOR,
        baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.65)',
      });
  }

  _paintIcon(ctx, rect, tagId) {
    const img = this._asset(getTagIcon(tagId));
    const iconH = rect.h * OPTION_ICON_HEIGHT_FRAC;
    const aspect = (img && img.width && img.height) ? img.width / img.height : (138 / 196);
    const iconW = iconH * aspect;
    const ix = rect.x + rect.w / 2 - iconW / 2;
    const iy = rect.y + rect.h * OPTION_ICON_CENTER_FRAC - iconH / 2;
    if (img) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, ix, iy, iconW, iconH);
      ctx.imageSmoothingEnabled = prev;
    }
  }

  // ── Render: recipe (anim-aware slot content) ───────────────

  _renderRecipe(ctx, layout) {
    const containerImg = this._asset('ui_skill_weave_container');
    if (containerImg) this._drawImageRect(ctx, containerImg, layout.recipe);
    else this._drawFallbackPlaque(ctx, layout.recipe);

    this._drawText(ctx, RECIPE_HEADER_TEXT,
      layout.recipe.x + layout.recipe.w / 2,
      layout.recipe.y + layout.recipe.h * RECIPE_HEADER_CENTER_FRAC, {
        size: RECIPE_HEADER_SIZE, color: RECIPE_HEADER_COLOR,
        letterSpacing: 2, baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.6)',
      });

    const a = this._anim;
    for (let i = 0; i < layout.slots.length; i++) {
      const slot = layout.slots[i];

      // Decide what this slot shows (the travelling tag is drawn separately on
      // top — for the slot it's flying into/out of we suppress the static tag).
      if (a && a.kind === 'commit' && i === a.landingSlot) {
        this._drawSlotFilled(ctx, slot, null);                 // frame only; tag is in flight
      } else if (a && a.kind === 'back' && i === a.returningSlot) {
        if (a.phase === 1) this._drawSlotFilled(ctx, slot, a.hold.tagId); // tag still seated
        else this._drawSlotBlank(ctx, slot);                   // tag flying back out
      } else if (i < this._recipe.length) {
        this._drawSlotFilled(ctx, slot, this._recipe[i]);
      } else {
        this._drawSlotBlank(ctx, slot);
      }

      if (i < layout.slots.length - 1) {
        const next = layout.slots[i + 1];
        const plusX = (slot.x + slot.w + next.x) / 2;
        const plusY = slot.y + slot.h / 2;
        this._drawText(ctx, '+', plusX, plusY, {
          size: SLOT_PLUS_SIZE, color: SLOT_PLUS_COLOR, baseline: 'middle',
          shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.6)',
        });
      }
    }
  }

  /** Filled slot frame + optional centered tag label (null label = frame only). */
  _drawSlotFilled(ctx, slot, tagId) {
    const filledImg = this._asset('ui_skill_weave_selection_container');
    if (filledImg) this._drawImageRect(ctx, filledImg, slot);
    else this._drawFallbackPlaque(ctx, slot);
    if (tagId) {
      this._drawText(ctx, getTagLabel(tagId), slot.x + slot.w / 2, slot.y + slot.h / 2, {
        size: SLOT_LABEL_SIZE, color: SLOT_LABEL_COLOR, baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.65)',
      });
    }
  }

  /** Empty slot — the blank art bakes in the "[ ? ]" glyph. */
  _drawSlotBlank(ctx, slot) {
    const blankImg = this._asset('ui_skill_weave_selection_blank_container');
    if (blankImg) {
      this._drawImageRect(ctx, blankImg, slot);
    } else {
      this._drawFallbackPlaque(ctx, slot);
      this._drawText(ctx, '[ ? ]', slot.x + slot.w / 2, slot.y + slot.h / 2,
        { size: SLOT_LABEL_SIZE, color: '#8a7c54', baseline: 'middle' });
    }
  }

  // ── Render: travelling tag (commit fly-in / back fly-out) ──

  _renderFlyingTag(ctx) {
    const a = this._anim;
    if (!a) return;

    if (a.kind === 'commit') {
      const t = this._clamp01(a.time / COMMIT_DUR);
      const e = this._easeInOutCubic(t);
      const rect = this._lerpRect(a.flying.from, a.flying.to, e);
      // Pop overshoot as it lands (peaks in the last third).
      const pop = 1 + FLY_POP * Math.sin(Math.PI * this._clamp01((t - 0.66) / 0.34));
      this._drawOptionTransformed(ctx, rect, a.flying.tagId,
        { center: this._center(rect), scale: pop, alpha: 1, glow: 14 });
    } else if (a.kind === 'back' && a.phase === 2) {
      const t = this._clamp01(a.time / BACK_RETURN_DUR);
      const e = this._easeInOutCubic(t);
      const rect = this._lerpRect(a.returning.from, a.returning.to, e);
      // Pop as it leaves the slot (peaks in the first third).
      const pop = 1 + FLY_POP * Math.sin(Math.PI * this._clamp01((0.34 - t) / 0.34));
      this._drawOptionTransformed(ctx, rect, a.returning.tagId,
        { center: this._center(rect), scale: pop, alpha: 1, glow: 14 });
    }
  }

  // ── Render: buttons ────────────────────────────────────────

  _renderButtons(ctx, layout) {
    // Visual-enabled ignores the input lock (animBusy) so buttons don't flicker
    // dim during the brief commit/back/intro animations; clicks are still gated
    // by _backEnabled / _confirmEnabled (which DO include the lock).
    const backVisualEnabled = this._recipe.length > 0 && !this._finishing;
    const confirmVisualEnabled = this._complete && !this._finishing;

    this._drawButton(ctx, layout.backButton, BACK_LABEL, {
      variant: 'back',
      enabled: backVisualEnabled,
      hovered: this._hoverButton === 'back',
    });

    this._drawButton(ctx, layout.confirmButton,
      this._complete ? WEAVE_LABEL : CONFIRM_LABEL, {
        variant: 'confirm',
        enabled: confirmVisualEnabled,
        hovered: this._hoverButton === 'confirm',
      });
  }

  /**
   * Draw a bottom button. Both buttons share the same plaque art; enabled
   * buttons brighten on hover, disabled buttons are dimmed. (Confirm just reads
   * a touch brighter gold when it's the active final action — no color tint.)
   */
  _drawButton(ctx, rect, label, { variant, enabled, hovered }) {
    const img = this._asset('ui_skill_weave_button');

    ctx.save();
    const baseAlpha = enabled ? (hovered ? 1 : 0.92) : 0.42;
    ctx.globalAlpha *= baseAlpha;

    if (img) this._drawImageRect(ctx, img, rect);
    else this._drawFallbackPlaque(ctx, rect);

    let labelColor;
    if (variant === 'confirm') labelColor = enabled ? '#f4e8c4' : '#6b6450';
    else labelColor = enabled ? '#d7c290' : '#6b6450';
    this._drawText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
      size: BUTTON_LABEL_SIZE, color: labelColor, baseline: 'middle',
      letterSpacing: 2, shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.7)',
    });

    ctx.restore();
  }

  // ── Low-level draw + math utilities ────────────────────────

  _center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  _clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  _lerp(a, b, t) { return a + (b - a) * t; }
  _lerpPt(a, b, t) { return { x: this._lerp(a.x, b.x, t), y: this._lerp(a.y, b.y, t) }; }
  _lerpRect(a, b, t) {
    return {
      x: this._lerp(a.x, b.x, t), y: this._lerp(a.y, b.y, t),
      w: this._lerp(a.w, b.w, t), h: this._lerp(a.h, b.h, t),
    };
  }
  _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  _easeInCubic(t) { return t * t * t; }
  _easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  _drawImageRect(ctx, img, r) {
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = prev;
  }

  _drawFallbackPlaque(ctx, r) {
    this._fillRoundedRect(ctx, r.x, r.y, r.w, r.h, 12, 'rgba(26, 18, 40, 0.9)');
    this._strokeRoundedRect(ctx, r.x, r.y, r.w, r.h, 12, 'rgba(180, 150, 90, 0.8)', 2);
  }

  _drawText(ctx, text, x, y, opts = {}) {
    const {
      size = 28, color = '#e2cd92', bold = false,
      align = 'center', baseline = 'alphabetic',
      letterSpacing = 0, shadowBlur = 0, shadowColor = 'rgba(0,0,0,0.6)',
    } = opts;
    ctx.save();
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (shadowBlur > 0) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
    }
    if (letterSpacing && 'letterSpacing' in ctx) {
      try { ctx.letterSpacing = `${letterSpacing}px`; } catch (_) { /* ignore */ }
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  _roundedRectPath(ctx, x, y, w, h, rad) {
    const r = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _fillRoundedRect(ctx, x, y, w, h, rad, fill) {
    ctx.save();
    this._roundedRectPath(ctx, x, y, w, h, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  _strokeRoundedRect(ctx, x, y, w, h, rad, stroke, lineWidth) {
    ctx.save();
    this._roundedRectPath(ctx, x, y, w, h, rad);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }
}
