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
5. `prompt_cursor` resumes or auto-spawns a Cloud Agent by **workstream** (registry in `cursor_agents`; soft-default in `settings.active_agent_id`). Optional env `CURSOR_OPERATING_AGENT_ID` is bootstrap only.
6. Related tasks share a workstream/agent chat; unrelated work gets a new agent.
7. Open build work is stored in `dev_tasks` so chats can restart without loss.
8. QStash polls run completion and texts back
9. Important facts go to keyed `memories` (Neon) + Redis + `knowledge/` so compaction/agent switches do not erase them
10. Each LLM turn writes `ai_events` (tokens, estimated cost, tools, latency) and bumps daily AI rollups
11. Lead create/update writes `lead_events` for funnel analytics

## Tools

- `get_cursor_status` / `list_cursor_agents`
- `list_dev_tasks` / `upsert_dev_task`
- `search_knowledge`
- `prompt_cursor` / `spawn_cursor_agent` / `set_operating_agent` (soft-default pin)
- `save_lead` / `get_metrics` / `get_checkout_link`
- `save_memory` (key required) / `recall_memories`

See also `knowledge/ops/memory-and-metrics.md`.

## Webhook URL

`https://generated.api.usealtered.com/webhooks/sendblue`
