---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (Vercel allowlist self-fix + locked hero + HITL posting).

## HEAD on main

See latest `main`.

### Vercel allowlist (URGENT 2026-08-11)

- **Only:** `api-generated` + `web-generated` / live `altered-generated-web`
- **Never:** `workspace`, `api`, or bare `vercel deploy` from repo root
- Docs: `knowledge/ops/vercel-projects.md`
- Scripts: `pnpm vercel:deploy:api` / `pnpm vercel:deploy:web`
- **Riley delete:** `altered/workspace` (Git already disconnected) + `altered/api` (no Git link, 1 Error deploy)

### Offer LOCKED

- **$100** reservation deposit → credits toward **$499** (net **$399**)
- Never say pre-sale/presale in copy
- Discrepancies: `knowledge/ops/marketing-discrepancies.md`
- **Hero headline (exact, do not paraphrase):** Ninety days from now, the feature you've been circling finally ships - because you stopped re-running the same procrastination loop you already solved.
- Subhead: Koa is the always-on iMessage agent that holds context so detail-obsessed founders stop drifting and actually ship.
- Doc: `knowledge/offers/early-access-deposit.md`

### Live surfaces

| Surface | Status |
|---|---|
| API money page | `https://generated.api.usealtered.com/reserve` |
| Site | `https://generated.usealtered.com/early-access` (root redirects here) |
| `PRIMARY_CHECKOUT_URL` | **EMPTY** — needs Stripe Payment Link for $100 |
| iMessage sales mode | Non-allowlisted → `handleSalesMessage` |
| Ops mode | Allowlisted (Riley) unchanged |
| Posting pipeline | Generate + HITL shipped; **Zernio publish blocked on keys** |

### Posting pipeline (new)

- Docs: `knowledge/ops/posting-pipeline.md`
- Neon: `post_batches`, `post_ideas`, `post_events` (migration `0004_posting`)
- Approve via iMessage `APPROVE ALL` or `/ops/posts/approve` magic link
- Cron: QStash `0 14 * * 1,3,5` generate + `*/15 * * * *` publish (Vercel Cron skipped - Hobby sub-daily limit)
- **Smoke (2026-08-11):** generate tick created batch `b1c5ecd9…` (5 ideas), iMessage notify fired, schedules `altered-posts-generate` / `altered-posts-publish` live. Publish waits on Zernio keys.
- **Blocked:** set on api-generated: `ZERNIO_API_KEY`, `ZERNIO_TWITTER_ACCOUNT_ID`, optional `ZERNIO_PROFILE_ID` / `ZERNIO_LINKEDIN_ACCOUNT_ID`

### Inbound concurrency (keep it simple)

1. **Webhook-early** mark-read + Haiku fast-ack (`waitUntil`, direct Sendblue).
2. **Chat SDK `burst`** (`debounceMs: 1000`) coalesces rapid texts.
3. Handler **awaits** main-gen (does not detach).
4. Reply SEND uses per-thread `send-lock:*`.

### Do not reintroduce

- Custom main-gen coalesce buffers (`mgc:*`)
- Detaching Sonnet via `waitUntil` to free the lock for the next inbound

### Blocked for first $100 sale

1. Stripe Payment Link ($100) → set `PRIMARY_CHECKOUT_URL` on api-generated
2. Optional: deploy `apps/web` to `generated.usealtered.com`
3. Zernio keys for auto-publish (HITL queue still usable)

### Koa landing copy (sales-funnel-build)

- LOCKED: 90-day hero headline shipped to `/early-access` + API `/reserve` (exact text, no paraphrase). Candidates archive: `knowledge/sales/koa-90-day-win-candidates.md`

### Truncation self-fix (b2e3499)

Riley first bubble clipped as `Who's the target...`. Cause: `truncateForImessage(..., 80)` on fast-ack/status (not coalesce race). Fix: `enforceShortStatusBubble` → `On it.` (never ellipsis). Live proof: status path sent `On it.`; reply path sent 3 intact question bubbles to Riley.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Agent: `+13054098546` / Operator: `+12368370221`

## Debug

```bash
npx vercel logs --project api-generated --scope altered --environment production --since 30m --query 'altered-ops:trace' --json
curl -s https://generated.api.usealtered.com/ops/posts/status
```
