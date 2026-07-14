# Act 1 Enemy Ideas — Minions, Passives, and the Blood Knight

> **Status: IDEAS ONLY — nothing here is implemented.**
> Brainstorm doc for expanding the Act 1 roster after cutting the off-theme
> enemies (goblin, goblin sapper, orc, orc taskmaster, shadow weaver, stone
> gargoyle). Everything below is designed to fit the kept roster's theme and,
> where possible, to be buildable from machinery the engine already has.

---

## 1. The Theme (what "in theme" means)

The kept roster reads as one coherent place — **the blighted barony of Lord
Malakor, a vampiric usurper**:

| Kept enemy | Thread it carries |
|---|---|
| Acolyte | The **doom cult** that serves the Baron (Doomsong) |
| Thrall | **Enslaved flesh** — the Baron's chattel (and his Thrall tiles) |
| Chokeweed | **Carnivorous, encroaching wilds** |
| Blight Warden | **Fungal corruption** creeping over the land |
| Goresnout Trackers | The Baron's **hunting packs** |
| Abomination (Flesh Mongrel) | **Diseased, stitched flesh** |
| Cyclops | The dumb **brute muscle** kept on a chain |
| Sanguine Phoenix | **Blood rebirth** — the Baron's crimson menagerie |
| Lord Malakor | The **blood-baron** himself: thralls, harvest, exsanguination |

So the design space is: **blood, tithe & sacrifice · thralldom & the cult ·
plague/blight/carrion · the corrupted hunt**. New enemies should feel like
they belong to one of those four threads (ideally touching a second).

What the roster currently *lacks* mechanically (gaps worth filling):

