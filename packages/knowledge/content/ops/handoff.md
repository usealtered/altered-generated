---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (production log/DB audit of iMessage runtime; ensureStatus race fix).

## HEAD on main

See latest `main` - runtime fix `cc6ea04` plus follow-up `fix(imessage): serialize ensureStatus under parallel tools`.

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
  - `ensureStatus` is concurrency-safe (parallel tool calls no longer double-send "Checking that now.").
- Docs: `knowledge/ops/imessage-bridge.md`, `decisions.md` (2026-08-11), `memory-and-metrics.md`.

## Production verification (2026-08-11)

### Deploy map
- `dpl_ATgZT7w7tm33XJbbouzfD2G3RmvQ` = `94f6dbb` (**blocking** await-handlers era)
- `dpl_J3X23ewVFG4iaVtHpM4KrQRi368N` = `cc6ea04` (waitUntil fix)
- Current prod alias was on later `main` docs commit that still includes waitUntil path

### Log trace (Sendblue webhook)
| Time (UTC) | Deploy | Event | HTTP duration |
|---|---|---|---|
| 00:19:27 | ATgZT7w (blocking) | inbound "Hello..." → reply posted → 200 | **9s** |
| 00:20:41 | ATgZT7w | inbound tools Q → reply posted → 200 | **12s** |
| 00:51:54 | ATgZT7w | inbound change list → reply posted → 200 | **62s** |
| 01:06:12 | F2jpKw (waitUntil) | webhook received → **200** → then inbound/LLM/`turn complete sends:7` | **326ms** ACK |
| 01:11:02 | F2jpKw | warm → **200** then background turn `sends:7` | **5ms** ACK |

Confirmed: waitUntil works. Background turn continues after ACK. Multi-send works (`sends:7`). Paragraph `\n\n` preserved in latest outbound DB row. Tool flow includes `send_message` + `start_typing`. Read receipts via fork `sendReadReceipts: true` + explicit handler send (now logged).

### DB audit
- Tables OK; migrations through `0003_observability`.
- Cleaned: stale open task `1366f155` → `done`; mangled title task `38e02c4b` retitled.
- Cancelled prior-agent tasks remain cancelled with notes.
- Soft-default `settings.active_agent_id` = current runtime agent.
- Pre-fix outbound rows (00:19/00:20) still have em dashes/markdown - historical only.

## Prefs

`knowledge/ops/preferences.md` + `AGENTS.md`: ship to **main**; Vercel token **only** `api-generated`; ask in chat/iMessage.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Post-test scale: invoice-accurate costs, FTS recall, sales surface split - see `memory-and-metrics.md`.
3. Optional: after ensureStatus fix deploys, smoke one more iMessage turn and confirm single status bubble + `read receipt sent` log line.

## First moves in a new chat

1. Read this + `preferences.md` + `imessage-bridge.md`.
2. Confirm latest `main` is Ready on `api-generated`.
3. If Riley reports iMessage issues: `apps/api/src/app.ts` waitUntil, `packages/chat/src/outbound.ts`, truncate/split in `packages/cursor-bridge/src/client.ts`.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent line: `+13054098546` / Operator: `+12368370221`
