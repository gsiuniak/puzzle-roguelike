import UIPanel from '../ui/UIPanel.js';
import AudioManager from '../audio/AudioManager.js';
import {
  drawTagsForRound,
  getTagLabel,
  getTagRarity,
} from '../data/skillWeaveTags.js';
import { TAG_RARITY, rollRoundsPerWeave, rollTagsPerRound, COLOR_AFFINITY_WEIGHT } from '../data/weaveConfig.js';
import { synthesize } from '../data/skillSynthesizer.js';
import { getSpellIcon } from '../icons/spellIcons.js';
import HarvestTendrilEffect from '../ui/HarvestTendrilEffect.js';
import KeywordText from '../ui/KeywordText.js';

/**
 * SkillWeaveScene — the "Weave a Power" skill reward screen.
 *
 * Staged TAG DRAFT: the player shapes a new skill by clicking one keyword tag
 * per ROUND, filling a recipe whose length is the number of rounds. The weave
 * shape is rolled per entry (see weaveConfig): 2–4 ROUNDS, and each round shows
 * 2–4 tag options drawn rarity-weighted from one global pool (round 0 soft-
 * guarantees an action). When the recipe is full, Confirm SYNTHESIZES the bag
 * into a skill (skillSynthesizer — a stub today). Option plaque art is rarity-
 * suffixed (`ui_skill_weave_option_container_<rarity>`; common uses the base).
 *
 * Full-screen ritual scene (NOT a modal), modeled on TitleScreen/GameOverScene.
 * The background is toggleable via USE_BACKGROUND_VIDEO: currently the static
 * `skill_weave_background` image (default), or a looping VIDEO
 * (`video_skill_select_screen_bg`, an off-DOM muted <video> drawn full-canvas
 * each frame in renderBackground, same approach as BossIntroScene/VideoPortrait,
 * with the static image as the until-decoded / autoplay-blocked fallback). All
 * interactive UI is drawn + hit-tested manually in design space from
 * render()/_computeLayout().
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
 * _finishWeave synthesizes the bag into a REAL skill (skillSynthesizer —
 * effects, randomized mana cost, generated name/description), generates the
 * spell's procedural icon (spellIcons.getSpellIcon) and attaches it
 * (skill.icon), then enters a RESULT phase: the icon + skill summary (name,
 * cost, description, inert tags) are shown where the tag options were and the
 * confirm button becomes "Continue". _finishContinue then fires _onComplete
 * (payload { recipe, synthesis, icon }) — MapScene stores synthesis.skill on
 * runState.skills (the award) — and returns to the map.
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
 * Background mode toggle. When false (current default) the static
 * `skill_weave_background` image is used. Flip to true to play the looping
 * video background instead — all the video machinery stays wired either way.
 */
const USE_BACKGROUND_VIDEO = false;

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
/**
 * Vertical gradient for the title text (top → bottom color stops). Gives the
 * "Weave a Power" wordmark the soft light-to-rich gold sheen seen in the mock.
 */
const TITLE_GRADIENT = [
  [0.0, '#ece0b6'],  // bright highlight at the top of the letters
  [0.5, '#e3c688'],  // mid gold (base color)
  [1.0, '#a27e46'],  // richer/darker gold at the baseline
];
const SUBTITLE_Y = 154;
const SUBTITLE_SIZE = 25;
const SUBTITLE_COLOR = '#9a86b8';
const SUBTITLE_CHOOSE = 'Choose a Tag';
const SUBTITLE_COMPLETE = 'Recipe Complete';

// ── Title flair (ornate divider beneath the title/subtitle block) ──
const TITLE_FLAIR_KEY = 'ui_skill_weave_title_flair';
const TITLE_FLAIR_CENTER_Y = 192;     // vertical center of the flair divider
const TITLE_FLAIR_WIDTH = 440;        // rendered width (height derives from art aspect)
const TITLE_FLAIR_FALLBACK_ASPECT = 1014 / 92;

// ── Tag option plaques ──
const OPTION_W = 270;                 // base plaque width (label scaling reference)
/** Plaque width by visible option count (full size across all counts). */
const OPTION_W_BY_COUNT = { 1: 270, 2: 270, 3: 270, 4: 270 };
/** Per-rarity hover-glow tint for the option plaques. */
const OPTION_GLOW_BY_RARITY = {
  [TAG_RARITY.COMMON]:    'rgba(160, 160, 168, 0.85)',  // dull grey
  [TAG_RARITY.UNCOMMON]:  'rgba(110, 220, 130, 0.95)',  // green
  [TAG_RARITY.RARE]:      'rgba(185, 120, 255, 0.95)',  // purple
  [TAG_RARITY.LEGENDARY]: 'rgba(255, 160, 70, 0.98)',   // orange
};
/**
 * Per-rarity art scale (applied to the container IMAGE only — not the hit-rect
 * or the icon/label layout). The rarity frames bake in different amounts of
 * flair/padding, so they read as slightly different sizes when drawn into the
 * same rect; nudge these so every rarity's visible body matches the common one.
 * 1.0 = draw at the logical rect; >1 enlarges the art, <1 shrinks it.
 */
const OPTION_CONTAINER_SCALE_BY_RARITY = {
  [TAG_RARITY.COMMON]:    1.0,
  [TAG_RARITY.UNCOMMON]:  0.98,
  [TAG_RARITY.RARE]:      1.1,
  [TAG_RARITY.LEGENDARY]: 1.04,
};
// Option plaques are WORDS ONLY (no tag symbol) — the label is centered in the
// plaque at this fraction of its height.
const OPTION_LABEL_CENTER_FRAC = 0.5;
const OPTION_LABEL_SIZE = 36;
const OPTION_LABEL_COLOR = '#e2cd92';
const OPTION_HOVER_SCALE = 1.05;
const OPTION_GLOW_COLOR = 'rgba(185, 120, 255, 0.95)';

