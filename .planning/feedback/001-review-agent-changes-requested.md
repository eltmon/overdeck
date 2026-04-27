---
specialist: review-agent
issueId: PAN-867
outcome: changes-requested
timestamp: 2026-04-27T04:50:58Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-867 adds Zone C-3: an issue-selected composer with spawn/send modes, plus a Phase 5 action-parity smoke test. The new composer behavior (7 of 9 requirements) is well-implemented with solid test coverage and passes the critical security review. However, the acceptance criterion requiring an exhaustive action-parity test is not met — the smoke test uses a manually curated list of actions instead of deriving all actions from the named source surfaces (KanbanBoard, InspectorPanel, StatusFlowControl, WorkspacePane). One requirement is missing and one is partially evidenced. The PR cannot merge until the smoke test is made exhaustive.

## Blockers (MUST fix before merge)

### 1. Smoke test does not enumerate all kanban/inspector/workspace actions — `src/dashboard/frontend/src/lib/__tests__/commandDeckActions.test.ts:227-311` — `!`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion explicitly requires "assert there's a Command Deck home (Zone A or Zone B)" for "each action" and "fail CI if any action is reachable in kanban but not in CD". The current test validates a hand-maintained `surfaceActions` array against a curated list, so it can pass while a real UI action in KanbanBoard/InspectorPanel/StatusFlowControl/WorkspacePane has no CD home.

<fix instruction — what to change, concrete and scoped>

The smoke test must be changed to **derive** the exhaustive action list from the source surfaces rather than validating against a hand-maintained list. The exact approach is the work agent's choice, but two viable paths:

**Option A (preferred):** Scan the four named source files (`KanbanBoard.tsx`, `InspectorPanel.tsx`, `StatusFlowControl.tsx`, `WorkspacePane.tsx`) at test runtime for all rendered action buttons/links (look for `onClick` handlers, `role="button"`, or navigation calls to `/api/agents`, `/api/workspaces`, etc.) and dynamically build the action surface, then assert every action there has a CD home.

**Option B:** Add a central registry of all known action keys in one place (e.g. `src/dashboard/frontend/src/lib/actionKeys.ts`) that source surfaces and the test both import — the test imports it and checks coverage, source surfaces register their actions. This requires changes to the four source files.

In either case: the test file at `commandDeckActions.test.ts` must be updated so the test **fails** if any action reachable in the named surfaces is absent from the CD action map. Attach the failing test output as CI evidence before merge.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `noAgentOrStopped` excludes `failed`/`dead` agents from workspace creation but not from startAgent — `src/dashboard/frontend/src/lib/commandDeckActions.ts:162,189-195` — `~`
**Raised by**: correctness
**Why it blocks**: When an agent has `status: 'failed'` or `'dead'` with `issueCanonicalState: 'in_progress'` and no workspace, the user sees "Start Agent" but no "Create Workspace" button. Clicking Start Agent without a workspace may 422 at the API level, leaving no recovery path.

<fix instruction>

Extend the `noAgentOrStopped` condition to include `'failed'` and `'dead'`:
```typescript
const noAgentOrStopped = !agent || agent.status === 'stopped' || agent.status === 'failed' || agent.status === 'dead';
```
Or add a dedicated case in the switch statement for failed/dead agents that surfaces both start + workspace creation controls.

### 2. Dead `reopen` branch in danger-zone block — `src/dashboard/frontend/src/lib/commandDeckActions.ts:280-282` — `~`
**Raised by**: correctness
**Why it blocks**: The `reopen` push at lines 280-282 is provably unreachable — when `issueCanonicalState === 'done'`, `derivePipelineState` sets `state === 'done'`, and the outer condition `state !== 'done'` is false, so the block never executes. The correct reopen behavior is already handled by the switch statement at lines 229-234. Dead code adds maintenance burden and risks misleading future editors.

<fix instruction>

Remove lines 280-282 (the dead `reopen` branch inside the danger-zone block). The outer guard at line 279 already handles the merged/done/canceled exclusion correctly.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/IssueComposer.tsx:75` — `?` — Unconditional second query invalidation. `onSuccess` invalidates `['agents']` then schedules a second invalidation 2s later — one fetch is guaranteed redundant. Safe to defer, low frequency path. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/IssueComposer.tsx:84-86` — `?` — `handleSubmit` useCallback includes `spawnMutation` in deps. The `mutate` fn is stable but the wrapper object is not — recreates on every render. Safe to defer since this is a simple form. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/IssueComposer.tsx:28-31` — `?` — `deriveComposerMode` has an uncovered edge case for unknown presence values (falls through to spawn-and-send with misleading notice). Theoretical — all realistic inputs are covered. Safe to defer. (correctness)
- `src/dashboard/frontend/src/lib/__tests__/commandDeckActions.test.ts` — `?` — Parity smoke test doesn't cover `status: 'failed'` agent case. Adding `{ ...baseZoneA, agent: { status: 'failed' } }` would document expected behavior and catch regressions on the noAgentOrStopped gap. Low priority given the rarity of the scenario. (correctness)

## Cross-cutting groups

**Action-parity test completeness** (all stem from REQ-9 — the smoke test doesn't enumerate from source surfaces):
- [blocker-1] REQ-9: Smoke test must enumerate all kanban/inspector/badge/status/workspace actions from source surfaces, not a curated list
- [nit-4] Suggestion: Add `status: 'failed'` agent case to parity smoke test

**Dead code cleanup** (same file, related):
- [high-2] Dead `reopen` branch at commandDeckActions.ts:280-282 (unreachable by construction)
- [high-1] noAgentOrStopped gap at commandDeckActions.ts:162 (gated by `noAgentOrStopped` but startAgent is unconditional)

## What's good
- Composer behavior (spawn/send, spawn-work/send, disabled-with-hint modes) fully implemented and well-tested
- No security vulnerabilities introduced — new composer and resumed-session flows only forward text to authenticated endpoints
- Phase 5 `syncMain` parity support correctly added across commandDeckActions and ZoneActionStrip
- Requirements reviewer confirmed 7 of 9 requirements fully implemented

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=2, security=0, performance=0, requirements=1
- Files touched: 9   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-867 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

