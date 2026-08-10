---
title: Riley operating preferences
---

# Riley operating preferences

Standing prefs for Cloud Agents and the iMessage operator. Keep this file current when Riley changes process.

## Git / PR handling

1. Create a feature branch for the work (`cursor/<descriptive-name>-…`).
2. Commit with clear messages; push the branch (`git push -u origin <branch>`).
3. Open a draft PR early; update it as you go.
4. When Riley says **complete**, **done**, or **merged** — **merge the PR into `main`** and confirm in chat. Do not leave finished work unmerged unless he says to wait.
5. Never commit secrets (`.env`, tokens, private keys).

## Cloud Agent chats

- **Dynamic agent IDs** — do not depend on a single `CURSOR_OPERATING_AGENT_ID`.
- Group **related** tasks into **one** Cloud Agent chat (same workstream).
- Start a **new** chat/agent for unrelated workstreams.
- Persist open development work in Neon `dev_tasks` (and agents in `cursor_agents`) so a chat can be abandoned/restarted with no loss.
- Soft-default agent (`settings.active_agent_id`) is last-used, not permanent.

## Continuity / no-loss restarts

Before ending a long chat, ensure:

1. Open loops are rows in `dev_tasks` (status `open` / `in_progress` / `blocked`).
2. Decisions and prefs are in `knowledge/` (and optionally `memories`).
3. PR state matches reality (pushed, linked, merged if requested).

## Vercel

- `VERCEL_TOKEN` (when present) is **only** for project `api-generated` on team scope `altered` (aka `usealtered/api-generated` in repo docs).
- Allowed: `vercel env pull`, deploy status for that project.
- Forbidden without explicit permission: other projects, domains, team settings, integration changes.

## Communication

- Ask Riley in chat / iMessage for decisions — not via inventing repo files as questions.
- Keep iMessage replies short; put durable detail in knowledge/DB.
