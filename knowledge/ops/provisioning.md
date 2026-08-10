---
title: Provisioning checklist
---

# Provisioning checklist

## Webhook (configure in Sendblue)

`https://generated.api.usealtered.com/webhooks/sendblue`

## After env vars are on Vercel

1. Deploy `apps/api` → `generated.api.usealtered.com`
2. Deploy `apps/web` → `generated.usealtered.com`
3. From this agent (or CI): `pnpm db:migrate` with `DATABASE_URL`
4. Text agent line `+13054098546` from `+12368370221` with a natural sentence (no slash commands)

## Notes

- Checkout: set `EARLY_ACCESS_CHECKOUT_URL` to a Stripe Payment Link when ready
- Deposit cents clamped `$99–$249` until offer locked (default `$149`)
