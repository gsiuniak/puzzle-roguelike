# Combat Math: A Deep Analysis of Damage, Economy, Scaling & Burst

> **Status:** Quantitative balance analysis (no code changes). Captured 2026-06-23.
> **Companion to:** [`balance-dominant-strategy-analysis.md`](balance-dominant-strategy-analysis.md) (the *why HP dominates* design argument). This doc is the *numbers underneath it*.
> **Method:** Every formula and constant below was read out of the live source with file:line citations. Anything labelled **[MODEL]** is a derived estimate built on stated assumptions, not a code fact. Anything labelled **[CODE]** is exact.

---

## 0. How to read this

The combat system is three stacked layers. Balance bugs almost always come from a mismatch *between* layers, not inside one:

1. **Primitives** — the exact per-event formulas (skull damage, mitigation, scaling). §1. These are clean and mostly fine.
2. **Probability** — how often each event fires, given an 8×8 board and the spawn table. §2.
3. **Value** — converting everything (mana, a skull, an extra turn, armor) onto **one comparable scale** so "is yellow stronger than red?" / "is a skull worth more than a gem?" become arithmetic, not vibes. §3. **This is the framework the design question was really asking for.**

Then §4–§6 apply the framework to the actual growth curves and show *exactly where the numbers diverge* to produce the dominant-HP problem.

---

## 1. The primitives (exact formulas) **[CODE]**

### 1.1 Skull damage — two different formulas

| Source | Formula | File |
|---|---|---|
| **Matched** skulls (3+ in a line) | `D = N + max(0, A − 1)` | `MatchResolver.js:129` |
| **Destroyed** skulls (skill / explode / row) | `D = N × (1 + ⌊A/3⌋)` | `MatchResolver.js:150` |

where `N` = skull count, `A` = dealer's `attack`.

**Critical structural observation — the matched formula's attack term is *per match*, not *per skull*.** `max(0, A−1)` is added **once** regardless of `N`. Consequences:

- At high attack, **many small skull matches beat few big ones.** At `A = 10`: two 3-skull matches = `2 × (3+9) = 24`; one 6-skull match = `6+9 = 15`. Splitting nearly **doubles** output. This is almost certainly an unintended incentive and it fights the 4+ extra-turn reward (which wants *bigger* matches). Flag for review.
- The **destroyed** formula is the opposite shape — per-skull multiplier `(1+⌊A/3⌋)`, so big destroyed groups scale cleanly. So skull *skills* (Fracture, explode relics) and skull *matches* reward opposite play patterns at the same attack value.

Damage-per-tile, the comparable unit (§3):

| Attack | Matched 3-skull (D/tile) | Destroyed skull (D/tile) |
|---|---|---|
| 1 | 3/3 = **1.00** | 1×1 = **1.00** |
| 4 | 6/3 = **2.00** | 1×2 = **2.00** |
| 7 | 9/3 = **3.00** | 1×3 = **3.00** |
| 10 | 12/3 = **4.00** | 1×4 = **4.00** |

They happen to line up at 3-matches, but matched scales **linearly** in `A` (slope 1/3 per attack per tile) while destroyed scales as a **step** (`⌊A/3⌋`).

### 1.2 Mitigation chain **[CODE]** (`MatchResolver.js:249`, `BattleController.js:2570`)

Order is **status multipliers → barrier → armor → block → HP**:

```
dmg0 = raw
 ├ if attacker Berserk:           dmg = dmg0 × 2          (ignores target Brittle/Intangible)
 ├ else: if target Brittle:       dmg = round(dmg0 × 1.5)
 │       if target Intangible:    dmg = min(dmg, 1)        (wins over Brittle)
 ├ if target Berserk:             dmg = dmg × 2            (always, stacks)
 ↓
barrier absorbs  min(barrier, dmg)   → counts as actualDamage
armor absorbs    min(armor, rem)     → counts as actualDamage
block absorbs    min(block, rem)     → FULLY NEGATED (not actualDamage)
HP takes         rem
```