- **Mana denial / disruption** — nothing drains or locks the player's economy
  (Malakor's old Soul Burn aside). A "tithe collector" archetype is wide open.
- **Bleed / damage-over-time pressure** — the `bleeding` status exists and is
  fully wired but *no enemy applies it*. Blood Knight territory.
- **Status usage in general** — silenced/crippled/brittle/frozen are all
  implemented and almost unused by enemies.
- **A defensive/armored wall** — nothing forces the player to out-value armor.
- **`smart_matcher` AI** — implemented, referenced by no enemy. An elite
  "duelist" that simply *plays the board well* is free threat with zero new code.
- **Berserk** — a designed-but-unwired status stub waiting for an owner.

---

## 2. Building Blocks Already in the Engine

Feasibility legend used throughout this doc:

- **[data]** — pure catalog/data entry; composes existing triggers + effect types. No code.
- **[small]** — one new handler / condition / flag in an existing extension point
  (skillEffectHandlers registry, `_handlePassiveBoardEffect`, a status checkpoint,
  an `enemyAiOverrides` entry).
- **[system]** — a new mechanism (new tile family, new trigger, new turn machinery).
  Costs a real implementation pass + sim-engine parity (`sim/toolbench/engine.mjs`)
  + a formula-policy awareness question (see §7).

Existing pieces to compose from:

- **Triggers:** onBattleStart, onTurnStart/End, onTileMatch, onTileMatchType
  (+`condition: {typeId, minCount}`), onMatch4Plus, onGainMana (+`condition.color`),
  onTileCreated, onIncomingDamage, onTakeDamage, onDealDamage, onDeath —
  plus the **`anySide: true`** flag (react to the *player's* events, Vampiric Roots style).
- **Effect types:** damage (scaling / perSkull / leech), armor, barrier, heal
  (`perCount`), gain_mana, **drain_mana**, gain_attack/magic/max_hp, extra_turn,
  reduce_damage, **echo_damage**, modify_stat / spawn_rate / mana_gain /
  skull_damage, attack_per_unspent_mana, create_tiles (`avoidMatches`),
  convert_random_tiles / convert_tiles_by_type / convert_tile,
  destroy\_\* (incl. destroy_random_skulls), **harvest_tiles**, **transform**,
  apply_status, apply_poison, mark, **lock_color**, consume, transmute_mana, shuffle.
- **Statuses:** silenced, crippled, enfeebled, brittle, **bleeding**, frozen,
  intangible, **berserk (stub!)**, reflecting.
- **Tile tech:** inert tiles (Disease), wild tiles (Thrall), **timer-in-the-type-id
  timed tiles** (Fungal 2→1→explode) — the fungal pattern generalizes to any
  "countdown tile" with a different detonation payload.
- **Big machinery:** mid-battle **transform** (Phoenix⇄Egg — reusable for stances
  and death-transforms), the egg-phase "kill it this turn" deadline, custom AI
  registry, per-floor HP/attack scaling.

---

## 3. New Mechanic Ideas (the toolbox)

### 3.1 Blood mechanics (the act's signature, currently boss-only)

1. **Blood Price casting** — an enemy whose skills cost *its own HP* instead of
   (or on top of) mana. Reads as devotion/vampirism; creates a natural race:
   the more it casts, the closer it is to death. **[small]** — a `selfDamage`
   payload on a skill effect (the damage chokepoint already exists; it's one
   handler that targets `src` instead of `tgt`).
2. **Lifesteal skills** — `damage.leech` already exists on damage effects
   (woven-skill machinery) and works for enemies **today**. A leech-flavored
   minion is free. **[data]**
3. **Blood Tithe** — drain the player's mana at turn start ("the Baron taxes
   everything"). `drain_mana` is atomic in EffectResolver, so a relic with
   `trigger: onTurnStart, effectType: drain_mana` should just work. **[data]**
4. **Blood tiles (BLOOD)** — a red-affine tile family using the Fungal pattern:
   matches WITH Red (emitted as red matches), but every blood-tile match **heals
   the enemy per tile** (Vampiric Roots with `condition.typeId:'red'`) — "his
   blood is in the land; spill it and he drinks." Optionally timed
   (congeals into a Skull after N turns). **[system]** — new tile ids + a
   `_scanLineRuns` class join, but it's a straight copy of the fungal recipe.
5. **Wound counting** — enemy gets stronger per damage *instance* it suffers
   (not amount): `onTakeDamage → gain_attack +1`. "Every cut feeds it." **[data]**
6. **Hemorrhage** — bleeding that *spreads*: while the player bleeds, the enemy's
   skull matches deal +N. Approximable today as a conditional damage rider;
   cleanly = a `condition: {status:'bleeding'}` gate on passive effects. **[small]**

### 3.2 Cult / tithe / ritual mechanics

7. **Ritual countdown** — an enemy that does almost nothing for N turns, then
   detonates a huge effect (Doomsong's big sibling). Two implementations:
   a timed tile it plants ("ritual candles" — fungal pattern, detonation =
   big damage instead of spread) **[system-lite]**, or a custom AI that counts
   its own turns **[small]**.
8. **Color vow / Interdict** — the cultist *locks* a color at turn end
   ("the rite forbids Blue"). `lock_color` exists (player-side); enemy passive
   path = a small `_handlePassiveBoardEffect` case that calls the same
   `_executeLockColor` on a chosen color. **[small]**
9. **Mana inversion / Heresy** — `transmute_mana` on the *player* ("your Purple
   curdles to Red"). Effect exists caster-side; opponent-target variant is a
   flag. **[small]**
10. **Congregation** — a minion that gets stronger per *other cultist you've
    already slain this act* (reads `runState.seenEnemiesByAct`). Flavorful
    meta-scaling; cheap to compute at battle-state creation. **[small]**
11. **Martyrdom** — on death, curse the player for the NEXT fight (a one-fight
    debuff carried on runState). New persistence seam — powerful but scope-y.
    **[system]**

### 3.3 Plague / carrion / blight mechanics

12. **Carrion economy** — an enemy that *feeds on Skull tiles*: whenever ANY
    skull match happens (`anySide + condition.typeId:'skull'`), it heals or
    gains attack. Punishes the player's main damage source the way Vampiric
    Roots punishes Green. **[data]**
13. **Grave bloom** — Disease tiles that *hatch*: reuse the fungal timer with
    detonation = "convert to Thrall (wild) for the ENEMY's benefit" or
    "spawn 2 more Disease". **[system-lite]** (fungal recipe, new payload).
14. **Miasma** — while ≥N Disease/Fungal tiles are on the board, the player is
    `enfeebled` (can't gain mana) or takes +1 from all sources. Board-state-
    conditional status: needs a per-turn board census. **[small]**
15. **Corpse bloat → detonation transform** — a minion that, at half HP or on
    death, **transforms** (Phoenix machinery) into a different, nastier form
    ("the swarm leaves the body"). Death-transform is proven; *threshold*
    transform needs an HP-threshold trigger (see §3.5). **[small/system]**
16. **Infestation spawn-rate** — `modify_spawn_rate` on skulls or green ("the
    ground here is rotten"). Exists (Sulfur). **[data]**

### 3.4 Hunt / pack mechanics

17. **Pack pressure / Relentless** — every extra turn the PLAYER takes angers
    the pack: `anySide` reaction to the player's extra-turn grant → enemy gains
    attack. Needs an `onExtraTurn` trigger dispatch (the internal callback
    already exists). **[small]**
18. **Quarry mark** — the enemy `mark`s the player (the ×2-next-hit pool exists
    on combatants): "the hound has your scent — its next hit lands double."
    Effect exists (player-woven); enemy-cast is data if `mark` resolves for the
    enemy side (it should — it's side-agnostic on the caster). **[data]**
19. **Ambusher** — opens the fight with a free hit or pre-armed board: e.g.
    `onBattleStart` create 4 Skulls near the player rows, or start with
    the player `bleeding` for 1 turn. **[data]** (create_tiles / apply_status
    on battle start).
20. **Cowardice / skittish** — takes only 1 damage from the FIRST hit each turn
    (intangible-like but per-turn). Needs a per-turn once flag in the damage
    chokepoint. **[small]**

### 3.5 Cross-cutting new triggers worth building once

These unlock a whole class of designs each:

- **`onHpThreshold` (e.g. first time below 50%)** — enrage beats, stance
  transforms, "wounded animal" AI switches. Dispatch from `_applyDamage` after
  HP resolves; one-shot latch per threshold. **[small]** — highest value per
  line of code on this list.
- **`onExtraTurn` (player earned an extra turn)** — pack anger, tempo taxes.
  The controller already computes the moment; it just doesn't dispatch. **[small]**
- **`condition: {status: 'x'}` / `{boardCount: {type, min}}`** — payload gates
  on passive effects, letting relics read "is the target bleeding / are there
  ≥4 skulls" without new triggers. **[small]**

---

## 4. Enemy Passive (Relic) Ideas — the big list

All follow the enemyRelicCatalog shape. Names are pitch names; `[tag]` =
feasibility per §2. The interesting ones create a *player decision*, not just
a stat tax — flagged **(tension)** where the counterplay is a real choice.

### Blood

| Passive | Effect sketch | Feasibility |
|---|---|---|
| **Chalice of the Tithe** | onTurnStart: drain 1 mana of the player's most-stocked color | [small] (drain exists; "most-stocked" targeting is a few lines) |
| **Open Veins** | onTakeDamage: gain +1 Red mana per hit — *your blows fund its casts* **(tension: burst it, don't chip it)** | [data] |
| **Scent of Blood** | anySide onTileMatchType(skull): gain +1 Attack — *every skull match excites it* **(tension: skulls heal your damage output but feed its rage)** | [data] |
| **Crimson Pact** | Its skills also cost it HP (blood price) — cast rate races its own death | [small] |
| **Leech Gland** | Its damage heals it for half (leech fraction on its damage effects) | [data] |
| **Vampiric Aura** | anySide onTileMatchType(red): heal 1 per tile — Vampiric Roots, red version **(tension: red-heavy builds feed it)** | [data] |

### Cult / ritual

| Passive | Effect sketch | Feasibility |
|---|---|---|
| **Litany of Ash** | onTurnEnd: lock a random color for 1 turn ("the rite forbids it") | [small] |
| **Hymnal of the Usurper** | onTurnStart: gain 1 mana of EVERY color (mini Heart-of-Usurper engine for a caster minion) | [data] |
| **Sacrificial Brand** | onDeath: deal damage equal to remaining ritual progress / its attack — a death-spite hit | [data] (onDeath + damage) |
| **Icon of Doom** | Doomsong-adjacent: onTurnStart, if it has full purple, its next skill costs nothing (or: modify_mana_gain purple +1) | [data] for the mana-gain form |
| **Wax and Wick** | onTurnEnd: create 1 timed "candle" tile; if any candle survives to its next turn start, drain 2 player mana | [system-lite] (fungal recipe) |

### Plague / carrion

| Passive | Effect sketch | Feasibility |
|---|---|---|
| **Carrion Crown** | anySide onTileMatchType(skull): heal 1 per tile — *it eats the dead you make* **(tension: your skull engine heals it — race with colors or out-DPS the heal)** | [data] |
| **Weeping Sores** | onTakeDamage: create 1 Disease tile — hitting it fouls the board | [data] (create_tiles fires on the owner's trigger) |
| **Gravemold** | onBattleStart: +10pp Skull spawn rate — the whole fight is deadlier for both sides | [data] |
| **Swollen Host** | First time below half HP: transform into the hatched form (threshold transform) | [small/system] (needs onHpThreshold) |
| **Plaguewind** | onTurnEnd: convert 1 random player-useful color tile into Disease | [data] (convert_random_tiles from:'blue' to:'disease') |

### Hunt / martial (Blood Knight support)

| Passive | Effect sketch | Feasibility |
|---|---|---|
| **Dueling Code** | reduce_damage 1 on every incoming hit (onIncomingDamage) — chip damage is useless; commit to big hits | [data] |
| **Riposte Stance** | reflecting-style: after taking a skill hit, deal its attack back | [data-ish] (reflecting status exists; permanent version = onTakeDamage → damage) |
| **Bloodhound's Patience** | onExtraTurn(anySide): gain +1 attack when the PLAYER takes extra turns — taxes greedy tempo play **(tension: your best line has a cost)** | [small] (needs onExtraTurn dispatch) |
| **Heavy Plate** | onBattleStart +armor; onTurnStart +1 armor (goblin_totem, bigger) | [data] |
| **Banner of the Red Court** | While it lives... (aura for future multi-enemy fights) — parked until multi-enemy exists | [system] |

---

## 5. New MINION Roster (pitches)

Stat baselines are floor-1-equivalent (MapScene scales by depth). Target the
measured minion band (85–95% player win, greedy bracket). Each pitch: thread,
kit, the player tension, suggested floors.

### 5.1 Bloodbound Flagellant — *cult + blood* (early, floors 2–4)

The cult's self-mutilating zealot. **Teaches: enemy state can ramp — kill fast.**

- **Stats:** HP ~14, attack 1, no mana engine needed.
- **Skill — Mortification** (free, like Encroach): deal 1 damage *to itself*,
  gain +2 Attack. The Chokeweed pattern reversed — it races its own HP down
  while its threat climbs. [small] (self-damage payload; everything else exists)
- **Passive — Open Veins**: onTakeDamage → gain +1 Red mana (fuel for a future
  red skill, or purely flavor-economy).
- **Tension:** it kills itself *for* you, but if you stall it out-damages you.
  Simple, readable, very on-theme.

### 5.2 Tithe Collector — *cult + tithe* (mid, floors 3–5)

A hooded creature with the Baron's scales and ledger. **Fills the mana-denial gap.**

- **Stats:** HP ~16, attack 2.
- **Passive — Chalice of the Tithe**: onTurnStart, drain 1 of the player's
  most-stocked mana color. [small]
- **Skill — Census of Souls** (4 purple): drain 2 of every player color, deal
  damage equal to (some fraction of) mana drained. [data: drain_mana + damage;
  "damage per drained" would be small]
- **Tension:** hoarding mana for a big skill becomes risky; spend-it-or-lose-it
  pressure. Counterplay = cast early, run lean.

### 5.3 Leech Swarm (a.k.a. "The Wriggling Tithe") — *blood + carrion* (floors 4–6)

A blanket of leeches wearing a drowned thrall like a coat.

- **Stats:** HP ~18, attack 1 (low direct threat, sustain threat instead).
- **Skill — Drink Deep** (3 red): deal 4 [[phys]] with **leech 1.0** (heals
  itself for all damage dealt). [data — `damage.leech` exists today]
- **Passive — Vampiric Aura**: anySide red matches heal it 1/tile. [data]
- **Tension:** a red-leaning player build literally feeds it (mirror of the
  Blight Warden's green problem — now the OTHER primary color has a predator).
  Between Warden (green) and Swarm (red), map routing starts to matter.

### 5.4 Marrow Golem — *carrion + brute* (floors 5–7)

Stacked bones fused with grave-wax; the cult's cheap construct labor.

- **Stats:** HP ~15, attack 2, **armor 8** (the wall archetype).
- **Passive — Carrion Crown**: anySide skull matches heal it 1/tile. [data]
- **Passive — Dueling Code**: reduce_damage 1 (all chip −1). [data]
- **Skill — Bone Spur** (4 yellow): deal 5 [[phys]], gain 3 armor
  (armor scaling `_33` like other enemy armor skills). [data]
- **Tension:** your skull engine — the default damage plan — *heals* it, and
  small hits bounce off. Forces skill damage / big matches. A midgame skill
  check the way Cyclops is a stat check.

### 5.5 Gravewing Murder — *carrion + hunt* (floors 5–7)

Carrion crows that follow the Goresnout packs. Many tiny hits.

- **Stats:** HP ~13, attack 1.
- **Skill — Murder of Beaks** (3 blue): deal 1 [[phys]] ×4 instances (authored
  as four 1-damage effects — each triggers on-hit passives separately). [data]
- **Passive — Weeping Sores** (inverted): onDealDamage → create 1 Disease tile
  (Infected Tooth reuse — each peck fouls the board). [data]
- **Tension:** anti-armor inversion of the Golem — lots of tiny hits shred
  block-per-instance defenses and litter the board; big single shields don't
  care. Together, Golem + Murder teach the armor math from both sides.

### 5.6 Bog Hag of the Red Court — *cult + blight* (floors 6–8)

The witch who stitches Abominations. **The status-effect user the act lacks.**

- **Stats:** HP ~17, attack 2, starts 3 purple.
- **Skill — Tongue-Tie Hex** (4 purple): apply `silenced` 1 turn + deal 3 [[mag]]. [data]
- **Skill — Wither** (5 green): apply `enfeebled` 1 turn (no mana gain) +
  convert 2 random player-color tiles to Disease. [data]
- **AI:** alternates hexes; standard AI handles it if costs stagger, else a tiny
  `bog_hag` override (cast priority list, Malakor-style). [small]
- **Tension:** first enemy that attacks the *player's verbs* (casting, mana)
  instead of their HP. Teaches status icons before the boss.

### 5.7 Chained Ghoul — *thralldom* (floors 3–5, Thrall's big sibling)

A thrall that "graduated." Escalation of the floor-2 Thrall fight.

- **Stats:** HP ~20, attack 2.
- **Skill — Rend** (3 red): deal 4 [[phys]], apply **bleeding** 2 turns. [data —
  bleeding is fully wired and unused; cheapest possible "new feel"]
- **Passive — Scent of Blood**: anySide skull matches → +1 attack. [data]
- **Tension:** the act's bleed introduction, pre–Blood Knight. Bleeding punishes
  slow value turns; skull matches feed it, so your damage plan has a tax.

### 5.8 Ritual Candles / The Vigil — *cult ritual* (floors 6–8, weird fight)

Not a monster — an *unattended rite*: a ring of candles and a droning voice.
The "puzzle minion" slot (like the Phoenix egg, but a whole fight).

- **Stats:** HP ~10, attack 0. It never attacks.
- **Passive — Wax and Wick**: onTurnEnd create 2 timed candle tiles (fungal
  recipe); any candle surviving its timer → the Vigil drains 2 player mana and
  gains +5 max HP & heals 5 (the rite advances). [system-lite]
- **Skill — none, or Doomsong at full purple** (the classic "finish it before
  the song ends").
- **Tension:** pure board-control race with zero incoming damage — a breather
  fight that still demands attention. Very cheap to balance (no attack).

---

## 6. ELITES

### 6.1 ⭐ BLOOD KNIGHT — the requested elite (floors 5–9)

**Concept.** The Baron's champion — a knight whose oath is paid in blood, his
own and yours. Where Cyclops is a stat wall and the Phoenix is a puzzle, the
Blood Knight is a **duelist**: he plays the board well, he makes you bleed, and
he gets *more* dangerous as the fight wounds him. The player's usual plan
("out-tempo it, chip it down") is exactly what he punishes.

**Identity pillars**
1. **Bleed** — he owns the `bleeding` status (wired, unused — his signature).
2. **Blood price** — his best skill costs HP, not just mana; he duels on a timer.
3. **The wound ramp** — damage *taken* makes him stronger (threshold beat).
4. **He plays well** — `aiBehavior: 'smart_matcher'` (implemented, unused):
   free "elite feel" from board play alone, zero new AI code.

**Stat sketch** (floor-1 baseline, elite band like Cyclops ~24–28):
HP ~24, attack 3, armor 4, starts 2 red.

**Skills**
- **Sanguine Riposte** (3 red) — deal 4 [[phys]] (attack `_50`), apply
  **bleeding** 2 turns. His bread-and-butter; the fight's clock. [data]
- **Oath of Wounds** (5 red) — *blood price:* pay 4 HP, deal 8 [[phys]],
  **mark** yourself... no — mark the PLAYER conceptually = his next hit ×2.
  Simpler wired version: pay 4 HP, deal 8 [[phys]] + gain +2 attack. [small —
  needs the self-damage payload; the rest is data]
- **Crimson Banner** (6 red, once he's wounded) — heal 6, gain 4 armor,
  convert 2 skulls → red (he *reclaims* the board). [data]

**Passives**
- **Dueling Code** — reduce_damage 1 on every incoming instance (chip is
  useless; commit). [data]
- **Scent of Blood** — anySide skull matches → +1 attack. Your default damage
  verb feeds his ramp; colors + skills are the clean counterplay. [data]
- **Knight's Last Oath** *(the elite beat)* — first time below 50% HP:
  gains **berserk** (deal/take double) for the rest of the fight — *finally
  wiring the berserk stub*, on the enemy designed for it. The fight audibly
  shifts gears: his hits double, but so does everything you land. [small —
  needs the onHpThreshold latch + finishing berserk's checkpoints]

**Fight arc.** Phase 1: he bleeds you and shrugs off chips while playing good
board moves. Phase 2 (below half): berserk flips the math — he can two-turn
you, but you can burst him. The player choice at the threshold ("do I push him
over the edge now, with my setup ready, or stabilize first?") is the elite's
signature moment, and it's *player-controlled*, unlike an enrage timer.

**Counterplay summary:** skill/color damage over skull spam (Scent of Blood),
big hits over chip (Dueling Code), heal/armor *before* triggering the
threshold, and respect bleed (end turns cleanly, don't sit at low HP).

**Build cost:** mostly data. New code = self-damage payload [small],
onHpThreshold latch [small], berserk checkpoint completion [small],
plus sim-engine mirrors of each (§7). `smart_matcher` is a def field.

### 6.2 Bonus elite concept — Herald of the Red Court (floors 6–9)

The cult's high priest; the "caster elite" to Blood Knight's "martial elite."

- **Kit:** Doomsong-line ritual on a visible timed-tile clock (Wax and Wick,
  scaled up: 3 candles per turn end); locks a color each turn end (Litany of
  Ash); Silence hex on the player when they hoard mana. Attack ~2, HP ~26 —
  he wins by the *rite* completing, not by hitting you.
- **Feel:** the "disrupt the ritual" fight — a race where the enemy attacks the
  BOARD and your ECONOMY. Complements Blood Knight (attacks your HP), Phoenix
  (attacks your closing speed), Cyclops (attacks your stats).
- **Feasibility:** candle tiles [system-lite, fungal recipe], lock passive
  [small], silence skill [data].

### 6.3 Bonus elite concept — The Grave Sow (floors 5–8)

A bloated carrion-beast trailing a litter of unborn horrors — a
**transform-chain** elite built entirely on the Phoenix machinery.

- **Kit:** big slow body (HP ~30, attack 3) with Weeping Sores (hits create
  Disease). **On death → transforms into "The Litter"** (a fast low-HP form,
  attack 5, berserk-ish stats, no relics) — kill the sow, then survive what
  crawls out. Unlike the Phoenix there's no revert: it's a straight two-phase
  fight using only proven `onDeath transform` machinery. [data + one more
  enemy def — arguably the *cheapest possible* new elite]

---

## 7. Implementation & Balance Notes (read before building any of this)

- **Sim parity is mandatory.** Anything touching BattleController/board logic
  must be mirrored in `sim/toolbench/engine.mjs` (see decision #46's checklist:
  parity, `drift-check.mjs`, and possibly new formula-policy weight keys — the
  Blight Warden added `fungalClear`/`oppMatchHeal`). Budget it into every
  [small]/[system] item above. Data-only relics that compose existing effect
  types generally flow through both engines for free.
- **The formula champion may need retraining** after any new mechanic the
  policy should *react* to (a new heal-on-my-matches predator like Leech Swarm
  is already covered by the generic `oppMatchHeal` derivation if authored as an
  anySide match-heal — nice reuse; bleed/berserk/threshold likely warrant new
  features only if measurement shows the policy misplays them).
- **Measure against the bands** (`node sim/toolbench/trainer.mjs enemies`,
  both AI brackets): minions 85–95% player win, elites lower; note the Blight
  Warden itself is currently OUT of band (59%/44%) — don't stack another
  green/skull-predator minion into floors 5–7 until it's re-tuned.
- **Art/SFX budget per enemy:** portrait (enemy portrait sheet), skill icons
  (enemy skills sheet), relic icons (relics sheet), optional dedicated SFX
  clips (SFX sprite repack). Tile families (Blood, Candle) need tile art +
  the timer-badge treatment.
- **Spawn-table hygiene:** new minions slot into `ACT1_FLOOR_SPAWNS`; keep the
  per-act dedup pool in mind (more variety per floor = fewer repeats). Floors
  1–4 are thin right now (acolyte/thrall/chokeweed/cyclops) — Flagellant,
  Chained Ghoul, and Tithe Collector are deliberately early-mid picks.
- **Suggested build order** (value ÷ cost): ① Chained Ghoul (pure data, ships
  bleed) → ② Leech Swarm + Marrow Golem + Gravewing Murder (pure data trio,
  fills red-predator/wall/anti-armor gaps) → ③ Blood Knight (the elite; brings
  self-damage + onHpThreshold + berserk, each reusable later) → ④ Tithe
  Collector + Bog Hag (denial/status pair) → ⑤ Vigil / Herald / Grave Sow
  (systems experiments).
