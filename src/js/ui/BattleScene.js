import UIContainer from './UIContainer.js';
import UIPanel from './UIPanel.js';
import CharacterInfoPane from './CharacterInfoPane.js';
import SkillsPane from './SkillsPane.js';
import RelicBar from './RelicBar.js';
import BattleBoardPanel from './BattleBoardPanel.js';
import CombatLogPanel from './CombatLogPanel.js';
import BoardPlaceholder from './BoardPlaceholder.js';
import UIText from './UIText.js';
import FloatingImageEffect from './FloatingImageEffect.js';
import FloatingTextEffect from './FloatingTextEffect.js';
import DamageCounterEffect from './DamageCounterEffect.js';
import ManaStreamEffect from './ManaStreamEffect.js';
import TileParticleEffect from './TileParticleEffect.js';
import HarvestTendrilEffect from './HarvestTendrilEffect.js';
import BloodSplashEffect from './BloodSplashEffect.js';
import SpriteSheetAnimation from './SpriteSheetAnimation.js';
import ScreenShake from './ScreenShake.js';
import RewardOverlay from './RewardOverlay.js';
import LevelUpOverlay from './LevelUpOverlay.js';
import SkillLoadoutOverlay from './SkillLoadoutOverlay.js';
import TooltipManager from '../systems/TooltipManager.js';
import { BattleState } from '../game/BattleController.js';
import { getTileType, isMana } from '../game/TileTypes.js';
import { syncBattleResultsToRunState, applyRunModifier, getEffectivePlayerStats, MAX_EQUIPPED_SKILLS } from '../data/playerStats.js';
import { getCharacterById } from '../data/characters/index.js';
import Metrics from '../engine/Metrics.js';
import { generateRelicRewardOptions } from '../data/relics/relicRewards.js';
import { ENABLE_PERSISTENT_BATTLE_MUSIC, DEFAULT_BATTLE_MUSIC_KEY } from '../audio/BattleMusicConfig.js';

// ── Character attack animations (PROOF OF CONCEPT) ───────
// A sprite-sheet flash played ONCE over the PLAYER portrait when the player
// matches skulls — ONE ENTRY PER CHARACTER, keyed by `cd.portrait` (warrior,
// mage, …). Each character has its OWN sheet + placement (scale/offset/fps).
// Self-contained and easy to disable/remove: per-entry `enabled` flag (or flip
// ATTACK_ANIM_DEBUG off), then de-register the sheets in main.js + delete
// SpriteSheetAnimation.js when done. Tunables: scale = box height vs portrait
// height (width follows the art's aspect, no squish); offset nudges from the
// portrait center; fps = speed.
//
// ATTACK_ANIM_DEBUG enables a LIVE TUNER (in battle, no skull match needed) that
// targets WHICHEVER character the player is — it tunes that character's entry:
//   J            summon/replay the animation, looping & held so it stays visible
//   P            pause / resume (pause to inspect a single frame)
//   ← ↑ → ↓      nudge offset (hold Shift = bigger step)
//   [  /  ]      shrink / grow scale (hold Shift = bigger step)
//   -  /  =      fewer / more tail fade-out frames (cross-fade into the portrait)
//   ,  /  .      step to previous / next frame (auto-pauses)
//   C            log the current scale/offset/fadeOutFrames to the console (copy into the entry)
// A small HUD shows the live numbers. Tuned values persist across J replays AND
// feed the real skull-match trigger, so what you dial in is what you get.
const ATTACK_ANIM_DEBUG = false; // live tuner for the player's character; false = plain one-shot
const ATTACK_ANIMATIONS = Object.freeze({
  warrior: {
    enabled: false, // disabled — sheets unregistered in main.js SPRITESHEET_MAP
    sheetKey: 'ui_spritesheet_warrior_attack_animation',
    jsonPath: 'assets/sprites/battle/character_pane/ui_spritesheet_warrior_attack_animation.json',
    scale: 1.48,
    offset: { x: 225, y: -55 },
    fps: 60,
    alpha: 1,
    fadeOutFrames: 0, // last N frames cross-fade opacity 1→0 into the portrait (0 = off)
  },
  mage: {
    enabled: false, // disabled — sheets unregistered in main.js SPRITESHEET_MAP
    sheetKey: 'ui_spritesheet_mage_attack_animation',
    jsonPath: 'assets/sprites/battle/character_pane/ui_spritesheet_mage_attack_animation.json',
    scale: 1.48,
    offset: { x: 225, y: -55 },
    fps: 60,
    alpha: 1,
    fadeOutFrames: 0, // last N frames cross-fade opacity 1→0 into the portrait (0 = off)
  },
  witch_doctor: {
    enabled: false, // disabled — sheets unregistered in main.js SPRITESHEET_MAP
    sheetKey: 'ui_spritesheet_witch_doctor_attack_animation',
    jsonPath: 'assets/sprites/battle/character_pane/ui_spritesheet_witch_doctor_attack_animation.json',
    scale: 1.48,
    offset: { x: 225, y: -55 },
    fps: 60,
    alpha: 1,
    fadeOutFrames: 0, // last N frames cross-fade opacity 1→0 into the portrait (0 = off)
  },
});

// ── Post-victory growth ──────────────────────────────────
// STAT PICKING IS DISABLED (decision #36 update, 2026-06-23). Growth is now
// AUTO-applied per character from its `growthPlan` (data/characters/*) so BOTH
// an HP axis AND an offense axis grow every win — removing the dominant "dump
// everything into Max HP" pick (see docs/balance-dominant-strategy-analysis.md).
// _applyGrowthPlan reads the char def's growthPlan; DEFAULT_GROWTH_PLAN is the
// fallback. The LevelUpOverlay + LEVEL_UP_* tables below are kept (dormant) but
// NO LONGER SHOWN — re-enable by calling _showLevelUpOverlay() on victory again.
const DEFAULT_GROWTH_PLAN = Object.freeze({ maxHp: 4, startingAttack: 1 });
const LEVEL_UP_GROWTH = Object.freeze({ attack: 1, magic: 1, maxHp: 8 });
// attribute key → runState statModifier path (applyRunModifier).
const LEVEL_UP_STAT_PATH = Object.freeze({
  attack: 'startingAttack', magic: 'startingMagic', maxHp: 'maxHp',
});
// attribute key → display name, reused stat icon, and glow color (matches the mock).
const LEVEL_UP_CARDS = Object.freeze([
  { key: 'attack', name: 'Attack', iconKey: 'icon_attack', glowColor: '#ffb060' },
  { key: 'magic', name: 'Magic', iconKey: 'icon_magic', glowColor: '#c77dff' },
  { key: 'maxHp', name: 'Max HP', iconKey: 'character_select_heart', glowColor: '#ff5b5b' },
]);

// ── Legacy auto-growth constants (no longer applied — see _applyVictoryGrowth) ──
const HP_GROWTH_PER_VICTORY = 4;
const ATTACK_GROWTH_AMOUNT = 1;
const ATTACK_GROWTH_EVERY_N_VICTORIES = 2;

// ── Damage-counter turn gating ───────────────────────────
// When true, the accumulating combat-damage counter only shows for damage
// DEALT BY the side whose turn it is (the active side's OUTGOING damage).
// Damage the active side RECEIVES on its own turn — e.g. Reflect/thorns hitting
// the attacker back, or Bleed/Poison ticks — gets no counter. So on the enemy's
// turn, only the enemy's hit on the player shows a counter; the reflected hit
// back at the enemy is suppressed. Set false to restore the old behavior where
// every damage instance (both sides) spawns its own counter.
const ONLY_SHOW_ACTIVE_TURN_DAMAGE = true;

// ── Tunable layout constants ─────────────────────────────
// Vertical lift of the accumulating damage counter above the receiver's health
// bar (px above the bar's top edge — the block hovers over the bar).
const DAMAGE_COUNTER_BAR_LIFT = 60;
// ── Wide battle viewport (see CanvasApp.setSceneDesignWidth) ──
// The battle scene requests a FIXED design width slightly wider than the base
// 1920; the extra (BATTLE_DESIGN_WIDTH − 1920) is split between the two side
// (character) columns by layoutChildren() — +80px per panel at 2080. Design
// height stays 1080. On screens at least as wide as BATTLE_DESIGN_WIDTH:1080
// (~1.93:1) the width comes out of the pillarbox bars at full size; on
// narrower screens (e.g. exact 16:9) the whole game scales down slightly
// (letterboxed, vertically centered) so the width still fits — at 2080 that's
// a ~8% smaller board on 16:9. THE knob for panel width: raise for wider
// panels (costs more board shrink on 16:9), lower toward 1920 for less.
const BASE_DESIGN_WIDTH = 1920;
const BATTLE_DESIGN_WIDTH = 2080;
const MAIN_ROW_MAX_WIDTH = 1920;
// Horizontal gap between the side columns and the central board panel.
// The board art's visible rails sit ~38px INSIDE its square (transparent
// margin that gives the gem crests headroom), so the side panels overlap the
// board rect by 32px — landing in that transparent margin and leaving ~6px of
// visible daylight between the panel edge and the board rail. The character
// panel art itself is tightly cropped, so don't exceed the board margin.
// Row budget at the 2080 viewport: 2×90 relic + 2×440 side + 1080 center
// + 4×(-32) = 2012 → centered with ~34px slack each side.
const MAIN_ROW_GAP = -32;
// Vertical padding around the main row. Zero: the board frame square gets the
// full 1080 design height (the frame's crest tips sit flush with the viewport
// edges — they have transparent headroom baked into the art).
const MAIN_ROW_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

// ── Background readability scrim ──────────────────────────
// A full-canvas darkening drawn over the battle background (in
// renderBackground, so it sits BEHIND the UI but covers the letterbox bars).
// Two DARK PLATEAUS sit behind the floating relic bars (so relic icons stay
// legible), a LIGHTER band covers the central play area, and both plateaus
// fall off HARD to transparent toward the screen edges so the decorative side
// art shows through. Left→right the alpha profile is:
//   edge (clear) →[hard]→ relic band (RELIC_ALPHA) → play area (PLAY_ALPHA)
//     → relic band (RELIC_ALPHA) →[hard]→ edge (clear)
// Because the relics get their own darker, harder backdrop, PLAY_ALPHA can be
// low (lighter overall) without losing relic visibility. All tunable.
const SCRIM_PLAY_ALPHA = 0.32;    // central play area (board) — kept light
const SCRIM_RELIC_ALPHA = 0.62;   // behind the relic bars — darker, "harder"
const SCRIM_EDGE_SHOULDER = 55;   // design px: fade width from relic band → edge
const SCRIM_COLOR = '0, 0, 0';    // rgb triplet; alpha applied per stop

// Width of each side (player/enemy) column. Reduce to bring the
// visible panel art closer to the board frame; the side panel
// images include some transparent inner margin so the column rect
// is typically larger than the visible art.
const SIDE_COL_WIDTH = 360; // +80 from the wide viewport → 440 effective
const SIDE_COL_MIN_WIDTH = 360;
const SIDE_COL_MAX_WIDTH = 360;
const SIDE_COL_GAP = 3;
// Pushes both character columns (info pane + skills pane) down from the top of
// the battle row — THE knob for the panels' vertical start. (The row itself
// starts at y=0 now — MAIN_ROW_PADDING is zero — so this is the full offset.)
const SIDE_COL_TOP_MARGIN = 40;

// Fixed width for the center (board + combat log) column. Should be
// roughly equal to the available vertical space for the board frame
// (canvas height minus padding minus combat log height) so the
// `BattleBoardPanel` square fills the column with minimal slack on
// either side. If this is larger than the available height, you get
// empty space inside the center column between the board frame and
// the side columns.
const CENTER_COL_WIDTH = 1080; // = the board frame square (full 1080 viewport height), no slack
const CENTER_COL_GAP = 8;
// Height of the combat log strip below the board. Bump this to make
// the log strip taller; reduce to give the board more vertical room.
const COMBAT_LOG_HEIGHT = 80;

// ── Relic column (thin passive vertical column on the left) ──
// Mounted as the first child of MainRow, *before* the player column, so
// it floats to the immediate left of the character panel. Icons stack
// vertically from the top. The column overlaps the player column rect
// by |MAIN_ROW_GAP| pixels (same trick the side panels use against the
// board) so the icons tuck just outside the player panel's visible art.
// Layout-wise this slightly shifts the player/board/enemy block right
// to keep the entire row (relic + 3 panels) centered.
const RELIC_COL_WIDTH = 90;

// ── Enemy relic column (mirror of the player bar, on the RIGHT) ──
// Mounted as the LAST child of MainRow, *after* the enemy column, so it
// floats to the immediate right of the enemy panel (the MainRow negative gap
// pulls this rect left into the enemy column). The horizontal icon hug + the
// backdrop gradient are now handled INSIDE RelicBar via setGradientDarkSide
// (which anchors the icon column to the panel-side edge — see RelicBar
// ICON_INSET_FROM_PANEL), so no per-side padding hack is needed here.
const ENEMY_RELIC_COL_WIDTH = 90;

// ── Corner action buttons (skip / map) ───────────────────
// Two 60×60 icons stacked vertically in the FAR top-right corner of the
// physical canvas (not bound by the design viewport / inner container).
// Drawn in renderForeground (after the viewport clip) so they can sit out
// in the pillarbox bar, and hit-tested in design-space coords.
const CORNER_BUTTON_SIZE = 60;     // icon width/height
const CORNER_BUTTON_GAP = 8;       // vertical gap between the two icons
const CORNER_BUTTON_MARGIN = 12;   // inset from the physical top-right corner

// ── Hint button + highlight (BattleController.getSuggestedMove) ──
const HINT_BUTTON_SIZE = 44;       // the small "?" button under the map button
const HINT_DURATION_MS = 3000;     // how long the suggested-swap highlight shows
const HINT_FADE_MS = 400;          // fade-out tail at the end of the highlight
const HINT_PULSE_HZ = 1.4;         // highlight pulse speed
const HINT_COLOR = '255, 214, 110'; // gold RGB for the hint outline/arrow

// Targeting Confirm/Cancel controls — shown only during TARGETING, anchored
// below the board. The button art comes from the character-pane spritesheet
// (`ui_skill_confirm` / `ui_skill_cancel`); width is derived from the art's
// aspect at render time so it never distorts. Drawn in design space (render())
// and hit-tested in design-space coords.
const TARGET_CONFIRM_SPRITE = 'ui_skill_confirm';
const TARGET_CANCEL_SPRITE = 'ui_skill_cancel';
const TARGET_BTN_H = 92;           // display height of the button art (px)
const TARGET_BTN_GAP = 56;         // horizontal gap between Cancel and Confirm
const TARGET_BTN_CENTER_Y = 966;   // fallback vertical center of the row (design px)
const TARGET_BTN_FALLBACK_ASPECT = 1175 / 330; // if the art isn't loaded yet
const TARGET_BTN_HOVER_SCALE = 1.05; // subtle grow on hover
const TARGET_BTN_ALPHA = 0.86;       // overall button opacity (art + label)
const TARGET_BTN_HOVER_ALPHA = 1;    // opacity when hovered (full = pops on hover)
// Centered button label.
const TARGET_BTN_LABEL_SIZE = 34;
const TARGET_BTN_LABEL_COLOR = '#fff8e8';
const TARGET_BTN_LABEL_Y_NUDGE = 0; // px vertical offset for the label center
// "Casting <skill>" prompt at the top of the screen during targeting — drawn on
// the `ui_skill_nameplate` banner with the text centered inside it.
const TARGET_NAMEPLATE_SPRITE = 'ui_skill_nameplate';
const TARGET_NAMEPLATE_W = 720;      // display width of the nameplate (design px)
const TARGET_NAMEPLATE_FALLBACK_ASPECT = 1300 / 149; // if the art isn't loaded yet
const TARGET_PROMPT_Y = 58;          // nameplate + text vertical center (design px)
const TARGET_PROMPT_FONT_SIZE = 38;
const TARGET_PROMPT_COLOR = '#f0e4bf';
const TARGET_PROMPT_TEXT_Y_NUDGE = 0;     // text vertical offset within the plate
const TARGET_PROMPT_MAX_WIDTH_FRAC = 0.72; // text shrinks to fit this fraction of the plate width

