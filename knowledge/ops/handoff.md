---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (ui-message media path + main-gen cross-handler coalesce).

## HEAD on main

See latest `main`. Fast-ack is webhook-early. Main-gen uses `scheduleCoalescedMainGen` (2s quiet window) so rapid follow-ups merge into one Sonnet turn after the Chat SDK lock is released.

Also shipped: `@altered/ui-message` renderer — generate/upload PNG via Sendblue `/api/upload-file` → send with `media_url`. Chat `send_ui_message` + `outbound.sendMedia`. No Vercel Blob (not in env; not needed).

### Live proof (Riley +12368370221)

| Field | Value |
|---|---|
| message_handle | `d96c1c74-4aee-439d-a729-7b216fc6c7ad` |
| hosting | `sendblue_upload` |
| from | `+13054098546` |
| ms | ~744 |
| caption | ui-message proof: image attachment via Sendblue media_url |

Re-run: `pnpm --filter @altered/ui-message send-proof` (needs `.env.local`).

### 4-message burst 03:20Z (before — bug)

Riley: "Maybe it was fixed…" → "Well this block" → "Is the concurrency issue" → "I can tell…". Neon/`ai_events`:

| inbound ack | main Sonnet done | genMs | tools |
|---|---|---:|---|
| 03:20:10 | 03:20:24 | 12839 | get_cursor_status + sends |
| 03:20:54 | 03:21:05 | 10400 | get_cursor_status + sends |
| 03:21:26 | 03:21:38 | 11243 | get_cursor_status + sends |
| 03:21:47 | 03:22:04 | 15528 | sends + upsert_dev_task |

Four full sequential turns. Root cause: **not** send-side `send-lock`. Chat SDK inbound lock / missing cross-handler coalesce. At the time: `queue` (or later `burst`+detach) released after fast-ack so each text got its own Sonnet. Separate from Redis drain used for Cursor completion notices.

**Fix path:** `concurrency.burst debounceMs=1500` + Redis-backed `scheduleCoalescedMainGen` (`MAIN_GEN_COALESCE_MS=2000`, keys `mgc:parts|epoch|gen|inflight:*`). Expect one `main_gen_coalesce_flush` with `partCount≥N` for an N-message quiet-window burst. Mid-Sonnet follow-ups abort via Redis gen poll and re-merge inflight texts.

## Prior: webhook-early fast-ack (OV3)

Fast-ack runs at webhook receipt (`waitUntil` + direct Sendblue), **before** `chat.initialize` / Chat SDK burst lock.

## Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Main-turn Sonnet latency (now non-blocking for next inbound ack; coalesce reduces duplicate turns).
3. Optional: richer ui-message types (charts/PDF cards) beyond image + caption.
4. Confirm Riley visually received proof bubble (message_handle above).

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Agent: `+13054098546` / Operator: `+12368370221`
