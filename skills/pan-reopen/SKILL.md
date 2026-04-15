---
name: pan-reopen
audience: operator
description: "pan reopen <id> — reopen a completed issue, resetting specialist state for a new implementation cycle"
triggers:
  - reopen issue
  - reopen PAN-
  - issue needs re-work
  - re-open this issue
  - reset specialist status
  - reopen for rework
  - issue was closed but needs work
---

# Reopen Issue for Re-Work

Use this skill when an issue needs to be re-worked after being marked done, when review feedback requires significant new work, or when a merged fix turns out to be incomplete.

## What Reopen Does

1. **Moves tracker status** to "In Progress" (not Backlog — agent resumes with existing plan)
2. **Resets specialist states** — review/test/merge status → pending
3. **Removes queue items** — clears any stale entries from specialist queues
4. **Updates STATE.md** — appends a "Reopened" section with context
5. **Fetches tracker comments** — injects latest feedback into STATE.md

## When to Use

- Issue was marked Done but follow-up work is needed
- Review passed but post-merge testing found regressions
- User requested changes after review
- Agent fast-pathed to done on restart (STATE.md said "complete")

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
