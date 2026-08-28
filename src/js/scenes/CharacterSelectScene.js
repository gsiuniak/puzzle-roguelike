/**
 * CharacterSelectScene — character selection screen between TitleScreen and BattleScene.
 *
 * Responsibilities:
 *   - Load available characters from characterSelectDefinitions
 *   - Render selected character splash background (cover, cross-fade on change)
 *   - Render character info panel (name, class, health, mana orbs, starting skills, starting relic)
 *   - Render heroes portrait row (click to select)
 *   - Render Choose Hero button (hover/normal states)
 *   - Handle mouse click / keyboard input
 *   - Transition to BattleScene with selected character
 *
 * All rendering is data-driven from characterSelectDefinitions and data/characters.
 * Layout uses manual positioning for the top-level areas (info panel, heroes, button)
 * and flexbox for internal content within each area. This avoids the auto-height
 * limitation of the custom flexbox system.
 */

import UIPanel from '../ui/UIPanel.js';
import UIContainer from '../ui/UIContainer.js';
import UIImage from '../ui/UIImage.js';
import UIText from '../ui/UIText.js';
import KeywordText from '../ui/KeywordText.js';
import TooltipManager from '../systems/TooltipManager.js';
import AudioManager from '../audio/AudioManager.js';
import characterSelectDefinitions from '../data/characterSelectDefinitions.js';
import { goblin } from '../data/enemies/index.js';
import BattleController from '../game/BattleController.js';
import BattleScene from '../ui/BattleScene.js';
import AuraStrandsEffect from '../ui/AuraStrandsEffect.js';
import { createRunState } from '../data/runState.js';
import { createPlayerBattleState } from '../data/playerStats.js';
import { resolveSkillIds } from '../data/skills/skillCatalog.js';
import { resolveRelicIds } from '../data/relics/relicCatalog.js';
import { resolveEnemyRelicIds } from '../data/relics/enemyRelicCatalog.js';
import { MAP_TRANSITION_VIDEO } from '../data/videoManifest.js';

/** Duration of the cross-fade transition between splash backgrounds (ms) */
const CROSS_FADE_DURATION = 200;

/**
 * What plays after "Choose Hero" is confirmed:
 * false → the shared map-transition movie (MAP_TRANSITION_VIDEO) plays and
 *         HANDS OFF to MapScene's fullscreen-splash entry reveal (no black
 *         fade — decision #58 idiom);
 * true  → the classic per-hero choose intro (`def.splashVideo` + fadeToScene).
 * The per-hero machinery is kept intact behind this flag.
 */
const USE_CHOOSE_HERO_INTRO = false;

/**
 * Map-transition handoff: switch scenes this close to the movie's end (~2
 * frames at 24fps) so only its held LAST frame carries into the dissolve…
 */
const MAP_TRANSITION_HANDOFF_LEAD_MS = 90;
/** …and dissolve that held frame over MapScene's fullscreen splash this fast (ms).
 *  Tiny by design — the splash IS the movie's final frame at identical framing,
 *  so the dissolve only needs to mask compression-level differences. */
const MAP_TRANSITION_CROSSFADE_MS = 150;
/** SoundConfig stinger played simultaneously with the map-transition movie. */
const MAP_TRANSITION_SFX_KEY = 'sfx_map_transition';
/** How fast the select-screen music fades out as the movie + stinger start (ms). */
const MAP_TRANSITION_MUSIC_FADE_MS = 300;
/** Click-to-skip is ignored this soon after confirm (the confirming click's
 *  own event tail must not insta-skip the movie) (ms). */
const MAP_TRANSITION_SKIP_GRACE_MS = 300;
/** Skip cross-fade: the movie's CURRENT frame dissolves over the settled map
 *  screen this fast (longer than the normal last-frame dissolve — an arbitrary
 *  mid-movie frame won't match the splash) (ms). */
const MAP_TRANSITION_SKIP_CROSSFADE_MS = 300;
/** A skip fades the still-ringing transition stinger out this fast (ms). */
const MAP_TRANSITION_SFX_STOP_FADE_MS = 150;

/**
 * Brief fade-in of the splash background video (per-def `splashBackgroundVideo`,
 * looping) over the static splash once its first frame is paintable (masks the
 * static→frame-0 pop). 0 = instant swap (ms).
 */
const SPLASH_BG_VIDEO_FADE_IN_MS = 250;

/**
 * How quickly the UI (info panel, heroes, button, aura) fades out once a hero
 * with a `splashVideo` is confirmed, leaving only the full-canvas video (ms).
 */
const UI_FADE_OUT_DURATION = 350;

/**
 * How long BEFORE the choose-hero video's end to kick off the scene cross-fade,
 * so the fade-to-next-scene completes roughly as the video finishes (ms).
 * Should be ≥ the fadeToScene duration used below.
 */
const CHOOSE_VIDEO_CROSSFADE_LEAD = 700;

/** Safety bail-out if the video never reports a usable duration / 'ended' (ms). */
const CHOOSE_VIDEO_MAX_DURATION = 30000;

/**
 * Brief fade-in of the choose-hero video over the static splash (ms). The
 * video is drawn ON TOP of the splash, so ramping its alpha 0→1 reads as the
 * splash art fading out into the video — masking any small framing/color
 * inconsistencies between the splash and the video's first frames.
 * 0 = instant swap (old behavior).
 *
 * Also the confirm → map-transition movie's entrance (it rides this same
 * pipeline): the movie eases in over the frozen splash instead of snapping
 * to it.
 */
const CHOOSE_VIDEO_FADE_IN_MS = 700;

/**
 * How far INTO the fade-in playback starts (ms). 0 = the movie is already in
 * motion from the first faded frame, so it has visibly been playing by the
 * time the dissolve lands; ≥ CHOOSE_VIDEO_FADE_IN_MS = the old behavior (held
 * PAUSED on frame 0 for the whole fade, motion only once fully opaque).
 */
const CHOOSE_VIDEO_PLAY_AT_FADE_MS = 0;

/**
 * Safety: if the intro video never becomes paintable (readyState < 2) within
 * this window, start playback anyway so the normal ended/error fallbacks can
 * drive the scene transition (ms).
 */
const CHOOSE_VIDEO_PLAY_FALLBACK_MS = 1000;

/**
 * Fail-fast: if the intro video is in an error state, never becomes
 * paintable, or stops making playback progress for this long, abandon it and
 * start the scene transition over the static splash. Offline PWA case: the
 * .mp4 fetch fails during preload, and `play()` on an already-errored element
 * neither re-fires 'error' nor settles its promise — without this watchdog
 * the only exit is the 30s CHOOSE_VIDEO_MAX_DURATION cap. (ms)
 */
const CHOOSE_VIDEO_STALL_BAILOUT_MS = 4000;

const MANA_ORDER = ['red', 'blue', 'green', 'yellow', 'purple'];

/**
 * Horizontal center of the floating UI block, as a fraction of canvas width.
 * The character splash art occupies the RIGHT side of the screen, so the
 * info / heroes / button block floats on the LEFT — centered around this
 * fraction — with no containing panel behind it.
 */
const LEFT_BLOCK_CENTER_FRAC = 0.36;

/**
 * Vertical spacing of the centered block, as fractions of canvas height.
 * The block (info panel → heroes row → choose button) is vertically centered,
 * then the heroes row + button are lifted by BLOCK_Y_LIFT_FRAC so the bottom
 * of the screen breathes, while the info panel gets its own smaller
 * PANEL_Y_LIFT_FRAC so it stays near the true center (lifting it as far as
 * the portraits reads worse). The heroes row sits tighter under the panel
 * (GAP_PANEL_HEROES_FRAC) and the choose button gets clearer separation
 * (GAP_HEROES_BUTTON_FRAC).
 */
const GAP_PANEL_HEROES_FRAC = 0.01;
const GAP_HEROES_BUTTON_FRAC = 0.032;
const BLOCK_Y_LIFT_FRAC = 0.015;
const PANEL_Y_LIFT_FRAC = 0.005;

/**
 * Left-side readability scrim: a subtle black gradient over the splash that is
 * darkest at the left edge and fades to fully transparent by
 * LEFT_OVERLAY_FADE_END_FRAC across the screen, lifting the floating left-side
 * text off the artwork. Set LEFT_OVERLAY_ALPHA to 0 to disable.
 */
const LEFT_OVERLAY_ALPHA = 0.65;
const LEFT_OVERLAY_HOLD_FRAC = 0.45;
const LEFT_OVERLAY_FADE_END_FRAC = 0.75;

/**
 * ── UI LAYOUT / TYPOGRAPHY TUNABLES ──────────────────────────────────
 * Every size, gap, font size and color used by the info panel, heroes row
 * and choose button lives here. All pixel values are in DESIGN-SPACE px
 * BEFORE the aspect-aware `_uiScale` multiplier (S) — the scale is applied
 * at the usage sites, so just tweak the raw numbers.
 */
const UI = {
  // Info panel — the floating left "card" holding all character info.
  panel: {
    widthFrac: 0.65,     // preferred width as a fraction of canvas width… (0.55 original)
    widthMin: 640,       // …clamped to this min…
    widthMax: 880,       // …and this max (780 original)
    padding: { top: 32, right: 44, bottom: 48, left: 44 },
    gap: 10,             // vertical gap between panel sections
  },

  // Character name — the big header at the top of the panel.
  name: {
    fontSize: 48, // 42 original
    height: 48,
    marginTop: 20,
    color: '#e8d8b0',
  },

  // Class row: [flair] ClassName [flair]
  classRow: {
    height: 28,
    gap: 14,
    flairWidth: 100,
    flairHeight: 24,
    fontSize: 24, // 22 original
    textWidth: 120,
    textHeight: 26,
    textMarginX: 95,     // left/right margin around the class text
    color: '#ccaa77',
  },

  // Character description under the class row.
  desc: {
    fontSize: 21, // 18 original
    height: 60,
    maxWidth: 640, // 560 original
    color: '#c0b890', // #b0a880 original
  },

  // Divider image between description and the stats row.
  divider: {
    widthPercent: 0.78,  // fraction of the panel's inner width
    height: 15,
  },

  // Health + mana single centered row.
  statRow: {
    height: 28,
    gap: 12,
    heartSize: 24,
    healthFontSize: 20,
    healthWidth: 80,
    healthHeight: 26,
    healthMarginRight: 70,
    healthColor: '#ff6666',
    spacerWidth: 14,     // gap between the health group and the mana groups
    manaGroupWidth: 50,
    manaGroupGap: 4,
    manaIconSize: 26,
    manaIconMarginRight: 3,
    manaFontSize: 19,
    manaCountWidth: 30,
    manaCountHeight: 22,
    manaCountMarginRight: 12,
    manaCountColor: '#b0a880',
  },

  // Growth section: per-victory stat growth shown as 1-5 filled blips.
  // A FREE-FLOATING panel anchored to the bottom-right of the screen
  // (positioned manually in layoutChildren, like the heroes row / button).
  growth: {
    panelWidth: 300,
    marginRight: 70,     // inset from the right screen edge
    marginBottom: 60,    // inset from the bottom screen edge
    titleHeight: 30,
    titleGap: 8,
    titleFontSize: 24,
    titleWidth: 110,
    titleMarginX: 6,
    titleColor: '#ccaa77',
    // NOTE: title row total (2×flairWidth + titleWidth + 2×titleMarginX +
    // 2×titleGap) must stay under panelWidth or the row overflows onto itself.
    flairWidth: 64,
    flairHeight: 12,
    rowHeight: 26,
    rowGap: 4,
    labelWidth: 52,
    labelMarginRight: 16,
    labelFontSize: 20,
    labelColor: '#e8d8b0',
    blipSize: 24,
    blipGap: 6,
    bottomFlairWidth: 240,
    bottomFlairHeight: 30,
    bottomMarginTop: 2,
  },

  // Section title rows ("Starting Skills" / "Starting Relic").
  sectionTitle: {
    height: 26,
    gap: 12,
    flairWidth: 220,
    flairHeight: 18,
    fontSize: 21,
    textWidth: 150,
    textHeight: 22,
    textMarginX: 90,     // left/right margin around the title text
    color: '#ccaa77',
  },

  // Skills row + a single skill block (icon | name + description).
  skillsRow: { height: 90, gap: 30, marginTop: -5 },
  skillBlock: {
    width: 240,
    height: 120,
    gap: 12,             // gap between icon and text column
    iconSize: 84,
    textColGap: 4,
    nameFontSize: 19,
    nameHeight: 14,
    nameMarginTop: 20,
    nameMarginBottom: 5,
    nameColor: '#e8d8b0',
    descFontSize: 16,
    descHeight: 60,
    descMaxWidth: 160,
    descColor: '#c0b890',
  },

  // Relic row + the single relic block (wider than a skill block).
  relicRow: { height: 90, marginTop: -5 },
  relicBlock: {
    width: 460,
    height: 80,
    gap: 16,
    iconSize: 80,
    textColGap: 4,
    textColWidth: 320,   // fixed text column width; desc maxWidth follows it
    nameFontSize: 19,
    nameHeight: 14,
    nameMarginTop: 20,
    nameMarginBottom: 5,
    nameColor: '#e8d8b0',
    descFontSize: 16,
    descHeight: 60,
    descColor: '#c0b890',
  },

  // Heroes portrait row.
  heroes: {
    portraitSize: 130,   // portrait image size (square)
    slotWidth: 124,      // per-portrait horizontal slot used to size/center the row
    rowHeight: 110,
    gap: 24,
  },

  // Choose Hero button.
  button: {
    imageWidth: 320,     // the button art itself
    imageHeight: 80,
    slotWidth: 240,      // the container rect used for horizontal centering
    slotHeight: 70,
  },

  // Selected-portrait golden highlight (raw px — NOT multiplied by _uiScale).
  highlight: {
    margin: 4,
    lineWidth: 3,
    glowLineWidth: 6,
    color: '#e8c850',
    glowColor: 'rgba(232, 200, 80, 0.3)',
  },

  // Aspect-aware UI scale clamp (see _computeUIScale).
  scaleMin: 1.3,
  scaleMax: 1.5,
};

