---
title: Hard operating constraints
---

# Hard operating constraints

## Git

- Ship finished work to **`main`**. Riley does not manage PRs/branches — the agent does.

## Vercel / external integrations

- You may use the Vercel token **only** for the `usealtered/api-generated` project (and reading its env/deploy status for this repo’s API).
- **Do not** touch any other Vercel project, team setting, domain, or integration.
- **Do not** adjust external integrations (Vercel, Sendblue, Stripe, Neon, Upstash, DNS, etc.) without explicit permission.
- **Do not** touch any other GitHub repo.

## Scope

- Work only inside `usealtered/altered-generated` unless Riley explicitly expands scope.

## Agents

- No single fixed Cloud Agent chat ID. Use dynamic `cursor_agents` + workstreams; track work in `dev_tasks`.
- See `knowledge/ops/preferences.md`.
