#!/usr/bin/env bash
# SAFE — read-only. Inspects git diff and prints the minimum Pre-PR check matrix.
# Usage:  ./.claude/skills/pre-pr-matrix/scripts/pick-matrix.sh [base-ref]
# Default base-ref is origin/master.

set -euo pipefail

BASE="${1:-origin/master}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "# base-ref '$BASE' not found; falling back to HEAD~1" >&2
  BASE="HEAD~1"
fi

CHANGED="$(git diff --name-only "${BASE}...HEAD" 2>/dev/null || true)"
if [[ -z "$CHANGED" ]]; then
  CHANGED="$(git diff --name-only "$BASE" 2>/dev/null || true)"
fi
if [[ -z "$CHANGED" ]]; then
  echo "# No diff against $BASE — nothing to verify." >&2
  exit 0
fi

has() { echo "$CHANGED" | grep -qE "$1"; }

declare -a CMDS=()
NOTES=""

if has '^backend/'; then
  CMDS+=("cd backend && npx vitest run")
  CMDS+=("npm run harness &   # then in another shell:")
  CMDS+=("npm run test:e2e")
fi

if has '^packages/shared/'; then
  CMDS+=("cd packages/shared && ../../backend/node_modules/.bin/vitest run")
  CMDS+=("cd apps/florist && ./node_modules/.bin/vite build")
  CMDS+=("cd apps/dashboard && ./node_modules/.bin/vite build")
  CMDS+=("cd apps/delivery && ./node_modules/.bin/vite build")
  NOTES="${NOTES}# packages/shared touched → build ALL THREE apps (Vercel builds isolate; hoisting hides missing deps).\n"
fi

if has '^apps/florist/' && ! has '^packages/shared/'; then
  CMDS+=("cd apps/florist && ./node_modules/.bin/vite build")
fi
if has '^apps/dashboard/' && ! has '^packages/shared/'; then
  CMDS+=("cd apps/dashboard && ./node_modules/.bin/vite build")
fi
if has '^apps/delivery/' && ! has '^packages/shared/'; then
  CMDS+=("cd apps/delivery && ./node_modules/.bin/vite build")
fi

if has '^backend/' || has '^packages/shared/' || has '^lab/'; then
  CMDS+=("npm run lab:test:unit")
  CMDS+=("npm run lab:test:api   # if first run this session: npm run lab:db:up && npm run lab:template:rebuild -- --scenario=baseline")
fi

if has '^lab/scenarios/'; then
  CMDS+=("npm run lab:test:ui   # UI scenarios changed")
fi

if has '\.md$' && [[ -z "${CMDS[*]:-}" ]]; then
  echo "# Docs-only diff — no matrix checks required."
  exit 0
fi

if [[ -z "${CMDS[*]:-}" ]]; then
  echo "# No matrix-relevant paths in the diff. Double-check with: git diff --name-only $BASE...HEAD" >&2
  exit 0
fi

echo "# Pre-PR matrix for diff against $BASE"
echo "# Changed paths:"
echo "$CHANGED" | sed 's/^/#   /'
echo ""
if [[ -n "$NOTES" ]]; then
  printf "%b" "$NOTES"
  echo ""
fi
echo "# Commands to run (in order):"
for c in "${CMDS[@]}"; do
  echo "$c"
done
