---
title: Hard operating constraints
---

# Hard operating constraints

## Git

- Ship finished work to **`main`**. Riley does not manage PRs/branches — the agent does.

## Vercel / external integrations

- You may use the Vercel token **only** for allowlisted projects on scope `altered`: `api-generated` (API) and `web-generated` / live `altered-generated-web` (site). See `vercel-projects.md`.
- **Do not** touch any other Vercel project (`workspace`, `api`, experimental*, etc.), team setting, domain, or integration.
- **Do not** run bare `vercel deploy` / `vercel link` without `--project` on the allowlist (auto-creates stray projects named after the cwd).
- **Do not** adjust external integrations (Vercel, Sendblue, Stripe, Neon, Upstash, DNS, etc.) without explicit permission.
- **Do not** touch any other GitHub repo.

## Scope

- Work only inside `usealtered/altered-generated` unless Riley explicitly expands scope.

## Agents

- No single fixed Cloud Agent chat ID. Use dynamic `cursor_agents` + workstreams; track work in `dev_tasks`.
- See `knowledge/ops/preferences.md`.