/**
 * BattleScene — battle layout with three compact columns.
 *
 * Structure:
 *   BattleScene (column, UIPanel with battle_background_default)
 *     MainRow (row, flexGrow=1, maxWidth=MAIN_ROW_MAX_WIDTH)
 *       RelicBar      (thin vertical column of player relic icons, no bg)
 *       PlayerColumn  (column, fixed-narrow)
 *         CharacterInfoPane (compact portrait + stats + mana)
 *         SkillsPane        (fixed-size accordion list; locked fillers)
 *       CenterColumn  (column, flexGrow=1)
 *         TurnLabel (hidden — preserved for state/data binding only)
 *         BattleBoardPanel  (background asset + BoardPlaceholder child)
 *         CombatLogPanel
 *       EnemyColumn   (mirror of PlayerColumn)
 *
 * BattleScene accepts a BattleController reference and updates character
 * info panes, skill affordability, and the combat log from real game state.
 * The old top-of-board turn-status text element is retained (and still
 * updated) but hidden — its logic is preserved so it can later be routed
 * into CombatLogPanel.
 */
export default class BattleScene extends UIPanel {
  /**
   * @param {object} playerData  - mock player data
   * @param {object} enemyData   - mock enemy data
   * @param {object} assetManager - AssetManager instance
   * @param {import('../game/BattleController.js').default} [battleController]
   */
  constructor(playerData = null, enemyData = null, assetManager = null, battleController = null) {
    super();
    this.direction = 'column';
    this.alignItems = 'center';
    this.gap = 0;
    this.padding = 0;

    // Request the WIDE battle viewport (SceneManager → CanvasApp
    // setSceneDesignWidth): a fixed design width slightly beyond 1920. Wide
    // screens absorb it from the pillarbox bars at full size; narrower screens
    // scale the whole game down a touch (letterboxed) so the width still fits.
    // The extra width is fed to the two side columns in layoutChildren().
    this.preferredDesignWidth = BATTLE_DESIGN_WIDTH;

    this._playerData = playerData;
    this._enemyData = enemyData;
    this._assetManager = assetManager;

    // Background is drawn at the CanvasApp level (cover-fit across the
    // entire physical canvas, eliminating letterbox/pillarbox bars).
    // The UIPanel's own backgroundAssetKey is intentionally left null
    // so we don't double-render the bg over the design rect.
    this.assetManager = assetManager;
    this.backgroundAssetKey = null;
    this.smoothing = true;

    /** @type {import('../game/BattleController.js').default|null} */
    this._battleController = battleController;

    /** @type {import('../audio/AudioManager.js').default|null} */
    this._audioManager = null;

    /** @type {import('../scenes/SceneManager.js').default|null} */
    this._sceneManager = null;

    /**
     * Track previous battle state so we only trigger music on transitions,
     * not every frame.
     * @type {string|null}
     */
    this._previousBattleState = null;

    /**
     * Suppress the very first "player turn" SFX that fires when the battle
     * boots (the TURN_INTRO for the first player turn is automatic, not
     * something the player should hear as a "new turn" announcement).
     * @type {boolean}
     */
    this._suppressFirstTurnSfx = true;

    // Last pointer position (design space) — used for design-space button hover.
    this._lastPointerX = -1;
    this._lastPointerY = -1;

    // Child references
    this._playerPane = null;
    this._enemyPane = null;
    this._playerSkillsPane = null;
    this._enemySkillsPane = null;
    /** @type {RelicBar|null} */
    this._relicBar = null;
    /** @type {RelicBar|null} enemy relic bar (mirror, on the right) */
    this._enemyRelicBar = null;
    this._board = null;
    this._boardPanel = null;
    /** Retained for backwards-compat: the old visible turn label is hidden
     *  in the new layout but the text element + data binding are preserved
     *  so the underlying logic still works and the message can later be
     *  surfaced in CombatLogPanel. */
    this._turnLabel = null;
    this._combatLogPanel = null;
    this._combatLogText = null;

    // ── Floating image effects ──
    /** @type {FloatingImageEffect[]} */
    this._floatingEffects = [];

    // ── Character attack animation (POC) — one-shot sheet flash over the player
    // portrait on skull match (per-character; see ATTACK_ANIMATIONS). Updated/
    // rendered alongside floating effects. Live-tuned values persist in
    // _attackAnimTuning (keyed by portrait). ──
    /** @type {SpriteSheetAnimation|null} */
    this._attackAnim = null;
    /** @type {Object<string,{scale:number,offset:{x:number,y:number}}>|null} */
    this._attackAnimTuning = null;

    // ── Accumulating damage counters (one per side, over the portrait) ──
    // Each is a DamageCounterEffect that accumulates all damage to that side
    // during a sequence, then finalizes (grows once, fades). Also kept in
    // _floatingEffects for update/render/removal; the refs let us add to the
    // live counter. Recreated lazily when a finalized/done counter is reused.
    /** @type {{player: DamageCounterEffect|null, enemy: DamageCounterEffect|null}} */
    this._damageCounters = { player: null, enemy: null };

    // ── Tile destruction particle effects ──
    /** @type {TileParticleEffect[]} */
    this._particleEffects = [];

    // ── Screen shake ──
    /** @type {ScreenShake} */
    this._screenShake = new ScreenShake();

    /**
     * Hint highlight state (the "?" corner button → BattleController.
     * getSuggestedMove). `_hintCells` = the two cells of the suggested swap;
     * the highlight pulses for HINT_DURATION_MS and clears early the moment
     * the player acts (state leaves PLAYER_TURN).
     * @type {Array<{col:number,row:number}>|null}
     */
    this._hintCells = null;
    /** Remaining highlight time (ms); 0 = no hint showing. */
    this._hintTimeLeft = 0;
    /** Elapsed highlight time (ms) — drives the pulse. */
    this._hintTime = 0;
    /**
     * The advisor's best move for the CURRENT player turn, computed at most
     * once per turn and shared by the "?" button and the idle hint glint.
     * `undefined` = not yet computed; `null` = computed, no move available.
     * Invalidated whenever the state leaves PLAYER_TURN, on skill casts, and
     * on loadout changes (see _invalidateSuggestedMove call sites).
     */
    this._suggestedMove = undefined;
    /** Alternates which of the suggested swap's two cells the idle glint shows. */
    this._hintGlintFlip = false;

    /** Delay after game over before showing reward overlay (ms) */
    this._gameOverDelay = 400;
    /** Timer tracking elapsed time in game over state */
    this._gameOverTimer = 0;
    /** Whether the reward overlay has been shown after game over */
    this._rewardOverlayShown = false;

    /**
     * Callback invoked when the battle ends. Set by MapScene before
     * entering battle so BattleScene does not need map internals.
     * Signature: (result: { result: string, nodeId: string }) => void
     * @type {Function|null}
     */
    this._onBattleComplete = null;

    // ── Map overlay (toggled with 'm' key, animated via MapView) ──
    /** @type {import('../map/MapView.js').default|null} shared MapView borrowed from MapScene */
    this._mapView = null;

    // ── Reward overlay (post-battle reward screen) ──
    /** @type {RewardOverlay|null} */
    this._rewardOverlay = null;

    // ── Level Up overlay (post-battle attribute pick — shows BEFORE rewards) ──
    /** @type {LevelUpOverlay|null} */
    this._levelUpOverlay = null;

    // ── Tooltip manager (hover / touch-hold tooltips on UI elements) ──
    /** @type {TooltipManager|null} */
    this._tooltipManager = null;

    // ── Board drag/swap input state ──
    /** @type {{col:number, row:number}|null} */
    this._selectedCell = null;
    /** @type {{col:number, row:number}|null} */
    this._hoveredCell = null;
    /** @type {{col:number, row:number}|null} */
    this._dragStartCell = null;

    // ── Bound input handlers (for cleanup) ──
    this._onMouseDown = null;
    this._onMouseMove = null;
    this._onMouseUp = null;
    this._onContextMenu = null;
    this._onKeyDown = null;

    if (playerData || enemyData) {
      this.buildHierarchy();
    }
  }

  /** Set or update battle controller reference */
  setBattleController(controller) {
    this._battleController = controller;
    if (controller && this._board) {
      this._board.setBoardModel(controller.board);
    }
  }

  buildHierarchy() {
    // ── Main row: relic column + three centered character columns ──
    const mainRow = new UIContainer();
    mainRow.direction = 'row';
    mainRow.gap = MAIN_ROW_GAP;
    mainRow.alignItems = 'stretch';
    mainRow.justifyContent = 'center';
    mainRow.flexGrow = 1;
    mainRow.maxWidth = MAIN_ROW_MAX_WIDTH;
    mainRow.padding = MAIN_ROW_PADDING;
    this._mainRow = mainRow;

    // ── LEFT-MOST: passive relic column (floats next to player panel) ──
    // No background or border; icons just float over the battle background.
    // The MainRow's negative gap pulls this rect ~30px into the player col,
    // which keeps the icons hugging the player panel's transparent margin.
    this._relicBar = new RelicBar(this._assetManager);
    this._relicBar.setStyle({ width: RELIC_COL_WIDTH });
    // Backdrop gradient darkest toward the player panel (on the bar's right).
    this._relicBar.setGradientDarkSide('right');
    mainRow.addChild(this._relicBar);

    // ── LEFT: compact stacked player column ───────────
    const playerCol = this._buildSideColumn('player');
    this._playerCol = playerCol;
    mainRow.addChild(playerCol);

    // ── CENTER: hidden turn label + board panel + combat log ──
    // Fixed width (no flexGrow) so the side columns cluster snug
    // against the board frame thanks to mainRow.justifyContent='center'.
    const centerCol = new UIContainer();
    centerCol.direction = 'column';
    centerCol.gap = CENTER_COL_GAP;
    centerCol.width = CENTER_COL_WIDTH;
    centerCol.alignItems = 'stretch';

    // Turn label — KEPT for state/data binding compatibility but
    // hidden from the visible layout. Its text is still updated by
    // updateFromController() so future logic can route it elsewhere
    // (e.g. into CombatLogPanel) without re-introducing scaffolding.
    this._turnLabel = new UIText('Player Turn');
    this._turnLabel.setStyle({
      fontSize: 18,
      color: '#e0d070',
      bold: true,
      alignH: 'center',
      alignV: 'center',
      height: 0,
      visible: false,
    });
    centerCol.addChild(this._turnLabel);

    // Board panel — wraps the existing BoardPlaceholder.
    this._boardPanel = new BattleBoardPanel(this._assetManager);
    this._boardPanel.flexGrow = 1;

    const boardModel = this._battleController ? this._battleController.board : null;
    this._board = new BoardPlaceholder(this._assetManager, boardModel);
    this._board.setStyle({
      flexGrow: 1,
      minWidth: 280,
      minHeight: 280,
    });
    // Idle "sleeping glint" → HINT nudge: after a pause on the player's turn,
    // the board glints ONE tile of the advisor's suggested swap instead of
    // random tiles (alternating between the swap's two cells across bursts —
    // a nudge, not a full giveaway). Returns null outside PLAYER_TURN, which
    // suppresses glinting entirely on other turns/states. The advisor result
    // is cached per turn (_getSuggestedMoveCached), so the cost is paid once.
    this._board.setIdleGlintProvider(() => {
      const best = this._getSuggestedMoveCached();
      if (!best || !best.swap) return null;
      this._hintGlintFlip = !this._hintGlintFlip;
      return this._hintGlintFlip
        ? { col: best.swap.col1, row: best.swap.row1 }
        : { col: best.swap.col2, row: best.swap.row2 };
    });
    this._boardPanel.addChild(this._board);
    centerCol.addChild(this._boardPanel);

    // Combat log panel
    this._combatLogPanel = new CombatLogPanel(this._assetManager);
    this._combatLogPanel.setStyle({ height: COMBAT_LOG_HEIGHT, margin: { right: 40, left: 40 } });
    this._combatLogText = this._combatLogPanel.textElement;
    // centerCol.addChild(this._combatLogPanel);

    mainRow.addChild(centerCol);

    // ── RIGHT: compact stacked enemy column ───────────
    const enemyCol = this._buildSideColumn('enemy');
    this._enemyCol = enemyCol;
    mainRow.addChild(enemyCol);

    // ── RIGHT-MOST: passive enemy relic column (mirror of player bar) ──
    // Floats to the immediate right of the enemy panel; icons hug leftward
    // toward the panel via the mirrored LEFT padding.
    this._enemyRelicBar = new RelicBar(this._assetManager);
    this._enemyRelicBar.setStyle({ width: ENEMY_RELIC_COL_WIDTH });
    // Mirror: icons hug + gradient darkens toward the enemy panel (bar's left).
    this._enemyRelicBar.setGradientDarkSide('left');
    mainRow.addChild(this._enemyRelicBar);

    this.addChild(mainRow);
  }

  /**
   * Feed the wide-viewport EXTRA design width (scene width beyond the base
   * 1920 — see preferredDesignWidth / CanvasApp.setSceneDesignWidth) to the
   * two side character columns before the normal flex layout runs. The center
   * (board) column is fixed-width and the design height never changes, so the
   * board keeps its size in design units — the panels absorb all the gain.
   */
  layoutChildren() {
    const extra = Math.max(0, (this.rect.w || 0) - BASE_DESIGN_WIDTH);
    const sideW = SIDE_COL_WIDTH + Math.floor(extra / 2);
    if (this._mainRow) this._mainRow.maxWidth = MAIN_ROW_MAX_WIDTH + extra;
    for (const col of [this._playerCol, this._enemyCol]) {
      if (!col) continue;
      col.width = sideW;
      col.minWidth = sideW;
      col.maxWidth = sideW;
    }
    super.layoutChildren();
  }

  /**
   * Build a compact stacked side column (character info + skills).
   * Relics are no longer rendered per-side — see the top-of-screen RelicBar.
   * @param {'player'|'enemy'} side
   * @returns {UIContainer}
   */
  _buildSideColumn(side) {
    const col = new UIContainer();
    col.direction = 'column';
    col.gap = SIDE_COL_GAP;
    col.alignItems = 'stretch';
    col.width = SIDE_COL_WIDTH;
    col.minWidth = SIDE_COL_MIN_WIDTH;
    col.maxWidth = SIDE_COL_MAX_WIDTH;
    col.margin = { top: SIDE_COL_TOP_MARGIN };

    const isPlayer = side === 'player';
    const data    = isPlayer ? this._playerData : this._enemyData;
    const skills  = (data && data.skills) || [];

    // 1) Compact character info pane (portrait + stats + mana)
    const infoPane = new CharacterInfoPane(data, this._assetManager, side);
    if (isPlayer) this._playerPane = infoPane; else this._enemyPane = infoPane;
    col.addChild(infoPane);

    // 2) Skills pane (fixed-size list of auto-height skill cards; remaining
    //    slots = locked placeholders). Full descriptions render on the cards.
    const skillsPane = new SkillsPane(skills, this._assetManager);
    if (isPlayer) this._playerSkillsPane = skillsPane;
    else          this._enemySkillsPane  = skillsPane;
    skillsPane.flexGrow = 0;
    col.addChild(skillsPane);

    return col;
  }

