# Decision #54 — GAME_OVER clears the match-4 hit-stop freeze at `_setState`, and the scene's hit-stop hold exempts GAME_OVER (2026-07-18)

**A battle could freeze permanently on the kill frame.** Reported on mobile: a large
wild-tile match brought the enemy to 0 HP and the game hard-froze with the damage
counter stuck mid-flight — no victory, no reward overlay.

## The deadlock shape

Three facts compose (each reasonable alone):

1. `BattleScene.update` early-returns while `isHitStopActive()` (the decision #42
   emphasis freeze pauses ALL scene animation) — and that check runs **before** the
   scene's GAME_OVER detection block.
2. `isHitStopActive()` = SHOW_MATCH + a live `_match4Flourish` + `_phaseTimer <
   _match4FreezeMs`.
3. `_phaseTimer` only advances while `state === RESOLVING`.

If the state becomes GAME_OVER while the freeze window is still open, the timer stops
advancing, the window never closes, hit-stop latches true forever, and the scene
early-returns every frame — permanently skipping the very block that would show the
victory/defeat flow. Headless repro confirmed the latch (600+ frames stuck).

In the shipped code the natural lethal-cascade path fired `_checkGameOver` only at the
END of the SHOW_MATCH hold, so the window was already closed — the ordering survived by
a single-frame timing margin, not by design. Any mid-flourish death check (a future
relic ending the battle from a match dispatch, a timing retune, a large mobile frame
delta) makes it live. The other GAME_OVER holds already had escapes (the held-skill
sound and the turn gate both special-case GAME_OVER); the hit-stop hold was the one
without.

## The decision

- **Controller:** `_setState(GAME_OVER)` clears `_match4Flourish` / `_match4FreezeMs`.
  `_setState` is the single transition point (review R12), so every death path —
  present and future — is covered; `isHitStopActive()` structurally cannot outlive a
  battle.
- **Scene (belt-and-suspenders):** the hit-stop early-return in `BattleScene.update`
  additionally exempts `state === GAME_OVER`, so even a latched hit-stop can never
  block game-over detection.

## Rule going forward

Any gate that pauses `BattleScene.update` early must either self-terminate on a timer
that advances in EVERY state, or explicitly exempt GAME_OVER. Never add a hold that
depends on `state === RESOLVING` to unwind.
