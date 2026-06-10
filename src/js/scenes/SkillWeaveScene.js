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
 * Replaces the "choose 1 of 3 finished skills" reward flow with a staged TAG
 * DRAFT: the player shapes a new skill by choosing one keyword tag per step,
 * filling a fixed-length recipe ([action, element, shape] today). Each step
 * shows up to 3 tags sampled from the valid pool for that slot (see
 * skillWeaveTags.js — the pool is grammar-derived so every path leads to a
 * real combo). When the recipe is full, Confirm resolves the final skill.
 *
 * Full-screen ritual scene (NOT a modal), modeled on TitleScreen/GameOverScene:
 * the wide 16:9 `skill_weave_background` (gothic void + arcane circle + purple
 * vortex + gold frame) is painted full-canvas in renderBackground (covering the
 * letterbox bars); all interactive UI is drawn + hit-tested manually in design
 * space from render()/_computeLayout().
 *
 * Interaction:
 *   - Click a tag option → SELECT it (one selectable at a time, highlighted).
 *   - Confirm (enabled only with a selection) → commit the tag into the next
 *     recipe slot and advance to the next step's options.
 *   - Back (disabled on the first step) → remove the most recent tag and
 *     restore the previous step's exact options + selection.
 *   - Once the recipe is full, Confirm becomes "Weave Power" → _finishWeave().
 *
 * NOTE: skills are not implemented yet — _finishWeave is a placeholder that logs
 * the resolved tag recipe, then returns to the map (or fires _onComplete).
 *
 * Entry/exit: MapScene routes the `training` node here (see _onNodeEntered) and
 * sets `_onComplete` + `_returnScene` so finishing completes the node and
 * returns to the map, mirroring the battle-return path.
 */

// ═══════════════════════════════════════════════════════════
// Tunable layout constants (design space: 1920×1080)
// ═══════════════════════════════════════════════════════════

const DESIGN_W = 1920;
const FONT_FAMILY = '"Marcellus SC", Georgia, "Times New Roman", serif';

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

// ── Animation ──
const FADE_IN_DURATION = 420;         // ms
const INPUT_GRACE = 200;              // ms — ignore input right after entering
const PULSE_SPEED = 0.004;            // selection/confirm glow breathing speed

