---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (sales-funnel $100 + Chat SDK burst simplification).

## HEAD on main

See latest `main`.

### Offer LOCKED

- **$100** reservation deposit → credits toward **$499** (net **$399**)
- Never say pre-sale/presale in copy
- Discrepancies: `knowledge/ops/marketing-discrepancies.md`

### Live surfaces

| Surface | Status |
|---|---|
| API money page | `https://generated.api.usealtered.com/reserve` |
| Site `generated.usealtered.com` | **DEPLOYMENT_NOT_FOUND** — needs web deploy |
| `PRIMARY_CHECKOUT_URL` | **EMPTY** — needs Stripe Payment Link for $100 |
| iMessage sales mode | Non-allowlisted → `handleSalesMessage` |
| Ops mode | Allowlisted (Riley) unchanged |

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

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Agent: `+13054098546` / Operator: `+12368370221`

## Debug

```bash
npx vercel logs --project api-generated --scope altered --environment production --since 30m --query 'altered-ops:trace' --json
```