/** Scale a UI.panel-style padding object by S. */
function scalePadding(p, S) {
  return { top: p.top * S, right: p.right * S, bottom: p.bottom * S, left: p.left * S };
}

/** Number of growth "blips" (diamonds) per stat row in the Growth section. */
const GROWTH_BLIP_COUNT = 5;

/**
 * Map a growthPlan per-victory value to 0..GROWTH_BLIP_COUNT filled blips.
 * The stats are weighed differently, so each has its own scale:
 *  - maxHp: blips = growth − 1 (6 HP/level → 5 blips, 5 → 4, …)
 *  - attack/magic: 1/level is the cap (5 blips); fractional growth floors,
 *    so ≈0.334/level → 1 blip, 0.68 → 3, 0 → 0.
 */
function growthBlips(statKey, value) {
  const raw = statKey === 'maxHp'
    ? Math.round(value) - 1
    : Math.floor(value * GROWTH_BLIP_COUNT + 1e-6);
  return Math.max(0, Math.min(GROWTH_BLIP_COUNT, raw));
}

export default class CharacterSelectScene extends UIPanel {
  constructor() {
    super();

    // ── Scene self-config ──────────────────────────────
    this.direction = 'column';
    this.gap = 0;
    this.padding = 0;

    // ── Character definitions (only enabled) ────────────
    this._definitions = characterSelectDefinitions
      .filter(d => d.enabled)
      .sort((a, b) => a.order - b.order);

    if (this._definitions.length === 0) {
      console.error('CharacterSelectScene: no enabled character definitions found.');
    }

    /** @type {number} index into _definitions */
    this._selectedIndex = 0;

    // ── Cross-fade state ───────────────────────────────
    /** @type {string|null} previous splash asset key */
    this._prevSplashKey = null;
    /** @type {string|null} current splash asset key */
    this._currSplashKey = null;
    /** @type {number} 0→1 fade progress */
    this._crossFadeAlpha = 1.0;

    // ── Child element references ───────────────────────
    /** @type {UIContainer|null} */
    this._infoPanel = null;
    /** @type {UIContainer|null} */
    this._heroesRow = null;
    /** @type {UIImage|null} */
    this._chooseButton = null;
    /** @type {UIContainer|null} */
    this._btnContainer = null;
    /** @type {UIContainer|null} free-floating Growth panel (bottom-right) */
    this._growthPanel = null;
    /** @type {UIImage[]} portrait images in heroes row */
    this._portraitImages = [];

    // ── Aura effect ────────────────────────────────────
    /** @type {AuraStrandsEffect} */
    this._auraEffect = new AuraStrandsEffect();

    // ── Tooltips (inline keyword tooltips on skill/relic descriptions) ──
    /** @type {TooltipManager|null} */
    this._tooltipManager = null;
    /** @type {KeywordText[]} description elements with inline [[keyword]] markup */
    this._keywordDescs = [];

    // ── Hover state ────────────────────────────────────
    /** @type {boolean} */
    this._buttonHovered = false;

    // ── Choose-hero splash video intro ─────────────────
    // When a hero with a `splashVideo` is confirmed, the UI fades out while a
    // full-canvas video plays; the scene cross-fades to the next scene as the
    // video nears its end. The <video>s are off-DOM (not AssetManager entries).
    //
    // ALL heroes' intro videos are preloaded into a pool on enter and primed
    // (first frame decoded via a muted play→pause) so any hero plays instantly
    // with no buffering/decode stall — see _preloadAllVideos / _primeVideo.
    /** @type {Map<string, HTMLVideoElement>} preloaded intro videos keyed by src */
    this._videoPool = new Map();
    /** @type {HTMLVideoElement|null} the active intro video during a choose transition */
    this._video = null;
    /** @type {string|null} src of the active intro video */
    this._videoSrc = null;
    /** @type {boolean} true while the choose-hero video intro is playing */
    this._choosingActive = false;
    /** @type {boolean} true when the intro ends with the MapScene handoff
     *  (map-transition mode) instead of the classic fadeToScene */
    this._chooseHandoff = false;
    /** @type {boolean} the player clicked mid-movie — hand off NOW, straight
     *  to the settled map (no fullscreen-splash reveal) */
    this._chooseSkipReveal = false;
    /** @type {number|null} play id of the transition stinger (so a skip can fade it out) */
    this._mapTransitionSfxId = null;
    /** @type {object|null} the definition being transitioned into */
    this._chosenDef = null;
    /** @type {number} ms elapsed since the intro started */
    this._chooseElapsed = 0;
    /** @type {boolean} guard so the scene transition is started exactly once */
    this._chooseTransitionStarted = false;
    /** @type {number} 1→0 fade applied to all UI during the video intro */
    this._uiFadeAlpha = 1;
    /** @type {number} ms the intro video has been drawable — drives its fade-in over the splash */
    this._videoFadeMs = 0;
    /** @type {boolean} true once play() has been issued for the intro video */
    this._videoPlayStarted = false;

    // ── Splash background video ────────────────────────
    // A hero with a `splashBackgroundVideo` plays it full-canvas in place of
    // its static splash while SELECTED, looping for as long as the hero stays
    // selected (the static art is only the buffering/failure fallback). The
    // loop is DOUBLE-BUFFERED: native `loop=true` seeks flush + re-prime the
    // decoder at every wrap (an intermittent visible stutter), so instead
    // each wrap swaps to a primed standby twin of the same src parked on
    // frame 0 (`_splashBgAltPool`), while the just-ended element's held last
    // frame bridges the swap (`_splashBgHold`) and is then rewound to become
    // the next standby. Elements live in their own small pools (NOT
    // `_videoPool` — the choose-hero pool's ended/error listeners drive the
    // choose transition and must never fire for a background video). See
    // _startSplashBgVideo / _wrapSplashBg / renderBackground.
    /** @type {Map<string, HTMLVideoElement>} splash bg videos keyed by src */
    this._splashBgPool = new Map();
    /** @type {Map<string, HTMLVideoElement>} standby twins for the loop wrap, keyed by src */
    this._splashBgAltPool = new Map();
    /** @type {HTMLVideoElement|null} the selected hero's active bg video */
    this._splashBgVideo = null;
    /** @type {string|null} src of the active bg video */
    this._splashBgSrc = null;
    /** @type {boolean} set by the active element's 'ended' listener; the wrap runs in update() */
    this._splashBgWrapPending = false;
    /** @type {HTMLVideoElement|null} just-ended element, drawn until the swapped-in
     *  twin paints its first frame, then rewound to frame 0 as the next standby */
    this._splashBgHold = null;
    /** @type {number} ms the active bg video has been drawable — drives its fade-in */
    this._splashBgFadeMs = 0;
    /** @type {HTMLVideoElement|null} outgoing hero's paused bg video, drawn as
     *  the prev layer during the selection cross-fade (instead of its static splash) */
    this._prevSplashVideo = null;

    // ── Title-transition entry overlay ─────────────────
    // TitleScreen hands its still-playing transition <video> here (via
    // setEntryVideoOverlay, immediately BEFORE an instant switchTo) so the
    // movie's end cross-fades into this scene's UI: renderForeground draws it
    // full-canvas over everything at an alpha decaying 1→0 over
    // _entryOverlayFadeMs, then the element is released. This scene OWNS the
    // element from the handoff on. Deliberately NOT reset in onEnter — the
    // handoff sets it just before onEnter runs.
    /** @type {HTMLVideoElement|null} */
    this._entryOverlayVideo = null;
    /** @type {number} ms over which the overlay fades out */
    this._entryOverlayFadeMs = 1;
    /** @type {number} ms since the handoff */
    this._entryOverlayElapsed = 0;

    // ── UI fill scale ──────────────────────────────────
    // Multiplier applied to all UI sizes so the layout fills more of the
    // physical screen on aspect ratios that pillarbox/letterbox the design
    // viewport (e.g. mobile landscape). Recomputed each layout pass.
    /** @type {number} */
    this._uiScale = 1;

    // ── Input handler references (for cleanup) ─────────
    /** @type {Function|null} */
    this._onMouseDown = null;
    /** @type {Function|null} */
    this._onMouseMove = null;
    /** @type {Function|null} */
    this._onMouseUp = null;
    /** @type {Function|null} */
    this._onKeyDown = null;

    // ── Shared service references ──────────────────────
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = null;
    /** @type {import('./SceneManager.js').default|null} */
    this._sceneManager = null;

    // ── Build UI ───────────────────────────────────────
    this._buildScene();
    this._updateInfoPanel();
  }

  // ═══════════════════════════════════════════════════════
  // Scene construction
  // ═══════════════════════════════════════════════════════

