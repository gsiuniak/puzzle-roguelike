/**
 * SoundConfig.js — Data-driven sound key definitions.
 *
 * Maps logical sound keys to their file paths and categories.
 * Audio files are expected under assets/audio/.
 *
 * Categories:
 *   music   — looping background tracks
 *   sfx     — gameplay sound effects (overlapping, one-shot)
 *   ui      — interface sounds (hover, click, etc.)
 *   ambient — ambient/environmental loops
 */

/** @enum {string} */
export const AudioCategory = {
  MASTER:  'master',
  MUSIC:   'music',
  SFX:     'sfx',
  UI:      'ui',
  AMBIENT: 'ambient',
};

/**
 * Shared SFX audio sprite — a single decoded MP3 holding every gameplay SFX
 * clip back-to-back, with an offset/duration map. One network fetch + one
 * decode for ALL the small one-shot sounds (instead of dozens of tiny files).
 *
 * The offset/duration map is NOT inlined here — it is loaded at runtime from
 * `jsonSrc` (Howler's native sprite format `{ name: [offsetMs, durationMs] }`,
 * the `sprite` field of that JSON). This means re-packing the sprite (which
 * shifts every offset) needs NO code change: drop in the new `.mp3` + `.json`
 * and the map is picked up automatically. The JSON's own `src` field points at
 * a generator-internal filename and is ignored — the real audio file is `src`
 * below.
 *
 * Individual SOUNDS entries opt into the sheet with `{ sprite: '<name>' }`
 * instead of `{ src: [...] }`; AudioManager plays them off this one Howl.
 */
export const SFX_SPRITE_SHEET = {
  key: 'sfx_sprite_sheet',
  src: ['assets/audio/sfx/sfx_audio_sprite.ogg'],
  jsonSrc: 'assets/audio/sfx/sfx_audio_sprite.json',
  category: AudioCategory.SFX,
};

/**
 * Second SFX audio sprite — the GENERIC effect pool. Same format/loading as
 * SFX_SPRITE_SHEET (its own Howl, offset map fetched from `jsonSrc`); both
 * sheets are loaded at init by AudioManager. These clips are organized by
 * effect (create/destroy/armor/convert/change/damage), some by tile color, with
 * multiple numbered versions. They back the SOUNDS entries auto-generated below
 * (`sfx_generic_*`) and are picked per woven skill by the synthesizer
 * (skillSynthesizer.pickSkillSound) at skill-creation time.
 */
export const SFX_GENERIC_SPRITE_SHEET = {
  key: 'sfx_generic_sprite_sheet',
  src: ['assets/audio/sfx/sfx_audio_generic_sprite.ogg'],
  jsonSrc: 'assets/audio/sfx/sfx_audio_generic_sprite.json',
  category: AudioCategory.SFX,
};

/**
 * Sound definition registry.
 * Each key maps to { src, category, options? }.
 *
 * src         — path(s) to audio file(s), relative to the HTML page
 * category    — AudioCategory value
 * options     — optional Howler.js constructor overrides (volume, rate, sprite, etc.)
 *               Overrides per-call options like loop/volume for music.
 */
