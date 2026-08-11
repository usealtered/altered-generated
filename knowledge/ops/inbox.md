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

## 2026-08-11

- Shipped iMessage runtime fix to main (`cc6ea04`): non-blocking webhook `waitUntil`, Sendblue fork + read receipts, typing-before-send, multi-send tools, preserve `\n\n` / split paragraphs, no-em-dash plain-text system prompt.
- Do not re-block the webhook by awaiting full LLM before HTTP 200 (that was briefly on main and wrong for latency).
- Production audit confirmed waitUntil (ACK 5-326ms vs prior 9-62s). Fixed parallel `ensureStatus` double-send. Cleaned stale `dev_tasks`. See `handoff.md`.
- Follow-up batch: read-receipt waitUntil race, Chat SDK burst concurrency, completion debounce+forced-tool summary, outbound sanitizer, AGENTS self-fix/audit defaults.
- Concurrency workstream: Redis cross-isolate send locks + status-ack SET NX; fixed notify lock key (base64url); notify drain lock; removed canned "Checking that now." (banned).
