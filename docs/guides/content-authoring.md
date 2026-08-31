# Content Authoring

**Load this when:** adding or editing a **character**, **enemy**, **skill**, **relic** (player or enemy), **status effect**, **tile type**, **inline keyword**, or **enemy AI behavior**.

Related guides:
- Woven skills / the Skill Weave draft + synthesizer (`weaveConfig.js`, `skillWeaveTags.js`, `skillSynthesizer.js`) → **skill-weave.md**
- Stat resolution, run modifiers, growth, loadouts (`playerStats.js`, `scalingConfig.js`, `runState.js`) → **run-and-progression.md**

---

## Hard rules

**Violate these only when explicitly instructed.**

10. **Enemy data uses the same structure as character data** (hp, mana, skills, portrait).

12. **New characters require:** (a) per-character file in [`src/js/data/characters/`](../../src/js/data/characters/) with `baseStats` structure, registered in [`characters/index.js`](../../src/js/data/characters/index.js), (b) entry in [`characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js), (c) asset registration in [`main.js` ASSET_MAP](../../src/js/main.js).

16. **Skills and relics are referenced by ID, not embedded.** Character/enemy definitions list `skills: ['bash']` / `relics: ['family_crest']`. Full data lives in [`skillCatalog.js`](../../src/js/data/skills/skillCatalog.js) and the relic catalogs. **Relics are drawn from two separate pools:** players use [`relicCatalog.js`](../../src/js/data/relics/relicCatalog.js) (`resolveRelicIds`), enemies use the enemy-only [`enemyRelicCatalog.js`](../../src/js/data/relics/enemyRelicCatalog.js) (`resolveEnemyRelicIds`) — the two pools never mix, which is how enemy relics stay out of the player reward pool. Resolved shapes are identical, so the BattleController/PassiveSystem treat them the same. IDs are resolved into objects at battle-state creation (`createPlayerBattleState` for players, `MapScene._transitionToBattle` for enemies). **One exception:** WOVEN skills (Skill Weave rewards) are synthesized at runtime and exist in no catalog, so they live as FULL skill objects on `runState.skills` and are appended to the resolved catalog skills by `createPlayerBattleState` (deep-cloned per battle).

17. **Passive abilities are data-driven via PassiveSystem.** Never write `if (relic.id === 'X')` checks in battle logic. BattleController dispatches trigger events (see [`TriggerTypes.js`](../../src/js/systems/TriggerTypes.js)); [`PassiveSystem`](../../src/js/systems/PassiveSystem.js) routes them to matching relic effects through [`EffectResolver`](../../src/js/systems/EffectResolver.js).

18. **Atomic effects (damage, armor, heal, gain_mana, drain_mana, extra_turn, reduce_damage) live in [`EffectResolver`](../../src/js/systems/EffectResolver.js)** and are shared between skill resolution and passive resolution. Board-touching effects (create_tiles, destroy_tiles, destroy_tiles_row, destroy_tiles_radius) stay in BattleController because they drive the cascade phase machine. Passive board effects flow through `PassiveSystem.onBoardEffect` — `BattleController._handlePassiveBoardEffect` matches on `effect.effectType` and mutates the in-flight cascade's `_analysis` (positions/mana/skullDamage) so the existing SHOW_MATCH → REMOVE flow handles destruction + rewards.

Also applies (from the general project rules): **all asset keys are registered in [`main.js` ASSET_MAP](../../src/js/main.js)** — adding a new sprite requires adding it there.

---

## Recipes

### To add a new character
New file in [`data/characters/`](../../src/js/data/characters/) + register in [`characters/index.js`](../../src/js/data/characters/index.js).
Secondary: [`characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js), [`main.js` ASSET_MAP](../../src/js/main.js).

### To add a new enemy
New file in the matching [`data/enemies/actN/`](../../src/js/data/enemies/) folder (with `act`/`rarity`/`type` fields — **NOT** `floors`) + add to that act's `index.js` array AND list its id under the floor(s) in that act's `FLOOR_SPAWNS` map.
Secondary: spawning is automatic via [`selectEnemyForNode`](../../src/js/data/enemies/index.js) (matched on derived `floors` + `type`). Register portrait/skill assets in [`main.js` ASSET_MAP](../../src/js/main.js).

