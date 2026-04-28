---
specialist: review-agent
issueId: PAN-895
outcome: changes-requested
timestamp: 2026-04-28T01:24:42Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-895 unifies cost display across Zone A and the Overview tile by introducing a shared `issue-cost-resolver` service, a TTL-based `running-agents-cache`, relaxed CSRF for safe-reads, and split planning queries. All 4 stated requirements pass. However, 1 critical regression on a hot path and 2 high-priority findings must be resolved before merge. The summary endpoint at `command-deck.ts:686` now reads full artifact contents on every 30s poll instead of just counts — a critical performance regression that affects all dashboard users on the issue-selected view.

## Blockers (MUST fix before merge)

### 1. Summary endpoint reads full artifact contents on every poll — `src/dashboard/server/routes/command-deck.ts:686` — `!`
**Raised by**: performance
**Why it blocks**: The `/api/command-deck/planning/:issueId?summary=1` route (polled every 30s by all dashboard issue-selected views) reads the full contents of every transcript, discussion, and note file before checking `summaryOnly`, then returns only counts. This is an O(total bytes) operation instead of O(file count) on a hot path.

<fix instruction>
In `fetchPlanningData()`, move the `summaryOnly` check before `readArtifactDir()` calls. For `summaryOnly`, call a new `listArtifactFiles(dir)` helper that returns only filenames and stat metadata — no file content reads. The returned shape for `summaryOnly` remains `{ transcriptCount, discussionCount, noteCount, hasPrd, hasState, hasInference, acceptanceProgress, statusReviewedAt }`. Do not read file bodies when `summaryOnly === true`.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. OverviewTab cost fallback ignores null from costs endpoint — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:226-229` — `~`
**Raised by**: correctness
<fix instruction>
Change the `!== undefined` check to null-aware coalescing so that an explicit `null` from the costs endpoint falls through to the activity endpoint:
```typescript
const costFromIssues = costs.data?.resolvedTotalCost;
const costFromActivity = !activity.isLoading ? activity.data?.resolvedTotalCost : undefined;
const totalCost = costFromIssues ?? costFromActivity ?? null;
```
If the current behavior is intentional, add a comment explaining that the costs endpoint is authoritative and null means "no data available."
</fix>

### 2. Header eagerly fetches full planning payload to show artifact buttons — `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:143` — `~`
**Raised by**: performance
<fix instruction>
Keep the header on summary data only. The `usePlanningQuery` (full payload) should only be triggered when the user opens a tab or modal that needs artifact bodies, not simply because a transcript/discussion/note exists. The `shouldLoadPlanningDetail` gate can be removed and replaced with a lazy-load trigger in the artifact viewer.
</fix>

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/conversations.ts:340` — `?` — Unreachable return statement in `validateOrigin`. The `!origin && !referer` early return at line 314 makes the final `return { ok: false, error: 'Missing origin' }` dead code. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:153` — `?` — Unsafe type cast from `ReviewStatusData` to `ReviewStatus`. The cast widens the type; if `deriveStageStatuses` or `isReviewPipelineStuck` access `ReviewStatus`-specific fields, it breaks silently. Use `ReviewStatusData` directly or add a comment explaining why the cast is safe. (correctness)
- `src/dashboard/server/routes/command-deck.ts:125` — `?` — Extra blank line introduced between `setProjectPathCache` and `getProjectPath`. Whitespace cleanup. (correctness)

## Cross-cutting groups

**Running agents cache deduplication** (related findings — same file, same root cause):
- [high-1] correctness/warning-2: concurrent cache misses cause redundant `listRunningAgentsAsync` calls
- [optimization] performance: cache misses not coalesced

Both point to the same missing Promise-level deduplication in `running-agents-cache.ts:20-34`. Fix once, resolves both.

## What's good

- `issue-cost-resolver.ts` cleanly centralizes max(aggregate, liveAgentCost) resolution and correctly returns null for zero/negative costs.
- All 4 stated acceptance criteria from PAN-895 are implemented and verified — both Zone A and Overview tile now consume the same `resolvedTotalCost` value.
- `running-agents-cache.ts` TTL + sweep pattern is sound; the deduplication issue is the only gap.
- CSRF relaxation for GET/HEAD is correct — browsers omit `Origin` on same-origin navigations.
- `syncCache()` removal in `issues.ts` is safe — `getCostsForIssue()` calls it internally.

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=2 warnings + 3 suggestions, security=0, performance=1 critical + 1 warning, requirements=PASS (4/4)
- Files touched: 17   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-895 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

