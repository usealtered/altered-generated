# altered-generated

Human-in-the-loop Hormozi-style agents + tooling for **ALTERED** (Knowledge Orchestration Infrastructure).

Near-term goal: early-access reservation deposits (**$99–$249** band until offer locked).

## Surfaces

| Surface | Role |
| --- | --- |
| iMessage (`+13054098546`) | Natural-language ops via AI SDK tool calling → Cursor / RAG / leads / memory |
| Cursor Cloud Agents | Dynamic builders by workstream (`cursor_agents` + `dev_tasks` in Neon) |
| `apps/api` | Hono + oRPC + Sendblue/QStash webhooks |
| `apps/web` | Early-access landing |
| `knowledge/` + `memories` table | Durable memory past agent compaction |

## Domains

- API: `https://generated.api.usealtered.com` (`usealtered/api-generated` on Vercel)
- Site: `https://generated.usealtered.com`

## Constraints

Vercel token (if present) is **only** for `usealtered/api-generated`. Never touch other Vercel projects or external integrations without permission. See `AGENTS.md` and `knowledge/ops/preferences.md`.

Cloud Agents are **dynamic** (not a single env chat ID). Related tasks share a workstream/agent chat; open work lives in `dev_tasks`.

## Sendblue webhook

```
https://generated.api.usealtered.com/webhooks/sendblue
```

## Operator UX

Text naturally. No slash commands. The model picks tools:

- prompt Cursor / check status
- search knowledge
- save/recall durable memory
- capture leads / metrics / checkout link

## Local

```bash
pnpm install
pnpm db:migrate
pnpm dev
```
