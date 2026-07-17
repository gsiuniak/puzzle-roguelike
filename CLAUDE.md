# gems — Agent Entrypoint

> **This file is the ROUTER, not the encyclopedia.** It is loaded into every
> conversation, so it holds only what changes behavior on *any* task: the hard
> rules, the map of who owns what, and pointers to the depth.
>
> **The depth lives in [`docs/guides/`](docs/guides/) (how a subsystem works) and
> [`docs/decisions/`](docs/decisions/) (why it is that way).** Load the guide for the
> area you are touching *before* you edit. Do not inline their contents here.

---

## 1. Ground rules (read first)

- **This is WSL.** Linux commands only, project root `~/test/game/gems`. Never use
  PowerShell, never put `wsl.localhost` in a path.
- **Do NOT run or update the LEGACY `sim/` scripts** — `node sim/test-*.mjs`,
  `sim/run.mjs`, `sim/engine.mjs`, `sim/combat-balance-bench.html`. They are stale.
  The live tooling is `sim/toolbench/` → see [docs/guides/toolbench.md](docs/guides/toolbench.md).
- **Make the smallest change that solves the task.** Do not rebuild systems unless asked.
- **`old/` and `(old)/` directories are read-only.** So is `src/js/lib/howler.js` (third-party).

## 2. Project

**gems** — a match-3 puzzle roguelike. Vanilla JavaScript (ES modules), HTML5 Canvas,
Howler.js audio. **No build step is required**: serve the repo and open
[`src/index.html`](src/index.html) (native ES modules + relative asset paths). An
*additive* Vite build (`npm run build` → PWA-enabled `dist/`) exists for distribution
and does not change raw serving — see [docs/guides/assets-and-audio.md](docs/guides/assets-and-audio.md).

**Entry:** [`src/index.html`](src/index.html) → [`src/js/main.js`](src/js/main.js)

```
src/
  js/
    main.js       — boot: services, scene registry, game loop
    engine/       — framework services (canvas, loop, input, assets)
    scenes/       — scene lifecycle + SceneManager
    game/         — pure game logic (board, match resolution, battle, AI)
    map/          — roguelike map generation and traversal
    ui/           — UI framework + battle scene + visual effects + overlays
    audio/        — Howler-based audio manager + sound config
    data/         — gameplay data (characters, enemies, skills, relics, statuses)
    systems/      — cross-cutting battle systems (passives, effect resolver)
    icons/        — runtime-composited spell icons
  assets/         — sprites, audio, fonts, data (incl. formula-champion.json)
sim/toolbench/    — headless sim, balance bench, AI training (see the toolbench guide)
docs/             — guides (how) + decisions (why) + balance research
```

**Scene flow:**
```
LoadingScene → TitleScreen → CharacterSelectScene → MapScene ⇄ BattleScene
                     ↑              (roam)  │   (combat)
                     │                      │      ↓  victory: RewardOverlay → MapScene
                     │         (boss only)  │      ↓  defeat:  GameOverScene
                     │       BossIntroScene─┘
                     └──────(any input)────────────┘
                                            training node → SkillWeaveScene
```

## 3. Hard rules

Violate only when explicitly instructed.

1. **Keep rendering separate from game logic.** BoardModel/MatchResolver never touch
   canvas. Visuals live in BattleScene/BoardPlaceholder/MapRenderer.
2. **Keep UI data-driven.** Panes read from data objects; never hardcode character values.
3. **Skills use an `effects: []` array only.** Each effect has an `effectType` string
   (see [`SKILL_EFFECT_TYPES`](src/js/game/MatchResolver.js)). No other skill-resolution
   mechanism exists.
4. **Skills and relics are referenced by ID, not embedded.** Defs list `skills: ['bash']`;
   full data lives in the catalogs. Players and enemies draw relics from **two separate
   pools** that never mix ([`relicCatalog.js`](src/js/data/relics/relicCatalog.js) vs
   [`enemyRelicCatalog.js`](src/js/data/relics/enemyRelicCatalog.js)) — that is how enemy
   relics stay out of the player reward pool.
5. **Passives are data-driven via PassiveSystem.** Never write `if (relic.id === 'X')` in
   battle logic. Dispatch a trigger; the effect is data.
6. **All damage funnels through `BattleController._applyDamage()`.** Never call
   `this.resolver.applyDamage(...)` directly from BattleController.
7. **All stat math goes through [`playerStats.js`](src/js/data/playerStats.js).** Never
   scatter `base + modifier` math elsewhere.
8. **Character definitions are immutable.** Never mutate `baseStats`. Run progression goes
   in `runState.statModifiers` via `applyRunModifier()`.
