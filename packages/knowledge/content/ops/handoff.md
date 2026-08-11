---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (webhook-early fast-ack shipped + OV3 proof).

## HEAD on main

`b046a09` — Fast-ack runs at webhook receipt (`waitUntil` + direct Sendblue), **before** `chat.initialize` / Chat SDK burst lock. Handler only backup-acks if `ack-claimed:` is absent. Final reply SEND stays on `send-lock:*`.

### OV2-B 1786419164 (before — bug)

| Event | ts (UTC) |
|---|---|
| B webhook_received | 03:32:46.385 |
| Chat SDK `message-queued` B (behind A lock) | ~03:32:46.4 |
| A main_gen_detached (lock release) | 03:32:47.961 |
| B handler_start | 03:32:48.220 (**sinceWebhookMs=1835**) |
| B ack_send_done (handler path) | 03:32:49.777 |
| A main_gen_start | 03:32:48.654 |

B waited on A's **handler lock during A's fast-ack**, not A's main-gen. Mark-read was already webhook-early; fast-ack was still inside the handler.

### OV3 1786419757 (after — fixed)

| Event | ts (UTC) |
|---|---|
| A webhook_received | 03:42:37.469 |
| A fast_ack_start `webhook_early` | 03:42:37.761 |
| B webhook_received | 03:42:39.384 (**during A's ack send**) |
| A ack_send_done `webhook_early` | 03:42:39.630 |
| B fast_ack_start `webhook_early` | 03:42:39.650 (elapsedMs=266) |
| B ack_send_done `webhook_early` | 03:42:40.799 (elapsedMs=**1415**, skipped=false) |

B never entered the Chat SDK handler for ack. Ack path is fully decoupled from inbound lock / main-gen.

### Rapid 4-message bug (Riley screenshots)

With `queue` + main-gen detached, inbound lock released after fast-ack (~2s). Four quick texts each got their own handler + Sonnet turn (answered in order over and over; tools kept running; reads looked stuck). Fix: `concurrency.strategy: "burst"` + `debounceMs: 400`; `beginMainGen` aborts prior turn.

### Overlap 1786418774 root cause

`overlap-a` + `overlap-b` at 03:26:14Z:

| cid | status_send_done | First visible bubble |
|---|---|---|
| overlap-a | **skipped:true parts:0** (67ms) | main reply ~03:26:19 |
| overlap-b | **skipped:true parts:0** (67ms) | main reply ~03:26:42 |

Per-thread Redis `status-ack:${thread}` SET NX (12s) ate both fast-acks. B looked “blocked on A main-gen” because its only visible send was the detached Sonnet reply. Fix: claim key is `status-ack:${thread}:${messageHandle}`; status posts bypass send lock (`ack_send_*` stages).

Verify ov2-*-1786419164: A+B `skipped:false`; B `ack_send_done` 03:32:49Z while A `main_gen` still running; A `main_send` before B `main_send`.

## Root cause: 60s read-receipt / first-ack (hard numbers)

Riley confirmed webhook hits us immediately. Logs agree for real messages:

| Message | webhookAgeMs | early receipt apiMs | handlerMs→first ack | main gen |
|---|---:|---:|---:|---:|
| Latency probe 02:30:02 | (pre-trace) | ~receipt after 283ms http | **1725** | 8.4s total |
| Testing 02:32:28 | (pre-trace) | ~after 335ms http | **1741** | 23.5s total |
| Trace probe | 65833* | **266** | **1768** | 10.8s |
| "I don't believe…" 03:19:04 | **3244** | **197** | **1819** | **20768** genMs |
| "No this time…" 03:19:45 | **1669** | **107** | **1790** | (detached after fix) |

\*Trace probe `webhookAgeMs` was our synthetic `date_sent` 65s in the past — not a real Sendblue delay.

**What ate 60s on OUR side:** Chat SDK `queue` holds a Redis inbound lock for the **entire** `onMessage`, including Sonnet tool loop (often 20–60s+, `ai_events` up to 111s). The next text’s handler (fast-ack + backup receipt) could not start until that lock released. Solo messages looked fine (~2s); overlap / back-to-back texts looked like 60s “Sendblue” lag.

**Fix shipped:** after fast-ack send, `runInBackground(mainGen)` via Vercel `waitUntil` and **return** so the inbound lock releases. Mark-read is awaited (≤2s) before HTTP 200.

## Debug recipe

```bash
npx vercel logs --project api-generated --scope altered --environment production --since 30m --query 'altered-ops:trace' --json
```

Key fields: `webhookAgeMs`, `apiMs` (receipt), `sinceWebhookMs` (handler_start — queue/lock delay), `handlerMs`, `main_gen_detached`.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Main-turn Sonnet latency (now non-blocking for next inbound ack).
3. Optional features: QStash wake-ups, follow-up questions, PNG cards.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Agent: `+13054098546` / Operator: `+12368370221`