  // ── Scene lifecycle ──────────────────────────────────

  /**
   * Called by SceneManager when this scene becomes active.
   * Wires all battle-specific input handlers.
   */
  onEnter() {
    const input = this._sceneManager._input;
    if (!input) return;

    // Pre-warm the player character's attack animation (JSON + sheet decode/GPU
    // upload) so its FIRST play in combat doesn't hitch — paid here during the
    // scene fade-in instead of mid-fight. POC. See ATTACK_ANIMATIONS.
    this._preloadAttackAnim();

    // ── Full-canvas background (covers letterbox/pillarbox bars) ──
    // Data-driven: enemy defs may specify a `background` asset key (passed
    // through userData by MapScene); fall back to the default battle backdrop.
    const bgKey = (this.userData && this.userData.background) || 'battle_background_default';
    const bgImg = this._assetManager
      ? this._assetManager.get(bgKey)
      : null;
    if (this._sceneManager._app && this._sceneManager._app.setBackgroundImage) {
      this._sceneManager._app.setBackgroundImage(bgImg);
    }

    // Reset drag/swap state
    this._selectedCell = null;
    this._hoveredCell = null;
    this._dragStartCell = null;

    // Hold the turn from passing until a just-dealt damage counter has flown to
    // and impacted the target portrait (see DamageCounterEffect / decision #41).
    if (this._battleController && this._battleController.setTurnGate) {
      this._battleController.setTurnGate(() => this._hasPendingDamageDelivery());
    }

    // ── Borrow MapView from MapScene for 'm' overlay ──
    // Ensure overlay starts closed (MapView.resetOverlay was already
    // called by the previous onExit or initial construction).
    const mapScene = this._sceneManager._scenes['MapScene'];
    if (mapScene && mapScene._mapView) {
      this._mapView = mapScene._mapView;
    } else {
      this._mapView = null;
    }

    // ── Reward overlay (post-battle reward screen) ──
    // Created once per battle scene instance; reset on each entry.
    if (!this._rewardOverlay) {
      const assetManager = this._assetManager;
      this._rewardOverlay = new RewardOverlay({
        assetManager,
        onDismiss: () => this._returnToMap(),
        onRelicSelected: (relicDef, index) => this._grantRelicReward(relicDef, index),
      });
    }
    this._rewardOverlay.reset();
    this._rewardOverlayShown = false;

    // ── Level Up overlay (shows BEFORE the reward overlay on victory) ──
    // Picking an attribute applies the growth, then onDismiss opens rewards.
    if (!this._levelUpOverlay) {
      this._levelUpOverlay = new LevelUpOverlay({
        assetManager: this._assetManager,
        onAttributeSelected: (key) => this._applyLevelUp(key),
        onDismiss: () => this._showRewardOverlay(),
      });
    }
    this._levelUpOverlay.reset();

    // ── Tooltip manager (created on first entry; cleared on each entry) ──
    if (!this._tooltipManager) {
      this._tooltipManager = new TooltipManager({
        input,
        app: this._sceneManager._app,
        assetManager: this._assetManager,
      });
    }
    this._tooltipManager.clear();
    this._tooltipManager.setEnabled(true);
    if (this._relicBar) {
      this._relicBar.setTooltipManager(this._tooltipManager);
    }
    if (this._enemyRelicBar) {
      this._enemyRelicBar.setTooltipManager(this._tooltipManager);
    }
    // Full-skill tooltips on each skill button's "?" badge.
    this._registerSkillTooltips();

    // Create bound handlers (stored for cleanup in onExit)
    this._onMouseDown = (x, y) => this._handleMouseDown(x, y);
    this._onMouseMove = (x, y) => this._handleMouseMove(x, y);
    this._onMouseUp   = (x, y) => this._handleMouseUp(x, y);
    this._onWheel     = (x, y, dy) => this._handleWheel(x, y, dy);
    this._onContextMenu = (e) => this._handleContextMenu(e);
    this._onKeyDown     = (e) => this._handleKeyDown(e);

    input.on('mousedown', this._onMouseDown);
    input.on('mousemove', this._onMouseMove);
    input.on('mouseup',   this._onMouseUp);
    input.on('wheel',     this._onWheel);

    input.canvas.addEventListener('contextmenu', this._onContextMenu);
    input.canvas.addEventListener('keydown', this._onKeyDown);
    input.canvas.setAttribute('tabindex', '0');
    input.canvas.style.outline = 'none';
    input.canvas.focus();

    // Wire skill click callbacks on the new SkillsPane
    if (this._playerSkillsPane && this._battleController) {
      this._playerSkillsPane.onSkillClick = (skill) => {
        // A cast changes mana/board/HP — the cached hint suggestion is stale.
        this._invalidateSuggestedMove();
        this._battleController.tryPlayerSkill(skill);
      };
    }

    // ── Manage Skills / Loadout modal (player pane only) ──
    if (!this._loadoutOverlay) {
      this._loadoutOverlay = new SkillLoadoutOverlay({ assetManager: this._assetManager });
    }
    this._loadoutOverlay.setAssetManager(this._assetManager);
    if (this._playerSkillsPane && this._battleController) {
      this._playerSkillsPane.onManageClick = () => this._openLoadout();
      const ps = this._battleController.playerState;
      this._playerSkillsPane.setEquippedInfo(
        (ps.skills || []).length, MAX_EQUIPPED_SKILLS);
    }
  }

  /** Open the Manage Skills / Loadout modal over the battle. */
  _openLoadout() {
    if (!this._loadoutOverlay || !this._battleController) return;
    if (this._loadoutOverlay.isActive()) return;
    const ps = this._battleController.playerState;
    this._loadoutOverlay.show({
      allSkills: ps.allSkills && ps.allSkills.length ? ps.allSkills : (ps.skills || []),
      equippedIds: (ps.skills || []).map((s) => s.id),
      maxEquipped: MAX_EQUIPPED_SKILLS,
      onChange: (ids) => this._applyLoadout(ids),
      // Live `<<n>>` dynamic damage values in the modal's cards.
      caster: { attack: ps.attack, magic: ps.magic },
    });
  }

  /**
   * Apply a loadout change LIVE: the battle state's usable skills, the
   * persistent runState.equippedSkillIds, the battle Skills panel, and the
   * keyword tooltip sources all update immediately.
   * @param {string[]} ids — equipped skill ids, in order
   */
  _applyLoadout(ids) {
    if (!this._battleController) return;
    // Equipped skills feed the advisor's mana-need/denial scoring — the
    // cached hint suggestion is stale.
    this._invalidateSuggestedMove();
    const ps = this._battleController.playerState;
    const pool = ps.allSkills && ps.allSkills.length ? ps.allSkills : (ps.skills || []);
    const byId = new Map(pool.map((s) => [s.id, s]));
    ps.skills = ids.map((id) => byId.get(id)).filter(Boolean);

    const runState = this.userData ? this.userData.runState : null;
    if (runState) runState.equippedSkillIds = ids.slice();

    if (this._playerSkillsPane) {
      this._playerSkillsPane.setSkills(ps.skills);
      this._playerSkillsPane.setEquippedInfo(ps.skills.length, MAX_EQUIPPED_SKILLS);
    }
    this._registerSkillTooltips();
  }

  /**
   * Called by SceneManager when this scene is about to be left.
   * Removes all battle input handlers.
   */
  onExit() {
    // ── Clear the full-canvas background hook so other scenes get
    //    the default black-bar behavior back.
    if (this._sceneManager && this._sceneManager._app && this._sceneManager._app.setBackgroundImage) {
      this._sceneManager._app.setBackgroundImage(null);
    }

    // Force-close the map overlay if it was open/animating
    if (this._mapView) {
      this._mapView.resetOverlay();
    }

    // Reset post-battle overlays (ensure clean state on next entry)
    if (this._levelUpOverlay) {
      this._levelUpOverlay.reset();
    }
    if (this._rewardOverlay) {
      this._rewardOverlay.reset();
    }

    // Close the loadout modal if it was open.
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.dismiss();
    }

    // Clear any tooltip attachments so they don't carry over to the next
    // battle (icons get re-created and old references would be stale).
    if (this._tooltipManager) {
      this._tooltipManager.clear();
    }

    // Release any live video portraits (e.g. Lord Malakor) so the looping
    // <video> elements don't keep decoding after the battle ends.
    if (this._playerPane && this._playerPane.destroy) this._playerPane.destroy();
    if (this._enemyPane && this._enemyPane.destroy) this._enemyPane.destroy();

    // Drop the attack animation POC so it doesn't carry over.
    this._attackAnim = null;

    const input = this._sceneManager._input;
    if (!input) return;

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
    if (this._onWheel) {
      input.off('wheel', this._onWheel);
      this._onWheel = null;
    }
    if (this._onContextMenu) {
      input.canvas.removeEventListener('contextmenu', this._onContextMenu);
      this._onContextMenu = null;
    }
    if (this._onKeyDown) {
      input.canvas.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
  }

  // ── Input helpers ────────────────────────────────────

  /** Allow board input during PLAYER_TURN (swap) or TARGETING (target tile) */
  _canAct() {
    if (!this._battleController) return false;
    return this._battleController.state === BattleState.PLAYER_TURN
        || this._battleController.state === BattleState.TARGETING;
  }

  /** True when the game expects the player to act on the board */
  _isTargeting() {
    if (!this._battleController) return false;
    return this._battleController.state === BattleState.TARGETING;
  }

  /** True when the most recent pointer interaction was touch (vs a real mouse). */
  _isTouchInput() {
    const input = this._sceneManager && this._sceneManager._input;
    return !!(input && input.lastInputWasTouch);
  }

  // ── Input handlers ───────────────────────────────────

