---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (concurrency locks + fast LLM ack; prod timing verified).

## HEAD on main

See latest `main`. Fast LLM first bubble (`generateFastAck`) plus Redis cross-isolate outbound locks / notify drain.

### Timing (prod probe 2026-08-11, deploy after `63c5930`)

| Era | First bubble |
|---|---|
| Before (full Sonnet tool loop) | `ai_events.ops_imessage` **12s–111s** (Riley ~40s) |
| Hardcoded ack (`135d029`) | status send **~310ms** after 700ms burst debounce (rejected) |
| After fast LLM ack (`63c5930`) | **handlerMs=1725** (genMs=1265, sendMs=455); webhook 200 in 283ms; no burst debounce; `ops_imessage_ack` ok |

## Already shipped (do not redo)

- iMessage waitUntil ACK, Sendblue fork read receipts, typing-before-send, multi-send, `\n\n` preserve.
- **Read receipt:** webhook fires mark-read + waitUntil before Chat SDK lock.
- **Inbound:** Chat SDK `queue` (no mandatory burst debounce) + Redis state locks; overlapping inbound drains with `context.skipped`.
- **Fast LLM ack:** `packages/chat/src/fast-ack.ts` — Haiku/`CHAT_ACK_MODEL_ID`, tiny Redis history, no tools, short max tokens, 2.2s timeout fallback. Parallel with read receipt in `bot.ts`.
- **Outbound:** `withThreadSendLock` is in-process **and** Redis `send-lock:*` on canonical base64url thread id. Notify path uses the same id (not raw E.164).
- **Completions:** Redis list + 3s QStash debounce + `notify:drain:*` lock; forced-tool plain-text summary.
- **Status dedupe:** Redis `status-ack:*` SET NX (~12s) prevents duplicate status bubbles under overlap.
- **Sanitizer:** `sanitizeImessageText` strips em dashes/markdown before every outbound send.
- Standing prefs: AGENTS.md + preferences (self-fix, audit ownership, ship to main).
- Migrations through `0003_observability.sql`.

## Prefs

Ship to **main**. Vercel token **only** `api-generated`.
Hard: never send canned "Checking that now." Deterministic acks banned.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Optional live smoke: rapid double-text + two Cursor finishes → one merged notice; no duplicate status.
3. Main-turn Sonnet latency still often 10s+ — optimize only if Riley prioritizes.
4. Post-test scale items in `memory-and-metrics.md`.
5. Optional open features: QStash wake-ups, coding-agent follow-up questions, PNG status cards.

## First moves in a new chat

1. Read this + `preferences.md` + `imessage-bridge.md`.
2. Confirm latest `main` Ready on `api-generated`.
3. Runtime paths: `apps/api/src/app.ts`, `packages/chat/src/bot.ts` + `fast-ack.ts`, `packages/chat/src/notify.ts`, `packages/chat/src/outbound.ts`, `packages/chat/src/thread-lock.ts`.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent line: `+13054098546` / Operator: `+12368370221`