export default class SkillWeaveScene extends UIPanel {
  constructor() {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.justifyContent = 'center';
    this.gap = 0;
    this.padding = 0;

    this.backgroundAssetKey = 'skill_weave_background';
    this.smoothing = true;

    // ── Fade-in / input grace ──
    this._elapsed = 0;
    this._fadeInDone = false;

    // ── Draft state ──
    /** @type {string[]} committed tag ids (length 0..RECIPE_LENGTH) */
    this._recipe = [];
    /**
     * Per-step option state, indexed by step (= _recipe.length while drafting).
     * Each entry: { options: string[] }. Kept across Back so the previous step's
     * exact options are restored (not re-sampled).
     * @type {Array<{options:string[]}>}
     */
    this._steps = [];

    /** Guard so the final weave/transition fires exactly once. */
    this._finishing = false;

    // ── Hover state ──
    this._hoverOption = -1;            // index into the current step's options
    this._hoverButton = null;         // 'back' | 'confirm' | null

    /** Total elapsed time for glow pulse (ms). */
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
  // Public API (used by the host that routes to this scene)
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
    this._hoverOption = -1;
    this._hoverButton = null;
    this._buildStep();

    // The skill-weave background is drawn full-canvas in renderBackground;
    // clear any battle bar-fill image so it doesn't show through the bars.
    const app = this._sceneManager && this._sceneManager._app;
    if (app && app.setBackgroundImage) app.setBackgroundImage(null);

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

  /** @returns {{options:string[]}|null} current step state */
  _currentStep() {
    if (isRecipeComplete(this._recipe)) return null;
    return this._steps[this._recipe.length] || null;
  }

  get _complete() {
    return isRecipeComplete(this._recipe);
  }

  get _backEnabled() {
    return this._recipe.length > 0 && !this._finishing;
  }

  /** Confirm is only the final "create the skill" action — active once full. */
  get _confirmEnabled() {
    return this._complete && !this._finishing;
  }

  /**
   * Pick an option — commits it straight into the next recipe slot and advances
   * to the next step. Tags are chosen by clicking; only the final CONFIRM
   * (once the recipe is full) resolves the skill.
   */
  _pickOption(index) {
    if (this._finishing || this._complete) return;
    const step = this._currentStep();
    if (!step || index < 0 || index >= step.options.length) return;

    this._recipe.push(step.options[index]);
    AudioManager.playSfx('sfx_map_click_node');

    if (!this._complete) this._buildStep();
    this._hoverOption = -1;
  }

  /** Confirm = resolve the completed recipe (no-op until full). */
  _confirm() {
    if (!this._confirmEnabled) return;
    this._finishWeave();
  }

  /** Remove the most recent tag, restoring the previous step's options. */
  _back() {
    if (!this._backEnabled) return;
    this._recipe.pop();
    // Drop the step we were on; the now-current step's entry (with its prior
    // options + selection) is still in _steps, so the choices are restored.
    this._steps.length = this._recipe.length + 1;
    this._hoverOption = -1;
    AudioManager.playSfx('sfx_map_overlay_close');
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

    // Back button
    if (this._backEnabled && this._inRect(x, y, layout.backButton)) {
      this._back();
      return;
    }

    // Confirm button
    if (this._confirmEnabled && this._inRect(x, y, layout.confirmButton)) {
      this._confirm();
    }
  }

  _onMouseMove(x, y) {
    if (!this._inputReady()) return;
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
    if (this._finishing) return false;
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

  /**
   * Compute every interactive rect (options, recipe container + slots, buttons).
   * Single source of truth shared by render() and hit-testing.
   */
  _computeLayout() {
    // ── Option plaques (current step) ──
    const optionAspect = this._aspect('ui_skill_weave_option_container', 1121 / 680);
    const optW = OPTION_W;
    const optH = optW / optionAspect;

    const step = this._currentStep();
    const optionTags = step ? step.options : [];
    const anchors = this._optionAnchors(optionTags.length);
    const options = optionTags.map((tagId, i) => {
      const a = anchors[i] || anchors[anchors.length - 1];
      return {
        x: a.cx - optW / 2,
        y: a.cy - optH / 2,
        w: optW,
        h: optH,
        tagId,
        index: i,
      };
    });

    // ── Recipe container ──
    const recipeAspect = this._aspect('ui_skill_weave_container', 1376 / 570);
    const recW = RECIPE_W;
    const recH = recW / recipeAspect;
    const recipe = {
      x: (DESIGN_W - recW) / 2,
      y: RECIPE_TOP_Y,
      w: recW,
      h: recH,
    };

    // ── Recipe slots (RECIPE_LENGTH boxes centered in the container) ──
    const slotAspect = this._aspect('ui_skill_weave_selection_blank_container', 989 / 593);
    const slotW = SLOT_W;
    const slotH = slotW / slotAspect;
    const slotsTotalW = RECIPE_LENGTH * slotW + (RECIPE_LENGTH - 1) * SLOT_GAP;
    const slotsStartX = recipe.x + (recW - slotsTotalW) / 2;
    const slotsCenterY = recipe.y + recH * SLOT_CENTER_FRAC;
    const slots = [];
    for (let i = 0; i < RECIPE_LENGTH; i++) {
      slots.push({
        x: slotsStartX + i * (slotW + SLOT_GAP),
        y: slotsCenterY - slotH / 2,
        w: slotW,
        h: slotH,
      });
    }

    // ── Bottom buttons ──
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

  /** Full-canvas cover-fit background (covers letterbox bars), with fade-in. */
  renderBackground(ctx) {
    const img = this._asset(this.backgroundAssetKey);
    if (!img || !this._sceneManager) return;
    const alpha = this._fadeInDone ? 1 : Math.min(1, this._elapsed / FADE_IN_DURATION);
    this._sceneManager._app.drawFullCanvasImage(img, alpha);
  }

  render(ctx) {
    const alpha = this._fadeInDone ? 1 : Math.min(1, this._elapsed / FADE_IN_DURATION);
    const layout = this._computeLayout();

    ctx.save();
    ctx.globalAlpha = alpha;

    this._renderTitle(ctx);
    this._renderOptions(ctx, layout);
    this._renderRecipe(ctx, layout);
    this._renderButtons(ctx, layout);

    ctx.restore();
  }

  /** No flex children — everything is drawn manually in render(). */
  renderSelf(_ctx) {}

  // ── Render helpers ─────────────────────────────────────────

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

  _renderOptions(ctx, layout) {
    const img = this._asset('ui_skill_weave_option_container');
    const pulse = 0.5 + 0.5 * Math.sin(this._pulseTime * PULSE_SPEED);

    for (const opt of layout.options) {
      // Hovering a tag grows it slightly + adds a breathing glow (the cue that
      // it's the one a click will commit).
      const hovered = this._hoverOption === opt.index;
      const scale = hovered ? OPTION_HOVER_SCALE : 1;

      const cx = opt.x + opt.w / 2;
      const cy = opt.y + opt.h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      // Hover glow (breathing purple aura behind the plaque).
      if (hovered) {
        ctx.save();
        ctx.shadowColor = OPTION_GLOW_COLOR;
        ctx.shadowBlur = 26 + pulse * 16;
        if (img) this._drawImageRect(ctx, img, opt);
        ctx.restore();
      }

      if (img) {
        this._drawImageRect(ctx, img, opt);
      } else {
        this._drawFallbackPlaque(ctx, opt);
      }

      // Icon (gold tag glyph) — upper portion, centered.
      this._renderOptionIcon(ctx, opt);

      // Label — lower portion, centered.
      this._drawText(ctx, getTagLabel(opt.tagId), cx, opt.y + opt.h * OPTION_LABEL_CENTER_FRAC, {
        size: OPTION_LABEL_SIZE,
        color: hovered ? '#f4e6b8' : OPTION_LABEL_COLOR,
        baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.65)',
      });

      ctx.restore();
    }
  }

  _renderOptionIcon(ctx, opt) {
    const iconKey = getTagIcon(opt.tagId);
    const img = this._asset(iconKey);
    const iconH = opt.h * OPTION_ICON_HEIGHT_FRAC;
    const aspect = (img && img.width && img.height) ? img.width / img.height : (138 / 196);
    const iconW = iconH * aspect;
    const ix = opt.x + opt.w / 2 - iconW / 2;
    const iy = opt.y + opt.h * OPTION_ICON_CENTER_FRAC - iconH / 2;
    if (img) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, ix, iy, iconW, iconH);
      ctx.imageSmoothingEnabled = prev;
    }
  }

