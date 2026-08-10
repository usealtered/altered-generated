---
title: Early access deposit offer
---

# Early access reservation deposit

## Promise

Pay $250 now to lock founding cohort pricing and priority onboarding for ALTERED.

## Why deposit (Hormozi framing)

- Filters tire-kickers
- Creates commitment + reciprocity
- Funds focused build attention on committed buyers
- Measurable daily cash goal ($250 = 1 deposit/day minimum)

## Checkout

- Stripe Checkout session created from `POST /leads` with `wantDepositCheckout: true`
- Success URL returns to `/early-access?reserved=1`
- Webhook `checkout.session.completed` marks lead `paid` and bumps daily metrics

## Objection handles

- "Is it refundable?" → Yes against founding plan / or refund if we miss cohort window (confirm policy with Riley)
- "What do I get now?" → Priority seat, direct operator channel, influence on orchestration roadmap
