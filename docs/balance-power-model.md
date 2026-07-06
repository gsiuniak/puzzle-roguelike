# The Power Model — How the Game Works, How It Scales, and How to Measure True Power

> **Status:** The current master balance reference. Captured 2026-07-03 against live source.
> **Supersedes / aggregates:** [`balance-scaling-research.md`](balance-scaling-research.md) (2026-06-03),
> [`balance-combat-math.md`](balance-combat-math.md) + [`balance-dominant-strategy-analysis.md`](balance-dominant-strategy-analysis.md) (2026-06-23),
> [`balance-findings.md`](balance-findings.md) (sim findings), [`balance-changes-2026-06-23.md`](balance-changes-2026-06-23.md) (applied pass).
> Where those docs disagree with this one, **this one reflects current code** (several of their numbers are stale — flagged inline).
>
> **Companion tool:** [`../sim/balance-toolbench.html`](../sim/balance-toolbench.html) — the Balance Toolbench.
> Every measurement method defined in §6 is implemented there, running on the **real** `BoardModel` /
> `MatchResolver` and the **live** data catalogs (serve the repo over http and open the file).
> Everything in this doc labelled **[CODE]** is exact to source with a citation; **[MODEL]** is a tunable
> assumption; **[MEASURE]** means "don't estimate it — run the toolbench and read it".
>
> **Nothing here is set in stone.** §4 is explicitly a list of every knob and what turning it does.

---

## 0. TL;DR — the one-page mental model

1. **The game is a tempo economy.** A turn is one action (swap or cast). Everything a combatant does
   converts *turns* into some mix of **damage** (skulls, skills), **mana** (colors), and **more turns**
   (4+ matches, `extra_turn` effects). Balance = pricing all outputs in one currency and keeping the
   exchange rates sane.
2. **Both sides play the same game on the same board.** Enemy relics/skills flow through the identical
   machinery. Any change to a shared primitive (skull formula, spawn weights, extra-turn rule) moves
   *both* sides at once — those are *pacing* knobs, not *difficulty* knobs.
3. **Nothing persists between fights except run-level progression.** HP/mana/armor/attack reset each
   battle. Player power grows *between* fights (growthPlan + relics); enemy power grows *by floor*
   (HP multiplier + attack bonus). Within a fight both sides can ramp (gain_attack, poison, Thralls).
