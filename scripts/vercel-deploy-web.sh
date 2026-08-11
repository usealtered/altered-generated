#!/usr/bin/env bash
# Deploy ONLY to the allowlisted web project (prefer web-generated; fall back to
# altered-generated-web if that is the live project name).
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

mkdir -p "$ROOT/apps/web"
cd "$ROOT/apps/web"
npx vercel link --token "$TOKEN" --scope "$SCOPE" --project "$PROJECT" --yes >/dev/null
LINKED="$(node -e "console.log(require('./.vercel/project.json').projectName)")"
bash "$ROOT/scripts/vercel-allowlist-check.sh" "$LINKED"

npx vercel deploy --prod --token "$TOKEN" --scope "$SCOPE" --yes
