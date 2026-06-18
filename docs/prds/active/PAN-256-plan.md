# PAN-256: Add reopen-issue command to properly reset workspace state

**STATUS: Planning**
**Issue:** https://github.com/eltmon/overdeck/issues/256
**Branch:** feature/pan-256

---

## Problem

When an issue is reopened after being marked Done, the workspace state is stale:
- Review/test/merge status still shows "Passed" in the dashboard
- STATE.md still says "Implementation complete"
- Restarting the agent causes it to immediately re-complete (reads STATE.md → "done" → `pan done`)
- No workflow exists to reset these states for re-work

PAN-253 partially addresses this by injecting "ISSUE REOPENED" warnings into the work agent prompt, but the specialist states and STATE.md are never actually reset.

## Solution Overview

Extend the **existing** `pan reopen` command and `POST /api/issues/:id/reopen` endpoint to also:
1. Reset specialist states (review, test, merge) to pending
2. Append a "Reopened" section to STATE.md with context
3. Fetch and inject latest tracker comments
4. Set tracker status to "In Progress" (not Backlog)
5. Add a "Reopen" button to the dashboard WorkspacePanel
6. Create a `/reopen` skill for agents

## Architecture Decisions

### D1: Extend existing command, not create new
The `pan reopen` command already exists at `src/cli/commands/work/reopen.ts`. We extend it rather than creating a parallel command. The dashboard endpoint at `POST /api/issues/:id/reopen` is also extended.

### D2: Transition to "In Progress", not Backlog
Current behavior transitions to Backlog and re-runs planning. New behavior transitions to In Progress — the agent resumes with the existing plan, guided by tracker comments and the Reopened section in STATE.md.

### D3: Keep .planning-complete marker
Don't clear the `.planning-complete` file. The agent should resume implementation, not re-enter planning. The Reopened section in STATE.md + tracker comments provide the new direction.

### D4: Reset specialist states to pending (preserve history)
Use `setReviewStatus()` to reset `reviewStatus`, `testStatus`, `mergeStatus` to `pending`, clear `readyForMerge`, and clear notes. The history array naturally preserves the previous "passed" entries as audit trail. Preserve `prUrl`.

### D5: Append-only STATE.md updates
Append a `## Reopened — <date>` section at the end of STATE.md. Don't modify existing content. This preserves the implementation record while clearly marking the file as reopened.

### D6: Core reopen logic in a shared function
Extract the workspace state reset logic into a shared function (e.g., `reopenWorkspaceState()`) that both the CLI command and the dashboard API endpoint call. Prevents duplication.

### D7: Remove issue from specialist queues on reopen
If the issue is sitting in a specialist queue (review-agent, test-agent, merge-agent), remove it during reopen. Stale queue items would cause specialists to work on already-reset issues.

## Scope

### In Scope
- Reset specialist states (review/test/merge → pending) via `setReviewStatus()`
- Remove issue from specialist queues (review-agent, test-agent, merge-agent)
- Append "Reopened" section to `.planning/STATE.md` with previous status + tracker comments
- Fetch latest tracker comments (reuse PAN-253's `getTrackerContext()` pattern)
- Update tracker status to "In Progress"
- Extend `POST /api/issues/:id/reopen` endpoint with full state reset
- Dashboard "Reopen" button in WorkspacePanel
- `/reopen` skill (SKILL.md in `skills/pan-reopen/`)
- Documentation updates (USAGE.md, SPECIALIST_WORKFLOW.md)

### Out of Scope
- Full re-planning on reopen (user can manually `pan plan` if needed)
- Automatic agent restart after reopen (user starts agent manually)
- Rally tracker support (Linear and GitHub only)
- Automated detection of "incomplete work" patterns

## Key Files

| File | Change |
|------|--------|
| `src/cli/commands/work/reopen.ts` | Extend with specialist reset, STATE.md update, In Progress transition |
| `src/dashboard/server/index.ts` | Extend `POST /api/issues/:id/reopen` endpoint |
| `src/dashboard/server/review-status.ts` | No changes needed (existing `setReviewStatus` suffices) |
| `src/lib/reopen.ts` | **NEW** — shared `reopenWorkspaceState()` function |
| `src/dashboard/frontend/src/components/WorkspacePanel.tsx` | Add "Reopen" button |
| `skills/pan-reopen/SKILL.md` | **NEW** — `/reopen` skill definition |
| `docs/USAGE.md` | Document `pan reopen` command |
| `docs/SPECIALIST_WORKFLOW.md` | Document reopen flow in specialist context |

## Implementation Plan

### Task 1: Create shared reopen logic (medium)
Create `src/lib/reopen.ts` with `reopenWorkspaceState(issueId, workspacePath, options)` that:
- Resets specialist states via `setReviewStatus()`
- Removes issue from specialist queues via hook APIs
- Appends "Reopened" section to STATE.md
- Fetches latest tracker comments
- Returns a summary of what was reset

### Task 2: Extend CLI command (medium)
Modify `src/cli/commands/work/reopen.ts` to:
- Call `reopenWorkspaceState()` after tracker transition
- Change tracker transition from Backlog → In Progress
- Add `--reason` option for explicit reopen reason
- Remove automatic planning (was `planCommand()` call)
- Show summary of reset states

### Task 3: Extend dashboard API endpoint (medium)
Modify `POST /api/issues/:id/reopen` in `src/dashboard/server/index.ts` to:
- Call `reopenWorkspaceState()` with workspace path resolution
- Return reset summary in response
- Handle both GitHub and Linear issues

### Task 4: Add dashboard Reopen button (medium)
Modify `src/dashboard/frontend/src/components/WorkspacePanel.tsx` to:
- Show "Reopen" button when review/test passed or issue status is Done
- Call `POST /api/issues/:id/reopen` on click
- Show confirmation dialog
- Refresh specialist states after reopen

### Task 5: Create /reopen skill (simple)
Create `skills/pan-reopen/SKILL.md` with:
- Trigger patterns for agent/supervisor use
- Instructions to call `pan reopen <ID>` or the API endpoint
- Context about when reopening is appropriate

### Task 6: Update documentation (simple)
- `docs/USAGE.md`: Add `pan reopen` to commands reference
- `docs/SPECIALIST_WORKFLOW.md`: Document the reopen flow and how it affects specialists

### Task 7: Tests (medium)
- Unit tests for `reopenWorkspaceState()` function
- Test specialist state reset logic
- Test STATE.md append behavior
