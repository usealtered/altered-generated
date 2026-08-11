---
title: Metrics integrity — prospect vs internal ops
---

# Metrics integrity

**Decision (2026-08-11):** Funnel metrics must never mix Riley's operator copilot chat with real prospect traffic.

## Separation model

| Layer | Prospect | Internal / ops |
|---|---|---|
| `threads.kind` | `prospect` | `operator` |
| `messages.is_internal` | `false` | `true` |
| `leads.is_test` | `false` | `true` for audit/dev rows |
| `ai_events.surface` | `sales_*` | `ops_*`, `posting_*` |

## Known operator phones

- `+12368370221` (Riley) — seeded in `operators` + hardcoded in `KNOWN_OPERATOR_PHONES`
- Allowlist also via `OPERATOR_PHONE_ALLOWLIST` for routing (ops vs sales mode)

Agent line `+13054098546` is the public Sendblue number; inbound *from* Riley to that line is ops, not a prospect.

## APIs / tools

- `get_metrics` (iMessage tool) and `GET /metrics/today` return:
  - `prospectFunnel` — real lead funnel only
  - `internalOps` — ops chat + ops AI, labeled separately
- Top-level compatibility fields (`inboundMessagesToday`, `leadsCreatedToday`, …) alias **prospectFunnel only**, never totals.
- Legacy `daily_metrics.imessage_inbound` / `ai_calls` / `leads_created` are contaminated historical counters — exposed only under `legacyDailyCounters` / deprecated `imessageInbound`. Do not trust them for funnel.

## Migration

`0005_metrics_integrity` adds columns, seeds Riley into `operators`, backfills operator threads/messages and audit/test leads.

## Rule

Never sum `prospectFunnel` + `internalOps` by default when answering "how is the funnel doing?"
