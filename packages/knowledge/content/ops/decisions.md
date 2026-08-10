---
title: Decisions log
---

# Decisions

## 2026-08-10

- iMessage is the operator bus; this Cursor agent is the durable builder thread.
- No slash commands — AI SDK tool calling.
- Deposit amount band $99–$249 pending offer lock; amount from knowledge (not env); checkout via `PRIMARY_CHECKOUT_URL`.
- Chat model via OpenRouter (`OPENROUTER_API_KEY` + `CHAT_AGENT_MODEL_ID`).
- Hard rule: Vercel token only for `usealtered/api-generated`; never touch other projects/integrations without permission.
- Durable memory in Neon `memories` + Redis, independent of Cursor compaction.
- Domains: `generated.api.usealtered.com` (API), `generated.usealtered.com` (site).
- Agent line: `+13054098546`. Operator: `+12368370221`.
