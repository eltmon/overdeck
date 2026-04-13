---
name: rebase-and-submit
description: Atomic submit flow for a work agent. Use after fixing review/CI feedback, or when a stale PR is cleared and you need to re-enter the review pipeline. Runs pan work done which now handles rebase + push + PR submit internally.
author: Panopticon
version: 1.0.0
triggers:
  - rebase and submit
  - resubmit for review
  - create a fresh PR
  - re-enter the review pipeline
  - pan work done
allowed-tools:
  - Bash
---

# Rebase and Submit

This is the atomic "I'm done with my changes, get me into review" skill for work agents.

## When to use this skill

- You've addressed review feedback and need to resubmit
- Your PR was closed or stale and you need to create a fresh one
- You were told "run pan work done" via a tell/nudge
- You just finished implementation and need to enter the review pipeline

## The contract — all three steps must complete

This is a single atomic task. **Do not stop after step 1 or 2.** Report completion only after step 3 has succeeded.

### Step 1: Commit anything outstanding

Run `git status`. If there are uncommitted changes that are part of your work, commit them with a clear message. If there are unrelated artifacts (verification feedback files, etc.), leave them.

### Step 2: Determine the issue ID

The issue ID is in the workspace path (`workspaces/feature-<issue-id>/`) and in `.planning/STATE.md`. It looks like `PAN-509`, `MIN-824`, etc.

### Step 3: Run `pan work done <issue-id>`

Just run it. That's it.

```bash
pan work done <issue-id>
```

`pan work done` handles everything internally:
1. Pre-flight checks (open beads, uncommitted changes, vBRIEF acceptance criteria)
2. **Rebase onto the target branch and force-push** (added in the rebase-absorbing fix)
3. Update the tracker status (GitHub/Linear) to In Review
4. Create review artifacts (PRs) via the forge adapter
5. Trigger the review + test pipeline automatically

You do NOT need to run `git fetch`, `git rebase`, `git push`, `gh pr create`, or any other git/forge command. The single `pan work done` call is the complete submit flow.

## What to do if `pan work done` fails

- **"Open beads" error**: Close the listed beads with `bd close <id>`, then re-run.
- **"Uncommitted changes" error**: Commit them (or `git stash` if they're not relevant), then re-run.
- **"Incomplete acceptance criteria" error**: Either complete the criteria, or update the vBRIEF plan to mark them as intentionally skipped.
- **"Rebase conflicts in non-planning files" error**: Resolve the conflicts manually (`git rebase origin/main`, fix conflicts, `git add`, `git rebase --continue`), then re-run `pan work done`.
- **"Rebase conflicts in .planning/*" error**: Should not happen — `pan work done` auto-resolves planning conflicts with `--ours`. If you see this, report it as a substrate bug.

## What NOT to do

- **Do NOT** run `git rebase` manually before calling `pan work done`. The command handles it.
- **Do NOT** run `gh pr create` or `glab mr create` manually. The command handles it.
- **Do NOT** stop after rebasing or pushing. The full chain must run.
- **Do NOT** report "done" until `pan work done` has actually completed successfully.