// ── Recipe container + slots ──
const RECIPE_W = 1040;                // max container width (fits up to 4 slots)
const RECIPE_MAX_H = 300;             // height cap (keeps clear of the buttons)
const RECIPE_TOP_Y = 580;
const RECIPE_HEADER_TEXT = 'Recipe';
const RECIPE_HEADER_SIZE = 31;
const RECIPE_HEADER_COLOR = '#d9c389';
const RECIPE_HEADER_CENTER_FRAC = 0.34; // header vertical center within container
const SLOT_W_MAX = 196;               // slot width cap (slots shrink to fit count)
const SLOT_GAP = 48;                  // gap between slots (a gold "+" sits here)
const SLOT_AREA_WIDTH_FRAC = 0.86;    // fraction of container width the slots span
const SLOT_CENTER_FRAC = 0.63;        // slots vertical center within container
const SLOT_LABEL_SIZE = 31;
const SLOT_LABEL_COLOR = '#e2cd92';
const SLOT_PLUS_SIZE = 46;
const SLOT_PLUS_COLOR = '#c0a868';

// ── Bottom buttons ──
const BUTTON_W = 366;                 // height derives from the button art aspect
const BUTTON_GAP = 44;
const BUTTON_Y = 930;                 // top of the Back button (the row baseline)
const BUTTON_LABEL_SIZE = 32;
const BACK_LABEL = 'Back';
const WEAVE_LABEL = 'Weave Power';
const CONTINUE_LABEL = 'Continue';

// ── Crucible (static image shown once the recipe is full, before "Weave Power") ──
const CRUCIBLE_ASSET_KEY = 'ui_skill_weave_crucible';
/** Center + size of the crucible in design space (fills the freed option band). */
const CRUCIBLE_CENTER_X = DESIGN_W / 2;
const CRUCIBLE_CENTER_Y = 440;
const CRUCIBLE_WIDTH = 420;           // height derives from the image aspect
const CRUCIBLE_FALLBACK_ASPECT = 651 / 405;
const CRUCIBLE_FADE_IN_MS = 360;      // soft reveal when the recipe completes

// ── Crucible orbs + energy beams (one orb per recipe tag, by rarity) ──
/** Rarity → orb sprite (matches the sheet sprite names directly, no alias). */
const ORB_ASSET_PREFIX = 'ui_skill_weave_orb_';
const ORB_WIDTH = 80;                // height derives from the orb art aspect
const ORB_FALLBACK_ASPECT = 476 / 646;
/** Vertical position of the orb's GLOWING BALL within the art (0=top, 1=bottom);
 *  orbs are anchored by + beams emitted from this point (the ball, not the stand). */
const ORB_BALL_FRAC = 0.36;
/** Per-rarity beam energy colors ({ color: glow, core: hot inner }), keyed by the
 *  TAG_RARITY value. Each orb's beam is tinted to its tag's rarity. */
const ORB_BEAM_COLORS = {
  [TAG_RARITY.COMMON]:    { color: '#9a86b8', core: '#e9e2f4' }, // greyish-purple
  [TAG_RARITY.UNCOMMON]:  { color: '#5fc46a', core: '#dffbe0' }, // green
  [TAG_RARITY.RARE]:      { color: '#a25bff', core: '#efe2ff' }, // purple
  [TAG_RARITY.LEGENDARY]: { color: '#f3a23a', core: '#ffe9c6' }, // orange
};
const ORB_BEAM_FALLBACK = { color: '#9a4ff5', core: '#efe2ff' };
/** Looping crucible/beam SFX (plays while the orbs beam; volume + stop-fade). */
const CRUCIBLE_SFX_KEY = 'sfx_crucible';
const CRUCIBLE_SFX_VOLUME = 0.7;
const CRUCIBLE_SFX_STOP_FADE = 140;   // ms fade when the loop is cut

// ── Result phase (after "Weave Power": show the generated spell icon) ──
/** Subtitle shown while the woven icon is displayed. */
const SUBTITLE_RESULT = 'Your Power Takes Form';
/** Rendered diameter of the generated spell icon (design px). */
const RESULT_ICON_SIZE = 320;
/** Icon center, in the now-empty space where the tag options fanned out. */
const RESULT_ICON_CY = 384;
/** Grow/fade-in duration for the icon reveal (ms). */
const RESULT_REVEAL_DUR = 450;
/** Scale the icon reveal starts at. */
const RESULT_REVEAL_START_SCALE = 0.55;
// The skill summary (name / cost / description / inert tags) replaces the
// recipe container during the result phase — the description supersedes the
// raw tag list, and the freed band (y ≈ 560–900) fits the text comfortably.
const RESULT_NAME_Y = 602;
const RESULT_NAME_SIZE = 46;
const RESULT_NAME_COLOR = '#e8c86e';
const RESULT_COST_Y = 652;
const RESULT_COST_SIZE = 30;
const RESULT_DESC_START_Y = 706;
const RESULT_DESC_LINE_H = 38;
const RESULT_DESC_SIZE = 27;
const RESULT_DESC_COLOR = '#d8d2c8';
const RESULT_INERT_GAP = 14;          // extra gap above the surge/inert notes
const RESULT_INERT_SIZE = 22;
const RESULT_INERT_COLOR = '#8d8478';
const RESULT_SURGE_COLOR = '#cfa84f'; // gold — surged (injected) threads note
/** Mana color → display tint for the cost line. */
const MANA_TEXT_COLORS = Object.freeze({
  red: '#e06a5a', blue: '#6aa8e8', green: '#7ed06a',
  yellow: '#e8cf5e', purple: '#bd7ee8',
});
/**
 * The Confirm button uses its own art (`ui_skill_weave_button_confirm`) which is
 * TALLER than the plain button because of the gem flair on top. The flair sits
 * in the upper portion of the art, so the purple BODY (where the label goes) is
 * centered BELOW the image's geometric center — this frac is that body center.
 * The button is anchored by this body-center onto the Back button's center line
 * (see _computeLayout) so the two labels line up AND the label stays centered in
 * the body. Label is also a touch smaller to clear the ornate inner border.
 */
