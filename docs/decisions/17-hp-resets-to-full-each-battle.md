# Decision #17 — HP resets to full each battle.

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**HP resets to full each battle.** `createPlayerBattleState` seeds `hp` from effective `maxHp`, so current HP does NOT carry between fights. `syncBattleResultsToRunState()` still writes `currentHp` to run state (bookkeeping) but it isn't used to seed battle HP. Battle mana/armor/attack/temporary effects also do NOT persist.
