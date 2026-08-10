# Agent constraints (ALTERED generated)

## Hard rules

1. **Vercel scope:** If a Vercel token is available, use it **only** for the `usealtered/api-generated` project (env pull / deploy status for this API). Never touch any other Vercel project.
2. **No external integration changes** without explicit permission (Vercel, Sendblue, Stripe, Neon, Upstash, DNS, GitHub settings, etc.).
3. **Repo scope:** Only `usealtered/altered-generated` unless Riley expands scope.
4. Ask Riley in chat / iMessage — not via repo files — when you need decisions.

See also `knowledge/ops/constraints.md` and `knowledge/ops/preferences.md`.

## Dynamic Cloud Agents (not a single env chat ID)

- Do **not** treat `CURSOR_OPERATING_AGENT_ID` as the one durable builder. It is optional bootstrap only.
- Track agents in Neon `cursor_agents` and open work in `dev_tasks`.
- **Group related tasks into one Cloud Agent chat** (same `workstream`).
- Spawn a **new** agent chat for unrelated workstreams.
- Soft-default (`settings.active_agent_id`) is last-used / pinned — not a permanent singleton.
- Before ending a chat, persist open loops to `dev_tasks` + `knowledge/` + `memories` so the next chat loses nothing.

## Riley preferences (standing)

### Git / shipping

1. Work on a feature branch (`cursor/<name>-…`).
2. Commit and push as you go.
3. Open / update a PR against `main`.
4. When Riley says the work is **complete** / **merged**, **merge the PR** (do not leave it hanging) and confirm.
5. Prefer small, reviewable PRs; keep secrets out of git.

### Env / Vercel

- Cloud agents may receive `VERCEL_TOKEN`. Pull envs **only** for Vercel project `api-generated` on team scope `altered` (repo constraint text: `usealtered/api-generated` — never other projects):

```bash
# scratch dir only — never other Vercel projects
npx vercel link --token "$VERCEL_TOKEN" --scope altered --project api-generated --yes
npx vercel env pull .env.local --token "$VERCEL_TOKEN" --environment production --yes
```

- Never print secret values in chat, commits, or logs.
- Copy needed keys into the Cloud Agent / Vercel project secrets via Riley when permanent.

### Continuity

- Prefer DB tasks + knowledge over relying on a long Cursor transcript.
- Update `knowledge/ops/decisions.md` / `inbox.md` when ops facts change.
- Run `pnpm knowledge:sync` after editing `knowledge/`.
