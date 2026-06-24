# Balance Analysis: The Dominant-HP Problem

> **Status:** Design analysis (no code changes). Captured 2026-06-23.
> **Scope:** Why the post-victory Level Up stat choice collapses into "always pick Max HP," and the levers to fix it.
> **Related:** [`balance-scaling-research.md`](balance-scaling-research.md), [`balance-findings.md`](balance-findings.md), and the deep math companion [`balance-combat-math.md`](balance-combat-math.md).

---

## The problem statement (from design)

- Battles should last *long enough*, but not too long.
- Enemies should present a real threat.
- Players need HP to survive.
- Damage scaling comes *too easily* from (some) relics and from skills (magic, etc.).
- As a result, **just taking HP and relying on skills/relics to scale is almost always the better strategy** — the Level Up choice (Attack / Magic / Max HP, `LEVEL_UP_GROWTH = {attack:1, magic:1, maxHp:8}`) is a non-choice.

---

## The real diagnosis: the choice is *mathematically dominated*, not "players like HP"

Players aren't picking HP because it's fun — they're picking it because it's the **correct** play, and a correct-by-default choice is a non-choice. To fix the feel you have to make the math stop pointing at one answer.

The win condition is, roughly, a **product**:

```
win margin  ∝  (playerDPS × playerHP) / (enemyHP × enemyDPS)
```

Offense and defense are **symmetric multipliers** of combat power. To maximize a product `A × B` on a fixed budget, you invest in whichever factor is *smaller*. So a rational player always tops up their **weakest** axis. Right now that's HP — not because HP is special, but because the other systems already over-supply the offense factor, so `playerDPS` is the big number and `playerHP` is the small one. The Level Up screen is just correctly identifying which factor is underweight.

### Two structural causes in the code make this lopsided

**1. Offense is over-supplied elsewhere.** Relics + skills + the Skill Weave (magic gains, scaling tags) pump `playerDPS` hard. A `+1 Attack` level-up is a rounding error against that. So the offense card is *always* the dominated pick — it's redundant with systems you can't easily un-supply.

**2. Full HP reset removes attrition, turning Max HP into a clean, cost-free buffer.** `_applyPostBattleHealing` is `healPct = 0.0` and `createPlayerBattleState` reseeds full HP every fight (decision #17). The existing research doc notes this makes *armor/mitigation* "nearly worthless across a run" — but the flip side is that **Max HP becomes the purest stat in the game**: every fight is an independent full-HP check, so `+8 maxHp` directly raises the survival threshold for *every* fight with zero opportunity cost and zero diminishing returns. There's no run-level resource for HP to trade against. Of course it wins.

So: offense picks are weak because offense is supplied elsewhere; defense funnels entirely into Max HP because there's no attrition to make *other* defense (armor, avoidance, sustain) matter. The Level Up screen inherits a rigged comparison.

---

## Solution menu (three roughly-independent levers)

### Lever A — Make enemy scaling *demand both axes* (the math fix, cheapest)

The Level Up choice is only alive if the player is genuinely behind on **both** axes at different times. That requires enemy **HP** and enemy **damage** to each outrun what the player passively accrues:

- **Enemy HP must outrun free offense.** `ENEMY_HP_FLOOR_MULT` tops out at 4.75×. If relic/skill offense scales faster than that, time-to-kill *shrinks* over the run and offense investment is never needed → HP dominates. If enemy HP scales *faster* than passive offense, the player must spend picks on offense just to keep TTK flat. **This is the single biggest knob for making the offense card matter.**
- **Enemy damage must outrun flat HP.** `ENEMY_ATTACK_FLOOR_BONUS` is `+0..+3` additive while Max HP is `+8` flat per level — HP growth almost certainly outpaces incoming damage, so tanking always "catches up." If per-turn enemy damage scaled so a pure-HP build still gets bursted unless fights end faster, then **offense gains defensive value** (kill before they kill you). This is the "offense is the best defense" loop, and it's also exactly what makes fights "a real threat" and "not too long" — the stated goals. The dominance and the feel problem have the *same* fix.

The elegant version: tune enemy HP and damage curves so the player must keep *both* player axes inside a band. Then each Level Up is "which gap is more urgent right now?" — a real, build-and-floor-dependent decision instead of "HP again."

### Lever B — Change *what* the choice is (so it can't be reduced to a product)

Flat `+atk / +mag / +HP` are all on comparable scalar axes, so they *always* collapse to "feed the weakest factor." Make the options **non-fungible** so they can't be compared by one formula:

- Mana economy (starting mana, +1 mana per match of a color), extra skill-loadout slot, conversion/board upgrades, keyword unlocks, relic slots. These interact with *build*, so the Mage wants different things than the Warrior, and there's no dominant pick because they're not on one axis.
- Or make stat picks *conditional/synergistic*: "+3 Attack but +0 from relics this floor," "Magic also grants Barrier," etc. Anything that breaks the single-scalar comparison kills the dominant strategy.

This is more work but it's where the *interesting* decisions live. The relic/Skill-Weave systems already do this well — arguably why the flat stat screen feels flat by comparison.

### Lever C — Scripted per-character growth (the honest fix for *flat* stats)

If the flat stats are going to stay on one scalar axis, **a forced choice between them is fake agency** — there's a right answer, so it's really just taxing the player with a click. Auto-growing them per character is a legitimate, common design (many RPGs auto-grow base stats and put real choice in gear/skills). Benefits:

- Guarantees balanced curves → the designer controls TTK and threat directly instead of hoping players self-balance.
- Enforces character identity (Warrior leans HP/Attack, Mage leans Magic, Witch Doctor leans Magic/sustain).
- Removes the dominated click; agency moves to relics/Skill Weave where it's actually expressive.
- Trivial in the architecture: a `growthPlan` array on the character def applied via the existing `applyRunModifier` on victory, replacing the `LevelUpOverlay`.

The cost: you lose the "level up" *moment*. Mitigate by keeping a choice there that's **not** a stat (Lever B) — auto-grow the scalars, let the player pick a build-flavored boon. Curves stay designer-controlled, the moment stays a choice, and the choice is one without a dominant answer.

---

## Recommended combination

1. **Lever C for the scalars** — auto-grow Attack/Magic/HP on a tailored per-character curve. Stop pretending a single-axis comparison is a decision.
2. **Lever A to make the curves bite** — tune enemy HP to outrun passive offense (so the auto-granted offense is *necessary*, not decorative) and enemy per-turn damage to outrun flat HP (so killing faster has defensive value). This delivers "real threat + right-length fights."
3. **Lever B for the Level Up *moment*** — replace the stat cards with a small build-flavored boon pick (mana/economy/keyword), so the screen stays a choice but an *interesting* one.

### The underlying decision to make explicit

**Do you want run-level HP attrition at all?** Today you don't (full reset, 0% heal), which is why defense collapses into one stat and the run has no between-fight resource tension — unusual for a roguelike.

- **Add persistence + heals** (Slay-the-Spire option): Max HP, armor, and sustain all regain distinct value and much of this fixes itself organically.
- **Keep per-fight reset:** lean fully into offense/engine upgrades and stop offering HP as a growth axis at all.

Either is coherent; the current middle ground is what produces the dominant-HP feel.