const SOUNDS = {

  // ── Music ───────────────────────────────────────────────
  main_theme: {
    src: ['assets/audio/music/main_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.35,
      preload: true,
    },
  },
  battle_theme: {
    src: ['assets/audio/music/battle_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.15,
      preload: true,
    },
  },
  battle_theme_act_1_elite: {
    src: ['assets/audio/music/battle_theme_act_1_elite.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.15,
      preload: true,
    },
  },
  battle_theme_act_1_lord_malakor: {
    src: ['assets/audio/music/battle_theme_act_1_lord_malakor.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.15,
      preload: true,
    },
  },
  game_over_theme: {
    src: ['assets/audio/music/game_over_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.35,
      preload: true,
    },
  },
  skill_weave_theme: {
    src: ['assets/audio/music/skill_weave_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: true,
      volume: 0.35,
      preload: true,
    },
  },
  victory_theme: {
    src: ['assets/audio/music/victory_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: false,
      volume: 0.7,
      preload: true,
    },
  },
  defeat_theme: {
    src: ['assets/audio/music/defeat_theme.mp3'],
    category: AudioCategory.MUSIC,
    options: {
      loop: false,
      volume: 0.7,
      preload: true,
    },
  },

  // ── SFX — Gameplay ──────────────────────────────────────
  // Sprite-backed entries reference a clip in SFX_SPRITE_SHEET by name.
  sfx_match_3:      { sprite: 'match_3',      category: AudioCategory.SFX },
  sfx_match_4:      { sprite: 'match_4',      category: AudioCategory.SFX },
  sfx_match_5:      { sprite: 'match_5',      category: AudioCategory.SFX },
  sfx_skull_damage: { sprite: 'skull_damage', category: AudioCategory.SFX },
  sfx_tile_destroy: { sprite: 'tile_destroy', category: AudioCategory.SFX },
  // No clip in the sprite sheet — kept as a standalone file (currently unused
  // default for woven skills; file is absent on disk so it stays silent).
  sfx_skill_cast: {
    src: ['assets/audio/sfx/skill_cast.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_extra_turn: { sprite: 'extra_turn', category: AudioCategory.SFX },
  sfx_new_turn:   { sprite: 'new_turn',   category: AudioCategory.SFX },
  // No clip in the sprite sheet — standalone file (currently unreferenced).
  sfx_damage_taken: {
    src: ['assets/audio/sfx/damage_taken.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Skill resolve sounds (played when skill effect resolves, NOT on button click) ──
  // All sprite-backed — clip names match the SFX_SPRITE_SHEET entries.
  skill_bash:         { sprite: 'skill_bash',         category: AudioCategory.SFX },
  skill_defend:       { sprite: 'skill_defend',       category: AudioCategory.SFX },
  skill_slash:        { sprite: 'weapon_skill',       category: AudioCategory.SFX },
  skill_explode:      { sprite: 'skill_explode',      category: AudioCategory.SFX },
  skill_fracture:     { sprite: 'skill_fracture',     category: AudioCategory.SFX },
  skill_create_skull: { sprite: 'skill_create_skull', category: AudioCategory.SFX },
  skill_oungan:       { sprite: 'skill_oungan',       category: AudioCategory.SFX },

  // ── Enemy skill resolve sounds ──────────────────────────
  skill_doomsong:      { sprite: 'sfx_skill_doomsong',      category: AudioCategory.SFX },
  skill_ignition:      { sprite: 'sfx_skill_ignition',      category: AudioCategory.SFX },
  skill_boom_baby:     { sprite: 'sfx_skill_boom_baby',     category: AudioCategory.SFX },
  skill_encroach:      { sprite: 'sfx_skill_encroach',      category: AudioCategory.SFX },
  skill_boulder_throw: { sprite: 'sfx_skill_boulder_throw', category: AudioCategory.SFX },
  skill_smash:         { sprite: 'sfx_smash',               category: AudioCategory.SFX },
  skill_hound:         { sprite: 'sfx_hound',               category: AudioCategory.SFX },
  skill_infected_bite: { sprite: 'sfx_skill_infected_bite', category: AudioCategory.SFX },
  skill_cyst_burst:    { sprite: 'sfx_skill_cyst_burst',    category: AudioCategory.SFX },
  skill_frenzy:        { sprite: 'sfx_skill_frenzy',        category: AudioCategory.SFX },
  skill_charge:        { sprite: 'sfx_skill_charge',        category: AudioCategory.SFX },

  // Lord Malakor (Act 1 boss). NOTE: the Desecrate clip is misspelled
  // "descecrate" in the sprite sheet — the sprite name matches it; the key stays clean.
  skill_desecrate:    { sprite: 'sfx_skill_descecrate',  category: AudioCategory.SFX },
  skill_soul_burn:    { sprite: 'sfx_skill_soul_burn',   category: AudioCategory.SFX },
  skill_harvest:      { sprite: 'sfx_skill_harvest',     category: AudioCategory.SFX },
  // Thrall-harvest passive (Usurper's Heart), played when Thralls are reaped.
  sfx_thrall_harvest: { sprite: 'sfx_thrall_harvest',    category: AudioCategory.SFX },
  // Thrall-summon passive (Baron's Signet), played when Thralls are summoned.
  sfx_thrall_summon:  { sprite: 'sfx_thrall_summon',     category: AudioCategory.SFX },
  skill_exsanguinate: { sprite: 'sfx_skill_exsanguinate', category: AudioCategory.SFX },

  // ── Sanguine Phoenix (Act 1 elite) ──────────────────────
  // Two skill resolve sounds + two transform sounds. The "spawn" clip is
  // misspelled "sanguin" (no 'e') in the sprite sheet — the sprite name matches
  // it; the key stays clean (same handling as Lord Malakor's "descecrate").
  skill_anemic_feast: { sprite: 'sfx_skill_anemic_feast', category: AudioCategory.SFX },
  skill_blood_gorge:  { sprite: 'sfx_skill_blood_gorge',  category: AudioCategory.SFX },
  // Death→Egg transform (Sanguine Egg relic) and Egg→Phoenix rebirth
  // (Sanguine Chrysalis relic); played via the transform `sound` payloads.
  sfx_sanguine_egg_spawn: { sprite: 'sfx_sanguin_egg_spawn',  category: AudioCategory.SFX },
  sfx_sanguine_egg_hatch: { sprite: 'sfx_sanguine_egg_hatch', category: AudioCategory.SFX },

  // ── Character Select ────────────────────────────────────
  character_select_pick:    { sprite: 'character_select_pick',    category: AudioCategory.SFX },
  character_select_confirm: { sprite: 'character_select_confirm', category: AudioCategory.SFX },

  // ── Map ─────────────────────────────────────────────────
  sfx_map_click_node:    { sprite: 'sfx_map_click_node',    category: AudioCategory.SFX },
  sfx_map_overlay_open:  { sprite: 'sfx_map_overlay_open',  category: AudioCategory.SFX },
  sfx_map_overlay_close: { sprite: 'sfx_map_overlay_close', category: AudioCategory.SFX },

  // ── Rewards ─────────────────────────────────────────────
  sfx_rewards_open: { sprite: 'sfx_rewards_open', category: AudioCategory.SFX },

  // ── Level Up ────────────────────────────────────────────
  sfx_show_level_up_panel: { sprite: 'sfx_show_level_up_panel', category: AudioCategory.SFX },
  sfx_confirm_level_up:    { sprite: 'sfx_confirm_level_up',    category: AudioCategory.SFX },

  // ── Skill Weave ("Weave a Power") ──────────────────────
  sfx_choose_tag:          { sprite: 'sfx_choose_tag',          category: AudioCategory.SFX },
  sfx_choose_tag_back:     { sprite: 'sfx_choose_tag_back',     category: AudioCategory.SFX },
  sfx_choose_tags_confirm: { sprite: 'sfx_choose_tags_confirm', category: AudioCategory.SFX },
  // Sustained crucible/beam loop (recipe complete, pre-confirm). Looped + stopped
  // by SkillWeaveScene via playSfx({loop:true}) / stopSfx.
  sfx_crucible: { sprite: 'sfx_crucible', category: AudioCategory.SFX },

  // ── UI ──────────────────────────────────────────────────
  ui_button_hover: {
    src: ['assets/audio/ui/button_hover.mp3'],
    category: AudioCategory.UI,
  },
  ui_button_click: {
    src: ['assets/audio/ui/button_click.mp3'],
    category: AudioCategory.UI,
  },
  ui_victory: {
    src: ['assets/audio/ui/victory_fanfare.mp3'],
    category: AudioCategory.UI,
  },
  ui_defeat: {
    src: ['assets/audio/ui/defeat_fanfare.mp3'],
    category: AudioCategory.UI,
  },

  // ── Ambient ─────────────────────────────────────────────
//   ambient_battle: {
//     src: ['assets/audio/ambient/battle_ambient2.mp3'],
//     category: AudioCategory.AMBIENT,
//     options: {
//       loop: true,
//       volume: 0.3,
//     },
//   },
};

// ── Generic SFX pool (SFX_GENERIC_SPRITE_SHEET) ─────────────
// Auto-register one sprite-backed SOUNDS entry per clip in the generic sheet.
// Each key === its sprite clip name (`sfx_generic_<clip>`). These are NOT wired
// to any fixed skill — the Skill Weave synthesizer picks one per woven skill
// (skillSynthesizer.pickSkillSound). Keep these clip lists in sync with
// sfx_audio_generic_sprite.json.
const GENERIC_SFX_CLIPS = [
  // create — by tile flavor, 2 versions each
  ...['red', 'blue', 'green', 'yellow', 'purple', 'skull', 'wild']
    .flatMap((c) => [1, 2].map((v) => `create_${c}_${v}`)),
  // destroy — 5 versions
  ...[1, 2, 3, 4, 5].map((v) => `destroy_${v}`),
  // armor — 2 versions
  ...[1, 2].map((v) => `armor_${v}`),
  // convert — 3 versions
  ...[1, 2, 3].map((v) => `convert_${v}`),
  // change (single-tile recolor) — 3 versions
  ...[1, 2, 3].map((v) => `change_${v}`),
  // damage — by tile color, 3 versions each
  ...['red', 'blue', 'green', 'yellow', 'purple']
    .flatMap((c) => [1, 2, 3].map((v) => `damage_${c}_${v}`)),
];
for (const clip of GENERIC_SFX_CLIPS) {
  const key = `sfx_generic_${clip}`;
  SOUNDS[key] = { sprite: key, category: AudioCategory.SFX };
}

export default SOUNDS;
