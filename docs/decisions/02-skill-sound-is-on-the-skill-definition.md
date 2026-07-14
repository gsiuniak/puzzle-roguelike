# Decision #2 — Skill sound is on the skill definition

> Extracted verbatim from CLAUDE.md §7 (2026-07-14 split). Historical record — reflects the design at time of writing.

**Skill sound is on the skill definition** (`.sound` field), not on individual effects. Played once per skill resolution via `_pendingSkillSound`.
