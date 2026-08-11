---
title: Vercel project allowlist (HARD)
---

# Vercel project allowlist

**HARD RULE.** Cloud Agents may only touch these Vercel projects on team scope `altered`:

| Project | Role | Project ID |
|---|---|---|
| `api-generated` | Backend / Sendblue / QStash | `prj_pn5DJgKwAbjLE44ASvKHTQIp8Al8` |
| `web-generated` | Preferred site name (create/rename when ready) | — |
| `altered-generated-web` | Live site today (`generated.usealtered.com`) | `prj_Fq5KYoMjcDJUduzOsBKwuQ86Hnb6` |

Everything else is **forbidden** for agent CLI deploys (`workspace`, `api`, `api-generated-old`, `api-experimental*`, etc.).

## Incident 2026-08-11 — unauthorized `workspace` + `api`

### Root cause

1. **`workspace`** (`prj_T2Yk92yNHcaG0Nm3Z05Ytkj0UMPy`)  
   - Created **2026-08-11 17:11:04Z** when Cloud Agent `bc-c83571b1…` (sales-funnel posting) ran `npx vercel deploy --prod --scope altered --yes` from **repo root `/workspace`** without `--project api-generated`.  
   - Vercel CLI auto-created a project named after the directory (`workspace`), wrote `/workspace/.vercel/project.json`, and **linked GitHub `usealtered/altered-generated` @ `main`**.  
   - Result: every subsequent push to `main` also triggered production deploys on `workspace` (all **ERROR** — missing `public` output).  
   - Deployments (all Error): `workspace-4tbn3hcb4`, `workspace-mg76abt3g`, `workspace-kmqh535ir`, `workspace-6sq0vce75` (latest 17:16:44Z).  
   - **Mitigated:** Git disconnected via `vercel git disconnect` at ~17:20Z. Local `/workspace/.vercel` removed. Project left for Riley to delete.

2. **`api`** (`prj_QjbdSmHFHza1FAtuhm2N7TZPtIlW`)  
   - Created **2026-08-11 16:40:52Z** (~20 min before the posting agent) — CLI deploy from `apps/api` without `--project api-generated`, auto-named from directory basename `api`.  
   - Framework preset Hono; build command copied from `apps/api/vercel.json`.  
   - **No GitHub link.** One Error deploy: `api-86z7ib3r4` (16:40:53Z). Empty/unwanted.  
   - Flag for Riley to delete.

### What was NOT deployed successfully

Neither stray project served production traffic. All builds **Error**. No custom domains on either. Live API remains `api-generated` → `generated.api.usealtered.com`. Live site remains `altered-generated-web` → `generated.usealtered.com`.

### Prevention (in repo)

- `scripts/vercel-allowlist-check.sh` — hard fail unless project name matches allowlist  
- `scripts/vercel-deploy-api.sh` / `scripts/vercel-deploy-web.sh` — always `--project` + re-link + allowlist check  
- **CLI deploy cwd = monorepo root only.** Projects have Root Directory `apps/api` / `apps/web`. Deploying from those subdirs makes Vercel look for a nested `apps/api` (or `apps/web`) and fails with `Root Directory does not exist`.  
- Never `vercel deploy` from repo root without those scripts  
- Never `vercel link` / `vercel deploy` without `--project api-generated|web-generated|altered-generated-web`  
- `.vercel/` stays gitignored (never commit project links)

### Incident 2026-08-11 — CLI deploy from `apps/api` cwd

- `scripts/vercel-deploy-api.sh` previously `cd apps/api` then `vercel deploy --prod`.
- Project Root Directory is `apps/api`, so the upload lacked that path → production Error (`api-generated-cswur3br7…`).
- Git-push deploys were fine. Fix: deploy scripts always run from monorepo root.

### Riley manual cleanup

Delete in Vercel dashboard (agents will not delete):

1. **`altered/workspace`** — after confirming Git stays disconnected  
2. **`altered/api`** — unused Error-only project  

Optional rename: `altered-generated-web` → `web-generated` for name parity with the allowlist preference.
