# Balance & Stat-Scaling Research

> **Status:** Research / planning only. No gameplay logic was changed to produce this document.
> **Scope:** Audit of the current combat math, then a first-pass value/scaling framework future work can build on.
> **Date:** 2026-06-03

---

## 0. TL;DR

- Combat is **stateless between fights**: HP, mana, armor, and attack all reset to full/starting each battle (`createPlayerBattleState`). Post-battle healing is wired but set to **0%** (`healPct = 0.0`). There is **no HP attrition across a run today**, which fundamentally changes what stats are worth.
- There is **no permanent stat progression**: `applyRunModifier()` exists but is **never called anywhere**. The only run-level reward currently granted is **relics** (appended to `runState.relics`). So today, the player gets stronger *only* via relics.
- There is **no enemy scaling**: CLAUDE.md decision #11 says "elite = 1.5× HP, boss = 2.5× HP" but **that code does not exist** — `_transitionToBattle` uses the enemy's flat definition stats verbatim. Difficulty currently comes only from which enemies are gated to which floors.
- **No boss enemy exists.** Floor 10 (the boss node) has no `type:'boss'` enemy and **no enemy lists floor 10 in its `floors` array**, so `selectEnemyForNode` falls all the way back to spawning a **Goblin**.
- **`Attack` is a niche stat.** It scales *only* skull-tile damage (matched + destroyed). It does nothing for skill damage, colored matches, or mana. Its value swings from "very strong" (skull-heavy play) to "near zero" (skill-only play).
- Several enemy data bugs exist (Stone Gargoyle `hp:60`/`maxHp:40`, Shadow Weaver duplicate `type`/`rarity` keys, Acolyte casts `doomsong` at 7 purple but starts with 0 mana).

---

## 1. Current Combat System Summary

### 1.1 Turn structure
- State machine: `TURN_INTRO → PLAYER_TURN ↔ ENEMY_TURN → RESOLVING → GAME_OVER` ([`BattleController.js`](../src/js/game/BattleController.js)).
- A turn is a single **action**: one swap (→ cascade) **or** one skill cast.
- **Extra turns** are granted by matching **4+ tiles** (any color or skull) or forming a **shape (L/T/cross) of 4+**. Extra turns are a **non-cumulative retain flag** (`_extraTurnEarned`), so you can chain consecutive actions but they don't "stack" into multiples.
- Cascades resolve fully (`SHOW_MATCH → REMOVE → FALL → re-analyze`) before the turn ends, so a single swap can chain matches.
- Pacing constants: `ENEMY_BASE_DELAY = 400ms`, `TURN_INTRO_DURATION = 600ms`, `speedMultiplier = 1.5`. These are *animation* timings, not balance levers.

### 1.2 Board & matching
- Board is **8×8 = 64 tiles** (`BOARD_COLS/ROWS = 8`).
- Six tile types, **base spawn weights**: red/blue/green/yellow/purple = **16 each**, skull = **20**. Total = 100, so each color ≈ **16%**, skull ≈ **20%**.
- Match = 3+ in a line; connected runs sharing exactly one tile merge into shapes (Union-Find).
- **Mana gain:** each matched **colored** tile grants **1 mana of its color** to the active side. A 3-match = 3 mana; a 4-match = 4 mana (+ extra turn). (`_doRemove`, line ~793.)

### 1.3 Damage formulas ([`MatchResolver.js`](../src/js/game/MatchResolver.js))
| Source | Formula | Notes |
|---|---|---|
| **Matched skull group** | `skullCount + max(0, attack − 1)` | At attack 1, a 3-skull match = **3 dmg**. Each extra attack point = **+1 dmg per skull match**. |
| **Destroyed skull** (skill/explode, non-match) | `skullCount × (1 + floor(attack / 3))` | Attack 1–2 → 1/skull; 3–5 → 2/skull; 6–8 → 3/skull. Step function. |
| **Skill `damage` effect** | flat `effect.damage.amount` | **Independent of Attack stat.** Bash = 5, Slash = 5, etc. |
| **Relic `damage` w/ no amount** | falls back to `caster.attack` | e.g. Briarthorn. |

> **Key insight:** the `Attack` stat ONLY influences skull damage. Skill damage is flat. So "Attack" is really "skull-match power," not a general damage stat.

### 1.4 Defense / armor ([`MatchResolver.applyDamage`](../src/js/game/MatchResolver.js:173))
- Damage is absorbed **armor → block → HP**, all 1:1 and linear.
- **Armor is consumed** as it absorbs and does **not regenerate** unless re-applied (Defend skill, Aegis/Goblin Totem relics each turn).
- `block` is a transient per-resolution shield; no current source sets it as a starting stat.
- HP, armor, and block all **reset each battle** — nothing carries over.

### 1.5 Mana economy
- Skills cost specific colors (e.g. Bash = 5 red, Oungan = 6 green). To afford a 5-cost skill you need ~2 matches of that color (≈ 1.5–2 turns of building, given ~16% spawn per color).
- Starting mana front-loads the first skill: Warrior starts with **5 blue** (immediate Defend), Mage **3 purple**, Witch Doctor **3 green + 1 purple**.
- Mana persists within a battle but resets between battles.

### 1.6 Enemy AI ([`EnemyAI.js`](../src/js/game/EnemyAI.js))
Priority (board-scoring weights): **any 4+ match (+10000, dominates)** > skull damage (+100/dmg) > affordable damage skill (+200) / defensive skill (+120) > mana for own skills (+12/tile) > deny player mana (+4/tile) > base mana (+5/tile). Skills checked before swaps; damage skills preferred. Custom overrides exist for Goblin Sapper & Chokeweed.

---

## 2. Current Stat Inventory

### 2.1 Player characters
| Char | Max HP | Attack | Armor | Starting Mana | Skills | Starter Relic |
|---|---|---|---|---|---|---|
| Warrior (Thorgrim) | **30** | 1 | 0 | 5 blue | Bash (5 dmg + extra turn, 5 red), Defend (5 armor + 3 blue, 5 blue) | Family Crest (take dmg → +2 red) |
| Mage (Shylana) | **25** | 1 | 0 | 3 purple | Fracture (destroy row + 5 purple, 5 yellow), Arcane Inscription (1 tile→yellow, 3 purple) | Unstable Catalyst (4+ → explode r1) |
| Witch Doctor (Kalfou) | **25** | 1 | 0 | 3 green + 1 purple | Summon Dead (yellow→skull, 4 purple), Oungan (heal 5 + 3 green, 6 green) | Evil Eye (−1 dmg taken) |

All characters start at **Attack 1, Armor 0**. HP spread is tight (25–30).

