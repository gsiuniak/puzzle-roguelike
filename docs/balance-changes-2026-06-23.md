# Balance Changes — 2026-06-23

> **What:** First surgical balance pass driven by the DEV model in [`balance-combat-math.md`](balance-combat-math.md).
> **Scope of this pass (as requested):** (1) fix the per-match skull bug, (2) *disregard* the unbounded "broken" relics for now, (3) surgical player-stat/skill + enemy tuning, (4) disable stat picking → per-character growth curves, (5) align spell-synth values to the DEV model.
> **Not done / caveats** are called out per section. **None of this is sim-validated** — the `sim/` harness is off-limits to me; the curve assumptions should be re-checked there (and in playtest) by a human. Files touched are cited inline.

---

## 0. The "broken" relics are explicitly out of scope (Task 2)

Per the request, the unbounded-attack relics — **Tsunami** (`+2 atk/turn`), **Scythe** (`+1 atk/skull-match`), **Reckoning** (`+1 atk/damage-taken`), and the dynamic `attack_per_unspent_mana` group (Cestus/Harpoon/Club/Stiletto/Wand) — were **left untouched**. They remain in the reward pool and are still mathematically unbounded.

**Caveat that follows from this:** every co-tuning below assumes a player whose offense grows at the *deterministic* rate from §3 (growth plan + skills), **not** one carrying an unbounded relic. If a player acquires Tsunami/Scythe/etc., they will still trivialize the new enemy curves. Bounding those relics is the natural next pass.

---

## 1. Fixed: matched-skull damage is now per-skull, not per-match (Task 1)

**File:** [`src/js/game/MatchResolver.js`](../src/js/game/MatchResolver.js) — `calculateMatchedSkullDamage`.

| | Old | New |
|---|---|---|
| Formula | `N + max(0, A−1)` | `round(N × (1 + max(0, A−1)/3))` |
| A=10, N=3 | 12 | **12** (unchanged) |
| A=10, N=6 | 15 | **24** |
| A=4, N=6 | 9 | **12** |

**Why.** The old attack bonus was added **once per match** regardless of skull count, so at high Attack two small skull matches out-damaged one big one (24 vs 15) — an unintended incentive that fought the 4+ extra-turn reward (which wants *bigger* matches). The new form scales the bonus **per skull**.

**Deliberately calibrated to be zero-impact at N=3:** the new formula reproduces the old values exactly for 3-skull matches (the overwhelmingly common case), so only 4+ skull matches change — and they now scale linearly with size instead of being a trap. This is symmetric (affects player *and* enemy skull damage), which also slightly raises enemy burst on big boards — intended (more threat, §7.1 below).

---

## 2. Disabled stat picking → per-character growth plans (Task 4)

**Files:** [`warrior.js`](../src/js/data/characters/warrior.js), [`mage.js`](../src/js/data/characters/mage.js), [`witchDoctor.js`](../src/js/data/characters/witchDoctor.js), [`BattleScene.js`](../src/js/ui/BattleScene.js); doc decision #36 updated.

The post-victory **Level Up overlay (pick Attack / Magic / Max HP) is no longer shown.** Why: that choice was *mathematically dominated* — offense was over-supplied by relics/skills, so the rational pick was always Max HP, every time (full analysis in [`balance-dominant-strategy-analysis.md`](balance-dominant-strategy-analysis.md)). A forced choice with one correct answer is fake agency.

Each character now carries a `growthPlan` applied automatically on victory by `BattleScene._applyGrowthPlan` (reads the char def, applies via `applyRunModifier`, bumps `victories`). The flow is now `GAME_OVER → (auto growth) → RewardOverlay → MapScene`. The overlay code is kept dormant (re-enable by calling `_showLevelUpOverlay()` again).

| Character | Per-victory growth | Identity rationale |
|---|---|---|
| **Warrior** | `+5 maxHp, +1 attack` | Tanky bruiser — heaviest HP, and Attack scales its skull/Bash damage. |
| **Mage** | `+4 maxHp, +1 magic` | Glass cannon — leaner HP; **Magic is its best stat** (scales Fracture `_150` *and* prints `⌊M/3⌋` mana/match — see §3.5). |
| **Witch Doctor** | `+4 maxHp, +1 magic` | Attrition — Magic drives poison application, Barrier, and mana economy. |