  _renderRecipe(ctx, layout) {
    const containerImg = this._asset('ui_skill_weave_container');
    if (containerImg) this._drawImageRect(ctx, containerImg, layout.recipe);
    else this._drawFallbackPlaque(ctx, layout.recipe);

    // "Recipe" header inside the container.
    this._drawText(ctx, RECIPE_HEADER_TEXT,
      layout.recipe.x + layout.recipe.w / 2,
      layout.recipe.y + layout.recipe.h * RECIPE_HEADER_CENTER_FRAC, {
        size: RECIPE_HEADER_SIZE, color: RECIPE_HEADER_COLOR,
        letterSpacing: 2, baseline: 'middle',
        shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.6)',
      });

    const filledImg = this._asset('ui_skill_weave_selection_container');
    const blankImg = this._asset('ui_skill_weave_selection_blank_container');

    for (let i = 0; i < layout.slots.length; i++) {
      const slot = layout.slots[i];
      const filled = i < this._recipe.length;

      if (filled) {
        if (filledImg) this._drawImageRect(ctx, filledImg, slot);
        else this._drawFallbackPlaque(ctx, slot);
        this._drawText(ctx, getTagLabel(this._recipe[i]),
          slot.x + slot.w / 2, slot.y + slot.h / 2, {
            size: SLOT_LABEL_SIZE, color: SLOT_LABEL_COLOR, baseline: 'middle',
            shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.65)',
          });
      } else {
        // The blank slot art already bakes in the "[ ? ]" glyph.
        if (blankImg) this._drawImageRect(ctx, blankImg, slot);
        else {
          this._drawFallbackPlaque(ctx, slot);
          this._drawText(ctx, '[ ? ]', slot.x + slot.w / 2, slot.y + slot.h / 2,
            { size: SLOT_LABEL_SIZE, color: '#8a7c54', baseline: 'middle' });
        }
      }

      // Gold "+" between slots.
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

  _renderButtons(ctx, layout) {
    this._drawButton(ctx, layout.backButton, BACK_LABEL, {
      variant: 'back',
      enabled: this._backEnabled,
      hovered: this._hoverButton === 'back',
    });

    this._drawButton(ctx, layout.confirmButton,
      this._complete ? WEAVE_LABEL : CONFIRM_LABEL, {
        variant: 'confirm',
        enabled: this._confirmEnabled,
        hovered: this._hoverButton === 'confirm',
      });
  }

  /**
   * Draw a bottom button. Both buttons share the same plaque art; enabled
   * buttons brighten on hover, disabled buttons are dimmed. (The Confirm button
   * is just brighter gold text when active — no color tint.)
   */
  _drawButton(ctx, rect, label, { variant, enabled, hovered }) {
    const img = this._asset('ui_skill_weave_button');

    ctx.save();

    const baseAlpha = enabled ? (hovered ? 1 : 0.92) : 0.42;
    ctx.globalAlpha *= baseAlpha;

    if (img) this._drawImageRect(ctx, img, rect);
    else this._drawFallbackPlaque(ctx, rect);

    // Label — Confirm reads a touch brighter when it's the active final action.
    let labelColor;
    if (variant === 'confirm') labelColor = enabled ? '#f4e8c4' : '#6b6450';
    else labelColor = enabled ? '#d7c290' : '#6b6450';
    this._drawText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
      size: BUTTON_LABEL_SIZE, color: labelColor, baseline: 'middle',
      letterSpacing: 2, shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.7)',
    });

    ctx.restore();
  }

  // ── Low-level draw utilities ───────────────────────────────

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
    // letterSpacing is widely supported in Chromium-class canvases; guard anyway.
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
