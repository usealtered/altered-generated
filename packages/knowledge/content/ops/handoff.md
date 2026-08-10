---
title: Handoff for next Cloud Agent chat
---

# Handoff — restart without loss

Last updated: 2026-08-10 (prior long chat winding down).

## Already on `main`

- Turborepo: `apps/api` (Hono/oRPC + Sendblue/QStash), `apps/web` (early-access), packages.
- iMessage ops: Chat SDK + Sendblue; AI SDK tools via OpenRouter (no slash commands).
- Dynamic agents: `cursor_agents` + `dev_tasks` (migration `0002_agents_tasks.sql`).
- Durable memory: `memories` + Redis + `knowledge/`.
- Checkout: `PRIMARY_CHECKOUT_URL`; deposit from knowledge ($99–$249 band, placeholder $149).
- `vercel.json` builds/functions conflict fixed earlier.

## Prefs (read first)

`knowledge/ops/preferences.md` + `AGENTS.md`:

- Push/merge to **main**; Riley doesn’t manage PRs/branches.
- Vercel token **only** for `api-generated`.
- Ask in chat/iMessage, not via repo questionnaires.
- Dynamic workstreams, not one forever agent env id.

## Still open (persist as `dev_tasks` when DB is up)

1. Confirm `VERCEL_TOKEN` in new chat shell → pull envs for **api-generated only**.
2. `pnpm db:migrate` (0000–0002) on real `DATABASE_URL`.
3. Deploy API/web to domains; Sendblue webhook → `https://generated.api.usealtered.com/webhooks/sendblue`.
4. Smoke-test iMessage from `+12368370221`.
5. Lock deposit amount; set `PRIMARY_CHECKOUT_URL` when Stripe link ready.

## First moves in a new chat

1. Read this file + preferences.
2. Check secrets in shell (don’t print values).
3. Migrate DB; upsert open items into `dev_tasks`.
4. Continue shipping to `main`.