  _buildScene() {
    const S = this._uiScale;

    // ── Info panel (positioned manually in layoutChildren) ──
    // Narrower, card-like proportions with generous balanced padding
    // and clear section separation to match the mock's visual rhythm.
    this._infoPanel = new UIContainer();
    this._infoPanel.direction = 'column';
    this._infoPanel.alignItems = 'center';
    this._infoPanel.gap = UI.panel.gap * S;
    this._infoPanel.padding = scalePadding(UI.panel.padding, S);
    this._infoPanel.smoothing = true;
    this.addChild(this._infoPanel);

    // ── Heroes row (positioned manually in layoutChildren) ──
    this._heroesRow = new UIContainer();
    this._heroesRow.direction = 'row';
    this._heroesRow.justifyContent = 'center';
    this._heroesRow.alignItems = 'center';
    this._heroesRow.gap = UI.heroes.gap * S;
    this.addChild(this._heroesRow);

    // ── Build portrait images ──────────────────────────
    this._portraitImages = [];
    for (let i = 0; i < this._definitions.length; i++) {
      const def = this._definitions[i];
      const portrait = new UIImage(`character_select_portrait_${def.id}`, null); // assetManager set in onEnter
      portrait.setStyle({
        width: UI.heroes.portraitSize * S,
        height: UI.heroes.portraitSize * S,
        fitMode: 'contain',
        imageAlignH: 'center',
        imageAlignV: 'center',
      });
      portrait.userData = { index: i, defId: def.id };
      this._portraitImages.push(portrait);
      this._heroesRow.addChild(portrait);
    }

    // ── Choose Hero button (positioned manually in layoutChildren) ──
    this._btnContainer = new UIContainer();
    this._btnContainer.direction = 'row';
    this._btnContainer.justifyContent = 'center';
    this._btnContainer.alignItems = 'center';

    this._chooseButton = new UIImage('character_select_choose_hero_button', null);
    this._chooseButton.setStyle({
      width: UI.button.imageWidth * S,
      height: UI.button.imageHeight * S,
      fitMode: 'contain',
      imageAlignH: 'center',
      imageAlignV: 'center',
    });
    this._chooseButton.userData = { isButton: true };
    this._btnContainer.addChild(this._chooseButton);
    this.addChild(this._btnContainer);
  }

