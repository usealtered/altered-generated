---
title: HITL posting pipeline (Zernio)
---

# HITL-minimal posting pipeline

Autonomous outbound for founding-cohort traffic → `/reserve` → iMessage sales → $100 deposit.

## Loop

1. **Generate** (QStash Mon/Wed/Fri 14:00 UTC + Vercel cron backup) creates a batch of 3-5 X/LinkedIn ideas via OpenRouter (fallback: `sales/outbound-templates.md`).
2. **HITL approve** texts Riley: numbered hooks + `APPROVE ALL` / `REJECT ALL` / `APPROVE 1 3 5` + one-tap magic link `/ops/posts/approve?...`.
3. **Publish** (every 15 min + immediate QStash enqueue after approval) sends approved ideas through **Zernio** (`https://zernio.com/api/v1/posts`).
4. **Log** outcomes in Neon `post_ideas` / `post_events` / `ai_events` (`surface=posting_generate`).

## Endpoints

| Path | Role |
|---|---|
| `POST /webhooks/qstash/posts/generate` | QStash generate tick |
| `POST /webhooks/qstash/posts/publish` | QStash publish tick |
| `GET /cron/posts/generate` | Vercel Cron generate |
| `GET /cron/posts/publish` | Vercel Cron publish |
| `GET /ops/posts/approve` | Magic-link approve/reject |
| `GET /ops/posts/pending` | Latest pending batch JSON |
| `GET /ops/posts/status` | Config + schedule status |
| `POST /ops/posts/ensure-schedules` | Bootstrap QStash schedules |

## Env (api-generated)

| Key | Required for |
|---|---|
| `ZERNIO_API_KEY` | Publish |
| `ZERNIO_TWITTER_ACCOUNT_ID` | X publish |
| `ZERNIO_PROFILE_ID` | Queue scheduling (optional; else `publishNow`) |
| `ZERNIO_LINKEDIN_ACCOUNT_ID` | LinkedIn (optional) |
| `POSTING_APPROVAL_SECRET` | Magic-link HMAC (falls back to `QSTASH_TOKEN`) |
| `POSTING_ENABLED` | Set `false` to pause |
| `CRON_SECRET` | Optional bearer for cron; Vercel also sends `x-vercel-cron: 1` |

Without Zernio keys, generate + HITL still work; publish logs `publish_blocked` and waits.

## CTA / attribution

Every post includes text `+13054098546` and a UTM'd reserve URL:

`/reserve?utm_source=x|linkedin&utm_medium=social&utm_campaign=founding_cohort&utm_content=<ideaId>`

Reserve form stores `utm` on the lead and sets `source=social:{utm_source}` so sales + metrics can attribute.

## iMessage tools

`generate_post_ideas`, `list_post_ideas`, `approve_posts`, `run_post_publish`, `posting_status`.

Operator replies `APPROVE ALL` are intercepted before the full ops LLM turn.
