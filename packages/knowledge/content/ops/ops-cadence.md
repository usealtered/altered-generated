---
title: Ops cadence (QStash)
---

# Ops cadence

Standing schedules (bootstrap: `POST /ops/ensure-cadence-schedules` with bearer):

| Schedule id | Cron (UTC) | Webhook |
|---|---|---|
| `altered-ops-hourly-review` | `0 * * * *` | `/webhooks/qstash/ops/hourly-review` |
| `altered-ops-daily-analytics` | `0 5 * * *` | `/webhooks/qstash/ops/daily-analytics` |
| `altered-ops-lead-gen-sweep` | `0 12,20 * * *` | `/webhooks/qstash/ops/lead-gen-sweep` |

Plus existing posting schedules (`altered-posts-generate`, `altered-posts-publish`).

Tables: `conversation_reviews`, `analytics_snapshots`, `lead_gen_drafts` (migration `0006_ops_cadence`).

Dashboard: site `/ops?key=...` reads gated `GET /ops/dashboard`.
