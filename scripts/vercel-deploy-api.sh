#!/usr/bin/env bash
# Deploy ONLY to api-generated (scope altered). Hard-fails on wrong project.
#
# CRITICAL: api-generated has Root Directory = apps/api in Vercel project
# settings. CLI deploy MUST run from the monorepo root so the uploaded
# tree still contains apps/api. Deploying from apps/api itself makes Vercel
# look for apps/api/apps/api and fails with:
#   "The specified Root Directory \"apps/api\" does not exist."
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN required}"
SCOPE="altered"
PROJECT="api-generated"

bash "$ROOT/scripts/vercel-allowlist-check.sh" "$PROJECT"

if [[ ! -d "$ROOT/apps/api" ]]; then
  echo "BLOCKED: monorepo apps/api missing; refuse deploy from incomplete tree" >&2
  exit 1
fi

# Link at monorepo ROOT (matches Root Directory = apps/api). Never deploy from
# apps/api cwd. Always pass --project so CLI cannot auto-create a stray project.
npx vercel link --token "$TOKEN" --scope "$SCOPE" --project "$PROJECT" --yes >/dev/null

LINKED="$(node -e "console.log(require('./.vercel/project.json').projectName)")"
bash "$ROOT/scripts/vercel-allowlist-check.sh" "$LINKED"

# Sanity: linked project must still be allowlisted api-generated
if [[ "$LINKED" != "$PROJECT" ]]; then
  echo "BLOCKED: linked project '$LINKED' != expected '$PROJECT'" >&2
  exit 1
fi

npx vercel deploy --prod --token "$TOKEN" --scope "$SCOPE" --yes
