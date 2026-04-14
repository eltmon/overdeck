---
name: rebase-and-submit
description: Atomic submit flow for a work agent. Covers the first submission (`pan done`) AND the re-review-after-feedback path (`pan review request`). Use this whenever you finish implementation OR finish addressing specialist feedback — never hand-roll curl, git push, or PR create commands.
author: Panopticon
version: 1.1.0
triggers:
  - rebase and submit
  - resubmit for review
  - request review
  - re-enter the review pipeline
  - fixed the feedback
  - pan done
  - pan review request
allowed-tools:
  - Bash
---

# Rebase and Submit

This is the atomic "I'm done with my changes, get me into review" skill for work agents. It has two entry points — pick the right one for your situation:

| Situation | Command |
|---|---|
| First submission of this issue (no PR exists yet, or no prior review feedback) | `pan done <issue-id>` |
| You just fixed specialist feedback (review, test, or verification-gate failure) and need to re-enter the pipeline | `pan review request <issue-id>` |

If you are unsure which applies, check `.planning/feedback/`. If it contains any files that describe failures you have just addressed, you are in the re-review case — use `pan review request`.

**NEVER** try to trigger the review pipeline by curling dashboard APIs (`/api/review/...`, `/api/workspaces/.../review`, etc.). Those routes are for specialist/system use only, not for direct agent invocation. The CLI commands above are the only supported way.

## When to use this skill

- You've finished implementation for the first time → `pan done`
- You addressed review/test/verification feedback and need to resubmit → `pan review request`
- Your PR was closed or stale and you need to create a fresh one → `pan done`
- You were told "run pan done" or "request re-review" via a tell/nudge → whichever was named
- Specialist feedback arrived (`.planning/feedback/NNN-*.md`) and you believe you've resolved it → `pan review request`

## The contract — all steps must complete

This is a single atomic task. **Do not stop after step 1 or 2.** Report completion only after the submit step has succeeded.

### Step 1: Commit anything outstanding

Run `git status`. If there are uncommitted changes that are part of your work, commit them with a clear message. If there are unrelated artifacts (verification feedback files, etc.), leave them.

### Step 2: Determine the issue ID and the path

- Issue ID is in the workspace path (`workspaces/feature-<issue-id>/`) and in `.planning/STATE.md`. Looks like `PAN-705`, `MIN-824`, etc.
- Path: check `.planning/feedback/`. If there are unaddressed files for this cycle, you just fixed them → **request-review**. Otherwise → **done**.

### Step 3a: First submission — `pan done <issue-id>`

```bash
pan done <issue-id>
```

`pan done` handles everything internally:
1. Pre-flight checks (open beads, uncommitted changes, vBRIEF acceptance criteria)
2. **Rebase onto the target branch and force-push**
3. Update the tracker status (GitHub/Linear) to In Review
4. Create review artifacts (PRs) via the forge adapter
5. Trigger the review + test pipeline automatically

### Step 3b: Re-review after feedback — `pan review request <issue-id>`

```bash
pan review request <issue-id> -m "Addressed feedback: <short summary>"
```

`pan review request` handles everything internally:
1. Pushes your latest fixes to the existing feature branch
2. Records a new review cycle (bounded by an automatic circuit breaker — up to 7 retries)
3. Re-triggers the specialist pipeline (review → test → merge)
4. Updates the tracker so the dashboard reflects "re-review requested"

The `-m "<summary>"` flag is optional but recommended — it lands in the dashboard and in the specialist prompt so the reviewer knows what changed since last pass.

You do NOT need to run `git fetch`, `git rebase`, `git push`, `gh pr create`, or any `curl` against the dashboard. The single CLI call is the complete submit flow.

## What to do if the command fails

- **"Open beads" error**: Close the listed beads with `bd close <id>`, then re-run.
- **"Uncommitted changes" error**: Commit them (or `git stash` if they're not relevant), then re-run.
- **"Incomplete acceptance criteria" error**: Either complete the criteria, or update the vBRIEF plan to mark them as intentionally skipped.
- **"Rebase conflicts in non-planning files" error**: Resolve the conflicts manually (`git rebase origin/main`, fix conflicts, `git add`, `git rebase --continue`), then re-run.
- **"Rebase conflicts in .planning/*" error**: Should not happen — `pan done` auto-resolves planning conflicts with `--ours`. If you see this, report it as a substrate bug.
- **"Circuit breaker triggered" (429 on `request-review`)**: You've hit the 7-retry limit. Stop and surface a clear summary of what you've tried. A human must click the Review button in the dashboard to continue — do NOT loop.

## What NOT to do

- **Do NOT** `curl` any `/api/review/...`, `/api/workspaces/.../review`, or other dashboard endpoint to trigger review. Those routes are for specialist/system use only — use the CLI commands instead.
- **Do NOT** run `git rebase` manually before calling the submit command. It handles rebase.
- **Do NOT** run `gh pr create` or `glab mr create` manually.
- **Do NOT** stop after rebasing or pushing. The full chain must run.
- **Do NOT** report "done" until the submit command has actually completed successfully.
- **Do NOT** call `pan done` a second time after feedback — that is the wrong command once a PR exists. Use `pan review request`.
