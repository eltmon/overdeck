# PAN-368: Auto-transition issues to In Review when specialist pipeline starts

## Problem

Issues stay "In Progress" on the tracker even when they're actively being reviewed/tested by the specialist pipeline. The "In Review" transition only fires when `readyForMerge` becomes true (after both review AND tests pass), missing the entire pipeline phase.

## Decisions

### 1. Extend IssueTracker interface with `in_review` state
- Add `'in_review'` to the `IssueState` type union in `src/lib/tracker/interface.ts`
- Implement in `LinearTracker.transitionIssue()` and `GitHubTracker.transitionIssue()`
- Linear: find state with name matching `getLinearStateName('in_review')` → "In Review"
- GitHub: use `cleanupWorkflowLabels()` to swap labels, add `'in-review'` label
- This is the proper fix — extends the abstraction rather than bypassing it

### 2. Trigger once at pipeline entry
- Add `transitionIssueToInReview()` calls in two places:
  - `/api/workspaces/:issueId/review` — user clicks "Review & Test"
  - `/api/workspaces/:issueId/request-review` — agent auto-requeues after fixing feedback
- These are the only two entry points to the pipeline; all downstream status changes (verification, review, test) flow from these
- No need to trigger at each stage change — avoids redundant API calls

### 3. Remove redundant readyForMerge transition
- The `updateLinearIssueStatus(issueId, 'In Review')` call in the readyForMerge handler is now redundant
- Issue is already "In Review" by the time readyForMerge fires
- Remove to avoid duplicate API calls and keep one clear transition point

### 4. Edge cases
- **Guard on current state**: Only transition if issue is currently "In Progress" — don't transition from "Done" or "Todo"
- **No regression**: Never transition back to "In Progress" when review fails and agent is fixing code
- **Fire-and-forget**: Transition is async, non-blocking. Log errors but don't block the pipeline
- **Don't fight the user**: If manual tracker move happened, the transition call is a no-op (tracker will reject or ignore)

## Architecture

### New function: `transitionIssueToInReview()`
Located in `src/lib/agents.ts` alongside `transitionIssueToInProgress()`. Same pattern:
1. Try primary/secondary trackers from config
2. Fall back to project-specific tracker (GitHub/GitLab)
3. Call `tracker.transitionIssue(issueId, 'in_review')`
4. Silent failure — log warning, don't block pipeline

### Files to modify

| File | Change | Difficulty |
|------|--------|------------|
| `src/lib/tracker/interface.ts` | Add `'in_review'` to `IssueState` type | trivial |
| `src/lib/tracker/linear.ts` | Handle `'in_review'` in `transitionIssue()` | simple |
| `src/lib/tracker/github.ts` | Handle `'in_review'` in `transitionIssue()` | simple |
| `src/lib/agents.ts` | Add `transitionIssueToInReview()` function | simple |
| `src/dashboard/server/index.ts` | Call transition in `/review` and `/request-review` endpoints, remove readyForMerge transition | medium |

## Out of scope
- GitLab, Jira, Rally, Trello tracker implementations (can be added later following the same pattern)
- Transitioning back to "In Progress" on review failure (explicitly not wanted per issue spec)
- Dashboard UI changes (the kanban board already reads from the tracker)
