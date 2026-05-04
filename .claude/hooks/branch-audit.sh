#!/usr/bin/env bash
#
# SessionStart hook — surfaces branch hygiene issues at the start of every
# Claude Code session so the user (and Claude) can see what's accumulating
# before starting new work.
#
# Outputs nothing if state is clean. If issues are found, emits a JSON
# additionalContext payload that Claude Code injects into the session.
#
# Triggers on: any local branch with `[gone]` upstream, any worktree whose
# branch is merged or gone, any open PR by the current user, any local
# branch >7 days old without an open PR. Cached for 1h to avoid network
# overhead on rapid session restarts.
#
# Cache: ~/.claude/cache/flower-studio-branch-audit.txt
# Bypass cache: `BRANCH_AUDIT_FRESH=1` in env.
#
# Repo-relative — only runs if invoked from the flower-studio repo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" 2>/dev/null || exit 0

# Only run for flower-studio repo (cheap guard against accidental global use)
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi
if ! git remote get-url origin 2>/dev/null | grep -q "flower-studio"; then
  exit 0
fi

CACHE_DIR="${HOME}/.claude/cache"
CACHE_FILE="${CACHE_DIR}/flower-studio-branch-audit.txt"
mkdir -p "$CACHE_DIR"

# Use cache if <1h old and not bypassed
if [[ "${BRANCH_AUDIT_FRESH:-0}" != "1" ]] && [[ -f "$CACHE_FILE" ]]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [[ $AGE -lt 3600 ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

ISSUES=()

# 1. Local branches with `[gone]` upstream (PR merged, remote deleted)
git fetch --prune --quiet 2>/dev/null || true
GONE_BRANCHES=$(git branch -vv 2>/dev/null | awk '/: gone\]/ {print $1}' | sed 's/^[*+]//' | tr -d ' ')
if [[ -n "$GONE_BRANCHES" ]]; then
  COUNT=$(echo "$GONE_BRANCHES" | wc -l | tr -d ' ')
  ISSUES+=("$COUNT local branch(es) with deleted upstream — run \`/branches\` to prune: $(echo $GONE_BRANCHES | tr '\n' ' ')")
fi

# 2. Worktrees whose branch is gone or merged into master
WORKTREE_ISSUES=()
while IFS= read -r line; do
  WT_PATH=$(echo "$line" | awk '{print $1}')
  WT_BRANCH=$(echo "$line" | grep -oE '\[[^]]+\]' | tr -d '[]' || echo "")
  [[ "$WT_PATH" == "$REPO_ROOT" ]] && continue
  [[ -z "$WT_BRANCH" ]] && continue
  # Is the branch merged into master?
  if git merge-base --is-ancestor "$WT_BRANCH" origin/master 2>/dev/null; then
    WORKTREE_ISSUES+=("$WT_PATH (branch $WT_BRANCH already in master)")
  fi
done < <(git worktree list)
if [[ ${#WORKTREE_ISSUES[@]} -gt 0 ]]; then
  ISSUES+=("${#WORKTREE_ISSUES[@]} worktree(s) with merged branches — should be unmounted: ${WORKTREE_ISSUES[*]}")
fi

# 3. Open PRs by current user (informational, not "issue" but worth surfacing)
OPEN_PRS=""
if command -v gh >/dev/null 2>&1; then
  OPEN_PRS=$(gh pr list --author @me --state open --json number,title,headRefName --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]"' 2>/dev/null || echo "")
fi

# 4. Local branches with no upstream and last commit >7 days ago (forgotten work)
NOW_EPOCH=$(date +%s)
SEVEN_DAYS_AGO=$(( NOW_EPOCH - 7*86400 ))
STALE_BRANCHES=()
while IFS= read -r b; do
  [[ "$b" == "master" ]] && continue
  [[ -z "$b" ]] && continue
  # Skip branches that already have an upstream tracked
  if git rev-parse --abbrev-ref --symbolic-full-name "$b@{u}" >/dev/null 2>&1; then
    continue
  fi
  COMMIT_EPOCH=$(git log -1 --format=%ct "$b" 2>/dev/null || echo 0)
  if [[ $COMMIT_EPOCH -lt $SEVEN_DAYS_AGO ]] && [[ $COMMIT_EPOCH -gt 0 ]]; then
    AGE_DAYS=$(( (NOW_EPOCH - COMMIT_EPOCH) / 86400 ))
    STALE_BRANCHES+=("$b (${AGE_DAYS}d, no upstream)")
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
if [[ ${#STALE_BRANCHES[@]} -gt 0 ]]; then
  ISSUES+=("${#STALE_BRANCHES[@]} local branch(es) >7d old without upstream (per CLAUDE.md \"Land or kill within 7 days\"): ${STALE_BRANCHES[*]}")
fi

# Build output
if [[ ${#ISSUES[@]} -eq 0 ]] && [[ -z "$OPEN_PRS" ]]; then
  # Clean state — empty output, write empty cache
  : > "$CACHE_FILE"
  exit 0
fi

# Build context block
CONTEXT="Branch hygiene audit (cached 1h, bypass with BRANCH_AUDIT_FRESH=1):"
CONTEXT+=$'\n'

if [[ ${#ISSUES[@]} -gt 0 ]]; then
  for issue in "${ISSUES[@]}"; do
    CONTEXT+="- [!] $issue"$'\n'
  done
fi

if [[ -n "$OPEN_PRS" ]]; then
  CONTEXT+=$'\n'"Your open PRs:"$'\n'
  while IFS= read -r pr; do
    CONTEXT+="  $pr"$'\n'
  done <<< "$OPEN_PRS"
fi

CONTEXT+=$'\n'"Run \`/branches\` to clean up. CLAUDE.md rule: land or kill within 7 days. Per-feature work goes on its own branch — do not pile new features onto an open PR's branch."

# Emit JSON for Claude Code SessionStart hook protocol
JSON_PAYLOAD=$(cat <<EOF
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": $(printf '%s' "$CONTEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')}}
EOF
)

echo "$JSON_PAYLOAD" | tee "$CACHE_FILE"
