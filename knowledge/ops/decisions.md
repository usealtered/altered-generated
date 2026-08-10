---
title: Decisions log
---

# Decisions

## 2026-08-10 — iMessage as operator bus

- Use **this Cursor Cloud Agent** as the durable operating surface.
- iMessage (Sendblue + Chat SDK) is the intermediary: texts become Cursor follow-up runs on `CURSOR_OPERATING_AGENT_ID`.
- RAG answers (`ask`) stay local so status/knowledge queries do not wake a busy agent.
- QStash polls Cursor runs and texts back summaries.
- Revenue path for day-0: `/early-access` + Stripe $250 deposit + Neon leads.
