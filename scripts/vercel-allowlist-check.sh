#!/usr/bin/env bash
# Hard guard: only allowlisted Vercel projects for altered-generated.
# Usage: scripts/vercel-allowlist-check.sh [project-name]
set -euo pipefail

# Canonical allowlist. web-generated is the preferred name; altered-generated-web
# is the live project today (name mismatch logged in knowledge/ops).
ALLOWED_REGEX='^(api-generated|web-generated|altered-generated-web)$'

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  if [[ -f .vercel/project.json ]]; then
    TARGET="$(node -e "const j=require('./.vercel/project.json'); process.stdout.write(j.projectName||'')")"
  elif [[ -f apps/api/.vercel/project.json ]]; then
    TARGET="$(node -e "const j=require('./apps/api/.vercel/project.json'); process.stdout.write(j.projectName||'')")"
  fi
fi

if [[ -z "$TARGET" ]]; then
  echo "vercel-allowlist-check: no project name provided and no .vercel/project.json found" >&2
  exit 2
fi

if [[ ! "$TARGET" =~ $ALLOWED_REGEX ]]; then
  echo "BLOCKED: Vercel project '$TARGET' is NOT allowlisted." >&2
  echo "Allowed: api-generated | web-generated | altered-generated-web (legacy live web name)" >&2
  echo "Never deploy to workspace, api, or any other auto-created project." >&2
  exit 1
fi

echo "vercel-allowlist-check: ok ($TARGET)"
