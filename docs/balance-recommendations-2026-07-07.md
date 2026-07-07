# Balance Recommendations — 2026-07-07 (from strong-AI run measurement)

**Evidence base:** two independent 4,500-run randomized-trial datasets played by the
strongest verified AI (deterministic formula policy, ~45% avg run survival — 18× the
shipped greedy AI): `runs-expert-night` and `runs-expert-chain` (the latter with
extra-turn chain planning, which corrects the systematic under-measurement of
chain-enabling content). Item numbers are **ΔSurvival**: picked vs offered-but-not-picked
at the same reward node (unbiased; `*` = statistically significant). Rarity bands
(doc §6.5): common ≤ +3pp, uncommon +3–6, rare +6–12, legendary > +12.

**Rule of thumb applied throughout:** only signals CONSISTENT across both datasets are
action items; single-dataset flips (small-n rares especially) are "monitor".

---

## 1. Characters — the headline imbalance

| character | run survival | verdict |
|---|---|---|
| Warrior | **55.9%** | the benchmark — leave |
| Mage | **42.5%** | buff (~-13pp gap persists even under chain-planning AI) |
| Witch Doctor | **37.7%** | buff (largest gap; worst late-floor attrition f6–f10) |

The mage gap held across three policy families and *narrowed but did not close* when the
AI gained her signature skill expression (targeting + extra-turn chains: +4pp to her,
+1.8 to warrior). Conclusion: it's a real power gap, not an AI blind spot.

**Recommended levers (size, then re-measure):**
- **Mage:** durability, not damage — her deaths are flat across all floors (general
  shortfall) and Fracture is already the best skill in the game. Suggest `baseStats.maxHp`
  +3 (28→31?) **or** growthPlan `maxHp 4→5`. Avoid buffing Fracture/Inscription.
- **Witch Doctor:** his attrition concentrates floors 6–10 — the poison engine falls off
  vs floor-scaled HP pools. Suggest `poison_vial` fraction **0.5 → 0.65** (scales his
  identity into late floors) or growthPlan `maxHp 4→5`. One lever at a time.
- Sizing reference: ~+8–10 maxHp ≈ +5–8pp survival at mid-skill; expect to iterate once.

## 2. Relics — nerfs (consistently above band under strong play)

| relic | rarity | night / chain ΔSurv | recommendation |
|---|---|---|---|
| **claymore** (+2 attack) | common | +7.9* / +4.9* | flat stats remain king: **+2 → +1 attack**, or move to uncommon |
| **death_familiar** | uncommon | +7.3* / +12.1* | hottest item in the game under strong play — **move to rare** (or trigger 4+→5+) |
| **copper_coil** (+yellow spawn) | uncommon | +7.8* / +9.5* | a build-around carry (+21pp WITH yellow build vs +1 without) — **+10pp → +7pp spawn**, or accept as intentional synergy payoff and just move to rare |
| **aegis** | common | +5.5* / +5.8* | crept back above band after the last nerf — **drop the attack scaling** (flat 1/turn), or move to uncommon |
| **slingshot** | common | (varies) / +6.2* | same story — **2 → 1 base damage** (keep scaling), or uncommon |
| **alabaster_flask** | common | +6.2* / +5.1* | **heal 2 → 1** (keep scaling), or uncommon |

Pattern worth noting: several *commons* outperform because reliable per-turn value
compounds under strong play. Rarity bumps are often the cleaner fix than number nerfs —
they preserve the fun without making them default picks.

## 3. Relics — buffs / reworks (consistently below zero)

| relic | night / chain | recommendation |
|---|---|---|
| **flint** (+red spawn) | −15.9* / −13.0* | **rework, not retune** — red feeds most Act-1 enemy skills, so it arms the opponent (synergy softens it: −5.4 with red build vs −19.6 without — but it never goes positive). Suggested redesign: *"+red spawns on YOUR turns only"* or repurpose to a red-mana-on-match relic |
| **thimble** (mana-gain family) | −5.1* / −8.8* | the +1 mana-per-match family (thimble/pestle/gourd_flask/astrolabe/bellows) reads flat-to-negative everywhere — **+1 → +2 mana** across the family, cheap and thematic |
| **potions** (one-time +5 mana) | ≈0 to −6 both | root cause is generous kit starting mana (5–6 in kit colors). Either **reduce character starting mana** (bigger design decision — also fixes Cestus-family variance) or make potions **+8**, or add a rider (e.g. +5 mana AND +5 HP) |
| **familiars** (green/purple esp.) | ≈0 / −3 to −5 | same starting-mana shadow; revisit after the potions decision rather than independently |
| **fossilized_fern** | +4.5 / −4.3 | volatile — leave, monitor |

**Leave alone:** scythe (+3.6/+7.6 — rare, in band), dewstone, cestus-family rares
(cestus/club/stiletto/wand/harpoon swing wildly at n≈180 — the per-3 revert was right;
do not chase this noise), gorepike/deathbringer (mid-table now).
**Legendaries:** still never reach the >+12pp band — standing recommendation: either
accept a flatter rarity curve or give ramp legendaries a second effect; don't buff their
numbers again blindly (the earlier +50% buffs barely moved them).

## 4. Weave tags (retune in `weaveConfig.js` tables / synthesizer `POWER`)

**Price UP (consistently strong):**
- **`wild`** +9.7 / **+14.2*** — the best tag in the game; raise its POWER/cost weighting
- **`change`** +5.9* / +6.6* — strong both datasets; small price bump *(designer's call —
  if the Inscription-style "premium pick" feel is intentional, leave and accept)*
- `cripple` (+3.7/+7.3) and `blast`/`strike` (+3–4* at huge n) — mildly hot, optional trim

**Price DOWN / strengthen (consistently weak — currently overpriced for what they do):**
- **`silence`** −9.0* / −8.6* — worst tag both datasets; halve its POWER cost or add turns
- **`berserk`** −9.6 / −7.7 — still a stub mechanically; cheapen or finish the design
- **`lock`** −6.8 / −5.5 — cheapen (its denial rarely converts to survival)
- **`all`** −7.9 / −6.4* — the amplifier costs more than it amplifies; cheapen
- **`transmute`**, **`drain`** — negative both datasets; cheapen
- `barrier`/`armor`/`heal` flipped **positive** under strong play — the earlier "defensive
  tags are weak" read was a weak-player artifact; **leave them as now priced**
- `convert` and `extra_turn` are volatile across datasets — monitor, don't touch

## 5. Standing items (unchanged from the 2026-07-06 pass)

- **Enemies are in band** (incl. Malakor at ~45–65% boss band) — no changes. Re-verify
  after any character buffs: `node sim/toolbench/trainer.mjs enemies`.
- **Goblin Sapper stays disabled** pending redesign — the bomb race needs a player lever
  (e.g. bomb damage scaled-but-survivable, or disarm-below-HP-threshold), then re-band.
- **`convert_tile` stays deliberately under-priced** in the analytic model (intentional
  premium pick — do not "fix" it up to measured value).

## 6. How to verify any change

```bash
# per-item paired check          node sim/toolbench/trainer.mjs relics --relics <id> --n 200
# enemy bands                    node sim/toolbench/trainer.mjs enemies
# the real test — full runs under the champion AI:
node sim/toolbench/runs.mjs simulate --n 1500 --chars all --champion --out sim/toolbench/reports/runs-check.jsonl
node sim/toolbench/runs.mjs analyze --log sim/toolbench/reports/runs-check.jsonl --min 60
```
Health targets: warrior ≈ 50–60% champion survival with mage/WD within ~5pp of it;
death-floor histogram flat-ish; no relic outside its rarity band in both directions.
