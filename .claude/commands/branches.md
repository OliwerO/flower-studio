---
description: "Branch hygiene audit + cleanup. Surfaces strays, prunes [gone] locals, unmounts merged worktrees, lists open PRs, asks owner before destructive remote actions."
---

# /branches — branch hygiene

Run this whenever you suspect branch sprawl, before starting new feature work, or when the SessionStart hook flags issues. Pairs with the SessionStart hook at `.claude/hooks/branch-audit.sh` (which is read-only — surfaces state but never mutates).

## What this command does

Five passes, in order. Stop and report after each. Take destructive actions only with the safety rails described.

### 1. Refresh + audit

```bash
git fetch --prune
git worktree list
git branch -vv
gh pr list --author @me --state open --json number,title,headRefName,createdAt,updatedAt
gh pr list --state all --limit 20 --json number,title,headRefName,state,mergedAt
```

Build a table:
- Local branches → upstream status (tracked / `[gone]` / no upstream)
- Worktrees → branch + whether merged into `origin/master`
- Open PRs by current user → age + last update
- Recent merged PRs → so you can correlate `[gone]` locals to the PR that merged

### 2. Safe prune (no confirmation needed)

These are reversible from reflog and pure local cleanup:
- **Local branches with `[gone]` upstream** — `git branch -D <name>` for each. The branch's PR was merged + remote auto-deleted. Local copy is dead weight.
- **Worktrees whose branch is fully merged into `origin/master`** — `git worktree remove <path>`, then `git branch -D <branch>` if not the active branch. Use `git merge-base --is-ancestor <branch> origin/master` to verify.

Do these without asking. They never lose work.

### 3. Stale branch decisions (ask owner per branch)

For each local branch AND each remote branch that is:
- More than 7 days old (per CLAUDE.md "Land or kill within 7 days")
- More than 50 commits behind master, AND
- Has no open PR

…build a one-line summary: branch name, age, commits behind, last commit subject, whether the work is salvageable. **Ask the owner per branch:** kill (delete + reflog as recovery), salvage to BACKLOG.md (write a backlog entry referencing the sha then delete), or open a draft PR right now.

Never auto-delete real feature work. The reflog protects against fat-fingering, but ask anyway — the owner may know context the audit can't see.

### 4. Forbidden-prefix purge (ask once, then proceed)

Per CLAUDE.md: branches starting with `claude/` are forbidden. They were a Claude Code default that turned into a graveyard of one-commit stubs. Auto-flag any local or remote branches with `claude/` prefix. Confirm once with the owner ("delete N `claude/*` branches?") then `git push origin --delete <name>` for each.

### 5. Open-PR sanity check

For every open PR by the current user:
- If updated >5 days ago → flag for either landing or closing.
- If branched from a non-master parent → flag for rebase or land of the parent first.
- If the title or branch name matches a feature already merged in master → flag as duplicate work.

Output the flags but don't act — owner triages.

## Output format

When done, print:

```
Branch hygiene report — YYYY-MM-DD HH:MM
Local: N branches (M pruned this run, K kept).
Remote: N branches (M deleted this run, K kept).
Worktrees: N (M unmounted this run, K kept).
Open PRs: N.

Pending owner decisions:
- <bullet list, one line each>

Cache invalidated — next session's branch-audit hook will re-scan.
```

Then run `rm -f ~/.claude/cache/flower-studio-branch-audit.txt` so the SessionStart hook re-audits on next start instead of showing stale cleaned-up state.

## Hard rules

- **Never** delete a branch with uncommitted changes from a worktree without owner ack. Run `git status` in the worktree first.
- **Never** delete the currently-checked-out branch.
- **Never** force-push to delete (use `git push origin --delete <name>`).
- **Never** close someone else's PR — only the current user's (`gh pr list --author @me`).
- If `gh` isn't authenticated, skip the PR-side checks and report which steps were skipped.

## When NOT to run

- Mid-feature, on a branch with uncommitted work — finish that first.
- During a shadow window for a constrained domain — branch ops are fine, just don't accidentally touch the constrained-domain code in this same session.
- If the SessionStart hook reported clean state in the last hour — you have nothing to do.
