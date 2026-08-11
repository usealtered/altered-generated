---
title: iMessage operator bridge
---

# iMessage ↔ Cursor bridge

Natural-language operator surface. No slash commands - AI SDK tool calling with forced tools (`toolChoice: required` + `done`).

## Flow

1. Riley texts `+13054098546` (allowlisted `+12368370221`)
2. Sendblue webhook → `POST /webhooks/sendblue`
3. **Webhook-early** mark-read + Haiku fast-ack (direct Sendblue, outside Chat SDK lock)
4. Chat SDK **`burst`** (`debounceMs: 1000`) coalesces rapid texts into one handler (`skipped[]`)
5. Handler skips fast-ack if webhook already claimed it; **awaits** main Sonnet turn (lock held so burst works)
6. Outbound: `send_message` / `start_typing`; sanitizer strips em dashes/markdown
7. Per-thread `send-lock:*` for reply ordering / rate limits (not for status acks)
8. Cursor completions: QStash → Redis debounce + drain lock → forced-tool plain-text summary
9. `prompt_cursor` resumes or spawns a Cloud Agent by workstream
10. Keyed `memories` + `ai_events`; traces via `[altered-ops:trace]`

## Concurrency model

| Layer | Mechanism | Behavior |
|---|---|---|
| Fast-ack / read | Webhook-early direct Sendblue | First bubble not blocked by inbound lock |
| Chat SDK inbound | `burst` + `debounceMs: 1000` | Coalesces rapid texts; lock held through main-gen |
| Status claim | Per-`message_handle` Redis | Overlap acks do not block each other |
| Reply SEND | `send-lock:*` | Ordering / rate only |
| Cursor completions | Redis debounce + drain lock | Merge near-simultaneous finishes |

## Tools

- `send_message` / `send_ui_message` / `start_typing` / `done` (forced tool loop)
- `get_cursor_status` / `list_cursor_agents`
- `list_dev_tasks` / `upsert_dev_task`
- `search_knowledge`
- `prompt_cursor` / `spawn_cursor_agent` / `set_operating_agent`
- `save_lead` / `get_metrics` / `get_checkout_link`
- `save_memory` (key required) / `recall_memories`

## Rich media (ui-message)

- Package: `@altered/ui-message`
- Sendblue needs a public `media_url` (no raw base64 on send-message).
- Ephemeral images: multipart `POST /api/upload-file` → CDN `media_url` → `send-message` with `media_url`. No Vercel Blob/S3 required.
- Outbound: `outbound.sendMedia` → adapter `sendMediaMessage` (or `sendImessageMediaDirect`).
- Operator tool: `send_ui_message` (`mediaUrl` or `proof=true`).

## Adapter

Private fork: `github:inducingchaos/chat-adapter-sendblue#integration` (read-receipt + typing quirks). No per-thread send serialization in the adapter - Chat SDK + our Redis locks own that.

## Webhook URL

`https://generated.api.usealtered.com/webhooks/sendblue`
