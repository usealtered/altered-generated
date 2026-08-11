#!/usr/bin/env bash
# Deploy ONLY to api-generated (scope altered). Hard-fails on wrong project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN required}"
SCOPE="altered"
PROJECT="api-generated"

bash "$ROOT/scripts/vercel-allowlist-check.sh" "$PROJECT"

# Link apps/api explicitly every time (never rely on ambient .vercel at repo root)
cd "$ROOT/apps/api"
npx vercel link --token "$TOKEN" --scope "$SCOPE" --project "$PROJECT" --yes >/dev/null

# Refuse if link drifted
LINKED="$(node -e "console.log(require('./.vercel/project.json').projectName)")"
bash "$ROOT/scripts/vercel-allowlist-check.sh" "$LINKED"

npx vercel deploy --prod --token "$TOKEN" --scope "$SCOPE" --yes