  /**
   * Rebuild the info panel contents for the currently selected character.
   *
   * Structure mirrors the mock's intentional top-to-bottom scan:
   *   Name → Class (with flairs) → Description →
   *   Divider → Health & Mana (single row) → Divider →
   *   "Starting Skills" (with flairs) → Skill blocks →
   *   "Starting Relic" (with flairs) → centered relic block [if any]
   *
   * Every child has an explicit height so flexbox produces a deterministic
   * total panel height for vertical centering in layoutChildren().
   */
  _updateInfoPanel() {
    const panel = this._infoPanel;
    if (!panel) return;

    panel.clearChildren();
    // Rebuilt from scratch each time — drop stale keyword desc references.
    this._keywordDescs = [];

    const def = this._getSelectedDef();
    if (!def) return;

    const cd = def.characterData;
    const am = this._assetManager;
    const S = this._uiScale;

    // Sync container's own padding/gap to the current scale so the panel
    // body grows with the rest of the UI when scale changes.
    panel.gap = UI.panel.gap * S;
    panel.padding = scalePadding(UI.panel.padding, S);

    // ── Character Name — large, dominant, the visual anchor ─
    const nameText = new UIText(cd.name || '');
    nameText.setStyle({
      fontSize: UI.name.fontSize * S,
      color: UI.name.color,
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: UI.name.height * S,
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlur: 4,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      margin: { top: UI.name.marginTop * S }
    });
    panel.addChild(nameText);

    // ── Class row: [flair] ClassName [flair] ────────────
    const CR = UI.classRow;
    const classRow = new UIContainer();
    classRow.direction = 'row';
    classRow.justifyContent = 'center';
    classRow.alignItems = 'center';
    classRow.gap = CR.gap * S;
    classRow.height = CR.height * S;

    const flairL = new UIImage('character_select_flair_left', am);
    flairL.setStyle({ width: CR.flairWidth * S, height: CR.flairHeight * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    classRow.addChild(flairL);

    const classText = new UIText(cd.className || '');
    classText.setStyle({
      fontSize: CR.fontSize * S,
      color: CR.color,
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: CR.textWidth * S,
      height: CR.textHeight * S,
      margin: { left: CR.textMarginX * S, right: CR.textMarginX * S }
    });
    classRow.addChild(classText);

    const flairR = new UIImage('character_select_flair_right', am);
    flairR.setStyle({ width: CR.flairWidth * S, height: CR.flairHeight * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    classRow.addChild(flairR);
    panel.addChild(classRow);

    // ── Character description — centered, readable ──────
    const descText = new KeywordText(cd.description || '');
    descText.setStyle({
      fontSize: UI.desc.fontSize * S,
      color: UI.desc.color,
      alignH: 'center',
      alignV: 'center',
      height: UI.desc.height * S,
      maxWidth: UI.desc.maxWidth * S,
    });
    panel.addChild(descText);
    this._keywordDescs.push(descText);

    // ── Divider ─────────────────────────────────────────
    const divider1 = new UIImage('character_select_divider', am);
    divider1.setStyle({ widthPercent: UI.divider.widthPercent, height: UI.divider.height * S, fitMode: 'stretch' });
    panel.addChild(divider1);

    // ── Health + mana single centered row ───────────────
    // Mock: "Health and mana sit in a single elegant centered row.
    //        Icons are evenly spaced. Values align visually with icons.
    //        Everything sits on the same baseline."
    const SR = UI.statRow;
    const statManaRow = new UIContainer();
    statManaRow.direction = 'row';
    statManaRow.justifyContent = 'center';
    statManaRow.alignItems = 'center';
    statManaRow.gap = SR.gap * S;
    statManaRow.height = SR.height * S;

    // Heart icon + health value group
    const heartIcon = new UIImage('character_select_heart', am);
    heartIcon.setStyle({ width: SR.heartSize * S, height: SR.heartSize * S, fitMode: 'contain' });
    statManaRow.addChild(heartIcon);

    const baseStats = cd.baseStats || {};
    const healthText = new UIText(`${baseStats.maxHp ?? 0} / ${baseStats.maxHp ?? 0}`);
    healthText.setStyle({
      fontSize: SR.healthFontSize * S,
      color: SR.healthColor,
      bold: true,
      alignH: 'left',
      alignV: 'center',
      width: SR.healthWidth * S,
      height: SR.healthHeight * S,
      margin: { right: SR.healthMarginRight * S }
    });
    statManaRow.addChild(healthText);

    // Spacer between health and mana groups
    const spacer = new UIContainer();
    spacer.width = SR.spacerWidth * S;
    spacer.height = 1;
    statManaRow.addChild(spacer);

    // Mana groups: icon + count, evenly spaced, same baseline
    const manaData = cd.baseStats ? cd.baseStats.startingMana : {};
    const MANA_COLORS = [
      { key: 'red',    color: '#ff5555' },
      { key: 'blue',   color: '#5599ff' },
      { key: 'green',  color: '#55cc55' },
      { key: 'yellow', color: '#dddd44' },
      { key: 'purple', color: '#cc55cc' },
    ];

    for (const mc of MANA_COLORS) {
      const manaGroup = new UIContainer();
      manaGroup.direction = 'row';
      manaGroup.alignItems = 'center';
      manaGroup.gap = SR.manaGroupGap * S;
      manaGroup.width = SR.manaGroupWidth * S;

      const symbol = new UIImage(`mana_${mc.key}`, am);
      symbol.setStyle({ width: SR.manaIconSize * S, height: SR.manaIconSize * S, fitMode: 'contain', margin: { right: SR.manaIconMarginRight * S } });
      manaGroup.addChild(symbol);

      const countText = new UIText(String(manaData[mc.key] ?? 0));
      countText.setStyle({
        fontSize: SR.manaFontSize * S,
        color: SR.manaCountColor,
        bold: true,
        alignH: 'left',
        alignV: 'center',
        width: SR.manaCountWidth * S,
        height: SR.manaCountHeight * S,
        shadowColor: 'rgba(0,0,0,0.7)',
        shadowBlur: 2,
        shadowOffsetX: 1,
        shadowOffsetY: 1,
        margin: { right: SR.manaCountMarginRight * S }
      });
      manaGroup.addChild(countText);

      statManaRow.addChild(manaGroup);
    }
    panel.addChild(statManaRow);

    // ── Divider ─────────────────────────────────────────
    // const divider2 = new UIImage('character_select_divider', am);
    // divider2.setStyle({ widthPercent: 0.78, height: 8, fitMode: 'stretch' });
    // panel.addChild(divider2);

    // ── "Starting Skills" title row with flairs ─────────
    panel.addChild(this._buildSectionTitleRow('Starting Skills', am));

    // ── Skills blocks row ──────────────────────────────
    // characterData.skills are skill ID strings — resolve via the
    // catalog so the blocks see full objects (name, description, icon).
    const skills = resolveSkillIds(cd.skills || []);
    const skillsRow = new UIContainer();
    skillsRow.direction = 'row';
    skillsRow.justifyContent = 'center';
    skillsRow.alignItems = 'center';
    skillsRow.gap = UI.skillsRow.gap * S;
    skillsRow.height = UI.skillsRow.height * S;
    skillsRow.margin = { top: UI.skillsRow.marginTop * S };

    for (const skillData of skills) {
      const skillBlock = this._buildSkillBlock(skillData, am);
      skillsRow.addChild(skillBlock);
    }
    panel.addChild(skillsRow);

    // ── "Starting Relic" section (only if the character has relics) ──
    const relics = resolveRelicIds(cd.relics || []);
    if (relics.length > 0) {
      // Title row with flairs — mirrors the Starting Skills header style.
      panel.addChild(this._buildSectionTitleRow('Starting Relic', am));

      // Single centered relic block — wider than a skill block since
      // only ever one relic occupies the row, so it can spread out and
      // let the description breathe on a single line.
      const relicsRow = new UIContainer();
      relicsRow.direction = 'row';
      relicsRow.justifyContent = 'center';
      relicsRow.alignItems = 'center';
      relicsRow.height = UI.relicRow.height * S;
      relicsRow.margin = { top: UI.relicRow.marginTop * S };

      const relicBlock = this._buildRelicBlock(relics[0], am);
      relicsRow.addChild(relicBlock);
      panel.addChild(relicsRow);
    }

    // ── Growth panel: free-floating, rebuilt per selection ──
    // Lives on the SCENE root (not the info panel); positioned near the
    // bottom-right of the screen in layoutChildren.
    if (this._growthPanel) this.removeChild(this._growthPanel);
    this._growthPanel = this._buildGrowthSection(cd, am);
    this.addChild(this._growthPanel);

    // Re-register the rebuilt description elements as keyword tooltip sources.
    this._registerKeywordTooltips();
  }

  /**
   * Register every collected description KeywordText as an inline keyword
   * tooltip source on the scene's TooltipManager (clears the previous set
   * first, since the panel is rebuilt each selection change).
   */
  _registerKeywordTooltips() {
    const tm = this._tooltipManager;
    if (!tm) return;
    tm.clearKeywordSources();
    const opts = { scale: 1.0, padding: 22, offset: 16, hitPadding: 7 };
    for (const kt of this._keywordDescs) tm.attachKeywordSource(kt, opts);
  }

  /**
   * Build the Growth section: a "[growth flair] Growth [growth flair]" title,
   * one row per stat (HP / Atk / Mag) of GROWTH_BLIP_COUNT diamond blips
   * (filled = character_select_growth_fill, empty = _growth_outline) scaled
   * from the character's per-victory growthPlan via growthBlips(), and the
   * growth_flair_bottom flourish underneath. All sizing comes from UI.growth.
   * @param {object} cd - characterData (reads cd.growthPlan)
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildGrowthSection(cd, am) {
    const S = this._uiScale;
    const G = UI.growth;
    const plan = cd.growthPlan || {};

    const stats = [
      { label: 'HP',  blips: growthBlips('maxHp', plan.maxHp || 0) },
      { label: 'Atk', blips: growthBlips('startingAttack', plan.startingAttack || 0) },
      { label: 'Mag', blips: growthBlips('startingMagic', plan.startingMagic || 0) },
    ];

    const section = new UIContainer();
    section.direction = 'column';
    section.alignItems = 'center';
    section.gap = G.rowGap * S;
    // Explicit dimensions — the panel is positioned manually in
    // layoutChildren, so it must know its own size.
    section.width = G.panelWidth * S;
    section.height = (
      G.titleHeight +
      stats.length * G.rowHeight +
      G.bottomFlairHeight + G.bottomMarginTop +
      (stats.length + 1) * G.rowGap
    ) * S;

    // Title row: [growth flair] Growth [growth flair]
    const titleRow = new UIContainer();
    titleRow.direction = 'row';
    titleRow.justifyContent = 'center';
    titleRow.alignItems = 'center';
    titleRow.gap = G.titleGap * S;
    titleRow.height = G.titleHeight * S;

    const gFlairL = new UIImage('character_select_growth_flair_left', am);
    gFlairL.setStyle({ width: G.flairWidth * S, height: G.flairHeight * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    titleRow.addChild(gFlairL);

    const titleText = new UIText('Growth');
    titleText.setStyle({
      fontSize: G.titleFontSize * S,
      color: G.titleColor,
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: G.titleWidth * S,
      // maxWidth REQUIRED: UIText defaults it to 0, which UIContainer's flex
      // clamp reads as "max width 0" → a zero-width rect the text spills out
      // of, letting the flairs overlap the word (the CharacterInfoPane gotcha).
      maxWidth: G.titleWidth * S,
      height: G.titleHeight * S,
      margin: { left: G.titleMarginX * S, right: G.titleMarginX * S }
    });
    titleRow.addChild(titleText);

    const gFlairR = new UIImage('character_select_growth_flair_right', am);
    gFlairR.setStyle({ width: G.flairWidth * S, height: G.flairHeight * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    titleRow.addChild(gFlairR);
    section.addChild(titleRow);

    // Stat rows: [label] ◆◆◆◇◇ — identical fixed widths per row so the
    // centered rows align their blip columns across stats.
    for (const stat of stats) {
      const row = new UIContainer();
      row.direction = 'row';
      row.justifyContent = 'center';
      row.alignItems = 'center';
      row.gap = G.blipGap * S;
      row.height = G.rowHeight * S;

      const label = new UIText(stat.label);
      label.setStyle({
        fontSize: G.labelFontSize * S,
        color: G.labelColor,
        bold: true,
        alignH: 'right',
        alignV: 'center',
        width: G.labelWidth * S,
        maxWidth: G.labelWidth * S, // see titleText maxWidth note
        height: G.rowHeight * S,
        margin: { right: G.labelMarginRight * S }
      });
      row.addChild(label);

      for (let i = 0; i < GROWTH_BLIP_COUNT; i++) {
        const blipKey = i < stat.blips
          ? 'character_select_growth_fill'
          : 'character_select_growth_outline';
        const blip = new UIImage(blipKey, am);
        blip.setStyle({ width: G.blipSize * S, height: G.blipSize * S, fitMode: 'contain' });
        row.addChild(blip);
      }
      section.addChild(row);
    }

    // Bottom flourish
    const bottomFlair = new UIImage('character_select_growth_flair_bottom', am);
    bottomFlair.setStyle({
      width: G.bottomFlairWidth * S,
      height: G.bottomFlairHeight * S,
      fitMode: 'contain',
      margin: { top: G.bottomMarginTop * S }
    });
    section.addChild(bottomFlair);

    return section;
  }

  /**
   * Build a "[flair] Title [flair]" section header row (used by both the
   * Starting Skills and Starting Relic sections). All sizing comes from
   * UI.sectionTitle.
   * @param {string} title
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildSectionTitleRow(title, am) {
    const S = this._uiScale;
    const ST = UI.sectionTitle;

    const row = new UIContainer();
    row.direction = 'row';
    row.justifyContent = 'center';
    row.alignItems = 'center';
    row.gap = ST.gap * S;
    row.height = ST.height * S;

    const flairL = new UIImage('character_select_flair_left', am);
    flairL.setStyle({ width: ST.flairWidth * S, height: ST.flairHeight * S, fitMode: 'contain', imageAlignH: 'right', imageAlignV: 'center' });
    row.addChild(flairL);

    const titleText = new UIText(title);
    titleText.setStyle({
      fontSize: ST.fontSize * S,
      color: ST.color,
      bold: true,
      alignH: 'center',
      alignV: 'center',
      width: ST.textWidth * S,
      height: ST.textHeight * S,
      margin: { left: ST.textMarginX * S, right: ST.textMarginX * S }
    });
    row.addChild(titleText);

    const flairR = new UIImage('character_select_flair_right', am);
    flairR.setStyle({ width: ST.flairWidth * S, height: ST.flairHeight * S, fitMode: 'contain', imageAlignH: 'left', imageAlignV: 'center' });
    row.addChild(flairR);

    return row;
  }

  /**
   * Build a single skill block (icon + name + description) for the info panel.
   * Larger, breathable composition that matches the mock's visual weight.
   * All sizing comes from UI.skillBlock.
   * @param {object} skillData - { name, description, icon }
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildSkillBlock(skillData, am) {
    const S = this._uiScale;
    const SB = UI.skillBlock;
    const block = new UIContainer();
    block.direction = 'row';
    block.alignItems = 'center';
    block.gap = SB.gap * S;
    block.width = SB.width * S;
    block.height = SB.height * S;

    // Column 1: Skill icon
    const iconKey = skillData.icon || 'placeholder';
    const icon = new UIImage(iconKey, am);
    icon.setStyle({ width: SB.iconSize * S, height: SB.iconSize * S, fitMode: 'contain' });
    block.addChild(icon);

    // Column 2: Name + Description in their own rows
    const textCol = new UIContainer();
    textCol.direction = 'column';
    textCol.justifyContent = 'center';
    textCol.alignItems = 'start';
    textCol.gap = SB.textColGap * S;

    const nameText = new UIText(skillData.name || '');
    nameText.setStyle({
      fontSize: SB.nameFontSize * S,
      color: SB.nameColor,
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: SB.nameHeight * S,
      margin: { bottom: SB.nameMarginBottom * S, top: SB.nameMarginTop * S }
    });
    textCol.addChild(nameText);

    const descText = new KeywordText(skillData.description || '');
    descText.setStyle({
      fontSize: SB.descFontSize * S,
      color: SB.descColor,
      alignH: 'left',
      alignV: 'top',
      height: SB.descHeight * S,
      maxWidth: SB.descMaxWidth * S,
    });
    textCol.addChild(descText);
    this._keywordDescs.push(descText);

    block.addChild(textCol);

    return block;
  }

  /**
   * Build the single relic block (icon + name + description) for the
   * Starting Relic row. Wider than a skill block so the description has
   * room to breathe on one line — there's only ever one relic, so the
   * block can spread across most of the panel's content width.
   * @param {object} relicData - { name, description, icon }
   * @param {import('../engine/AssetManager.js').default} am
   * @returns {UIContainer}
   */
  _buildRelicBlock(relicData, am) {
    const S = this._uiScale;
    const RB = UI.relicBlock;
    // Center the icon+text pair WITHIN the block (block.justifyContent =
    // 'center'). Without this, textCol's implicit flexGrow:1 stretches it to
    // fill the block, leaving the icon anchored to the left edge — which
    // made the relic look left-aligned even though the block itself was
    // centered in the row. textCol now has a fixed width and explicit
    // flexGrow:0 so the icon+textCol stays compact and slack distributes
    // evenly on both sides.
    const textColWidth = RB.textColWidth * S;
    const block = new UIContainer();
    block.direction = 'row';
    block.justifyContent = 'center';
    block.alignItems = 'center';
    block.gap = RB.gap * S;
    block.width = RB.width * S;
    block.height = RB.height * S;

    const iconKey = relicData.icon || 'placeholder';
    const icon = new UIImage(iconKey, am);
    icon.setStyle({ width: RB.iconSize * S, height: RB.iconSize * S, fitMode: 'contain' });
    block.addChild(icon);

    const textCol = new UIContainer();
    textCol.direction = 'column';
    textCol.justifyContent = 'center';
    textCol.alignItems = 'start';
    textCol.gap = RB.textColGap * S;
    textCol.width = textColWidth;
    textCol.flexGrow = 0;

    const nameText = new UIText(relicData.name || '');
    nameText.setStyle({
      fontSize: RB.nameFontSize * S,
      color: RB.nameColor,
      bold: true,
      alignH: 'left',
      alignV: 'center',
      height: RB.nameHeight * S,
      margin: { bottom: RB.nameMarginBottom * S, top: RB.nameMarginTop * S }
    });
    textCol.addChild(nameText);

    const descText = new KeywordText(relicData.description || '');
    descText.setStyle({
      fontSize: RB.descFontSize * S,
      color: RB.descColor,
      alignH: 'left',
      alignV: 'top',
      height: RB.descHeight * S,
      maxWidth: textColWidth,
    });
    textCol.addChild(descText);
    this._keywordDescs.push(descText);

    block.addChild(textCol);

    return block;
  }

  // ═══════════════════════════════════════════════════════
  // Layout (override — manual positioning)
  // ═══════════════════════════════════════════════════════

  /**
   * Manual layout: compute the info panel height from its children, then
   * center the entire block (panel + heroes + button) vertically in the
   * canvas. This avoids the auto-height limitation of the flexbox system.
   *
   * The panel uses a narrow, card-like width (≈38% of canvas) to create
   * the compact, centered "card" feel from the mock rather than a wide,
   * flattened strip.
   */
  layoutChildren() {
    const W = this.rect.w;
    const H = this.rect.h;
    if (W <= 0 || H <= 0) return;

    // ── 0. Sync UI scale to the current physical viewport ───
    // On aspect ratios that pillarbox/letterbox the design viewport
    // (e.g. mobile landscape, 21:9 ultrawide), scale UI elements up so
    // they fill a similar share of the physical screen as on a 16:9 display.
    const newScale = this._computeUIScale();
    if (Math.abs(newScale - this._uiScale) > 0.005) {
      this._uiScale = newScale;
      this._applyUIScaleToFixedElements();
      this._updateInfoPanel();
    }

    const S = this._uiScale;
    const panel = this._infoPanel;
    const heroes = this._heroesRow;

    // ── 1. Compute info panel dimensions ─────────────────
    // Wider card proportions to match the updated character_select_info_panel
    // asset's aspect ratio — see UI.panel (widthFrac clamped to widthMin/Max).
    let panelW = 700 * S;
    let panelH = 200 * S;

    if (panel) {
      panelW = Math.min(UI.panel.widthMax * S, Math.max(UI.panel.widthMin * S, W * UI.panel.widthFrac * S));

      // Do a trial layout with generous height so child rects are computed
      panel.rect.x = 0;
      panel.rect.y = 0;
      panel.rect.w = panelW;
      panel.rect.h = 600 * S;
      panel.layoutChildren();

      // Sum actual child heights
      const pad = panel._resolvePadding();
      let contentH = pad.top + pad.bottom;
      const visibleKids = panel.children.filter(c => c.visible);
      for (const kid of visibleKids) {
        contentH += kid.rect.h;
      }
      contentH += panel.gap * Math.max(0, visibleKids.length - 1);
      panelH = Math.ceil(contentH);
    }

    // ── 2. Fixed heights for heroes row and button ──────
    const heroesW = this._definitions.length * UI.heroes.slotWidth * S;
    const heroesH = UI.heroes.rowHeight * S;
    const btnW = UI.button.slotWidth * S;
    const btnH = UI.button.slotHeight * S;
    const gapPanelHeroes = Math.floor(H * GAP_PANEL_HEROES_FRAC);
    const gapHeroesBtn = Math.floor(H * GAP_HEROES_BUTTON_FRAC);

    // ── 3. Center the entire block vertically ───────────
    // The heroes row + button chain lifts by BLOCK_Y_LIFT_FRAC; the info
    // panel lifts by its own smaller PANEL_Y_LIFT_FRAC (see constants).
    const totalBlockH = panelH + gapPanelHeroes + heroesH + gapHeroesBtn + btnH;
    const baseStartY = Math.max(0, Math.floor((H - totalBlockH) / 2));
    const startY = Math.max(0, baseStartY - Math.floor(H * BLOCK_Y_LIFT_FRAC));
    const panelY = Math.max(0, baseStartY - Math.floor(H * PANEL_Y_LIFT_FRAC));

    // ── 4. Position elements ────────────────────────────
    // The info content floats on the LEFT of the splash (opposite the character
    // art), centered around LEFT_BLOCK_CENTER_FRAC. The heroes portrait row and
    // the Choose Hero button stay centered mid-screen.
    const blockCenterX = Math.floor(W * LEFT_BLOCK_CENTER_FRAC);

    if (panel) {
      panel.rect.x = Math.floor(blockCenterX - panelW / 2);
      panel.rect.y = panelY;
      panel.rect.w = panelW;
      panel.rect.h = panelH;
      panel.layoutChildren();
    }

    if (heroes) {
      heroes.rect.x = Math.floor((W - heroesW) / 2);
      heroes.rect.y = startY + panelH + gapPanelHeroes;
      heroes.rect.w = heroesW;
      heroes.rect.h = heroesH;
      heroes.layoutChildren();
    }

    if (this._btnContainer) {
      this._btnContainer.rect.x = Math.floor((W - btnW) / 2);
      this._btnContainer.rect.y = startY + panelH + gapPanelHeroes + heroesH + gapHeroesBtn;
      this._btnContainer.rect.w = btnW;
      this._btnContainer.rect.h = btnH;
      this._btnContainer.layoutChildren();
    }

    // ── 5. Growth panel: free-floating near the bottom-right ──
    const growth = this._growthPanel;
    if (growth) {
      const G = UI.growth;
      const gw = growth.width;
      const gh = growth.height;
      growth.rect.x = Math.floor(W - gw - G.marginRight * S);
      growth.rect.y = Math.floor(H - gh - G.marginBottom * S);
      growth.rect.w = gw;
      growth.rect.h = gh;
      growth.layoutChildren();
    }
  }

  // ═══════════════════════════════════════════════════════
  // UI scale (aspect-aware fill)
  // ═══════════════════════════════════════════════════════

  /**
   * Compute a UI multiplier based on how much the physical canvas aspect
   * differs from the design viewport aspect. When the physical viewport is
   * pillarboxed (wider) or letterboxed (taller) than the design rect, UI
   * elements get scaled up so they fill a similar share of the screen as
   * they do on a 16:9 display.
   *
   * Capped at 1.5× to keep the layout from outgrowing the design viewport
   * vertically on extreme aspect ratios.
   *
   * @returns {number}
   */
  _computeUIScale() {
    const app = this._sceneManager ? this._sceneManager._app : null;
    if (!app || !app.cssWidth || !app.cssHeight) return 1;

    const designAspect = app.designWidth / app.designHeight;
    const cssAspect = app.cssWidth / app.cssHeight;
    const ratio = cssAspect > designAspect
      ? cssAspect / designAspect
      : designAspect / cssAspect;

    return Math.min(UI.scaleMax, Math.max(UI.scaleMin, ratio));
  }

  /**
   * Re-apply size styles to the long-lived UI elements created in
   * _buildScene (portraits, choose-hero button, heroes row gap) so they
   * track the current _uiScale. Inner info-panel elements are rebuilt
   * separately via _updateInfoPanel().
   */
  _applyUIScaleToFixedElements() {
    const S = this._uiScale;

    if (this._heroesRow) {
      this._heroesRow.gap = UI.heroes.gap * S;
    }

    for (const portrait of this._portraitImages) {
      portrait.setStyle({ width: UI.heroes.portraitSize * S, height: UI.heroes.portraitSize * S });
    }

    if (this._chooseButton) {
      this._chooseButton.setStyle({ width: UI.button.imageWidth * S, height: UI.button.imageHeight * S });
    }
  }

  // ═══════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════

  /** @returns {object|undefined} the currently selected definition */
  _getSelectedDef() {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._definitions.length) {
      return this._definitions[0];
    }
    return this._definitions[this._selectedIndex];
  }

  /**
   * Change the selected character index.
   * Triggers cross-fade and info panel rebuild.
   * @param {number} newIndex
   */
  _selectIndex(newIndex) {
    if (newIndex < 0 || newIndex >= this._definitions.length) return;
    if (newIndex === this._selectedIndex) return;

    // Play character pick sound
    AudioManager.playSfx('character_select_pick');

    // Start cross-fade from current to new splash
    const prevDef = this._getSelectedDef();
    this._prevSplashKey = prevDef ? prevDef.splashKey : null;
    this._selectedIndex = newIndex;
    const newDef = this._getSelectedDef();
    this._currSplashKey = newDef ? newDef.splashKey : null;
    this._crossFadeAlpha = 0;

    // An outgoing hero's live bg video pauses in place and serves as the prev
    // layer for the cross-fade (instead of popping to its static splash).
    this._prevSplashVideo = this._isSplashBgLive() ? this._splashBgVideo : null;
    if (this._prevSplashVideo) {
      try { this._prevSplashVideo.pause(); } catch (e) { /* ignore */ }
    }
    this._startSplashBgVideo(newDef);
    // Rapid A→B→A reselect: the restarted video IS the "outgoing" element —
    // drop the prev layer rather than drawing the same frame twice.
    if (this._prevSplashVideo === this._splashBgVideo) this._prevSplashVideo = null;

    // Transition aura color to new character
    if (newDef && newDef.auraColor) {
      const ac = newDef.auraColor;
      this._auraEffect.setTargetColor(ac.r, ac.g, ac.b);
    }

    // Rebuild info panel for new character
    this._updateInfoPanel();

    // All hero intro videos are preloaded into the pool up front (see
    // _preloadAllVideos in onEnter), so the newly selected hero is already
    // buffered + primed and needs no per-selection work here.
  }

  // ═══════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════

  /** Called by SceneManager when this scene becomes active */
  onEnter() {
    const sm = this._sceneManager;
    if (!sm) return;

    this._assetManager = sm.assetManager;

    // Initialize splash to the first selected character
    const def = this._getSelectedDef();
    this._currSplashKey = def ? def.splashKey : null;
    this._prevSplashKey = null;
    this._crossFadeAlpha = 1.0;
    this._buttonHovered = false;

    // Reset the choose-hero video intro (the scene instance is reused across
    // runs, e.g. after a defeat returns here).
    this._choosingActive = false;
    this._chooseHandoff = false;
    this._chooseSkipReveal = false;
    this._mapTransitionSfxId = null;
    this._chosenDef = null;
    this._chooseElapsed = 0;
    this._chooseTransitionStarted = false;
    this._uiFadeAlpha = 1;
    this._videoFadeMs = 0;
    this._videoPlayStarted = false;
    // Preload + prime EVERY hero's intro video so whichever hero is confirmed
    // plays instantly with no buffering/decode stall.
    this._preloadAllVideos();

    // Splash background videos: buffer them all, then start the selected
    // hero's (the static splash shows until its first frame is paintable).
    this._prevSplashVideo = null;
    this._preloadAllSplashBgVideos();
    this._startSplashBgVideo(def);

    // Initialize aura color to selected character
    if (def && def.auraColor) {
      const ac = def.auraColor;
      this._auraEffect.setColorInstant(ac.r, ac.g, ac.b);
    }

    // Propagate assetManager to all UIImage children
    this._propagateAssetManager(this);

    // ── Tooltip manager (created once; reused across re-entries) ──
    // Created BEFORE _updateInfoPanel so the rebuilt description elements can
    // register their inline keyword spans as tooltip sources.
    if (!this._tooltipManager) {
      this._tooltipManager = new TooltipManager({
        input: sm._input,
        app: sm._app,
        assetManager: this._assetManager,
      });
    }
    this._tooltipManager.clear();
    this._tooltipManager.setEnabled(true);

    // Rebuild info panel now that assetManager is available
    this._updateInfoPanel();

    // ── Music ──────────────────────────────────────────
    AudioManager.playMusic('main_theme', { fadeIn: 600 });

    // ── Wire input ──────────────────────────────────────
    const input = sm._input;
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onMouseUp = (x, y) => this._handleMouseUp(x, y);
    this._onKeyDown = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.on('mouseup', this._onMouseUp);
    input.canvas.addEventListener('keydown', this._onKeyDown);
    input.canvas.focus();
  }

  /** Called by SceneManager when this scene is being left */
  onExit() {
    const sm = this._sceneManager;
    if (!sm) return;

    // ── Stop music ────────────────────────────────────
    AudioManager.stopMusic(300);

    const input = sm._input;
    if (this._onMouseDown) {
      input.off('mousedown', this._onMouseDown);
      this._onMouseDown = null;
    }
    if (this._onMouseMove) {
      input.off('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onMouseUp) {
      input.off('mouseup', this._onMouseUp);
      this._onMouseUp = null;
    }
    if (this._tooltipManager) {
      this._tooltipManager.clear();
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }

    // Release all preloaded intro videos (the transition to the next scene is
    // already underway by the time this fires).
    this._destroyVideoPool();
    this._destroySplashBgPool();

    // Safety: release a title-transition overlay that hasn't finished fading
    // (e.g. the player confirmed a hero within the overlay's first frames).
    this._destroyEntryOverlay();
  }

  // ═══════════════════════════════════════════════════════
  // Title-transition entry overlay (handed off by TitleScreen)
  // ═══════════════════════════════════════════════════════

  /**
   * Take ownership of the still-playing title-transition <video> and fade it
   * out over this scene's UI. Called by TitleScreen immediately before its
   * instant switchTo here, so onEnter must not (and does not) reset it.
   * @param {HTMLVideoElement} video — plays out and is released when the fade ends
   * @param {number} fadeMs — fade-out duration
   */
  setEntryVideoOverlay(video, fadeMs) {
    this._destroyEntryOverlay();
    this._entryOverlayVideo = video || null;
    this._entryOverlayFadeMs = Math.max(1, fadeMs || 600);
    this._entryOverlayElapsed = 0;
  }

  _destroyEntryOverlay() {
    const video = this._entryOverlayVideo;
    if (!video) return;
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
    this._entryOverlayVideo = null;
  }

  /** Recursively set assetManager on all UIImage children */
  _propagateAssetManager(element) {
    if (element.assetManager === null && element instanceof UIImage) {
      element.assetManager = this._assetManager;
    }
    for (const child of element.children) {
      this._propagateAssetManager(child);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Input
  // ═══════════════════════════════════════════════════════

  /** @param {number} x @param {number} y */
  _handleMouseDown(x, y) {
    // Once a hero is confirmed and the intro video is playing, input only
    // skips: a click/tap during the map-transition movie (past a short grace)
    // jumps straight to the settled map screen.
    if (this._choosingActive) {
      if (this._chooseHandoff && !this._chooseTransitionStarted
          && this._chooseElapsed >= MAP_TRANSITION_SKIP_GRACE_MS) {
        this._chooseSkipReveal = true;
        // Cut the transition stinger with the movie it accompanies.
        AudioManager.stopSfx(
          MAP_TRANSITION_SFX_KEY, this._mapTransitionSfxId, MAP_TRANSITION_SFX_STOP_FADE_MS
        );
        this._mapTransitionSfxId = null;
        this._startChooseTransition();
      }
      return;
    }

    if (this._tooltipManager) this._tooltipManager.onMouseDown(x, y);

    const hit = this.hitTest(x, y);
    if (!hit) return;

    const ud = hit.userData;

    // Portrait click
    if (ud && ud.index !== undefined) {
      this._selectIndex(ud.index);
      return;
    }

    // Choose Hero button click
    if (ud && ud.isButton) {
      this._chooseHero();
      return;
    }
  }

  /** @param {number} x @param {number} y */
  _handleMouseUp(x, y) {
    if (this._tooltipManager) this._tooltipManager.onMouseUp(x, y);
  }

  /** @param {number} x @param {number} y */
  _handleMouseMove(x, y) {
    if (this._tooltipManager) this._tooltipManager.onMouseMove(x, y);

    const hit = this.hitTest(x, y);
    const ud = hit ? hit.userData : null;

    const newHover = !!(ud && ud.isButton);
    if (newHover !== this._buttonHovered) {
      this._buttonHovered = newHover;
      if (this._chooseButton) {
        this._chooseButton.assetKey = newHover
          ? 'character_select_choose_hero_button_hover'
          : 'character_select_choose_hero_button';
      }
    }
  }

  /** @param {KeyboardEvent} e */
  _handleKeyDown(e) {
    // Lock out navigation/confirm while the intro video is playing.
    if (this._choosingActive) return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this._selectPrev();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this._selectNext();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this._chooseHero();
        break;
    }
  }

  _selectPrev() {
    const newIdx = this._selectedIndex - 1;
    if (newIdx >= 0) this._selectIndex(newIdx);
  }

  _selectNext() {
    const newIdx = this._selectedIndex + 1;
    if (newIdx < this._definitions.length) this._selectIndex(newIdx);
  }

  // ═══════════════════════════════════════════════════════
  // Battle transition
  // ═══════════════════════════════════════════════════════

  _chooseHero() {
    // Ignore re-confirms while an intro video is already playing.
    if (this._choosingActive) return;

    const def = this._getSelectedDef();
    if (!def) return;

    const sm = this._sceneManager;
    if (!sm) return;

    // Play confirm sound
    AudioManager.playSfx('character_select_confirm');

    // Map-transition mode (default): the shared movie plays and hands off to
    // MapScene's fullscreen-splash reveal. The per-hero intro is disabled.
    if (!USE_CHOOSE_HERO_INTRO) {
      this._beginChooseIntro(def, MAP_TRANSITION_VIDEO);
      return;
    }

    // If this hero has a full-canvas intro video, fade the UI out and play it;
    // the scene transition is deferred until the video nears its end.
    if (def.splashVideo) {
      this._beginChooseIntro(def);
      return;
    }

    // Otherwise transition immediately (existing behavior).
    this._performSceneTransition(def);
  }

  /**
   * Begin the choose-hero intro: fade the UI out (driven in update) and play
   * a full-canvas video. The actual scene transition is started later by
   * _startChooseTransition() once the video nears its end (or on
   * end/error/timeout).
   * @param {object} def
   * @param {string|null} [overrideSrc] — play this shared movie instead of the
   *   hero's `splashVideo`, and END with the MapScene HANDOFF (instant
   *   switchTo + entry overlay) instead of the classic fadeToScene.
   */
  _beginChooseIntro(def, overrideSrc = null) {
    this._choosingActive = true;
    this._chosenDef = def;
    this._chooseHandoff = !!overrideSrc;
    this._chooseSkipReveal = false;
    this._chooseElapsed = 0;
    this._chooseTransitionStarted = false;
    this._videoFadeMs = 0;

    // Freeze the splash bg video where it is — the choose video covers it, so
    // keeping it decoding would only burn frames (its paused frame remains the
    // splash base until the choose video's first frame paints over it).
    if (this._splashBgVideo) {
      try { this._splashBgVideo.pause(); } catch (e) { /* ignore */ }
    }

    // Grab the (already preloaded + primed) pooled video.
    const src = overrideSrc || def.splashVideo;
    const video = this._ensurePooledVideo(src);
    this._video = video;
    this._videoSrc = src;
    this._videoStallMs = 0;
    this._lastVideoTime = -1;
    if (!video || video._csFailed || video.error) {
      // No element, or its load already failed (offline PWA: the .mp4 never
      // arrived) — skip the intro and transition over the static splash.
      this._video = null;
      this._startChooseTransition();
      return;
    }

    // Map-transition mode: the stinger replaces the select-screen music the
    // moment the movie starts (without this, main_theme keeps playing under
    // the whole cutscene — onExit's stopMusic only fires at the handoff).
    if (this._chooseHandoff) {
      AudioManager.stopMusic(MAP_TRANSITION_MUSIC_FADE_MS);
      this._mapTransitionSfxId = AudioManager.playSfx(MAP_TRANSITION_SFX_KEY);
    }

    // The pooled video may still be mid-prime (playing muted) — make sure it
    // sits paused on frame 0 for the fade.
    try { video.pause(); } catch (e) { /* ignore */ }
    try { video.currentTime = 0; } catch (e) { /* ignore */ }
    // Hold the video paused on its first frame while it fades in over the
    // splash; playback starts from _updateChooseIntro once the fade completes
    // (blending the splash with already-moving video reads as ghosting).
    this._videoPlayStarted = false;
    if (CHOOSE_VIDEO_FADE_IN_MS <= 0) this._startVideoPlayback();
  }

  /**
   * Issue play() on the intro video exactly once (deferred until its fade-in
   * over the splash completes). Autoplay block / decode failure falls back to
   * an immediate scene transition.
   */
  _startVideoPlayback() {
    if (this._videoPlayStarted) return;
    this._videoPlayStarted = true;
    const video = this._video;
    if (!video) return;
    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => this._startChooseTransition());
    }
  }

  /**
   * Perform the run-state setup and fade to the next scene. Extracted from
   * _chooseHero so it can run either immediately (no video) or deferred (after
   * the intro video).
   * @param {object} def
   */
  _performSceneTransition(def) {
    const sm = this._sceneManager;
    if (!sm) return;

    // Create run state from the immutable character definition.
    // This preserves baseStats as the immutable template and initializes
    // statModifiers to zero — ready for run progression.
    const runState = createRunState(def.characterData);

    // Set up MapScene for this run
    const mapScene = sm._scenes['MapScene'];
    if (mapScene) {
      // Fully reset map/traversal state so this run starts clean — without
      // this, a prior run that ended in defeat (which bypasses the normal
      // return-to-map flow) leaves stale traversal state and the new run
      // would reuse the old map/position. (setRunState below replaces HP/stats.)
      if (mapScene.resetForNewRun) mapScene.resetForNewRun();

      // Generate a fresh seed for this run
      mapScene.setSeed('run_' + Date.now());
      mapScene.setRunState(runState, def.characterData);

      // Fade transition to map scene
      sm.fadeToScene('MapScene', 500);
    } else {
      // Fallback: direct to battle (shouldn't happen if MapScene is registered)
      console.warn('MapScene not found, falling back to direct BattleScene');
      const enemyClone = JSON.parse(JSON.stringify(goblin));
      enemyClone.skills = resolveSkillIds(enemyClone.skills || []);
      enemyClone.relics = resolveEnemyRelicIds(enemyClone.relics || []);
      const playerBattleState = createPlayerBattleState(def.characterData, runState);
      const battleController = new BattleController(playerBattleState, enemyClone);
      const battleScene = new BattleScene(
        playerBattleState,
        enemyClone,
        this._assetManager,
        battleController
      );
      battleScene.setAudioManager(sm.audioManager);
      sm.registerScene('BattleScene', battleScene);
      sm.fadeToScene('BattleScene', 500);
    }
  }

  /**
   * Map-transition variant of the scene exit: same run-state setup as
   * _performSceneTransition, but the still-playing movie is HANDED OFF to
   * MapScene (setEntryVideoOverlay + an instant switchTo — no black fade,
   * decision #58 idiom): MapScene dissolves the movie's held last frame over
   * its FULLSCREEN map splash, which then shrinks into the map container.
   * Ownership of the element transfers — its pool listeners detach and it
   * leaves `_videoPool` BEFORE switchTo, so onExit's pool teardown can't
   * destroy it mid-dissolve. Falls back to the classic fade when the movie
   * never became paintable (offline/error) or MapScene can't take it.
   * @param {object} def
   */
  _performMapHandoff(def) {
    const sm = this._sceneManager;
    if (!sm) return;

    // Mid-transition (e.g. still fading in from the title): retry next update.
    if (sm.isTransitioning()) {
      this._chooseTransitionStarted = false;
      return;
    }

    const mapScene = sm._scenes['MapScene'];
    if (!mapScene) {
      this._performSceneTransition(def); // its fallback path handles this
      return;
    }

    // Run-state setup (mirrors _performSceneTransition).
    const runState = createRunState(def.characterData);
    if (mapScene.resetForNewRun) mapScene.resetForNewRun();
    mapScene.setSeed('run_' + Date.now());
    mapScene.setRunState(runState, def.characterData);

    // Click-to-skip: the movie's CURRENT frame dissolves over the SETTLED map
    // (no fullscreen-splash reveal), with a slightly longer fade since an
    // arbitrary mid-movie frame won't match the splash art.
    const skip = this._chooseSkipReveal;
    const overlayFadeMs = skip ? MAP_TRANSITION_SKIP_CROSSFADE_MS : MAP_TRANSITION_CROSSFADE_MS;

    const video = this._video;
    const paintable = video && !video._csFailed && !video.error && video.readyState >= 2;
    if (paintable && typeof mapScene.setEntryVideoOverlay === 'function') {
      // Transfer ownership BEFORE switchTo (whose onExit tears the pool down).
      const L = video._csListeners;
      if (L) {
        video.removeEventListener('loadedmetadata', L.onMeta);
        video.removeEventListener('ended', L.onEnded);
        video.removeEventListener('error', L.onError);
        video.removeEventListener('loadeddata', L.onLoadedData);
      }
      video._csListeners = null;
      this._videoPool.delete(this._videoSrc);
      this._video = null;
      this._videoSrc = null;
      // The reveal-skip in MapScene also needs to fade the stinger out — pass
      // its handle along (null after a movie-skip, which already stopped it).
      mapScene.setEntryVideoOverlay(video, overlayFadeMs, !skip,
        skip ? null : { key: MAP_TRANSITION_SFX_KEY, id: this._mapTransitionSfxId });
      this._mapTransitionSfxId = null;
      sm.switchTo('MapScene');
    } else {
      // Movie never played — classic fade into the normal (un-revealed) map.
      sm.fadeToScene('MapScene', 500);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Boot-time video preload + loading gate
  // ═══════════════════════════════════════════════════════

  /**
   * Buffer every video this scene will need — the confirm → map transition
   * movie (pooled + primed) and the splash background loops. Called from
   * main.js at BOOT (alongside TitleScreen.preloadVideos) so the LoadingScene
   * can gate on them; onEnter re-runs the same ensures as no-ops.
   */
  preloadVideos() {
    this._preloadAllVideos();
    this._preloadAllSplashBgVideos();
  }

  /**
   * Loading-gate readiness of the boot-preloaded videos. Failed or errored
   * elements count as READY — the gate must never wait on a video that will
   * never arrive (every consumer has a static fallback, decision #53).
   * @returns {{ready:number, total:number}}
   */
  getPreloadVideoStatus() {
    const vids = [...this._videoPool.values(), ...this._splashBgPool.values()];
    let ready = 0;
    for (const v of vids) {
      if (v._csFailed || v._bgFailed || v.error || v.readyState >= 3) ready++;
    }
    return { ready, total: vids.length };
  }

  // ═══════════════════════════════════════════════════════
  // Choose-hero intro video
  // ═══════════════════════════════════════════════════════

  /**
   * Preload + prime EVERY enabled hero's `splashVideo` into the pool so that
   * whichever hero is confirmed, its intro video plays the instant `play()` is
   * called — no network buffering or first-frame decode stall. Idempotent.
   */
  _preloadAllVideos() {
    if (USE_CHOOSE_HERO_INTRO) {
      for (const def of this._definitions) {
        const src = def && def.splashVideo;
        if (src) this._ensurePooledVideo(src);
      }
    } else {
      // Map-transition mode: only the shared confirm → map movie plays; it
      // rides the same pool/prime machinery so it starts frame-perfect on
      // confirm (the unused per-hero intros aren't buffered at all).
      this._ensurePooledVideo(MAP_TRANSITION_VIDEO);
    }
  }

  /**
   * Ensure the off-DOM <video> for `src` exists in the pool (building + kicking
   * off its load on first request) and return it. Re-calling for an already
   * pooled src returns the existing element.
   * @param {string} src
   * @returns {HTMLVideoElement|null}
   */
  _ensurePooledVideo(src) {
    if (!src) return null;
    let video = this._videoPool.get(src);
    if (video) return video;
    video = this._buildVideo(src);
    this._videoPool.set(src, video);
    try { video.load(); } catch (e) { /* ignore */ }
    return video;
  }

  /**
   * Create the off-DOM <video> for `src` and wire its listeners. Plays muted so
   * autoplay is allowed; the character-select music keeps playing underneath.
   * Listeners are stashed on the element (`_csListeners`) for teardown.
   * @param {string} src
   * @returns {HTMLVideoElement}
   */
  _buildVideo(src) {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;
    video.loop = false;
    video.preload = 'auto';

    // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
    // intrinsic video size so the cover-fit math works for the <video>.
    const onMeta = () => {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    };
    // The video ending / failing is a hard cue to finish (no-op until the intro
    // is actually active; _startChooseTransition guards on _choosingActive).
    const onEnded = () => this._startChooseTransition();
    const onError = () => {
      // Remember the terminal failure on the element: an offline preload
      // errors while no intro is active (the transition call below no-ops),
      // and a later play() on the errored element neither re-fires 'error'
      // nor settles its promise — _beginChooseIntro and the stall watchdog
      // check this flag instead of waiting on events that will never come.
      video._csFailed = true;
      this._startChooseTransition();
    };
    // Once the first frame is available, prime the decoder so playback starts
    // with zero stall when this hero is chosen.
    const onLoadedData = () => this._primeVideo(video);

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);
    video._csListeners = { onMeta, onEnded, onError, onLoadedData };

    return video;
  }

  /**
   * Warm a pooled video's decode pipeline by briefly play→pause-ing it (muted,
   * so this is allowed without a gesture and is inaudible), then rewinding to
   * frame 0. This forces the first frame to decode ahead of time so the real
   * `play()` on confirm has no buffering/decode hitch. Runs once per video and
   * never disturbs the video that's actively playing the intro.
   * @param {HTMLVideoElement} video
   */
  _primeVideo(video) {
    if (video._csPrimed) return;
    if (this._choosingActive && this._video === video) return; // it's live — leave it
    video._csPrimed = true;

    const settle = () => {
      if (this._choosingActive && this._video === video) return; // became live mid-prime
      try { video.pause(); } catch (e) { /* ignore */ }
      try { video.currentTime = 0; } catch (e) { /* ignore */ }
    };
    const p = video.play();
    if (p && typeof p.then === 'function') p.then(settle).catch(() => { /* ignore */ });
    else settle();
  }

  /** Stop, unwire, and release a single pooled <video> element. */
  _destroyPooledVideo(video) {
    if (!video) return;
    const L = video._csListeners;
    if (L) {
      video.removeEventListener('loadedmetadata', L.onMeta);
      video.removeEventListener('ended', L.onEnded);
      video.removeEventListener('error', L.onError);
      video.removeEventListener('loadeddata', L.onLoadedData);
    }
    video._csListeners = null;
    try { video.pause(); } catch (e) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
  }

  /** Release every pooled intro video. */
  _destroyVideoPool() {
    for (const video of this._videoPool.values()) this._destroyPooledVideo(video);
    this._videoPool.clear();
    this._video = null;
    this._videoSrc = null;
  }

  // ═══════════════════════════════════════════════════════
  // Splash background video (per-def `splashBackgroundVideo`)
  // ═══════════════════════════════════════════════════════

  /** Buffer every enabled hero's splash background video ahead of selection. Idempotent. */
  _preloadAllSplashBgVideos() {
    for (const def of this._definitions) {
      const src = def && def.splashBackgroundVideo;
      if (src) this._ensureSplashBgVideo(src);
    }
  }

  /**
   * Ensure the off-DOM <video> for a splash background `src` exists in its
   * pool (building + kicking off its load on first request) and return it.
   * @param {string} src
   * @returns {HTMLVideoElement|null}
   */
  _ensureSplashBgVideo(src) {
    if (!src) return null;
    let video = this._splashBgPool.get(src);
    if (!video) {
      video = this._buildSplashBgElement(src);
      this._splashBgPool.set(src, video);
    }
    return video;
  }

  /** Lazily build/get the standby twin used for seamless loop wraps of `src`. */
  _ensureSplashBgAlt(src) {
    if (!src) return null;
    let video = this._splashBgAltPool.get(src);
    if (!video) {
      video = this._buildSplashBgElement(src);
      this._splashBgAltPool.set(src, video);
    }
    return video;
  }

  /** Create + wire one off-DOM splash bg <video> (used by both pools). */
  _buildSplashBgElement(src) {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;        // required for autoplay without a fresh gesture
    video.playsInline = true;
    video.loop = false;        // wraps are double-buffered — see _wrapSplashBg
    video.preload = 'auto';

    const onMeta = () => {
      // CanvasApp.drawFullCanvasImage reads img.width/height — mirror the
      // intrinsic video size so the cover-fit math works for the <video>.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
    };
    // Only the ACTIVE element's end wraps the loop (a standby twin never
    // plays to its end; an outgoing prev-layer element is paused).
    const onEnded = () => {
      if (video === this._splashBgVideo) this._splashBgWrapPending = true;
    };
    // Remember terminal failures on the element (an errored element never
    // re-fires 'error' and its play() promise never settles — decision #53);
    // renderBackground then simply keeps the static splash.
    const onError = () => { video._bgFailed = true; };

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video._bgListeners = { onMeta, onEnded, onError };

    try { video.load(); } catch (e) { /* ignore */ }
    return video;
  }

  /**
   * Make `def`'s splash background video the active one (restarted from frame
   * 0), or clear the active video for a def without one. Called from onEnter
   * and on every selection change.
   * @param {object|null} def
   */
  _startSplashBgVideo(def) {
    this._splashBgVideo = null;
    this._splashBgSrc = null;
    this._splashBgFadeMs = 0;
    this._splashBgWrapPending = false;
    this._splashBgHold = null;

    const src = def && def.splashBackgroundVideo;
    if (!src) return;
    const video = this._ensureSplashBgVideo(src);
    if (!video || video._bgFailed || video.error) return; // static splash stays

    this._splashBgVideo = video;
    this._splashBgSrc = src;
    // Start the standby twin buffering now — it has a full loop's duration to
    // decode its first frame before the first wrap needs it.
    this._ensureSplashBgAlt(src);
    try { video.currentTime = 0; } catch (e) { /* ignore */ }
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      // Autoplay blocked / load failure — fall back to the static splash
      // (without the mark, a paintable-but-paused element would hold frame 0).
      p.catch(() => { video._bgFailed = true; });
    }
  }

  /**
   * Loop wrap (the active element fired 'ended'): swap to the primed standby
   * twin and play it from frame 0 — a fresh play on a parked element instead
   * of a seek on the playing one, so there's no decoder-flush stutter. The
   * ended element keeps rendering its held last frame until the twin paints
   * (renderBackground), then is rewound as the next standby (update()). If
   * the twin isn't ready (still buffering / failed), replay the ended element
   * — its held last frame still bridges the seek.
   */
  _wrapSplashBg() {
    const ended = this._splashBgVideo;
    const src = this._splashBgSrc;
    if (!ended || !src) return;

    const alt = this._ensureSplashBgAlt(src);
    const altReady = !!alt && !alt._bgFailed && !alt.error && alt.readyState >= 2;
    const next = altReady ? alt : ended;

    this._splashBgHold = ended;
    this._splashBgVideo = next;
    if (altReady) {
      // Swap pool roles so src lookups stay consistent across wraps.
      this._splashBgPool.set(src, alt);
      this._splashBgAltPool.set(src, ended);
    }
    try { next.currentTime = 0; } catch (e) { /* ignore */ }
    const p = next.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { next._bgFailed = true; });
    }
  }

  /** True while the active splash bg video should be drawn instead of the static splash. */
  _isSplashBgLive() {
    const v = this._splashBgVideo;
    return !!v && !v._bgFailed && !v.error && v.readyState >= 2;
  }

  /** Release every pooled splash background video. */
  _destroySplashBgPool() {
    const release = (video) => {
      const L = video._bgListeners;
      if (L) {
        video.removeEventListener('loadedmetadata', L.onMeta);
        video.removeEventListener('ended', L.onEnded);
        video.removeEventListener('error', L.onError);
      }
      video._bgListeners = null;
      try { video.pause(); } catch (e) { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
    };
    for (const video of this._splashBgPool.values()) release(video);
    for (const video of this._splashBgAltPool.values()) release(video);
    this._splashBgPool.clear();
    this._splashBgAltPool.clear();
    this._splashBgVideo = null;
    this._splashBgSrc = null;
    this._splashBgHold = null;
    this._splashBgWrapPending = false;
    this._prevSplashVideo = null;
  }

  /**
   * Start the deferred scene transition exactly once. Called when the intro
   * video nears its end, ends, errors, or the safety timeout elapses.
   */
  _startChooseTransition() {
    if (!this._choosingActive || this._chooseTransitionStarted) return;
    this._chooseTransitionStarted = true;
    if (this._chooseHandoff) this._performMapHandoff(this._chosenDef);
    else this._performSceneTransition(this._chosenDef);
  }

  /**
   * Drive the intro each frame: advance the elapsed timer and trigger the scene
   * cross-fade once the video is within CHOOSE_VIDEO_CROSSFADE_LEAD of its end
   * (or the safety timeout elapses).
   * @param {number} dt
   */
  _updateChooseIntro(dt) {
    this._chooseElapsed += dt;
    // Fade the UI out quickly so only the video remains.
    this._uiFadeAlpha = Math.max(0, this._uiFadeAlpha - dt / UI_FADE_OUT_DURATION);
    // Advance the video's fade-in over the splash, but only once its first
    // frame is actually paintable — so the fade always starts from the frame
    // the video appears, never mid-ramp after a buffering stall. The video
    // stays paused on that first frame until the fade completes, then plays.
    if (this._video && this._video.readyState >= 2) {
      this._videoFadeMs += dt;
      // Playback starts partway into the fade (CHOOSE_VIDEO_PLAY_AT_FADE_MS)
      // so the movie is already moving as the dissolve completes.
      if (this._videoFadeMs >= CHOOSE_VIDEO_PLAY_AT_FADE_MS) this._startVideoPlayback();
    } else if (this._chooseElapsed >= CHOOSE_VIDEO_PLAY_FALLBACK_MS) {
      // Never became paintable — play anyway so the ended/error fallbacks
      // (and the duration-based near-end check below) still drive the exit.
      this._startVideoPlayback();
    }

    if (this._chooseTransitionStarted) return;

    const v = this._video;

    // Fail-fast watchdog: bail to the scene transition if the video errored,
    // never produced a paintable frame, or stopped advancing (offline or a
    // flaky-network stall) — don't sit on a frozen splash until the 30s cap.
    if (v && (v._csFailed || v.error)) {
      this._startChooseTransition();
      return;
    }
    if (!v || v.readyState < 2) {
      this._videoStallMs += dt; // still nothing paintable
    } else if (this._videoPlayStarted && !v.ended && v.currentTime === this._lastVideoTime) {
      this._videoStallMs += dt; // playing but the clock isn't moving
    } else {
      this._videoStallMs = 0;
      this._lastVideoTime = v.currentTime;
    }
    if (this._videoStallMs >= CHOOSE_VIDEO_STALL_BAILOUT_MS) {
      this._startChooseTransition();
      return;
    }

    let nearEnd = false;
    if (v && isFinite(v.duration) && v.duration > 0) {
      const remainingMs = (v.duration - v.currentTime) * 1000;
      // The map handoff swaps scenes at the movie's very last frames (the
      // held frame then dissolves); the classic intro leads by the whole
      // fadeToScene duration.
      const lead = this._chooseHandoff
        ? MAP_TRANSITION_HANDOFF_LEAD_MS
        : CHOOSE_VIDEO_CROSSFADE_LEAD;
      nearEnd = remainingMs <= lead;
    }

    if (nearEnd || this._chooseElapsed >= CHOOSE_VIDEO_MAX_DURATION) {
      this._startChooseTransition();
    }
  }

  // ═══════════════════════════════════════════════════════
  // Update
  // ═══════════════════════════════════════════════════════

  /** @param {number} dt — delta time in ms */
  update(dt) {
    // Advance cross-fade
    if (this._crossFadeAlpha < 1.0) {
      this._crossFadeAlpha = Math.min(1.0, this._crossFadeAlpha + dt / CROSS_FADE_DURATION);
    }

    // Advance aura animation
    this._auraEffect.update(dt);

    // Advance tooltip hold-timer / state
    if (this._tooltipManager) this._tooltipManager.update(dt);

    // Splash bg loop wrap: swap to the primed standby twin the frame after
    // the active element fires 'ended'. During the choose-hero intro the loop
    // is left on its held last frame instead (it's covered by the choose
    // video; _beginChooseIntro paused it).
    if (this._splashBgWrapPending) {
      this._splashBgWrapPending = false;
      if (!this._choosingActive) this._wrapSplashBg();
    }

    // Advance the splash bg video's fade-in over the static splash. Once the
    // swapped-in element is painting, rewind the held predecessor to frame 0
    // so it sits primed as the standby for the next wrap.
    if (this._isSplashBgLive()) {
      this._splashBgFadeMs += dt;
      const hold = this._splashBgHold;
      if (hold) {
        this._splashBgHold = null;
        if (hold !== this._splashBgVideo) {
          try { hold.pause(); } catch (e) { /* ignore */ }
          try { hold.currentTime = 0; } catch (e) { /* ignore */ }
        }
      }
    }

    // Advance the choose-hero video intro (UI fade-out + deferred transition)
    if (this._choosingActive) this._updateChooseIntro(dt);

    // Advance the title-transition entry overlay fade; release the video the
    // moment it is fully transparent.
    if (this._entryOverlayVideo) {
      this._entryOverlayElapsed += dt;
      if (this._entryOverlayElapsed >= this._entryOverlayFadeMs) {
        this._destroyEntryOverlay();
      }
    }

    super.update(dt);
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  /**
   * Paint the character splash cross-fade across the entire physical canvas.
   * Called by SceneManager before the design-space viewport clip, so the
   * splash fills the letterbox/pillarbox bars. UI (info panel, heroes row,
   * button) is still drawn inside the design viewport via render().
   */
  renderBackground(_ctx) {
    const am = this._assetManager;
    const app = this._sceneManager && this._sceneManager._app;
    if (!am || !app) return;

    // Previous splash (cross-fade out) — the outgoing hero's paused bg video
    // frame when one was live, else its static splash.
    if (this._crossFadeAlpha < 1.0) {
      const prevVideo = this._prevSplashVideo;
      const prevVis = (prevVideo && !prevVideo.error && prevVideo.readyState >= 2)
        ? prevVideo
        : (this._prevSplashKey ? am.get(this._prevSplashKey) : null);
      if (prevVis) app.drawFullCanvasImage(prevVis, 1.0 - this._crossFadeAlpha);
    }

    // Current splash (cross-fade in): the static art — or, for a hero with a
    // live `splashBackgroundVideo`, the looping video (fading in over the
    // static once paintable; the static art remains only as the
    // buffering/failure fallback beneath it). Across a loop wrap the
    // just-ended element's held last frame stands in until the swapped-in
    // twin paints — never a flash of the static art mid-loop.
    if (this._currSplashKey) {
      const fadeIn = Math.min(1.0, this._crossFadeAlpha);
      const currImg = am.get(this._currSplashKey);
      const hold = this._splashBgHold;
      const bgFrame = this._isSplashBgLive() ? this._splashBgVideo
        : (hold && !hold.error && hold.readyState >= 2 ? hold : null);
      const videoAlpha = !bgFrame ? 0
        : SPLASH_BG_VIDEO_FADE_IN_MS > 0
          ? Math.min(1.0, this._splashBgFadeMs / SPLASH_BG_VIDEO_FADE_IN_MS)
          : 1.0;
      // Static base — skipped once the video fully covers it.
      if (currImg && videoAlpha < 1.0) app.drawFullCanvasImage(currImg, fadeIn);
      if (bgFrame) app.drawFullCanvasImage(bgFrame, videoAlpha * fadeIn);
    }

    // Subtle dark scrim fading from the left edge to ~66% across, to lift the
    // floating left-side text off the splash. Drawn over the splash but under
    // the UI; fades out alongside the UI during the choose-hero intro.
    if (LEFT_OVERLAY_ALPHA > 0 && this._uiFadeAlpha > 0.001) {
      const a = LEFT_OVERLAY_ALPHA * this._uiFadeAlpha;
      app.fillFullCanvasHGradient([
        { at: 0, color: `rgba(0,0,0,${a})` },
        { at: LEFT_OVERLAY_HOLD_FRAC, color: `rgba(0,0,0,${a})` },
        { at: LEFT_OVERLAY_FADE_END_FRAC, color: 'rgba(0,0,0,0)' },
      ]);
    }

    // Choose-hero intro video, drawn full-canvas on top of the splash with the
    // same cover-fit framing (the video matches the splash resolution). The
    // splash underneath covers any gap until the first frame is decodable,
    // then the video fades in over CHOOSE_VIDEO_FADE_IN_MS (reading as the
    // splash fading out into the video) to mask small art inconsistencies.
    if (this._choosingActive && this._video && this._video.readyState >= 2) {
      const alpha = CHOOSE_VIDEO_FADE_IN_MS > 0
        ? Math.min(1.0, this._videoFadeMs / CHOOSE_VIDEO_FADE_IN_MS)
        : 1.0;
      app.drawFullCanvasImage(this._video, alpha);
    }
  }

  /** No in-viewport background — splashes are drawn full-canvas in renderBackground. */
  renderSelf(_ctx) {}

  /**
   * Draw the title-transition entry overlay ON TOP of all UI (full canvas,
   * covering the bars): the handed-off transition movie finishes playing at a
   * decaying alpha, cross-fading into this scene's layout beneath it.
   */
  renderForeground(_ctx) {
    const video = this._entryOverlayVideo;
    if (!video || video.error || video.readyState < 2) return;
    const app = this._sceneManager && this._sceneManager._app;
    if (!app) return;
    const alpha = Math.max(0, 1 - this._entryOverlayElapsed / this._entryOverlayFadeMs);
    if (alpha <= 0) return;
    app.drawFullCanvasImage(video, alpha);
  }

  /**
   * Draw the info panel background image. Called from render() after the
   * aura so the panel sits above the aura but below panel children text/icons.
   */
  _drawInfoPanelBackground(ctx) {
    const am = this._assetManager;
    if (!am) return;

    if (this._infoPanel) {
      const panelImg = am.get('character_select_info_panel');
      if (panelImg) {
        const pr = this._infoPanel.rect;
        if (pr.w > 0 && pr.h > 0) {
          ctx.save();
          // Factor in the choose-hero UI fade (this method sets its own
          // globalAlpha, overwriting the outer fade applied in render()).
          ctx.globalAlpha = 0.92 * this._uiFadeAlpha;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            panelImg,
            Math.floor(pr.x), Math.floor(pr.y),
            Math.ceil(pr.w), Math.ceil(pr.h)
          );
          ctx.restore();
        }
      }
    }
  }

  /**
   * Draw an image in "cover" mode within the given rect, preserving aspect ratio
   * and cropping excess. Applies globalAlpha for cross-fading.
   */
  _drawCoverImage(ctx, img, rect, alpha = 1.0) {
    if (!img || img.width <= 0 || img.height <= 0) return;

    const scaleX = rect.w / img.width;
    const scaleY = rect.h / img.height;
    const scale = Math.max(scaleX, scaleY);

    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = rect.x + (rect.w - drawW) / 2;
    const drawY = rect.y + (rect.h - drawH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  /**
   * Override render to draw selected-portrait highlight after children render.
   */
  render(ctx) {
    if (!this.visible) return;

    // 1. Draw character splash backgrounds
    this.renderSelf(ctx);

    // During the choose-hero intro the UI fades out, leaving only the
    // full-canvas video (drawn in renderBackground). Once fully faded, skip the
    // UI entirely. The fade is applied as an outer globalAlpha that multiplies
    // through every UI element (none of them overwrite globalAlpha except the
    // info-panel background, which factors _uiFadeAlpha in explicitly).
    const uiAlpha = this._uiFadeAlpha;
    if (uiAlpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = uiAlpha;

    // 2. Draw animated aura strands (over splash, under all UI)
    this._auraEffect.render(ctx, this.rect);

    // 3. Info panel contents now float directly on the splash (no containing
    //    panel background) — _drawInfoPanelBackground is intentionally not called.

    // 4. Draw children (info panel contents, heroes row, button)
    this.renderChildren(ctx);

    // ── Selected portrait highlight ────────────────────
    if (this._selectedIndex >= 0 && this._selectedIndex < this._portraitImages.length) {
      const portrait = this._portraitImages[this._selectedIndex];
      const pr = portrait.rect;
      const HL = UI.highlight;
      const margin = HL.margin;

      ctx.save();
      // Golden highlight border
      ctx.strokeStyle = HL.color;
      ctx.lineWidth = HL.lineWidth;
      ctx.strokeRect(pr.x - margin, pr.y - margin, pr.w + margin * 2, pr.h + margin * 2);
      // Subtle glow
      ctx.strokeStyle = HL.glowColor;
      ctx.lineWidth = HL.glowLineWidth;
      ctx.strokeRect(pr.x - margin - 2, pr.y - margin - 2, pr.w + margin * 2 + 4, pr.h + margin * 2 + 4);
      ctx.restore();
    }

    // ── Tooltips (drawn last so they sit above all UI) ──
    if (this._tooltipManager) {
      this._tooltipManager.render(ctx);
    }

    ctx.restore(); // end the choose-hero UI fade

    if (this.debug) {
      this._drawDebug(ctx);
    }
  }
}
