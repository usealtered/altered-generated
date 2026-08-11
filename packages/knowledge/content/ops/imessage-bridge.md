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
5. Chat SDK **burst** concurrency (per-thread lock, ~700ms debounce): overlapping inbound messages coalesce; latest handled with `context.skipped`
6. AI SDK `generateText` with `toolChoice: "required"` + `done` tool (no execute) - no raw assistant dumps
7. Outbound path: `send_message` / `start_typing` (multi-send). Typing before each bubble. Code sanitizer strips em dashes/markdown.
8. Per-thread outbound send lock serializes status bubbles vs background completion notices
9. Cursor completions: QStash poll → Redis debounce (~3s) → forced-tool plain-text summary (never raw markdown tables)
10. `prompt_cursor` resumes or auto-spawns a Cloud Agent by **workstream**
11. Important facts go to keyed `memories` (Neon) + Redis + `knowledge/`
12. Each LLM turn writes `ai_events`

## Concurrency model (actual)

| Layer | Mechanism | Behavior |
|---|---|---|
| Chat SDK inbound | `concurrency: { strategy: "burst", debounceMs: 700 }` + Redis/memory state locks | Per-thread serialize handlers; short burst window; latest message + skipped[] |
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
