---
title: Handoff for next Cloud Agent chat
---

# Handoff - restart without loss

Last updated: 2026-08-11 (simplification: Chat SDK burst owns coalescing).

## HEAD on main

See latest `main`.

### Inbound concurrency (keep it simple)

1. **Webhook-early** mark-read + Haiku fast-ack (`waitUntil`, direct Sendblue) so the first bubble is not stuck behind the Chat SDK lock.
2. **Chat SDK `burst`** (`debounceMs: 1000`) owns rapid-text coalescing into one handler (`skipped[]` → `composeTurnText`).
3. Handler **awaits** main-gen (does not detach). Releasing the lock early was the mistake that forced us into custom Redis coalesce/abort cruft — removed.
4. Reply SEND still uses per-thread `send-lock:*` for ordering / rate limits.

### Do not reintroduce

- Custom main-gen coalesce buffers (`mgc:*`, quiet-window schedulers)
- Detaching Sonnet via `waitUntil` to “free the lock” for the next inbound
- Per-thread abort gates that try to paper over (2)

### Still open

1. Lock deposit amount + `PRIMARY_CHECKOUT_URL`.
2. Main-turn Sonnet latency (ack is already non-blocking via webhook-early).
3. Optional features: QStash wake-ups, follow-up questions, PNG cards.

## Domains / numbers

- API: `https://generated.api.usealtered.com`
- Agent: `+13054098546` / Operator: `+12368370221`

## Debug

```bash
npx vercel logs --project api-generated --scope altered --environment production --since 30m --query 'altered-ops:trace' --json
```

Key fields: `webhookAgeMs`, `sinceWebhookMs`, `skipped` / `burstTotal`, `source: webhook_early`.