9. **Extra turns are non-cumulative, action-scoped retain-turn flags.** Set
   `_extraTurnEarned`; don't stack.
10. **All asset keys are registered in [`main.js`](src/js/main.js)** (`ASSET_MAP` /
    `SPRITESHEET_MAP` / `ASSET_ALIASES`). Exception: relic icons — just add the sprite to
    the `ui_spritesheet_relics` sheet.
11. **Map generation is separate from map rendering.** MapGenerator builds the graph;
    MapRenderer/MapView draw it.

## 4. Where things live — load the guide before you edit

| You are touching… | Load |
|---|---|
| Battle logic, skill effects, turn flow, damage, cascade, statuses, board AI | [docs/guides/battle-system.md](docs/guides/battle-system.md) |
| Any scene, UI element, overlay, visual effect, battle layout, tooltips | [docs/guides/ui-and-scenes.md](docs/guides/ui-and-scenes.md) |
| Adding/editing a character, enemy, skill, relic, status, tile, keyword, enemy AI | [docs/guides/content-authoring.md](docs/guides/content-authoring.md) |
| Map, run state, player stats, floor scaling, rewards, character select | [docs/guides/run-and-progression.md](docs/guides/run-and-progression.md) |
| Skill Weave — tag draft, synthesis rules, weave RNG, spell icons | [docs/guides/skill-weave.md](docs/guides/skill-weave.md) |
| Sprites, spritesheets, aliases, sounds, music, the Vite/PWA build | [docs/guides/assets-and-audio.md](docs/guides/assets-and-audio.md) |
| Balance sims, AI training/measurement, anything under `sim/toolbench/` | [docs/guides/toolbench.md](docs/guides/toolbench.md) |

**Why something is the way it is** → [docs/decisions/](docs/decisions/) (50 records, one per
decision, indexed in its [README](docs/decisions/README.md)). Guides link the relevant ones.

**Balance research** → [docs/balance-power-model.md](docs/balance-power-model.md) (master
reference), plus the other `docs/balance-*.md` files.

### Cross-cutting maintenance contracts

- **Enemy floor-scaling curves** (`ENEMY_HP_FLOOR_MULT` / `ENEMY_ARMOR_FLOOR_MULT` /
  `ENEMY_ATTACK_FLOOR_BONUS`) live in
  the shared [`src/js/data/enemyScaling.js`](src/js/data/enemyScaling.js), imported by BOTH
  the game and the sim engine — retuning there is picked up everywhere automatically.
- **The champion AI policy** is one module,
  [`src/js/game/ai/formulaPolicy.js`](src/js/game/ai/formulaPolicy.js) (the sim's
  `formula.mjs` is a re-export shim). It powers the in-game hint system *and* the whole
  toolbench. Its weights are a tracked game asset:
  [`src/assets/data/formula-champion.json`](src/assets/data/formula-champion.json).
- **`sim/toolbench/engine.mjs` MIRRORS a few non-exported game constants.** If you change
  them in `src`, update the mirror — verify with `node sim/toolbench/drift-check.mjs`.

## 5. Before you edit

1. Identify the owning system in §4 and **load that guide**.
2. Editing **BattleController** or battle logic? Also load the `battlecontroller` skill
   ([`.claude/skills/battlecontroller/SKILL.md`](.claude/skills/battlecontroller/SKILL.md)) —
   invariants, recipes, and a headless verification harness.
3. Training or measuring the **AI**? Load the `gems-ai-training` skill.
4. Check whether new assets need registration ([`main.js`](src/js/main.js)) or new sounds
   need entries ([`SoundConfig.js`](src/js/audio/SoundConfig.js)).

## 6. After you edit

- Test the affected scene; confirm no console errors.
- Game logic changed? Test **both** player and enemy turns.
- UI changed? Check the layout at different window sizes.

### Keeping the docs true — the update contract

**Do not append to this file.** It is a router with a hard budget: **keep it under 200
lines.** If a section wants to grow, that is a signal it belongs in a guide.

**Exception to append this file**. If a completely new aspect of the game is being made, or new top-level directories or portions of the game has been created.

| What you changed | Where it gets written |
|---|---|
| A file now owns a behavior it didn't (new system, moved responsibility) | Update the §4 routing table — one line |
| How a subsystem works (a new effect type, a new component, a new tuning knob) | The **owning guide** in `docs/guides/` |
| A design choice + its rationale, tradeoffs, or a bug class it prevents | A **new file in `docs/decisions/`** + a row in its README |
| A rule an agent would otherwise violate by default | §3 here — but only if it is genuinely always-on |

Historical rationale is *reference material*, never context. It goes in `docs/decisions/`.