  _handleMouseDown(x, y) {
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.handleMouseDown(x, y);
      return;
    }
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) {
      this._levelUpOverlay.handleMouseDown(x, y);
      return;
    }
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      this._rewardOverlay.handleMouseDown(x, y);
      return;
    }
    // Map overlay open: clicking anywhere closes it.
    if (this._mapView && this._mapView.isOverlayActive()) {
      if (this._mapView.getOverlayState() === 'open') {
        this._mapView.closeOverlay();
        if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_close');
      }
      return;
    }

    // Corner action buttons (skip / map) — clickable regardless of turn state.
    if (this._handleCornerButtonClick(x, y)) return;

    // Targeting Confirm/Cancel buttons (touch-friendly) take priority while
    // targeting so a tap on them isn't read as a board reposition.
    if (this._isTargeting() && this._handleTargetingButtonClick(x, y)) return;

    if (this._tooltipManager) this._tooltipManager.onMouseDown(x, y);

    // Relic bar page arrows are clickable regardless of turn state.
    if (this._relicBar && this._relicBar.handlePageClick(x, y)) return;
    if (this._enemyRelicBar && this._enemyRelicBar.handlePageClick(x, y)) return;

    // Skills panel presses (cast-on-release / scroll-drag / scrollbar /
    // Manage button) work regardless of turn state — casting itself routes
    // through onSkillClick → tryPlayerSkill (which validates the turn).
    if (this._playerSkillsPane && this._playerSkillsPane.handleMouseDown(x, y)) return;
    if (this._enemySkillsPane && this._enemySkillsPane.handleMouseDown(x, y)) return;

    const board = this._board;
    if (!board) return;

    if (this._isTargeting()) {
      const cell = board.screenToCell(x, y);
      if (cell) {
        if (this._isTouchInput()) {
          // Touch: a tap POSITIONS the target preview (no hover to preview the
          // area); the on-screen Cast button / Enter commits.
          this._battleController.setTargetHover(cell.col, cell.row);
          board.hoveredCell = cell;
        } else {
          // Desktop: a click casts instantly at the clicked tile.
          this._battleController.tryTargetTile(cell.col, cell.row);
        }
      }
      return;
    }

    if (!this._canAct()) return;
    const cell = board.screenToCell(x, y);
    if (cell) {
      this._selectedCell = cell;
      this._dragStartCell = cell;
      board.selectedCell = cell;
    } else {
      const hit = this.hitTest(x, y);
      if (hit && hit.onClick) {
        hit.onClick();
      }
      this._selectedCell = null;
      this._dragStartCell = null;
      if (board) board.selectedCell = null;
    }
  }

  _handleMouseMove(x, y) {
    // Track the pointer so design-space buttons (targeting Confirm/Cancel) can
    // show a hover state.
    this._lastPointerX = x;
    this._lastPointerY = y;
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.handleMouseMove(x, y);
      return;
    }
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) {
      this._levelUpOverlay.handleMouseMove(x, y);
      return;
    }
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      this._rewardOverlay.handleMouseMove(x, y);
      return;
    }
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._tooltipManager) this._tooltipManager.onMouseMove(x, y);

    // Skills panels: card hover + scroll-drag tracking.
    if (this._playerSkillsPane) this._playerSkillsPane.handleMouseMove(x, y);
    if (this._enemySkillsPane) this._enemySkillsPane.handleMouseMove(x, y);

    const board = this._board;
    if (!board) return;

    if (this._isTargeting()) {
      // Never reposition when the pointer is over the Cancel/Cast buttons. The
      // buttons can overlap the board's lower rows on some layouts, and on touch
      // a tap fires mousemove BEFORE mousedown — without this guard, tapping
      // Cast would first move the target to the cell under the button and then
      // cast there (the "casts in a different area" bug).
      if (!this._pointOverTargetingButton(x, y)) {
        const cell = board.screenToCell(x, y);
        if (cell) {
          // Hover (desktop) / drag (touch) repositions the preview. Moving OFF
          // the board keeps the last target so it isn't wiped before confirm.
          this._battleController.setTargetHover(cell.col, cell.row);
          board.hoveredCell = cell;
        }
      }
      return;
    }

    const cell = this._canAct() ? board.screenToCell(x, y) : null;
    this._hoveredCell = cell;
    board.hoveredCell = cell;
  }

  _handleMouseUp(x, y) {
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.handleMouseUp(x, y);
      return;
    }
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) return;
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._tooltipManager) this._tooltipManager.onMouseUp(x, y);

    // Skills panels: release finishes a click-cast or ends a scroll-drag.
    if (this._playerSkillsPane && this._playerSkillsPane.handleMouseUp(x, y)) return;
    if (this._enemySkillsPane && this._enemySkillsPane.handleMouseUp(x, y)) return;

    const board = this._board;
    if (!board || !this._dragStartCell || !this._canAct() || this._isTargeting()) {
      this._selectedCell = null;
      this._dragStartCell = null;
      if (board) board.selectedCell = null;
      return;
    }

    // ── Direction-based swap ──────────────────────────
    // Use the drag vector (from the start cell's center to the release point)
    // rather than which cell the release point landed in. This is much more
    // forgiving for touch: a finger lifted slightly off the target cell, or
    // released past it, still produces the intended swap. The dominant axis
    // of the drag picks the orthogonal neighbor.
    const metrics = board.getCellMetrics();
    const startCx = metrics.offsetX + (this._dragStartCell.col + 0.5) * metrics.cellSize;
    const startCy = metrics.offsetY + (this._dragStartCell.row + 0.5) * metrics.cellSize;
    const dx = x - startCx;
    const dy = y - startCy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    // Threshold = 1/3 of a tile — enough to reject taps but lenient on swipes.
    const threshold = metrics.cellSize * 0.33;

    if (Math.max(adx, ady) >= threshold) {
      let targetCol = this._dragStartCell.col;
      let targetRow = this._dragStartCell.row;
      if (adx >= ady) {
        targetCol += dx > 0 ? 1 : -1;
      } else {
        targetRow += dy > 0 ? 1 : -1;
      }
      if (targetCol >= 0 && targetCol < board.cols
          && targetRow >= 0 && targetRow < board.rows) {
        this._battleController.tryPlayerSwap(
          this._dragStartCell.col, this._dragStartCell.row,
          targetCol, targetRow
        );
      }
    }

    this._selectedCell = null;
    this._dragStartCell = null;
    if (board) board.selectedCell = null;
  }

  _handleContextMenu(e) {
    e.preventDefault();
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) return;
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._isTargeting()) {
      this._battleController.cancelTargeting();
    }
  }

  /** Wheel routing: loadout modal first, then the two skills panels. */
  _handleWheel(x, y, deltaY) {
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.handleWheel(x, y, deltaY);
      return;
    }
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) return;
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._playerSkillsPane && this._playerSkillsPane.handleWheel(x, y, deltaY)) return;
    if (this._enemySkillsPane) this._enemySkillsPane.handleWheel(x, y, deltaY);
  }

  _handleKeyDown(e) {
    // ── Loadout modal: ESC closes, blocks all other input ──
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      this._loadoutOverlay.handleKeyDown(e);
      return;
    }
    // ── Level Up overlay: mandatory pick — blocks all input, no ESC skip ──
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) {
      return;
    }
    // ── Reward overlay: ESC dismisses, blocks all other input ──
    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      if (e.key === 'Escape') {
        this._rewardOverlay.dismiss();
      }
      return;
    }

    // ── Attack animation live tuner (POC; no-op unless ATTACK_ANIM_DEBUG on) ──
    if (this._handleAttackAnimDebugKey(e)) return;

    // ── Debug: instant win with 'K' key ──
    if ((e.key === 'k' || e.key === 'K') && window.__DEBUG_MODE) {
      this._debugWinBattle();
      return;
    }

    // ── Map overlay toggle ('m') ──
    if (e.key === 'm' || e.key === 'M') {
      if (this._mapView) {
        const state = this._mapView.getOverlayState();
        if (state === 'closed') {
          this._mapView.openOverlay();
          if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_open');
        } else if (state === 'open') {
          this._mapView.closeOverlay();
          if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_close');
        }
        // If animating (opening/closing), ignore to avoid restarting.
      }
      return;
    }

    // ── When map overlay is active, Escape hides it ──
    if (this._mapView && this._mapView.isOverlayActive()) {
      if (e.key === 'Escape') {
        this._mapView.closeOverlay();
        if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_close');
      }
      return;
    }

    // ── Normal battle key handling ──
    if (this._isTargeting()) {
      if (e.key === 'Escape') {
        this._battleController.cancelTargeting();
      } else if (e.key === 'Enter') {
        this._battleController.confirmTarget();
      }
    }
  }

  // ── Per-Frame Update from BattleController ──────────

  /**
   * Called each frame. Reads current game state and updates UI.
   */
  updateFromController() {
    if (!this._battleController) return;
    const state = this._battleController.getState();

    // ── Music state transitions (only on state change) ──
    this._updateMusicFromState(state.state);

    // ── Play SFX for turn announcement ──
    // Suppress the very first player-turn SFX (the battle boots into
    // PLAYER_TURN automatically; the player shouldn't hear a "new turn"
    // sound for it).
    if (state.turnAnnouncement && this._audioManager) {
      if (!this._suppressFirstTurnSfx) {
        this._audioManager.playSfx('sfx_new_turn');
      }
      this._suppressFirstTurnSfx = false;
    }

    // ── Spawn turn announcement effect ──
    if (state.turnAnnouncement && this._board && this._assetManager) {
      this._spawnTurnAnnouncementEffect(state.turnAnnouncement);
    }

    // ── Spawn extra turn effect ──
    if (state.extraTurnTriggerPos && this._board && this._assetManager) {
      this._spawnExtraTurnEffect(state.extraTurnTriggerPos);
      // Play extra_turn SFX at the time the animation pops up
      if (this._audioManager) {
        this._audioManager.playSfx('sfx_extra_turn');
      }
    }

    // ── Spawn match text effects + mana streams for every 3+ match ──
    // Mana from matches is credited to the ACTIVE side, so the wisps fly to
    // that side's mana orbs. Skull/inert matches grant no mana → no stream.
    if (state.matchTextTriggers && state.matchTextTriggers.length > 0 && this._board) {
      for (const trigger of state.matchTextTriggers) {
        this._spawnMatchTextEffect(trigger);
        if (isMana(trigger.typeId)) {
          this._spawnManaStream(trigger, state.activeSide);
        }
      }
    }

    // ── Character attack animation (POC) ──
    // Play the player character's attack flash whenever the player deals DIRECT
    // damage — a damaging spell or skull damage (NOT incidental damage like
    // reflect / relic echo / poison / bleed). The spawn guard skips if it's
    // already playing (no restart, no queue). See ATTACK_ANIMATIONS.
    if (state.directDamageBySide && state.directDamageBySide.player) {
      this._maybePlayAttackAnim();
    }

    // ── Play skull damage SFX ──
    if (state.skullDamageDealt && this._audioManager) {
      this._audioManager.playSfx('sfx_skull_damage');
    }

    // ── Play skill resolve sound ──
    // This is set by BattleController only when a skill actually resolves
    // (not on button click, not on cancel). Safe no-op if skill has no sound.
    if (state.pendingSkillSound && this._audioManager) {
      this._audioManager.playSfx(state.pendingSkillSound);
    }

    // ── Trigger screen shake for damage ──
    if (state.shakeIntensity && state.shakeIntensity > 0) {
      this._screenShake.trigger(state.shakeIntensity);
    }

    // ── Spawn tile destruction particle bursts ──
    if (state.destroyedTiles && state.destroyedTiles.length > 0 && this._board) {
      // Play tile_destroy SFX once (not per-tile)
      if (this._audioManager) {
        this._audioManager.playSfx('sfx_tile_destroy');
      }
      for (const dt of state.destroyedTiles) {
        this._spawnTileDestroyParticles(dt);
      }
    }

    // ── Spawn tile conversion shimmer effects ──
    if (state.convertedTiles && state.convertedTiles.length > 0 && this._board) {
      for (const ct of state.convertedTiles) {
        this._spawnTileConvertParticles(ct);
      }
    }

    // ── Jiggle relic icons whose passive just fired ──
    if (state.relicTriggers && state.relicTriggers.length > 0) {
      for (const ev of state.relicTriggers) {
        const bar = ev.side === 'player' ? this._relicBar : this._enemyRelicBar;
        if (bar && typeof bar.triggerJiggle === 'function') {
          bar.triggerJiggle(ev.relicId);
        }
      }
    }

    // ── Spawn Thrall-harvest tendril animations ──
    // Red tendrils spiral from each harvested Thrall tile to the harvester's
    // portrait (Usurper's Heart, fired at the boss's turn start). The boss's
    // pre-action wait is extended (_extraEnemyTurnDelay) so the tendrils finish
    // before it acts.
    if (state.harvestEvents && state.harvestEvents.length > 0 && this._board) {
      for (const ev of state.harvestEvents) {
        this._spawnHarvestTendrils(ev);
      }
    }

    // ── Thrall-summon SFX (Baron's Signet) ──
    if (state.thrallSummoned && this._audioManager) {
      this._audioManager.playSfx('sfx_thrall_summon');
    }

    // ── Reflect SFX (the `reflecting` buff fired this frame) ──
    if (state.reflectTriggered && this._audioManager) {
      this._audioManager.playSfx('sfx_generic_reflect_1');
    }

    // ── Enemy transform (Sanguine Phoenix ⇄ Egg) ──
    // Rebuild the enemy portrait + skills pane for the new identity. The relic
    // bar and HP/mana refresh from state.enemyState each frame below, so only
    // the portrait/name + skills need an explicit rebuild here.
    if (state.enemyTransformed) {
      this.setEnemyData(state.enemyTransformed);
    }
    // Transform SFX (egg spawn / hatch), set from the relic's `sound` payload.
    if (state.transformSfx && this._audioManager) {
      this._audioManager.playSfx(state.transformSfx);
    }

    // ── Board-shuffle animation (SHUFFLE skill effect) ──
    // The board model is already reshuffled; the BoardPlaceholder plays a
    // cosmetic fly-in over the new arrangement (the skill's own resolve SFX
    // plays via pendingSkillSound).
    if (state.boardShuffled && this._board && typeof this._board.playShuffleAnimation === 'function') {
      this._board.playShuffleAnimation();
    }

    // ── Combat-stat feedback over portraits ──
    // DAMAGE accumulates into a single per-side "total" counter (see
    // _addDamageToCounter); heal (green "+x") / armor (blue) / barrier (purple)
    // / poison (green) still float as independent text, stacked when concurrent.
    if (state.floatingStatEvents && state.floatingStatEvents.length > 0) {
      const stackBySide = { player: 0, enemy: 0 };
      // Gate counters to the active turn-taker's OUTGOING damage when enabled:
      // suppress damage the active side RECEIVES on its own turn (reflect, etc).
      // Only gate once we know whose turn it is — fall back to showing all.
      const restrictToActiveTurn = ONLY_SHOW_ACTIVE_TURN_DAMAGE && !!state.activeSide;
      for (const ev of state.floatingStatEvents) {
        if (ev.kind === 'damage') {
          if (restrictToActiveTurn && ev.side === state.activeSide) continue;
          const receiver = ev.side === 'player' ? state.playerState : state.enemyState;
          this._addDamageToCounter(ev.side, ev.amount, receiver ? receiver.maxHp : 0);
        } else {
          this._spawnStatTextEffect(ev, stackBySide[ev.side] || 0);
          stackBySide[ev.side] = (stackBySide[ev.side] || 0) + 1;
        }
      }
    }

    // Keep live damage counters anchored: the accumulation hovers over the
    // RECEIVER's health bar, and the number flies to that side's portrait on
    // finalize. Feed the "resolving" hint so a cascade stays as one
    // accumulating counter and only finalizes once the board settles.
    {
      const resolving = state.state === BattleState.RESOLVING || state.state === BattleState.SWAPPING;
      for (const side of ['player', 'enemy']) {
        const counter = this._damageCounters[side];
        if (!counter || counter.done) continue;
        const anchor = this._getDamageCounterAnchor(side);
        if (anchor) counter.setCenter(anchor.x, anchor.y);
        const pane = side === 'player' ? this._playerPane : this._enemyPane;
        const portrait = pane && typeof pane.getPortraitCenter === 'function' ? pane.getPortraitCenter() : null;
        if (portrait) counter.setTarget(portrait.x, portrait.y);
        // Only hold the counter open while its side is the one being attacked
        // (the opponent is the active, resolving side). Once it's this side's
        // own turn, let its received-damage total finalize promptly.
        counter.resolving = resolving && state.activeSide !== side;
      }
    }

    // Update turn label
    if (this._turnLabel) {
      this._turnLabel.text = this._battleController.getTurnLabel();
    }

    // Update player pane from real state
    if (this._playerPane && state.playerState) {
      this._playerPane.updateFromState(state.playerState);
    }
    if (this._playerSkillsPane && state.playerState && state.playerState.mana) {
      this._playerSkillsPane.setManaState(state.playerState.mana);
    }
    // Owner stats drive the live `<<n>>` dynamic damage values on skill cards
    // and relic tooltips (Attack/Magic scaling).
    if (this._playerSkillsPane && state.playerState) {
      this._playerSkillsPane.setOwnerStats({ attack: state.playerState.attack, magic: state.playerState.magic });
    }
    // Update top relic bar from player relics (no-op when unchanged)
    if (this._relicBar && state.playerState) {
      this._relicBar.setRelics(state.playerState.relics || []);
      this._relicBar.setOwnerStats({ attack: state.playerState.attack, magic: state.playerState.magic });
    }
    // Update enemy relic bar from enemy relics (no-op when unchanged)
    if (this._enemyRelicBar && state.enemyState) {
      this._enemyRelicBar.setRelics(state.enemyState.relics || []);
      this._enemyRelicBar.setOwnerStats({ attack: state.enemyState.attack, magic: state.enemyState.magic });
    }

    // Update enemy pane from real state
    if (this._enemyPane && state.enemyState) {
      this._enemyPane.updateFromState(state.enemyState);
    }
    if (this._enemySkillsPane && state.enemyState && state.enemyState.mana) {
      this._enemySkillsPane.setManaState(state.enemyState.mana);
    }
    if (this._enemySkillsPane && state.enemyState) {
      this._enemySkillsPane.setOwnerStats({ attack: state.enemyState.attack, magic: state.enemyState.magic });
    }

    // Update combat log
    if (this._combatLogText && state.log) {
      const recent = state.log.getRecent(3);
      this._combatLogText.text = recent.map(e => e.message).join(' | ');
    }

    // Pass cascade visual state to board
    if (this._board) {
      this._board.highlightCells = state.highlightCells || [];
      this._board.emptyCells = state.emptyCells || [];
      this._board.fallCells = state.fallCells || [];
      this._board.match4Flourish = state.match4Flourish || null;
      this._board.swapAnim = state.swapAnim || null;
      this._board.targetingOverlayCells = state.targetingOverlayCells || [];
      // Pass particle effects to board for correct layering (below tiles)
      this._board.particleEffects = this._particleEffects;
    }
  }

  // ── Floating Image Effects ──────────────────────────

  /**
   * Get the center of the board area in screen coordinates.
   * Used for centered turn announcement effects.
   * @returns {{x:number, y:number}|null}
   */
  _getBoardCenter() {
    if (!this._board) return null;
    const r = this._board.rect;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /**
   * Anchor for the accumulating damage counter — hovering over the RECEIVING
   * side's health bar (player pane on the left, enemy pane on the right), so
   * damage reads next to the bar it's draining instead of covering the board.
   * @param {'player'|'enemy'} side - the side taking damage
   * @returns {{x:number, y:number}|null}
   */
  _getDamageCounterAnchor(side) {
    const pane = side === 'player' ? this._playerPane : this._enemyPane;
    const bar = pane && typeof pane.getHealthBarRect === 'function' ? pane.getHealthBarRect() : null;
    if (!bar) return null;
    return { x: bar.x + bar.w / 2, y: bar.y - DAMAGE_COUNTER_BAR_LIFT };
  }

  /**
   * Spawn a centered turn announcement floating image effect.
   * @param {string} side - 'player' or 'enemy'
   */
  _spawnTurnAnnouncementEffect(side) {
    const assetKey = side === 'player'
      ? 'animated_text_player_turn'
      : 'animated_text_enemy_turn';
    const img = this._assetManager.get(assetKey);
    if (!img) return;

    const center = this._getBoardCenter();
    if (!center) return;

    const metrics = this._board.getCellMetrics();
    const targetWidth = metrics.cellSize * 5.0;
    const aspectRatio = img.width / img.height;
    const targetHeight = targetWidth / aspectRatio;

    const effect = new FloatingImageEffect(
      img,
      center.x,
      center.y,
      targetWidth,
      targetHeight,
      {
        growDuration: 150,
        settleDuration: 100,
        holdDuration: 250,
        fadeDuration: 100,
        overshoot: 1.15,
      }
    );

    this._floatingEffects.push(effect);
  }

  /**
   * Convert a board cell (col, row) to screen coordinates (center of cell).
   * @param {{col:number, row:number}} cellPos
   * @returns {{x:number, y:number}|null}
   */
  _cellToScreen(cellPos) {
    if (!this._board) return null;
    const metrics = this._board.getCellMetrics();
    return {
      x: metrics.offsetX + cellPos.col * metrics.cellSize + metrics.cellSize / 2,
      y: metrics.offsetY + cellPos.row * metrics.cellSize + metrics.cellSize / 2,
    };
  }

  /**
   * Spawn an "Extra Turn" floating image effect from the given board position.
   * @param {{col:number, row:number}} cellPos
   */
  _spawnExtraTurnEffect(cellPos) {
    const img = this._assetManager.get('animated_text_extra_turn');
    if (!img) return;

    const screen = this._cellToScreen(cellPos);
    if (!screen) return;

    // Target size: 4.5 tile widths, maintain aspect ratio
    const metrics = this._board.getCellMetrics();
    const targetWidth = metrics.cellSize * 4.5;
    const aspectRatio = img.width / img.height;
    const targetHeight = targetWidth / aspectRatio;

    const effect = new FloatingImageEffect(
      img,
      screen.x,
      screen.y,
      targetWidth,
      targetHeight,
      {
        growDuration: 200,
        settleDuration: 100,
        holdDuration: 300,
        fadeDuration: 100,
        overshoot: 1.18,
      }
    );

    this._floatingEffects.push(effect);
  }

  /**
   * Spawn a floating text effect showing the match count (e.g. "+3")
   * at the given board position, colored to match the tile type.
   * @param {{typeId:string, count:number, position:{col:number, row:number}}} trigger
   */
  _spawnMatchTextEffect(trigger) {
    const { typeId, count, position } = trigger;
    const screen = this._cellToScreen(position);
    if (!screen) return;

    const tileType = getTileType(typeId);
    const color = tileType.color;

    const text = `+${count}`;

    const effect = new FloatingTextEffect(text, color, screen.x, screen.y, {
      fontSize: 22,
      growDuration: 200,
      settleDuration: 100,
      holdDuration: 300,
      fadeDuration: 100,
      overshoot: 1.18,
    });

    this._floatingEffects.push(effect);
  }

  /**
   * Spawn a floating combat-stat text effect over a character's portrait:
   *   damage → red "-x", heal → green "+x", armor → blue "+x".
   * @param {{side:'player'|'enemy', kind:'damage'|'heal'|'armor', amount:number}} ev
   * @param {number} stackIndex - 0-based index of this event among same-side
   *                              events this frame (offsets Y so they stack).
   */
  _spawnStatTextEffect(ev, stackIndex = 0) {
    const pane = ev.side === 'player' ? this._playerPane : this._enemyPane;
    if (!pane || typeof pane.getPortraitCenter !== 'function') return;
    const center = pane.getPortraitCenter();
    if (!center) return;

    const STAT_TEXT_STYLE = {
      damage:  { color: '#e23b3b', sign: '-' },
      heal:    { color: '#3fbf3f', sign: '+' },
      armor:   { color: '#4aa3ff', sign: '+' },
      barrier: { color: '#a24dff', sign: '+' },
      // Poison damage floats as a green "-N" (placeholder). See decision #39.
      poison:  { color: '#7cc63f', sign: '-' },
    };
    const style = STAT_TEXT_STYLE[ev.kind];
    if (!style) return;

    const text = `${style.sign}${ev.amount}`;
    // Floating-combat-text style: each instance is independent — it pops in
    // large, then floats upward while fading out. Successive same-frame events
    // get a small horizontal + vertical start offset so concurrent hits don't
    // perfectly overlap as they rise.
    const startX = center.x + (stackIndex % 2 === 0 ? 1 : -1) * Math.ceil(stackIndex / 2) * 26;
    const startY = center.y - stackIndex * 10;

    const effect = new FloatingTextEffect(text, style.color, startX, startY, {
      fontSize: 54,            // larger spawn than before
      growDuration: 130,       // quick pop-in
      settleDuration: 80,
      holdDuration: 90,        // brief hold at full size
      fadeDuration: 520,       // fade out across the float
      overshoot: 1.3,
      riseDistance: 85,        // drift upward over the lifetime
    });

    this._floatingEffects.push(effect);
  }

  /**
   * Accumulate a damage hit into the receiver side's running damage counter,
   * creating a fresh counter if none is live (or the previous one is finalizing
   * / done). The counter pops up over the receiver's portrait, accumulates all
   * damage in the sequence, intensifies with relative damage, and finalizes
   * (one last grow, then fade) once the board settles. See DamageCounterEffect.
   * @param {'player'|'enemy'} side - the side taking damage
   * @param {number} amount
   * @param {number} maxHp - receiver max HP (drives relative intensity)
   */
  /**
   * True while a damage counter still needs to fly to + impact a portrait.
   * Used as the BattleController turn gate so the turn doesn't pass until the
   * dealt damage has been "delivered" to the target. Releases at impact (the
   * burst fades after the turn proceeds).
   * @returns {boolean}
   */
  _hasPendingDamageDelivery() {
    for (const side of ['player', 'enemy']) {
      const c = this._damageCounters[side];
      if (c && !c.done && !c.delivered) return true;
    }
    return false;
  }

  _addDamageToCounter(side, amount, maxHp) {
    let counter = this._damageCounters[side];
    if (!counter || counter.done || counter.finalizing) {
      // Accumulate hovering over the receiver's health bar; the number flies to
      // that side's portrait when the sequence finalizes (anchors fed each frame).
      const barAnchor = this._getDamageCounterAnchor(side);
      const pane = side === 'player' ? this._playerPane : this._enemyPane;
      const portrait = pane && typeof pane.getPortraitCenter === 'function' ? pane.getPortraitCenter() : null;
      const start = barAnchor || portrait;
      if (!start) return;
      counter = new DamageCounterEffect(start.x, start.y, this._assetManager);
      if (portrait) counter.setTarget(portrait.x, portrait.y);
      // On impact at the portrait: a quick punch of screen shake (the actual
      // damage already applied earlier — this is the ceremonial delivery).
      counter.onImpact = (intensity) => {
        if (this._screenShake) this._screenShake.trigger(7 + 13 * (intensity || 0));
      };
      this._damageCounters[side] = counter;
      this._floatingEffects.push(counter);
    }
    counter.add(amount, maxHp);
  }

  /**
   * The attack-anim config + portrait key for the CURRENT player character, or
   * null if there's no (enabled) entry for it. POC. @private
   */
  _currentAttackAnimConfig() {
    const portrait = this._playerData && this._playerData.portrait;
    if (!portrait) return null;
    const cfg = ATTACK_ANIMATIONS[portrait];
    if (!cfg || !cfg.enabled) return null;
    return { portrait, cfg };
  }

  /**
   * Persisted, live-tuned scale/offset for a character (seeded from its config
   * the first time). Lets the debug tuner's nudges survive J replays AND feed
   * the real skull-match flash. POC. @private
   */
  _attackTuning(portrait, cfg) {
    if (!this._attackAnimTuning) this._attackAnimTuning = {};
    if (!this._attackAnimTuning[portrait]) {
      this._attackAnimTuning[portrait] = {
        scale: cfg.scale,
        offset: { ...cfg.offset },
        fadeOutFrames: cfg.fadeOutFrames || 0,
      };
    }
    return this._attackAnimTuning[portrait];
  }

  /**
   * Pre-warm the current player character's attack animation so its first play
   * doesn't hitch (decode + GPU-upload the big sheet + prefetch the JSON now,
   * during the scene fade-in). No-op if there's no entry for the character. POC.
   * @private
   */
  _preloadAttackAnim() {
    const entry = this._currentAttackAnimConfig();
    if (!entry) return;
    SpriteSheetAnimation.preload(entry.cfg.sheetKey, entry.cfg.jsonPath, this._assetManager);
  }

  /**
   * PROOF OF CONCEPT: play the current character's attack sprite-sheet flash once
   * over the player portrait when they match skulls. Guarded so a multi-skull
   * cascade only spawns one flash (the previous one must finish first). See
   * ATTACK_ANIMATIONS at the top of this file.
   */
  _maybePlayAttackAnim() {
    if (!this._currentAttackAnimConfig()) return;
    if (this._attackAnim && !this._attackAnim.done) return; // already playing
    this._spawnAttackAnim(false);
  }

  /**
   * Spawn the current character's attack animation over the player portrait,
   * using its live-tuned scale/offset. `debug` makes it loop + hold so it stays
   * on screen for tuning. POC. @private
   */
  _spawnAttackAnim(debug = false) {
    const entry = this._currentAttackAnimConfig();
    if (!entry) return;
    const { portrait, cfg } = entry;
    const rect = this._playerPane && typeof this._playerPane.getPortraitRect === 'function'
      ? this._playerPane.getPortraitRect() : null;
    if (!rect) return;
    const tune = this._attackTuning(portrait, cfg);
    this._attackAnim = new SpriteSheetAnimation(
      cfg.sheetKey, cfg.jsonPath, this._assetManager,
      { anchorRect: rect, scale: tune.scale, offset: { ...tune.offset },
        fps: cfg.fps, alpha: cfg.alpha, fadeOutFrames: tune.fadeOutFrames,
        loop: debug, hold: debug }
    );
  }

  /**
   * Live tuner key handling for the attack-animation POC — targets the current
   * player character's entry. Returns true if it consumed the key. No-op unless
   * ATTACK_ANIM_DEBUG is on. See the key map in the ATTACK_ANIMATIONS comment.
   * @private
   */
  _handleAttackAnimDebugKey(e) {
    if (!ATTACK_ANIM_DEBUG) return false;
    const entry = this._currentAttackAnimConfig();
    if (!entry) return false;
    const { portrait, cfg } = entry;
    const tune = this._attackTuning(portrait, cfg);

    const moveStep = e.shiftKey ? 10 : 1;
    const scaleStep = e.shiftKey ? 0.2 : 0.01;
    const anim = this._attackAnim;
    let handled = true;
    switch (e.key) {
      case 'j': case 'J': this._spawnAttackAnim(true); break;
      case 'p': case 'P': if (anim) anim.togglePause(); break;
      case 'ArrowLeft':  tune.offset.x -= moveStep; break;
      case 'ArrowRight': tune.offset.x += moveStep; break;
      case 'ArrowUp':    tune.offset.y -= moveStep; break;
      case 'ArrowDown':  tune.offset.y += moveStep; break;
      case '[': tune.scale = Math.max(0.05, tune.scale - scaleStep); break;
      case ']': tune.scale += scaleStep; break;
      case '-': tune.fadeOutFrames = Math.max(0, tune.fadeOutFrames - 1); break;
      case '=': tune.fadeOutFrames += 1; break;
      case ',': if (anim) anim.stepFrame(-1); break;
      case '.': if (anim) anim.stepFrame(1); break;
      case 'c': case 'C':
        console.log(`[ATTACK_ANIMATIONS.${portrait}] scale: ${tune.scale.toFixed(2)}, offset: { x: ${Math.round(tune.offset.x)}, y: ${Math.round(tune.offset.y)} }, fadeOutFrames: ${tune.fadeOutFrames}`);
        break;
      default: handled = false;
    }
    if (handled) {
      if (this._attackAnim) {
        this._attackAnim.setScale(tune.scale);
        this._attackAnim.setOffset(tune.offset.x, tune.offset.y);
        this._attackAnim.setFadeOutFrames(tune.fadeOutFrames);
      }
      e.preventDefault();
    }
    return handled;
  }

  /** Draw the attack-anim debug HUD (design space). POC. @private */
  _renderAttackAnimDebugHud(ctx) {
    const entry = this._currentAttackAnimConfig();
    if (!entry) return;
    const { portrait, cfg } = entry;
    const tune = this._attackTuning(portrait, cfg);
    const info = this._attackAnim ? this._attackAnim.getDebugInfo() : null;
    const lines = [
      `${portrait.toUpperCase()} ATTACK ANIM — debug`,
      `scale ${tune.scale.toFixed(2)}   offset { x:${Math.round(tune.offset.x)}, y:${Math.round(tune.offset.y)} }`,
      `fadeOutFrames ${tune.fadeOutFrames}${info ? `   fade ${info.fadeAlpha.toFixed(2)}` : ''}`,
      info ? `frame ${info.frame + 1}/${info.frameCount}   ${info.paused ? 'PAUSED' : 'playing'}` : '(press J to summon)',
      'J replay · P pause · arrows move · [ ] scale · - = fade · , . frame · C log',
    ];
    ctx.save();
    ctx.font = '20px monospace';
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    const x = 220, y = 240, padX = 14, padY = 12, lh = 26;
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lh + padY * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,210,120,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#ffd27a' : '#e8e8e8';
      ctx.fillText(lines[i], x + padX, y + padY + i * lh);
    }
    ctx.restore();
  }

  /**
   * Fly a thin whispy mana stream from the matched tiles to the matching mana
   * orb on the side that gained the mana (the active side), then pulse that orb
   * as the wisps land.
   * @param {{typeId:string, positions:Array<{col:number,row:number}>}} trigger
   * @param {'player'|'enemy'} side - the side the mana is credited to
   */
  _spawnManaStream(trigger, side) {
    const pane = side === 'player' ? this._playerPane : this._enemyPane;
    if (!pane || typeof pane.getManaOrbCenter !== 'function') return;
    const target = pane.getManaOrbCenter(trigger.typeId);
    if (!target) return;

    const cells = trigger.positions || (trigger.position ? [trigger.position] : []);
    const sources = cells.map((c) => this._cellToScreen(c)).filter(Boolean);
    if (sources.length === 0) return;

    const tileType = getTileType(trigger.typeId);
    this._floatingEffects.push(
      new ManaStreamEffect(sources, target, {
        color: tileType.color,
        coreColor: '#fffcee',
        onArrive: () => pane.pulseManaOrb(trigger.typeId),
      })
    );
  }

  /**
   * Spawn the red "tendril" harvest animation: spirals from each harvested
   * Thrall cell to the harvester's portrait (Baron's Signet).
   * @param {{side:'player'|'enemy', positions:Array<{col:number,row:number}>, color:string}} ev
   */
  _spawnHarvestTendrils(ev) {
    if (!ev || !ev.positions || ev.positions.length === 0) return;

    const sources = ev.positions
      .map((p) => this._cellToScreen(p))
      .filter(Boolean);
    if (sources.length === 0) return;

    // Harvest sound effect — once per harvest event.
    if (this._audioManager) this._audioManager.playSfx('sfx_thrall_harvest');

    // Dramatic liquid-blood splash from each harvested tile's location.
    const cellSize = this._board.getCellMetrics().cellSize;
    const bloodScale = Math.max(0.5, cellSize / 80);
    for (const src of sources) {
      this._floatingEffects.push(
        new BloodSplashEffect(src.x, src.y, { scale: bloodScale })
      );
    }

    // Energy tendrils to the harvester's portrait. Skipped for `bloodOnly`
    // events (the Sanguine Chrysalis egg-burst: blood splash, no beams).
    if (ev.bloodOnly) return;
    const pane = ev.side === 'player' ? this._playerPane : this._enemyPane;
    if (!pane || typeof pane.getPortraitCenter !== 'function') return;
    const target = pane.getPortraitCenter();
    if (!target) return;
    this._floatingEffects.push(
      new HarvestTendrilEffect(sources, target, { color: ev.color || '#d22a2a' })
    );
  }

  /**
   * Spawn a particle burst effect for a single destroyed tile.
   * Particle size scales with the board cell size for consistency.
   * @param {{col:number, row:number, typeId:string}} destroyedTile
   */
  _spawnTileDestroyParticles(destroyedTile) {
    const screen = this._cellToScreen(destroyedTile);
    if (!screen) return;

    const tileType = getTileType(destroyedTile.typeId);
    const metrics = this._board.getCellMetrics();
    // Base particle radius ~5% of cell size, clamped to 2-5px
    const baseSize = Math.max(2, Math.min(5, metrics.cellSize * 0.05));

    const effect = new TileParticleEffect(
      screen.x, screen.y,
      tileType.particleColor,
      baseSize,
      {
        particleCount: 12,
        sparkCount: 6,
        minLife: 250,
        maxLife: 500,
        minSpeed: metrics.cellSize * 0.12,
        maxSpeed: metrics.cellSize * 0.55,
        gravity: metrics.cellSize * 0.03,
      }
    );

    this._particleEffects.push(effect);
  }

  /**
   * Spawn a shimmer/pop conversion effect for a tile changed by CREATE_TILES.
   * Uses an inward particle burst (smaller, directed inward) with the new
   * tile type's color to visually communicate "this tile transformed."
   * @param {{col:number, row:number, typeId:string}} convertedTile
   */
  _spawnTileConvertParticles(convertedTile) {
    const screen = this._cellToScreen(convertedTile);
    if (!screen) return;

    const tileType = getTileType(convertedTile.typeId);
    const metrics = this._board.getCellMetrics();
    // Slightly larger base size for conversion shimmer
    const baseSize = Math.max(2, Math.min(6, metrics.cellSize * 0.07));

    const effect = new TileParticleEffect(
      screen.x, screen.y,
      tileType.particleColor,
      baseSize,
      {
        particleCount: 8,
        sparkCount: 4,
        minLife: 200,
        maxLife: 400,
        minSpeed: metrics.cellSize * 0.04,
        maxSpeed: metrics.cellSize * 0.25,
        gravity: metrics.cellSize * -0.02,  // slight upward drift for "magic" feel
      }
    );

    this._particleEffects.push(effect);
  }

  // ── Update (override) ───────────────────────────────

  update(dt) {
    // ── Advance map overlay animation ──
    if (this._mapView) {
      this._mapView.updateOverlayAnimation(dt);
    }

    // ── Update post-battle overlay animations ──
    if (this._levelUpOverlay) {
      this._levelUpOverlay.update(dt);
    }
    if (this._rewardOverlay) {
      this._rewardOverlay.update(dt);
    }

    // ── Loadout modal fade-in ──
    if (this._loadoutOverlay) {
      this._loadoutOverlay.update(dt);
    }

    // ── Tooltip manager: gate by modal overlays + advance hold timer ──
    if (this._tooltipManager) {
      const overlayActive =
        (this._levelUpOverlay && this._levelUpOverlay.isActive()) ||
        (this._rewardOverlay && this._rewardOverlay.isActive()) ||
        (this._loadoutOverlay && this._loadoutOverlay.isActive()) ||
        (this._mapView && this._mapView.isOverlayActive());
      this._tooltipManager.setEnabled(!overlayActive);
      this._tooltipManager.update(dt);
    }

    // Update game logic first (battle state machine, AI, etc.)
    if (this._battleController) {
      this._battleController.update(dt);
    }

    // Sync UI state from game state
    this.updateFromController();

    // ── Cached advisor suggestion lifecycle ──
    // Any state away from PLAYER_TURN (swap, cascade, targeting, turn pass)
    // invalidates the per-turn suggestion cache; skill casts and loadout
    // changes invalidate explicitly at their call sites.
    if (this._battleController
        && this._battleController.state !== BattleState.PLAYER_TURN) {
      this._suggestedMove = undefined;
    }

    // ── Hint highlight lifecycle ──
    // Ticks down over HINT_DURATION_MS and clears EARLY the moment the player
    // acts (any state change away from PLAYER_TURN — swap, cast, targeting),
    // so a stale hint never lingers over a resolving/changed board.
    if (this._hintTimeLeft > 0) {
      this._hintTime += dt;
      this._hintTimeLeft -= dt;
      const stillPlayerTurn = this._battleController
        && this._battleController.state === BattleState.PLAYER_TURN;
      if (this._hintTimeLeft <= 0 || !stillPlayerTurn) {
        this._hintTimeLeft = 0;
        this._hintCells = null;
      }
    }

    // ── Match-4+ hit-stop (decision #42) ──
    // During the brief emphasis freeze, EVERYTHING stops: no character/portrait
    // animation, no floating/animated text, no damage counters, no particles, no
    // screen shake. Only the board's own flourish (darken + glow) keeps playing.
    // The controller's phase timer (advanced above) still counts down so the
    // freeze self-terminates; we just skip advancing every scene animation here.
    if (this._battleController && this._battleController.isHitStopActive()) {
      if (this._board) this._board.update(dt);
      return;
    }

    // ── Detect game over ──
    if (this._battleController && this._battleController.state === BattleState.GAME_OVER) {
      this._gameOverTimer += dt;
      if (this._gameOverTimer >= this._gameOverDelay && !this._rewardOverlayShown) {
        this._rewardOverlayShown = true;
        const isVictory = this._battleController
          ? this._battleController._winner() === 'player'
          : false;

        // ── Defeat: go to the dedicated Game Over scene (any input there
        //    returns to character select for a fresh run). No reward overlay,
        //    no return-to-map. ──
        if (!isVictory) {
          if (this._sceneManager) {
            this._sceneManager.fadeToScene('GameOverScene', 500);
          }
          return;
        }

        // ── Victory: AUTO-apply the character's growth plan (stat picking is
        //    disabled — decision #36), then open the relic reward overlay. ──
        this._applyGrowthPlan();
        this._showRewardOverlay();
      }
    }

    // Update children (standard UI tree update)
    super.update(dt);

    // Update screen shake
    this._screenShake.update(dt);

    // Update floating effects, remove completed ones
    for (let i = this._floatingEffects.length - 1; i >= 0; i--) {
      this._floatingEffects[i].update(dt);
      if (this._floatingEffects[i].done) {
        this._floatingEffects.splice(i, 1);
      }
    }

    // Update the character attack animation POC (one-shot; cleared when done).
    if (this._attackAnim) {
      this._attackAnim.update(dt);
      if (this._attackAnim.done) this._attackAnim = null;
    }
    // Portrait hand-off: while the flash plays the portrait is hidden (the
    // animation replaces it), then fades back in as the INVERSE of the anim's
    // fadeOutFrames tail — the two cross-fade at the same rate. No anim → 1.
    if (this._playerPane && this._playerPane.setPortraitAlpha) {
      this._playerPane.setPortraitAlpha(this._attackAnim ? 1 - this._attackAnim.fadeAlpha : 1);
    }

    // Update particle effects, remove completed ones
    for (let i = this._particleEffects.length - 1; i >= 0; i--) {
      this._particleEffects[i].update(dt);
      if (this._particleEffects[i].done) {
        this._particleEffects.splice(i, 1);
      }
    }
  }

  // ── Render (override) ───────────────────────────────

  /**
   * Paint a full-canvas readability scrim over the battle background BEFORE
   * the UI is drawn (called by SceneManager after clear(), before the viewport
   * clip). Dark plateaus behind the relic bars keep the relics legible; a
   * lighter band covers the central play area; both plateaus fall off hard to
   * transparent toward the screen edges so the decorative side art shows
   * through. Boundaries track the relic bars + character panels. See
   * SCRIM_PLAY_ALPHA / SCRIM_RELIC_ALPHA / SCRIM_EDGE_SHOULDER.
   */
  renderBackground(ctx) {
    const app = this._sceneManager && this._sceneManager._app;
    if (!app || typeof app.designXToCanvasFraction !== 'function') return;

    const pL = this._playerPane && this._playerPane.rect;
    const pR = this._enemyPane && this._enemyPane.rect;
    const rL = this._relicBar && this._relicBar.rect;
    const rR = this._enemyRelicBar && this._enemyRelicBar.rect;
    if (!pL || !pR || !rL || !rR || pR.w <= 0 || rR.w <= 0) return;

    const F = (x) => app.designXToCanvasFraction(x);
    const dark = `rgba(${SCRIM_COLOR}, ${SCRIM_RELIC_ALPHA})`;
    const play = `rgba(${SCRIM_COLOR}, ${SCRIM_PLAY_ALPHA})`;
    const clear = `rgba(${SCRIM_COLOR}, 0)`;

    // Left→right, monotonically increasing fractions (fillFullCanvasHGradient
    // clamps each `at` into 0..1). The dark relic plateaus ramp DOWN to the
    // lighter play alpha across the panel width (hidden behind the panel art)
    // and ramp UP hard from transparent at the relic bars' outer edges.
    app.fillFullCanvasHGradient([
      { at: 0,                          color: clear },  // left screen edge
      { at: F(rL.x - SCRIM_EDGE_SHOULDER), color: clear },  // hold transparent
      { at: F(rL.x),                    color: dark },   // hard rise: relic band
      { at: F(rL.x + rL.w),             color: dark },   // relic plateau (left)
      { at: F(pL.x + pL.w),             color: play },   // → play area (under panel)
      { at: F(pR.x),                    color: play },   // flat over the board
      { at: F(rR.x),                    color: dark },   // → relic band (under panel)
      { at: F(rR.x + rR.w),             color: dark },   // relic plateau (right)
      { at: F(rR.x + rR.w + SCRIM_EDGE_SHOULDER), color: clear }, // hard fall
      { at: 1,                          color: clear },  // right screen edge
    ]);
  }

  /**
   * Paint full-canvas overlays that sit on top of the battle UI and must
   * cover the letterbox/pillarbox bars. Called by SceneManager after the
   * design-space viewport clip is closed.
   *
   * - Map overlay ('m' key): dark backdrop full-canvas + map panel in
   *   design space (via MapView.renderOverlay).
   * - Reward overlay (post-battle): dark transparent backdrop full-canvas +
   *   reward panel in design space (via RewardOverlay.render).
   */
  renderForeground(ctx) {
    const sm = this._sceneManager;
    if (!sm) return;
    const w = sm._app.width;
    const h = sm._app.height;

    // Corner action buttons (skip / map) — drawn before the overlays so a
    // map/reward overlay backdrop sits on top of them. Self-gated when an
    // overlay is active.
    this._renderCornerButtons(ctx);

    if (this._mapView && this._mapView.isOverlayActive()) {
      this._mapView.renderOverlay(ctx, w, h, 16, sm._app);
    }

    // Level Up overlay (post-victory, shows before rewards) — same dimmed
    // backdrop treatment; the battle stays visible behind it.
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) {
      sm._app.fillFullCanvas(`rgba(0, 0, 0, ${this._levelUpOverlay.getBackdropAlpha()})`);
      this._levelUpOverlay.render(ctx, w, h);
    }

    if (this._rewardOverlay && this._rewardOverlay.isActive()) {
      // Full-canvas dark transparent backdrop (covers the letterbox bars),
      // matching the map overlay treatment — the battle scene stays visible
      // behind it but darkened. Alpha ramps with the overlay's entrance.
      sm._app.fillFullCanvas(`rgba(0, 0, 0, ${this._rewardOverlay.getBackdropAlpha()})`);
      this._rewardOverlay.render(ctx, w, h);
    }

    // Manage Skills / Loadout modal — same dimmed-backdrop treatment; the
    // battle stays visible but inactive behind it.
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) {
      sm._app.fillFullCanvas(`rgba(0, 0, 0, ${this._loadoutOverlay.getBackdropAlpha()})`);
      this._loadoutOverlay.render(ctx, w, h);
    }
  }

  // ── Corner action buttons (skip / map) ──────────────

  /**
   * Compute the design-space rects for the two stacked top-right corner
   * buttons. Anchored to the FAR physical top-right corner (via the app's
   * CSS→design transform) so they sit out past the design viewport, not
   * bound by the inner battle layout. Returns null if the app isn't ready.
   * @returns {{skip:object, map:object}|null}
   */
  _getCornerButtonRects() {
    const app = this._sceneManager && this._sceneManager._app;
    if (!app || !app.cssToDesign) return null;
    const corner = app.cssToDesign(app.cssWidth, 0); // physical top-right in design coords
    const x = corner.x - CORNER_BUTTON_MARGIN - CORNER_BUTTON_SIZE;
    const yTop = corner.y + CORNER_BUTTON_MARGIN;
    const s = CORNER_BUTTON_SIZE;
    // Hint "?" is smaller than the two icon buttons — center it in the column.
    const hs = HINT_BUTTON_SIZE;
    return {
      skip: { x, y: yTop, w: s, h: s },
      map:  { x, y: yTop + s + CORNER_BUTTON_GAP, w: s, h: s },
      hint: {
        x: x + (s - hs) / 2,
        y: yTop + (s + CORNER_BUTTON_GAP) * 2,
        w: hs, h: hs,
      },
    };
  }

  static _pointInRect(px, py, r) {
    return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /**
   * Hit-test the corner buttons. Returns true if a button was clicked.
   * Skip = force-win the battle (same as the 'K' debug key); Map = open the
   * map overlay.
   */
  _handleCornerButtonClick(x, y) {
    const rects = this._getCornerButtonRects();
    if (!rects) return false;
    if (BattleScene._pointInRect(x, y, rects.skip)) {
      this._debugWinBattle();
      return true;
    }
    if (BattleScene._pointInRect(x, y, rects.map)) {
      if (this._mapView && this._mapView.getOverlayState() === 'closed') {
        this._mapView.openOverlay();
        if (this._audioManager) this._audioManager.playSfx('sfx_map_overlay_open');
      }
      return true;
    }
    if (BattleScene._pointInRect(x, y, rects.hint)) {
      this._requestHint();
      return true;
    }
    return false;
  }

  /**
   * The "?" hint button: ask the controller's MoveAdvisor for the best swap
   * and pulse-highlight its two cells on the board for a few seconds. Only
   * meaningful during PLAYER_TURN (the button renders dimmed otherwise and a
   * click is a no-op). The advisor call is a synchronous batch of board
   * simulations — fine on a click, never per frame.
   */
  _requestHint() {
    const c = this._battleController;
    if (!c || c.state !== BattleState.PLAYER_TURN) return;
    const best = this._getSuggestedMoveCached();
    if (!best || !best.swap) return;
    this._hintCells = [
      { col: best.swap.col1, row: best.swap.row1 },
      { col: best.swap.col2, row: best.swap.row2 },
    ];
    this._hintTimeLeft = HINT_DURATION_MS;
    this._hintTime = 0;
  }

  /**
   * The advisor's best move for the current player turn — computed AT MOST
   * once per turn (the "?" button and the idle hint glint share the cache).
   * Returns null outside PLAYER_TURN or when no legal move exists.
   * @returns {{swap, score, breakdown, outcome}|null}
   */
  _getSuggestedMoveCached() {
    const c = this._battleController;
    if (!c || c.state !== BattleState.PLAYER_TURN) return null;
    if (this._suggestedMove === undefined) {
      this._suggestedMove = c.getSuggestedMove() || null;
    }
    return this._suggestedMove;
  }

  /**
   * Drop the cached advisor suggestion. Called whenever something changes
   * what the advisor would say while PLAYER_TURN persists: a skill cast
   * (mana spent, board mutated by shuffle/lock, enemy HP changed) or a
   * loadout change. State changes away from PLAYER_TURN invalidate in
   * update() (covers swaps, cascades, targeting, turn passes).
   */
  _invalidateSuggestedMove() {
    this._suggestedMove = undefined;
  }

  /** Draw the two stacked corner buttons. Hidden while an overlay is active. */
  _renderCornerButtons(ctx) {
    if (this._levelUpOverlay && this._levelUpOverlay.isActive()) return;
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    const rects = this._getCornerButtonRects();
    if (!rects || !this._assetManager) return;
    const skipImg = this._assetManager.get('battle_button_skip');
    const mapImg  = this._assetManager.get('battle_button_map');
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    if (skipImg) ctx.drawImage(skipImg, rects.skip.x, rects.skip.y, rects.skip.w, rects.skip.h);
    if (mapImg)  ctx.drawImage(mapImg, rects.map.x, rects.map.y, rects.map.w, rects.map.h);
    this._renderHintButton(ctx, rects.hint);
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  /**
   * Draw the small "?" hint button (canvas primitives — no dedicated asset):
   * a dark disc with a gold ring and a gold "?" glyph, dimmed whenever a hint
   * can't be requested (not the player's turn).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,w:number,h:number}} r
   */
  _renderHintButton(ctx, r) {
    if (!r) return;
    const enabled = this._battleController
      && this._battleController.state === BattleState.PLAYER_TURN;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.save();
    ctx.globalAlpha = enabled ? 0.95 : 0.35;
    // Disc
    ctx.beginPath();
    ctx.arc(cx, cy, r.w / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 14, 10, 0.85)';
    ctx.fill();
    // Gold ring
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${HINT_COLOR}, 0.9)`;
    ctx.stroke();
    // "?" glyph
    ctx.fillStyle = `rgba(${HINT_COLOR}, 0.95)`;
    ctx.font = `${Math.round(r.h * 0.58)}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + r.h * 0.03);
    ctx.restore();
  }

  /**
   * Pulsing gold highlight over the two cells of the suggested swap (the "?"
   * hint), with a double-headed arrow between them showing the swap direction.
   * Self-fades over the last HINT_FADE_MS. No-op when no hint is active.
   * @param {CanvasRenderingContext2D} ctx
   */
  _renderHintHighlight(ctx) {
    if (!this._hintCells || this._hintTimeLeft <= 0 || !this._board) return;
    const metrics = this._board.getCellMetrics();
    if (!metrics || !metrics.cellSize) return;

    const pulse = 0.55 + 0.45 * Math.sin((this._hintTime / 1000) * Math.PI * 2 * HINT_PULSE_HZ);
    const fade = Math.min(1, this._hintTimeLeft / HINT_FADE_MS);
    const alpha = pulse * fade;
    const inset = Math.max(2, metrics.cellSize * 0.06);

    ctx.save();
    for (const cell of this._hintCells) {
      const x = metrics.offsetX + cell.col * metrics.cellSize + inset;
      const y = metrics.offsetY + cell.row * metrics.cellSize + inset;
      const s = metrics.cellSize - inset * 2;
      // Soft outer glow (wide, faint) + crisp inner outline — no shadowBlur
      // (the expensive canvas op; two strokes read the same).
      ctx.lineWidth = 7;
      ctx.strokeStyle = `rgba(${HINT_COLOR}, ${(alpha * 0.35).toFixed(3)})`;
      ctx.strokeRect(x, y, s, s);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${HINT_COLOR}, ${alpha.toFixed(3)})`;
      ctx.strokeRect(x, y, s, s);
    }

    // Double-headed arrow between the two cell centers (the swap gesture).
    const [a, b] = this._hintCells;
    const ax = metrics.offsetX + a.col * metrics.cellSize + metrics.cellSize / 2;
    const ay = metrics.offsetY + a.row * metrics.cellSize + metrics.cellSize / 2;
    const bx = metrics.offsetX + b.col * metrics.cellSize + metrics.cellSize / 2;
    const by = metrics.offsetY + b.row * metrics.cellSize + metrics.cellSize / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // Pull the shaft in from both centers so the heads sit inside the cells.
    const pad = metrics.cellSize * 0.26;
    const sx = ax + ux * pad, sy = ay + uy * pad;
    const ex = bx - ux * pad, ey = by - uy * pad;
    const head = Math.max(6, metrics.cellSize * 0.14);
    ctx.strokeStyle = `rgba(${HINT_COLOR}, ${alpha.toFixed(3)})`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    for (const [tipX, tipY, dirX, dirY] of [[ex, ey, ux, uy], [sx, sy, -ux, -uy]]) {
      ctx.beginPath();
      ctx.moveTo(tipX + dirX * head, tipY + dirY * head);
      ctx.lineTo(tipX - dirY * head * 0.55, tipY + dirX * head * 0.55);
      ctx.lineTo(tipX + dirY * head * 0.55, tipY - dirX * head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Targeting Confirm/Cancel controls (touch-friendly) ──────

  /**
   * Design-space rects for the targeting controls, anchored just BELOW the
   * board (centered on it) so they never cover tiles; falls back to the
   * viewport bottom-center if the board rect isn't ready. Clamped on screen.
   *
   * On TOUCH there are two buttons (Cancel | Cast — board taps only position).
   * On DESKTOP a click casts instantly, so only a single centered Cancel button
   * is shown (`confirm` is null). Null if no app.
   * @returns {{cancel:object, confirm:object|null, cx:number, touch:boolean}|null}
   */
  _getTargetingButtonRects() {
    const app = this._sceneManager && this._sceneManager._app;
    if (!app) return null;
    let cx = app.width / 2;
    let centerY = TARGET_BTN_CENTER_Y;
    const board = this._board;
    if (board && board.rect && board.rect.h > 0) {
      cx = board.rect.x + board.rect.w / 2;
      const below = board.rect.y + board.rect.h + 28 + TARGET_BTN_H / 2;
      centerY = Math.min(below, app.height - TARGET_BTN_H / 2 - 16);
    }
    const top = centerY - TARGET_BTN_H / 2;
    const w = Math.round(TARGET_BTN_H * this._targetBtnAspect());
    const touch = this._isTouchInput();
    if (touch) {
      return {
        cancel:  { x: cx - TARGET_BTN_GAP / 2 - w, y: top, w, h: TARGET_BTN_H },
        confirm: { x: cx + TARGET_BTN_GAP / 2,     y: top, w, h: TARGET_BTN_H },
        cx, touch: true,
      };
    }
    // Desktop: a single centered Cancel button (clicks on the board cast).
    return {
      cancel:  { x: cx - w / 2, y: top, w, h: TARGET_BTN_H },
      confirm: null,
      cx, touch: false,
    };
  }

  /** Aspect ratio of the targeting button art (falls back before it loads). */
  _targetBtnAspect() {
    const img = this._assetManager && this._assetManager.get(TARGET_CONFIRM_SPRITE);
    if (img && img.width && img.height) return img.width / img.height;
    return TARGET_BTN_FALLBACK_ASPECT;
  }

  /**
   * Hit-test the targeting buttons. Confirm casts the skill at the current
   * preview cell; Cancel aborts targeting. Returns true if a button was hit.
   */
  _handleTargetingButtonClick(x, y) {
    const rects = this._getTargetingButtonRects();
    if (!rects) return false;
    if (rects.confirm && BattleScene._pointInRect(x, y, rects.confirm)) {
      this._battleController.confirmTarget();
      return true;
    }
    if (BattleScene._pointInRect(x, y, rects.cancel)) {
      this._battleController.cancelTargeting();
      return true;
    }
    return false;
  }

  /** True if (x,y) is over either targeting button (while targeting). */
  _pointOverTargetingButton(x, y) {
    if (!this._isTargeting()) return false;
    const rects = this._getTargetingButtonRects();
    if (!rects) return false;
    return BattleScene._pointInRect(x, y, rects.cancel)
      || (!!rects.confirm && BattleScene._pointInRect(x, y, rects.confirm));
  }

  /** Draw the targeting Cancel/Cast button art. Only while targeting. */
  _renderTargetingControls(ctx) {
    if (!this._isTargeting()) return;
    if (this._mapView && this._mapView.isOverlayActive()) return;
    if (this._rewardOverlay && this._rewardOverlay.isActive()) return;
    if (this._loadoutOverlay && this._loadoutOverlay.isActive()) return;
    const rects = this._getTargetingButtonRects();
    if (!rects) return;

    // "Casting <skill>" prompt on the nameplate banner, centered at the top.
    const app = this._sceneManager._app;
    const cx = app.width / 2;
    const skill = this._battleController._targetingSkill;
    const name = skill && skill.name ? skill.name : 'a spell';

    const plate = this._assetManager && this._assetManager.get(TARGET_NAMEPLATE_SPRITE);
    const plateAspect = (plate && plate.width && plate.height)
      ? plate.width / plate.height : TARGET_NAMEPLATE_FALLBACK_ASPECT;
    const plateH = TARGET_NAMEPLATE_W / plateAspect;
    if (plate) {
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(plate, cx - TARGET_NAMEPLATE_W / 2, TARGET_PROMPT_Y - plateH / 2,
        TARGET_NAMEPLATE_W, plateH);
      ctx.imageSmoothingEnabled = prevSmoothing;
    }

    // Text centered within the nameplate, shrunk to fit its usable width.
    const text = `Casting ${name}`;
    ctx.save();
    let size = TARGET_PROMPT_FONT_SIZE;
    ctx.font = `${size}px "Marcellus SC", Georgia, serif`;
    const usable = TARGET_NAMEPLATE_W * TARGET_PROMPT_MAX_WIDTH_FRAC;
    const measured = ctx.measureText(text).width;
    if (measured > usable) {
      size = Math.max(14, Math.floor(size * (usable / measured)));
      ctx.font = `${size}px "Marcellus SC", Georgia, serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TARGET_PROMPT_COLOR;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 8;
    ctx.fillText(text, cx, TARGET_PROMPT_Y + TARGET_PROMPT_TEXT_Y_NUDGE);
    ctx.restore();

    if (rects.confirm) {
      this._drawTargetButton(ctx, rects.confirm, TARGET_CONFIRM_SPRITE, 'Confirm');
    }
    this._drawTargetButton(ctx, rects.cancel, TARGET_CANCEL_SPRITE, 'Cancel');
  }

  /** Draw one targeting button: spritesheet art + centered label (hover grow). */
  _drawTargetButton(ctx, r, spriteKey, label) {
    const img = this._assetManager && this._assetManager.get(spriteKey);
    if (!img) return;
    const hovered = BattleScene._pointInRect(this._lastPointerX, this._lastPointerY, r);
    const sc = hovered ? TARGET_BTN_HOVER_SCALE : 1;
    const w = r.w * sc;
    const h = r.h * sc;
    const x = r.x + (r.w - w) / 2;
    const y = r.y + (r.h - h) / 2;
    // Semi-transparent (configurable) — full opacity on hover so it pops.
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * (hovered ? TARGET_BTN_HOVER_ALPHA : TARGET_BTN_ALPHA);
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    if (hovered) {
      ctx.save();
      ctx.shadowColor = 'rgba(232, 200, 110, 0.55)';
      ctx.shadowBlur = 18;
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.imageSmoothingEnabled = prevSmoothing;

    // Centered label over the art.
    ctx.save();
    ctx.font = `${Math.round(TARGET_BTN_LABEL_SIZE * sc)}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TARGET_BTN_LABEL_COLOR;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + TARGET_BTN_LABEL_Y_NUDGE);
    ctx.restore();

    ctx.globalAlpha = prevAlpha;
  }

  render(ctx) {
    // Apply screen shake offset
    const shake = this._screenShake.getOffset();
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.save();
      ctx.translate(shake.x, shake.y);
    }

    // Render standard UI (background, children, board with particles)
    super.render(ctx);

    // Hint highlight — pulsing outline on the suggested swap's two cells.
    // Drawn inside the shake transform so it tracks the board.
    this._renderHintHighlight(ctx);

    // Render floating effects on top of everything
    for (const effect of this._floatingEffects) {
      effect.render(ctx);
    }

    // Character attack animation POC — drawn over the portrait, above effects.
    if (this._attackAnim) this._attackAnim.render(ctx);
    if (ATTACK_ANIM_DEBUG) this._renderAttackAnimDebugHud(ctx);

    // Restore context after shake offset
    if (shake.x !== 0 || shake.y !== 0) {
      ctx.restore();
    }

    // Targeting Confirm/Cancel controls (design space, above the board).
    this._renderTargetingControls(ctx);

    // Tooltips render last so they sit above all battle UI (but still
    // inside the design-space viewport clip). The manager self-gates when
    // a modal overlay is active.
    if (this._tooltipManager) {
      this._tooltipManager.render(ctx);
    }

    // Map overlay and reward overlay are rendered by renderForeground()
    // so their full-canvas backdrops/splashes cover the letterbox bars.
  }


  // ── data updates ────────────────────────────────────

  setPlayerData(data) {
    this._playerData = data;
    if (this._playerPane) this._playerPane.setCharacterData(data);
    if (this._playerSkillsPane) this._playerSkillsPane.setSkills((data && data.skills) || []);
    // Re-wire skill click after rebuild
    if (this._playerSkillsPane && this._battleController) {
      this._playerSkillsPane.onSkillClick = (skill) => {
        this._invalidateSuggestedMove();
        this._battleController.tryPlayerSkill(skill);
      };
    }
    this._registerSkillTooltips();
  }

  setEnemyData(data) {
    this._enemyData = data;
    if (this._enemyPane) this._enemyPane.setCharacterData(data);
    if (this._enemySkillsPane) this._enemySkillsPane.setSkills((data && data.skills) || []);
    this._registerSkillTooltips();
  }

  /**
   * Register the skill cards' description KeywordTexts as inline keyword
   * tooltip sources. Every card shows its full description directly, so
   * there is no full-skill tooltip — hovering a colored [[keyword]] inside
   * any card's text shows that keyword's definition (+ chain). Re-runs
   * whenever skills are (re)built (relic icon tooltips are unaffected).
   */
  _registerSkillTooltips() {
    const tm = this._tooltipManager;
    if (!tm) return;
    tm.clearKeywordSources();
    const opts = { offset: 16, hitPadding: 6 };
    for (const pane of [this._playerSkillsPane, this._enemySkillsPane]) {
      if (!pane || !pane.descKeywordTexts) continue;
      for (const kt of pane.descKeywordTexts) tm.attachKeywordSource(kt, opts);
    }
  }

  updateFromData() {
    if (this._playerPane) this._playerPane.updateFromData();
    if (this._enemyPane) this._enemyPane.updateFromData();
  }

  // ── Board access ────────────────────────────────────

  /** @returns {BoardPlaceholder|null} */
  getBoard() {
    return this._board;
  }

  /** @returns {CharacterInfoPane|null} */
  getPlayerPane() {
    return this._playerPane;
  }

  /** @returns {CharacterInfoPane|null} */
  getEnemyPane() {
    return this._enemyPane;
  }

  // ── asset mgmt ──────────────────────────────────────

  setAssetManager(am) {
    this._assetManager = am;
    if (this._playerPane) this._playerPane.setAssetManager(am);
    if (this._enemyPane) this._enemyPane.setAssetManager(am);
    if (this._playerSkillsPane) this._playerSkillsPane.setAssetManager(am);
    if (this._enemySkillsPane)  this._enemySkillsPane.setAssetManager(am);
    if (this._relicBar) this._relicBar.setAssetManager(am);
    if (this._enemyRelicBar) this._enemyRelicBar.setAssetManager(am);
    if (this._boardPanel) this._boardPanel.setAssetManager(am);
    if (this._combatLogPanel) this._combatLogPanel.assetManager = am;
    if (this._board) this._board.setAssetManager(am);
  }

  // ── Audio manager ───────────────────────────────────

  /**
   * Set the AudioManager reference so the scene can trigger music
   * based on battle state transitions.
   * @param {import('../audio/AudioManager.js').default} am
   */
  setAudioManager(am) {
    this._audioManager = am;
  }

  /**
   * React to battle state transitions for music playback.
   * Only fires on state *change*, not every frame.
   *
   * When ENABLE_PERSISTENT_BATTLE_MUSIC is true:
   *   - Uses the AudioManager battle music lifecycle API.
   *   - Normal battle music persists across scenes (battle → rewards → map).
   *   - Special encounter music stops after battle.
   *
   * When ENABLE_PERSISTENT_BATTLE_MUSIC is false:
   *   - Original behavior: music stops on GAME_OVER, restarts each battle.
   *
   * @param {string} currentState — BattleState enum value
   */
  _updateMusicFromState(currentState) {
    if (!this._audioManager) return;

    // No-op if state hasn't changed
    if (currentState === this._previousBattleState) return;
    this._previousBattleState = currentState;

    if (ENABLE_PERSISTENT_BATTLE_MUSIC) {
      this._updateMusicFromState_persistent(currentState);
    } else {
      this._updateMusicFromState_original(currentState);
    }
  }

  /**
   * Original music behavior (ENABLE_PERSISTENT_BATTLE_MUSIC = false).
   * Music stops on GAME_OVER, restarts fresh each battle.
   * @param {string} currentState
   */
  _updateMusicFromState_original(currentState) {
    switch (currentState) {
      case BattleState.PLAYER_TURN:
      case BattleState.ENEMY_TURN:
        // Ensure battle music is playing (fade in)
        this._audioManager.playMusic('battle_theme', { fadeIn: 600 });
        break;

      case BattleState.GAME_OVER:
        // Stop battle music with a short fade-out
        this._audioManager.stopMusic(400);
        break;

      default:
        // TURN_INTRO, RESOLVING, SWAPPING, TARGETING — no music change
        break;
    }
  }

  /**
   * Persistent music behavior (ENABLE_PERSISTENT_BATTLE_MUSIC = true).
   * Normal battle music continues across scenes; special music stops after battle.
   * @param {string} currentState
   */
  _updateMusicFromState_persistent(currentState) {
    const music = this._getMusicInfo();

    switch (currentState) {
      case BattleState.PLAYER_TURN:
      case BattleState.ENEMY_TURN:
        // Start/restore battle music via lifecycle API
        this._audioManager.startBattleMusic(music.trackKey, music.isSpecialTrack);
        break;

      case BattleState.GAME_OVER:
        // End battle — stop special music, or dim normal music
        this._audioManager.onBattleEnd(music.isSpecialTrack);
        break;

      default:
        // TURN_INTRO, RESOLVING, SWAPPING, TARGETING — no music change
        break;
    }
  }

  /**
   * Resolve music metadata for the current battle.
   * Reads from userData.music (set by MapScene) with a fallback to the default.
   * @returns {{ trackKey: string, isSpecialTrack: boolean }}
   */
  _getMusicInfo() {
    const music = (this.userData && this.userData.music) || {};
    return {
      trackKey: music.trackKey || DEFAULT_BATTLE_MUSIC_KEY,
      isSpecialTrack: music.isSpecialTrack || false,
    };
  }

  /**
   * Grant a chosen relic reward to the player's run state.
   *
   * Called by the RewardOverlay via its onRelicSelected callback when the
   * player clicks a reward option. The relic id is appended to
   * runState.relics (the same run-state object MapScene holds), so it is
   * resolved into the player's relics on the next battle via
   * createPlayerBattleState. The scene transition itself is handled
   * separately by the overlay's proceedToNextScene → onDismiss → _returnToMap.
   *
   * @param {object} relicDef — chosen relic definition (from the reward pool)
   * @param {number} rewardIndex — index of the chosen option (for logging/future use)
   */
  _grantRelicReward(relicDef, rewardIndex) {
    if (!relicDef || !relicDef.id) return;
    const runState = this.userData ? this.userData.runState : null;
    if (!runState) return;
    if (!Array.isArray(runState.relics)) runState.relics = [];

    // Guard against duplicates (reward pool already excludes owned relics,
    // but stay defensive in case of repeated grants).
    if (!runState.relics.includes(relicDef.id)) {
      runState.relics.push(relicDef.id);
    }
    console.log(`[BattleScene] Granted relic reward "${relicDef.id}" (option ${rewardIndex}).`);
  }

  /**
   * Show the post-victory LEVEL UP overlay. Builds the three attribute cards
   * (current → upgraded, from the run's effective stats + LEVEL_UP_GROWTH) and
   * begins the entrance. Picking a card applies the growth (_applyLevelUp) then
   * opens the reward overlay (_showRewardOverlay via onDismiss).
   */
  _showLevelUpOverlay() {
    if (!this._levelUpOverlay) { this._showRewardOverlay(); return; }
    const runState = this.userData ? this.userData.runState : null;
    const characterDef = runState ? getCharacterById(runState.characterId) : null;
    const eff = (characterDef && runState) ? getEffectivePlayerStats(characterDef, runState) : null;
    const current = eff
      ? { attack: eff.startingAttack, magic: eff.startingMagic, maxHp: eff.maxHp }
      : { attack: 0, magic: 0, maxHp: 0 };
    const cards = LEVEL_UP_CARDS.map((c) => ({
      ...c,
      current: current[c.key],
      upgraded: current[c.key] + (LEVEL_UP_GROWTH[c.key] || 0),
    }));
    this._levelUpOverlay.prepareLevelUp(cards);
    this._levelUpOverlay.show();
  }

  /**
   * Apply the chosen Level Up attribute to the persistent run state, then the
   * overlay's onDismiss opens the reward overlay.
   * @param {'attack'|'magic'|'maxHp'} key
   */
  _applyLevelUp(key) {
    const runState = this.userData ? this.userData.runState : null;
    const path = LEVEL_UP_STAT_PATH[key];
    const amount = LEVEL_UP_GROWTH[key];
    if (runState && path && amount) {
      runState.victories = (runState.victories || 0) + 1;
      applyRunModifier(runState, path, amount);
      console.log(`[BattleScene] Level Up: +${amount} ${key} (victory #${runState.victories}).`);
    }
  }

  /**
   * Auto-apply the character's per-victory growth plan to the persistent run
   * state. Replaces the player-chosen Level Up overlay — stat picking is disabled
   * (decision #36). Reads the character def's `growthPlan` (data/characters/*),
   * applies each stat via applyRunModifier, and bumps the victory counter. Called
   * on victory immediately before the reward overlay opens, so the reward cards
   * (and the next battle) see the post-growth effective stats.
   */
  _applyGrowthPlan() {
    const runState = this.userData ? this.userData.runState : null;
    if (!runState) return;
    const characterDef = getCharacterById(runState.characterId);
    const plan = (characterDef && characterDef.growthPlan) || DEFAULT_GROWTH_PLAN;
    runState.victories = (runState.victories || 0) + 1;
    const applied = [];
    for (const [path, amount] of Object.entries(plan)) {
      if (amount) {
        applyRunModifier(runState, path, amount);
        applied.push(`+${amount} ${path}`);
      }
    }
    console.log(`[BattleScene] Growth (victory #${runState.victories}): ${applied.join(', ') || 'none'}.`);
  }

  /**
   * Open the relic reward overlay (after the Level Up pick). Generates the
   * reward options excluding already-owned relics.
   */
  _showRewardOverlay() {
    if (!this._rewardOverlay) { this._returnToMap(); return; }
    const runState = this.userData ? this.userData.runState : null;
    const playerRelics = (this._battleController && this._battleController.playerState)
      ? this._battleController.playerState.relics || []
      : [];
    const ownedRelicIds = playerRelics.map((r) => r && r.id).filter(Boolean);
    const rewardRelics = generateRelicRewardOptions({ count: 3, playerRunState: runState, ownedRelicIds });
    // Player's CURRENT effective stats (post Level-Up) so each reward card shows
    // the relic's real stat-scaled `<<n>>` damage, not the base value.
    const characterDef = runState ? getCharacterById(runState.characterId) : null;
    const eff = (characterDef && runState) ? getEffectivePlayerStats(characterDef, runState) : null;
    const ownerStats = eff ? { attack: eff.startingAttack, magic: eff.startingMagic } : null;
    this._rewardOverlay.prepareRewards(rewardRelics, ownerStats);
    this._rewardOverlay.show();
  }

  /**
   * Transition back to the MapScene after battle ends.
   * Called when the reward overlay is dismissed (via onDismiss callback).
   * Calls _onBattleComplete so the map/run controller can update
   * node completion and reachability before the scene switch.
   */
  _returnToMap() {
    const sm = this._sceneManager;
    if (!sm) return;

    const mapData = this.userData || {};
    const mapScene = sm._scenes['MapScene'];

    // Determine battle result
    const winner = this._battleController
      ? this._battleController._winner()
      : (this._enemyData && this._enemyData.hp <= 0 ? 'player' : 'enemy');
    const nodeId = mapData.nodeId || null;

    // Playtest telemetry — no-op unless launched with ?metrics (see Metrics.js).
    this._recordBattleMetrics(winner, mapData);

    // Report battle completion to the run/map controller
    // This allows MapScene to mark the node as completed and update
    // reachability before the scene transition completes.
    if (this._onBattleComplete) {
      this._onBattleComplete({
        result: winner === 'player' ? 'victory' : 'defeat',
        nodeId,
      });
    }

    // Restore map state if available
    if (mapScene && mapData) {
      // Restore seed
      if (mapData.mapSeed) {
        mapScene.setSeed(mapData.mapSeed);
      }
      // Sync battle results back to run state (persistent HP)
      if (mapData.runState && this._battleController) {
        syncBattleResultsToRunState(mapData.runState, this._battleController.playerState);
        // Apply post-battle healing
        this._applyPostBattleHealing(mapData.runState, this._battleController.playerState);
        // NOTE: victory stat growth is now PLAYER-CHOSEN on the Level Up overlay
        // (_applyLevelUp), shown before the reward overlay — no auto-growth here.
        mapScene.setRunState(mapData.runState, null);
      }
    }

    // Fade transition back to MapScene
    sm.fadeToScene('MapScene', 200);

    console.log(`[BattleScene] Returning to MapScene (result: ${winner}, node: ${nodeId}).`);
  }

  /**
   * Debug: instantly win the current battle.
   * Only callable when DEBUG_MODE is true (checked in _handleKeyDown).
   * Sets enemy HP to 0, triggers GAME_OVER, and lets the normal
   * game-over → reward overlay → return-to-map flow handle the rest.
   */
  _debugWinBattle() {
    if (!this._battleController) return;

    // Only allow if battle is active (not already game over)
    if (this._battleController.state === BattleState.GAME_OVER) return;

    console.log('[BattleScene] DEBUG: Instantly winning battle via K key.');

    // Force enemy HP to 0
    this._battleController.enemyState.hp = 0;

    // Trigger game over check
    this._battleController._checkGameOver();

    // Add log message so it's visible what happened
    if (this._battleController.log) {
      this._battleController.log.add('[DEBUG] Battle force-won via K key.');
    }
  }

  /**
   * Apply post-battle healing to the run state's currentHp.
   * Heals 0% of max effective HP after a battle — HP persists as-is
   * between battles. Healing comes from in-battle skills (e.g. Oungan)
   * and rest-site nodes on the map.
   * @param {object} runState — player run state (mutated in place)
   * @param {object} playerBattleState — player state from the concluded battle
   */
  /**
   * DEPRECATED / UNUSED — superseded by the player-chosen Level Up overlay
   * (_showLevelUpOverlay / _applyLevelUp). Kept for reference; no longer called.
   * @param {object} runState — player run state (mutated in place)
   */
  _applyVictoryGrowth(runState) {
    if (!runState) return;
    runState.victories = (runState.victories || 0) + 1;
    applyRunModifier(runState, 'maxHp', HP_GROWTH_PER_VICTORY);
    let attackGranted = 0;
    if (runState.victories % ATTACK_GROWTH_EVERY_N_VICTORIES === 0) {
      applyRunModifier(runState, 'startingAttack', ATTACK_GROWTH_AMOUNT);
      attackGranted = ATTACK_GROWTH_AMOUNT;
    }
    console.log(`[BattleScene] Victory #${runState.victories} growth (placeholder): +${HP_GROWTH_PER_VICTORY} HP, +${attackGranted} Attack.`);
  }

  /**
   * Record a one-line battle snapshot for offline analysis (no-op unless the
   * game was launched with ?metrics). Captured at battle end, before the victory
   * growth is applied, so `victories` reflects progression ENTERING this fight.
   * Since HP fully resets each battle, `playerMaxHp - playerHp` = damage taken,
   * and `enemyMaxHp / turns` ≈ player DPT.
   * @param {string} winner — 'player' | 'enemy'
   * @param {object} mapData — this.userData (runState, node info)
   */
  _recordBattleMetrics(winner, mapData) {
    if (!Metrics.enabled) return;
    const ctrl = this._battleController;
    const ps = ctrl && ctrl.playerState;
    const e = this._enemyData || {};
    const rs = (mapData && mapData.runState) || {};
    Metrics.recordBattle({
      result: winner === 'player' ? 'victory' : 'defeat',
      characterId: rs.characterId || (ps && ps.className) || null,
      characterName: (ps && ps.name) || null,
      floor: (mapData && typeof mapData.nodeDepth === 'number' ? mapData.nodeDepth : 0) + 1,
      nodeType: (mapData && mapData.nodeType) || null,
      enemyId: e.id || null,
      enemyName: e.name || null,
      enemyMaxHp: typeof e.maxHp === 'number' ? e.maxHp : null,
      enemyAttack: typeof e.attack === 'number' ? e.attack : null,
      turns: (ctrl && ctrl.log) ? ctrl.log.turnNumber : null,
      playerHp: ps ? ps.hp : null,
      playerMaxHp: ps ? ps.maxHp : null,
      playerAttack: ps ? ps.attack : null,
      playerArmor: ps ? ps.armor : null,
      victories: rs.victories || 0,
      relicCount: Array.isArray(rs.relics) ? rs.relics.length : 0,
      relics: Array.isArray(rs.relics) ? rs.relics.slice() : [],
    });
  }

  _applyPostBattleHealing(runState, playerBattleState) {
    if (!runState || !playerBattleState) return;
    const healPct = 0.0;
    const healAmount = Math.floor(playerBattleState.maxHp * healPct);
    if (healAmount > 0) {
      runState.currentHp = Math.min(playerBattleState.maxHp, runState.currentHp + healAmount);
    }
  }

  // ── style passthrough ───────────────────────────────

  setStyle(props) {
    super.setStyle(props);
    if (props.debug !== undefined) {
      this._setDebugRecursive(props.debug);
    }
  }

  _setDebugRecursive(enabled) {
    // Applied externally via setDebugRecursive in main.js
  }
}
