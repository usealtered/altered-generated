---
title: Marketing discrepancies vs usealtered/altered
---

# Discrepancies — altered-generated overrides of altered settlements

This file logs deliberate overrides of conclusions from `usealtered/altered` (`.context/strategy-generated/`). Riley ordered these for the early-access deposit engine. Do not "fix" them back to the old settlements without an explicit decision.

## D1 — Deposit / reservation sale vs "no pre-sell" (2026-08-11)

| | |
|---|---|
| **Altered settlement** | **S4 — No pre-sell.** Rejected empty pre-sell ("in the age of AI, pre-selling is a form of execution incompetence"). Sell on runnable product + hardened launch slice. Locked commerce: direct **$221** Layer 1 sale in iMessage. |
| **This repo override** | Sell a **$100 program reservation deposit** that credits toward a **$499** program (net $399). Customer-facing framing is deposit/reservation — **not** "pre-sale" — even though economically it is a prepaid reservation ahead of full delivery. |
| **Why** | Riley locked this for the sales-funnel sprint to get first cash today and fill a founding cohort. Altered's no-pre-sell stance assumed selling the full Layer 1 product immediately; this motion is a lower-friction cash wedge + seat lock while the program stack finishes. |
| **Copy constraint** | Never use the words pre-sale / presale / pre-sell in outbound copy. Use reservation deposit / founding cohort / reserve your seat. |
| **Risk** | Trust hit if depositors feel sold vapor. Mitigate with honest founding-cohort framing, clear credit toward $499, and no fake testimonials. |

## D2 — Price $100 / $499 vs locked $221 (2026-08-11)

| | |
|---|---|
| **Altered settlement** | **S7/S7a** — **$221** one-time Layer 1; cohort 2 **$442+**. Stack includes ~$50 usage balance, 6-mo Layer 1, onboarding, Discord. |
| **This repo override** | Deposit **$100** → credits off program **$499** (net $399). Program described as 6-month, AI-allowance based, part-service founder-customization. |
| **Why** | Riley's explicit lock for this funnel. $499 is the program sticker; $100 is the reservation wedge. Altered's $221 remains the product-repo GTM for direct Layer 1 app sales — parallel motions until consolidated. |
| **Do not** | Re-litigate to $221 inside this funnel without Riley. |

## D3 — ICP: detail-obsessed technical founders (aligned, refined)

| | |
|---|---|
| **Altered** | Detail-obsessed technical founders on X; pressure pivots; redundant thinking; never finish. Tagline: "Never lose your best thinking again." |
| **This repo earlier draft** | Series A–C B2B teams / knowledge ops (generic SaaS ICP). |
| **Resolution** | Prefer altered ICP for sales copy. Drop generic "teams drowning in Slack+Notion" as the hero promise. Mechanism: always-on iMessage agent / memory / alignment — not "another knowledge base." |

## D4 — Channel: close in iMessage (aligned)

Altered S8: move to iMessage ASAP; payment links in iMessage. This repo's operator line `+13054098546` is the sales bus — keep that.

## D5 — Outbound posting via Zernio + HITL (2026-08-11)

| | |
|---|---|
| **Prior state** | `sales/outbound-templates.md` manual-only; social APIs blocked on keys. |
| **This repo** | Full HITL-minimal pipeline: generate → iMessage one-tap approve → Zernio publish → log. QStash schedules. |
| **Integration** | [Zernio](https://docs.zernio.com/) social posting API (`POST /api/v1/posts`). Not Buffer/Typefully. |
| **Blocked until** | Riley adds `ZERNIO_API_KEY` + `ZERNIO_TWITTER_ACCOUNT_ID` (and optional `ZERNIO_PROFILE_ID`) on api-generated. Generate/HITL ship without them. |
| **Offer CTA** | Posts drive to text +13054098546 and `/reserve` with founding UTM — into existing iMessage sales → $100 deposit. |

## D6 — QStash-only posting schedules (2026-08-11)

Vercel Hobby rejects sub-daily crons (`*/15 * * * *`). Posting schedules use **Upstash QStash** only. `/cron/posts/*` kept for signed/manual triggers.
