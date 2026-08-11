---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (fast LLM ack for first iMessage bubble).

## HEAD on main

See latest `main`. First visible bubble is a **lightweight LLM ack** (`generateFastAck` / `ops_imessage_ack`), not a hardcoded string. Target: sub-3s webhook → first bubble.

## Already shipped (do not redo)

- iMessage waitUntil ACK, Sendblue fork read receipts, typing-before-send, multi-send, `\n\n` preserve.
- **Read receipt race fixed:** webhook fires mark-read + waitUntil before Chat SDK lock.
- **Concurrency:** Chat SDK `queue` (no burst debounce); `withThreadSendLock` for outbound; Redis debounce (~3s) + `/webhooks/qstash/notify-flush` merges near-simultaneous Cursor completions.
- **Fast LLM ack:** `packages/chat/src/fast-ack.ts` — Haiku/`CHAT_ACK_MODEL_ID`, tiny Redis history, no tools, short max tokens, 2.2s timeout fallback. Parallel with read receipt in `bot.ts`.
- **No raw dumps:** operator + notify use `toolChoice: "required"` + `done` (no execute).
- **Sanitizer:** `sanitizeImessageText` strips em dashes/markdown before every outbound send.
- Standing prefs: AGENTS.md + preferences (self-fix, audit ownership, ship to main).
- Migrations through `0003_observability.sql`.

## Prefs

Ship to **main**. Vercel token **only** `api-generated`.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Confirm post-deploy first-bubble `handlerMs` stays under 3s in production logs (`[altered-ops] fast ack sent`).
3. Main-turn Sonnet latency (separate from first bubble) still often 10s+ — optimize only if Riley prioritizes.
4. Post-test scale items in `memory-and-metrics.md`.

## First moves in a new chat

1. Read this + `preferences.md` + `imessage-bridge.md`.
2. Confirm latest `main` Ready on `api-generated`.
3. Runtime paths: `apps/api/src/app.ts` (early receipt), `packages/chat/src/bot.ts` + `fast-ack.ts`, `packages/chat/src/operator.ts`, `packages/chat/src/notify.ts`.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent line: `+13054098546` / Operator: `+12368370221`
