# Agent State: PAN-275

## Issue Details

- **ID:** PAN-275
- **Title:** Complete kanban board redesign: remove planning state, label cleanup, pre-workspace PRDs
- **URL:** https://github.com/eltmon/panopticon-cli/issues/275

## Summary

This issue completes the kanban board redesign started in PAN-273. PAN-273 only implemented Phase 2 (backlog filtering + list view). This issue implements the remaining phases:

1. **Phase 1:** Remove "Planning" canonical state (~20 files)
2. **Phase 2:** Hide Backlog from Current cycle view (DONE in PAN-273)
3. **Phase 3:** Pre-Workspace PRD directory
4. **Phase 4:** Clean up Linear custom states (MIN team)
5. **Phase 5:** Label cleanup

## Current Status

- Phase 2 (Backlog filtering) was completed in PAN-273
- All other phases need to be implemented

## Files to Modify

### Phase 1: Core State Types
- `src/core/state-mapping.ts` - Remove from CanonicalState, CANONICAL_STATES, STATE_TYPE_MAP, DEFAULT_STATE_MAPPINGS, trackerStateToCanonical()
- `src/dashboard/frontend/src/types.ts` - Remove from CanonicalState, STATUS_ORDER, STATUS_LABELS, STATE_TYPE_MAP
- `src/lib/shadow-state.ts` - Remove from CanonicalState

### Phase 2: Dashboard Server
- `src/dashboard/server/index.ts` - Remove start-planning, complete-planning endpoints; update move-status
- `src/dashboard/server/services/issue-data-service.ts` - Remove planning mappings

### Phase 3: Frontend Components
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` - Remove planning column
- `src/dashboard/frontend/src/components/PlanDialog.tsx` - Remove planning flow
- `src/dashboard/frontend/src/components/HandoffsPage.tsx` - Remove planning_complete

### Phase 4: Cloister System
- `src/lib/cloister/triggers.ts` - Remove planning_complete trigger
- `src/lib/cloister/config.ts` - Remove planning_complete config
- `src/lib/work-types.ts` - Remove planning work types
- `src/lib/settings.ts` - Remove planning_agent config

### Phase 5: CLI Commands
- `src/cli/commands/work/wipe.ts` - Remove planning label cleanup
- `src/cli/commands/work/done.ts` - Update label logic

### Phase 6: Pre-Workspace PRD Directory
- Create `docs/prds/drafts/` directory convention
- Update planning agent to write to drafts/
- On workspace creation, copy draft PRD to .planning/
- Update PRD enforcement to check drafts/

### Phase 7: Label Cleanup
- Remove dead labels: planning, planned, done, review-ready
- Add auto-cleanup on state transitions
- Consolidate duplicate mapGitHubStateToCanonical() logic
- Unify pan work done across trackers

### Phase 8: Tests
- `tests/e2e/handoff-planning-complete.test.ts`
- `tests/integration/agent-spawning.test.ts`
- `tests/lib/router-config.test.ts`

### Phase 9: Linear Custom States
- Remove "In Planning" custom state from MIN team
- Remove "In Review" custom state from MIN team
- Migrate existing issues

## Acceptance Criteria

- [ ] Kanban board shows exactly 4 columns: Todo, In Progress, In Review, Done
- [ ] No references to "planning" as a canonical state anywhere in the codebase
- [ ] All tests pass (no new failures vs main baseline)
- [ ] Label state transitions are clean — no stale labels left behind
- [ ] PRDs can be created before a workspace exists

## References

- PRD: `docs/prds/completed/pan-273-plan.md`
- Design doc: `docs/KANBAN-MODEL.md`
- Prior work: PAN-273 / PR #274

## Specialist Feedback

- **[2026-02-27T07:22Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/007-review-agent-changes-requested.md`
- **[2026-02-27T08:14Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/008-review-agent-changes-requested.md`
- **[2026-02-27T08:28Z] test-agent → FAILED** — `.planning/feedback/009-test-agent-failed.md`
- **[2026-02-27T13:15Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/010-review-agent-changes-requested.md`
- **[2026-02-27T13:21Z] test-agent → FAILED** — `.planning/feedback/011-test-agent-failed.md`
- **[2026-02-27T16:22Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/012-review-agent-changes-requested.md`
