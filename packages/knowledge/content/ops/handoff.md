---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (iMessage runtime latency/formatting fix shipped; chat archiving).

## HEAD on main

`cc6ea04` - `fix(imessage): non-blocking Sendblue webhook + multi-send formatting`

## Already shipped (do not redo)

- Turborepo API + web; iMessage ops via Sendblue + AI SDK tools (OpenRouter).
- Dynamic agents: `cursor_agents` + `dev_tasks`. Soft-default in `settings.active_agent_id`.
- API deploy: bundled Vercel Build Output (`apps/api` `build:vercel`) - Web Handler API.
- Memory: keyed facts in `memories` (key required). Tight preamble.
- Observability: `ai_events` + daily AI rollups; `lead_events` funnel spine.
- Migration through `0003_observability.sql`.
- **iMessage runtime (2026-08-11):**
  - Webhook returns 200 immediately via Chat SDK + Vercel `waitUntil` (do **not** reintroduce awaiting all handler tasks before ACK - that blocked Sendblue).
  - Private fork `github:inducingchaos/chat-adapter-sendblue#integration` with `sendReadReceipts: true`.
  - Explicit read receipt before LLM; typing immediately before each outbound bubble.
  - Tools: `send_message` / `start_typing`; tool turns auto-status then work then final.
  - `truncateForImessage` preserves `\n\n`; `splitImessageParts` for multi-bubble.
  - System prompt: plain text, no em dashes, serious/brutalist/Hormozi tone.
- Docs: `knowledge/ops/imessage-bridge.md`, `decisions.md` (2026-08-11), `memory-and-metrics.md`.

## Prefs

`knowledge/ops/preferences.md` + `AGENTS.md`: ship to **main**; Vercel token **only** `api-generated`; ask in chat/iMessage.

## Still open / verify next

1. **Smoke-test iMessage** after Vercel redeploys `cc6ea04`: immediate ACK, read receipt, typing before replies, multi-send, paragraph breaks.
2. Pull Vercel logs for recent `api-generated` deploy (needs `VERCEL_TOKEN` - last hour of `dpl_ATgZT7w...` was requested but unavailable in prior chat).
3. Neon audit of `messages`, `ai_events`, `cursor_agents`, `dev_tasks`, `settings` (needs working `DATABASE_URL`; `SHARED_STORAGE_DATABASE_URL` auth failed in prior pod).
4. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
5. Post-test scale: invoice-accurate costs, FTS recall, sales surface split - see `memory-and-metrics.md`.

## First moves in a new chat

1. Read this + `preferences.md` + `imessage-bridge.md` + `memory-and-metrics.md`.
2. Confirm Vercel deployed `cc6ea04` (or later) on `api-generated`.
3. If Riley reports iMessage issues: check webhook `waitUntil` path in `apps/api/src/app.ts`, outbound session in `packages/chat/src/outbound.ts`, truncate/split in `packages/cursor-bridge/src/client.ts`.
4. `pnpm db:migrate` if needed; continue shipping to `main`.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent line: `+13054098546` / Operator: `+12368370221`