### To change which enemy spawns on a floor
Edit the per-act **`FLOOR_SPAWNS`** map (floor→enemy-ids) in [`act1/index.js`](../../src/js/data/enemies/act1/index.js) — the authoring surface (each def's `floors` is derived from it).
Secondary: [`selectEnemyForNode` / `floorForDepth` / `enemyTypeForNodeType` / rarity weights](../../src/js/data/enemies/index.js) for the matching logic.

### To add a new skill
[`skillCatalog.js`](../../src/js/data/skills/skillCatalog.js).
Secondary: reference its `id` from `skills: [...]` on the owner; register icon/sound in [`main.js` ASSET_MAP](../../src/js/main.js) and [`SoundConfig.js`](../../src/js/audio/SoundConfig.js).

### To add a new relic / passive (player)
[`relicCatalog.js`](../../src/js/data/relics/relicCatalog.js).
Secondary: pick a trigger from [`TriggerTypes.js`](../../src/js/systems/TriggerTypes.js), an effect type from [`EffectResolver.js`](../../src/js/systems/EffectResolver.js) (atomic) or [`BattleController._handlePassiveBoardEffect`](../../src/js/game/BattleController.js) (board-touching); reference id from `relics: [...]` on the owner.

### To add a new enemy relic
[`enemyRelicCatalog.js`](../../src/js/data/relics/enemyRelicCatalog.js) (**NOT** the player `relicCatalog.js`).
Secondary: same shape/triggers/effects as player relics; reference id from an enemy's `relics: [...]`; resolved via `resolveEnemyRelicIds`.

### To add a new passive trigger event
[`TriggerTypes.js`](../../src/js/systems/TriggerTypes.js).
Secondary: dispatch from the relevant spot in [`BattleController`](../../src/js/game/BattleController.js) via `this.passives.dispatch(...)`.

### To add a new effect type (atomic)
[`EffectResolver.js`](../../src/js/systems/EffectResolver.js).
Secondary: add a case to the switch; if used by skills, register a delegating handler in [`battle/skillEffectHandlers.js`](../../src/js/game/battle/skillEffectHandlers.js) + add to [`SKILL_EFFECT_TYPES`](../../src/js/game/MatchResolver.js).

### To add a new skill effect type (board-touching)
[`SKILL_EFFECT_TYPES`](../../src/js/game/MatchResolver.js) + a handler registration in [`battle/skillEffectHandlers.js`](../../src/js/game/battle/skillEffectHandlers.js).
Secondary: cascade-driving executors (`_execute*`) live on [`BattleController`](../../src/js/game/BattleController.js); the handler calls them and returns `ctx.enteredResolving()`.

### To add a status effect (buff/debuff)
[`statusEffects.js`](../../src/js/data/statusEffects.js) (catalog entry).
Secondary: add an `icon` sprite to `ui_spritesheet_status_effects`; teach [`BattleController`](../../src/js/game/BattleController.js) its behavior (a `_hasStatus` checkpoint + optional `_applyStatusTurnStartEffect` per-turn effect); apply it from a skill via the `apply_status` effect. See [decision #32](../decisions/32-status-effects-are-a-general-data-driven.md).

### To apply a status from a skill
Skill `effects[]` in [`skillCatalog.js`](../../src/js/data/skills/skillCatalog.js):
`{ effectType:'apply_status', applyStatus:{ id, target:'self'|'opponent', turns, attackValue? } }`

### Status timing / duration wrong
[`BattleController._tickStatusesAtTurnStart`](../../src/js/game/BattleController.js) + `_applyStatus` (`_armed`).
Statuses tick by TURN CYCLE at the affected side's turn START; see [decision #32](../decisions/32-status-effects-are-a-general-data-driven.md).

### Status overlay position/size wrong
`STATUS_BUFF_*` / `STATUS_DEBUFF_*` / `STATUS_MINI_*` / `STATUS_COUNT_*` consts in [`CharacterInfoPane.js`](../../src/js/ui/CharacterInfoPane.js).
Buffs and debuffs have separate anchors (different art shapes).

### To add a new tile type
[`TILE_TYPES`](../../src/js/game/TileTypes.js).
Secondary: [`BoardModel` spawn weights](../../src/js/game/BoardModel.js), tile sprite in [`main.js` ASSET_MAP](../../src/js/main.js).

### To add/edit an inline keyword (e.g. `[[Skulls]]`)
[`keywordDefinitions.js`](../../src/js/data/keywordDefinitions.js).
Secondary: parser [`keywordParser.js`](../../src/js/systems/keywordParser.js); rendered by [`KeywordText`](../../src/js/ui/KeywordText.js); chained tooltips by [`TooltipManager`](../../src/js/systems/TooltipManager.js). Just add the entry + use `[[Label]]` in any description.

### Keyword not colored / brackets showing / no tooltip
[`keywordDefinitions.js`](../../src/js/data/keywordDefinitions.js) (missing/typo'd id → console warn).
Secondary: [`KeywordText`](../../src/js/ui/KeywordText.js) renders spans; [`Tooltip`](../../src/js/ui/Tooltip.js) body is a `KeywordText`; chain built in [`TooltipManager._buildChain`](../../src/js/systems/TooltipManager.js).

### Enemy AI behavior (standard)
[`EnemyAI.findBestSkill()` / `findBestSwap()`](../../src/js/game/EnemyAI.js).
Secondary: [`EnemyAI._scoreBoard()`](../../src/js/game/EnemyAI.js).

### To add custom enemy AI
[`enemyAiOverrides.js`](../../src/js/game/enemyAiOverrides.js).
Secondary: [`customEnemyAi.js`](../../src/js/game/customEnemyAi.js), set `aiBehavior` on the enemy definition in [`data/enemies/`](../../src/js/data/enemies/).

### Smarter enemy board moves (simulation AI)
Set `aiBehavior: 'smart_matcher'` on the enemy def (handler in [`enemyAiOverrides.js`](../../src/js/game/enemyAiOverrides.js)).
Secondary: ranking/weights in [`MoveAdvisor.js`](../../src/js/game/MoveAdvisor.js) (`DEFAULT_WEIGHTS`); cascade prediction in [`BoardSimulator.js`](../../src/js/game/BoardSimulator.js).

---

## Passive scope: whose events does a relic see?

A relic effect fires on a **trigger** (see [`TriggerTypes.js`](../../src/js/systems/TriggerTypes.js)),
optionally narrowed by a **`condition`** gate. Two independent knobs decide *whose* events
reach it — get this wrong and the relic fires on the wrong side's turn, which is the most
common authoring bug in the passive system.

**`anySide` — the WIDENER.** By default an effect only sees **its own owner's** events
(the owner matched, the owner took damage, the owner's turn started). `anySide: true` adds
a second dispatch pass so the effect ALSO fires on the **opponent's** events. `ctx.caster`
stays the relic's owner either way, so the effect still lands on the owner.

> ⚠ `anySide` means **anyone**, not "the other guy." It is a superset — the owner's own
> events still fire through the normal pass. Vampiric Roots is literally worded "whenever
> ANYONE matches Green," and that is exactly what it does.

**`condition.side` — the NARROWER.** Pair it with `anySide` to select exactly one side.
It matches `payload.side` — the **actor** (whose event it is), *not* the relic's owner.

| Want | Write |
|---|---|
| Fires only on the **owner's** events (the default) | *no flags* |
| Fires on **anyone's** events | `anySide: true` |
| Fires only on the **opponent's** events (e.g. an enemy relic reacting to the PLAYER) | `anySide: true` + `condition: { side: 'player' }` |

```js
// Enemy relic: heal 1 HP per skull, but ONLY when the PLAYER matches skulls.
{
  trigger: 'onTileMatchType',
  anySide: true,                                  // widen to both sides…
  condition: { typeId: 'skull', side: 'player' }, // …then narrow to the player's matches
  effectType: 'heal',
  heal: { amount: 1, perCount: true },            // ×payload.count → per tile matched
}
```

**Condition fields** (all optional, ANDed) — implemented in
[`PassiveSystem._passesCondition`](../../src/js/systems/PassiveSystem.js) and mirrored in
`sim/toolbench/engine.mjs`:

| Field | Gate |
|---|---|
| `typeId` | `payload.typeId` must equal it (e.g. `'skull'`, `'disease'`) |
| `color` | `payload.color` must equal it (e.g. `'red'` on `onGainMana`) |
| `minCount` | `payload.count` must be ≥ it (e.g. `3`) |
| `side` | `payload.side` (the **actor**) must equal it — see above ([decision #47](../decisions/47-condition-side-gate-for-anyside-passive-effects.md)) |
| `isSkull` | `payload.isSkull` must match it (`onTakeDamage`/`onDealDamage` payloads). `isSkull: true` = react to SKULL damage only — Bone Armor's retaliation, which keeps it out of retaliation-relic recursion ([decision #50](../decisions/50-retaliation-relics-are-recursion-capped.md)) |
| `everyN` | **Stateful counter gate** — the effect fires only on every Nth event that passes the other gates, then resets. The count lives on the per-battle effect clone (`_everyNCounter`, starts at 0 each battle) and RelicBar shows it live as an icon badge. Handled in the dispatch loop, not `_passesCondition` ([decision #49](../decisions/49-condition-everyn-is-a-stateful-counter-gate.md)). Hourglass: `{ trigger: 'onTileMatchType', condition: { everyN: 10 }, effectType: 'extra_turn' }` |

`heal.perCount: true` multiplies the heal by `payload.count`, i.e. "N per tile matched."

---

## Catalogs & registries

| File | Exports | Content |
|------|---------|---------|
| [`src/js/data/statusEffects.js`](../../src/js/data/statusEffects.js) | `STATUS_EFFECTS` (default), `STATUS_KIND`, `getStatusDef`, `isBuff`, `isDebuff` | **Status-effect (buff/debuff) catalog.** Id-keyed plain object (mirrors skillCatalog/relicCatalog shape) — the single DATA source for the 8 statuses; battle behavior lives in [`BattleController`](../../src/js/game/BattleController.js) (see decision #32). Each entry `{ id, kind:'buff'\|'debuff', name, icon, description }`. `icon` = the sprite name in `ui_spritesheet_status_effects` (matches the key directly — no alias). Debuffs: `silenced` (can't cast skills), `crippled` (attack→1), `enfeebled` (can't gain mana), `brittle` (takes 1.5x damage), `bleeding` (start-of-turn damage = ½ applier's attack, snapshotted at apply), `frozen` (can't gain extra turns). Buffs: `intangible` (incoming damage→1), `berserk` (deal/take double, ignore effects — unwired stub). **(Barrier was REMOVED from this catalog — it's no longer a status. It is now a one-round numeric magic-shield POOL (`state.barrier`) absorbed like armor; see decision #38.)** Descriptions use `[[Keyword]]` markup. **To add a status:** add a catalog entry + teach BattleController how it behaves (a checkpoint query + optional per-turn effect). Applied from skills via the `apply_status` effect; rendered on portraits by [`CharacterInfoPane`](../../src/js/ui/CharacterInfoPane.js). |
| [`src/js/data/keywordDefinitions.js`](../../src/js/data/keywordDefinitions.js) | `KEYWORD_DEFINITIONS` (default), `KEYWORD_ALIASES`, `KEYWORD_COLOR`, `KEYWORD_MISSING_COLOR`, `getKeywordDefinition`, `normalizeKeywordKey` | **Centralized inline-keyword catalog.** Each entry `{ id, label, description }`, keyed by normalized id (lowercase, single-spaced). **Styling is NOT per-keyword** — ALL keywords render in the single shared `KEYWORD_COLOR` (change it in one place to retint every keyword); missing keywords use `KEYWORD_MISSING_COLOR`. Any UI description (relic/skill/enemy/stat/tutorial text) may mark a word with `[[Label]]` markup → resolved case-insensitively (with `KEYWORD_ALIASES` for alt spellings) so it renders bracket-free, colored, and gets an auto tooltip. Descriptions may themselves contain `[[keywords]]` (powers chained tooltips). Seeded: create, tiles, match, skulls, skull (singular — a real entry, NOT a skull→skulls alias, so `[[Skull]]` renders "Skull" not "Skulls"), mana, damage, armor, heal, attack, magic, phys (Physical Damage) / mag (Magic Damage) — the damage-type keywords that convey scaling, extra turn, thrall, harvest, the 8 status effects (silence, cripple, enfeeble, brittle, bleed, frozen, intangible, berserk), and barrier (the keyword stays, but barrier is now a one-round magic shield, not a status — decision #38). Also exports **`KEYWORD_DYNAMIC_COLOR`** for the `<<n>>` dynamic-value markup (see decision #34). Parsed by [`keywordParser.js`](../../src/js/systems/keywordParser.js), rendered by [`KeywordText`](../../src/js/ui/KeywordText.js). |
| [`src/js/systems/keywordParser.js`](../../src/js/systems/keywordParser.js) | `parseKeywordText` (default), `stripKeywordMarkup`, `hasKeywords`, `buildTooltipChain` | **Keyword markup parser + chain resolver.** `parseKeywordText(raw)` → ordered `text`/`keyword`/`dynamic` segments — it tokenizes BOTH `[[keyword]]` and `<<value>>` markup (the `dynamic` segment is a computed value rendered in `KEYWORD_DYNAMIC_COLOR`, never a tooltip span — see decision #34). Unknown keyword tokens become `missing:true` segments with a fallback color + one-time `console.warn`, never crash. `stripKeywordMarkup` shows labels for keywords and inner text for dynamic tokens; `buildTooltipChain` ignores dynamic segments. `buildTooltipChain(rootText, maxDepth)` → ordered, de-duplicated keyword-def list (BFS over keyword descriptions, visited-id recursion guard, capped at `maxDepth`) used by [`TooltipManager`](../../src/js/systems/TooltipManager.js) to spawn stacked keyword tooltips. |
| [`src/js/data/characters/warrior.js`](../../src/js/data/characters/warrior.js) | default: `warrior` | Warrior character definition (Thorgrim). `baseStats`, skills by ID, relics by ID. |
| [`src/js/data/characters/mage.js`](../../src/js/data/characters/mage.js) | default: `mage` | Mage character definition (Shylana). |
| [`src/js/data/characters/witchDoctor.js`](../../src/js/data/characters/witchDoctor.js) | default: `witchDoctor` | Witch Doctor character definition (Kalfou). |
| [`src/js/data/characters/index.js`](../../src/js/data/characters/index.js) | `warrior`, `mage`, `witchDoctor`, `getCharacterById`, default: `CHARACTERS_BY_ID` | **Character registry.** Re-exports each per-character file. `getCharacterById(id)` resolves by string id. Add new characters by importing + adding to `CHARACTERS_BY_ID`. |
| [`src/js/data/enemies/act1/`](../../src/js/data/enemies/act1/) | per-enemy files + `index.js` (array of that act's defs) | **Act 1 enemy roster** (only act implemented). Each enemy file `export default`s a def carrying **`act` (metadata only)**, **`rarity` (common\|uncommon\|rare)**, **`type` (minion\|elite\|boss)** plus `hp`/`maxHp`/`attack`/`armor`, skills by ID, **relics by ID from the ENEMY-ONLY pool**, optional `aiBehavior` + `music`. **Spawn placement is NOT on the def** — it lives in the per-act **`FLOOR_SPAWNS`** map (floor→enemy-ids) in [`act1/index.js`](../../src/js/data/enemies/act1/index.js), the authoring surface for "what appears on floor N"; each def's **`floors`** array is DERIVED (transposed) from it at load in [`enemies/index.js`](../../src/js/data/enemies/index.js), so every consumer (game + toolbench) reads `def.floors` unchanged. Act 1 minions: goblin, orc, goblinSapper, acolyte, shadowWeaver, chokeweed, **blightWarden**, goresnoutTrackers, abomination, **marrowSentry**, thrall; elites: cyclops, stoneGargoyle, orcTaskmaster, **sanguinePhoenix**; boss: **lordMalakor** (floor 10, the act's sole boss). Plus the non-spawning **sanguineEgg** (absent from FLOOR_SPAWNS → derived `floors: []`) — a transform-only form, registered solely so its id resolves when MapScene pre-builds the Phoenix's `transformForms`. Each has its own `portrait_<id>` asset; relics drawn from the enemy-only pool. **sanguinePhoenix** (Sanguine Phoenix — elite, floors 4-9, HP 10 baseline, attack 2, no mana, standard AI) is a two-phase near-immortal driven entirely by data (`transformForms: ['sanguineEgg']`): its `sanguine_egg` relic (**onDeath**) transforms it into the **sanguineEgg** form (DORMANT but a NORMAL, killable low-HP enemy — HP 2 baseline, floor-scaled like any enemy, no skills, kept mana, carrying only the DISPLAY-ONLY `sanguine_chrysalis` relic) instead of dying, and the player **KEEPS the turn** (a hidden extra turn). The player then has that one turn (extra turns included) to slay the Egg: slay it → victory (the normal enemy-death path); fail → at the player's turn END (with the Egg still alive) it reverts to a full-life Phoenix that takes the next enemy turn (`_resolveEggPhaseAtTurnEnd`). The revert is configured from the `sanguine_egg` relic's `transform` payload (`revertEnemyId`/`revertSound`); `sanguine_chrysalis` is purely informational (empty effects). Skills: **blood_gorge** (6 purple: drain 5 of all enemy mana, +10 Max HP, heal 10) + **anemic_feast** (10 red: deal 10 [[mag]] + 1 per board Skull, gain 6 purple, extra turn). See decision #37. (All art is dedicated — portraits/skill icons/relic icons/egg tile/SFX.) **lordMalakor** (Lord Malakor — HP 120 baseline ×4.65 floor-10 scaling, attack 4, no starting mana, `aiBehavior: 'malakor'`) — his core engine is the **Thrall/harvest** relic pair: `barons_signet` (Baron's Signet) seeds 3 wild Thrall tiles at his turn END (so the player gets a turn to use them) and `heart_of_usurper` (Usurper's Heart) harvests whatever Thralls remain at his next turn START for +1 attack each then turns them into Skulls (red-tendril animation). He still carries his skills (Desecrate > Harvest > Soul Burn > Exsanguinate, each granting an extra turn) but with no mana engine he only casts opportunistically when board matches fund the 7-cost; otherwise he ranks skull-building swaps. **chokeweed** (HP 20 baseline, attack 3, no mana, `aiBehavior: 'chokeweed'`) only ever casts the free **encroach** skill (+1 attack, ends turn); its `briarthorn` + `chokeweed_sap` relics ramp damage + convert skulls on each of its turn starts. **goresnoutTrackers** (HP 14 baseline, armor 10, attack 2, no mana, standard AI) builds red mana then casts **hound** (+1 attack, deal 2 damage, cost 3 red); its `goresnout_collars` relic echoes every hit for double damage. **abomination** (Flesh Mongrel — HP 16 baseline, attack 2, 2 starting red mana, floors 7-9, standard AI) bites cheaply with **infected_bite** (1 red: deal 1 damage + gain a turn); its `infected_tooth` relic spawns a **Disease tile** (inert — see TileTypes) on every hit and `severed_maxilla` grants +1 attack per Disease tile created, so repeated bites ramp its attack while cluttering the board, which it then cashes in with **cyst_burst** (10 green: turn all Disease into Skulls). **thrall** (Thrall — minion, common, floors 2-5, HP 22 baseline, attack 2, no mana, standard AI) builds red mana via swaps then casts **claw** (3 red: deal 5 [[phys]] scaling with Attack + gain +2 attack), ramping its damage as the fight drags on. **marrowSentry** (Marrow Sentry — minion, uncommon, floors 4-7, HP 5 baseline (deliberately tiny), attack 2, no mana, `aiBehavior: 'marrow_sentry'`) is an armor-snowball puzzle: its `bone_armor` relic grants 2 Armor at each of its turn starts AND retaliates 3 damage on EVERY hit it receives (armor-absorbed hits included), while it banks Blue for **deadstop** (5 blue: deal damage equal to its CURRENT armor via `damage.perArmor` — armor is read, not consumed). Burst it down early or keep the armor shaved; its custom AI never casts Deadstop at 0 armor. **blightWarden** (Blight Warden — minion, uncommon, floors 5-7, HP 15 baseline, attack 2, no mana, standard AI) hoards Green for **blighted_growth** (6 green: create 6 timed FUNGAL tiles + extra turn) while its `vampiric_roots` relic heals it 1 HP per tile whenever ANYONE matches Green (fungal counts as Green) — expired fungal explodes into Skulls + spreads; the full engine is decision #46. **Baselines re-tuned 2026-07-06 to the measured win-rate bands** (sapper hp/sulfur/bomb-cost/ignition nerfs, phoenix/egg nerfs, abomination/taskmaster HP cuts, goblin/acolyte/chokeweed/thrall buffs; goblin + f2-thrall left deliberately soft for onboarding) — full record in [`docs/balance-changes-2026-07-06.md`](../balance-changes-2026-07-06.md); verify bands with `node sim/toolbench/trainer.mjs enemies`. |
| [`src/js/data/enemies/index.js`](../../src/js/data/enemies/index.js) | `getEnemyById`, `getEnemiesByAct`, `getEnemiesByType`, `getEnemiesByRarity`, `getEnemiesForFloor`, `floorForDepth`, `enemyTypeForNodeType`, `selectEnemyForNode`, `markEnemySeen`, `ENEMIES_BY_ACT`, `ALL_ENEMIES`, `FLOOR_COUNT`, `goblin`, default: `ENEMIES_BY_ID` | **Enemy registry + spawn selection.** Aggregates the per-act rosters. `selectEnemyForNode({depth, nodeType, seenByAct})` is the spawn entrypoint MapScene uses: converts depth→floor (1-indexed via `floorForDepth`, so depth 0 = floor 1) and node type→enemy type (battle→minion, elite→elite, boss→boss via `enemyTypeForNodeType`), filters enemies whose `floors` includes that floor AND whose `type` matches, then rarity-weighted-randomly picks one (falls back to any minion eligible for the floor, then goblin). **`act` does NOT affect spawning** — placement is purely `floors` + `type`. **Per-act dedup:** `seenByAct` (act → seen enemy-id[]) filters out enemies already fought this act so each ideally appears once per act; if every eligible candidate has been seen it falls back to the full pool (a repeat only after the act's pool is exhausted). `markEnemySeen(runState, enemyDef)` records a pick into `runState.seenEnemiesByAct` (idempotent, bucketed by `enemyDef.act`). MapScene passes `runState.seenEnemiesByAct` and calls `markEnemySeen` in `_transitionToBattle`. Returns a shared catalog ref — callers deep-clone. |
| [`src/js/data/skills/skillCatalog.js`](../../src/js/data/skills/skillCatalog.js) | `SKILL_CATALOG` (default), `getSkillById`, `resolveSkillIds` | **Skill registry.** Plain object keyed by skill `id`. Each entry has `name`, `description`, `icon`, `sound`, `cost`, optional `targeting`/`area`, and `effects[]`. `resolveSkillIds(ids)` returns shallow-cloned full skill objects. Optional **`vfx: { color, coreColor? }`** overrides the cast VFX color language (spell projectile trail + impact burst — decision #59); omitted, `BattleScene._skillVfxColors` derives it from the DOMINANT cost color's tile palette (free skills → arcane gold), so every skill — woven ones included — gets an element read with zero authoring. |
| [`src/js/data/relics/relicRewards.js`](../../src/js/data/relics/relicRewards.js) | `RELIC_RARITY_WEIGHTS`, `DEFAULT_RELIC_RARITY_WEIGHT`, `getEligibleRelicRewards`, `pickRandomRelics`, `pickWeightedRelics`, `generateRelicRewardOptions`, `selectRelicRewardsByRarity` | **Post-battle relic reward pool.** `generateRelicRewardOptions({count, playerRunState, ownedRelicIds})` picks N relics for the reward overlay, excluding `starter`-rarity relics and relics already owned. **Rarity-weighted:** it delegates to `selectRelicRewardsByRarity`, which draws via `pickWeightedRelics` (weighted sampling without replacement) using **`RELIC_RARITY_WEIGHTS`** — the single tunable table mapping rarity→relative drop weight (a relic's chance ≈ its rarity weight ÷ summed eligible weight; weight 0 = effectively never offered, with uniform fallback only if the whole pool is zero-weighted). **To retune drop rates, edit `RELIC_RARITY_WEIGHTS`** — no other changes needed. `pickRandomRelics` (uniform) and a per-call `rarityWeights` override remain available. BattleScene calls this when the reward overlay opens; granted relic ids are appended to `runState.relics` via `BattleScene._grantRelicReward`. |
| [`src/js/data/relics/relicCatalog.js`](../../src/js/data/relics/relicCatalog.js) | `RELIC_CATALOG` (default), `RELIC_RARITY`, `getRelicById`, `resolveRelicIds` | **Relic registry.** Plain object keyed by relic `id`. Each entry has `name`, `description`, `icon`, `rarity` (`RELIC_RARITY`: starter\|common\|uncommon\|rare\|legendary), optional `area`, and `effects[]`. Each effect carries its own `trigger` field (TRIGGER_TYPES value) plus `effectType` and payload, and an optional `condition` payload gate. **Static-modifier relics** (spawn rate, attack, mana gain, skull damage, dynamic attack-per-mana, starting mana) use `trigger: 'onBattleStart'` and effect types `modify_stat` / `modify_spawn_rate` / `modify_mana_gain` / `modify_skull_damage` / `attack_per_unspent_mana` / `grant_starting_mana`, aggregated at setup by [`BattleController._initStaticModifiers()`](../../src/js/game/BattleController.js) (they need board/reward access so they bypass EffectResolver). `grant_starting_mana` (Potions: Red/Blue/Green/Yellow/Purple) adds a one-time `{ color, amount }` mana grant to the side before the board is built. `attack_per_unspent_mana` (Group: Cestus/Harpoon/Club/Stiletto/Wand) is **dynamic** — `_recomputeDynamicAttack` re-folds "+amount Attack per `per` unspent mana of `color`" into `attack` every frame (delta-based, composes with permanent `gain_attack` gains). Board-touching passive effects: `destroy_tiles_radius` (Unstable Catalyst) + `destroy_random_row` (Gorepike) augment the in-flight cascade analysis; `create_tiles` (enemy Infected Tooth, onDealDamage — see `enemyRelicCatalog.js`) stamps tiles in place via `_applyPassiveCreateTiles` (no cascade) and dispatches `onTileCreated`; `destroy_random_skulls` (Deathbringer on `onDealDamage`, Death Familiar on `onTileMatchType`) queues a deferred skull removal drained by `_maybeStartPendingSkullDestroy` after the current resolution settles — the destroyed skulls deal normal destroyed-skull damage (via `_doRemove`). The once-per-action guard (`_deathbringerFiredThisAction`, re-armed each turn/extra-turn start) stops the destruction's `onDealDamage` from re-triggering a damage-triggered destroyer (Deathbringer); match-triggered destroyers (Death Familiar) bypass the guard since their own damage doesn't re-fire `onTileMatchType`, so they fire per qualifying match. |
| [`src/js/data/relics/enemyRelicCatalog.js`](../../src/js/data/relics/enemyRelicCatalog.js) | `ENEMY_RELIC_CATALOG` (default), `getEnemyRelicById`, `resolveEnemyRelicIds` | **Enemy-only relic pool.** Sibling registry to `relicCatalog.js`, same relic shape and reuses `RELIC_RARITY`. Enemy defs reference these ids via `relics: [...]` and MapScene/CharacterSelect resolve them with `resolveEnemyRelicIds` (NOT `resolveRelicIds`). Once resolved they flow through the identical PassiveSystem/EffectResolver battle machinery — an enemy's relics behave exactly like a player's. Because it's a separate catalog, enemy relics never leak into the player reward pool ([`relicRewards.js`](../../src/js/data/relics/relicRewards.js) only reads `relicCatalog`). Seeded: `cracked_fang` (+2 attack), `goblin_totem` (turn-start armor), `cursed_idol` (match-4+ damage), `briarthorn` (onTurnStart `damage` with NO `amount` → EffectResolver falls back to caster.attack, so the hit scales as attack grows), `bone_armor` (**Marrow Sentry** — TWO effects: onTakeDamage `damage` retaliation gated `condition:{isSkull:true}` — fires on every SKULL hit the owner receives, armor-absorbed hits included, since applyDamage counts armor absorption as actualDamage; the skull gate keeps it from mutually recursing with player retaliation relics like Thorned Rose (decision #50) — plus onTurnStart `armor` {amount:2, attack-scaled}; feeds its Deadstop `perArmor` nuke), `chokeweed_sap` (onTurnStart board effect `convert_random_tiles` {from:'skull', to:'green', amount:2} — converts tiles; if the conversion lines up a match it resolves the cascade and then RESUMES the active side's normal turn via `_resumeTurnAfterResolve` (it must NOT end the turn or grant an extra turn — see decision #25)), `goresnout_collars` (onDealDamage `echo_damage` — re-deals the damage just dealt; host-handled via `_handlePassiveBoardEffect` so it can use the `_echoDamageActive` reentrancy guard that caps it at one echo per hit), `sulfur` (onBattleStart `modify_spawn_rate` {tile:'yellow', amount:15} — static board-global +15pp Yellow spawn chance, aggregated by `_initStaticModifiers`), `heart_of_usurper` (**Usurper's Heart**, Lord Malakor — onTurnStart `harvest_tiles` {type:'thrall', toType:'skull', attackPer:1} → host-handled via `_applyPassiveHarvest`: at the START of his turn counts every Thrall the player left on the board, grants +1 attack each, converts them to Skulls, and surfaces the red-tendril harvest animation before he acts), `barons_signet` (**Baron's Signet**, Lord Malakor — **onTurnEnd** `create_tiles` {type:'thrall', amount:3, avoidMatches:true} → seeds 3 wild **Thrall** tiles at the END of his turn, host-handled via `_applyPassiveCreateTiles`'s safe-spawn path so they don't auto-resolve — placed before the player's turn so the player gets a turn to spend them), `infected_tooth` (Abomination — onDealDamage board effect `create_tiles` {type:'disease', amount:1} — creates an inert Disease tile in place after dealing damage; host-handled via `_handlePassiveBoardEffect`/`_applyPassiveCreateTiles`, which dispatches `onTileCreated` per created tile), `severed_maxilla` (Abomination — `onTileCreated` `condition:{typeId:'disease'}` `gain_attack` +1, i.e. +1 attack per Disease tile created), `vampiric_roots` (**Blight Warden** — onTileMatchType **`anySide:true`** `condition:{typeId:'green'}` `heal` {amount:1, **perCount:true**} — heals the OWNER 1 HP per tile whenever EITHER side matches Green; fungal tiles count as Green, so clearing the blight feeds it — see decision #46). `cracked_fang`/`goblin_totem`/`cursed_idol` reuse existing player relic icon keys; `briarthorn`/`chokeweed_sap`/`goresnout_collars`/`sulfur`/`heart_of_usurper`/`infected_tooth`/`severed_maxilla`/`vampiric_roots` have dedicated icons. |
| [`src/js/data/characterSelectDefinitions.js`](../../src/js/data/characterSelectDefinitions.js) | `characterSelectDefinitions` (default) | UI metadata for CharacterSelectScene: portraitKey, splashKey, **optional `splashVideo`** (URL relative to index.html for the full-canvas choose-hero intro video — all three heroes today; omit to confirm instantly), auraColor, order, enabled. References characterData from data/characters/. |

> Stat resolution (`playerStats.js`), damage scaling (`scalingConfig.js`) and run state (`runState.js`) live in **run-and-progression.md**.
> The Skill Weave data modules (`weaveConfig.js`, `skillWeaveTags.js`, `skillSynthesizer.js`) live in **skill-weave.md**.

---

## Tile types & constants

| Name | Location | Values |
|------|----------|--------|
| `TILE_TYPES` | [`TileTypes.js:11`](../../src/js/game/TileTypes.js) | RED, BLUE, GREEN, YELLOW, PURPLE, SKULL, DISEASE, WILD, THRALL, SANGUINE_EGG, FUNGAL_2, FUNGAL_1 — each with id, isSkull, color, particleColor, spawnWeight. **FUNGAL_2/FUNGAL_1** (`isFungal: true` + `isInert: true` + `spawnWeight: 0`, `fungalTimer` 2/1, both drawn with the `green_blight_tile` art via `tile_fungal_*` aliases) are the Blight Warden's TIMED, GREEN-AFFINE tiles — the remaining turn timer IS the type id; they match with Green or each other (emitted as GREEN matches) and explode into a Skull + spread when expired (decision #46). **DISEASE** is `isInert: true` + `spawnWeight: 0`: it never spawns naturally (placed only by effects, e.g. Infected Tooth), is neither mana nor skull, and matching/destroying it awards no mana/skull damage (MatchResolver skips inert tiles for those), though a 4+ inert match still grants an extra turn. **WILD and THRALL** are both `isWild: true` + `spawnWeight: 0`: placed only by effects, they never spawn naturally and act as **match-anything jokers** — in `BoardModel._scanLineRuns` a wild substitutes for any concrete color/skull type it lines up beside (Red+Wild+Red = Red match), but NOT for inert Disease tiles; a wild match resolves to the concrete type (awards that color's mana / skull damage), while a wild destroyed WITHOUT a host (raw destroy) awards nothing. The three differ only in ART + provenance: **WILD** (`wild_tile` sprite) is the STANDARD wild every generic effect uses (player-woven "wild" skills), **THRALL** (`thrall_tile`) is Lord Malakor's variant (Baron's Signet seeds them, Usurper's Heart harvests specifically `type:'thrall'`), **SANGUINE_EGG** (`tile_sanguine_egg`, aliased to the `phoenix_egg_tile` sheet sprite) is a now-UNUSED leftover of the Phoenix's old tile minigame — the Sanguine Egg phase is now damage-based (slay the Egg enemy in one turn), so no egg tiles spawn anymore (the type + art stay registered but inert — see decision #37). All wild tiles get the `wild_tile_border` overlay (BoardPlaceholder keys it off `isWild`); fungal tiles get a turns-remaining number badge (`isFungal` + `fungalTimer`). Helpers: `isInert(typeId)`, `isWild(typeId)`, `isFungal(typeId)`, `fungalTimer(typeId)`, and `isMana(typeId)` excludes inert (incl. fungal) and wild. |
| `BOARD_COLS / BOARD_ROWS` | [`TileTypes.js:33`](../../src/js/game/TileTypes.js) | 8 / 8 |
| `MANA_COLORS` | [`TileTypes.js:21`](../../src/js/game/TileTypes.js) | ['red', 'blue', 'green', 'yellow', 'purple'] |

The full `SKILL_EFFECT_TYPES` payload reference lives in [`MatchResolver.js:23`](../../src/js/game/MatchResolver.js) (and the battle-system guide) — every skill effect's payload shape is documented there.

---

## Enemy AI

| File | Class | Responsibility |
|------|-------|----------------|
| [`src/js/game/EnemyAI.js`](../../src/js/game/EnemyAI.js) | `EnemyAI` | Enemy decision: skill-first (damage preferred), then board evaluation with priority scoring (4+ match > skull damage > skill mana > contest player mana) |
| [`src/js/game/customEnemyAi.js`](../../src/js/game/customEnemyAi.js) | (module) | **AI override dispatch.** Exports `chooseEnemyAction(enemyState, context)` and `getEnemyAiHandler(aiBehavior)`. Tries custom AI first; falls back to standard EnemyAI. Used by BattleController._doEnemyTurn(). |
| [`src/js/game/enemyAiOverrides.js`](../../src/js/game/enemyAiOverrides.js) | (module) | **Custom AI registry.** Plain object keyed by `aiBehavior` string → handler function. Handlers receive `{ enemy, player, board, battleState, standardAI }` and return `{ action, skill?, swap? }` or `null` (fall back to standard AI). Add new enemy behaviors here. Implemented: **`goblin_sapper`** — casts Boom Baby! then Ignition when affordable, otherwise ranks swaps by a custom tiered scorer (4+ > yellow > red > skull > anything else) that deliberately demotes skulls, unlike the standard AI. **`chokeweed`** — only ever casts its free `encroach` skill (gain +1 attack, end turn); returns null to fall back to standard AI if encroach is unavailable. **`malakor`** (Act 1 boss, Lord Malakor) — every skill grants an extra turn and his Heart of the Usurper relic feeds him 2 of every mana per turn start, so he chains casts down a strict priority Desecrate (3 purple, needs Green on board) > Harvest (3 yellow, needs Skulls on board) > Soul Burn (3 blue) > Exsanguinate (3 red); otherwise ranks swaps by `scoreMalakorBoard` (4+ > skulls > purple > the Yellow/Blue/Red color it's CLOSEST to its cost, weighted by current mana — Green demoted since Green mana is useless to him). **`marrow_sentry`** — standard behavior with one exception: never casts Deadstop (damage = its current armor) at 0 armor; with Deadstop affordable but no armor banked it swaps instead (standard AI's swap ranking; passes if no swap exists — returning null would let the skill-first standard AI cast the zero-damage nuke anyway). Mirrored in the sim's `_chooseSkill` (perArmor-only skills are held at 0 armor). **`smart_matcher`** (GENERAL, not enemy-specific — **registered but referenced by NO enemy yet**): simulation-based swap ranking via [`MoveAdvisor`](../../src/js/game/MoveAdvisor.js)/[`BoardSimulator`](../../src/js/game/BoardSimulator.js); skill decisions stay with the standard AI (defers via null when a skill is castable — it only upgrades the SWAP choice). To give any enemy the smarter matching, set `aiBehavior: 'smart_matcher'` on its def. |

---

## Design decisions

| # | Decision | Why it matters here |
|---|----------|---------------------|
| [#10](../decisions/10-mapscene-is-a-singleton.md) | MapScene is a singleton | Graph, renderer, traversal, `_runState`, `_characterDef` survive scene switches — enemy resolution/spawn state lives here |
| [#11](../decisions/11-enemy-hp-and-attack-scale-per-floor.md) | Enemy HP and attack scale per floor | Authored enemy `maxHp`/`attack` are **floor-1-equivalent baselines**; MapScene multiplies HP and adds a per-floor attack bonus (`attackScale` opts out) |
| [#16](../decisions/16-rewards-modify-run-modifiers-not-base-stats.md) | Rewards modify run modifiers, not base stats | Never mutate a character def — `applyRunModifier(runState, path, amount)` |
| [#20](../decisions/20-enemy-ai-overrides-are-dispatch-based-not.md) | Enemy AI overrides are dispatch-based, not conditional | Register a handler keyed by `aiBehavior`; never `if (enemy.id === 'X')` |
| [#21](../decisions/21-skills-and-relics-are-id-referenced-catalog.md) | Skills and relics are id-referenced + catalog-resolved | Where ids become objects; the woven-skill exception; `_cloneState` is field-explicit |
| [#22](../decisions/22-passive-abilities-are-data-driven-via-passivesystem.md) | Passive abilities are data-driven via PassiveSystem dispatch | Adding a relic requires no code outside the catalog |
| [#23](../decisions/23-trigger-dispatch-points-in-battlecontroller.md) | Trigger dispatch points in BattleController | Exactly where each `onX` trigger fires — pick the right one for a new passive |
| [#24](../decisions/24-static-modifier-relics-bypass-event-dispatch.md) | Static-modifier relics bypass event dispatch | `onBattleStart` + `modify_stat`/`modify_spawn_rate`/`modify_mana_gain`/`modify_skull_damage` are aggregated once at setup |
| [#29](../decisions/29-descriptions-support-data-driven-inline-keywords-with.md) | Descriptions support data-driven inline keywords with chained tooltips | `[[Keyword]]` markup works in any description; add the entry, get the tooltip |
| [#30](../decisions/30-thrall-wild-tiles-baron-s-signet-harvest.md) | Thrall wild tiles + Baron's Signet harvest | The reusable wild-tile / create-at-turn-end / harvest-at-turn-start extension points |
| [#32](../decisions/32-status-effects-are-a-general-data-driven.md) | Status effects are general + data-driven; durations tick by TURN CYCLE | Catalog entry + a BattleController checkpoint = a new status |
| [#34](../decisions/34-magic-stat-per-effect-damage-scaling-phys.md) | Magic stat + per-effect damage scaling + `[[phys]]`/`[[mag]]` + `<<n>>` markup | How to make an effect scale and show its live value |
| [#37](../decisions/37-mid-battle-enemy-transform-is-a-general.md) | Mid-battle enemy TRANSFORM is a general, data-driven identity swap | `transformForms` + an `onDeath` relic — the Sanguine Phoenix engine |
| [#39](../decisions/39-poison-is-a-numeric-stack-pool-not.md) | Poison is a numeric STACK pool, not a duration status | `apply_poison` payloads, the halving tick, Poison Vial's relic path |
| [#46](../decisions/46-fungal-tiles-are-timed-green-affine-board.md) | Fungal tiles are timed, green-affine board threats; `anySide` relic effects | Timer-in-the-type-id pattern, `heal.perCount`, relics that watch BOTH sides |
| [#47](../decisions/47-condition-side-gate-for-anyside-passive-effects.md) | `condition.side` gate for `anySide` effects | How to write "react to the OPPONENT only" without a relic-id check |
