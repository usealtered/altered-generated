---
title: Provisioning checklist
---

# Provisioning checklist

## Webhook (configure in Sendblue)

`https://generated.api.usealtered.com/webhooks/sendblue`

## After env vars are on Vercel (`api-generated` only)

1. Deploy API → `generated.api.usealtered.com`
2. Deploy web → `generated.usealtered.com`
3. `pnpm db:migrate` with `DATABASE_URL`
4. Text agent line `+13054098546` from `+12368370221`

## Notes

- Checkout: `PRIMARY_CHECKOUT_URL`
- Deposit amount: knowledge/`offers/early-access-deposit.md` (placeholder $149)
- AI: OpenRouter via `OPENROUTER_API_KEY` + `CHAT_AGENT_MODEL_ID`
