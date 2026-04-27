---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T15:37:52Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 adds a 10-tab strip to Zone C of the Command Deck with an Overview tab that renders a billboard, tile grid, summaries, and a trend strip. The PR is a substantial and well-structured addition. However, 1 acceptance criterion is not satisfied — Tab/Shift-Tab keyboard navigation was specified but not implemented — and 3 high-priority correctness issues were found. The PR cannot merge until REQ-9 is resolved.

## Blockers (MUST fix before merge)

### 1. Tab/Shift-Tab keyboard navigation missing — `ZoneCOverview.tsx` — `!`
**Raised by**: requirements
**Why it blocks**: The issue acceptance criteria explicitly require "Tab / Shift-Tab" keyboard navigation, the implementation handles only Arrow keys/Home/End, and the tests explicitly assert that Tab/Shift-Tab are NOT intercepted — confirming the gap.

<fix instruction>
Implement Tab/Shift-Tab navigation in the tab strip in `ZoneCOverview.tsx`, then update the tests in `ZoneCOverview.test.tsx` to assert the correct behavior instead of asserting that Tab is not intercepted. If the product decision changed and Tab nav is intentionally deferred, update the issue acceptance criteria before merge.
</fix instruction>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Double PR ref resolution in `fetchIssuePullRequestDetails` — `issues.ts:2616` — `~`
**Raised by**: correctness
**Why it blocks**: `fetchIssuePullRequestDetails` calls `resolveIssuePullRequestRef` to get `prRef`, then calls `fetchIssuePullRequest(issueId)` which internally calls `resolveIssuePullRequestRef` again — making a second redundant `gh pr list` subprocess call and creating a race condition where metadata and diff could come from different PRs if the PR changes between calls.

<fix instruction>
In `fetchIssuePullRequestDetails`, after resolving `prRef`, inline the `gh pr view` call directly rather than calling `fetchIssuePullRequest(issueId)`. The `fetchIssuePullRequestDiffFromRef` already takes `prRef` directly. Use `Promise.all` with the inlined `gh pr view` call and `fetchIssuePullRequestDiffFromRef(prRef)` — as shown in the reviewer-provided code sketch at `issues.ts:2616-2632`.
</fix instruction>

### 2. Dead URL initialization code in `ZoneCOverview` — `ZoneCOverview.tsx:55-62` — `~`
**Raised by**: correctness
**Why it blocks**: `ZoneCOverview.getInitialTab()` reads `window.location.search` but `activeTab` is always provided by the parent `IssueWorkbench`, making the internal tab state initialization dead code. This is confusion rather than a functional bug, but it indicates the component's dual controlled/uncontrolled contract is unclear.

<fix instruction>
Remove the URL initialization from `ZoneCOverview.getInitialTab()` since `activeTab` is always controlled by the parent, or explicitly document that the component supports both controlled and uncontrolled modes.
</fix instruction>

### 3. `buildIssueTitleMap` rebuilds unbounded Map on every session-trees request — `projects.ts:253` — `~`
**Raised by**: correctness, performance
**Why it blocks**: `buildIssueTitleMap()` walks the full in-memory issue list for every `GET /api/session-trees` request. At larger tracker sizes this is O(all issues) per poll cycle. The correctness reviewer notes this is in a request handler so it is GC'd after each response — acceptable at current scale, but a growth risk.

<fix instruction>
Consider adding a TTL cache for the title map (similar to the existing stash count cache), or lazy-build it only for projects that have active sessions. Low priority — safe to defer to a follow-up if issue count is still small.
</fix instruction>

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:421-427` — `?` — Action buttons fire-and-forget POST requests without user feedback. The "Review & Test", "Sync", and "Stop" buttons silently swallow errors with no loading indicator or success/error toast. Consider adding a pending state for consistency with "Spawn Work". (correctness)
- `ZoneB.tsx:54` — `?` — `formatDuration` null check uses `?? NaN` pattern unnecessarily — `!Number.isFinite(null)` is already `true`, so the `?? NaN` is redundant. Simpler: `if (!Number.isFinite(seconds) || !seconds || seconds <= 0)`. (correctness)
- `OverviewTab.tsx:490` — `?` — Destructured `stageName` in byStage map callback. Not a bug; mentioned for readability awareness only. No action needed. (correctness)
- `agent-status.ts:16-17` — `?` — `completed`, `passed`, `merged` all normalize to `stopped`, losing semantic distinction. Design choice; worth documenting if downstream consumers may need to distinguish `merged` from `suspended`. (correctness)
- `projects.ts:125` — `?` — Legacy planning fallback node gets epoch `startedAt` on stat failure, making it instantly stale (24h threshold). Benign — the filter works correctly. No action needed. (correctness)
- `projects.ts:253` — `?` — Same as high-3 above. (performance)

## Cross-cutting groups

**PR resolution redundancy** (all stem from `fetchIssuePullRequestDetails` calling `resolveIssuePullRequestRef` twice):
- [high-1] Double PR ref resolution in `fetchIssuePullRequestDetails`

**URL sync ambiguity** (both stem from dual controlled/uncontrolled tab state):
- [high-2] Dead URL initialization in `ZoneCOverview`
- [nit-1] Fire-and-forget action buttons lack feedback

## What's good
- PR is a large, well-structured refactor with proper error handling throughout
- Security review found zero vulnerabilities introduced by these changes
- Performance materially improved on Command Deck hot path: lightweight summary endpoints for 5s polling, batched session-tree fetches, virtualized PR diffs
- Requirements coverage is 8/9 with only Tab/Shift-Tab nav outstanding
- All four Playwright snapshots and unit tests in `ZoneCOverview.test.tsx` and `IssueWorkbench.test.tsx` provide solid coverage for shipped behavior

## Review stats
- Blockers: 1   High: 3   Medium: 0   Nits: 6
- By reviewer: correctness=8, security=0, performance=2, requirements=1
- Files touched: 33   Files with findings: 12

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

