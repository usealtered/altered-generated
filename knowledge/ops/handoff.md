---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (pipeline tracing + direct mark-read).

## HEAD on main

See latest `main`. Fast LLM first bubble + Redis concurrency locks + **structured `[altered-ops:trace]` pipeline logs**.

### Read-receipt / "Test" latency finding (2026-08-11)

Riley reported 60s+ before the iMessage read indicator on "Test"/"Testing".

| Stage | Evidence |
|---|---|
| Our webhook receive → HTTP 200 | **10–335ms** |
| Our mark-read API success | logged immediately after webhook (sub-second after receive) |
| Fast ack first bubble | **handlerMs ≈ 1.7s** (gen≈1.2s, send≈0.5s) |
| Full Sonnet turn | separate; **~23s** on "Testing" — not the read indicator |

**Root cause of the 60s read indicator:** not our LLM/queue after webhook arrival. Delay is **upstream of our webhook** (Sendblue delivering the inbound webhook late) and/or **downstream of mark-read** (Sendblue/Apple delivering the read receipt to Riley's phone). We did not previously log Sendblue `date_sent`, so webhookAgeMs was invisible — now logged.

### Timing (fast-ack prod probe)

| Era | First bubble |
|---|---|
| Before (full Sonnet tool loop) | `ops_imessage` **12s–111s** |
| Hardcoded ack | ~310ms send + 700ms burst (rejected) |
| Fast LLM ack | **handlerMs=1725** (genMs=1265, sendMs=455) |

### Debug recipe (2 minutes)

```bash
npx vercel logs --project api-generated --scope altered --environment production --since 30m --query 'altered-ops:trace' --json
# Filter one message: query message_handle / cid
```

Stages: `webhook_received` (has `webhookAgeMs`) → `read_receipt_start/done` (`apiMs`) → `webhook_http_ok` → `handler_start` → `fast_ack_*` → `status_send_*` → `main_gen_*` → `turn_complete`.

## Already shipped (do not redo)

- waitUntil webhook, typing, multi-send, sanitizer, forced-tool notify.
- Fast LLM ack (`generateFastAck` / `ops_imessage_ack`).
- Direct early mark-read (no Chat SDK init); adapter `sendReadReceipts: false`.
- Pipeline trace logger (`packages/chat/src/trace.ts`).
- Redis send-lock + status-ack dedupe + notify drain.
- Ship to main; Vercel token only `api-generated`.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Optional live smoke: rapid double-text + two Cursor finishes → one merged notice.
3. Main-turn Sonnet latency (separate from first bubble / read receipt).
4. Optional features: QStash wake-ups, coding-agent follow-ups, PNG status cards.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Sendblue webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
- Agent: `+13054098546` / Operator: `+12368370221`
