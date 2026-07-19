# Architecture Decisions

One file per decision, extracted from the old CLAUDE.md §7. These are the
**why** behind the design — load one when you need the rationale or the full
mechanism. The always-on rules distilled from them live in CLAUDE.md §3;
the working recipes live in `docs/guides/`.

| # | Decision | File |
|---|---|---|
| 1 | Skills use effects: [] array only. | [01-skills-use-effects-array-only.md](./01-skills-use-effects-array-only.md) |
| 2 | Skill sound is on the skill definition | [02-skill-sound-is-on-the-skill-definition.md](./02-skill-sound-is-on-the-skill-definition.md) |
| 3 | Tile destruction rewards use centralized resolveDestroyedTileRewards() | [03-tile-destruction-rewards-use-centralized-resolvedestroyedtilerewards.md](./03-tile-destruction-rewards-use-centralized-resolvedestroyedtilerewards.md) |
| 4 | Extra turns are non-cumulative retain-turn flags, ACTION-scoped. | [04-extra-turns-are-non-cumulative-retain-turn.md](./04-extra-turns-are-non-cumulative-retain-turn.md) |
| 5 | CharacterPane must be data-driven. | [05-characterpane-must-be-data-driven.md](./05-characterpane-must-be-data-driven.md) |
| 6 | Map generation is separate from map rendering. | [06-map-generation-is-separate-from-map-rendering.md](./06-map-generation-is-separate-from-map-rendering.md) |
| 7 | Local-lane constraint: | [07-local-lane-constraint.md](./07-local-lane-constraint.md) |
| 8 | MapView is shared | [08-mapview-is-shared.md](./08-mapview-is-shared.md) |
| 9 | BattleScene is created on demand | [09-battlescene-is-created-on-demand.md](./09-battlescene-is-created-on-demand.md) |
| 10 | MapScene is a singleton | [10-mapscene-is-a-singleton.md](./10-mapscene-is-a-singleton.md) |
| 11 | Enemy HP AND attack scale per floor in MapScene | [11-enemy-hp-and-attack-scale-per-floor.md](./11-enemy-hp-and-attack-scale-per-floor.md) |
| 12 | Music transitions are state-driven | [12-music-transitions-are-state-driven.md](./12-music-transitions-are-state-driven.md) |
| 13 | All one-shot visual/SFX flags | [13-all-one-shot-visual-sfx-flags.md](./13-all-one-shot-visual-sfx-flags.md) |
| 14 | Player stat architecture uses three-layer separation | [14-player-stat-architecture-uses-three-layer-separation.md](./14-player-stat-architecture-uses-three-layer-separation.md) |
| 15 | Stat resolution is centralized | [15-stat-resolution-is-centralized.md](./15-stat-resolution-is-centralized.md) |
| 16 | Rewards modify run modifiers, not base stats. | [16-rewards-modify-run-modifiers-not-base-stats.md](./16-rewards-modify-run-modifiers-not-base-stats.md) |
| 17 | HP resets to full each battle. | [17-hp-resets-to-full-each-battle.md](./17-hp-resets-to-full-each-battle.md) |
| 18 | Canvas uses DPR-aware rendering | [18-canvas-uses-dpr-aware-rendering.md](./18-canvas-uses-dpr-aware-rendering.md) |
| 19 | Post-battle flow: Level Up → Reward → map | [19-post-battle-flow-level-up-reward-map.md](./19-post-battle-flow-level-up-reward-map.md) |
| 20 | Enemy AI overrides are dispatch-based, not conditional. | [20-enemy-ai-overrides-are-dispatch-based-not.md](./20-enemy-ai-overrides-are-dispatch-based-not.md) |
| 21 | Skills and relics are id-referenced + catalog-resolved. | [21-skills-and-relics-are-id-referenced-catalog.md](./21-skills-and-relics-are-id-referenced-catalog.md) |
| 22 | Passive abilities are data-driven via PassiveSystem dispatch, not conditionals. | [22-passive-abilities-are-data-driven-via-passivesystem.md](./22-passive-abilities-are-data-driven-via-passivesystem.md) |
| 23 | Trigger dispatch points in BattleController: | [23-trigger-dispatch-points-in-battlecontroller.md](./23-trigger-dispatch-points-in-battlecontroller.md) |
| 24 | Static-modifier relics bypass event dispatch. | [24-static-modifier-relics-bypass-event-dispatch.md](./24-static-modifier-relics-bypass-event-dispatch.md) |
| 25 | Turn-start passive cascades resume the turn, they don't consume it. | [25-turn-start-passive-cascades-resume-the-turn.md](./25-turn-start-passive-cascades-resume-the-turn.md) |
| 26 | Turn-scoped debuffs (Silence, Exsanguinate) live on the combatant state and tick at the END of the debuffed side's own turn. | [26-turn-scoped-debuffs-live-on-the-combatant.md](./26-turn-scoped-debuffs-live-on-the-combatant.md) |
| 27 | Defeat routes to a dedicated GameOverScene, not the RewardOverlay. | [27-defeat-routes-to-a-dedicated-gameoverscene-not.md](./27-defeat-routes-to-a-dedicated-gameoverscene-not.md) |
| 28 | Boss fights can be prefaced by a video cutscene, and battle backgrounds are data-driven. | [28-boss-fights-can-be-prefaced-by-a.md](./28-boss-fights-can-be-prefaced-by-a.md) |
| 29 | Descriptions support data-driven inline keywords with chained tooltips. | [29-descriptions-support-data-driven-inline-keywords-with.md](./29-descriptions-support-data-driven-inline-keywords-with.md) |
| 30 | Thrall wild tiles + Baron's Signet harvest are fully data-driven (the Act 1 boss engine). | [30-thrall-wild-tiles-baron-s-signet-harvest.md](./30-thrall-wild-tiles-baron-s-signet-harvest.md) |
| 31 | The "Weave a Power" skill reward is a layered-RNG tag draft + a synthesis step — all randomness/data lives outside the scene. | [31-the-weave-a-power-skill-reward-is.md](./31-the-weave-a-power-skill-reward-is.md) |
| 32 | Status effects (buffs/debuffs) are a general, data-driven system; their durations tick by TURN CYCLE. | [32-status-effects-are-a-general-data-driven.md](./32-status-effects-are-a-general-data-driven.md) |
| 33 | Spell icons for woven skills are COMPOSITED at runtime from authored spritesheet layers, deterministic per spell. | [33-spell-icons-for-woven-skills-are-composited.md](./33-spell-icons-for-woven-skills-are-composited.md) |
| 34 | Magic stat + per-effect damage scaling + [[phys]]/[[mag]] damage-type keywords + <<n>> live-value markup. | [34-magic-stat-per-effect-damage-scaling-phys.md](./34-magic-stat-per-effect-damage-scaling-phys.md) |
| 35 | Woven (Skill Weave) damage scales, with two damage TYPE tags, a Greater amplifier, and live <<n>> descriptions. | [35-woven-damage-scales-with-two-damage-type.md](./35-woven-damage-scales-with-two-damage-type.md) |
| 36 | Post-victory growth is AUTO-applied per character via a per-victory growthPlan — stat PICKING DISABLED (updated 2026-06-23). | [36-post-victory-growth-is-auto-applied-per.md](./36-post-victory-growth-is-auto-applied-per.md) |
| 37 | Mid-battle enemy TRANSFORM is a general, data-driven identity swap (the Sanguine Phoenix engine). | [37-mid-battle-enemy-transform-is-a-general.md](./37-mid-battle-enemy-transform-is-a-general.md) |
| 38 | Barrier is a one-round MAGIC shield (an armor-like numeric pool), NOT a status. | [38-barrier-is-a-one-round-magic-shield.md](./38-barrier-is-a-one-round-magic-shield.md) |
| 39 | Poison is a numeric STACK pool (the Witch Doctor's identity), NOT a duration status. | [39-poison-is-a-numeric-stack-pool-not.md](./39-poison-is-a-numeric-stack-pool-not.md) |
| 40 | Six new weave mechanics — transmute, consume, leech, mark, lock, reflect. | [40-six-new-weave-mechanics-transmute-consume-leech.md](./40-six-new-weave-mechanics-transmute-consume-leech.md) |
| 41 | Damage feedback is an accumulating per-side COUNTER (not per-hit text); mana matches fly whispy streams to the mana orbs. | [41-damage-feedback-is-an-accumulating-per-side.md](./41-damage-feedback-is-an-accumulating-per-side.md) |
| 42 | Match-4+ resolves get an emphasis "freeze" beat + board-darken flourish. | [42-match-4-resolves-get-an-emphasis-freeze.md](./42-match-4-resolves-get-an-emphasis-freeze.md) |
| 43 | BattleController rework (2026-07): one cast pipeline, an effect-handler registry, and simulation-based board AI. | [43-battlecontroller-rework-one-cast-pipeline-an-effect.md](./43-battlecontroller-rework-one-cast-pipeline-an-effect.md) |
| 44 | Enemies show their relics as "PASSIVES" in the skills pane, not in a relic bar (players unchanged). | [44-enemies-show-their-relics-as-passives-in.md](./44-enemies-show-their-relics-as-passives-in.md) |
| 45 | The in-game hint system plays the TRAINED CHAMPION (2026-07-08): full-action suggestions via the promoted formula policy, presented with a gauntlet cursor + banner. | [45-the-in-game-hint-system-plays-the.md](./45-the-in-game-hint-system-plays-the.md) |
| 46 | Fungal tiles are TIMED, GREEN-AFFINE board threats; the timer is encoded in the TYPE ID; relics can watch BOTH sides' events (anySide) — the Blight Warden engine (2026-07-10). | [46-fungal-tiles-are-timed-green-affine-board.md](./46-fungal-tiles-are-timed-green-affine-board.md) |
| 47 | `condition.side` gate for `anySide` passive effects — react to the OPPONENT only, in data | [47-condition-side-gate-for-anyside-passive-effects.md](./47-condition-side-gate-for-anyside-passive-effects.md) |
| 48 | Enemy ARMOR scales per floor like HP, on the SAME curve (in-battle armor gains stay flat) — 2026-07-16 | [48-enemy-armor-scales-per-floor-like-hp.md](./48-enemy-armor-scales-per-floor-like-hp.md) |
| 49 | `condition.everyN` is a STATEFUL counter gate (fire every Nth event, then reset); RelicBar shows the live count as an icon badge — the Hourglass engine (2026-07-16) | [49-condition-everyn-is-a-stateful-counter-gate.md](./49-condition-everyn-is-a-stateful-counter-gate.md) |
| 50 | Retaliation relics are recursion-capped: per-side `_reactDepth` guard (mirrors the sim's `_reactGuard`) + `condition.isSkull` gate on Bone Armor — the Thorned Rose stack-overflow fix (2026-07-16) | [50-retaliation-relics-are-recursion-capped.md](./50-retaliation-relics-are-recursion-capped.md) |
| 51 | Render DPR is capped at 2 (`MAX_RENDER_DPR` in main.js → CanvasApp `maxDpr`); `?dprcap` URL override; never read raw `devicePixelRatio` in render code (2026-07-17) | [51-render-dpr-is-capped.md](./51-render-dpr-is-capped.md) |
| 52 | Music/ambient tracks decode ON DEMAND (`preload:false` + explicit `load()` kick) and unload on switch — only the playing track is ever decoded; SFX stay preloaded (2026-07-17) | [52-music-decodes-on-demand.md](./52-music-decodes-on-demand.md) |
| 53 | Cutscene/splash videos are OFFLINE-CACHED (CacheFirst + rangeRequests `game-videos` route + boot-time `videoCacheWarmer` fed by `videoManifest`) and video playback FAILS FAST (~4s watchdogs; errors remembered on the element) — the offline-PWA freeze fix (2026-07-18) | [53-cutscene-videos-are-offline-cached-and-fail-fast.md](./53-cutscene-videos-are-offline-cached-and-fail-fast.md) |
| 54 | GAME_OVER clears the match-4 hit-stop freeze at `_setState` (+ the scene's hit-stop hold exempts GAME_OVER) — a mid-flourish death can never deadlock the kill frame (2026-07-18) | [54-game-over-clears-the-match4-hit-stop-freeze.md](./54-game-over-clears-the-match4-hit-stop-freeze.md) |
| 55 | Match crediting is PER-TILE: a wild shared by overlapping runs pays out once (first match in scan order); raw run size still drives 4+ extra turns; inert matches never claim credit (2026-07-18) | [55-match-crediting-is-per-tile.md](./55-match-crediting-is-per-tile.md) |
