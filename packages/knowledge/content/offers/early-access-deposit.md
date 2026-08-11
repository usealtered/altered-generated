---
title: Early access deposit offer (LOCKED)
---

# Program reservation deposit — LOCKED

## Status

**LOCKED 2026-08-11** by Riley for the sales-funnel sprint.

| Field | Value |
|---|---|
| Deposit | **$100** USD |
| Framing | Program **reservation deposit** (never "pre-sale" / "presale" in copy) |
| Credits | $100 off **$499** program price → net **$399** |
| Program | 6-month, AI-allowance based, part-service founder-customization within ALTERED |
| Seats | Limited founding-cohort seats at this deposit price |

## Checkout

Static Stripe Payment Link via `PRIMARY_CHECKOUT_URL` (no Stripe SDK required for v1).

If unset, landing + iMessage must still capture the lead and say the reservation link is being prepared — never invent a fake checkout URL.

## Copy rules

- Say **reservation deposit** / **reserve your seat** / **founding cohort**.
- Do **not** say pre-sale, presale, or pre-sell in customer-facing copy.
- Brand: **ALTERED** (product surface may reference **ALTERED Koa** / Layer 1).
- No em dashes. Hormozi-direct.

## Locked hero copy (Riley-approved — do not paraphrase)

**Primary headline (exact):**

> Ninety days from now, the feature you've been circling finally ships - because you stopped re-running the same procrastination loop you already solved.

**Subhead:** Koa is the always-on iMessage agent that holds context so detail-obsessed founders stop drifting and actually ship.

**CTA under hero:** Text Koa (deep-link to +13054098546). Landing page has **no price, no Stripe, no checkout** — price is introduced only in iMessage after qualify.

Surfaces: `apps/web` `/early-access` (site root redirects here). API `/reserve` and `/early-access` are **302 redirects** to the site (no marketing HTML on api-generated).

## Prior band

Earlier testing band was $99–$249 (placeholder $149). **$100 is the final call for now.**
