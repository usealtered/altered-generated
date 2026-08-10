---
title: Decisions log
---

# Decisions

## 2026-08-10

- iMessage is the operator bus; Cloud Agents are dynamic builders (not one fixed env chat ID).
- Related tasks share one agent chat via workstream; unrelated workstreams get new agents.
- Development tasks live in Neon `dev_tasks`; agents in `cursor_agents`.
- No slash commands — AI SDK tool calling.
- Deposit amount band $99–$249 pending offer lock; amount from knowledge (not env); checkout via `PRIMARY_CHECKOUT_URL`.
- Chat model via OpenRouter (`OPENROUTER_API_KEY` + `CHAT_AGENT_MODEL_ID`).
- Hard rule: Vercel token only for `usealtered/api-generated`; never touch other projects/integrations without permission.
- Durable memory in Neon `memories` + Redis + `knowledge/`, independent of Cursor compaction.
- Git preference: branch → PR → merge when Riley says complete/merged (see `preferences.md`).
- Domains: `generated.api.usealtered.com` (API), `generated.usealtered.com` (site).
- Agent line: `+13054098546`. Operator: `+12368370221`.
- `VERCEL_TOKEN` available to new Cloud Agent chats for env pull of `api-generated` only.
