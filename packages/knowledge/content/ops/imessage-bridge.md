---
title: iMessage operator bridge
---

# iMessage ↔ Cursor bridge

Natural-language operator surface. No slash commands - AI SDK tool calling with forced tools (`toolChoice: required` + `done`).

## Flow

1. Riley texts `+13054098546` (allowlisted `+12368370221`)
2. Sendblue webhook → `POST /webhooks/sendblue`
3. **Read receipt + fast-ack at webhook** (direct Sendblue HTTP, no Chat SDK lock): mark-read awaited ≤2s; Haiku ack waitUntil'd in parallel with handler. Overlap-B can ack while A still holds the burst lock.
4. Handler returns HTTP 200 immediately via Chat SDK `waitUntil` (Vercel `@vercel/functions`)
5. Chat SDK **burst** concurrency (`debounceMs: 1500`): first-pass coalesce while inbound lock held (latest + `skipped[]`).
6. Handler skips fast-ack if webhook claimed/sent it (`ack-claimed:` / `ack-sent:${messageHandle}`). Claim is set before Haiku so handler never double-generates. Backup ack only if webhook path never claimed.
7. **Inbound lock released after fast-ack** — main Sonnet is **coalesced across handlers** (`scheduleCoalescedMainGen`, quiet window `MAIN_GEN_COALESCE_MS=2000`): follow-ups during the window or mid-Sonnet abort the prior turn and flush ONE gen with the full joined text (`main_gen_coalesce_flush` partCount). Forced tools (`toolChoice: "required"` + `done`). Must not send a second status ack.
8. Outbound path: `send_message` / `start_typing` (multi-send). Typing before reply bubbles (skipped for status). Code sanitizer strips em dashes/markdown.
9. Per-thread outbound send lock (in-process + Redis SET NX) serializes replies vs background completion notices. Lock key is the canonical base64url Sendblue thread id.
10. Cursor completions: QStash poll → Redis debounce (~3s) + drain lock → forced-tool plain-text summary (never raw markdown tables)
11. `prompt_cursor` resumes or auto-spawns a Cloud Agent by **workstream**
12. Important facts go to keyed `memories` (Neon) + Redis + `knowledge/`
13. Each LLM turn writes `ai_events`
14. **Pipeline tracing:** every stage emits `[altered-ops:trace] {json}` with shared `cid` (= Sendblue `message_handle`). Includes `webhookAgeMs` (Sendblue `date_sent` → our receive), read-receipt `apiMs`, fast-ack, locks, main gen, outbound sends. Vercel query: `altered-ops:trace`.

## Concurrency model (actual)

| Layer | Mechanism | Behavior |
|---|---|---|
| Chat SDK inbound | `burst` + `debounceMs: 1500` + Redis state locks | First-pass coalesce; lock held through burst window + fast-ack only |
| Main gen | Cross-handler coalesce (`MAIN_GEN_COALESCE_MS=2000`) + AbortController | Quiet window merges texts; mid-Sonnet follow-up aborts + re-flush with full context |
| Sendblue adapter (`#integration` fork) | `sendReadReceipts: false` (we own mark-read) | Chat SDK locks still serialize inbound handlers |
| Our webhook | Await direct mark-read (≤2s) + `waitUntil` before/around init | Receipt completes in-request; `webhookAgeMs` + `apiMs` traced |
| Handler | `sinceWebhookMs` from Redis `trace:wh:*` | Measures queue/lock delay webhook→handler_start |
| Our outbound | `withThreadSendLock(threadId)` in-process + Redis `send-lock:*` | Serializes `thread.post` and completion `sdk.messages.send` on the same canonical thread id |
| Status / fast-ack | Per-`message_handle` Redis claim + **no send lock** | Each inbound gets its own ack; never waits on main-gen sends |
| Reply sends | Redis/in-process `send-lock:*` | Serializes final replies only (ordering / rate) |
| Cursor completions | Redis list + token debounce + `notify:drain:*` lock + QStash flush | Near-simultaneous finishes merge into one summarized iMessage |

## Tools

- `send_message` / `start_typing` / `done` (forced tool loop)
- `get_cursor_status` / `list_cursor_agents`
- `list_dev_tasks` / `upsert_dev_task`
- `search_knowledge`
- `prompt_cursor` / `spawn_cursor_agent` / `set_operating_agent`
- `save_lead` / `get_metrics` / `get_checkout_link`
- `save_memory` (key required) / `recall_memories`

## Adapter

Private fork: `github:inducingchaos/chat-adapter-sendblue#integration` (read-receipt + typing quirks). No per-thread send serialization in the adapter - Chat SDK + our Redis locks own that.

## Webhook URL

`https://generated.api.usealtered.com/webhooks/sendblue`
