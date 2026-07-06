# Balance changes — 2026-07-06 (first MEASURED retune via the trainer)

First balance pass driven by the new measurement stack (`sim/toolbench/trainer.mjs`
paired sweeps + the CEM-trained value policy + `rescore`). Reports referenced below
live in `sim/toolbench/reports/` (gitignored — re-run to regenerate).

**Method:** every number below was moved because of a paired common-seed A/B
measurement (ΔWin ± CI / eqHP) against the doc's reference frames, then re-measured
after the change. Enemy bands use `trainer.mjs enemies` (reference warrior,
winsPerFloor 0.7, floor-scaled median-build relic count ≈0.5/floor).

## 1. Analytic model (sim/toolbench/analytic.mjs — screening only, no gameplay change)

| constant | old → new | why (measured) |
|---|---|---|
| `DEV_armor` / `DEV_barrier` / `DEV_heal` | 0.9 → 1.1 / 1.0 / 1.1 | armor/heal skills measured ~1.5-3× their analytic price |
| `V_turn_floor` | 4 → 6 | CEM-trained policy values an extra turn ≈17 dmg; extra-turn skills measured above price |
| `dmgCap` (NEW) | — → 45 | a 999 nuke is "kills anything", not 999 (fixed boom_baby's degenerate dev=999 → must-pick) |
| `convert_tile` pricing | flat 1.5 → `0.6 × extraTurnValue + DEV_tile` (≈4-5) | measured eqHP ~70 (≈10-20+ DEV). **DELIBERATELY still under-priced** — Arcane Inscription is an intentional premium pick; do NOT "fix" this up to measured. |

`trainer.mjs rescore` now DISREGARDS degenerate fits: analytic dev > 100 and
|ΔWin| > 30pp (eqHP out of linear range) are excluded with a printed reason.

## 2. Weave pricing re-alignment (skillSynthesizer POWER + analytic SYNTH_POWER mirror)

Per the §5 drift contract: `perArmor` 0.45→0.5, `perHeal` 0.4→0.5, `extraTurn` 8→10.
Woven armor/heal/extra-turn spells now cost proportionally more mana.

## 3. Player relics (relicCatalog.js) — vs the rarity uplift bands (§6.5)

| relic | change | measured before → target |
|---|---|---|
| aegis (common) | armor 2→1, scaling _50→_33 | +7.2pp → ~+2.8pp ✓ (band ≤3) |
| slingshot (common) | damage 3→2 | +5.8pp → ~+2.2pp ✓ |
| thorned_rose (common) | damage 3→1 (+scaling) | +5.6pp → +5.0pp at 2, re-nerfed to 1 |
| cestus/harpoon/club/stiletto/wand (rare) | per 3→2 unspent mana | +2-3pp → ~+4.4pp (band 6-12; closer) |
| tsunami (legendary) | +2→+3 attack/turn | +6.7pp → ~+4.7pp at std frames (see note) |
| reckoning (legendary) | +1→+2 attack per hit taken | +4.4pp |
| soul_eater (legendary) | heal 1→2 per damage dealt | +2.5pp |

**Open item — legendaries:** even buffed, the ramp legendaries measure BELOW the
legendary band (>12pp) at standard frames; their value concentrates in LONG
elite/boss fights, which the standard frames under-weight. Either measure them at
boss-length frames before further buffs, or revisit the band / their design.
**Open item — potions/familiars measured ≈0:** characters start with 5-6 mana in
their kit colors, so +5 starting mana of one color adds almost nothing. Root cause
is the generous starting mana, not the relics — revisit if starting mana is reduced.
**flint measured −2.8pp** (spawn-boost dilutes skulls) while dewstone +5.3 — noisy,
left unchanged, watch.

## 4. Enemies (data/enemies/act1/*) — tuned to the §6.4 win-rate bands

Measured with `trainer.mjs enemies` before/after (n=150-200):

| enemy | change | player win before → after (floors) |
|---|---|---|
| goblin_sapper | hp 11→9, sulfur 15→10, boom_baby 20→25 red, ignition 20→12 tiles | 37-43% → **89-94%** ✓ |
| sanguinePhoenix | attack 3→2, hp 12→10, egg hp 3→2 | 51-53% → **73-75%** ✓ |
| abomination | hp 25→16 | 63-70% → **85-94%** ✓ |
| orc_taskmaster | hp 28→23 | 59-69% → **67-78%** ✓ |
| chokeweed | hp 16→20, attack 2→3 | 97-100% → **93%** ✓ |
| acolyte | hp 18→21, attack 1→2 | 97-99% → **89-96%** ✓ |
| goblin | hp 14→17, attack 1→2 | 100% → 100% — **left deliberately soft** (floor-1/2 onboarding; pure chip can't threaten the bot) |
| thrall | hp 20→22 | 95-99% → 94-98% (f2 borderline soft, accepted) |
| lordMalakor | unchanged | 47-48% ✓ (in boss band with a median relic build) |

Boss note: Malakor is IN BAND once the reference player carries a median relic
build — the old "3-10% win" readings came from a no-relic reference.

## 5. What was deliberately NOT changed

- **Arcane Inscription** — measured as one of the best value-per-mana skills in
  the game (+9pp, eqHP 70, ~23 eqHP/mana); it is an INTENTIONAL premium pick.
- **Witch Doctor magic reading 0** in stat sweeps — intentional hybrid design:
  his kit scales attack by default (Claw-style) while magic-scaling relics/skills
  picked up during a run make magic valuable. Don't "fix" his base kit.
- Character starting mana / potions (see open item above).
