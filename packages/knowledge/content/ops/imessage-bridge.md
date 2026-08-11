---
title: iMessage operator bridge
---

# iMessage ↔ Cursor bridge

Natural-language operator surface. No slash commands - AI SDK tool calling with forced tools (`toolChoice: required` + `done`).

## Flow

1. Riley texts `+13054098546` (allowlisted `+12368370221`)
2. Sendblue webhook → `POST /webhooks/sendblue`
3. **Read receipt immediately** (waitUntil-tracked) before Chat SDK handler lock / status sends
4. Handler returns HTTP 200 immediately via Chat SDK `waitUntil` (Vercel `@vercel/functions`)
5. Chat SDK **queue** concurrency (per-thread serialize; no burst debounce on a lone message). Overlapping inbound drains with `context.skipped`.
6. **Fast LLM ack** (`generateFastAck`): Haiku/`CHAT_ACK_MODEL_ID`, last 1 Redis history turn, no tools, `maxOutputTokens: 40`, 2.2s abort → fallback "On it.". Runs **concurrently** with read receipt; first bubble before subscribe/DB/main agent. Surface `ops_imessage_ack` in `ai_events` (fire-and-forget write).
7. Main AI SDK `generateText` with full tools (`toolChoice: "required"` + `done`) - no raw assistant dumps. Must not send a second status ack.
8. Outbound path: `send_message` / `start_typing` (multi-send). Typing before reply bubbles (skipped for status ack). Code sanitizer strips em dashes/markdown.
9. Per-thread outbound send lock serializes status bubbles vs background completion notices
10. Cursor completions: QStash poll → Redis debounce (~3s) → forced-tool plain-text summary (never raw markdown tables)
11. `prompt_cursor` resumes or auto-spawns a Cloud Agent by **workstream**
12. Important facts go to keyed `memories` (Neon) + Redis + `knowledge/`
13. Each LLM turn writes `ai_events`

## Concurrency model (actual)

| Layer | Mechanism | Behavior |
|---|---|---|
| Chat SDK inbound | `concurrency: { strategy: "queue" }` + Redis/memory state locks | Per-thread serialize handlers; no mandatory 700ms debounce; latest + skipped[] on drain |
| Sendblue adapter | `sendReadReceipts: true` fires mark-read before `processMessage` | Alone was not waitUntil-tracked → could freeze under overlap; webhook layer now tracks receipt |
| Our webhook | Early `fireReadReceipt` + `waitUntil` | Receipt survives overlapping turns / status sends |
| Our outbound | `withThreadSendLock(threadId)` | Serializes `thread.post` so status + completion notices do not interleave |
| Cursor completions | Redis list + QStash delayed flush (`notify-flush`) | Near-simultaneous finishes merge into one summarized iMessage |

## Tools

- `send_message` / `start_typing` / `done` (forced tool loop)
- `get_cursor_status` / `list_cursor_agents`
- `list_dev_tasks` / `upsert_dev_task`
- `search_knowledge`
- `prompt_cursor` / `spawn_cursor_agent` / `set_operating_agent`
- `save_lead` / `get_metrics` / `get_checkout_link`
- `save_memory` (key required) / `recall_memories`

## Adapter

Private fork: `github:inducingchaos/chat-adapter-sendblue#integration` (read-receipt + typing quirks).

## Webhook URL

`https://generated.api.usealtered.com/webhooks/sendblue`