### 2.2 Enemies (Act 1 — the only act)
| Enemy | Type | Floors | HP | Atk | Armor | Mana | Notable |
|---|---|---|---|---|---|---|---|
| Goblin | minion | 1–2 | 18 | 1 | 0 | none | Slash (5 dmg, 5 red), Goblin Totem (+1 armor/turn) |
| Orc | minion | 1–3 | 24 | 3 | 0 | none | no skills/relics — pure auto-attacker |
| Acolyte | minion | 1–2 | 20 | 1 | 0 | none | Doomsong (10 skulls, **7 purple — can't afford, 0 mana**) |
| Goblin Sapper | minion | 3–7 | 16 | 2 | 0 | none | Boom Baby (999 dmg + die, 20 red), Ignition; Sulfur (+15pp yellow) |
| Goresnout Trackers | minion | 4–8 | 30 | 2 | **10** | none | Hound (+1 atk + 2 dmg, 3 red), Goresnout Collars (echo dmg ×2) |
| Chokeweed | minion | 3–9 | 30 | 2 | 0 | none | Encroach (free +1 atk); Briarthorn (turn-start dmg = atk), Sap |
| Cyclops | minion* | 5–9 | 45 | 3 | 1 | none | Boulder Throw (10 dmg, 6 grn), Smash (10 dmg + extra turn, 6 red) |
| Orc Taskmaster | elite | 5–9 | 50 | 4 | 0 | none | Charge (10 dmg+5 red+extra), Frenzy (10 armor+5 blue+extra) |
| Shadow Weaver | elite* | 5–9 | 60 | 5 | 10 | none | Slash; Cursed Idol (4+ → 1 dmg) |
| Stone Gargoyle | elite | 5–9 | **60/40** | 3 | 10 | none | Slash; Goblin Totem. **`hp:60` vs `maxHp:40` bug** |

\* Data inconsistencies: Cyclops `className:'Elite'` but `type:'minion'`; Shadow Weaver has duplicate `type` keys (`rare`→`minion`→`elite`; JS keeps the last, so `type:'elite'`).

**No `type:'boss'` enemy exists, and no enemy lists `floors:[10]`.** Floor 10 spawns a Goblin via fallback.

### 2.3 Relics (player pool) — value spread
- **Static stat:** Claymore (+3 atk, common), Aegis (+1 armor/turn, common).
- **Spawn rate:** Flint/Dewstone/etc. (+10pp of a color, common), Catacomb Key (+10pp skull, common).
- **Mana gain:** Bellows/etc. (+1 mana per matched color, common), Familiars (+1 fixed-color mana per 3+ match, common).
- **Mana→damage reactors:** Flaming Arrow/etc. (1 dmg per color-gain event, common).
- **Per-turn:** Slingshot (1 dmg, common), Alabaster Flask (heal 1, common), Tsunami (+2 atk/turn, **legendary**), Soul Eater (+3 life on deal dmg, legendary).
- **Reactive:** Trebuchet (1 dmg on 4+, uncommon), Prism (1 of each mana on 4+, rare), Blighted Hook (drain on 4+, uncommon), Reckoning (+1 atk on take dmg, legendary).
- **Dynamic attack:** Cestus/Harpoon/Club/Stiletto/Wand (+1 atk per 3 unspent mana of a color, **rare**).
- **Board destruction:** Gorepike (destroy row on 4+, legendary), Deathbringer / Death Familiar (destroy skulls), Unstable Catalyst (explode r1 on 4+, starter).
- **Potions:** +3 starting mana of a color (common).

**Reward weighting** ([`relicRewards.js`](../src/js/data/relics/relicRewards.js) `RELIC_RARITY_WEIGHTS`): common 100, uncommon 45, rare 15, legendary 4, starter 0. A given common is ~25× as likely as a given legendary. Starter relics are excluded from rewards.

---

## 3. Stat Value Analysis

> **⚠️ Superseded for stat-selection purposes.** §3–§4 below are the original flat-value first pass (a constant "+1 Attack ≈ 4 HP"). That constant is *wrong as a single number* — Attack's value is continuous and scales with fight length. For character stat-selection, enemy tuning, and skill design, use **[Part II (§11–§14)](#part-ii--refined-decision-based-value-model)**, which is built on the confirmed run model (full heal, Attack = skull-only, one stat pick/floor) and a power-based (EHP × DPT) framework. §3–§4 are kept for reference / the relic-rarity discussion.

### 3.1 Methodology & the big caveat
Because **HP fully resets every fight** and there's **no permanent stat progression wired**, the "correct" valuation depends on which run model you intend going forward:

- **Model A (current code):** every fight independent, full reset. → Defensive stats only matter *within* the hardest single fight; "build a snowball" stats (attack/spawn/mana engine) dominate because offense ends fights faster and survival is per-fight.
- **Model B (intended roguelike):** HP carries over, permanent upgrades accrue. → Defensive stats become much more valuable (attrition), and the values below shift toward HP/armor.

The framework below assumes **Model B** (the genre-standard, and where you're clearly headed), and flags where Model A differs.

I anchor everything to one unit: **1 EHP (effective health) = 1 point**, and estimate offense in "damage dealt," converting damage→points via the fight's offense/defense exchange rate (dealing enough damage to end the fight one enemy-turn sooner saves ≈ one enemy hit of EHP).

### 3.2 Per-stat estimates

**+1 Max HP → ~1.0 point.** Pure EHP. The anchor.

**+1 starting Armor → ~1.0 point (Model B) / ~1.0 point one-time (Model A).** Linear 1:1 absorption, same as HP. Slightly *worse* than HP long-term because spent armor can't be healed back (HP can, via Oungan/Soul Eater/Flask), and slightly *better* against many small hits since it's a clean buffer. Net: treat as **≈ HP, marginally below.**

**+1 Attack → ~3–6 points, but conditional.**
- Only scales skull damage. In a skull-matching build, +1 attack ≈ +1 damage per skull match. Over a ~6-turn minion fight with ~1 skull match/turn, that's ~+6 damage ≈ ending the fight ~1–2 enemy-turns sooner ≈ ~3–6 EHP saved.
- In a **skill-only / colored-match build, +1 attack ≈ 0.** This variance is the single biggest balance liability in the current design.
- The destroyed-skull formula's `floor(attack/3)` means attack only helps explode-style effects at thresholds 3/6/9 — uneven, breakpoint-y.

**+1 starting Mana → ~1–1.5 points (one-time).** Saves ~1 matched tile of building toward your first skill. It's a **front-loaded tempo gain**, not recurring — worth a fraction of a skill cast, once per battle. Value rises if the character's opener is gated on a specific color (Warrior's 5 blue = an immediate Defend).

**+1 flat skill `damage` → ~2–4 points (recurring).** Unlike Attack, this applies to the skill every time it's cast, unconditionally. If a skill is cast 2–4× per fight, +1 damage ≈ +2–4 total damage. Worth notably more than +1 starting mana and more reliable than +1 Attack.

**+10pp tile spawn chance → ~8–15 points (engine multiplier, build-defining).** Going 16%→26% for a color (or 20%→30% skull) is a **~50–60% relative increase** in how often you hit that resource. If that resource funds your main loop, it multiplies your damage/mana throughput by ~1.5× for the whole fight (and whole run). This is closer in power to a strong relic than to a flat stat, and its value is highly build-dependent.

### 3.3 Value comparison table

| Stat change | Value (points, Model B) | Recurrence | Conditionality |
|---|---|---|---|
| +1 Max HP | 1.0 | persistent buffer | none |
| +1 starting Armor | ~1.0 (slightly < HP) | one battle, consumed | none |
| +1 Attack | 3–6 | per skull match | **high** (skull builds only) |
| +1 starting Mana | 1–1.5 | one-time tempo | low (color-gated openers) |
| +1 flat skill damage | 2–4 | per cast | low |
| +10pp spawn (key color) | 8–15 | whole fight ×1.5 | **high** (build) |
| +1 armor/turn (Aegis) | 3–8 | per turn | none (scales w/ fight length) |
| +2 attack/turn (Tsunami) | 15–40 | per turn, compounding | medium (skull) |

---

## 4. Suggested First-Pass Conversion Ratios

Round numbers for designing upgrades/rewards. These are deliberately simple anchors, not simulation output.

```
1 Max HP            = 1.0  (anchor)
1 starting Armor    ≈ 1.0 Max HP        (≈ 1:1; treat armor a hair cheaper)
1 Attack            ≈ 4   Max HP        (skull-build assumption; ~0 otherwise)
1 starting Mana     ≈ 1.5 Max HP  ≈ 0.4 Attack   (one-time tempo)
1 flat skill damage ≈ 3   Max HP  ≈ 0.75 Attack
+10pp spawn rate    ≈ 10  Max HP        (build-defining; widen to taste)
```

Reverse view of the questions asked:
- **+1 Attack ≈ +4 Max HP** (in a skull-leaning build; flag near-0 otherwise).
- **+1 starting Mana ≈ ~0.4 Attack**, i.e. **~2–3 starting Mana ≈ 1 Attack**.
- **+1 starting Armor ≈ +1 Max HP** (≈ 1:1).
- **+1 damage (skill) ≈ ~3 starting Mana**, and clearly stronger than +1 starting Mana because it recurs.
- **Armor vs HP:** essentially equal as a flat starting stat; HP edges ahead long-term because it's healable.

> ⚠️ Before locking these in, decide **Model A vs Model B** (§3.1). If HP does not carry between fights, halve the value of HP/Armor relative to offense.

---

## 5. Suggested Player Scaling Model

### 5.1 Establish a baseline budget
Define a single "**power point**" budget (using §4 units) that a character should gain per milestone. Tune the *budget*, then spend it on whatever stat/relic mix using the conversion ratios.

Suggested per-event budgets (Model B, ~30-HP baseline characters, ~10 floors/act):

| Source | Power points | Typical concrete form |
|---|---|---|
| Normal fight | 6–10 | one relic (most fights) OR small stat bump |
| Elite fight | 12–20 | one strong relic + small stat, or stat choice |
| Boss | 25–40 | guaranteed rare+ relic + max-HP bump |
| Event / rest | 5–15 | heal, or stat choice, or shop |
| Chest | 8–15 | relic or gold→relic |

### 5.2 When should permanent stats increase?
- **Recommendation: progression should come from rewards, not from "every floor" auto-scaling.** Auto-per-floor growth makes builds feel samey; reward-gated growth preserves roguelike decision-making. Use a small guaranteed max-HP bump on **bosses only** (e.g. +5–10 max HP) so long runs feel like the character toughens.
- **Wire `applyRunModifier` into the reward flow.** It's the intended mechanism and is currently dead code. Reward screens should be able to offer "+N Max HP", "+N starting mana of X", etc. via `applyRunModifier(runState, path, amount)`.
- **Reconsider HP reset.** The current full-reset + 0% post-battle heal means defense is nearly worthless across a run. Pick one:
  - *Persistent HP + heals* (classic Slay-the-Spire feel): set `createPlayerBattleState` to seed `hp` from `runState.currentHp`, restore `_applyPostBattleHealing` to a real value (e.g. 20–30% on normal, full on rest), and add HP rewards.
  - *Per-fight reset (current)*: then drop HP/armor rewards entirely and lean into offense/engine upgrades — but this removes a whole class of decisions.

### 5.3 Suggested concrete increments (if Model B)
- Normal fight: relic only (no flat stat) most of the time.
- Elite: choice of {+8 Max HP} / {+2 Attack} / {relic}.
- Boss: +8 Max HP (auto) **and** a rare-weighted relic.
- Rest node: heal 30% max HP **or** a small permanent +HP.

---

## 6. Suggested Enemy Scaling Model

### 6.1 Current state
Enemies are **hand-authored flat stats gated by `floors`**. There is **no multiplier scaling** (the CLAUDE.md 1.5×/2.5× claim is not implemented). This is actually a reasonable foundation — hand-authored tiers age better than blind multipliers.

### 6.2 Recommendation: **hand-authored tiers with a light per-floor curve**
- Keep the per-enemy authored stats as the **tier baseline**, but add a small, transparent **floor multiplier** applied at spawn in `_transitionToBattle` so the same enemy on floor 8 is tougher than on floor 4. Suggested gentle linear curve:
  - `hpMult = 1 + 0.08 × (floor − firstFloor)` (≈ +8%/floor), `atkMult` flatter (≈ +4%/floor, rounded).
  - Keep multipliers **mild** so authored numbers stay meaningful; avoid exponential (it makes mid-run balance brittle and snowbally).
- **Player power curve sets the target.** If the player gains ~10 power points/floor, enemies should gain roughly the same in EHP+threat terms. Target: a same-tier minion should always be ~the same number of turns to kill regardless of floor (see §7), so HP should scale with the player's offense growth.

### 6.3 Per-stat enemy guidance
- **HP:** primary difficulty lever; scale with player offense growth (linear/tiered).
- **Attack:** scale slowly — enemy attack is raw per-turn damage to the player and gets lethal fast. +1 enemy attack ≈ a large EHP swing for the player. Prefer 2–5 across Act 1, not steep growth.
- **Armor:** great for *pacing* (forces the player to invest more matches/skills) without spiking lethality. Goresnout/Gargoyle's 10 armor is a good "tanky" archetype. Use armor for defensive enemies rather than cranking HP+attack together.
- **Mana/skills:** enemies with `0` mana that own mana-costed skills (Acolyte's Doomsong at 7 purple) effectively **never cast** — either give them starting mana or a cheaper/free skill. Audit each enemy's skill affordability.

### 6.4 Bosses (mathematically distinct)
- **Build an actual `type:'boss'` enemy on floor 10.** Currently broken (spawns a Goblin).
- Bosses should differ by **kind, not just bigger numbers**: high HP (≈ 3–4× a same-floor minion), a multi-turn threat pattern, and a signature mechanic (e.g. armor regen, board sabotage like Doomsong, or escalating attack like Tsunami/Encroach). Target ~20–30 player turns.
- Avoid the "extra-turn loop" trivializing bosses: ensure boss HP is high enough that a lucky 4+-match chain doesn't end it in two actions.

---

## 7. Combat Pacing

### 7.1 Current (estimated)
- Player effective output ≈ **3–5 damage/turn** early (mix of ~3 skull-match dmg and skill payoff), more with cascades/extra turns.
- Minion HP 16–30 → **~4–8 player actions** (often fewer with extra-turn chains). Feels **fast/compressed**, especially floor 1–2 (16–24 HP).
- Elites 45–60 HP → **~10–16 actions**. Reasonable.
- The **extra-turn-on-4+** mechanic makes pace **swingy**: a hot board can chain several actions and burst an enemy down; a cold board stalls.

### 7.2 Targets (recommendation)
| Encounter | Target player actions |
|---|---|
| Normal minion | 6–10 |
| Elite | 12–18 |
| Boss | 20–30 |

### 7.3 Compressed or inflated?
- **Minion HP is too compressed** at the low end (16–24). Bump floor-1 minions toward ~22–28 so the player gets to make a few meaningful decisions.
- **Player HP (25–30) is reasonable** for a per-fight model; if HP persists, it may feel low against attack-4/5 elites (a 5-attack enemy 2-shots ~10 HP/turn).
- **Damage values are NOT inflated** — they're small integers, which is good for readability. The risk isn't inflation; it's **variance** from extra-turn chaining and the binary value of Attack.

---

## 8. Reward / Relic Scaling Model

### 8.1 How strong should relics be vs flat stats?
Relics should generally be **worth more than a single flat-stat upgrade** of the same rarity, because they cost a reward slot and often define a build. Rough targets in §4 power points:
- **Common relic:** ~6–12 points (≈ a flat stat upgrade or slightly more). e.g. Claymore (+3 atk ≈ 12) is a *strong* common — arguably uncommon-tier.
- **Uncommon:** ~12–20.
- **Rare:** ~20–35 (often scaling/synergy: dynamic attack, Prism).
- **Legendary:** ~35+ and/or run-defining (Tsunami's +2 atk/turn compounds enormously; Soul Eater's sustain; Gorepike's row destruction).

### 8.2 Should relics be categorized by expected numeric value?
**Yes — and the current rarities are loosely off.** Recommend an explicit power-budget pass per relic:
- Likely **under-rarified (too strong for tier):** Claymore (+3 atk, common), the spawn-rate relics (build-defining ~10+ points, marked common), Aegis (scales with fight length).
- Likely **fine:** Familiars, Potions, single-point reactors (Slingshot, Trebuchet).
- **Scaling relics** (Tsunami, Cestus-group, Reckoning) are correctly high rarity — their value grows with fight length / unspent mana, so they're worth more in long (elite/boss) fights.
- Action item: assign each relic an estimated point value (§4 units) and re-sort rarity so within a tier, values cluster.

### 8.3 Starter vs reward relics
- Starter relics (Family Crest, Unstable Catalyst, Evil Eye) are **excluded from the reward pool** and are tuned as modest, identity-setting effects — appropriately **weaker** than reward relics. This is correct; keep starters in the ~4–8 point range.
- Evil Eye (−1 dmg taken) is quietly strong against many-small-hits enemies; fine as a starter but note it's near uncommon value.

### 8.4 Drop-rate knob
`RELIC_RARITY_WEIGHTS` (common 100 / uncommon 45 / rare 15 / legendary 4) is the single tuning table. Once relic values are re-bucketed (§8.2), these weights are the right lever for run power curve. Consider **boss/elite-specific weight overrides** (the code already supports a `rarityWeights` override) to make elites/bosses offer richer odds.

---

## 9. Risks & Unknowns

1. **Run model undecided (biggest risk).** Every value in §4 hinges on whether HP/progression persist. Resolve §3.1 / §5.2 *first* — it changes whether defense matters at all.
2. **`Attack` is bimodal.** It's worthless to non-skull builds and strong to skull builds. Any "+Attack" reward will feel great or dead depending on build. Consider making Attack also add a small flat bonus to skill damage, or splitting "skull power" from a general "attack."
3. **Extra-turn variance.** 4+-match chaining can trivialize or stall fights. Pacing targets (§7) assume average boards; worst/best cases diverge a lot. Simulation needed to confirm.
4. **No simulation data.** All numbers here are analytic estimates. A headless battle simulator (run N auto-played fights, log turns-to-kill and damage-per-turn per character/relic) would convert these guesses into measured curves. Strongly recommended before a real rebalance.
5. **Enemy skill affordability not validated.** Several enemies own mana-costed skills with 0 starting mana and weak mana generation — their intended threat may never fire.
6. **Stale/missing systems:** no boss (floor 10 → Goblin), no enemy scaling, 0% post-battle heal, `applyRunModifier` unused, data bugs (Gargoyle HP, Shadow Weaver duplicate keys, Cyclops type label). These distort any live playtest used to "feel out" balance.

---

## 10. Specific Recommendations for Future Implementation

In rough priority order:

1. **Decide the run model (Model A vs B).** Document it. Everything else follows.
2. **Fix the structural gaps** that distort balance testing:
   - Add a real `type:'boss'` enemy with `floors:[10]`.
   - Ensure every floor has a valid enemy pool (no fallback-to-Goblin).
   - Fix Stone Gargoyle `hp/maxHp`, Shadow Weaver duplicate keys, Cyclops type.
   - Audit enemy skill affordability (starting mana vs skill cost).
3. **Wire progression:** call `applyRunModifier` from the reward/upgrade flow; let reward screens offer stat upgrades, not just relics.
4. **Pick the HP behavior:** either persistent HP + meaningful post-battle heal, or commit to per-fight reset and drop defensive rewards.
5. **Add a light, transparent enemy floor curve** (§6.2) on top of authored tiers — mild linear, not exponential.
6. **Re-budget relics by point value** (§8.2) and re-sort rarities; consider boss/elite reward weight overrides.
7. **Address Attack's bimodality** (§9.2) — make it less of a dead stat for non-skull builds, or rename/reframe it as skull-specific.
8. **Build a headless combat simulator** to replace the estimates in §3–§4 with measured turns-to-kill / DPT curves before any numeric rebalance ships.
9. **Re-tune minion HP upward** at floors 1–2 (§7.3) toward the 6–10-turn pacing target.

---

### Appendix A — Key constants & locations
- Spawn weights: [`TileTypes.js:11`](../src/js/game/TileTypes.js) (colors 16, skull 20).
- Skull damage: [`MatchResolver.js:66,87`](../src/js/game/MatchResolver.js).
- Armor/block/HP: [`MatchResolver.applyDamage`](../src/js/game/MatchResolver.js:173).
- Mana per match: [`BattleController.js:793`](../src/js/game/BattleController.js).
- Stat resolution: [`playerStats.js`](../src/js/data/playerStats.js) (`getEffectivePlayerStats`, `createPlayerBattleState`).
- Run modifiers (unused): [`playerStats.applyRunModifier`](../src/js/data/playerStats.js:183).
- Post-battle heal (0%): [`BattleScene.js:1432`](../src/js/ui/BattleScene.js).
- Enemy spawn: [`enemies/index.js`](../src/js/data/enemies/index.js) (`selectEnemyForNode`, `RARITY_WEIGHT`).
- Battle transition (no scaling): [`MapScene._transitionToBattle`](../src/js/scenes/MapScene.js:351).
- Relic reward weights: [`relicRewards.js:33`](../src/js/data/relics/relicRewards.js) (`RELIC_RARITY_WEIGHTS`).
- Enemy AI scoring: [`EnemyAI._scoreBoard`](../src/js/game/EnemyAI.js:142).

---

# Part II — Refined, decision-based value model

This part replaces §3–§4 for design purposes. It is built on three confirmed decisions:

| Decision | Choice | Consequence for the model |
|---|---|---|
| **HP recovery after a fight** | **Full heal** | Combat is *per-fight*. Max HP's only job is surviving one fight; no cross-run attrition. |
| **Attack scope** | **Skull damage only** (matched **and** destroyed). Individual skills may opt in to scaling off Attack. | Attack is a *continuous, build-dependent offense* stat, not a universal one. |
| **Stat increases** | **One meaningful pick per floor** (~9–10 picks/act) | Player power curve is steady and predictable → enemies scale on a smooth per-floor ramp. |

---

## 11. The core model: combat power = EHP × DPT

For a single fight, the player wins iff they kill the enemy before dying. Let:

- `H` = effective HP available *in this fight* = `maxHP + startingArmor + (healing over the fight)`
- `D` = damage dealt per turn (DPT)

A fight lasts `T = H_enemy / D_player` player turns; over that time the enemy deals ≈ `D_enemy × T`. The player survives iff:

```
H_player × D_player  >  H_enemy × D_enemy
```

So a combatant's strength is the **product** `P = H × D` (a standard Lanchester result). This is the whole framework. Its two partial derivatives give the marginal value of each stat:

```
value of +1 HP   ∝  D     (your current damage rate)
value of +1 DPT  ∝  H     (your current effective HP)
```

### 11.1 The exchange rate is NOT a constant — it scales with fight length

Dividing the two:

> **+1 DPT is worth `H/D` HP, and `H/D` ≈ the number of enemy turns you survive ≈ the fight length `T`.**

This is exactly the intuition that "+1 Attack ≈ 4 HP" got wrong. A point of HP is *always* worth 1. A point of DPT is worth **T** — so in a long fight (elite/boss, T ≈ 12–25) a DPT point is worth far more than in a short one (T ≈ 6–8). Offense compounds; defense doesn't.

### 11.2 The full-heal consequence (the most important design fact)

Under full heal, HP **only** has value up to the survival threshold of the fight. Any HP beyond "enough to survive the hardest fight" is wasted, because you refill to max afterward anyway. Offense has no such cap — it speeds *every* fight and matters most in the *hard* fights.

> **Therefore, under full heal, an all-offense build is strictly better than an all-HP build UNLESS the game keeps fights genuinely lethal.** If a balanced player routinely ends fights at 80%+ HP, nobody should ever pick HP.

The fix is **not** to nerf offense — it's to **tune enemy damage so that low-HP builds are at real risk** (§13.3). HP then becomes meaningful *insurance*: the value of HP is the probability it saves you from a deadly fight × the cost of losing the run. This is why the enemy-attack numbers in §13 are calibrated against the *glass-cannon* HP floor, not the average build.

---

## 12. Stat-selection exchange rates (HP vs Attack vs Armor)

Currency: **HPe** = 1 HP-equivalent = 1 point of player effective HP ≈ 1 point of damage dealt (near parity in a competitive fight; see §11).

### 12.1 Max HP and starting Armor

- **+1 Max HP = 1.0 HPe** (the anchor) — but only *realized* up to the survival threshold (§11.2).
- **+1 starting Armor ≈ 1.0 HPe**, marginally below HP. Both reset/refill each fight, both absorb **all** damage types (skull, skill, relic ping — HP/armor are *universal* defense, which Attack is not). Armor's only downside vs HP: spent armor can't be healed back mid-fight and overkill on a hit is wasted; HP can be topped up by Oungan/Soul Eater/etc. Treat **1 Armor ≈ 0.9 HP** for selection purposes.

### 12.2 Attack

`+1 Attack` adds `+1` damage per skull **match group** (matched formula `n + (A−1)`) plus step gains on destroyed skulls. In DPT terms:

```
ΔDPT per +1 Attack  ≈  m          (m = skull match groups you make per turn)
value of +1 Attack  ≈  m × T  HPe (m × fight length)
```

| Play style | `m` (skull matches/turn) | Normal fight (T≈8) | Elite/boss (T≈16) |
|---|---|---|---|
| Skill-only / ignores skulls | ~0.2 | ~1.6 HPe | ~3 HPe |
| Mixed (baseline) | ~0.5–0.6 | **~4–5 HPe** | ~8–10 HPe |
| Skull-focused | ~0.9–1.0 | ~7–8 HPe | ~15–16 HPe |

**Design point for stat picks:** assume the intended/mixed style, `m ≈ 0.6`, `T ≈ 8` → **+1 Attack ≈ 5 HPe**. So a per-floor pick of **"+5 Max HP" vs "+1 Attack" is roughly balanced for a mixed build**, with:
- Attack pulling ahead for skull-leaning builds and in long fights (elites/bosses), and
- HP pulling ahead purely as survival insurance against the deadliest fights.

That asymmetry is *good* — it's a real choice. To make it cleaner, pick a round offer the game uses everywhere, e.g. **"+6 Max HP" or "+1 Attack"** (HP slightly favored to compensate offense's long-fight scaling and full-heal edge).

> **Caveat — Attack is the highest-variance stat.** Its value swings ~3× with play style. Two levers if that variance is undesirable: (a) let signature skills scale off Attack (the user's "specific skills might be based off attack") so Attack always has an outlet, and/or (b) smooth the destroyed-skull step function `1 + floor(A/3)` into something continuous so Attack doesn't feel dead between breakpoints 3/6/9.

### 12.3 Quick reference

```
1 Max HP        = 1.0 HPe   (capped by survival threshold under full heal)
1 Armor         ≈ 0.9 HPe
1 Attack        ≈ m·T HPe   → design point ≈ 5 HPe   (range 1.6 – 16)
1 starting mana ≈ 1.0 HPe   (one-time; see §14)
1 flat skill dmg≈ 1.0 HPe × casts-per-fight   (recurring; see §14)
```

---

## 13. Fair enemy HP / Attack per act

Enemies are tuned to **hold fight length roughly constant** as the player's power curve rises, and to **stay lethal enough that HP is worth picking** (§11.2). Keep the current hand-authored-tier architecture; add a smooth per-floor ramp.

### 13.1 Player power curve (Act 1 baseline assumptions)

- Start: ~25–30 Max HP, Attack 1, baseline **DPT ≈ 3.5** HPe/turn (≈ all matched tiles convert to ~1 HPe each: colors→skill damage at ~1/mana, skulls→~1/skull at Attack 1).
- DPT grows with Attack and relics: `DPT(f) ≈ 3.3 + 0.5·f` (floor f = 1…9) → **~3.8 → ~7.8** across the act.
- EHP grows if the player spends picks on HP: `EHP(f) ≈ 28 + 3·f` for a roughly-balanced build; a **glass build stays near 28** all act (this is the lethality target).

> Re-derive these two curves for Act 2/3 by scaling the start point (e.g. Act 2 player starts where Act 1 ended). All enemy numbers below are **functions of the player curve**, not fixed forever.

### 13.2 Enemy HP — hold fight length constant

```
HP_normal(f) = round( DPT(f) × T_target )
   T_target:  normal 8,  elite 13,  boss 24
```

| Floor | Normal minion HP | Elite HP (floor ≥5) | Notes |
|---|---|---|---|
| 1 | ~30 | — | (current Goblin 18 is too low — see §7.3) |
| 2 | ~34 | — | |
| 3 | ~38 | — | |
| 4 | ~42 | — | |
| 5 | ~46 | ~75 | elites enter |
| 6 | ~50 | ~80 | |
| 7 | ~54 | ~85 | |
| 8 | ~58 | ~90 | |
| 9 | ~62 | ~95 | |
| 10 | — | — | **Boss ≈ 165–180 HP** (`DPT(10)≈8.3 × 24`) + a mechanic |

Current minions (16–30) are **under** this curve, especially floors 1–4; current elites (45–60) are also a bit low for 13-turn fights. Bosses don't exist and must be built (§13.4).

### 13.3 Enemy Attack / DPT — calibrate to the glass-cannon floor

Enemy DPT (to the player) should make a **low-HP build sweat** without routinely killing a balanced one. Target: a fight removes a fraction `k` of the *glass* build's ~28 EHP over its `T` enemy turns.

```
DPT_enemy ≈ k × EHP_glass / T      (EHP_glass ≈ 28 in Act 1)
   normal:  k ≈ 0.35  → ~1.2–1.6 DPT
   elite:   k ≈ 0.70  → ~1.5–2.0 DPT (longer fight, so per-turn stays low!)
   boss:    k ≈ 1.10  → ~1.3 DPT but over 24 turns ≈ 30+ chip, plus burst windows
```

Key point: **per-turn enemy attack should stay LOW and grow slowly** (Act 1 range ≈ **1–4**), because a long elite/boss fight multiplies it by `T`. Most enemy pressure should come from **skull matches** (which scale off the *enemy's* Attack via the same formula) and **periodic skills**, not a big attack stat. A boss that hits for 8/turn over 24 turns = 192 damage = unsurvivable; a boss that hits ~2/turn with a telegraphed ~15-damage burst every few turns is tense but fair.

Mapping to the stat: keep enemy **Attack 1–4** through Act 1; deliver spikes via skills (Slash 5, Smash 10+extra-turn, etc.) on a cadence the player can react to. Audit affordability — an enemy with a mana-costed skill and 0 mana/turn never threatens with it (Acolyte's Doomsong today).

### 13.4 Bosses are different in *kind*

- HP ≈ **3–4× a same-floor minion** (~165–180 in Act 1), tuned for ~20–30 player turns.
- Low-to-moderate sustained attack + **telegraphed burst windows** (so HP/armor and defensive relics have a clear job).
- A **signature mechanic**, not just bigger numbers: armor regen, board sabotage (Doomsong-style skull flood), or escalating Attack (Tsunami/Encroach-style ramp that *forces* a kill timer — this is also what keeps glass cannons honest).
- Guard against the **extra-turn loop**: HP must be high enough that a lucky 4+ chain can't end the boss in 2 actions.

### 13.5 Cross-act scaling

Scale per act by re-anchoring the player curve (§13.1), then re-applying §13.2/§13.3. **Linear-within-act, tier-step-between-acts** — avoid global exponential multipliers (they make mid-run balance brittle and overreward snowball builds). Rough rule: each act, the player's baseline DPT and EHP step up by the amount they gained over the *previous* act; enemy HP/Attack step with them.

---

## 14. Skill evaluation framework

A skill converts **mana (of specific colors) → effects**. Evaluate it in two steps: value the effects in HPe, then divide by what the mana *costs* you in tempo.

### 14.1 Effect value table (in HPe)

| Effect | HPe value | Notes |
|---|---|---|
| `damage X` | **X** | direct. |
| `armor X` / `heal X` | **X** | player EHP. Heal slightly less if it overheals; armor slightly less (§12.1). |
| `extra_turn` | **≈ 4** (≈ one baseline turn of output) | scale with baseline DPT; worth *more* than average because you take it when the board is hot / to chain. |
| `create_tiles N (useful color)` | **≈ 0.7 × N** | mana + cascade/extra-turn setup; less if the color is off-build. |
| `destroy_tiles / destroy_row` | **≈ 0.6–1.0 × tiles** | = mana gained + skull damage from any skulls hit (scales with Attack). |
| `convert_tiles (→skull)` | situational | sets up skull damage; value ≈ converted × Attack-scaled skull value on follow-up. |
| `gain_attack +1` | **≈ m × (T − t_cast)** | permanent-for-fight; front-loaded casts worth more (~5 HPe if cast early). |
| `drain_mana` / `gain_mana` | ≈ 1 HPe per mana | denial ≈ same value as gain. |

### 14.2 The cost anchor: **1 mana ≈ 1 HPe**

If you generate `g` mana/turn of a focused color and a baseline turn is worth ~`g` HPe of output, then **1 mana ≈ 1 HPe**. Validated against the game's vanilla skill, **Slash = 5 damage / 5 mana = exactly 1.0 HPe/mana**. So:

> A skill returning ≈ **1.0 HPe per mana** is "fair/vanilla." Player skills earn a premium (they bundle tempo/utility); rarer/signature skills earn more.

**Target ratio (total effect HPe ÷ mana cost), by role:**

| Role | Target HPe/mana | Rationale |
|---|---|---|
| Enemy / filler | **1.0** | vanilla exchange (Slash). |
| Standard player skill | **1.3 – 1.6** | player-favored; bundles a little tempo/utility. |
| Signature / rare / build-defining | **1.8 – 2.5** | rarer, higher opportunity cost, defines a playstyle. |
| Expensive "win button" (cost ≥ ~12) | **≥ 2.5, often spiky** | must over-deliver to justify long charge + variance + one-shot tempo (e.g. Boom Baby). |

### 14.3 Re-scoring the existing catalog (sanity check)

Using the tables above (`extra_turn = 4`, `create_tile = 0.7`, `armor/heal = 1:1`):

| Skill | Effects (HPe) | Cost | HPe/mana | Verdict |
|---|---|---|---|---|
| Slash | 5 | 5 | **1.0** | vanilla anchor ✓ |
| Bash | 5 + 4 (extra turn) = 9 | 5 | **1.8** | strong starter — fine (warrior's engine) |
| Defend | 5 armor + 2.1 (3 blue) = 7.1 | 5 | **1.4** | solid, on-target |
| Oungan | 5 heal + 2.1 (3 green) = 7.1 | 6 | **1.2** | a touch weak; bump heal to 6 or add a small effect |
| Fracture | ~6 (row destroy) + 3.5 (5 purple) = ~9.5 | 5 | **1.9** | premium (signature) ✓ |
| Smash | 10 + 4 = 14 | 6 | **2.3** | premium (elite) ✓ |
| Charge | 10 + 3.5 (5 red) + 4 = 17.5 | 7 | **2.5** | very premium (elite) ✓ |
| Boulder Throw | 10 + 4.2 (6 green) = 14.2 | 6 | **2.4** | premium (elite) ✓ |
| Hound | ~5 (+1 atk) + 2 = ~7 | 3 | **2.3** | premium per-mana, but tiny absolute cost → cheap ramp |

The catalog already clusters sensibly (vanilla ≈ 1.0, player skills 1.2–1.9, elite skills 2.3–2.5). Oungan is the one slightly-under-budget player skill.

### 14.4 Design recipe (to author a new skill or set damage/cost)

1. **Pick the role** → target HPe/mana ratio (§14.2).
2. **Pick the mana cost `C` and dominant color.** Bigger `C` = slower to charge and higher variance → push the ratio up (§14.2 last row).
3. **Budget = `C × ratio`** total HPe.
4. **Spend the budget** across effects via §14.1. (e.g. a standard 6-cost player skill at 1.5 ⇒ 9 HPe budget ⇒ "8 damage + a minor utility," or "5 damage + extra_turn," etc.)
5. **Color adjustments:**
   - *Single-color* cost is easier to afford (focused generation) → effectively stronger per mana; keep its ratio toward the low end of the role band.
   - *Split-color* cost is harder to assemble → allow the high end of the band.
   - Cost should sit in a color the caster actually generates / starts with, or the skill is dead (cf. Acolyte's Doomsong).
6. **Attack-scaling skills** (the user's note): a skill *may* read the caster's Attack (like Briarthorn's `damage` with no amount → falls back to `caster.attack`). Treat the Attack-scaled portion as `≈ Attack × (matches/uses)` HPe and re-check the ratio at the Attack value you expect mid-fight — these skills get stronger as the run progresses, so budget them at a *low* base ratio so they don't blow past the band late.

### 14.5 What "good" means, concisely

- **Worth building toward** iff HPe/mana ≥ ~1.0 (beats just swapping).
- **Good** at 1.3–1.6 with relevant utility.
- **Great** when it bundles **tempo** (`extra_turn`) or **flexibility** (targeted board control) on top of a fair rate — tempo is undervalued by the raw ratio because it compounds with the rest of your turn.
- **Color-affordability and on-build color matter as much as the raw number** — a 1.0-ratio skill in your main color beats a 1.5-ratio skill in a color you never match.

---

## 15. Answers to the specific questions (Part II)

- **"Is +1 Attack really only ~4 HP?"** No — that was a short-fight, neutral-play estimate. Correct model: **+1 Attack ≈ m × T HPe** (skull-matches/turn × fight length), ranging ~1.6 HPe (skill-only, short) to ~16 HPe (skull-focused, boss). Design point for a mixed build ≈ **5 HPe**; it's worth *more* than HP in long fights and skull builds, which is the "continuous value" you intuited.
- **HP shields skills + pings:** correct, and the model treats HP/Armor as **universal defense** (absorbs every damage source) while Attack is **conditional offense** (skull only). That asymmetry — not a flat point trade — is why they're priced differently.
- **Character stat picks:** offer **≈ "+6 Max HP" vs "+1 Attack"** per floor (HP slightly favored to offset offense's long-fight + full-heal edge). Armor ≈ 0.9 HP. Keep enemies lethal (§13.3) or HP picks become dead.
- **Fair enemy values per act:** §13 — enemy **HP = player DPT × target turns** (normal 8 / elite 13 / boss 24), **enemy Attack 1–4** with pressure from skull matches + telegraphed skills; bosses ~3–4× minion HP + a mechanic. All as functions of the (re-anchorable) player curve.
- **Skill value / damage / cost:** §14 — anchor **1 mana ≈ 1 HPe**, target ratio by role (vanilla 1.0 / player 1.3–1.6 / signature 1.8–2.5), budget = cost × ratio, spend via the effect table. Mana of a color is worth ~1 HPe *if the caster generates that color*; off-build color is worth far less.

> Note: all constants here (`m`, `T_target`, `extra_turn = 4`, `create_tile = 0.7`, ratio bands) are **tunable design points**, not measurements. The §9 recommendation stands: a small headless auto-battle simulator (log turns-to-kill, DPT, and skull-matches/turn per character) would convert `m`, baseline DPT, and `T` from estimates into measured values and let you lock the exchange rates precisely.

---

# Part III — Clean-sheet recommended values (derived from mechanics)

> The numbers currently in the code (character stats, skill damage/costs, enemy stats) are **placeholder mocks**. This part derives what they *should* be from the mechanics alone. Everything keys off one foundation — the **board economy** — so that's derived first; every other number is a function of it.

## 16. The foundation: the board economy

This is the single most important set of numbers in the game. **Measure these with a simulator before committing** (§9); the values below are reasoned estimates with explicit assumptions.

### 16.1 What one turn produces

| Quantity | Estimate | Reasoning |
|---|---|---|
| Tiles cleared per turn (incl. cascades) | **~5** | A directed swap usually makes a 3-match (sometimes 4–5); refills cascade ~1.3–1.5× → ~4–6 tiles. |
| Fraction the player can aim at one resource | **~60%** | Player agency: you steer toward your color or skulls, the rest is incidental. → **~3 "useful" + ~2 incidental** tiles/turn. |
| Focused mana generation (one color) | **~3 / turn** | the useful fraction aimed at a single color. |
| Baseline DPT at Attack 1 (skull matching) | **~3.5 HPe / turn** | ~3 skull tiles in ~1 match group → `3 + (A−1)` = 3 dmg, plus incidental → ~3.5. |
| 4+ match (extra-turn) rate | **~30% of turns** | a 4+/shape is achievable on roughly a third of turns if you look for it. |
| Effective action multiplier from extra turns | **~1.3×** | `1/(1−0.30)`; extra turns are the central tempo engine. |

### 16.2 Three constants that fall straight out

```
1 mana                ≈ 1 HPe         (a focused turn ≈ 3 mana ≈ 3 HPe of output)
extra_turn            ≈ 3.5–4 HPe     (= one baseline turn of output; worth slightly more, taken opportunistically)
skill breakeven       ≈ 1.15 HPe/mana (cost C charges in C/3 turns; must beat the ~3.5 DPT you'd get matching skulls instead)
```

> **Key dynamic this exposes:** at Attack 1, raw skull-matching (~3.5 DPT) is *competitive with cheap damage skills*. A skill at exactly 1.0 HPe/mana is slightly **below** breakeven — skills earn their place through **tempo (extra turns), burst, targeting, and not depending on skulls being on the board**, not through raw efficiency. As Attack rises, skull DPT climbs and the player naturally pivots toward skulls; skills must scale (cost-effective utility or Attack-scaling) to stay relevant. This interplay is healthy and should be preserved.

### 16.3 Two mechanics that shift these values

- **Skulls are a *shared* resource.** Both sides match the same skull tiles. Matching skulls is dual-purpose (damage **+** denial to the enemy), so skull-matching is worth a bit more than its raw damage — and a board flooded with skulls (Doomsong, Summon Dead) favors whoever's turn it is.
- **Color concentration tax.** Focused gen is ~3/turn for **one** color. A kit that needs two different colors splits attention → ~1.5/turn each → **double** the charge time. Design each character around **1–2 colors total**; if two, make the costs cheaper or accept a slower cadence.

---

## 17. Recommended player baseline

### 17.1 Starting stats

Anchor: a floor-1 normal enemy deals ~1.5 DPT over ~8 turns ≈ **~12 incoming**. Starting HP should give a comfortable margin there (so floor 1 is winnable by any build) while still letting late-act / elite damage threaten a low-HP build.

| Stat | Recommendation | Why |
|---|---|---|
| **Base Max HP** | **~30** (role-spread **26–35**) | survives floor 1 with margin (~12 dmg); leaves room for the per-floor HP picks to matter into elites. |
| **Base Attack** | **1** (all characters) | keeps the *first* +1 Attack pick impactful (skull matches go from raw count to +1 each). |
| **Base Armor** | **0** | armor is a relic/skill/reward stat, not a starting one. |
| **Starting mana** | **enough to cast the opener in ~1 turn**: ~3–5 of the **primary** color | front-loaded tempo (§12.3); don't grant enough to open with the *expensive* skill turn 1. |

Role spread for HP: durable archetype ~34–35, casters ~26, mid ~30. This 26→35 spread (≈ ±15%) is meaningful but not dominant — a caster's lower HP is offset by stronger skills.

### 17.2 Worked character kits (one self-consistent solution)

Numbers chosen to hit the §14.2 target ratios on the §16 economy. These are *a* valid baseline, not the only one.

| Character | HP | Atk | Start mana | Skill A | Skill B |
|---|---|---|---|---|---|
| **Durable (1-color: red)** | 34 | 1 | 4 red | **Strike** — 5 red → **6 dmg** (1.2) | **Bash** — 6 red → **5 dmg + extra turn** (≈9 HPe, 1.5) |
| **Caster (2-color: purple/yellow)** | 26 | 1 | 3 purple | **Bolt** — 4 purple → **6 dmg** (1.5) | **Fracture** — 6 yellow → **destroy 1 row + utility** (≈9 HPe, 1.5) |
| **Sustain/skull (2-color: green/purple)** | 28 | 1 | 3 green | **Mend** — 5 green → **6 heal** (1.2) | **Raise Dead** — 4 purple → **convert N tiles → skull** (skull-build enabler) |

Notes:
- The durable kit is single-color (red) → both skills share a generation focus → high cadence; that's why its per-skill ratios sit at the low end (1.2–1.5).
- The caster splits two colors → each charges slower → ratios pushed to the high end (1.5) to compensate.
- "Convert to skull" skills are valued by the **follow-up skull damage at the caster's Attack**, so they scale with the skull/Attack build — budget them low at base (they grow).

---

## 18. Skill design tables (concrete numbers)

### 18.1 Cost → cadence (how often it fires, at ~3 focused mana/turn)

| Mana cost | Turns to charge | Cadence | Use for |
|---|---|---|---|
| **3** | ~1 | ~every turn | cheap poke / spammable utility |
| **5–6** | ~2 | every other turn | standard skill (the workhorse) |
| **8–10** | ~3 | periodic | a big play / board effect |
| **15–20** | ~5–7 | once or twice a fight | "win-button" finisher |

Multiply charge time by ~2 if the cost is split across two off-focus colors (§16.3).

### 18.2 Cost → effect budget (`budget = cost × role ratio`)

| Cost | Vanilla ×1.0 | Player ×1.4 | Signature ×1.8 | Win-button ×2.5 |
|---|---|---|---|---|
| 3 | 3 HPe | ~4 HPe | — | — |
| 5 | 5 | **7** | 9 | — |
| 6 | 6 | ~8 | **11** | — |
| 8 | 8 | 11 | 14 | — |
| 10 | 10 | 14 | **18** | — |
| 20 | — | — | — | **~50** (or "lethal + drawback", cf. Boom Baby) |

Then **spend the HPe budget** via the §14.1 effect table. Examples at a 6-cost player slot (budget ~8 HPe):
- **9 damage** (pure nuke), or
- **5 damage + extra_turn** (5 + 3.5 ≈ 8.5; tempo bundle), or
- **6 armor + 3 created tiles** (6 + 2.1 ≈ 8), or
- **6 heal + small utility**.

### 18.3 Damage-number guidance (so numbers stay readable)

- Keep skill damage in the **4–12** range for standard skills (single-digit, readable). Reserve >15 for win-buttons.
- Because **skill damage is flat (Attack-independent)** by default, a "6 damage" skill is 6 all game — fine for a baseline, but it means skills *fall behind* skull-matching late (when Attack is high). Counter by either: (a) letting signature skills scale off Attack (Briarthorn-style `damage` with no fixed amount → `caster.attack`), budgeted low at base since they grow; or (b) offering skill-damage upgrades among the per-floor picks.

---

## 19. Enemies & relics, anchored to the economy

- **Enemies:** use §13 — `enemy HP = player DPT × T_target` (normal 8 / elite 13 / boss 24). With baseline player DPT ~3.5 rising to ~8 across Act 1, that's the **~30→62 minion / ~75–95 elite / ~165–180 boss** ramp. **Enemy Attack stays 1–4**; their DPT comes mostly from skull matches (which use the *enemy's* Attack in the same formula) + telegraphed skills, because a long fight multiplies per-turn attack into lethality (§13.3).
- **Relics, by HPe-equivalent value** (a relic occupies a reward slot, so it should out-value a single stat pick of equal rarity):

| Rarity | Target value | Reward weight (current) |
|---|---|---|
| Common | ~6–12 HPe-equiv | 100 |
| Uncommon | ~12–20 | 45 |
| Rare | ~20–35 (often *scaling*: per-turn, per-unspent-mana) | 15 |
| Legendary | ~35+ and/or run-defining | 4 |

Scaling relics (per-turn attack, per-unspent-mana) are worth **more in long fights** (their value ≈ effect × `T`), which is exactly why they belong at higher rarity and shine on elites/bosses.

---

## 20. Watch-outs the mechanics create

1. **Skull damage is uncapped in the formulas.** `SKULL_DAMAGE_CONFIG.maxDamage = 25` exists in [`TileTypes.js`](../src/js/game/TileTypes.js) but **is never applied** — `calculateMatchedSkullDamage`/`calculateDestroyedSkullDamage` have no cap. At high Attack a big skull cascade can spike huge. Decide deliberately: enforce the cap, or accept high-variance skull burst as a build payoff.
2. **The extra-turn engine is the highest-value play.** 4+ matches both clear more tiles *and* grant another action (~+3.5 HPe of tempo). Any "+spawn rate / +mana / create-tiles" effect that makes 4+ matches more frequent is worth more than its face value — price spawn/engine relics accordingly (they're build-defining, §8.2).
3. **Flat skill damage decays in relative value** as Attack and board economy grow (§18.3). Without Attack-scaling or upgrades, skills become "early-game tools" by late act. That may be intentional (pivot to skulls) — just decide it on purpose.
4. **Color concentration is a hidden cost** (§16.3): a two-color kit is ~half as mana-efficient as a one-color kit. Two skills sharing a color is a meaningful power boost the raw HPe/mana number doesn't show.
5. **Full heal caps HP value** (§11.2): none of the defensive numbers matter unless enemies stay lethal. Enemy Attack tuning (§13.3) is what makes the HP stat worth picking — treat the two as one coupled decision.
