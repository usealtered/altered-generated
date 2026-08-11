# Agent constraints (ALTERED generated)

See also `knowledge/ops/preferences.md`, `knowledge/ops/handoff.md`, `knowledge/ops/constraints.md`.

## Hard rules

1. **Git:** Get finished work onto **`main`**. Riley does not manage PRs/branches — you do. Prefer commit+push to `main`; if you used a branch/PR, merge it yourself when done.
2. **Vercel:** Token only for **`usealtered/api-generated`** (`api-generated` / scope `altered`). Never other projects.
3. **No external integration changes** without explicit permission.
4. **Repo scope:** Only `usealtered/altered-generated` unless Riley expands scope.
5. Ask Riley in chat / iMessage — not via repo-file questionnaires.
6. **Dynamic Cloud Agents:** group related tasks per workstream; persist `dev_tasks` + knowledge so chats can restart with no loss.

## Implicit change requests (self-fix)

Riley should not need to say "make this change."

- Any code, infra, bug, latency, formatting, product, or runtime concern he raises is an **implicit instruction** to either (a) fix it in this agent chat, or (b) `prompt_cursor` / spawn a coding agent on the right workstream **and** `upsert_dev_task`.
- Tiny factual questions can be answered directly; if the message implies a fix, ship a tracked task.
- **Drift detection:** if you notice your own behavior violated standing instructions (markdown in iMessage, em dashes, raw agent dumps, missing status-before-tools, blocking Sendblue webhooks, etc.), file a self-correction `dev_task` and/or spawn a fix agent immediately. Do not wait to be told.

## Standing audit responsibility

For any diagnosis, bug, or runtime task, the coding agent owns by default:

1. Vercel logs / deploy status for **`api-generated` only**
2. Relevant Neon tables (`messages`, `ai_events`, `cursor_agents`, `dev_tasks`, `settings`, `cursor_jobs`, etc.)
3. Redis state when relevant (chat history, notify aggregation, settings cache)
4. OpenRouter / `ai_events` usage when latency or cost is in question

Riley and the iMessage copilot should not have to spell this audit checklist out each time. Encode it in task prompts.

## Dynamic Cloud Agents

- `CURSOR_OPERATING_AGENT_ID` is optional bootstrap only — not the forever builder.
- Neon: `cursor_agents`, `dev_tasks`, soft-default `settings.active_agent_id`.
- Related work → same agent chat; unrelated → new agent/workstream.
- Before ending a chat: update `dev_tasks`, `knowledge/ops/handoff.md`, memories/decisions.

## iMessage / Sendblue runtime

- Webhook must ACK immediately via Chat SDK + Vercel `waitUntil`. Never block HTTP 200 on the full LLM turn.
- Read receipts must fire immediately (waitUntil-tracked), independent of overlapping turns / status sends.
- Inbound concurrency: Chat SDK `burst` (per-thread lock + short debounce). Outbound: per-thread send lock. Cursor completion notices: Redis debounce + forced-tool summary (never raw markdown dumps).
- Outbound text passes a code sanitizer (no em dashes, strip markdown) before Sendblue.

## Vercel env pull (api-generated only)

```bash
# never other Vercel projects
npx vercel link --token "$VERCEL_TOKEN" --scope altered --project api-generated --yes
npx vercel env pull .env.local --token "$VERCEL_TOKEN" --environment production --yes
```

Never print secret values in chat, commits, or logs.
