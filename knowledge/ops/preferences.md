---
title: Riley operating preferences
---

# Riley operating preferences

Standing prefs for Cloud Agents and the iMessage operator. Keep this file current when Riley changes process.

## Git / shipping

Riley does **not** want to manage PRs or branches himself.

1. **Default:** commit and **push directly to `main`**. Agent owns getting work onto main.
2. Do **not** ask Riley to open, review, or merge PRs.
3. Feature branches / draft PRs are optional internals only — if used, the **agent merges to `main`** when the work is done (or when he says complete / done / merged). Never leave finished work unmerged for him to handle.
4. Never commit secrets (`.env`, tokens, private keys).

## Cloud Agent chats

- **Dynamic agent IDs** — do not depend on a single `CURSOR_OPERATING_AGENT_ID`.
- Group **related** tasks into **one** Cloud Agent chat (same workstream).
- Start a **new** chat/agent for unrelated workstreams.
- Persist open development work in Neon `dev_tasks` (and agents in `cursor_agents`) so a chat can be abandoned/restarted with no loss.
- Soft-default agent (`settings.active_agent_id`) is last-used, not permanent.

## Continuity / no-loss restarts

Before ending a long chat, ensure:

1. Open loops are rows in `dev_tasks` (status `open` / `in_progress` / `blocked`).
2. Decisions and prefs are in `knowledge/` (and optionally `memories`).
3. Code that should ship is on **`main`**.
4. Write/update `knowledge/ops/handoff.md` for the next chat.

## Vercel

- `VERCEL_TOKEN` (when present) is **only** for project `api-generated` on team scope `altered` (aka `usealtered/api-generated`).
- Allowed: `vercel env pull`, deploy status for that project.
- Forbidden without explicit permission: other projects, domains, team settings, integration changes.

## Communication

- Ask Riley in chat / iMessage for decisions — not via inventing repo files as questions.
- Keep iMessage replies short; put durable detail in knowledge/DB.

## Offer / product

- Deposit band **$99–$249**; placeholder **$149** in knowledge until locked.
- Checkout: `PRIMARY_CHECKOUT_URL` (static link; no Stripe SDK yet).
- AI: OpenRouter via `OPENROUTER_API_KEY` + `CHAT_AGENT_MODEL_ID`.

## Phones / domains

- Agent line: `+13054098546`
- Operator: `+12368370221`
- API: `https://generated.api.usealtered.com`
- Site: `https://generated.usealtered.com`
- Webhook: `https://generated.api.usealtered.com/webhooks/sendblue`
