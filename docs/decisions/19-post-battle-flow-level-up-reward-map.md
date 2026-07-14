# Decision #19 — Post-battle flow: Level Up → Reward → map

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Post-battle flow: Level Up → Reward → map** — GAME_OVER does NOT immediately return to MapScene. On VICTORY, BattleScene first shows the [`LevelUpOverlay`](../../src/js/ui/LevelUpOverlay.js) (mandatory attribute pick); its `onDismiss` then opens the [`RewardOverlay`](../../src/js/ui/RewardOverlay.js); the reward overlay's `onDismiss` → `_returnToMap`. Both render over the still-visible BattleScene with a dark backdrop. ESC dismisses the reward overlay (not the level-up one). See decision #36.
