---
specialist: review-agent
issueId: PAN-866
outcome: changes-requested
timestamp: 2026-04-27T10:45:38Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-866 implements 9 Zone C tabs (Activity, Costs, PRD, STATE, INFERENCE, vBRIEF, Beads, PR/Diff, Discussions) with backend markdown endpoints, activity scoping, and specialist context improvements. All 10 functional requirements are implemented and verified by code evidence. However, the requirements reviewer identified that the explicit acceptance criterion "Visual verified with Playwright" has no artifact or evidence in the changed files — this is a MUST-level blocker. The correctness reviewer also flagged two live code quality issues (dead props in the component interface, unnecessary type assertions) that should be addressed together.

## Blockers (MUST fix before merge)

### 1. Missing Playwright visual verification — `!` (requirements)
**Raised by**: requirements
**Why it blocks**: The issue body includes "Visual verified with Playwright" as an explicit acceptance criterion, but there is no evidence (test file, screenshot, or Playwright run artifact) that the Zone C tab UI was exercised in a browser and visually checked.

<fix instruction>: Run Playwright tests for the Zone C Overview component or capture browser screenshots of all 9 tabs rendering for the issue-scoped view. Commit the test file or screenshot artifact to the workspace. If Playwright infrastructure is not available in this workspace, the work agent should flag this to the user so they can perform the visual verification themselves or explicitly defer it.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Unused props remain in ZoneCOverviewProps interface — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:65-67` — `≉`
**Raised by**: correctness
**Why it blocks**: The JSDoc on `issues?` says "Forwarded to the Activity tab" but `ActivityTab` no longer accepts these props (the PR replaced `ActivityView` with `ActivityFeed` which takes only `issueId`). Callers still passing these props get silent no-ops.

<fix instruction>: Remove `issues?: readonly Issue[]` and `featureData?: ProjectFeature | null` from the `ZoneCOverviewProps` interface. Remove the corresponding type imports if they are no longer used elsewhere in the file. Also remove the `issues` and `featureData` props from the test call at `ZoneCOverview.test.tsx:188-189`.

### 2. Unnecessary type assertion bypasses type safety — `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx:32-36` — `~`
**Raised by**: correctness
**Why it blocks**: The selector uses `(event as { issueId?: unknown }).issueId` cast to check for `issueId` existence, but `GodViewActivityEvent` already declares `issueId?: string`. If the type changes upstream the cast would silently hide it.

<fix instruction>: Replace the verbose cast with direct property access:
```typescript
if (event.issueId) {
  return event.issueId.toUpperCase() === issueId.toUpperCase();
}
return event.agentId.toLowerCase() === `agent-${issueId.toLowerCase()}`;
```

## Nits (advisory — safe to defer)

- `src/lib/cloister/specialist-context.ts:176` — `?` — Shell interpolation of `model` without escaping. Consider `shell-escape` or `execFile` for defense-in-depth. (correctness)
- `src/lib/cloister/specialist-context.ts:19-29` — `?` — Custom `execAsync` wrapper duplicates `promisify(exec)` behavior. Add a comment explaining why or revert to the standard library pattern. (correctness)
- `tests/unit/dashboard/server/routes/workspace-planning-markdown.test.ts` — `?` — Missing test for Rally-format issue IDs (e.g., `DE123`) in `getWorkspacePathForResolve`. (correctness)
- `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx:33` — `?` — Selector does per-render filter over `recentActivity`. Note: bounded at 50 entries, no action needed in this PR. (performance)

## Cross-cutting groups

**Dead props pollution in Zone C component hierarchy** (correctness):
- [high-1] Unused `issues` / `featureData` props declared in `ZoneCOverviewProps`
- [high-2] `ActivityFeed` no longer accepts those props (API changed in same PR)
- [nit-1] Tests still pass the dead props — should be cleaned up together

**Specialist context improvements** (correctness, out of scope for Zone C but in diff):
- [nit-2] `execAsync` wrapper divergence from `promisify(exec)`
- [nit-3] `model` shell interpolation without escaping

## What's good
- All 10 functional requirements implemented with code-level evidence in the diff
- Path traversal protection in `getWorkspacePathForIssue` is correctly implemented
- JSON parse hardening in `specialist-handoff-logger` prevents entire handoff log corruption on malformed lines
- Activity scoping by `issueId` works correctly with case-insensitive fallback to `agentId`
- Costs tab correctly shows aggregate data even when live WebSocket stream has transient error
- No blocking sync I/O introduced in new server code (`execAsync` / `fs/promises` used correctly)

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=5, security=0, performance=1, requirements=1
- Files touched: 18   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-866 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

