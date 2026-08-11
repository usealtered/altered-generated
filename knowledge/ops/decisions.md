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

- **ui-message / iMessage images:** Sendblue send-message has no base64/blob body — only `media_url`. Hosting choice: Sendblue multipart `/api/upload-file` (returns CDN URL) for generated/ephemeral images. No Vercel Blob/S3 stood up (none in env; unnecessary given Upload-file). Package `@altered/ui-message` + chat `send_ui_message` / `outbound.sendMedia`.
- Sendblue webhook must ACK immediately with Chat SDK `waitUntil` + Vercel `waitUntil`; never block the HTTP response on the full LLM turn.
- Inbound read receipt first; typing indicator immediately before each outbound bubble.
- Multi-send via `send_message` / `start_typing` tools; tool turns: short status → tools → typing → final.
- Preserve `\n\n` in outbound text (do not collapse whitespace to a single line); split substantial paragraphs into separate bubbles.
- System prompt: plain text only, no em dashes, serious/brutalist/Hormozi-direct tone.
- Sendblue adapter: private fork `inducingchaos/chat-adapter-sendblue#integration` with `sendReadReceipts: true`.
- `ensureStatus` must be concurrency-safe: AI SDK can run tools in parallel and previously double-sent the status bubble.
- Read receipts must be waitUntil-tracked at the webhook layer so overlapping turns cannot freeze mark-read.
- Inbound concurrency: Chat SDK **`burst`** owns coalescing. Handler awaits main-gen (do not detach / do not invent a second coalesce layer). Fast-ack is webhook-early so the first bubble is not blocked by that lock. Outbound reply SEND: per-thread `send-lock:*`. Completions: Redis debounce + drain lock + forced-tool summary.
- Status claim is per-`message_handle` (`status-ack:${thread}:${handle}` + `ack-claimed:`).
- Operator + notify paths use forced tool calling (`toolChoice: required` + `done` without execute). No raw model/agent dumps to Riley.
- Em-dash/markdown exclusion enforced by `sanitizeImessageText` before every outbound send, not prompt memory alone.
- Riley concerns are implicit change requests; coding agents own Vercel/DB/Redis/OpenRouter audit by default.
- **Deterministic/canned status acks banned** (never auto-send "Checking that now."). First bubble is `generateFastAck` (tiny Haiku call); Redis SET NX dedupes under overlap.
- Notify/completion sends must use the canonical base64url Sendblue thread id for the outbound lock (raw E.164 keys do not match Chat SDK thread ids).
- Sendblue adapter fork does not serialize outbound; Chat SDK locks inbound only.
