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

## 2026-08-11 (funnel + domain split)

- Landing HTML **only** on `altered-generated-web` (`generated.usealtered.com/early-access`). API `/reserve` + `/early-access` are 302 redirects (preserve UTMs).
- Landing CTA is **Text Koa** (`sms:+13054098546`) only — no price, Stripe, or payment form on the page.
- Sales mode introduces $100 → $499 credit **only after qualify**.
- Zernio: `ZERNIO_API_KEY` + `ZERNIO_TWITTER_ACCOUNT_ID=6a7b5b5c…` (usealtered_gen) + `ZERNIO_PROFILE_ID=6a7b5826…`.
- Metrics: `inboundMessagesToday` vs `uniquePhonesMessagedToday` vs `funnelStages` (do not treat raw inbound as unique leads).

## 2026-08-11 (Vercel allowlist violation / self-fix)

- **Violation:** Agent CLI `vercel deploy` without `--project` auto-created `altered/workspace` (from `/workspace` cwd) and linked it to GitHub `main`, causing fan-out Error deploys on every push. Separate `altered/api` created earlier the same day from `apps/api` cwd.
- **Mitigation:** Git disconnected from `workspace`; local root `.vercel` removed; allowlist scripts + docs. Riley to delete `workspace` + `api` in dashboard.
- Details: `knowledge/ops/vercel-projects.md`.

## 2026-08-11 (HITL posting / Zernio)

- **Zernio** is the social posting API (`docs.zernio.com`, env `ZERNIO_API_KEY`). Not Buffer/Typefully.
- Pipeline: QStash/Vercel Cron generate → iMessage one-tap HITL (`APPROVE ALL` / magic link) → Zernio publish → `post_events` log.
- Posts CTA to `+13054098546` + UTM'd `/reserve` into existing sales → $100 deposit.
- Publish blocked until Riley adds Zernio keys on api-generated; generate+HITL work without them.
- See `ops/posting-pipeline.md` + discrepancy D5.

## 2026-08-11 (truncation self-fix)

- **Bug:** First visible bubble clipped mid-sentence as `Who's the target...`. Root cause: fast-ack / status path used `truncateForImessage(..., 80)` which ellipsis-clips. Repro: rogue Haiku ack asking "Three quick ones..." (also `maxOutputTokens: 40` finish) → 89 chars → hard clip. Not coalesce race.
- **Fix:** `enforceShortStatusBubble` rejects questions/overlong status into `On it.` (never `...`). Reply path keeps `splitImessageParts` (no ellipsis). Cap-hit warnings logged. Ack `maxOutputTokens` 32 + finishReason=length → fallback.

## 2026-08-11 (sales funnel)

- **Offer LOCKED:** $100 program reservation deposit; credits toward $499 (net $399). Never call it pre-sale in copy. See `offers/early-access-deposit.md` + `ops/marketing-discrepancies.md` (overrides altered S4 no-pre-sell + $221 price).
- Dual-mode iMessage: allowlisted phones → ops copilot; everyone else → sales funnel (`packages/chat/src/sales.ts`).
- Interim money page: `GET /reserve` on api-generated until `generated.usealtered.com` web deploy exists.
- Outbound templates in `sales/outbound-templates.md` (manual; social APIs blocked on keys).
- **Koa 90-day win candidates** (read-only from `usealtered/altered` OFFER.md + S2/S25/S35/S41): see `sales/koa-90-day-win-candidates.md`. Pending Riley pick for landing hero.

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
