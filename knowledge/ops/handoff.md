---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (sprint: Zernio live + ops dashboard + cadence + metrics).

## HEAD on main

See latest `main`.

### Sprint proof (2026-08-11)

1. **Zernio live:** https://twitter.com/i/web/status/2087242628513271998 (`zernioConfigured=true`). Note: local `vercel env pull` can redact ZERNIO_* as `[SENSITIVE]` — production has real values; env scrubber ignores that literal.
2. **API domain:** JSON-only root + ops approve now returns JSON (no marketing HTML). `/reserve` is 302 → site.
3. **Landing:** no price in UI or root metadata. CTA = Text Koa only. Sales first-touch proof: no $100/$499.
4. **Metrics:** migration `0005` applied. prospectFunnel vs internalOps never summed.
5. **Ops dashboard:** `generated.usealtered.com/ops?key=OPS_DASHBOARD_SECRET` (falls back to CRON_SECRET/QSTASH_TOKEN on API).
6. **Cadence QStash:** hourly review, daily analytics snapshot, lead-gen sweep — `POST /ops/ensure-cadence-schedules`.

### Metrics integrity (URGENT fix 2026-08-11)

- Bug: `get_metrics` / inbound counts were 100% Riley ops chat (`+12368370221`), not prospects.
- Fix: migration `0005_metrics_integrity` — `threads.kind`, `messages.is_internal`, `leads.is_test`, seed `operators`.
- APIs return `prospectFunnel` + `internalOps` separately (never summed by default).
- Doc: `knowledge/ops/metrics-integrity.md`
- Proof (day 2026-08-11 post-backfill): prospect inbound **0** / unique phones **0**; internalOps inbound **39** from Riley only; real leads today **0** (2 audit leads marked `is_test`).

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
| Site landing | `https://generated.usealtered.com/early-access` — iMessage CTA only (no price/checkout) |
| API `/reserve` | **302 → site early-access** (no HTML on api-generated) |
| `PRIMARY_CHECKOUT_URL` | **EMPTY** — checkout only in iMessage after qualify |
| iMessage sales mode | Qualify first, then introduce $100 deposit |
| Posting | Zernio live on @usealtered_gen — https://twitter.com/i/web/status/2087235934492213389 |

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
# Sendblue device health (gated): GET /ops/sendblue-health?key=OPS_DASHBOARD_SECRET
```

### Sendblue device outage (2026-08-11 ~18:15Z)

- **Symptom:** Riley not getting iMessage replies; Vercel/webhook path healthy.
- **Root cause:** Sendblue Mac `Messages.app` not running. Outbound status `ERROR` / code `5504` ("Application isn’t running. (-600)" / send status timeout).
- **Last DELIVERED:** ~18:04Z. All ops outbound from 18:15–18:27 failed device-side while our API still logged send success (HTTP 200, no outbound status webhook configured).
- **Fix:** Restart Messages.app (and Sendblue agent if needed) on the Sendblue host Mac. Then text +13054098546 to confirm DELIVERED.
- **Detection shipped:** `checkSendblueDeviceHealth` on `/ops/posts/status`, `/ops/dashboard`, `/ops/sendblue-health`.
