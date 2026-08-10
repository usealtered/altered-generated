---
title: Provisioning checklist
---

# Provisioning checklist

Ship order for leads today:

1. Neon free Postgres → `DATABASE_URL` → `pnpm db:migrate`
2. Upstash Redis → Chat SDK state + short memory
3. Upstash QStash → Cursor poll/retry jobs
4. Sendblue number + webhook → `https://<api>/webhooks/sendblue`
5. Cursor API key → dashboard API keys
6. Set `CURSOR_OPERATING_AGENT_ID` to the durable agent to resume
7. Deploy `apps/api` + `apps/web` on Vercel
8. Stripe (optional for same-day deposits) + webhook `/webhooks/stripe`
9. Set `OPERATOR_PHONE_ALLOWLIST` to your E.164 phone
10. Text the Sendblue line: `status` then `metrics`

## Minimum for chat bridge only

`SENDBLUE_*`, `CURSOR_API_KEY`, `CURSOR_OPERATING_AGENT_ID`, Redis, `APP_BASE_URL`

## Minimum for deposit revenue

Above + Neon + Stripe + public early-access URL