- **Barrier before armor** is correct (spend the expiring resource first).
- **Block** is the only true negation; armor/barrier still register as "damage landed" for trigger purposes. There is no source of `block` in the current player kits — it's vestigial.
- **Intangible (clamp-to-1)** is a hard wall, not a multiplier — extremely strong against big hits, near-useless against chip. **Berserk** is a ×2/×2 stub nothing applies yet.

### 1.3 Damage-over-time **[CODE]**

| Effect | Per-tick amount | Decay | Timing | File |
|---|---|---|---|---|
| **Poison** | `D = stacks` (then routed through barrier→armor→block) | `stacks ← ⌊stacks/2⌋` after tick | end of **applier's** turn | `BattleController.js:3246` |
| **Bleed** | `D = max(1, tickDamage)` snapshotted at apply | none (duration-based) | start of victim's turn | `BattleController.js:1883` |

Poison's halving makes a stack worth, over its lifetime, ≈ `stacks × 2` total damage (geometric `s + s/2 + s/4 + … ≈ 2s`) — **but only if not absorbed and the fight lasts long enough.** This is why application is deliberately scaled at a low rate (Poison Dart: Magic `_25`; see §3.4). Bleed is flat and armor-respecting via `_applyDamage`.

### 1.4 Skill effect resolution **[CODE]** (`BattleController.js:2208`)

```
damage   = base + perSkull × skullsOnBoard + scaledBonus(scaling, caster)
poison   = base + perSkull × skullsOnBoard + scaledBonus(scaling, caster)
```
`base` defaults to `caster.attack` if omitted.

### 1.5 Stat scaling **[CODE]** (`scalingConfig.js`)

```
scaledBonus(scaling, caster) = ⌊ attack × s.attack + magic × s.magic ⌋   (min 0)
```
`DAMAGE_SCALE_PER_POINT = 1/3`. Preset multipliers used in the kits:

| Preset | Mult | "Per N stat" | Used by |
|---|---|---|---|
| `_100` | 1.0 | +1 / 1 | **Bash** (attack) |
| `_150` | 1.5 | +3 / 2 | **Fracture** (magic) |
| `_75` | 0.75 | +3 / 4 | Oungan heal (attack) |
| `_66` | 0.667 | +1 / 1.5 | Barrier (magic) — 2× armor |
| `_50` | 0.5 | +1 / 2 | **all enemy damage skills** (attack) |
| `_33` | 0.333 | +1 / 3 | armor/Defend, mana-reactor relics |
| `_25` | 0.25 | +1 / 4 | Poison Dart application (magic) |

### 1.6 Magic's second job — mana **[CODE]** (`BattleController.js:48,549`)

```
bonusMana(color) = ⌊ magic / 3 ⌋     added once PER matched color, per cascade step
```

**Magic is a dual-purpose stat:** it scales magic skills *and* prints mana (`⌊magic/3⌋` per color per match). Attack only scales damage. This asymmetry matters a lot in §3 and §6 — Magic is structurally the strongest scalar.

### 1.7 Per-victory growth **[CODE]** (`BattleScene.js:32`)

