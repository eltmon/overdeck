---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T11:58:23Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 implements the Zone C-1 tab strip skeleton and Overview tab for the Command Deck. All 9 requirements are fully implemented and verified. However, 2 high-priority issues block merge: a keyboard accessibility regression where the `Tab` key traps users in the tab strip, and a hot-path performance concern where the Overview tab's 30-second polling cycle fetches heavyweight planning artifact bodies for a component that only uses lightweight metadata signals.

## Blockers (MUST fix before merge)

### 1. Tab key intercept blocks keyboard focus to tab panel — `ZoneCOverview.tsx:172-177` — `~`
**Raised by**: correctness
**Why it blocks**: The `Tab` key handler in the tab strip prevents focus from reaching the tab panel body or any interactive elements below it, trapping keyboard-only and screen-reader users in the tab strip. Arrow keys already provide full tab-strip navigation; `Tab` should let focus pass to the panel.

Pass `reviewStatus.data` directly to `isReviewPipelineStuck`. The function's `PipelineStateLike` type is already structurally compatible with `ReviewStatusData` — both have optional `reviewStatus`, `testStatus`, `mergeStatus`, `verificationStatus` fields with overlapping string literal types. The manual reconstruction with `as` casts is unnecessary:

```typescript
const isRecoverable = isReviewPipelineStuck(reviewStatus.data ?? undefined);
```

This works because `PipelineStateLike` already accepts all the string values that `ReviewStatusData` uses, and extra properties are harmlessly ignored by structural typing.

Remove the `Tab` key handler entirely. Arrow keys (`ArrowLeft`/`ArrowRight`) and `Home`/`End` already provide full tab-strip navigation. `Tab` should move focus to the first focusable element in the active tab panel, which the browser handles natively when `tabIndex` is set correctly (active tab has `tabIndex={0}`, others have `tabIndex={-1}`).

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Overview polling fetches full planning artifacts on every 30s refresh — `queries.ts:98, command-deck.ts:586` — `~`
**Raised by**: performance
**Why it blocks**: The default issue-selected view mounts `usePlanningQuery(issueId)` which polls the full `/api/command-deck/planning/:issueId` endpoint every 30 seconds. That route eagerly reads and serializes the full PRD, STATE, INFERENCE, transcript, discussion, and notes files. The Overview tab only uses lightweight signals (`planning.data?.prd`, `planning.isLoading`) but pays the full I/O and transfer cost every poll.

Impact: scales with artifact size, not data actually rendered. Large transcripts/discussions silently degrade default dashboard responsiveness.

Split planning data into two tiers:
1. A lightweight summary endpoint/query for Overview (`hasPrd`, `hasState`, `acceptanceProgress`, `stashCount`, `statusReviewedAt`).
2. The full artifact endpoint used only by heavyweight tabs (PRD / STATE / Discussions) when those tabs are actually opened.

Server-side direction (pseudocode):
```typescript
if (summaryMode) {
  return {
    hasPrd: Boolean(prdExists),
    hasState: Boolean(stateExists),
    acceptanceProgress,
    stashCount,
    statusReviewedAt,
  };
}
```

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:257-262` — `~` — Unsafe type narrowing with `as` casts on `isReviewPipelineStuck` input. The `as` casts suppress TypeScript error detection if `ReviewStatusData` changes upstream. Pass `reviewStatus.data` directly. (correctness)
- `queries.ts:90-96` — `?` — `fetchJson` returns `res.json()` without runtime validation. Acceptable for internal co-developed endpoints; runtime validation (e.g., zod) is a future improvement. (correctness)
- `OverviewTab.tsx:108-114` — `?` — `deriveStageFromSections` shows completed phase labels (e.g., "merge") even though that phase is done. Cosmetic — appending a "done" suffix is a future improvement. (correctness)

## Cross-cutting groups

**Type-safety and performance share a root cause in how the Overview tab consumes planning data** (queries.ts:98, OverviewTab.tsx:215): the tab mounts a heavyweight query even though it only needs a lightweight summary. Separately, the `isReviewPipelineStuck` type narrowing (OverviewTab.tsx:257-262) is a coincidental adjacent code pattern flagged by the same reviewer. Fix the performance tiering first; the type-safety fix is a one-liner that can land alongside it.

**Keyboard accessibility and tab navigation** (ZoneCOverview.tsx:172-177): the `Tab` key interception is unrelated to the performance finding but shares the same file. Both are fixable without touching the performance tiering.

## What's good
- All 9 requirements fully implemented with test coverage, including Playwright visual verification.
- Security review found zero vulnerabilities in the diff — existing endpoint CSRF posture is out of scope for this PR.
- Server route changes reuse existing endpoint families with no new placeholder-tab endpoints introduced.
- Unit test coverage for tab strip behavior, URL sync, keyboard navigation, and issue selection arbitration.

## Review stats
- Blockers: 0   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=2 (both ~), security=0, performance=1 (~), requirements=0
- Files touched: 12   Files with findings: 4

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

