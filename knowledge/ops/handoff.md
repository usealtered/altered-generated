---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (instant pre-LLM status ack).

## HEAD on main

See latest `main`. Status ack ("Checking that now.") is now deterministic and pre-LLM.

## Already shipped (do not redo)

- iMessage waitUntil ACK, Sendblue fork read receipts, typing-before-send, multi-send, `\n\n` preserve.
- **Read receipt race fixed:** webhook fires mark-read + waitUntil before Chat SDK lock; handler no longer awaits receipt behind status sends.
- **Concurrency:** Chat SDK `burst` (700ms) for inbound; `withThreadSendLock` for outbound; Redis debounce (~3s) + `/webhooks/qstash/notify-flush` merges near-simultaneous Cursor completions into one summarized iMessage.
- **No raw dumps:** operator + notify use `toolChoice: "required"` + `done` (no execute). Completions summarized in plain text.
- **Sanitizer:** `sanitizeImessageText` strips em dashes/markdown before every outbound send.
- **Standing prefs:** AGENTS.md + preferences encode implicit change requests, drift self-fix, and default Vercel/DB/Redis/OpenRouter audit ownership.
- Migrations through `0003_observability.sql`.

## Prefs

Ship to **main**. Vercel token **only** `api-generated`.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Optional live smoke: rapid double-text while status in flight → confirm instant read receipt; two Cursor finishes → one merged notice.
3. Post-test scale items in `memory-and-metrics.md`.

## First moves in a new chat

1. Read this + `preferences.md` + `imessage-bridge.md`.
2. Confirm latest `main` Ready on `api-generated`.
3. Runtime paths: `apps/api/src/app.ts` (early receipt + notify-flush), `packages/chat/src/bot.ts` (burst), `packages/chat/src/notify.ts`, `packages/chat/src/outbound.ts`, `packages/cursor-bridge/src/sanitize.ts`.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent line: `+13054098546` / Operator: `+12368370221`
