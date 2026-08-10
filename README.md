# altered-generated

Autonomous, human-in-the-loop Hormozi-style agents and tooling for **ALTERED** — Knowledge Orchestration Infrastructure.

Near-term goal: **$250+/day** via early-access reservation deposits.

## What’s in here

| Surface | Path | Role |
| --- | --- | --- |
| iMessage ops bridge | `packages/chat` + `apps/api` `/webhooks/sendblue` | You text → RAG / leads / Cursor follow-up |
| Cursor bridge | `packages/cursor-bridge` | Cloud Agents API create/resume/poll |
| Knowledge RAG | `knowledge/` + `packages/rag` | Repo-stored operator memory |
| API | `apps/api` | Hono + oRPC + webhooks |
| Web | `apps/web` | Early-access deposit landing |
| DB | `packages/db` | Neon + Drizzle |

## Operator UX (iMessage)

Text the Sendblue number:

- `help` — command menu
- `status` — operating Cursor agent
- `ask …` — RAG over `knowledge/`
- plain text / `cursor …` — **resume this Cursor chat’s durable agent**
- `new …` — spawn another agent on this repo
- `lead …` — capture a lead
- `metrics` — progress vs $250/day

This Cursor Cloud Agent run is the intended operating surface. Set `CURSOR_OPERATING_AGENT_ID` to its `bc-…` id (or `link bc-…` from iMessage).

## Monorepo

```bash
pnpm install
pnpm dev
```

- API: `http://localhost:8787`
- Web: `http://localhost:3000/early-access`

```bash
pnpm db:migrate
pnpm knowledge:index
```

## Deploy (you provision)

1. Copy `.env.example` → Vercel envs for `apps/api` and `apps/web`
2. Neon → run `pnpm db:migrate`
3. Upstash Redis (`REDIS_URL`) + QStash
4. Sendblue webhook → `https://<api>/webhooks/sendblue`
5. Cursor API key + `CURSOR_OPERATING_AGENT_ID`
6. Stripe webhook → `https://<api>/webhooks/stripe`
7. Set `NEXT_PUBLIC_API_BASE_URL` on web
8. Text yourself: `status`, then open `/early-access`

Details live in `knowledge/ops/provisioning.md`.

## Knowledge

Canonical notes: `knowledge/**`. A deployable copy ships in `packages/knowledge/content`. Keep them in sync when you edit ops memory.
