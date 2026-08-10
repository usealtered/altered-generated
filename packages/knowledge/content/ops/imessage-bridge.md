---
title: iMessage operator bridge
---

# iMessage ↔ Cursor bridge

Natural-language operator surface. No slash commands — AI SDK tool calling.

## Flow

1. Riley texts `+13054098546` (allowlisted `+12368370221`)
2. Sendblue webhook → `POST /webhooks/sendblue`
3. Chat SDK routes DM
4. AI SDK `generateText` + tools decide actions
5. `prompt_cursor` resumes `CURSOR_OPERATING_AGENT_ID` (also persisted in `settings.operating_agent_id`)
6. QStash polls run completion and texts back
7. Important facts go to `memories` (Neon) + Redis so compaction/agent switches do not erase them

## Tools

- `get_cursor_status`
- `search_knowledge`
- `prompt_cursor` / `spawn_cursor_agent` / `set_operating_agent`
- `save_lead` / `get_metrics` / `get_checkout_link`
- `save_memory` / `recall_memories`

## Webhook URL

`https://generated.api.usealtered.com/webhooks/sendblue`
