# Balance Findings & Recommendations (simulator-driven)

> **Conclusions-first companion** to [`balance-scaling-research.md`](balance-scaling-research.md)
> (which holds the framework/reasoning). This doc is the actionable summary: what
> the headless sim ([`../sim/`](../sim/)) measured and what to change in-game.
>
> **Source:** `sim/out/results.json`, seed 12345, 10,000 runs/point, real-board
> greedy AI. Numbers are directional (one-ply AI, board-touching passives not yet
> modeled) — trust **relative** signals (sweep slopes, A-vs-B), treat single
> absolute figures as guidance, and re-run after changing a knob.

---

## 0. TL;DR

1. **Fights are ~2× too long.** Enemy HP should be ≈ **player DPT × target turns**; current HP is roughly double that. Halve early enemy HP (or double player DPT).
2. **Attack ≫ Max HP per point** (early): +1 Attack ≈ **+11 HP** of win-rate value and cuts 3–6 turns; +1 HP barely moves win rate and just prolongs. Attack has strong diminishing returns.
3. **Max HP is near-worthless unless enemies are lethal.** Under full-heal, HP only buys survival you actually need — and **enemy Attack** is the knob that creates that need (very sharp: +1 enemy atk ≈ −10 to −25 pp win).
4. **Pure-damage skills are weak for Attack/skull characters** — they compete with skull-matching and barely help. Skills should **bundle `extra_turn`/utility or be cheap**; measure skill numbers on a *caster* (skill-reliant) archetype, not a skull build.
5. **The boss is mathematically unwinnable** (170 HP + +1 atk/turn ramp → 0% win at every player attack 1–10). Cap/drop the ramp and lower boss HP.

---

## 1. Measured combat economy (replaces the assumed §16 constants)

Per-action averages from the real-board AI:

| Build | DPT | m (skull matches/turn) | 4+/turn | cascade steps/action | mana/turn |
|---|---|---|---|---|---|
| Skullish (atk 1, no dmg skill) | **1.0** | 0.33 | 0.26 | 1.23 | 3.5 |
| Durable (atk 1, Strike+Bash) | **1.6–1.9** | 0.26–0.30 | 0.24 | 1.21 | 3.5 |
| Caster (atk 1, Bolt) | **2.6** | 0.21 | 0.20 | 1.02 | 3.1 |
| **Reference (atk 3, Strike+Bash)** | **2.4–2.7** | 0.29–0.35 | 0.18–0.20 | 1.19 | 3.3 |

- Original §16 guesses were **m ≈ 0.5–0.6** (actual ~0.3 — the AI chases 4+ extra-turns over lone skull 3-matches) and **baseline DPT ≈ 3.5** (actual **1.0–2.7**; attack-1 is ~half the assumption).
- `4+/turn ≈ 0.2`, `cascade ≈ 1.2`, `mana/turn ≈ 3.4` — all close to estimates.

---

## 2. Pacing → enemy HP

Target fight length: **normal 6–10 turns, elite 12–18, boss 20–30.** Everything currently runs long (reference vs floor5 = 70% win but **17 turns**).

`enemy_hp_pacing` (reference build, DPT ≈ 3.4):

| enemy HP | turns | win |
|---|---|---|
| 25 | 8 | 98% |
| 35 | 13 | 88% |
| 45 | 16 | 71% |
| 55 | 19 | 48% |
| 65 | 21 | 28% |

**Rule:** `enemy HP ≈ playerDPT × targetTurns`. For a build with DPT = D, scale these by D / 3.4.

**Recommended enemy HP (for a DPT≈3.4 mid-act character):**

| tier | current (mock) | recommend | target turns |
|---|---|---|---|
| early minion | 30–46 | **~25–30** | 8 |
| late minion | 62 | **~45–50** | 14 |
| elite | 85 | **~45–60** | 14–18 |
| boss | 170 (+atk ramp) | **~120–140**, capped ramp | 24 |

Then **ramp HP per floor with the expected player-DPT curve** (DPT rises mainly from Attack picks/relics).

---

## 3. Stat scaling: Attack vs Max HP

`attack_value_vs_floor5` (skullish) and `maxhp_value_vs_floor5`:

| stat | Δ win-rate / point | effect on turns | notes |
|---|---|---|---|
| **+1 Attack** | **+0.15–0.17** (atk 1→3), falling to +0.03–0.04 (8→10) | **−1.8 to −5.7 turns** | dominant lever; strong diminishing returns |
| **+1 Max HP** | +0.01–0.02 | **+0.5 to +0.9 turns** (prolongs) | weak; only insurance value |

- **HP ↔ Attack exchange:** +1 Attack ≈ **+11 Max HP** at the low end (skullish 1→2).
- HP raises win rate only by surviving longer grinds; at low DPT it can't close fights (maxHp 48 still only 43% vs floor5 at attack 1).

