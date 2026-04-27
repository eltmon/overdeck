---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T12:55:10Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 implements the Zone C-1 tab strip skeleton and Overview tab (billboard + tile grid) for the Command Deck. All 9 requirements are implemented and verified. However, 2 type-safety errors in `projects.ts` will fail strict TypeScript compilation: an `ActivityContext` object literal with excess properties (guaranteed type error), and a `ReviewerNode.status` type mismatch (incompatible string vs. union). Both are reachable, unguarded code paths. Fix them and the PR is ready to merge.

## Blockers (MUST fix before merge)

### 1. `ActivityContext` excess properties — guaranteed TypeScript compile error — `projects.ts:375-379` — `!`
**Raised by**: correctness
**Why it blocks**: The local `ActivityContext` interface declares only `tmuxSessionNames`, but the object literal at line 375-379 also passes `taskFileContents` and `includeTranscripts`. Strict TypeScript rejects this with "Object literal may only specify known properties". Additionally, the entire task-file scan (lines 365-373) is dead code — it reads disk but the result is silently discarded since `collectSessionTreeNodes` only uses `tmuxSessionNames`.

Fix by extending the `ActivityContext` interface:
```typescript
interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  taskFileContents?: Map<string, string>;
  includeTranscripts?: boolean;
}
```
Or remove the dead task-file scan and excess properties if `collectSessionTreeNodes` does not need them.

### 2. `ReviewerNode.status` type mismatch — TypeScript error — `projects.ts:208` — `~`
**Raised by**: correctness
**Why it blocks**: `buildReviewerNodes` returns objects with `status: string`, but `SessionNode.status` is the union `"error" | "starting" | "running" | "stopped" | "unknown"`. The spread at line 208 fails type checking. This pattern was copied from `command-deck.ts` (where `reviewer-tree.ts` also uses `string`); the new code in `projects.ts` surfaces it. Runtime values happen to match the union, but this is type-unsafe.

Fix: cast `reviewerNodes` or update `buildReviewerNodes` to return properly typed `SessionNode` objects.

## High Priority (SHOULD fix; advisory here since non-hot-path UI)

### 1. Spawn agent POST silently swallows errors — `OverviewTab.tsx:447-458` — `~`
**Raised by**: correctness
User clicks "Spawn Work" and sees "Spawning..." but gets no feedback if the POST fails (422 beads enforcement, network error, server error). Button re-enables with no indication of outcome.

Fix: show inline error on failure, or at minimum toggle a brief error state on the button.

### 2. Review trigger POST ignores response — `OverviewTab.tsx:625-629` — `~`
**Raised by**: correctness
`POST /api/review/${issueId}/trigger` uses `.catch(() => {})` — even a 4xx/5xx is silently discarded. If review is already in progress (409), user sees no feedback.

Fix: check response status and show appropriate feedback.

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:523-529` — `≉` — Services tile uses `svc.url!` non-null assertion after filter. Works but fragile if type changes. Remove assertion by narrowing differently.
- `command-deck.ts:87-90` — `≉` — TTL caches (`costCache`, `stashCountCache`, `closedIssuesCache`) grow unbounded between sweep cycles. Pattern is fragile. Low severity.
- `projects.ts:159-161` — `~` — Legacy planning section checks for `.planning/` directory existence instead of `STATE.md` specifically, producing spurious "legacy" nodes. Compare with correct `command-deck.ts:330-331` pattern.
- `OverviewTab.tsx:908-909` — `≉` — Boolean OR chains for test status may mask partial states (testStatus vs. verificationStatus). Low probability of user confusion.
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:241` — `~` — `session_added` delta refetches all project trees instead of just the affected one. Scales with project count. Admin-only path.
- `src/dashboard/server/routes/command-deck.ts:1310` — `?` — Closed-issue hydration scales linearly with repo count on cold cache. 2-minute TTL mitigates. Admin-only path.
- `OverviewTab.tsx` — `?` — ~300 lines of inline `style={{}}` objects create GC pressure on every render. Extract to CSS modules.
- `ZoneCOverview.tsx:99` — `?` — `visibleTabs` always equals `ALL_TABS`; variable is unnecessary.
- `projects.ts:365-373` — `?` — Dead code: task-file scan builds `sharedTaskFileContents` map never consumed. Eliminable disk I/O on every `/api/session-trees` request.

## Cross-cutting groups

**Type-safety debt in session-tree routes** (same execution path, same fix-upstream opportunity):
- [blocker-1] `ActivityContext` excess properties in `projects.ts`
- [blocker-2] `ReviewerNode.status` type mismatch in `projects.ts` (copied from `reviewer-tree.ts`)
- [nit-9] Dead task-file scan at `projects.ts:365-373` — dead code that accompanies blocker-1

**User feedback on write actions** (both are silent `.catch(() => {})` patterns):
- [high-1] Spawn agent button swallows errors silently
- [high-2] Review trigger button ignores response

## What's good
- All 9 requirements traced end-to-end with test coverage and Playwright visual verification
- Security review: zero findings; data exposure is reduced, not widened
- Tab strip keyboard nav (ArrowLeft/Right, Home/End) implemented correctly without intercepting Tab/Shift-Tab
- URL-backed tab state with popstate hydration implemented correctly
- Session tree batching in `projects.ts` avoids per-project waterfalls

## Review stats
- Blockers: 2   High: 2   Medium: 0   Nits: 7
- By reviewer: correctness=10, security=0, performance=2, requirements=0
- Files touched: 14   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — 1 critical (blocker), 6 warnings, 3 suggestions
- `security.md` — 0 findings
- `requirements.md` — 0 missing; all 9 requirements PASS
- `performance.md` — 1 warning, 1 optimization

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