4. **Three scaling channels exist for the player:** deterministic growth (`growthPlan`, per victory),
   stochastic relics (rarity-weighted drops), and crafted skills (Skill Weave, priced by the
   synthesizer's POWER table). Each has its own knob set (§4).
5. **True power is measured, not derived.** The analytic DEV model (§5) is a fast screening tool that
   ranks things and finds outliers; the **simulation** (§6) is the ground truth: power of X =
   Δ(win rate) and Δ(turns-to-kill) that X causes for a standard reference matchup. The toolbench
   automates both, side by side.
6. **Current known distortions** (§8): unbounded in-fight attack engines (Tsunami/Scythe/Reckoning/
   Cestus group), a dead `_10` scaling preset making Soul Eater flat, ~4× value spread across colors,
   and the extra-turn cliff at 4+ being the strongest — and least surfaced — unit of value in the game.

---

## 1. The game as a system — loops, currencies, timescales

### 1.1 The core loop (one battle)

```
                      ┌────────────────────────────────────────────┐
                      │                 ONE TURN                    │
                      │  (one swap OR one skill cast)               │
                      └────────────────────────────────────────────┘
   swap → matches → cascade steps ──┬── skull match → DAMAGE (attack-scaled)
                                    ├── color match → MANA (+⌊Magic/9⌋ +relic bonus)
                                    ├── any 4+ / shape → EXTRA TURN (retain flag)
                                    └── passive triggers (onTileMatchType, onMatch4Plus, onGainMana…)
   cast  → spend mana → effects[] → damage / armor / barrier / heal / board edits / statuses /
                                    extra_turn / permanent stat gains … → may enter a cascade
```

Damage funnels through one chokepoint (`BattleController._applyDamage`): status multipliers
(Berserk/Brittle/Intangible) → Mark multiplier → `onIncomingDamage` passives (Evil Eye) →
`MatchResolver.applyDamage` (**barrier → armor → block → HP**). Kill checks after every application.

### 1.2 The three currencies

Everything in the game is one of these, or a converter between them:

| Currency | Producers | Consumers | Exchange anchor |
|---|---|---|---|
| **Damage** (incl. armor/barrier/heal as "negative damage") | skull matches, skills, passives, poison/bleed | enemy HP pool | the numéraire: 1 dmg = 1.0 |
| **Mana** (5 colors) | color matches (1/tile), Magic bonus, relics, `gain_mana` | skill costs | V_mana ≈ what the best skill it funds pays per point |
| **Tempo** (turns) | 4+ matches, `extra_turn` effects, egg-phase retained turns | everything (each turn produces the above) | V_turn = one full turn of your own output |

**Tempo is the strongest and least-priced currency.** A 4+ match is a 3-match *plus an entire extra
turn*; measured extra-turn rate is ~0.2/action, so ~25% of all actions are "free". Skills that grant
`extra_turn` (Bash, Smash, Charge, Anemic Feast, Exsanguinate, Soul Burn) are effectively rebating
their own cost in tempo. Anything that raises 4+ frequency (spawn-rate relics, create_tiles into a
color you can line up, Prism-style rewards on 4+) compounds through this channel.

### 1.3 The three timescales of state

| Timescale | What persists | Where |
|---|---|---|
| **Within a fight** | mana, armor, barrier, poison stacks, statuses, in-fight `gain_attack`/`gain_magic`, Mark, locks, board state | battle state (reset on battle end) |
| **Within a run** | `statModifiers` (growthPlan accruals), relics, woven skills, loadout, seen-enemy dedup | `runState` |
| **Forever** | nothing (no meta-progression) | — |

Key consequence (unchanged since the 2026-06 analyses): **HP fully refreshes each battle**
(`createPlayerBattleState` seeds hp = effective maxHp; decision #17). So defense is only worth
anything *inside the single hardest fight* — Max HP's value is entirely "does any one fight
threaten to kill me", which is created almost exclusively by **enemy attack** (the lethality knob).

---

## 2. Exact primitives **[CODE]** — the formulas everything rests on

All verified against source 2026-07-03. These are the atoms; every power number decomposes into them.

### 2.1 Board & probability

| Quantity | Value | Source |
|---|---|---|
| Board | 8×8 = 64 cells | `TileTypes.js` `BOARD_COLS/ROWS` |
| Spawn weights | 5 colors @ **16**, skull @ **20** (total 96) | `TileTypes.js` `TILE_TYPES` |
| P(specific color) / P(skull) | 16/96 ≈ **16.7%** / 20/96 ≈ **20.8%** | derived |
| E[skulls on board] / E[one color] | ≈ **13.3** / ≈ **10.7** | derived |
| Spawn-rate relics | +10pp (player Group A), +15pp (Sulfur); target tile → base+boost, rest re-normalized pro-rata | `BoardModel.getEffectiveWeights` |
| Match | 3+ in a line; Union-Find shapes; wilds substitute per line (not for inert) | `BoardModel._scanLineRuns` |
| Extra turn | any single match ≥ 4 tiles, or shape ≥ 4 | `MatchResolver.analyzeMatches` |
| Extra turns | non-cumulative retain flag, consumed once per action epilogue | decision #4 |

Skull is the most common tile: skull *pressure is ambient* — ~28% of spontaneous cascade matches are
skulls **[MODEL]**, so the matched-skull formula is an ambient-damage knob for both sides.

### 2.2 Damage

| Source | Formula | Source |
|---|---|---|
| **Matched** skulls | `round(N × (1 + max(0, A−1)/3))` — attack term **per skull** (fixed 2026-06-23) | `MatchResolver.calculateMatchedSkullDamage` |
| **Destroyed** skulls (skill/explode/row) | `N × (1 + ⌊A/3⌋)` — step function | `calculateDestroyedSkullDamage` |
| Skull-damage relic bonus | Funerary Bell: +3 per **matched skull group** (added per match in `_applyMatchBonuses`) | `relicCatalog.js` |
| Skill/relic `damage` | `amount + perSkull×(skulls on board) + ⌊A·s.attack + M·s.magic⌋` | `BattleController._resolveEffect`, `scalingConfig.scaledBonus` |
| Mitigation | statuses (Berserk ×2 attacker, ignores target statuses; else Brittle ×1.5 then Intangible clamp→1; Berserk target ×2) → Mark ×mult (one-shot) → Evil-Eye-style reduction → **barrier → armor → block → HP** | `BattleController._applyDamage` + `MatchResolver.applyDamage` |
| Poison | tick = current stacks (absorbed by barrier/armor — NOT piercing), then `stacks ← ⌊stacks/2⌋`; ticks at END of **applier's** turn | `BattleController._tickPoison`, `POISON_DECAY_DIVISOR=2` |
| Poison lifetime value | ≈ `2 × stacks` total raw damage (geometric tail), *if the fight lasts* | derived |
| Bleed | `max(1, ⌈applier.attack/2⌉)` snapshotted at apply, ticks at victim's turn start | `statusEffects` + controller |
| Consume | `⌊pool / divisor⌋`, divisor ≥ 2 (hard ½ dmg/unit cap), no stat scaling | decision #40 |

### 2.3 Stats and what they actually do

| Stat | Channels | Notes |
|---|---|---|
| **Attack** | ① matched-skull damage (slope N/3 per point) ② destroyed-skull steps ③ any effect with `scaling:{attack}` (Bash `_100`, enemy skills `_50`, armor `_33`, Oungan heal `_100`) | The skull/physical scalar. In-fight sources: `gain_attack`, Scythe, Reckoning, Tsunami, Cestus group (dynamic per unspent mana), Malakor harvest, Severed Maxilla. |
| **Magic** | ① effects with `scaling:{magic}` (Fracture `_150`, Barrier `_66`, Poison `_25`, reactor relics `_33`) ② **+⌊M/9⌋ bonus mana per matched color** (`MAGIC_MANA_PER_POINT = 9`) | ⚠ Older docs say `⌊M/3⌋` — the constant is **9** now (`BattleController.js:60`). The mana channel is real but 3× weaker than the 06-23 analysis assumed; Magic's "3 channels" premium (synth `perMagic 2.5` vs `perAttack 2`) should be re-checked in the toolbench. |
| **Max HP** | survival only (fights reset HP) | value = P(death) reduction in the *hardest* fight; ≈ 0 when enemies can't threaten lethal |
| **Armor** | 1:1 pre-HP absorb, persists within fight, consumed | ≈ 0.9 DEV/pt |
| **Barrier** | 1:1 absorb before armor, expires at owner's next turn start | ≈ 0.9 DEV/pt but only vs damage arriving within one round |
| **Starting mana** | amortized head start ≈ first cast arrives ~1–2 turns earlier | ≈ V_mana × amount ÷ fight length per-turn |

Scaling presets (`scalingConfig.DAMAGE_SCALING_PRESETS`): `_300 _250 _200 _150 _100 _75 _66 _50 _33 _25 _20`.
**⚠ There is no `_10`** — `soul_eater` references `DAMAGE_SCALING_PRESETS._10` → `undefined` → its heal
is a flat 1, not 1+0.1(A+M). Either add the preset or re-author the relic (§8.6).

### 2.4 Mana economy

- 1 mana per matched tile of its color, to the **active** side only (Enfeeble gates it).
- Bonus: `+⌊Magic/9⌋` per matched color per cascade step + per-color relic bonus (Bellows group +1).
- Supply is symmetric across colors (all 16/96) and player-steered ⇒ **a color's strength is 100%
  demand-side** — decided by the skills that cost it. Measured mana income ≈ **3.3–3.5/turn** [MEASURE].
- Skill costs run 2 (infected_bite) to 20 (boom_baby); player kit 3–6. A 5-cost ≈ 1.5–2 turns of
  focused matching, ~1 turn with starting mana or bonuses.

### 2.5 Progression curves

**Player (per VICTORY, auto-applied — stat picking disabled, decision #36):**

| Character | HP | Atk | Mag | growthPlan / win | Starting mana | Skills | Relics |
|---|---|---|---|---|---|---|---|
| Warrior (Thorgrim) | 30 | 1 | 1 | **+5 HP, +1 Attack** | 5 red, 5 blue | bash, defend | family_crest |
| Mage (Shylana) | 18 | 1 | 3 | **+4 HP, +1 Magic** | 5 yellow, 3 purple | fracture, arcane_inscription | unstable_catalyst, copper_coil |
| Witch Doctor (Kalfou) | 30 | 2 | 1 | **+4 HP, +1 Magic** | 5 green, 5 purple | summon_dead, oungan | poison_vial |

Fallback `DEFAULT_GROWTH_PLAN = { maxHp: 4, startingAttack: 1 }` (`BattleScene.js:94`). Growth is per
*victory*; a 10-floor path is ~6–8 fights (chest/training/rest nodes don't grant growth) — the
toolbench's `winsPerFloor` (default 0.7) converts floor → expected victories.

**Enemy (per floor at spawn, `MapScene._resolveEnemyBattleData`):**

```
maxHp  = round(baseHp × HP_MULT[depth]),   HP_MULT  = [1.15, 1.35, 1.7, 1.9, 2.35, 2.65, 3.2, 3.55, 4.25, 4.75]
attack = baseAtk + round(ATK_BONUS[depth] × attackScale),  ATK_BONUS = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
```

Enemy data (`hp`/`attack`) are **floor-1-equivalent baselines**. Current roster baselines:

| Enemy | Type | Floors | HP | Atk | Armor | Start mana | Kit highlights |
|---|---|---|---|---|---|---|---|
| Goblin | minion | 1–2 | 14 | 1 | 0 | — | slash |
| Acolyte | minion | 1–2 | 18 | 1 | 0 | 3 purple | doomsong (10 skulls) |
| Orc | minion | 1–3 | 18 | 3 | 0 | 3 red | slash |
| Thrall | minion | 2–5 | 20 | 2 | 0 | — | claw (ramps +2 atk/cast) |
| Goblin Sapper | minion | 3–7 | 11 | 2 | 0 | — | boom_baby (999), ignition; Sulfur; custom AI |
| Chokeweed | minion | 3–5,7–9 | 16 | 2 | 0 | — | encroach (+1 atk/turn); Briarthorn (turn-start dmg = atk), Sap |
| Goresnout Trackers | minion | 4–8 | 14 | 2 | **10** | — | hound; Collars (echo = ×2 all damage) |
| Cyclops | minion | 5–9 | 18 | 3 | 1 | — | boulder_throw, smash (extra turn) |
| Flesh Mongrel | minion | 7–9 | 25 | 2 | 0 | 2 red | infected_bite chains, Disease→atk ramp, cyst_burst |
| Sanguine Phoenix | elite | 4–9 | 12 | 3 | 0 | — | blood_gorge, anemic_feast; Egg death-transform |
| Stone Gargoyle | elite | 5–9 | 24 | 3 | **10** | 4 blue | slash, frenzy; Goblin Totem |
| Shadow Weaver | elite | 5–9 | 26 | 3 | **10** | 4 purple | slash, doomsong; Cursed Idol |
| Orc Taskmaster | elite | 5–9 | 28 | 3 | 0 | 4 red | charge (extra turn), frenzy |
| Lord Malakor | boss | 10 | 50 | 1 | 0 | — | Thrall seed/harvest engine (+1 atk/Thrall), 4 extra-turn skills, custom AI |

Malakor at floor 10: HP `round(50×4.75)=238`, attack `1+4=5` before harvest ramp.

### 2.6 Reward streams

- **Relics:** 3 options/victory, weighted **common 70 / uncommon 25 / rare 15 / legendary 0** (!) —
  `relicRewards.RELIC_RARITY_WEIGHTS`. ⚠ Legendary weight is currently **0**: Tsunami, Soul Eater,
  Reckoning, Gorepike, Deathbringer are **unobtainable** as drops right now (deliberate quarantine of
  the unbounded engines, but note Deathbringer/Gorepike are collateral). Owned + starter excluded.
- **Skill Weave (training node):** synthesized skill, priced by `skillSynthesizer` POWER table →
  `cost ≈ clamp(round(power / 1.7) ± jitter, 3, 15)` (`weaveConfig.MANA_COST_CONFIG`). The POWER
  table **is** the designer's skill-pricing rubric (§6.3): perDamage 0.5, perArmor 0.45, perHeal 0.4,
  perAttack 2, perMagic 2.5, perTileCreated 1.1, extraTurn 8, perPoisonStack 1.0, reflectTurn 6.
- **Growth:** automatic per victory (above).

---

## 3. How the game *actually* scales — the intrinsic dynamics

These are emergent properties of §2, not authored numbers. They are what "the nature of the game"
means and they constrain every tuning decision.

### 3.1 Offense compounds; defense doesn't

Every in-fight attack source (`gain_attack`, Scythe, harvest, Cestus…) raises *all future* skull
matches and attack-scaled skills — offense is **convex** in fight length. Armor/heal are linear;
barrier sub-linear (expires). Consequence: **long fights favor whoever ramps**. Chokeweed and Malakor
are dangerous *because* they're slow; a player with Tsunami trivializes anything long. Fight-length
targets (§6.5) are therefore a *safety property*, not just pacing taste.

### 3.2 The 4+ cliff shapes all play

Value per tile jumps discontinuously at match size 4 (extra turn ≈ a whole action ≈ 4–8 DEV). The AI
weights it +10000; competent play chases it (~0.2/action measured). Anything that changes 4+
frequency (board size, spawn skew, create_tiles, wilds) moves *tempo* for both sides and is the
single most sensitive shared knob in the game.

### 3.3 Skull ambience couples offense to the board

With P(skull)=20.8%, ~13 skulls sit on the board; both sides' *idle* damage rises with their attack
stat even with zero intent. Raising skull spawn (Catacomb Key) or converting to skulls (Summon Dead,
Desecrate, cyst_burst) is a bet on "my attack × my match priority beats yours".

### 3.4 Mana is demand-defined

Since supply is uniform, a color is exactly as strong as the best per-mana payout among the skills
that cost it, times how reliably its owner can bank it (focus, denial, spawn boosts). This makes the
skill catalog itself the color-balance surface — V/mana per skill is the number to audit (§6.3).

### 3.5 Enemy difficulty = burst share, not stat totals

Because HP refreshes per fight, an enemy only *matters* through P(death) and attrition-of-attention.
The operative quantity is **burst share** = worst-turn damage ÷ player HP. Enemy HP mostly buys
*time* for its ramps and skills to come online. This is why `ENEMY_ATTACK_FLOOR_BONUS` (steepened
06-23) is the difficulty curve and `ENEMY_HP_FLOOR_MULT` is the pacing curve.

### 3.6 Within-fight ramp archetypes (enemy design space)

The roster today spans: flat hitter (Goblin/Orc), tempo (Smash/Charge extra turns), engine ramp
(Chokeweed, Thrall, Trackers echo, Mongrel disease), economy denial (Soul Burn, Blood Gorge drain),
board warfare (doomsong/ignition/desecrate skull floods), phase mechanic (Phoenix egg), and the
kitchen-sink boss (Malakor). New enemies should pick one axis and budget it via §6.4.

---

## 4. Every knob, and what it turns **[CODE — locations]**

Nothing below is sacred. Grouped by what kind of lever it is.

### 4.1 Shared primitives (move BOTH sides — pacing/feel levers)

| Knob | Location | Effect of turning |
|---|---|---|
| Spawn weights (16/16/16/16/16/20) | `TileTypes.TILE_TYPES` | skull weight ↑ → more ambient damage both ways, fewer color matches → slower skill economy |
| Matched-skull slope (`/3`) | `calculateMatchedSkullDamage` | global attack sensitivity of skull damage |
| Destroyed-skull step (`⌊A/3⌋`) | `calculateDestroyedSkullDamage` | value of destroy-skills & explode relics at high attack |
| Extra-turn threshold (4+) | `MatchResolver.analyzeMatches` | THE tempo knob; touching it re-tunes everything |
| Magic→mana divisor (9) | `BattleController.MAGIC_MANA_PER_POINT` | Magic's economy channel strength |
| `DAMAGE_SCALE_PER_POINT` (1/3) & preset table | `scalingConfig` | global stat-scaling rate for all `scaling` effects |
| Poison decay (÷2) / tick timing | `BattleController` | poison archetype viability |
| Status multipliers (×1.5 / clamp 1 / ×2) | `STATUS_DAMAGE_MODS` | debuff/buff strength |
| Board size 8×8 | `TileTypes` | match density, cascade depth (drastic) |

### 4.2 Player-side levers

| Knob | Location |
|---|---|
| Base stats, starting mana, kits | `data/characters/*.js` |
| Growth per victory | `growthPlan` per character (+ `DEFAULT_GROWTH_PLAN`, `BattleScene.js`) |
| Skill numbers/costs | `data/skills/skillCatalog.js` |
| Relic numbers/rarities | `data/relics/relicCatalog.js` |
| Drop odds | `relicRewards.RELIC_RARITY_WEIGHTS` (legendary currently 0) |
| Reward count (3) | `relicRewards.generateRelicRewardOptions` |
| Woven-skill pricing | `skillSynthesizer.POWER` + `weaveConfig.MANA_COST_CONFIG` (K=1.7, clamp 3–15) + `TAG_VALUE_TABLES` |
| Loadout cap (8) | `playerStats.MAX_EQUIPPED_SKILLS` |

### 4.3 Enemy-side levers

| Knob | Location |
|---|---|
| Per-enemy baselines (hp/attack/armor/mana/kits/`attackScale`) | `data/enemies/act1/*.js` |
| Floor HP curve | `MapScene.ENEMY_HP_FLOOR_MULT` |
| Floor attack curve | `MapScene.ENEMY_ATTACK_FLOOR_BONUS` |
| Spawn gating | per-enemy `floors` + `type` + `rarity` weights (`enemies/index.js`) |
| Enemy relics | `data/relics/enemyRelicCatalog.js` |
| AI personalities | `enemyAiOverrides.js` (+ `MoveAdvisor.DEFAULT_WEIGHTS` for `smart_matcher`) |

### 4.4 Structural levers (bigger surgery)

Full-heal-per-fight (decision #17) vs attrition; extra-turn cap; relic stacking rules (currently
duplicates excluded only by ownership); the map's fight density (`MapGenerator` node-type mix →
effective growth rate); acting order (player always first).

---

## 5. The analytic value model (fast screening) **[MODEL]**

Reduce every output to **DEV** (damage-equivalent value), then compare per mana / per turn / per pick.
Calibration constants (all editable in the toolbench "Calibration" panel):

| Resource | DEV | Rationale |
|---|---|---|
| 1 damage | 1.0 | numéraire |
| 1 armor / 1 barrier | 0.9 | expires/overflows; per-fight |
| 1 heal | 0.8–1.0 | full value only below max |
| 1 poison stack | ≈ 2.0 raw, ≈ 1.4 effective | halving tail; absorbed by shields; needs fight length |
| 1 mana | **V_mana ≈ 2.0–3.0 × econEff** | = best V/mana skill it funds × usability |
| 1 extra turn | **V_turn = your own per-turn output** (floor ~4) | never a flat constant — compute per combatant |
| +1 Attack (permanent, in-fight) | ≈ remaining-turns × (skull matches/turn × N/3 + Σ skill `s.attack` casts) | convex in fight length |
| +1 Magic | same shape + ⌊M/9⌋ mana channel | re-check premium vs Attack (channel is /9 not /3) |
| 1 created tile | 0.3–1.1 | deferred mana; skull-created tiles scale with owner attack |
| +1 Max HP | ≈ marginal P(death) × run value | ~0 unless burst share is real (§3.5) |

**Skill screening rule** (from sim-validated findings, still holds): a *pure damage* skill needs
≈ **1.6 dmg/mana** to beat skull-matching for a caster archetype, ≈ 2.5 to be build-defining; skills
bundling `extra_turn` may sit under that; keep workhorses cost 3–6. Target band **V/mana ∈ [2.5, 3.5]**
at reference stats for payoff skills; cheap utility (Arcane Inscription) is allowed below band.

**Power scalar** for a whole combatant: `Power = √(eDPS × eHP)` (Lanchester) — A beats B in a
deterministic attrition race iff `eDPS_A·eHP_A > eDPS_B·eHP_B`. Good for beam-balance verdicts and
budget derivation; blind to variance, burst clustering, and phase mechanics — which is why §6 exists.

**Where the analytic model lies to you** (use sim instead): tempo compounding (extra-turn chains),
board-state feedback (skull floods, locks, disease clutter), threshold effects (lethal one-shots,
egg phase), economy denial (drains), and anything conditioned on rare events.

---

## 6. Measuring TRUE power — operational definitions **[MEASURE]**

These are the definitions the toolbench implements. The unit of ground truth is always the same:
**a Monte-Carlo batch of full battles on the real board** (real `BoardModel` + `MatchResolver` +
greedy 1-ply AI equivalent to the shipped `EnemyAI`, both sides), reported as *win rate*, *turns*,
*HP-left*, *DPT*, and *per-source damage shares*.

### 6.1 Reference frames (hold these fixed when measuring anything)

- **Reference player at floor F:** a character def + growthPlan applied for `⌊(F−1)×winsPerFloor⌋`
  victories + (optionally) R median relics. Default: Warrior, winsPerFloor 0.7, no relics.
- **Reference enemy at floor F:** the actual spawn table's median enemy at F, floor-scaled.
- **Reference fight-length targets:** minion 6–10 turns, elite 12–18, boss 20–30.
- **Reference win-rate bands:** minion 85–95%, elite 65–80%, boss 45–65% (at-floor, median build).

### 6.2 Stat point value

`value(+1 stat) = Δwin% and ΔTTK` from a sweep of that stat on the reference player vs a fixed
reference enemy. Report the **marginal curve** (it's never flat — Attack has steep diminishing
returns; last measured exchange: +1 Attack ≈ +9–10 HP at attack 1–3, decaying to ~6–7 by attack 6).
Growth-plan design rule: both axes every win; keep the implied exchange within ~±30% of the measured
curve at mid-run stats.

### 6.3 Skill power

Three numbers, in order of authority:
1. **Sim uplift:** win%/TTK delta when the skill is added to (or swapped into) the reference kit,
   measured at the floor band where it's obtainable. **AUTOMATED catalog-wide by the trainer
   (`node sim/toolbench/trainer.mjs skills`)** — paired common-seed batches per (skill, host, frame),
   reported as ΔWin ± CI, **eqHP** (ΔWin ÷ the measured local win-per-HP slope — a saturation-proof
   currency), Δcasts (≈0 = the greedy policy never fired it → unmeasured, not weak), plus the
   analytic score alongside with UNDER-/OVER-SCORED rank-disagreement flags.
2. **dmg/mana vs the 1.6 / 2.5 thresholds** (pure-damage component only).
3. **Analytic V/mana** (full DEV ÷ cost) vs the [2.5, 3.5] band.
The synthesizer's POWER table prices the same effects for woven skills — when you re-tune DEV
constants, re-align POWER (they drifted once already; see `balance-changes-2026-06-23.md` §5).

### 6.4 Enemy power & budgeting

- **Difficulty** = 1 − win% of the reference player at each of the enemy's legal floors, plus
  TTK and **burst share** (max single-turn damage ÷ player HP; keep ≤ ~45% for minions, ~60% elites).
- **Budgeting a new enemy at floor F:** `HP_baseline ≈ (playerDPT(F) × targetTurns) / HP_MULT[F−1]`,
  `attack_baseline ≈ target burst − ATK_BONUS[F−1] − ramp allowance`. playerDPT(F) is measured, not
  assumed (toolbench reports it per floor). Armor ≈ +N HP against chip, stronger vs many-small-hits.
- Any within-fight ramp (gain_attack, echo, disease) must be sim-checked at the enemy's **highest**
  legal floor with target turns +50% (slow players must not hit an unwinnable wall — the pre-nerf
  boss failure mode).

### 6.5 Relic power

`Δwin% when granted to the reference player at floor of typical acquisition` + DEV/fight from trigger
frequencies (measured: 4+/turn ≈ 0.2, hits-taken/turn ≈ 1, damage-instances/turn ≈ 2, fight ≈ 7
turns). Rarity should track measured uplift bands, roughly: common ≤ +3pp, uncommon +3–6pp,
rare +6–12pp, legendary > 12pp (or run-warping). Anything unbounded (per-turn/per-event permanent
attack) must be measured at *elite/boss fight lengths*, where it's at its strongest.

### 6.6 Character / whole-build power

Full-run simulation: floors 1→10 with the real spawn table, growth per victory, relic drops at real
rarity weights → run win %, death-floor histogram, per-floor TTK. This is the top-level health
metric; individual balance work should end with "run sim still lands in band".

---

## 7. Current reference numbers (measured baselines to re-derive after changes)

From the last calibrated sim pass (`balance-findings.md`, directionally re-confirmed by the analytic
model; re-measure in the toolbench after any primitive change):

| Quantity | Value |
|---|---|
| Skull matches / action (competent greedy) | ~0.3 |
| 4+ (extra turn) / action | ~0.2 |
| Cascade steps / action | ~1.2 |
| Mana / action | ~3.3–3.5 |
| DPT: attack-1 skull-only | ~1.0 |
| DPT: attack-3 + damage skills | ~2.4–2.7 |
| Fight length target bands | 6–10 / 12–18 / 20–30 turns |
| +1 Attack ↔ Max HP exchange | ≈ 9–10 HP early → 6–7 late |

---

## 8. Known distortions & data bugs (as of 2026-07-03)

1. **Unbounded in-fight attack engines still exist** — Tsunami (+2/turn), Scythe (+1/skull-match),
   Reckoning (+1/hit-taken), Cestus group (+1/3 unspent mana). Currently *quarantined by the
   legendary drop weight of 0* (Tsunami/Reckoning/Soul Eater unobtainable) — but Scythe/Cestus group
   are rare (weight 15) and live. Decide: bound them (diminishing returns past +N) or price them as
   rare-and-measured.
2. **Legendary weight 0 also blocks** Gorepike, Deathbringer, Soul Eater — probably unintended
   collateral. If intended, mark the rarity tier as "disabled" in data, not silently in a weight.
3. **`soul_eater` scaling preset `_10` doesn't exist** → heals flat 1. Add `_10: 0.1` to
   `DAMAGE_SCALING_PRESETS` or re-author.
4. **Magic's mana channel weakened to ⌊M/9⌋** but downstream prices still assume the old ⌊M/3⌋ story:
   synth `perMagic 2.5 > perAttack 2`, and Mage/WD growth plans bank on Magic. Re-measure Magic vs
   Attack point value (§6.2) and re-align.
5. **Color value spread** ~4× (yellow/Fracture top, blue/Defend + purple/Arcane bottom) — audit
   V/mana per color in the toolbench Catalog Audit and lift the floor or tax the ceiling.
6. **`slingshot` description says `<<1>>` but amount is 3** (display resolves live, so cosmetic only).
7. **Extra-turn value is invisible to players** and huge (§3.2) — a UI concern flagged since 06-23.
8. **Doomsong / skull-flood enemies** hand ambient damage to a high-attack player (skull floods are
   symmetric ammo) — Shadow Weaver / Acolyte get *weaker* against exactly the builds that scare them.
   Intended tension, but keep it measured.
9. **Boom Baby (999 @ 20 red)** is a pure timer; with Sulfur skewing yellow (ignition), its actual
   time-to-fire should be sim-verified per floor so it stays a dodge-able doom clock, not a coin flip.

---

## 9. The Balance Toolbench (`sim/balance-toolbench.html`)

The operational companion. Everything above that says [MEASURE] is a button there. Serve the repo
from its root — easiest: `node sim/toolbench/serve.mjs` (a dependency-free static server with correct
ES-module MIME) — and open `http://localhost:8123/sim/balance-toolbench.html`. Any other static
server works too (`npx serve`, `python3 -m http.server` if your Python maps `.mjs` to JS).
Deep links: `?tab=audit|run|sweep|designer|reference`, `?autorun=1` (auto-clicks the tab's primary action).
The battle engine (`sim/toolbench/engine.mjs`) also runs headless under node — smoke checks:
`node sim/toolbench/smoke.mjs`, `node sim/toolbench/smoke-analytic.mjs`, `node sim/toolbench/smoke-trainer.mjs`.

**The trainer (`sim/toolbench/trainer.mjs`, node CLI)** is the automated MEASURED-power harness on
top of the engine — the §6 sim-uplift definitions run catalog-wide:
`node sim/toolbench/trainer.mjs skills|relics|stats|all [--quick] [--n 240] [--floors 2,5,8]
[--hosts a,b|owner] [--skills ids] [--relics ids] [--out f.json]` → console table + JSON report in
`sim/toolbench/reports/`. Method: for every item, PAIRED batches (baseline kit vs kit+item) under
**common random numbers** (`rng.mjs` `withSeededRandom` — same seed ⇒ same board/refills until
decisions diverge, ~10× variance reduction; baselines cached and shared across items so everything
is measured on the same boards). Reports ΔWin ± 95% CI, **eqHP** (ΔWin ÷ measured win-per-HP slope
at that host/frame; unreliable when the frame is saturated — slope < 0.15pp/HP is skipped — or when
uplift is huge, it's a LOCAL linear estimate), Δcasts, and analytic-vs-measured rank-disagreement
flags (the "under-scored skill detector"; e.g. it flags `arcane_inscription` UNDER-SCORED — analytic
prices `convert_tile` flat while its real value is completing 4+/extra-turns). Caveats: measured
power = power **under the chosen play policy** (a skill the policy never casts measures ~0 —
surfaced as NEVER CAST). The engine's `Battle` opts expose a **policy seam**
(`playerPolicy`/`enemyPolicy` — cast/swap/pass + cast-hold + targeting override; engine header).

**The value-policy layer** (on top of the seam):
- **`policy.mjs`** — a linear, effect-FEATURIZED action evaluator (`makeValuePolicy(weights)`):
  argmax over every affordable cast + legal swap; swaps scored by a deterministic no-refill settle
  (BoardSimulator's "guaranteed outcome" philosophy); skills valued by their EFFECTS, not ids, so it
  prices unseen woven skills; side-agnostic. Sweeping with `--policy value` gives "competent hands"
  numbers and kills the greedy artifacts (measured: Encroach −24pp greedy → NEVER CAST value;
  Oungan −9pp greedy → +5pp value; Defend −4pp → +1pp). The greedy-vs-value uplift GAP per skill is
  itself a metric (skill expression). `DEFAULT_VALUE_WEIGHTS` is the interpretable training surface
  — each weight is "what X is worth, in damage units".
- **`train.mjs`** — CEM self-play trainer for that weight vector: population sampling → fitness =
  mean win on a FIXED common-seed task pool (floors with win-rate headroom, default 6/8/9, × all 3
  characters so it can't overfit a matchup) → refit to the top quartile, decaying noise;
  `--selfplay k` re-arms the ENEMY with best-so-far weights every k generations. Emits a weights
  JSON consumed by `trainer.mjs --weights` (sweeps) or `policy.mjs loadWeights` (code).
- **`trainer.mjs rescore`** — closes the loop back to the analytic model: ridge-fits per-effect-type
  DEV **correction multipliers** (prior = 1 = "analytic price is right") so the analytic per-effect
  decomposition predicts the sweep's measured eqHP; prints RAISE/LOWER suggestions + per-skill
  measured-vs-analytic ratios. It NEVER auto-edits `analytic.mjs`; when applying suggestions,
  re-align `SYNTH_POWER` / weaveConfig `POWER` (§5 drift contract).

| Tab | What it answers | Method |
|---|---|---|
| **Matchup Lab** | "Who wins this exact fight, how fast, and why?" | Monte-Carlo battles on the real board; win%, TTK dist, DPT, damage-source breakdown, verdict vs bands |
| **Run Simulator** | "Does a whole run land in band?" | full 10-floor runs w/ real spawn table, growth, relic drops; death-floor histogram, per-floor curves |
| **Sweep Lab** | "What is +1 of X worth? Where's the knee?" | one-knob sweeps (player stats, enemy curves, skill numbers) → marginal curves, HP↔Attack exchange |
| **Designer** | "Is my new enemy/skill/relic fairly budgeted?" | live editors + analytic DEV/V-per-mana + floor budget from measured DPT + one-click sim test + copy-paste catalog snippet |
| **Catalog Audit** | "Which existing content is out of band?" | every skill/relic/enemy scored analytically (and sim-spot-checkable), band flags |
| **Reference** | "What are the exact formulas/constants right now?" | live-imported constants + this doc's tables + editable calibration (DEV, V_turn, bands) |

Fidelity notes: the toolbench battle engine reuses the game's **actual** `BoardModel`,
`MatchResolver`, `TileTypes`, and catalogs via live ES-module imports (no copy drift for the board
math or the data), and re-implements the *turn/skill/passive layer* headlessly (1-ply greedy AI on
both sides matching `EnemyAI`'s priorities; the passive triggers used by shipped relics; statuses;
poison; egg-phase & Malakor Thrall engines approximated). Anything it can't model is listed per-item
in its UI rather than silently ignored. Treat relative deltas as the signal, absolutes as guidance —
same rule as always.

---

*After changing any constant in §2/§4: re-run the toolbench's baseline suite (Matchup Lab reference
fights + Run Simulator) and update §7's table. After adding content: run Designer → sim test →
Catalog Audit. Keep this doc's [CODE] tables in sync — they are the contract.*
