---
title: iMessage operator bridge
---

# iMessage ↔ Cursor bridge

This repo's primary operator surface.

## Flow

1. You text the Sendblue number from an allowlisted phone
2. Webhook hits `POST /webhooks/sendblue`
3. Chat SDK (`chat` + `chat-adapter-sendblue`) routes the DM
4. Command parser decides: RAG ask / metrics / lead capture / Cursor follow-up
5. Default plain text → `POST https://api.cursor.com/v1/agents/{CURSOR_OPERATING_AGENT_ID}/runs`
6. QStash polls run completion and texts you the result summary

## Commands

- `help`
- `status`
- `ask <question>` — local knowledge RAG
- `cursor <task>` or plain text — resume operating Cursor agent
- `plan <task>` — Cursor Plan mode
- `new <task>` — spawn new agent on this repo
- `link bc-...` — bind thread to agent
- `lead <email/phone/note>`
- `metrics`
- `remember <note>` — queue note into knowledge via Cursor

## Operating agent

Seed `CURSOR_OPERATING_AGENT_ID` with the durable agent you want this chat to drive (this Cloud Agent run is a good default while active).

Resume URL pattern: `https://cursor.com/agents/<bcId>`
