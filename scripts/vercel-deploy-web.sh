#!/usr/bin/env bash
# Deploy ONLY to the allowlisted web project (prefer web-generated; fall back to
# altered-generated-web if that is the live project name).
#
# CRITICAL: web projects use Root Directory = apps/web. CLI deploy MUST run
# from the monorepo root so the uploaded tree still contains apps/web.
# Deploying from apps/web itself makes Vercel look for apps/web/apps/web and fail.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN required}"
SCOPE="altered"

# Resolve which allowlisted web project exists
if npx vercel project inspect web-generated --token "$TOKEN" --scope "$SCOPE" >/dev/null 2>&1; then
  PROJECT="web-generated"
elif npx vercel project inspect altered-generated-web --token "$TOKEN" --scope "$SCOPE" >/dev/null 2>&1; then
  PROJECT="altered-generated-web"
else
  echo "BLOCKED: neither web-generated nor altered-generated-web exists" >&2
  exit 1
fi

bash "$ROOT/scripts/vercel-allowlist-check.sh" "$PROJECT"

if [[ ! -d "$ROOT/apps/web" ]]; then
  echo "BLOCKED: monorepo apps/web missing; refuse deploy from incomplete tree" >&2
  exit 1
fi

# Link at monorepo ROOT (matches Root Directory = apps/web). Never deploy from
# apps/web cwd. Always pass --project so CLI cannot auto-create a stray project.
npx vercel link --token "$TOKEN" --scope "$SCOPE" --project "$PROJECT" --yes >/dev/null
LINKED="$(node -e "console.log(require('./.vercel/project.json').projectName)")"
bash "$ROOT/scripts/vercel-allowlist-check.sh" "$LINKED"

if [[ "$LINKED" != "$PROJECT" ]]; then
  echo "BLOCKED: linked project '$LINKED' != expected '$PROJECT'" >&2
  exit 1
fi

npx vercel deploy --prod --token "$TOKEN" --scope "$SCOPE" --yes
