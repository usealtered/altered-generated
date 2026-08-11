---
title: Ops inbox
---

# Ops inbox

Append-only notes from iMessage `remember` commands and operator decisions.

## 2026-08-10

- Bootstrapped turborepo + iMessage RAG bridge targeting $250/day early-access deposits.
- Switched off single `CURSOR_OPERATING_AGENT_ID` singleton → dynamic workstream agents + `dev_tasks` in DB.
- Riley prefs documented in `knowledge/ops/preferences.md` (Git merge-when-complete, Vercel scope, continuity).
- Restart-safe: new chats should read AGENTS.md + preferences.md + `list_dev_tasks` / `list_cursor_agents`.
- Pre-test slice approved: AI cost events, tight keyed-memory preamble, lead_events; defer vectors/FTS until measured (`memory-and-metrics.md`).