**Recommendations**
- **Attack is the primary stat + pacing knob.** Couple enemy-HP growth to expected Attack growth — un-matched attack collapses fight length.
- A **"+1 Attack vs +6–10 HP" pick is self-balancing**: Attack wins early (steep marginal value), HP catches up late (Attack's diminishing returns) — *only if enemies stay lethal* (§4).
- Consider **base Attack 2–3** instead of 1: the 1→3 band is so steep it makes early picks swingy and the curve unstable.

---

## 4. Enemy Attack = the lethality knob (keep it low)

`enemy_attack_lethality` (reference vs floor5):

| enemy attack | reference win | Δwin/pt |
|---|---|---|
| 1 | 88% | — |
| 2 | 70% | −0.18 |
| 3 | 45% | −0.25 |
| 4 | 35% | −0.10 |
| 6 | 22% | −0.04 |

- Each +1 enemy Attack costs the player ~10–25 pp early. This is **what gives Max HP a job** (creates death-risk) — without it, HP is dead weight (§3).
- **Recommend:** minions Attack **1–2**, elites **2–3**, boss low base **2–3** with **telegraphed bursts**, not sustained high attack.
- `attack_value_vs_boss` = **0% win at every player attack 1–10**: the boss's 170 HP **+1 atk/turn** ramp out-races any solo build over ~22 turns. **A ramping high-attack boss over a long fight is unwinnable — cap/remove the ramp and lower boss HP.**

---

## 5. Skills

**The big caveat:** the ratio sweeps were run on the Attack-3 reference, where the lone pure-damage skill is a *small* part of the build's power (skull-matching dominates). Result: the curve is **noisy and nearly flat** (~63–71% win across ratio 0.8–2.25, climbing to 78–82% only at 2.5–3.0), and the auto-derived "min 2.5 dmg/mana → cost5 = 13 dmg" table is **confounded — do not ship it.**

**Real conclusions:**
1. **Pure-damage skills are weak for Attack/skull characters** — they compete with already-strong skull damage. Such skills must **bundle `extra_turn`/utility or be cheap** to earn a slot.
2. **Measure skill numbers on a skill-reliant (caster) archetype** — low Attack, no skull alternative. There a ~**1.0–1.5 dmg/mana** ratio is meaningful and carries the build.
3. **Cost is a modest lever on a strong character** (cost 3 = 76% → cost 12 = 55% at fixed 8 dmg) but cheaper workhorse skills (cost **3–6**) are clearly better; expensive skills (8+) must over-deliver.
4. **The extra-turn engine dominates** (Bash is why durable/reference function at all). Skills/relics that grant or enable 4+ matches / extra turns are **disproportionately strong — price them high.**

---

## 6. Archetype notes

- **Caster** (26 HP, DPT 2.6): only **4% win** vs floor5 — high DPT but dies (glass). Low-HP/high-DPT only works in short fights → another argument for lower enemy HP.
- **Skullish** (Attack 1, DPT 1.0): the floor of the power curve. Useful as the "skull baseline," not a state a character should be stuck in.
- **Reference** (Attack 3, DPT 2.7): healthy 70% vs floor5 — the right archetype to tune enemies/skills against, but fights still run long until enemy HP drops.

---

## 7. Concrete change list

**Enemies**
- Halve HP toward §2 table; ramp per floor by expected player DPT.
- Attack low + slow (minions 1–2, elites 2–3, boss 2–3); bursts over sustained.
- Boss: ~120–140 HP, cap/remove the per-turn attack ramp.

**Player stats**
- Base Attack 2–3; Attack is the main DPT/pacing lever.
- Pick exchange ≈ 1 Attack : 6–10 HP (self-balancing); keep enemy Attack lethal enough that HP is a real choice.

**Skills**
- Pure damage → bundle tempo/utility or keep cheap.
- Workhorse cost 3–6; price extra-turn/4+ enablers high.
- Derive damage-per-cost from a caster archetype (~1.0–1.5 dmg/mana + tempo), not the skull build.

---

## 8. Sim caveats & next steps

**Caveats**
- One-ply greedy AI (matches the game's `EnemyAI`, not a perfect player); board-touching passives (spawn-rate, convert/destroy) not yet modeled.
- Skill ratio data is **confounded** on the Attack build and **noisy** (Δwin ±0.35) — needs a skill-reliant archetype.
- HP↔Attack exchange goes "off-scale" past Attack 2 because the maxHp sweep tops out at 48 HP.

**Next steps to get shippable skill numbers**
1. Add a **caster/skill-reliant archetype** (Attack 1, moderate HP, lone nuke) and point the ratio/cost sweeps at it.
2. **Extend the maxHp sweep to ~80** so the exchange isn't off-scale at higher Attack.
3. Lower scenario enemy HP to the §2 values and re-run to confirm pacing lands in the target bands.
4. Once skills are clean, model board-touching passives so relic value can be measured too.
