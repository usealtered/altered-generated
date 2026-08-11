---
title: Outbound content templates (founding cohort)
---

# Outbound content templates

Derived from `usealtered/altered` positioning (detail-obsessed founders, pressure pivots, redundant thinking). Optimized to drive DMs / texts to **+13054098546** and the $100 reservation deposit.

Channel APIs (IG/X/TikTok auto-post) are **not wired** — no platform keys in this env. Use these as copy bank + manual posting. Track sends in `lead_events` / notes when a prospect replies.

## Hooks (X / short)

1. You do not have a notes problem. You have a pressure-pivot problem.
2. Your best thinking dies in old chats. That is why you rebuild the same product.
3. Detail-obsessed founders do not need another AI chat. They need memory that fights back.
4. If you re-derived a decision you already settled, you are paying a tax.
5. Never lose your best thinking again.
6. Shipping fails when priorities shift under pressure. Lock the goal.
7. Stop asking AI what to do. Make it remember what you already decided.
8. Founding cohort open: $100 reservation deposit toward the $499 program.

## Post bodies (paste-ready)

### Post A — Pressure pivots

Most founders do not fail from lack of ideas.

They fail because pressure makes them pivot off the goal they already chose.

ALTERED is an always-on iMessage layer that remembers your decisions and keeps you locked on the goal until it ships.

Text +13054098546 — founding cohort seats are limited. $100 reservation deposit credits toward the $499 program.

### Post B — Redundant thinking

You have settled this before.

You wrote the WHY. You named the offer. Then a busy week hit and you re-litigated it from zero.

That loop is expensive.

ALTERED resurfaces your own best thinking when you start to drift.

Text +13054098546 to reserve a founding seat ($100 deposit → $100 off $499).

### Post C — Honest founding

No fake testimonials. No theater.

Founding cohort for detail-obsessed technical founders who want their thinking to compound instead of evaporate.

$100 reservation deposit. Credits to the $499 program. Limited seats.

Text +13054098546.

## DM openers (manual outbound)

1. Saw you are building [X]. Curious — when priorities shift mid-build, do you have anything that pulls you back to the original WHY?
2. Quick question for detail-obsessed builders: where does your best thinking go to die — Notes, Slack, or your own head?
3. Not selling a chatbot. Selling a seat in a founding cohort that keeps founders from pressure-pivoting off the goal. Want the one-liner?

## CTA variants

- Text +13054098546
- Reply READY for the reservation link
- Reserve with $100 → https://generated.api.usealtered.com/reserve (interim until site deploy)

## Scheduling scaffolding (no external APIs)

Track intended posts in Neon via `upsert_dev_task` workstream `outbound-content` or a lead note. Suggested weekly cadence until APIs exist:

| Day | Asset |
|---|---|
| Mon | Hook + Post A |
| Wed | Hook + Post B |
| Fri | Founding CTA (Post C) |
| Daily | 5 manual DMs from ICP list |

**Blocked on keys:** X API, Meta/IG Graph, TikTok Content Posting, Buffer/Typefully. Do not stall — post manually.

## Tracking

When a prospect replies from outbound:

1. `save_lead` phone + source note `outbound:{channel}:{asset}`
2. status `contacted` → follow `knowledge/sales/imessage-funnel.md`
