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

## 5. Skills (clean — measured on a skill-reliant caster)

Re-running the ratio sweeps on a **skill-reliant caster** (Attack 1, no skull alternative) removed the confound. The curve is now cleanly monotonic, with a real knee:

| cost | baseline (skill ignored) | **knee** (worth building) | strong |
|---|---|---|---|
| 5 | 37% | **~1.6 dmg/mana** | ~2.5 |
| 8 | 36% | **~1.4 dmg/mana** | ~2.5 |

**Shippable skill damage-by-cost** (pure single-color damage skill):

| cost | min (~1.6/mana) | strong (~2.5/mana) |
|---|---|---|
| 3 | 5 | 8 |
| 4 | 6 | 10 |
| 5 | 8 | 13 |
| 6 | 10 | 15 |
| 8 | 13 | 20 |
| 10 | 16 | 25 |

**Rules:**
1. A **pure-damage** skill needs **~1.6 dmg/mana** to beat skull-matching, ~2.5 to be build-defining.
2. Skills that **bundle `extra_turn`/utility can sit below `min`** (extra_turn ≈ 4 HPe, ~one turn). Bash (5 dmg + extra turn / 5 red) is effectively ~1.8/mana and is the workhorse — keep.
3. **Cost is a strong lever** (8 dmg costs 74% win at cost 3 → 39% at cost 8). Keep workhorse skills **cost 3–6**; expensive skills (8+) must over-deliver.
4. **The extra-turn engine dominates** — skills/relics that grant or enable 4+ matches / extra turns are **disproportionately strong — price them high.**
5. The current game's player skills are mostly fine; **Defend** (armor 5→6) and **Oungan** (heal 5→6) were under the curve and have been bumped.

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

## 8. Confirmed exchange numbers

With the maxHp sweep extended to 80 and floor5 at 35 HP, the HP↔Attack exchange now fully resolves (skullish, floor5):

| transition | HP per +1 Attack |
|---|---|
| atk 1→2 | ~9.7 |
| atk 2→3 | ~10.3 |
| atk 3→4 | ~8.9 |
| atk 4→5 | ~8.6 |
| atk 5→6 | ~6.9 |
| atk 6→8 | ~6.4 |

So **+1 Attack ≈ +9–10 HP at low attack, decaying to ~6–7 by attack 6+** (diminishing returns; fight-length-dependent per §11.1 of the research doc). A "+1 Attack vs +N HP" growth pick with **N ≈ 8** is roughly fair and self-balancing.

---

## 9. Applied changes (Phase 1)

Edited in `src/` to reflect the findings:
- **Auto-growth on victory (placeholder):** `BattleScene._applyVictoryGrowth` grants **+4 Max HP every win and +1 Attack every 2nd win** (via a `runState.victories` counter) through `applyRunModifier` (wires the previously-dead progression). Attack grows **slowly on purpose** — +1 Attack *every* win over-scaled DPT; +0.5/floor lands Attack ≈ 3 by mid-act and ~5–6 by the boss, matching the sim's reference curve. **Temporary** — to be replaced by a player-facing *growth screen* (choose a stat), analogous to the reward overlay.
- **Skills:** Defend armor 5→6; Oungan heal 5→6 (both were under the value curve).
- **Enemy attack (lethality knob, §4):** Orc 3→2, Shadow Weaver 5→4, Orc Taskmaster 4→3.
- **Bug fix:** Stone Gargoyle `hp 60 / maxHp 40` → `45 / 45`.

## 10. Phase 2 (next, needs more care)

- **Per-floor enemy HP/attack scaling at spawn** (`MapScene._transitionToBattle`) so a floor-gated minion stays relevant as player Attack grows — the proper "enemies track player DPT" mechanism (and what CLAUDE.md decision #11 *claims* but never implemented).
- **Add the missing boss** (`type:'boss'`, `floors:[10]`, ~150 HP, attack 3, no ramp) — floor 10 currently falls back to a Goblin. Can reuse an existing portrait to avoid new art.
- **Re-run the sim with the actual character kits** (Warrior/Mage/Witch Doctor) to validate, instead of the synthetic archetypes.

**Standing sim caveats:** one-ply greedy AI (matches the game's `EnemyAI`, not a perfect player); board-touching passives (spawn-rate, convert/destroy) not yet modeled. Trust relative signals; re-run after changes.

**Next steps to get shippable skill numbers**
1. Add a **caster/skill-reliant archetype** (Attack 1, moderate HP, lone nuke) and point the ratio/cost sweeps at it.
2. **Extend the maxHp sweep to ~80** so the exchange isn't off-scale at higher Attack.
3. Lower scenario enemy HP to the §2 values and re-run to confirm pacing lands in the target bands.
4. Once skills are clean, model board-touching passives so relic value can be measured too.
