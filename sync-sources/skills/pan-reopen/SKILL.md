---
name: pan-reopen
description: "pan reopen <id> — re-enter the pipeline for a CLOSED/COMPLETED/CANCELLED issue. NOT for issues already in progress — use `pan review restart` for that."
triggers:
  - reopen closed issue
  - reopen completed issue
  - reopen PAN-
  - issue was closed but needs work
  - issue needs re-work after merge
---

# Reopen a Closed/Completed Issue for Re-Work

Use this skill only when an issue has **already been closed, completed, or cancelled** and needs to re-enter the pipeline.

If the issue is still in progress and you want to re-trigger reviewers or reset specialist state, **do not use `pan reopen`** — see [\"When NOT to Use Reopen\"](#when-not-to-use-reopen) below.

## What Reopen Does

1. **Moves tracker status** to "In Progress" (not Backlog — agent resumes with existing plan)
2. **Resets specialist states** — review/test/merge status → pending
3. **Removes queue items** — clears any stale entries from specialist queues
4. **Updates the continue file** — appends a "Reopened" breadcrumb with context
5. **Fetches tracker comments** — injects latest feedback for the agent

## Preflight Guard

As of PAN-1115, `pan reopen <id>` refuses to run when the issue's current tracker state is in-progress-like (In Progress, In Review, Todo, Backlog, Open, etc.) and prints a pointer to the right command for that situation. Re-run with `--force` to override the guard if you truly want reopen semantics on an already-open issue.

## When to Use Reopen

- Issue was marked **Done / Closed** but follow-up work is needed
- Issue was **Cancelled** and now needs to be picked back up
- Review passed and merged, but post-merge testing found a regression that warrants a fresh implementation cycle on the same issue
- Agent fast-pathed to done on restart and the issue's tracker state is closed but the work was incomplete

## When NOT to Use Reopen

If the issue is **already In Progress** and one of these is true, use the listed command instead. None of these touch code, git, branches, or PRs — they only reset pipeline state.

| Situation | Command |
| --- | --- |
| Reviewers are stuck / errored / silently exited and you want fresh ones | `pan review restart <id>` |
| You want to force review/test/merge cycles back to pending (human override) | `pan review reset <id>` |
| You want to kill running reviewers and leave the worker idle | `pan review abort <id>` |
| Work agent should pick up where it left off, no state reset needed | just `pan start <id>` |

## How to Reopen

### Via CLI (recommended for agents/supervisors)
```bash
pan reopen PAN-123
# With explicit reason:
pan reopen PAN-123 --reason "Post-merge regression in auth flow"
# Skip confirmation prompt:
pan reopen PAN-123 --force
```

### Via Dashboard API
```bash
curl -X POST http://localhost:3011/api/issues/PAN-123/reopen \
  -H "Content-Type: application/json" \
  -d '{"reason": "Post-merge regression found"}'
```

### Via Dashboard UI
Click the **Reopen** button in the WorkspacePanel (visible when review/test has passed or issue is merged).

## After Reopening

1. The issue is now "In Progress" in the tracker
2. Specialist states are all `pending`
3. STATE.md has a new "Reopened" section with context and tracker comments
4. Start the agent normally: `pan start PAN-123`

The agent will read STATE.md, see the "Reopened" section, and resume work based on the tracker context rather than fast-pathing to done.

## Do NOT Use `pan done` Until Re-Work Is Complete

After reopening, the agent must complete the requested changes, pass tests, and go through review again before signaling `pan done`.
