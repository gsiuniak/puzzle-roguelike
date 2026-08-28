# Assets & Audio

**Load this when:** adding or changing a sprite, spritesheet, icon (relic / skill / portrait / tile / status), sound effect, or music track — or when touching the build / PWA asset pipeline (Vite, service-worker caching, install icons).

Owning files:
- [`main.js`](../../src/js/main.js) — `ASSET_MAP`, `SPRITESHEET_MAP`, `ASSET_ALIASES` (the registration surface)
- [`AssetManager.js`](../../src/js/engine/AssetManager.js) — image loading/caching, spritesheet slicing, aliases, runtime canvases
- [`AudioManager.js`](../../src/js/audio/AudioManager.js) — Howler wrapper, SFX sprites, music lifecycle
- [`SoundConfig.js`](../../src/js/audio/SoundConfig.js) — sound key registry + sprite-sheet descriptors
- [`BattleMusicConfig.js`](../../src/js/audio/BattleMusicConfig.js) — persistent-battle-music flag
- [`vite.config.js`](../../vite.config.js) — optional distribution build + PWA

---

## Hard rules

1. **All asset keys are registered in [`main.js` ASSET_MAP](../../src/js/main.js).** Adding a new sprite requires adding it there.
   - **Exception (relic icons):** to add a relic icon, add the sprite to the `ui_spritesheet_relics` sheet — **no ASSET_MAP entry needed** (the per-relic PNG entries are gone).
   - Sheet sprites in general are registered by their **sprite name** automatically when the sheet is sliced; only standalone images need an ASSET_MAP entry.
2. **Sprite names in a spritesheet must be semantic.** The AssetManager slices by sprite name, so a sheet packed with opaque `sprite_N` names won't resolve (this bites the weave base/generic sheets especially — see below).
3. **A sliced sprite is an `HTMLCanvasElement`, not an `HTMLImageElement`.** Guard draws with `img.complete !== false` (NOT `img.complete`, which is `undefined` on a canvas).
4. **The SFX sprite offset map is NOT in code** — it is fetched from the JSON sidecar at runtime, so re-packing the sprite (which shifts every offset) needs NO code change: just drop in the new audio file + `.json`.
5. **New sounds need entries in [`SoundConfig.js`](../../src/js/audio/SoundConfig.js).**
6. Game `assets/` are referenced by **STRING path / runtime `fetch()`** (never Vite imports) so the build copies them verbatim and every runtime path resolves identically. Don't `import` an asset.

---

## Recipes

### Add a standalone sprite (image)
Add the key → path entry to `ASSET_MAP` in [`main.js`](../../src/js/main.js). It then flows through `assetManager.get(key)` / `getScaled(key, w, h)` / `UIImage`.

### Add a sprite to an existing spritesheet
Add the named sprite to the sheet (PNG + JSON sidecar). On `loadAll` it is sliced into its own offscreen canvas registered under its **sprite name** — no ASSET_MAP entry. If a consumer expects a different, stable key, add an alias (below).

### Add a relic icon
Add the sprite to `ui_spritesheet_relics`, named `relic_<id>` to match the `icon` key in [`relicCatalog.js`](../../src/js/data/relics/relicCatalog.js) / [`enemyRelicCatalog.js`](../../src/js/data/relics/enemyRelicCatalog.js). **No ASSET_MAP entry needed.**

### Add a new spritesheet
Register it in `SPRITESHEET_MAP` in [`main.js`](../../src/js/main.js) → `addSpriteSheet(sheetKey, imagePath, jsonPath, opts?)`. Options:
- `{ trim: true }` — crop each sprite to its non-transparent bounds (`_trimTransparent`). Only needed when the sheet isn't already alpha-trimmed upstream.
- `{ slice: false }` — skip per-sprite slicing entirely; only the full sheet registers under `sheetKey`. For sheets consumed WHOLE (e.g. the attack-animation sheets that `SpriteSheetAnimation` blits from directly).
- A sheet counts as ONE load-progress unit.

