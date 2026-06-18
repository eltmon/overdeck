# PAN-262: Refactor Post-Merge Lifecycle into Composable, Idempotent Operations

## Status: COMPLETE

### Implementation Progress (2026-02-28)
- [x] Phase 1: Foundation — `src/lib/lifecycle/` created with types.ts, all 4 atomic operations
- [x] Phase 2: Wire up workflows — `workflows.ts` with approve(), close(), closeOut(), deepWipe()
- [x] Phase 3: Cleanup — Rewired close-out endpoint, close endpoint, CLI close-out command, merge-agent postMergeCleanup. Deleted conditionalBeadsCompaction(). Moved review-status.ts to src/lib/. Updated import paths in specialists.ts and close-out.ts.
- [x] Phase 3 fixups: Added Rally support to LifecycleContext + close-issue. Fixed closeOut() ordering (verify-merged before archive). Deduplicated getLinearApiKey() into types.ts (removed 3 copies).
- [x] Phase 3b: Rewire approve endpoint fallback path — replaced ~120 lines inline cleanup with `lifecycle.approve()` call
- [x] Phase 3c: Rewire deep-wipe endpoint — replaced ~276 lines inline with `lifecycle.deepWipe()`. Extended TeardownOptions with workspaceConfig (tunnel/Hume), projectName, deleteWorkspace. Added clearShadowState, clearLegacyPlanningDir, clearPlanningMarker, removeTunnelConfig, removeHumeEviConfig to teardown-workspace.
- [x] Phase 4: archive-planning step (already existed in close-out, now in lifecycle module)
- [x] Phase 5: Replaced postMergeCleanup() in merge-agent with postMergeLifecycle() calling lifecycle.approve(). Merge-agent now runs full lifecycle automatically after merge validation (no manual close-out step).
- [x] Phase 6: Added closeGitHubPr() to close-issue.ts — PR closing now part of lifecycle, extracted from merge-agent.
- [x] Phase 7: Added 43 lifecycle tests across 5 test files (archive-planning, teardown-workspace, close-issue, compact-beads, workflows).

## Problem

Post-merge cleanup is fragmented across 5+ code paths with duplicated, missing, and inconsistent operations:

- **5 call sites** for issue closing, 3 different implementations (gh CLI, REST API, GraphQL), none using the `IssueTracker` abstraction
- **3 implementations** of PRD moving (git mv, renameSync, and missing entirely from polyrepo/close)
- **3 inline implementations** of workspace teardown, none calling the existing `removeWorkspace()` lib function
- **Triple execution**: monorepo merge path triggers issue close 3 times
- **Orphaned resources**: workspace + agent not cleaned up after merge
- **Lost artifacts**: `.planning/` directory destroyed on workspace teardown with no archive step
- **UI contains business logic**: approve endpoint has ~270 lines of inline orchestration

## Decisions

### D1: Teardown — Extract and Consolidate
Move teardown logic from `workspace-manager.ts` into `lifecycle/teardown-workspace.ts`. The workspace-manager's `removeWorkspace()` then delegates to the lifecycle module. Single source of truth in lifecycle.

### D2: Issue Closing — Use Tracker Abstraction
`lifecycle/close-issue.ts` uses `IssueTracker.transitionIssue()` and `IssueTracker.updateIssue()` (for labels). The tracker interface may need a minor extension for label management during close (add "done" label, remove "in-progress" label). No more raw gh CLI, REST API, or inline GraphQL.

### D3: Merge Agent — Replace postMergeCleanup with workflows.approve()
`postMergeCleanup()` is deleted entirely. After successful merge validation, the merge-agent calls `workflows.approve()` which runs all lifecycle steps in order. This eliminates the biggest source of duplication.

### D4: Merge Operation — Keep Merge-Agent for Validation
`lifecycle/merge.ts` spawns the merge-agent which does git merge + conflict detection + test validation. The lifecycle module orchestrates, the merge-agent executes. This preserves existing validation behavior.

### D5: Specialists/Done Signal — Remove Issue Close
`/api/specialists/done` endpoint just updates pipeline status and clears the queue. It no longer closes issues — that responsibility belongs to `workflows.approve()` called from within the merge-agent.

### D6: Error Mode — Fail-Forward with Result Summary
Each lifecycle step runs regardless of previous failures. `workflows.approve()` returns a structured result object showing success/failure per step. Callers decide what to do with partial success.

### D7: Archive Target — Follow Workspace Project
`archive-planning` archives to the workspace's project repo, not always overdeck. For polyrepo setups, `.planning/` artifacts go to the primary project repo.

### D8: Move review-status.ts to src/lib/
`src/dashboard/server/review-status.ts` is used by `src/lib/reopen.ts` — it's a lib module in the wrong directory. Move it to `src/lib/review-status.ts` as part of this refactor to clean up the dependency direction. Lifecycle operations will also need it.

## Architecture

### File Structure