const CONFIRM_BUTTON_TEXT_CENTER_FRAC = 0.57; // body (label) vertical center within the confirm art
const CONFIRM_BUTTON_LABEL_SIZE = 30;

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
    /**
     * Rolled weave shape for this entry: { rounds, tagCounts }. `rounds` is the
     * recipe length (number of slots); `tagCounts[i]` is how many options round
     * i offers. Rolled in onEnter; null before the scene is entered.
     * @type {{rounds:number, tagCounts:number[]}|null}
     */
    this._plan = null;

    /** @type {string[]} committed tag ids (length 0.._plan.rounds) */
    this._recipe = [];
    /**
     * Per-round option state, indexed by round. Each entry:
     * { options: string[], picked?: number }. `picked` records which option index
     * was committed at that round (set on commit, cleared on Back) so Back can fly
     * the tag back to the right plaque.
     *
     * ALL rounds' options are rolled ONCE at scene entry (`_rollAllSteps`) and
     * never re-drawn — so the draft is deterministic: picking a tag, going Back,
     * and re-picking it yields the SAME subsequent rounds. Each round excludes
     * tags shown in earlier rounds, so no tag appears twice across the whole draft.
     * @type {Array<{options:string[], picked?:number}>}
     */
    this._steps = [];

    /** Guard so the final weave/transition fires exactly once. */
    this._finishing = false;

    /**
     * Result phase: set by _finishWeave to { recipe, synthesis, icon } once the
     * recipe is woven. While non-null the scene shows the generated spell icon
     * where the tag options were, and the confirm button becomes "Continue"
     * (which fires onComplete + leaves — see _finishContinue).
     */
    this._result = null;
    /** Elapsed ms since the result reveal began (drives the grow/fade-in). */
    this._resultTime = 0;

    // ── Crucible (recipe-complete, pre-confirm static image) ──
    /** Elapsed ms the crucible has been visible (drives its fade-in). */
    this._crucibleTime = 0;
    /**
     * Sustained energy beams from the rarity orbs to the crucible center, alive
     * only while the recipe is full (pre-confirm). One continuous-mode
     * HarvestTendrilEffect PER orb (so each is tinted to its tag's rarity),
     * rebuilt when the complete-state is (re)entered.
     * @type {HarvestTendrilEffect[]|null}
     */
    this._crucibleBeams = null;
    /** Howl play id of the looping crucible SFX while it's beaming (else null). */
    this._crucibleSfxId = null;

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
    /** Run seed (MapScene._seed) — feeds procedural spell-icon generation. */
    this._runSeed = '';

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
   * @param {string}   [opts.runSeed] — run seed for procedural spell icons
   * @param {string[]} [opts.affinityColors] — the player's starting-skill colors;
   *   element tags of these colors are drawn slightly more often (COLOR_AFFINITY_WEIGHT).
   */
  configure({ onComplete = null, returnScene = 'MapScene', runSeed = '', affinityColors = [] } = {}) {
    this._onComplete = typeof onComplete === 'function' ? onComplete : null;
    this._returnScene = returnScene || 'MapScene';
    this._runSeed = runSeed || '';
    this._affinityColors = Array.isArray(affinityColors) ? affinityColors : [];
  }

  // ═══════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════

  onEnter() {
    this._elapsed = 0;
    this._fadeInDone = false;
    this._pulseTime = 0;

    // Fresh draft each entry — roll the weave shape AND every round's options
    // up front so the draft is deterministic (Back + re-pick → same options).
    this._plan = this._rollWeavePlan();
    this._recipe = [];
    this._finishing = false;
    this._result = null;
    this._resultTime = 0;
    this._anim = null;
    this._hoverOption = -1;
    this._hoverButton = null;
    this._crucibleTime = 0;
    this._crucibleBeams = null;
    this._crucibleSfxId = null;
    this._rollAllSteps();
    this._startIntro();   // fan the first step's tags out on load

    // The skill-weave background is drawn full-canvas in renderBackground;
    // clear any battle bar-fill image so it doesn't show through the bars.
    const app = this._sceneManager && this._sceneManager._app;
    if (app && app.setBackgroundImage) app.setBackgroundImage(null);

    // Spin up the looping background video (muted, off-DOM, drawn to canvas).
    this._createBackgroundVideo();

    // Cross-fade to the skill-weave theme (fades the outgoing map/battle track
    // out as this fades in). MapScene restores its own music on return.
    AudioManager.playMusic('skill_weave_theme', { fadeIn: 800 });
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
    this._stopCrucibleSfx();   // safety: never leave the loop ringing after exit
  }

  // ── Background video setup / teardown ──────────────────────

  /**
   * Create + play the looping, muted, off-DOM background video. Its frames are
   * drawn full-canvas in renderBackground. The static image fallback stays up
   * until the first frame decodes (or permanently if autoplay is blocked).
   */
  _createBackgroundVideo() {
    this._destroyBackgroundVideo();
    if (!USE_BACKGROUND_VIDEO) return; // static-image mode — see USE_BACKGROUND_VIDEO

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

  /** Roll the weave shape for this entry: rounds (2–4) + per-round tag counts. */
  _rollWeavePlan() {
    const rounds = rollRoundsPerWeave();
    const tagCounts = [];
    for (let i = 0; i < rounds; i++) tagCounts.push(rollTagsPerRound());
    return { rounds, tagCounts };
  }

  /** Number of recipe slots = number of rounds (0 before the plan is rolled). */
  _recipeLength() {
    return this._plan ? this._plan.rounds : 0;
  }

  /**
   * Roll the options for EVERY round up front (deterministic draft). Each round
   * is drawn rarity-weighted excluding every tag shown in earlier rounds, so a
   * tag never appears twice across the draft and re-walking the draft (Back +
   * re-pick) always shows the same options. Round 0 keeps the soft action guarantee.
   */
  _rollAllSteps() {
    this._steps = [];
    if (!this._plan) return;
    // Build a per-color draw bias from the player's affinity colors (a slight
    // nudge so element tags lean toward the colors they already build around).
    const colorBias = {};
    for (const c of (this._affinityColors || [])) colorBias[c] = COLOR_AFFINITY_WEIGHT;
    const shown = [];
    for (let round = 0; round < this._plan.rounds; round++) {
      const count = this._plan.tagCounts[round] || 2;
      const options = drawTagsForRound({
        roundIndex: round,
        chosen: shown,             // exclude tags already shown in earlier rounds
        count,
        guaranteeAction: round === 0,
        colorBias,
      });
      this._steps[round] = { options };
      shown.push(...options);
    }
  }

  /** @returns {{options:string[], picked?:number}|null} current step state */
  _currentStep() {
    if (this._complete) return null;
    return this._steps[this._recipe.length] || null;
  }

  get _complete() {
    return this._recipe.length >= this._recipeLength();
  }

  get _animBusy() {
    return this._anim !== null;
  }

  get _backEnabled() {
    return this._recipe.length > 0 && !this._finishing && !this._animBusy && !this._result;
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

    // ── Mutate the model up-front ── (options are pre-rolled; never re-drawn)
    step.picked = index;
    this._recipe.push(tagId);
    const nextIntro = !this._complete;

    AudioManager.playSfx('sfx_choose_tag');
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

  /**
   * Confirm = resolve the completed recipe (no-op until full). Two phases:
   * first press ("Weave Power") synthesizes + reveals the generated spell icon;
   * second press ("Continue") fires onComplete and returns to the map.
   */
  _confirm() {
    if (!this._confirmEnabled) return;
    AudioManager.playSfx('sfx_choose_tags_confirm');
    if (this._result) this._finishContinue();
    else this._finishWeave();
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

    // ── Mutate the model up-front ── (pre-rolled steps are kept, never dropped,
    // so re-advancing into this round shows the exact same options)
    this._recipe.pop();
    delete prevStep.picked;

    AudioManager.playSfx('sfx_choose_tag_back');
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
   * Resolve the completed recipe into a skill reward.
   *
   * Synthesizes the bag into a REAL skill (skillSynthesizer — effects, cost,
   * description, rolled magnitudes), attaches the procedural icon to it, and
   * enters the RESULT phase, which shows the icon + name + cost + description.
   * The host's onComplete (MapScene) stores the skill on runState.skills.
   */
  _finishWeave() {
    if (this._finishing || this._result) return;

    const recipe = this._recipe.slice();
    // Synthesize the bag into a concrete skill (effects + rolled values +
    // randomized mana cost + generated name/description).
    const synthesis = synthesize(recipe);

    // Composite the spell's icon from authored spritesheet layers (base orb by
    // mana color + 1-2 effect sprites + border). The canvas is registered with
    // the AssetManager under `icon.assetKey`, so the skill renders through
    // SkillButton/UIImage like any sprite.
    let icon = null;
    try {
      icon = getSpellIcon({
        keywords: recipe,
        cost: synthesis.skill && synthesis.skill.cost,
        spellId: 'woven_' + recipe.join('_'),
        assetManager: this._sceneManager && this._sceneManager.assetManager,
      });
    } catch (err) {
      console.warn('[SkillWeave] spell icon generation failed:', err);
    }
    if (icon && synthesis.skill) synthesis.skill.icon = icon.assetKey;

    // Enter the RESULT phase: the icon reveals where the tag options were, and
    // the confirm button flips to "Continue" (which runs _finishContinue).
    this._result = { recipe, synthesis, icon };
    this._resultTime = 0;
    this._hoverButton = null;
  }

  /** Second confirm press ("Continue") — hand off the reward + leave the scene. */
  _finishContinue() {
    if (this._finishing || !this._result) return;
    this._finishing = true;

    if (this._onComplete) {
      this._onComplete(this._result);
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
    if (this._result) this._resultTime += dt;
    if (this._elapsed >= FADE_IN_DURATION) this._fadeInDone = true;
    this._advanceAnim(dt);

    // Crucible + orb beams: alive only while the recipe is full but not yet woven.
    if (this._complete && !this._result) {
      this._crucibleTime += dt;
      this._ensureCrucibleBeams();
      if (this._crucibleBeams) for (const b of this._crucibleBeams) b.update(dt);
      this._startCrucibleSfx();   // begin the looping beam SFX (idempotent)
    } else if (this._crucibleTime !== 0 || this._crucibleBeams || this._crucibleSfxId !== null) {
      this._crucibleTime = 0;
      this._crucibleBeams = null;   // dropping the instances ends the sustained beams
      this._stopCrucibleSfx();
    }

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

  /** Triangle / grid anchors for the option plaques, by visible count (1–4). */
  _optionAnchors(count) {
    const cx = DESIGN_W / 2;
    if (count <= 1) return [{ cx, cy: 372 }];
    if (count === 2) return [{ cx: cx - 226, cy: 402 }, { cx: cx + 226, cy: 402 }];
    if (count === 3) {
      return [
        { cx, cy: 306 },
        { cx: cx - 250, cy: 486 },
        { cx: cx + 250, cy: 486 },
      ];
    }
    // 4-up: a 2×2 grid at full plaque size (columns widened + rows spread so the
    // flair tips clear each other vertically and the bottom row clears the recipe).
    return [
      { cx: cx - 262, cy: 306 }, { cx: cx + 262, cy: 306 },
      { cx: cx - 262, cy: 490 }, { cx: cx + 262, cy: 490 },
    ];
  }

  /** Rest rects for `count` option plaques (no tag/index — pure geometry). */
  _optionRestRects(count) {
    const optionAspect = this._aspect('ui_skill_weave_option_container', 1121 / 680);
    const optW = OPTION_W_BY_COUNT[count] || OPTION_W;
    const optH = optW / optionAspect;
    const anchors = this._optionAnchors(count);
    const rects = [];
    for (let i = 0; i < count; i++) {
      const a = anchors[i] || anchors[anchors.length - 1];
      rects.push({ x: a.cx - optW / 2, y: a.cy - optH / 2, w: optW, h: optH });
    }
    return rects;
  }

  /**
   * Ball-center anchors for the rarity orbs ringing the crucible, by recipe
   * count (1–4). Arranged in the same SPIRIT as the tag-option fan (one up top,
   * the rest splayed to the sides) but pulled in tight around the crucible disc.
   * Each is the orb's glowing-ball center (the beam origin + the orb anchor).
   */
  _orbAnchors(count) {
    const cx = CRUCIBLE_CENTER_X;
    const cy = CRUCIBLE_CENTER_Y;
    if (count <= 1) return [{ cx, cy: cy - 172 }];
    if (count === 2) return [{ cx: cx - 300, cy: cy - 6 }, { cx: cx + 300, cy: cy - 6 }];
    if (count === 3) {
      return [
        { cx, cy: cy - 168 },
        { cx: cx - 300, cy: cy + 6 },
        { cx: cx + 300, cy: cy + 6 },
      ];
    }
    // 4-up: a box hugging the crucible corners.
    return [
      { cx: cx - 296, cy: cy - 128 }, { cx: cx + 296, cy: cy - 128 },
      { cx: cx - 296, cy: cy + 44 }, { cx: cx + 296, cy: cy + 44 },
    ];
  }

  /**
   * Orb draw rects (one per recipe tag) — the orb art is positioned so its ball
   * (ORB_BALL_FRAC down the art) sits on the anchor. Returns [] before complete.
   */
  _orbRects() {
    const count = this._recipeLength();
    if (!count) return [];
    const aspect = this._aspect(`${ORB_ASSET_PREFIX}common`, ORB_FALLBACK_ASPECT);
    const w = ORB_WIDTH;
    const h = w / aspect;
    return this._orbAnchors(count).map((a) => ({
      x: a.cx - w / 2,
      y: a.cy - h * ORB_BALL_FRAC,
      w, h,
    }));
  }

  /**
   * Build the sustained orb→crucible beams — one continuous HarvestTendrilEffect
   * per orb so each beam is tinted to its tag's rarity color.
   */
  _ensureCrucibleBeams() {
    if (this._crucibleBeams) return this._crucibleBeams;
    const count = this._recipeLength();
    if (!count) return null;
    const anchors = this._orbAnchors(count);
    const target = { x: CRUCIBLE_CENTER_X, y: CRUCIBLE_CENTER_Y };
    this._crucibleBeams = anchors.map((a, i) => {
      const rarity = getTagRarity(this._recipe[i]);
      const tint = ORB_BEAM_COLORS[rarity] || ORB_BEAM_FALLBACK;
      return new HarvestTendrilEffect([{ x: a.cx, y: a.cy }], target, {
        color: tint.color,
        coreColor: tint.core,
        continuous: true,
        formDuration: 360,
        amplitude: 26,
        waveCount: 2.0,
        flowSpeed: 0.012,
        thickness: 6,
        strands: 3,
        pulses: 2,
        pulseSpeed: 0.0018,
      });
    });
    return this._crucibleBeams;
  }

  /** Start the looping crucible/beam SFX once (idempotent while it's playing). */
  _startCrucibleSfx() {
    if (this._crucibleSfxId !== null) return;
    this._crucibleSfxId = AudioManager.playSfx(CRUCIBLE_SFX_KEY, {
      loop: true,
      volume: CRUCIBLE_SFX_VOLUME,
    });
  }

  /** Stop the looping crucible/beam SFX (short fade to avoid a click). */
  _stopCrucibleSfx() {
    if (this._crucibleSfxId === null) return;
    AudioManager.stopSfx(CRUCIBLE_SFX_KEY, this._crucibleSfxId, CRUCIBLE_SFX_STOP_FADE);
    this._crucibleSfxId = null;
  }

  /** The focal point a set of option rects fans out from (centroid of centers). */
  _focalFor(rects) {
    if (!rects.length) return { x: DESIGN_W / 2, y: 430 };
    let sx = 0;
    let sy = 0;
    for (const r of rects) { sx += r.x + r.w / 2; sy += r.y + r.h / 2; }
    return { x: sx / rects.length, y: sy / rects.length };
  }

  /** Recipe container art key — the WIDE variant for a 4-slot (4-round) recipe. */
  _recipeContainerKey() {
    return this._recipeLength() >= 4 ? 'ui_skill_weave_container_wide' : 'ui_skill_weave_container';
  }

  /**
   * Recipe container rect. Height-budgeted: the container grows toward RECIPE_W
   * wide but never taller than RECIPE_MAX_H, so it can't run into the buttons
   * regardless of the container art's real aspect. A 4-slot recipe uses the wide
   * art (larger aspect → renders wider at the same height cap), giving the 4 slots
   * more room.
   */
  _recipeRect() {
    const recipeAspect = this._aspect(this._recipeContainerKey(), 1376 / 570);
    const recW = Math.min(RECIPE_W, RECIPE_MAX_H * recipeAspect);
    const recH = recW / recipeAspect;
    return { x: (DESIGN_W - recW) / 2, y: RECIPE_TOP_Y, w: recW, h: recH };
  }

  /**
   * The recipe slot rects (one per round) centered in the recipe container.
   * Slot width shrinks to fit the rolled round count, capped at SLOT_W_MAX.
   */
  _slotRects() {
    const recipe = this._recipeRect();
    const slotAspect = this._aspect('ui_skill_weave_selection_blank_container', 989 / 593);
    const count = Math.max(1, this._recipeLength());
    const availW = recipe.w * SLOT_AREA_WIDTH_FRAC;
    const fitW = (availW - (count - 1) * SLOT_GAP) / count;
    const slotW = Math.min(SLOT_W_MAX, fitW);
    const slotH = slotW / slotAspect;
    const slotsTotalW = count * slotW + (count - 1) * SLOT_GAP;
    const slotsStartX = recipe.x + (recipe.w - slotsTotalW) / 2;
    const slotsCenterY = recipe.y + recipe.h * SLOT_CENTER_FRAC;
    const slots = [];
    for (let i = 0; i < count; i++) {
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

    const btnW = BUTTON_W;
    const backAspect = this._aspect('ui_skill_weave_button', 1349 / 288);
    const backH = btnW / backAspect;
    const pairW = btnW * 2 + BUTTON_GAP;
    const pairStartX = (DESIGN_W - pairW) / 2;
    const backButton = { x: pairStartX, y: BUTTON_Y, w: btnW, h: backH };

    // Confirm uses its own flaired art (taller, gem flair on top). Anchor it by
    // its BODY center (CONFIRM_BUTTON_TEXT_CENTER_FRAC) onto the Back button's
    // center line so the two labels align and the flair pokes up above the row.
    const confirmAspect = this._aspect('ui_skill_weave_button_confirm', 1381 / 390);
    const confirmH = btnW / confirmAspect;
    const backCenterY = BUTTON_Y + backH / 2;
    const confirmButton = {
      x: pairStartX + btnW + BUTTON_GAP,
      y: backCenterY - confirmH * CONFIRM_BUTTON_TEXT_CENTER_FRAC,
      w: btnW,
      h: confirmH,
    };

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
    if (this._result) {
      // Result phase: the icon + skill summary replace the options AND the
      // recipe container (the description supersedes the raw tag list).
      this._renderResultIcon(ctx);
    } else {
      this._renderOptions(ctx, layout);
      // Recipe full (pre-confirm): the crucible loop plays in the freed band.
      if (this._complete) this._renderCrucible(ctx);
      this._renderRecipe(ctx, layout);
    }
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
      gradient: TITLE_GRADIENT,
      letterSpacing: 4, shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.7)',
    });
    const total = this._recipeLength();
    const subtitle = this._result
      ? SUBTITLE_RESULT
      : this._complete
        ? SUBTITLE_COMPLETE
        : `${SUBTITLE_CHOOSE} — Round ${Math.min(this._recipe.length + 1, total)} / ${total}`;
    this._drawText(ctx, subtitle, cx, SUBTITLE_Y, {
      size: SUBTITLE_SIZE, color: SUBTITLE_COLOR, letterSpacing: 3,
      shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.6)',
    });

    // Ornate divider flair beneath the title/subtitle block.
    const flair = this._asset(TITLE_FLAIR_KEY);
    if (flair && flair.width) {
      const aspect = this._aspect(TITLE_FLAIR_KEY, TITLE_FLAIR_FALLBACK_ASPECT);
      const w = TITLE_FLAIR_WIDTH;
      const h = w / aspect;
      this._drawImageRect(ctx, flair, {
        x: cx - w / 2, y: TITLE_FLAIR_CENTER_Y - h / 2, w, h,
      });
    }
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

  // ── Render: crucible (recipe-complete, pre-confirm) ────────

  /**
   * Draw the crucible scene (recipe-complete): the static crucible image, the
   * sustained orb→center energy beams (additive, over the disc), and the rarity
   * orbs ringing it — all with a soft fade-in. No-op until the sprite is loaded.
   */
  _renderCrucible(ctx) {
    const img = this._asset(CRUCIBLE_ASSET_KEY);
    if (!img || !img.width) return;

    const fade = this._clamp01(this._crucibleTime / CRUCIBLE_FADE_IN_MS);
    const w = CRUCIBLE_WIDTH;
    const h = w / this._aspect(CRUCIBLE_ASSET_KEY, CRUCIBLE_FALLBACK_ASPECT);
    const rect = {
      x: CRUCIBLE_CENTER_X - w / 2,
      y: CRUCIBLE_CENTER_Y - h / 2,
      w, h,
    };

    ctx.save();
    ctx.globalAlpha *= fade;

    // Crucible disc, then the orbs, then the beams ON TOP (additive) so the
    // energy reads as pouring out over the front of each orb into the center.
    this._drawImageRect(ctx, img, rect);
    this._renderCrucibleOrbs(ctx);
    if (this._crucibleBeams) for (const b of this._crucibleBeams) b.render(ctx);

    ctx.restore();
  }

  /** Draw a rarity orb at each recipe position (the energy beam emitters). */
  _renderCrucibleOrbs(ctx) {
    const rects = this._orbRects();
    for (let i = 0; i < rects.length; i++) {
      const rarity = getTagRarity(this._recipe[i]);
      const img = this._asset(`${ORB_ASSET_PREFIX}${rarity}`)
        || this._asset(`${ORB_ASSET_PREFIX}common`);
      if (img && img.width) this._drawImageRect(ctx, img, rects[i]);
    }
  }

  // ── Render: result phase (the woven spell icon) ────────────

  /**
   * Draw the generated spell icon centered in the space the tag options
   * occupied, with a short grow + fade-in reveal, then the skill summary
   * (name / cost / description) below it. Only called while `_result` is set
   * (after "Weave Power", before "Continue"). If icon generation failed the
   * icon space stays empty but the summary still renders — Continue works.
   */
  _renderResultIcon(ctx) {
    const t = this._clamp01(this._resultTime / RESULT_REVEAL_DUR);
    const e = this._easeOutCubic(t);
    const cx = DESIGN_W / 2;

    const icon = this._result && this._result.icon;
    if (icon && icon.canvas) {
      const size = RESULT_ICON_SIZE * this._lerp(RESULT_REVEAL_START_SCALE, 1, e);
      ctx.save();
      ctx.globalAlpha *= e;
      // Soft golden halo behind the icon so it sits into the scene like the plaques.
      ctx.shadowColor = 'rgba(232, 200, 110, 0.55)';
      ctx.shadowBlur = 40 + 14 * (0.5 + 0.5 * Math.sin(this._pulseTime * PULSE_SPEED));
      this._drawImageRect(ctx, icon.canvas, {
        x: cx - size / 2, y: RESULT_ICON_CY - size / 2, w: size, h: size,
      });
      ctx.restore();
    }

    this._renderResultSkillSummary(ctx, e);
  }

  /**
   * Draw the synthesized skill's summary (name, mana cost, description, inert
   * tags) below the revealed icon. Replaces the recipe container during the
   * result phase. Keyword markup ([[...]]) is stripped for plain canvas text.
   */
  _renderResultSkillSummary(ctx, revealAlpha) {
    const skill = this._result && this._result.synthesis && this._result.synthesis.skill;
    if (!skill) return;
    const cx = DESIGN_W / 2;

    ctx.save();
    ctx.globalAlpha *= revealAlpha;

    // Name
    this._drawText(ctx, skill.name, cx, RESULT_NAME_Y, {
      size: RESULT_NAME_SIZE, color: RESULT_NAME_COLOR,
      letterSpacing: 2, shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.7)',
    });

    // Cost — may be MULTI-color for multi-element spells ({ blue:6, red:3 }).
    const costEntries = Object.entries(skill.cost || {});
    if (costEntries.length) {
      const parts = costEntries.map(([c, a]) => `${a} ${c.charAt(0).toUpperCase() + c.slice(1)}`);
      // Single color keeps its mana tint; a split cost uses the neutral subtitle
      // color (one text run can't carry two mana colors).
      const tint = costEntries.length === 1
        ? (MANA_TEXT_COLORS[costEntries[0][0]] || SUBTITLE_COLOR)
        : SUBTITLE_COLOR;
      this._drawText(ctx, `Cost: ${parts.join(' + ')} Mana`, cx, RESULT_COST_Y, {
        size: RESULT_COST_SIZE, color: tint,
        letterSpacing: 1, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.7)',
      });
    }

    // Description lines — rendered via KeywordText so [[keyword]] spans are
    // colored (gold) and <<n>> dynamic values are colored (green), instead of
    // dumping the raw markup. No battle caster here → <<n>> shows the base value.
    // Cached per skill (the result screen is static once revealed).
    const srcLines = (Array.isArray(skill.descriptionLines) && skill.descriptionLines.length)
      ? skill.descriptionLines
      : String(skill.description || '').split('\n');
    if (this._resultDescSig !== skill.id) {
      this._resultDescSig = skill.id;
      this._resultDescKTs = srcLines.filter((l) => l && l.trim()).map((line) => {
        const kt = new KeywordText(String(line).trim());
        kt.setStyle({
          fontSize: RESULT_DESC_SIZE, color: RESULT_DESC_COLOR,
          alignH: 'center', alignV: 'center',
          shadowColor: 'rgba(0,0,0,0.7)', shadowBlur: 6,
        });
        kt.visible = true;
        return kt;
      });
    }
    let y = RESULT_DESC_START_Y;
    for (const kt of (this._resultDescKTs || [])) {
      kt.rect.x = 0;
      kt.rect.y = y - RESULT_DESC_LINE_H / 2;
      kt.rect.w = DESIGN_W;
      kt.rect.h = RESULT_DESC_LINE_H;
      kt.renderSelf(ctx);
      y += RESULT_DESC_LINE_H;
    }

    // Surged threads (effects the weave injected beyond the picked tags)
    const surged = (this._result.synthesis.injectedTags || []);
    if (surged.length) {
      y += RESULT_INERT_GAP;
      const labels = surged.map((id) => getTagLabel(id)).join(', ');
      this._drawText(ctx, `The weave surged: ${labels}`, cx, y, {
        size: RESULT_INERT_SIZE, color: RESULT_SURGE_COLOR,
        shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.7)',
      });
      y += RESULT_DESC_LINE_H - 8;
    }

    // Wasted threads — picks that contributed NOTHING, shown WITH the reason so
    // the player sees the choice-driven downside (what a better weave avoids).
    const unused = (this._result.synthesis.unusedTags || []);
    const reasons = this._result.synthesis.wastedReasons || {};
    if (unused.length) {
      y += surged.length ? 0 : RESULT_INERT_GAP;
      // One line per wasted tag: "Wild — no Create for Wild to empower".
      for (const id of unused) {
        const reason = reasons[id];
        const text = reason ? `Wasted ${getTagLabel(id)} — ${reason}` : `Wasted: ${getTagLabel(id)}`;
        this._drawText(ctx, text, cx, y, {
          size: RESULT_INERT_SIZE, color: RESULT_INERT_COLOR,
          shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.7)',
        });
        y += RESULT_DESC_LINE_H - 8;
      }
    }

    ctx.restore();
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

  /** Rarity-suffixed option plaque art key (common → base; missing → base). */
  _optionAssetForTag(tagId) {
    const rarity = getTagRarity(tagId);
    if (rarity && rarity !== TAG_RARITY.COMMON) {
      const key = `ui_skill_weave_option_container_${rarity}`;
      if (this._asset(key)) return key;
    }
    return 'ui_skill_weave_option_container';
  }

  /** Paint an option plaque at `rect` (no transform/alpha — caller owns those). */
  _paintOption(ctx, rect, tagId, { glow = 0, bright = false } = {}) {
    const rarity = getTagRarity(tagId);
    const img = this._asset(this._optionAssetForTag(tagId));
    // Art-only scale so each rarity's flair/padding reads at a consistent size;
    // the logical `rect` (icon/label layout, hit-test) is unchanged.
    const imgRect = this._scaledRect(rect, OPTION_CONTAINER_SCALE_BY_RARITY[rarity] || 1);

    if (glow > 0 && img) {
      ctx.save();
      ctx.shadowColor = OPTION_GLOW_BY_RARITY[rarity] || OPTION_GLOW_COLOR;
      ctx.shadowBlur = glow;
      this._drawImageRect(ctx, img, imgRect);
      ctx.restore();
    }

    if (img) this._drawImageRect(ctx, img, imgRect);
    else this._drawFallbackPlaque(ctx, rect);

    // Words only — the tag label centered in the plaque (no symbol).
    const labelSize = OPTION_LABEL_SIZE * (rect.w / OPTION_W);
    this._drawText(ctx, getTagLabel(tagId),
      rect.x + rect.w / 2, rect.y + rect.h * OPTION_LABEL_CENTER_FRAC, {
        size: labelSize,
        color: bright ? '#f4e6b8' : OPTION_LABEL_COLOR,
        baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.65)',
      });
  }

  // ── Render: recipe (anim-aware slot content) ───────────────

  _renderRecipe(ctx, layout) {
    const containerImg = this._asset(this._recipeContainerKey());
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
    const backVisualEnabled = this._recipe.length > 0 && !this._finishing && !this._result;
    const confirmVisualEnabled = this._complete && !this._finishing;
    // After the weave resolves, the confirm button becomes "Continue".
    const confirmLabel = this._result ? CONTINUE_LABEL : WEAVE_LABEL;

    this._drawButton(ctx, layout.backButton, BACK_LABEL, {
      variant: 'back',
      enabled: backVisualEnabled,
      hovered: this._hoverButton === 'back',
      assetKey: 'ui_skill_weave_button',
      labelSize: BUTTON_LABEL_SIZE,
      textCenterFrac: 0.5,
    });

    this._drawButton(ctx, layout.confirmButton, confirmLabel, {
        variant: 'confirm',
        enabled: confirmVisualEnabled,
        hovered: this._hoverButton === 'confirm',
        // Confirm uses the flaired art; its label sits lower (the flair occupies
        // the top of the image) and a touch smaller — see the CONFIRM_BUTTON_* consts.
        assetKey: 'ui_skill_weave_button_confirm',
        labelSize: CONFIRM_BUTTON_LABEL_SIZE,
        textCenterFrac: CONFIRM_BUTTON_TEXT_CENTER_FRAC,
      });
  }

  /**
   * Draw a bottom button. Enabled buttons brighten on hover, disabled buttons
   * are dimmed. The plaque art, label size, and label vertical center are passed
   * in so the flaired Confirm art can place its label below the gem flair.
   * (Confirm just reads a touch brighter gold when active — no color tint.)
   */
  _drawButton(ctx, rect, label, { variant, enabled, hovered, assetKey, labelSize = BUTTON_LABEL_SIZE, textCenterFrac = 0.5 }) {
    const img = this._asset(assetKey || 'ui_skill_weave_button');

    ctx.save();
    const baseAlpha = enabled ? (hovered ? 1 : 0.92) : 0.42;
    ctx.globalAlpha *= baseAlpha;

    if (img) this._drawImageRect(ctx, img, rect);
    else this._drawFallbackPlaque(ctx, rect);

    let labelColor;
    if (variant === 'confirm') labelColor = enabled ? '#f4e8c4' : '#6b6450';
    else labelColor = enabled ? '#d7c290' : '#6b6450';
    this._drawText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h * textCenterFrac, {
      size: labelSize, color: labelColor, baseline: 'middle',
      letterSpacing: 2, shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.7)',
    });

    ctx.restore();
  }

  // ── Low-level draw + math utilities ────────────────────────

  _center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** A copy of `r` scaled about its center by `s` (1 = unchanged). */
  _scaledRect(r, s) {
    if (s === 1) return r;
    const w = r.w * s;
    const h = r.h * s;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
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
      gradient = null,
    } = opts;
    ctx.save();
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    // Optional vertical gradient fill ([offset, color] stops) spanning the text's
    // cap height around the baseline; falls back to the flat color on any failure.
    if (gradient && gradient.length) {
      try {
        const top = baseline === 'middle' ? y - size * 0.5 : y - size * 0.82;
        const bottom = baseline === 'middle' ? y + size * 0.5 : y + size * 0.18;
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        for (const [stop, c] of gradient) grad.addColorStop(stop, c);
        ctx.fillStyle = grad;
      } catch (_) {
        ctx.fillStyle = color;
      }
    } else {
      ctx.fillStyle = color;
    }
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
