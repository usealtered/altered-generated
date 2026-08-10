# Agent constraints (ALTERED generated)

See also `knowledge/ops/preferences.md`, `knowledge/ops/handoff.md`, `knowledge/ops/constraints.md`.

## Hard rules

1. **Git:** Get finished work onto **`main`**. Riley does not manage PRs/branches — you do. Prefer commit+push to `main`; if you used a branch/PR, merge it yourself when done.
2. **Vercel:** Token only for **`usealtered/api-generated`** (`api-generated` / scope `altered`). Never other projects.
3. **No external integration changes** without explicit permission.
4. **Repo scope:** Only `usealtered/altered-generated` unless Riley expands scope.
5. Ask Riley in chat / iMessage — not via repo-file questionnaires.
6. **Dynamic Cloud Agents:** group related tasks per workstream; persist `dev_tasks` + knowledge so chats can restart with no loss.

## Dynamic Cloud Agents

- `CURSOR_OPERATING_AGENT_ID` is optional bootstrap only — not the forever builder.
- Neon: `cursor_agents`, `dev_tasks`, soft-default `settings.active_agent_id`.
- Related work → same agent chat; unrelated → new agent/workstream.
- Before ending a chat: update `dev_tasks`, `knowledge/ops/handoff.md`, memories/decisions.

## Vercel env pull (api-generated only)

```bash
# never other Vercel projects
npx vercel link --token "$VERCEL_TOKEN" --scope altered --project api-generated --yes
npx vercel env pull .env.local --token "$VERCEL_TOKEN" --environment production --yes
```

Never print secret values in chat, commits, or logs.