```
src/lib/lifecycle/
  merge.ts              — Orchestrates merge-agent spawn + polling (mono, poly, remote)
  close-issue.ts        — IssueTracker.transitionIssue() + label management + comment
  archive-planning.ts   — PRD active→completed + .planning/ preservation
  teardown-workspace.ts — Full workspace cleanup (agent, worktree, Docker, tunnels, DNS, TLDR, ports)
  compact-beads.ts      — Beads compaction + git commit/push
  workflows.ts          — approve(), close(), deepWipe() composing the above
  types.ts              — Shared types (LifecycleResult, WorkflowResult, step status enums)
  index.ts              — Re-exports
```

### Result Type

```typescript
interface StepResult {
  step: string;
  success: boolean;
  skipped: boolean;     // true if operation was a no-op (idempotent)
  error?: string;
  details?: string[];   // human-readable log of what was done
}

interface WorkflowResult {
  workflow: 'approve' | 'close' | 'deep-wipe';
  issueId: string;
  success: boolean;     // true only if ALL steps succeeded
  steps: StepResult[];
  duration: number;     // ms
}
```

### Workflow Composition

```
approve(issueId, options):
  1. merge(issueId)           — spawn merge-agent, poll for completion
  2. close-issue(issueId)     — IssueTracker.transitionIssue('closed') + labels
  3. archive-planning(issueId) — PRD move + .planning/ copy + commit + push
  4. teardown-workspace(issueId) — full workspace cleanup
  5. compact-beads(issueId)   — compact closed beads + commit + push

close(issueId):
  1. close-issue(issueId)
  2. teardown-workspace(issueId)

deepWipe(issueId, options):
  1. teardown-workspace(issueId, { deleteBranches: true })
  2. delete agent state directories
  3. reset issue to backlog
```

### Caller Mapping

| Caller | Before | After |
|--------|--------|-------|
| `/api/workspaces/:id/merge` | Inline merge + closeIssueAfterMerge | `workflows.approve(issueId)` |
| `/api/workspaces/:id/approve` | 270-line inline fallback | `workflows.approve(issueId)` |
| `/api/issues/:id/close` | Inline close + teardown | `workflows.close(issueId)` |
| `/api/issues/:id/deep-wipe` | Inline deep-wipe | `workflows.deepWipe(issueId, opts)` |
| `/api/specialists/done` (merge) | closeIssueAfterMerge() | Update status only (no close) |
| merge-agent postMergeCleanup | 5 operations inline | Deleted — merge-agent calls workflows.approve() |
| CLI `pan approve` | Direct gh CLI calls | `workflows.approve(issueId)` |

### IssueTracker Interface Extension

The `updateIssue()` method already accepts `labels?: string[]` but currently replaces all labels. We may need a `closeIssue()` convenience method or extend close behavior:

```typescript
// In lifecycle/close-issue.ts:
async function closeIssue(issueId: string, tracker: IssueTracker): Promise<StepResult> {
  // 1. Get current issue to read existing labels
  const issue = await tracker.getIssue(issueId);

  // 2. Update labels: remove 'in-progress', add 'done'
  const newLabels = issue.labels.filter(l => l !== 'in-progress');
  if (!newLabels.includes('done')) newLabels.push('done');
  await tracker.updateIssue(issueId, { labels: newLabels });

  // 3. Transition to closed
  await tracker.transitionIssue(issueId, 'closed');

  // 4. Add completion comment
  await tracker.addComment(issueId, 'Merged to main via Overdeck lifecycle');
}
```

### Migration Strategy

The refactor proceeds in phases to minimize risk:

1. **Phase 1 — Foundation**: Create `src/lib/lifecycle/` with types and the 5 atomic operations, extracting logic from existing code. No behavior change yet.
2. **Phase 2 — Wire up workflows**: Create `workflows.ts` composing the atomic operations. Wire all callers (endpoints, merge-agent, CLI) to use workflows instead of inline logic.
3. **Phase 3 — Cleanup**: Delete `postMergeCleanup()`, remove `closeIssueAfterMerge()`, remove inline logic from endpoints. Move `review-status.ts`.
4. **Phase 4 — New capability**: Add `archive-planning` step (currently missing entirely).

## Scope

### In Scope
- All 5 atomic lifecycle operations in `src/lib/lifecycle/`
- `workflows.ts` with approve(), close(), deepWipe()
- Rewire all callers to use workflows
- Delete postMergeCleanup(), closeIssueAfterMerge(), inline endpoint logic
- archive-planning (new capability)
- Move review-status.ts to src/lib/
- Tests for each lifecycle operation and workflow

### Out of Scope
- Changing the merge-agent's internal validation logic (conflict detection, test running)
- Modifying the IssueTracker adapter implementations (only using existing interface)
- Refactoring the specialist system beyond removing the close call from /done
- CLI `pan approve` implementation (can be a follow-up if complex)
- Dashboard frontend changes (buttons already exist, just need to call updated endpoints)

## Risk Assessment

- **Medium risk**: Extracting teardown logic from workspace-manager — must ensure all callers still work
- **Medium risk**: Removing closeIssueAfterMerge from multiple call sites — must ensure exactly-once semantics
- **Low risk**: archive-planning is additive — new capability, doesn't change existing behavior
- **Low risk**: Moving review-status.ts — simple path update in imports