**Why these numbers.** Two design constraints:
1. **Both axes grow every win** — so HP can never again be the "dump" stat; offense is guaranteed, not optional.
2. **Budget stays near the old sim-calibrated auto-growth** (legacy `HP_GROWTH_PER_VICTORY=4` + `+1 atk / 2 victories`), so the existing sim-derived enemy **HP** curve isn't wildly invalidated. Warrior trades a little extra offense (+1 atk/win vs the old +0.5) for it leaning into its identity.

**Caveat:** because player offense growth changed (esp. Warrior attack and Mage/WD magic), the sim-derived `ENEMY_HP_FLOOR_MULT` curve is now slightly off its calibration assumptions. I left it unchanged (can't re-run the sim); it should be re-derived. Expect fights ~0.5–1 turn shorter than the sim intended for Warrior.

---

## 3. Player skill tweak (Task 3, skills)

**File:** [`skillCatalog.js`](../src/js/data/skills/skillCatalog.js).

| Skill | Change | Why |
|---|---|---|
| **Fracture** | cost `yellow 5 → 6` | It was the catalog's highest value-per-mana skill (~4.4 vs the [2.5, 3.5] target) — row-destroy is a large tile-count payout *and* it carries the best damage scaling (`_150` Magic). +1 cost pulls V/mana toward band **without** touching the Magic scaling, so the Mage's new `+1 magic/win` growth still rewards the skill. |

**Deliberately *not* changed (documented so the next pass knows it's a decision, not an oversight):**
- **Defend** — already buffed to `armor 6` from a prior sim pass (comment in-file); leaving it rather than contradict the sim.
- **Arcane Inscription** (V/mana ~1.0) — intentionally low-DEV: it's a cheap 3-cost *setup/tempo* tool (guaranteed match enabler), and the [2.5, 3.5] band is for *payoff* skills, not flexible utility. Left as-is.
- **Bash / Oungan / Summon Dead** — Bash (~3.2) and Oungan (~3.2) sit in band; Summon Dead is high-variance-but-conditional, not over-statted. Left.

Authored skills are mostly sim-tuned and in-band, so the real "skill value" work is the synth (§5).

---

## 4. Enemy tuning (Task 3, enemies)

**File:** [`MapScene.js`](../src/js/scenes/MapScene.js).

| Constant | Old | New |
|---|---|---|
| `ENEMY_ATTACK_FLOOR_BONUS` | `[0,0,0,1,1,1,2,2,2,3]` | `[0,0,1,1,2,2,3,3,4,4]` |
| `ENEMY_HP_FLOOR_MULT` | unchanged | unchanged (see caveat) |

**Why steepen attack (≈ +1 every 2 floors, top +4 vs +3).** The core finding (§4.2/§7.1): enemy *damage* scaled far slower (flat `+0..3` attack) than player HP grew, so tanking out-paced the threat and defense was free. Now that player growth is **deterministic and always includes Max HP**, enemy damage *must* climb faster to stay threatening against a steadily-growing pool. Worked example with the new curves (Mage, the squishiest, ~depth 8 / floor 9): HP ≈ `18 + 4×8 = 50`; enemy ≈ base 3 + bonus 4 = atk 7 → skull-match(3) = `round(3×(1+6/3)) = 9`, a `10 + ⌊7/2⌋ = 13` skill → ~22 burst ≈ **44% of HP** in a bad turn (was ~25%). The Warrior (tank) takes the same ~22 as ~29% of its `30+45=75` — the intended class gap.

**Why HP was left alone.** `ENEMY_HP_FLOOR_MULT` is explicitly sim-derived (`playerDPT × targetTurns`). Player offense is now *leaner* (no broken relics in scope, attack grows only `+1/win` for Warrior), so the existing curve roughly holds TTK; raising both HP *and* attack blind risks a late-game slog. **Recommendation:** re-run `node sim/run-power.mjs` with the new growth model and re-derive the HP curve; if TTK still shrinks late (§4.3), add a top-end HP bump or an attack-aware HP term.

**Not done:** per-enemy base-stat re-tiering. The global floor curves + the existing minion/elite/boss base spread already encode "relative strength by floor"; I avoided micro-tuning individual enemies without a sim. Flagged as a follow-up.

---

## 5. Spell-synth values re-aligned to the DEV model (Task 5)

**File:** [`skillSynthesizer.js`](../src/js/data/skillSynthesizer.js) — the `POWER` weight table. The synth prices a woven skill's `power`, then `computeManaCostTotal` ([`weaveConfig.js`](../src/js/data/weaveConfig.js)) divides by `powerPerMana` (K). I left **K, the cost band, the damage-scaling model, `extraTurn`, and the board-effect weights alone** (K is calibrated to the authored catalog and lands woven skills at ~2.9 V/mana in DEV terms — in band; `extraTurn:8` already matches the §3.3 DEV estimate of 6–10). I corrected only the per-effect weights that were *mis-priced relative to `perDamage = 0.5`* (the anchor: 1 damage ≈ 1 DEV ≈ 0.5 power).

| Weight | Old | New | Why (DEV) |
|---|---|---|---|
| `perAttack` | 1 | **2** | A *permanent* +1 Attack is worth several DEV over a fight (scales every skull match + skill). Was under-priced → woven +attack skills too cheap. |
| `perMagic` | 1 | **2.5** | Same, but Magic has **3 value channels** to Attack's 1 (damage + `⌊M/3⌋` mana + barrier — §3.5), so priced above Attack. |
| `perTileCreated` | 1.5 | **1.1** | A created tile is *deferred* mana (placed avoiding matches), not an immediate payoff — 1.5 over-valued it, making create skills overpriced/weak. |
| `perHeal` | 0.3 | **0.4** | Heal ≈ 0.8 DEV/pt (full value only when below max); 0.3 was too cheap relative to damage. |
| `perArmor` | 0.4 | **0.45** | Armor/barrier ≈ 0.9 DEV/pt. Minor. |
| `perPoisonStack` | 2.0 | **1.0** | ~2× damage over the halving tail = ~2 DEV = 1.0 power; 2.0 double-counted. **Note:** the poison tag is disabled (decision #39) — affects nothing until re-enabled. |

**Net effect:** woven skills that grant **permanent stats** cost meaningfully more (they were the biggest under-pricing); **create**-heavy skills cost a little less; heal/armor nudge up slightly. All stay within the existing cost clamp + K band, so the overall woven V/mana band (~2.9 DEV) is preserved — this re-distributes cost to match each effect's real value rather than changing the average.

**Caveat:** the synth has unit tests (`node sim/test-skill-synthesizer.mjs`) I'm not permitted to run. These are pure constant changes (no logic), so tests asserting *structure* should pass, but any test asserting *exact cost numbers* will need its expectations updated. Please run it.

---

## Summary of files changed

| File | Change |
|---|---|
| `src/js/game/MatchResolver.js` | Matched-skull formula → per-skull (Task 1) |
| `src/js/data/characters/{warrior,mage,witchDoctor}.js` | Added `growthPlan` (Task 4) |
| `src/js/ui/BattleScene.js` | `DEFAULT_GROWTH_PLAN` + `_applyGrowthPlan`; victory now auto-grows + skips Level Up overlay (Task 4) |
| `src/js/data/skills/skillCatalog.js` | Fracture `yellow 5→6` (Task 3) |
| `src/js/scenes/MapScene.js` | `ENEMY_ATTACK_FLOOR_BONUS` steepened (Task 3) |
| `src/js/data/skillSynthesizer.js` | `POWER` weights re-aligned to DEV (Task 5) |
| `CLAUDE.md` | Decisions #36 (auto-growth) + #11 (attack curve) updated |
| `docs/balance-combat-math.md` | Superseded-by banner |

## Recommended validation (human, since I can't touch `sim/`)
1. `node sim/run-power.mjs` → re-derive `ENEMY_HP_FLOOR_MULT` against the new deterministic growth; confirm TTK stays in a ~4–8 turn band and doesn't shrink late.
2. `node sim/test-skill-synthesizer.mjs` → update any exact-cost expectations.
3. Playtest each class floors 1→10: confirm (a) no fight is a non-threat, (b) Mage feels appropriately fragile but not unfair, (c) big skull matches now feel rewarding.
4. **Next pass:** bound the unbounded relics (§0) so they don't re-break the model.
