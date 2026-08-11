---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-10 (pre-test observability shipped; Riley smoke-testing iMessage).

## Already on `main` / shipping

- Turborepo API + web; iMessage ops via Sendblue + AI SDK tools (OpenRouter).
- Dynamic agents: `cursor_agents` + `dev_tasks`.
- API deploy: bundled Vercel Build Output (`apps/api` `build:vercel`) — Web Handler API.
- Memory: **keyed facts** in `memories` (key required). Tight preamble (≤6 facts, ≤3 tasks, ~6 chat turns).
- Observability: `ai_events` + daily AI token/cost rollups; `lead_events` funnel spine.
- Migration through `0003_observability.sql`.
- Roadmap (post-test): `knowledge/ops/memory-and-metrics.md`.

## Prefs

`knowledge/ops/preferences.md` + `AGENTS.md`: ship to **main**; Vercel token **only** `api-generated`; ask in chat/iMessage.

## Still open

1. Riley re-test iMessage after Sendblue `waitUntil`/await fix (webhook was 200’ing then freezing before reply).
2. Lock deposit + `PRIMARY_CHECKOUT_URL`.
3. Post-test: invoice-accurate costs, FTS recall, sales surface split — see `memory-and-metrics.md`.

## First moves in a new chat

1. Read this + `preferences.md` + `memory-and-metrics.md`.
2. `pnpm db:migrate` if needed; check `/health`.
3. Continue shipping to `main`.