`LEVEL_UP_GROWTH = { attack:+1, magic:+1, maxHp:+8 }` per win, applied to `runState.statModifiers`. HP **fully refreshes each battle** (decision #17; `_applyPostBattleHealing` `healPct = 0.0`).

---

## 2. The probability layer

### 2.1 Board composition **[CODE → MODEL]**

Spawn weights (`TileTypes.js:25`): 5 colors @ **16**, skull @ **20**, total **96**.

```
P(specific color) = 16/96 = 1/6   ≈ 16.67%
P(skull)          = 20/96 = 5/24  ≈ 20.83%
```

On a freshly refilled 8×8 (64 cells):

```
E[skulls on board]      = 64 × 0.2083 ≈ 13.3
E[tiles of one color]   = 64 × 0.1667 ≈ 10.7
```

**Skull is the single most common tile** — there are, in expectation, ~13 skulls sitting on the board at all times, more than any one color. Skull pressure is therefore *ambient*, not occasional.

### 2.2 Spontaneous (cascade) match rate **[MODEL]**

Probability that three collinear cells are a natural monochrome triple:

```
P(triple) = Σ_t p_t³ = 5 × (1/6)³ + (5/24)³ = 0.0232 + 0.0090 = 0.0322
```

Of that, the skull share is `0.0090 / 0.0322 ≈ 28%`. So **~28% of all spontaneous cascade matches are skull matches** — the plurality. Incidental skull damage is a structural constant of the engine, independent of whether anyone *aims* for it.

A full 8×8 has 96 collinear triple-windows (48 H + 48 V). A random board would show `96 × 0.0322 ≈ 3.1` natural triples — but boards are generated no-match and only the *refilled* region is random, so per-clear cascade rate is lower. Refilling ~10–20 fresh cells ⇒ **[MODEL]** ~0.3–1.0 spontaneous matches per clear ⇒ cascades are common but not reliable, and skulls drive ~quarter of them.

> **Takeaway:** you cannot tune skull damage purely as an "intentional" action — ~28% of *unintended* cascade matches are skulls, so the matched-skull formula (§1.1) is also an ambient-damage knob on both sides.

### 2.3 Match-size distribution & the 4+ cliff **[CODE]**

Extra turn fires on **any match ≥ 4** (or L/T shape), `MatchResolver.js:199`. Cascades chain with no cap (`_finishStep` re-analyzes, `BattleController.js:1534`).

The 4+ threshold is a **value cliff**, not a ramp: a 4-match isn't "33% more than a 3-match," it's "a 3-match **plus an entire extra turn**." §3.3 prices the extra turn at ≈ a full turn of output, so a 4-match is worth roughly **double** a 3-match. Any color a player can reliably line up into 4s is disproportionately strong; any skill that grants `extra_turn` (Bash) is buying a whole turn for its mana.

### 2.4 Mana income is supply-symmetric **[CODE]**

Every color spawns at exactly 16/96, and the player *chooses* which line to complete. So **mana income per color is identical across colors and player-controlled.** The only supply-asymmetric tile is skull (20/96, and it pays out as damage, not mana). This single fact drives the whole §3 conclusion: **a color's strength is 100% demand-side** (what its skills cost and do), never supply-side.

---

## 3. The value framework — one scale for colors, skulls, and skills

The design ask was *"a better way to determine the strength of colors, of skulls, of skills, and how they play together."* Here it is. Reduce everything to **damage-equivalent value (DEV)** and **value-per-tile / value-per-mana**.

### 3.1 Equivalence table **[MODEL — these are the tunable design knobs]**

| Resource | DEV | Rationale |
|---|---|---|
| 1 damage | 1.0 | numéraire |
| 1 armor | 0.9 | nearly = HP but expires/overflows; per-fight only |
| 1 barrier | 0.9 | 1-round but 2× magic-scaling |
| 1 HP healed | 1.0 | full value only when below max |
| 1 mana | `V_mana` (see 3.2) | = best value-per-mana skill it funds |
| **1 extra turn** | `V_turn` ≈ 6–10 | a whole turn's mana+damage (3.3) |
| +1 permanent Attack | ≈ 4–8 | depends on remaining turns in fight |
| 1 tile created/converted | 0.3–1.0 | sets up a future match |

These seven numbers **are** the balance model. Pick them once, and every skill/color/skull gets an objective score.

### 3.2 Value-per-mana of each skill **[MODEL @ reference: A=5, M=5, mid-run]**

```
DEV(skill) = Σ effect DEVs       value/mana = DEV / total mana cost
```

| Skill | Cost | DEV breakdown | DEV | **V/mana** |
|---|---|---|---|---|
| **Fracture** (Mage) | 5 yellow | destroy row ≈ 8 tiles (≈ mana+skull dmg ~10) + (5 + ⌊5×1.5⌋=7) dmg = 12 | ~22 | **4.4** |
| **Bash** (Warrior) | 5 red | (5 + 5) dmg + extra turn (V_turn≈6) | ~16 | **3.2** |
| **Oungan** (WD) | 5 green | heal (5+⌊5×0.75⌋=3)=8 + 3 tiles(~3) + perm +1 atk(~5) | ~16 | **3.2** |
| **Defend** (Warrior) | 5 blue | armor (6+⌊5/3⌋=1)=7 ×0.9 + 3 tiles(~3) | ~9 | **1.8** |
| **Summon Dead** (WD) | 5 purple | green→skull mass convert; board-dependent, high variance | 4–20 | **0.8–4.0** |
| **Arcane Inscription** (Mage) | 3 purple | convert 1 tile → sets up 1 match | ~3 | **1.0** |

**Findings:**
- **Colors are not interchangeable — their value spread is ~4×** (yellow 4.4 vs blue 1.8) purely from the skills that consume them. Since *supply* is equal (§2.4), this is the entire story of color strength.
- **Fracture is the strongest single skill** — row-destroy is a huge tile-count payout *and* it carries the best damage scaling (`_150` magic). It also feeds Magic's dual role (§1.6).
- **Bash punches above its DEV** because `extra_turn` is tempo, not stats — it's nearly cost-neutral. This is why "red" feels strong on Warrior despite a modest raw line.
- **Purple is a trap color on paper** (Arcane 1.0, Summon Dead variance) but is carried by build synergy (Poison Vial, skull conversion). Variance ≠ weakness, but it *is* inconsistency.

> **Recommended design rule:** target **V/mana ∈ [2.5, 3.5]** for every baseline skill. Anything under 2 is a trap; anything over 4 is a must-pick. Today the spread is 1.0–4.4 — too wide. Either lift the floor (buff Arcane/Defend) or tax the ceiling (Fracture).

### 3.3 Pricing the extra turn **[MODEL]**

A turn produces ≈ (mana matched → eventual DEV) + (skull damage). At reference stats a competent turn is ~1–2 productive matches + a cascade. If one productive turn ≈ 6–10 DEV, then:

```
V_turn ≈ 6–10
```

So **every 4+ match is worth ~+6–10 hidden DEV** beyond its tiles, and **Bash's extra_turn alone ≈ its entire mana cost back in tempo.** This is the single most undervalued quantity in the current tuning and explains why "make 4s and chain" is the real skill ceiling.

### 3.4 Skull value vs gem value, unified **[MODEL]**

Per matched tile, at attack `A`:

```
skull (matched):   DEV/tile = (N + A − 1) / N        → at N=3: (2+A)/3
gem (via skill):   DEV/tile = V_mana ≈ 2.5–4.4 (best color), 1.0 (worst)
```

Cross-over: a matched skull beats a *worst-color* gem tile (DEV/tile ~1.0) once `A ≥ 1`, and beats a *best-color* gem (~4.4) only at `A ≥ 11` (3-match). **So:**
- **Early (A≈1–3):** gems funding good skills > skulls. Build economy.
- **Late (A≈10+ via level-ups + relics):** skulls outscale all but the best skill. Just match skulls.

This is a *healthy* arc **if** attack is hard to reach. It is **broken today** because relics hand out attack cheaply (§5.2), so everyone reaches the "just match skulls" regime fast — collapsing the color economy the game spent so much surface area on.

### 3.5 The Magic anomaly

Magic appears in **three** value channels; Attack in one:

| Stat | Skill damage | Mana printing | Armor/barrier |
|---|---|---|---|
| Attack | some skills (`_50` enemy, `_100` Bash) | — | armor `_33` |
| **Magic** | Fracture `_150`, barrier `_66` | **`⌊M/3⌋`/color/match** | barrier `_66` (2×) |

A point of Magic on the Mage is worth: scaling on Fracture **and** ~`⌊M/3⌋` mana/color/match **and** barrier. **Magic is structurally the best scalar in the game**, yet the level-up offers it at the same `+1` rate as Attack. (See §6.4.)

---

## 4. Growth curves — player vs enemy across the run

### 4.1 The two curves **[CODE]**

**Player, all-HP build, after `v` victories** (HP refreshes full each fight):

```
maxHp(v) = base + 8v        attack(v) = 1 + (level-up atk picks)      magic(v) = base + (picks)
```
Warrior base 30; Mage 18; WD 25. A run is ~6–8 battles, so `v` reaches ~6–8.

**Enemy, at depth `d` (0-indexed):**

```
maxHp = round(baseHp × HP_MULT[d]),  HP_MULT = [1.15,1.35,1.7,1.9,2.35,2.65,3.2,3.55,4.25,4.75]
attack = baseAtk + round(ATK_BONUS[d] × attackScale),  ATK_BONUS = [0,0,0,1,1,1,2,2,2,3]
```

### 4.2 The divergence, in one table **[MODEL, reference enemy baseAtk≈3, baseHp≈18–28]**

| Floor | Enemy HP (≈) | Enemy atk | Enemy skull-match dmg (3) `2+A` | Enemy skill dmg `10+A/2` | **Enemy burst/turn [MODEL]** | Player HP if all-HP (Warrior) | Player HP if **no**-HP |
|---|---|---|---|---|---|---|---|
| 1 | 18×1.15 ≈ 21 | 3 | 5 | — | ~5–8 | 30 | 30 |
| 4 | 22×1.9 ≈ 42 | 4 | 6 | 12 | ~12–18 | 30+24 = **54** | 30 |
| 7 | 18×3.2 ≈ 58 | 5 | 7 | 12 | ~16–24 | 30+48 = **78** | 30 |
| 10 (boss) | 50×4.75 ≈ 238 | 4–8* | 6–10 | 12–14 | ~20–30 | 30+64 = **94** | 30 |

\*Malakor ramps attack via Thrall harvest.

**Read the last three columns. That is the entire problem in nine cells:**

- **Enemy burst/turn grows ~4–5× over the run** (5 → ~25), driven mostly by the *flat* skill base (10) and modest attack bonus (+0..3).
- **All-HP player HP grows ~3× and starts 6× above the threat** (30 vs 5 on floor 1, 94 vs ~25 on floor 10). The buffer *widens* in absolute terms.
- **No-HP player stays at 30** — and by floor 7+ a ~20–30 burst is genuinely lethal in 1–2 turns.

So the HP level-up converts a **real** threat (no-HP column) into a **non-threat** (all-HP column), every floor, with no diminishing returns — because enemy *damage* scaling (flat +0..3 attack) is an order of magnitude slower than HP accrual (+8/win). **This is Lever A, quantified: enemy damage does not outrun flat HP.**

### 4.3 Time-to-kill, the other direction **[MODEL]**

Player DPS, all-Attack-and-relics build at floor 10: skull matches `2+A` with `A≈10–30` (level-ups + Cestus/Tsunami, §5.2) = **12–32/skull-match**, plus Bash `5+A` = 15–35. Two actions/turn ≈ **30–60 player DPS**.

```
TTK(boss) = 238 / ~45 ≈ 5 turns        TTK(floor-7 minion) = 58 / ~40 ≈ 1.5 turns
```

Enemy HP scaling **tops out at 4.75×** while player offense can hit **10–30× base attack**. So **TTK shrinks over the run** — fights get *shorter* as you climb, the opposite of rising tension. **This is the other half of Lever A: enemy HP does not outrun free offense.**

---

## 5. Burst & lethality probability

### 5.1 Can the player be one-shot? **[MODEL]**

Worst realistic enemy turn (floor 9–10): a cascade of 2–3 skull matches + a scaling skill + an extra-turn chain. Upper bound ≈ `3×(2+A) + (10+A/2) + extra-turn repeat`. At `A=6`: `3×8 + 13 + ~13 ≈ 50`. Against:
- **No-HP player (30 HP):** dead. P(lethal turn) is non-trivial on bad boards — the no-HP build is *gambling*.
- **All-HP player (94 HP):** survives even the worst turn with ~half HP. P(death) ≈ 0 barring a pathological multi-turn cascade streak.

The variance is real (skulls are the most common tile, cascades chain uncapped), so the *floor* of player HP matters enormously — but +8/win pushes the all-HP build so far above the variance band that the dice stop mattering. **Defense is binary here: below the burst band you're gambling, above it you're immortal, and the level-up vaults you above it for free.**

### 5.2 How fast does "free" offense arrive? **[CODE]** (`relicCatalog.js`, `relicRewards.js`)

3 relic options per battle; rarity weights Common 70 / Uncommon 20 / Rare 15 / Legendary 4. The attack engines:

| Relic | Effect | Attack delta over a run **[MODEL]** |
|---|---|---|
| Cestus/Harpoon/Club/Stiletto/Wand (Rare) | +1 atk per 3 **unspent** mana of a color | +3 to +7 standing |
| Tsunami (Legendary) | +2 atk **per turn start** | +2 × fight length → **+12–20/fight** |
| Scythe (Rare) | +1 atk per 3+ skull match | +1/skull-match, unbounded |
| Reckoning (Legendary) | +1 atk per damage taken | unbounded |
| Claymore (Common) | +2 atk flat | +2 |
| Funerary Bell (Common) | +3 skull dmg **per matched skull** | huge on skull matches |

A single Tsunami or Scythe makes attack **unbounded within a fight**, so the §3.4 cross-over ("just match skulls") is reached by mid-run on most builds. The Attack level-up (+1/win) is a **rounding error** against this — which is exactly why nobody picks it (companion doc, cause #1).

### 5.3 Poison/bleed as burst **[CODE/MODEL]**

Poison lifetime ≈ `2 × stacks` damage but absorbed by barrier/armor and decaying — a *sustain* threat, not a burst. Witch Doctor's Poison Vial applies `⌊0.5 × skull-damage-dealt⌋` per skull hit, so it scales with the same attack curve as skulls (§3.4) and compounds. It's the one player kit whose damage is gated behind *its own* engine rather than relic handouts — the healthiest-tuned offense in the game by this analysis.

---

## 6. Synthesis — where the math actually breaks

1. **Enemy damage scaling is flat; player HP growth is steep.** Enemy attack `+0..3` over 10 floors vs `+8 HP`/win. The defensive level-up out-scales the threat by ~3–8× and never diminishes (§4.2). → *HP is a dominant pick.*
2. **Enemy HP scaling (≤4.75×) is dwarfed by player offense (10–30×).** TTK *shrinks* over the run; offense is over-supplied by relics, so the Attack level-up is redundant (§4.3, §5.2). → *Attack is a dominated pick.*
3. **The two together mean the level-up is a fake choice** — one option (HP) is always correctly underweighted, the others are always covered by relics. (This is the companion doc's product-balancing argument, now with numbers.)
4. **Magic is mispriced.** It has 3 value channels to Attack's 1 (§3.5) yet costs the same +1. On the Mage it's the best pick by far; on Attack-only characters it's nearly dead. Same card, wildly different value → another reason the screen feels off.
5. **Color value spans ~4×** (V/mana 1.0–4.4, §3.2) despite identical supply — some colors are traps, decided entirely by the skill catalog, not by play.
6. **The matched-skull formula rewards *small* skull matches at high attack** (§1.1), fighting the 4+ extra-turn incentive. Likely unintended.
7. **The extra turn is the most undervalued unit** (~6–10 DEV, §3.3); 4+ matches and Bash are stronger than their face value, and nothing in the UI signals this.

---

## 7. Concrete rebalance levers (targets, not code)

Ordered by leverage. These are the *math* fixes for Lever A from the companion doc.

### 7.1 Make enemy damage outrun flat HP
- Convert `ENEMY_ATTACK_FLOOR_BONUS` from additive `+0..3` to **multiplicative** or steeper additive, so floor-10 enemy burst ≈ **40–50% of an all-HP player's pool**, not ~25%. Target: even the all-HP build should *feel* a bad turn at floors 8–10.
- Or scale enemy skill `base` per floor (today it's flat 10) so the dominant burst term grows with depth.
- **Success metric:** the "all-HP" and "no-HP" columns of §4.2 should *converge* late, not diverge.

### 7.2 Make enemy HP outrun free offense
- Raise `ENEMY_HP_FLOOR_MULT` ceiling, or add an **attack-aware** term (enemy HP scales partly with the player's current attack) so TTK stays in a target band (~4–8 turns) instead of shrinking to 1.5 (§4.3).
- Cap or tax the unbounded relic attack engines (Tsunami/Scythe/Reckoning) — diminishing returns past some attack value — so §3.4's cross-over is reached *late*, preserving the early color economy.
- **Success metric:** TTK(floor d) roughly *constant* across the run, not decreasing.

### 7.3 Fix the level-up card values (or remove it — Lever C)
- If kept: price the cards by **DEV**, not by stat-point parity. Magic +1 ≈ Attack +1 only if you neutralize Magic's mana channel; otherwise Magic should cost "more" (smaller increment) or Attack/HP should give "more."
- Better (companion doc rec): **auto-grow the scalars per character** on a tuned curve and replace the card with a non-scalar boon (mana economy / keyword / relic slot) that can't be reduced to this product.

### 7.4 Flatten color value
- Target every baseline skill to **V/mana ∈ [2.5, 3.5]** (§3.2). Buff Arcane Inscription & Defend; consider taxing Fracture's row-destroy or its `_150` scaling.

### 7.5 Smaller, surgical
- Reconsider the **matched-skull per-match attack bonus** (§1.1) — make it per-skull (`N × (1 + k·A)`) so big skull matches aren't a trap, aligning it with the 4+ reward.
- Surface the **extra-turn value** to the player (it's worth ~a whole turn) — UI, not math.

---

### Appendix A — constant reference (all **[CODE]**)

| Quantity | Value | File |
|---|---|---|
| Spawn weights | color 16, skull 20 (total 96) | `TileTypes.js:25` |
| Board | 8×8 = 64 | `TileTypes.js:60` |
| Matched skull dmg | `N + max(0,A−1)` | `MatchResolver.js:129` |
| Destroyed skull dmg | `N × (1+⌊A/3⌋)` | `MatchResolver.js:150` |
| Mitigation order | barrier→armor→block→HP | `MatchResolver.js:249` |
| Brittle / Intangible / Berserk | ×1.5 / →1 / ×2 | `BattleController.js:2592` |
| Poison tick / decay | `=stacks` / `⌊/2⌋` | `BattleController.js:3246` |
| Scaling bonus | `⌊A·sa + M·sm⌋` | `scalingConfig.js:85` |
| `DAMAGE_SCALE_PER_POINT` | 1/3 | `scalingConfig.js:37` |
| Magic→mana | `⌊M/3⌋`/color/match | `BattleController.js:48` |
| Extra-turn gate | match ≥ 4 | `MatchResolver.js:199` |
| Level-up growth | atk+1 / mag+1 / hp+8 | `BattleScene.js:32` |
| HP reset | full each battle (0% carry) | decision #17 |
| Enemy HP mult | `[1.15 … 4.75]` | `MapScene.js:58` |
| Enemy atk bonus | `[0,0,0,1,1,1,2,2,2,3]` | `MapScene.js:72` |
| Relic rarity weights | 70/20/15/4 | `relicRewards.js:33` |
| Reward options | 3/battle | `relicRewards.js:161` |

### Appendix B — base stats (all **[CODE]**)

| Char | HP | Atk | Mag | Mana | Skills | Relic |
|---|---|---|---|---|---|---|
| Warrior | 30 | 1 | 1 | 5 blue | bash(r5), defend(b5) | family_crest |
| Mage | 18 | 1 | 3 | 3 purple | fracture(y5), arcane_inscription(p3) | unstable_catalyst |
| Witch Doctor | 25 | 1 | 1 | 5 green, 2 purple | summon_dead(p5), oungan(g5) | poison_vial |

> **All [MODEL] numbers depend on the §3.1 equivalence table and the assumed ~6–8 battles/run and reference stat levels. Re-derive if those change. The [CODE] formulas are exact as of 2026-06-23.**
