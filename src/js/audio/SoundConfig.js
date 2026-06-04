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
  sfx_match_3: {
    src: ['assets/audio/sfx/match_3.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_match_4: {
    src: ['assets/audio/sfx/match_4.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_match_5: {
    src: ['assets/audio/sfx/match_5.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_skull_damage: {
    src: ['assets/audio/sfx/skull_damage.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_tile_destroy: {
    src: ['assets/audio/sfx/tile_destroy.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_skill_cast: {
    src: ['assets/audio/sfx/skill_cast.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_extra_turn: {
    src: ['assets/audio/sfx/extra_turn.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_new_turn: {
    src: ['assets/audio/sfx/new_turn.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_tile_hover: {
    src: ['assets/audio/sfx/tile_hover2.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_damage_taken: {
    src: ['assets/audio/sfx/damage_taken.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Skill resolve sounds (played when skill effect resolves, NOT on button click) ──
  skill_bash: {
    src: ['assets/audio/sfx/skills/warrior/skill_bash.mp3'],
    category: AudioCategory.SFX,
  },
  skill_defend: {
    src: ['assets/audio/sfx/skills/warrior/skill_defend.mp3'],
    category: AudioCategory.SFX,
  },
  skill_slash: {
    src: ['assets/audio/sfx/weapon_skill.mp3'],
    category: AudioCategory.SFX,
  },
  skill_explode: {
    src: ['assets/audio/sfx/skills/mage/skill_explode.mp3'],
    category: AudioCategory.SFX,
  },
  skill_fracture: {
    src: ['assets/audio/sfx/skills/mage/skill_fracture.mp3'],
    category: AudioCategory.SFX,
  },
  skill_create_skull: {
    src: ['assets/audio/sfx/skills/general/skill_create_skull.mp3'],
    category: AudioCategory.SFX,
  },
  skill_oungan: {
    src: ['assets/audio/sfx/skills/witch_doctor/skill_oungan.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Enemy skill resolve sounds ──────────────────────────
  skill_doomsong: {
    src: ['assets/audio/sfx/skills/acolyte/sfx_skill_doomsong.mp3'],
    category: AudioCategory.SFX,
  },
  skill_ignition: {
    src: ['assets/audio/sfx/skills/goblin_sapper/sfx_skill_ignition.mp3'],
    category: AudioCategory.SFX,
  },
  skill_boom_baby: {
    src: ['assets/audio/sfx/skills/goblin_sapper/sfx_skill_boom_baby.mp3'],
    category: AudioCategory.SFX,
  },
  skill_encroach: {
    src: ['assets/audio/sfx/skills/chokeweed/sfx_skill_encroach.mp3'],
    category: AudioCategory.SFX,
  },
  skill_boulder_throw: {
    src: ['assets/audio/sfx/skills/cyclops/sfx_skill_boulder_throw.mp3'],
    category: AudioCategory.SFX,
  },
  skill_smash: {
    src: ['assets/audio/sfx/skills/cyclops/sfx_smash.mp3'],
    category: AudioCategory.SFX,
  },
  skill_hound: {
    src: ['assets/audio/sfx/skills/goresnout/sfx_hound.mp3'],
    category: AudioCategory.SFX,
  },
  skill_frenzy: {
    src: ['assets/audio/sfx/skills/orc_taskmaster/sfx_skill_frenzy.mp3'],
    category: AudioCategory.SFX,
  },
  skill_charge: {
    src: ['assets/audio/sfx/skills/orc_taskmaster/sfx_skill_charge.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Character Select ────────────────────────────────────
  character_select_pick: {
    src: ['assets/audio/sfx/character_select/character_select_pick.mp3'],
    category: AudioCategory.SFX,
  },
  character_select_confirm: {
    src: ['assets/audio/sfx/character_select/character_select_confirm.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Map ─────────────────────────────────────────────────
  sfx_map_click_node: {
    src: ['assets/audio/sfx/map/sfx_map_click_node.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_map_overlay_open: {
    src: ['assets/audio/sfx/map/sfx_map_overlay_open.mp3'],
    category: AudioCategory.SFX,
  },
  sfx_map_overlay_close: {
    src: ['assets/audio/sfx/map/sfx_map_overlay_close.mp3'],
    category: AudioCategory.SFX,
  },

  // ── Rewards ─────────────────────────────────────────────
  sfx_rewards_open: {
    src: ['assets/audio/sfx/rewards/sfx_rewards_open.mp3'],
    category: AudioCategory.SFX,
  },

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

export default SOUNDS;
