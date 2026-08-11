---
title: Decisions log
---

# Decisions

## 2026-08-10

- iMessage is the operator bus; Cloud Agents are dynamic builders (not one fixed env chat ID).
- Related tasks share one agent chat via workstream; unrelated workstreams get new agents.
- Development tasks live in Neon `dev_tasks`; agents in `cursor_agents`.
- No slash commands - AI SDK tool calling (OpenRouter).
- Deposit amount band $99-$249 pending offer lock; amount from knowledge; checkout via `PRIMARY_CHECKOUT_URL`.
- Hard rule: Vercel token only for `usealtered/api-generated`; never touch other projects/integrations without permission.
- Durable memory in Neon `memories` + Redis + `knowledge/`.
- **Git:** agent ships to **`main`**; Riley does not manage PRs/branches (see `preferences.md`).
- Domains: `generated.api.usealtered.com` (API), `generated.usealtered.com` (site).
- Agent line: `+13054098546`. Operator: `+12368370221`.
- Memory model: **keyed facts** in Postgres (not pgvector). Preamble stays tiny; tools retrieve narrative/knowledge.
- Measure before vectors: log all AI usage/cost in `ai_events`; funnel movements in `lead_events`.
- Post-test scale plan lives in `knowledge/ops/memory-and-metrics.md`.

## 2026-08-11

- Sendblue webhook must ACK immediately with Chat SDK `waitUntil` + Vercel `waitUntil`; never block the HTTP response on the full LLM turn.
- Inbound read receipt first; typing indicator immediately before each outbound bubble.
- Multi-send via `send_message` / `start_typing` tools; tool turns: short status → tools → typing → final.
- Preserve `\n\n` in outbound text (do not collapse whitespace to a single line); split substantial paragraphs into separate bubbles.
- System prompt: plain text only, no em dashes, serious/brutalist/Hormozi-direct tone.
- Sendblue adapter: private fork `inducingchaos/chat-adapter-sendblue#integration` with `sendReadReceipts: true`.
- `ensureStatus` must be concurrency-safe: AI SDK can run tools in parallel and previously double-sent the status bubble.
