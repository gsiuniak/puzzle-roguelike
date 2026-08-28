# Decision #57 — The board's fall animation duration syncs to the controller's FALL phase (`getFallDurationMs`) (2026-08-27)

**Every falling tile snapped the last ~third of its drop.** `BoardPlaceholder`
animated falls over a hardcoded `_fallDuration = 350` ms, while the controller's FALL
phase actually lasts `BASE_PHASE_MS.FALL / speedMultiplier` = 350 / 1.5 ≈ **233 ms**.
`_finishStep` clears `fallCells` when the phase ends, so `_fallProgress` only ever
reached ~0.67 before the tiles teleported to their resting cells — a subtle,
ever-present hitch in cascade feel that predates the speed-multiplier retune (the
view's copy of the duration was simply never updated).

## The fix

One source of truth: the controller exposes
`getFallDurationMs()` (= `_phaseMs('FALL')`), and
`BattleScene.setBattleController` pushes it into the board via
`BoardPlaceholder.setFallDurationMs()` whenever the controller is wired. The raw 350
default remains only for controller-less placeholder boards.

**Rule:** any view-side animation that mirrors a controller phase must derive its
duration from the controller's timing helpers, never carry its own copy — a
`speedMultiplier` retune must reach the view automatically.

This is a deliberate, user-approved visible change (falls now ease all the way in),
shipped with the Phase 0.75 performance pass but independent of it.