### Add an alias
Add to `ASSET_ALIASES` in [`main.js`](../../src/js/main.js) → `alias(aliasKey, targetKey)`. Lazily resolved at lookup time (`_resolveKey`, cycle-guarded) by `get`/`getScaled`/`isLoaded`, so an existing asset key can be re-pointed at a spritesheet sprite that only loads later.

### Add an SFX (sprite-backed)
Include the clip when re-packing the SFX sprite (so it lands in the `.ogg`/`.mp3` **and** the JSON's `sprite` map), then reference it in `SOUNDS` with `{ sprite: '<clipName>' }` (instead of `{ src }`). No offset code to edit.

### Add a standalone SFX / music track
Add a `{ src }` entry to `SOUNDS` in [`SoundConfig.js`](../../src/js/audio/SoundConfig.js) with its category (MUSIC / SFX / UI / AMBIENT). Standalone files (music, UI, the absent `sfx_skill_cast`/`sfx_damage_taken`) get their own Howl. Play via `AudioManager.playMusic('key')` / `AudioManager.playSfx('key')`.

### "Audio not playing"
Look first at [`AudioManager._play()`](../../src/js/audio/AudioManager.js); then [`SoundConfig.js`](../../src/js/audio/SoundConfig.js) and the skill's `.sound` field.

---

## AssetManager

[`src/js/engine/AssetManager.js`](../../src/js/engine/AssetManager.js) — `AssetManager`

Image loading/caching, pre-scaled offscreen canvases.

**Runtime canvases:** `registerCanvas(key, canvas)` registers a generated canvas (e.g. composited spell icons) under an asset key — flows through `get()`/`getScaled()`/`UIImage` like any image, no load-progress impact.

**Spritesheet support:** `addSpriteSheet(sheetKey, imagePath, jsonPath)` registers a packed PNG + JSON sidecar (`{ meta, sprites: { <name>: {x,y,w,h} } }`); on `loadAll` the sheet is fetched and every named sprite is sliced into its OWN offscreen canvas registered under its sprite name. **Sliced sheets are NOT retrievable under `sheetKey` afterwards** — the full sheet Image is released once slicing ends (keeping it doubled every sheet's memory for the page lifetime); only `slice: false` sheets register the full image under `sheetKey`, because that is their only access path. Since a canvas is a drop-in for an Image in `drawImage`/`.width`/`.height`, sliced sprites flow through `get()`/`getScaled()`/`UIImage` like standalone images — no consumer special-casing. Counts as ONE load-progress unit per sheet. An optional `{ trim: true }` 4th arg makes AssetManager crop each sprite to its non-transparent bounds (`_trimTransparent`) — only needed when the sheet isn't already alpha-trimmed upstream. An optional **`{ slice: false }`** skips per-sprite slicing entirely (only the full sheet registers under `sheetKey`) — for sheets consumed WHOLE, like the attack-animation sheets `SpriteSheetAnimation` blits from directly.

**Aliases:** `alias(aliasKey, targetKey)` registers a lazy alias resolved at lookup time (`_resolveKey`, cycle-guarded) by `get`/`getScaled`/`isLoaded`, so an existing asset key can be re-pointed at a spritesheet sprite that only loads later. Registered via `SPRITESHEET_MAP` (+ `ASSET_ALIASES`) in [`main.js`](../../src/js/main.js).

### Spritesheet catalogue

- **`ui_spritesheet_skill_weave_icons`** (`trim:false` — packer emits tight per-glyph frames; skill-weave tag icons `weave_icon_<id>`, wired into [`skillWeaveTags.js`](../../src/js/data/skillWeaveTags.js) tag `icon` fields; rendered via `SkillWeaveScene._paintIcon` height-fit + center)

- **`ui_spritesheet_tiles`** (board tile gems + `wild_tile_border` + the `grid_dark`/`grid_light` board background tiles; gem sprites named `<color>_tile`/`diseased_tile`/`thrall_tile`/`wild_tile`, aliased onto the board's `tile_<type>` keys via `ASSET_ALIASES` — `wild_tile_border`/`grid_dark`/`grid_light` match their names so need no alias; board stretches each to the cell so trimmed frames render consistently)

- **`ui_spritesheet_character_pane`** (battle character/skills pane art: `character_pane_panel`, `character_pane_flair` (the symmetric under-name flourish), `character_pane_health_bar_overlay` (the ornate transparent-center frame drawn over the pane's HP bar), `character_pane_health_bar_fill` (the authored glossy HP-bar fill art, revealed to the filled fraction via `UIProgressBar.fillAssetKey`), `skill_pane_panel`, `skills_button`, `skills_locked_icon`, `icon_attack`/`icon_block`/`icon_barrier` (the Barrier shield-badge icon, decision #38), `mana_<color>` + `mana_<color>_simple`, `mana_amount`, plus the targeting controls `ui_skill_confirm` / `ui_skill_cancel` (the battle Cast/Cancel buttons drawn by [`BattleScene`](../../src/js/ui/BattleScene.js)) — sprite names match their existing keys directly, so no aliases; `skills_locked_button` is NOT in the sheet and stays a standalone PNG)

- **Battle portrait sheets `ui_spritesheet_player_portraits`** (3: `warrior`/`mage`/`witch_doctor`) **+ `ui_spritesheet_enemy_portraits`** (12) — sprites are named `<id>_portrait_floating`, so `ASSET_ALIASES` remaps the stable `portrait_<id>` keys [`CharacterInfoPane`](../../src/js/ui/CharacterInfoPane.js) requests onto them (mostly 1:1; `portrait_sanguine_phoenix_egg`→`sanguine_egg_portrait_floating` + `portrait_chokeweed`→`chokeweed_sapper_portrait_floating` diverge; orc/shadow_weaver/stone_gargoyle have no sprite → placeholder fallback). (CharacterSelect uses its own separate `character_select_portrait_*`/`_splash_*` keys, unaffected.)

- **Skill-icon sheets `ui_spritesheet_player_skills`** (6) **+ `ui_spritesheet_enemy_skills`** (16) — sprite names match the `skill_<id>` `icon` keys in [`skillCatalog.js`](../../src/js/data/skills/skillCatalog.js) directly (no aliases); they also added dedicated icons for skills that previously reused placeholders, now all wired to their skills: `skill_charge`/`skill_frenzy` (Orc Taskmaster), `skill_boulder_throw`/`skill_smash` (Cyclops), `skill_boom_baby`/`skill_ignition` (Goblin Sapper), `skill_doomsong` (Acolyte).

- **`ui_spritesheet_animated_text`** (3: `animated_text_player_turn`/`_enemy_turn`/`_extra_turn` — the turn-announcement art spawned by [`BattleScene`](../../src/js/ui/BattleScene.js) as `FloatingImageEffect`s; names match directly, no aliases; BattleScene sizes them by the sliced image's own aspect so trimmed frames aren't distorted)

- **`ui_spritesheet_skill_weave_elements`** (10: the [`SkillWeaveScene`](../../src/js/scenes/SkillWeaveScene.js) `ui_skill_weave_*` container/button/selection plaques incl. the rarity option containers + wide recipe container; names match directly, no aliases. `skill_weave_background` + the `skill_weave_tag_test` default tag icon are NOT in the sheet and stay standalone PNGs)

- **The spell-icon compositing sheets `ui_spritesheet_weave_base`** (circular colored mana orbs, `<color>_base[_n]`) **+ `ui_spritesheet_weave_generic`** (white effect foreground sprites `foreground_<tag>[_n]` + `icon_border_2`) — NOT screen UI; fetched by sprite name at icon render time by the spell-icon compositor; **sprite names MUST be semantic** (opaque `sprite_N` won't resolve).

- **`ui_spritesheet_reward_screen_elements`** (13: the [`RewardOverlay`](../../src/js/ui/RewardOverlay.js)/[`RewardOptionPanel`](../../src/js/ui/RewardOptionPanel.js) art — `relics_pane_panel_<rarity>` ×4 (per-rarity card frames with baked rarity-colored gems/trim; replaced the old single `rewards_option_panel_vertical`), `rewards_title_panel`, `reward_divider_<rarity>` ×4, `rewards_button_confirm`(`_hover`)/`rewards_button_skip`(`_hover`); names match directly, no aliases. `reward_screen_panel`/`reward_victory_text`/`rewards_option_panel`/`rewards_background_splash` are NOT in the sheet and stay standalone)

- **`ui_spritesheet_map_elements`** (8: the [`MapRenderer`](../../src/js/map/MapRenderer.js) node icons `map_icon_battle`/`_elite`/`_chest`/`_train`/`_rest`/`_boss` + 2 not-yet-wired extras `map_icon_boss_malakor`/`_boss_empty`; names match directly, no aliases. `map_splash` stays standalone)

- **Character-select sheets `ui_spritesheet_character_select_elements`** (12: `character_select_info_panel`/`_heart`/`_flair_left`/`_flair_right`/`_divider` + `_choose_hero_button`(`_hover`) + the Growth-section art `character_select_growth_fill`/`_growth_outline` (filled/empty blip diamonds) + `_growth_flair_left`/`_growth_flair_right`/`_growth_flair_bottom` (title + bottom flourishes)) **+ `ui_spritesheet_character_select_portraits`** (3: `character_select_portrait_warrior`/`mage`/`witch_doctor`) — names match directly, no aliases; the large `character_select_splash_*` backgrounds stay standalone `.jpg`s.

- **`ui_spritesheet_relics`** (60: every `relic_<id>` icon referenced by [`relicCatalog.js`](../../src/js/data/relics/relicCatalog.js) + [`enemyRelicCatalog.js`](../../src/js/data/relics/enemyRelicCatalog.js), drawn contain-fit by [`RelicBar`](../../src/js/ui/RelicBar.js) / [`RewardOptionPanel`](../../src/js/ui/RewardOptionPanel.js); names match directly, no aliases; 2 spares `relic_potion_skull`/`relic_blood_lancet` not yet referenced). **To add a relic icon, add the sprite to this sheet — no ASSET_MAP entry needed** (the per-relic PNG entries are gone).

- **`ui_spritesheet_status_effects`** (9: the buff/debuff overlay art `buff_intangible`/`_berserk`/`_barrier` (tall crests — `buff_barrier` is now UNUSED since Barrier is no longer a status, see decision #38) + `debuff_silenced`/`_crippled`/`_enfeebled`/`_brittle`/`_bleeding`/`_frozen` (wide crossed-blade X overlays); sprite names match the `icon` keys in [`statusEffects.js`](../../src/js/data/statusEffects.js) directly, no aliases; drawn over the portrait by [`CharacterInfoPane`](../../src/js/ui/CharacterInfoPane.js))

- **`ui_spritesheet_combat_damage`** — the damage-counter glyph sheet: the "DAMAGE / CHAIN X" label images `ui_animated_text_damage_chain_single_digit` / `ui_animated_text_damage_chain_double_digit` (plaque-width variants picked by the chain count's digit count) + per-digit glyphs `digit_0`…`digit_9` (reused for BOTH the big damage total and the chain count). Consumed by [`DamageCounterEffect`](../../src/js/ui/DamageCounterEffect.js), which takes the AssetManager in its ctor.

- **`ui_spritesheet_level_up_screen_elements`** — the [`LevelUpOverlay`](../../src/js/ui/LevelUpOverlay.js) art (`ui_level_up_container_panel` / `_attribute_panel` / `_flair_left` / `_flair_right`).

- **Attack-animation sheets `ui_spritesheet_<char>_attack_animation`** — registered with **`slice: false`** (the animation reads the FULL sheet; slicing would allocate ~50-60 large per-frame canvases nothing reads). Every registered sheet is downloaded + decoded + PINNED resident at boot (~50 MB each) — if a character's animation is disabled long-term, comment its SPRITESHEET_MAP entry out too to save the download + pinned memory. Playback/trim/first-play-stutter details live with [`SpriteSheetAnimation`](../../src/js/ui/SpriteSheetAnimation.js) (see the UI guide); [`main.js`](../../src/js/main.js) warms ALL attack-animation sheets at BOOT — after `assetManager.loadAll()` resolves it calls `SpriteSheetAnimation.preload` for every `*_attack_animation` key in SPRITESHEET_MAP.

### Consumer caveat for sliced sprites

A sprite is an `HTMLCanvasElement`, not an `HTMLImageElement`, so guard draws with `img.complete !== false` (NOT `img.complete`, which is `undefined` on a canvas) — MapRenderer's icon draw was updated for this, and it contain-fits by the sprite's own aspect so non-square trimmed icons (the boss) aren't distorted. (MapView's `map_splash` guard still uses `.complete` correctly — the splash stays a standalone `.jpg` Image, not a sheet sprite.)

---

## Audio

### AudioManager — [`src/js/audio/AudioManager.js`](../../src/js/audio/AudioManager.js) (singleton)

Howler.js wrapper: music playback with fade in/out, SFX one-shots, per-category volume, mute/unmute.

**Music decodes on demand (decision #52):** MUSIC/AMBIENT entries are created with `preload: false`; `playMusic`/`_play` kick `howl.load()` explicitly when unloaded (Howler's `play()` on an unloaded howl only queues — it never starts the load), and `_teardownMusicHowl` unloads the outgoing track after its crossfade and swaps a fresh lazy Howl back into the registry. Only the playing track (plus the outgoing one mid-fade) is ever decoded — previously ALL tracks decoded at boot (~450–500 MB of PCM). SFX (sprites + standalone) stay preloaded for latency.

**SFX audio sprite:** `init()` binds every sound def, then `_loadSpriteSheet(SFX_SPRITE_SHEET)` **asynchronously fetches the offset/duration map from `sheet.jsonSrc`** (`assets/audio/sfx/sfx_audio_sprite.json`) and builds ONE shared Howl over `sfx_audio_sprite.ogg` — every gameplay SFX clip packed back-to-back. **The map is NOT inlined in code** — it's read from the JSON at runtime, so re-packing the sprite (which shifts all offsets) needs NO code change; just drop in the new audio file + `.json`. (The JSON's own `src` field is a generator-internal name and is ignored — only `sheet.src` is used.) SOUNDS entries opt in with `{ sprite: '<clipName>' }` (instead of `{ src }`); `loadSound` records the key → clip name in `_spriteNames`, and once the Howl finishes loading the bindings are backfilled into `_sounds` (so `has()`/`stopSfx()` resolve a Howl while `_play` dispatches `howl.play(spriteName)`).

**Multiple sprite sheets coexist:** `init` also loads `SFX_GENERIC_SPRITE_SHEET` (`sfx_audio_generic_sprite` — the woven-skill effect pool) as a SECOND Howl; `_loadSpriteSheet` builds a per-sheet local Howl and backfills only the keys whose clip name is in THAT sheet's map (each key routes to its own sheet's Howl via `_sounds`; `_spriteHowl` retains the FIRST sheet as primary). Sprite load is fire-and-forget (no SFX during the boot/loading screen); a too-early `playSfx` just warns. Standalone files (music, UI, the absent `sfx_skill_cast`/`sfx_damage_taken`) still get their own Howl.

**SFX:** `playSfx(key, {volume, rate, loop})` returns a Howl play id; `stopSfx(key, id?, fadeOut?)` stops a specific instance (e.g. a looping sprite sound like `sfx_crucible` — pass the id) or every instance of the key (omit id), with optional fade-out — **for sprite-backed keys an id is REQUIRED** (omitting it would stop the shared sheet = every SFX, so it warns and no-ops instead).

**SFX freeze (hit-stop):** every SFX play is tracked in `_activeSfx` (id → {howl, key}, lazily pruned via `howl.playing(id)` — no per-play 'end' listeners); `pauseSfxExcept(exceptKeys)` pauses every in-flight SFX instance BY PLAY ID (so sprite-backed clips freeze without touching their shared-Howl siblings; music/ambient untouched) and `resumeFrozenSfx()` resumes them in place — used by BattleScene's match-4+ hit-stop (decision #42) to freeze all audio except the flourish SFX.

**Track switches cross-fade:** `playMusic(key, {fadeIn, fadeOut, volume})` fades the OUTGOING track out (default `fadeOut` = `fadeIn` or `MUSIC_FADE_DURATION`) while the new one fades in — every transition is a natural fade-out → fade-in. `_currentMusicBaseVolume` is tracked so the manual MP3 loop-restart holds the current (possibly background-faded) volume instead of snapping back.

**Persistent battle-music lifecycle** (`startBattleMusic`/`onBattleEnd`/`onRewardsOrMapEntered`, gated by `ENABLE_PERSISTENT_BATTLE_MUSIC` in [`BattleMusicConfig.js`](../../src/js/audio/BattleMusicConfig.js)): battle music — including the non-special elite theme — persists across battle→rewards→map at background volume; the NEXT battle's `startBattleMusic` cross-fades to that fight's track naturally as it loads. Truly-special tracks (`isSpecialTrack: true`) stop after battle instead.

### SoundConfig — [`src/js/audio/SoundConfig.js`](../../src/js/audio/SoundConfig.js) (module)

Sound key→`{src | sprite, category, options}` registry. Categories: MUSIC, SFX, UI, AMBIENT.

Also exports **`SFX_SPRITE_SHEET`** (`{ key, src:['assets/audio/sfx/sfx_audio_sprite.ogg'], jsonSrc:'assets/audio/sfx/sfx_audio_sprite.json' }`) — the shared gameplay-SFX audio sprite. **The offset map is NOT in code** — AudioManager fetches it from `jsonSrc` at runtime (Howler-native `{ name:[offsetMs,durationMs] }` under the JSON's `sprite` key), so a re-pack is a pure asset swap (new `.mp3` + `.json`, no code edit). Most SFX entries are `{ sprite:'<clipName>' }` and play off that one Howl (see AudioManager); `sfx_skill_cast`/`sfx_damage_taken` have no clip and stay `{ src }`.

**To add a sprite-backed SFX:** include the clip when re-packing the sprite (so it lands in the `.mp3` + the JSON's `sprite` map), then reference it with `{ sprite:'<clipName>' }`.

Also exports **`SFX_GENERIC_SPRITE_SHEET`** (`sfx_audio_generic_sprite.ogg` + `.json`) — the GENERIC effect pool (create/destroy/armor/convert/change/damage clips, some per-color, with numbered versions). One sprite-backed `sfx_generic_<clip>` SOUNDS entry per clip is **auto-generated** at the bottom of the module from `GENERIC_SFX_CLIPS` (keep that list in sync with the sheet JSON); they're wired to no fixed skill — the Skill Weave synthesizer (`skillSynthesizer.pickSkillSound`) picks one per woven skill at creation time.

### Audio usage pattern

Scenes call `AudioManager.playMusic('key')` / `AudioManager.playSfx('key')`. Skill resolve sounds are set by BattleController via `_setSkillSound(skill)` and played by BattleScene when `pendingSkillSound` is present in state.

---

## Build & asset pipeline (Vite/PWA)

**Build:** No bundler is REQUIRED — the game runs raw by serving the project and opening [`src/index.html`](../../src/index.html) (native ES modules + relative asset paths, no build step). This is still the primary dev/serve flow. Root `package.json` sets `"type": "module"` so node tooling (`sim/` scripts/tests) can import the `src/js` ES modules directly.

**Optional Vite build (for distribution):** [`vite.config.js`](../../vite.config.js) adds an ADDITIVE build that does NOT change raw serving — `npm run build` → a minified, **PWA**-enabled `dist/` (installable on mobile/desktop; offline via a service worker), `npm run dev` (HMR), `npm run preview` (serve `dist/`).

Key invariants:
- `root:'src'` (builds the same untouched `src/index.html`)
- `base:'./'` (works at a domain root AND a subpath like itch.io)
- game `assets/` are referenced by STRING path / runtime `fetch()` (not Vite imports) so they're copied to `dist/assets` VERBATIM (the `copyGameAssets` plugin) and every runtime path resolves identically; Vite's hashed output goes in a separate `bundle/` dir.
- PWA precaches only the JS/CSS/HTML shell and runtime-caches images/audio/fonts/json with **StaleWhileRevalidate** (serve cached instantly, re-fetch in the background so a changed/broken asset self-heals next visit — the game's assets live at STABLE, non-hashed URLs, so `CacheFirst` would pin a stale/broken copy; the SFX `.ogg` sprite + its `.json` offset map MUST share a strategy or they desync after a repack). Only `200`s are cached; the SW uses `cleanupOutdatedCaches`/`clientsClaim`/`skipWaiting` so a new deploy takes over promptly. Cutscene/splash `.mp4`s are **CacheFirst + `rangeRequests`** in the `game-videos` cache (decision #53): `<video>` elements fetch with Range headers and never reliably store a complete body themselves, so the boot sequence warms the cache instead — [`main.js`](../../src/js/main.js) fires [`warmVideoCache`](../../src/js/engine/videoCacheWarmer.js)`(collectRuntimeVideoUrls())` after `loadAll()` resolves (sequential full-body fetches; no-op without a controlling SW). The URL list comes from [`data/videoManifest.js`](../../src/js/data/videoManifest.js) — the exported `TITLE_SCREEN_VIDEOS` (the TitleScreen intro/transition movies, listed first since they play before anything else) plus the data catalogs (hero `splashVideo`s + enemy `introVideo`/`portraitVideo`) so a new hero/boss video is warmed automatically. CacheFirst pins a stale copy if a video's CONTENT changes at the same URL — rename the file when replacing a video.
- **Install icons** = [`src/assets/icons/`](../../src/assets/icons/) `icon-192.jpg` / `icon-512.jpg` (192/512 square; the 512 is also the maskable + iOS `apple-touch-icon` linked from `index.html`). JPEG is manifest-valid; swap to PNG by editing the manifest `type`/`src`.
- [`index.html`](../../src/index.html) has a self-contained **Install button** (`#install-btn`) wired to `beforeinstallprompt` — it reveals only when the browser deems the app installable (HTTPS + manifest + icon + SW) and is a no-op on raw http serve / iOS Safari.
- Same `dist/` output also feeds Electron (desktop) / Capacitor (mobile store apps) if ever wanted.

---

## Design decisions

- [#33 — Spell icons for woven skills are COMPOSITED at runtime from authored spritesheet layers](../decisions/33-spell-icons-for-woven-skills-are-composited.md) — the composited canvas registers into the AssetManager via `registerCanvas(key, canvas)` under `spell_icon_<hash>`; source sheets are `ui_spritesheet_weave_base` + `ui_spritesheet_weave_generic` (semantic sprite names required).
- [#28 — Boss fights can be prefaced by a video cutscene, and battle backgrounds are data-driven](../decisions/28-boss-fights-can-be-prefaced-by-a.md) — an enemy def's `background` is an ASSET_MAP key (register it); its `introVideo` is a URL, NOT an AssetManager entry (BossIntroScene owns its own `<video>`).
