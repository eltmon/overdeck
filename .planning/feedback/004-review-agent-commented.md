---
specialist: review-agent
issueId: PAN-895
outcome: commented
timestamp: 2026-04-28T00:52:43Z
---

# Verdict: APPROVED

## Summary

PAN-895 unifies cost display between Zone A and the Overview tile by introducing a shared `issue-cost-resolver.ts` service that returns `max(aggregateCost, liveCost)`. All 3 requirements are implemented and passing. Security is clean. Two HIGH-severity findings remain: the `normalizePositiveCost` zero-as-null behavior (cosmetic, deliberate design choice per correctness reviewer) and the `ZoneCOverview` unconditional full-planning fetch (performance regression on admin UI, not a hot path at scale). These are logged for follow-up but do not block merge. No blockers.

## High Priority (SHOULD fix; synthesis approves with advisory)

### 1. `normalizePositiveCost` treats exact-zero cost as null — `src/dashboard/server/services/issue-cost-resolver.ts:22` — `~`
**Raised by**: correctness
**Why it matters**: `value > 0` means `aggregateCost: 0` normalizes to `null`, hiding valid zero-cost displays and causing `resolvedTotalCost` to be `null` when there are no live agents.

**Fix**: Change `> 0` to `>= 0` in `normalizePositiveCost`, then adjust null checks in consumers if exact-zero display is needed. The correctness reviewer notes this is currently a deliberate UI design choice — suppress if intentional, otherwise fix.

### 2. `ZoneCOverview` fetches full planning payload on every issue-selected render — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:72` — `~`
**Raised by**: performance
**Why it matters**: `usePlanningQuery(issueId)` hits the heavyweight endpoint returning full PRD/STATE/INFERENCE plus transcripts/discussions/notes, just to compute `hasInference`. The PR introduced a lightweight `?summary=1` endpoint specifically for this — the optimization is partially negated.

**Fix**: Use `usePlanningSummaryQuery(issueId)` for tab visibility gating. Only load full planning when a content tab (prd/state/inference) is actually opened. If `hasInference` isn't yet on the summary response, add it there:

```typescript
const planningSummary = usePlanningSummaryQuery(issueId);
const shouldLoadFullPlanning = tab === 'prd' || tab === 'state' || tab === 'inference';
const planning = usePlanningQuery(issueId, { enabled: shouldLoadFullPlanning });
const hasInference = Boolean(planningSummary.data?.hasInference);
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:147` — `?` — Dead `|| false` in boolean expression. Remove the trailing `|| false`.
- `src/dashboard/server/services/issue-cost-resolver.ts:15` — `?` — `LIVE_AGENT_STATUSES` observation. No action needed — the set is correctly scoped.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/queries.ts:131-136` — `?` — `usePlanningSummaryWithOverridesQuery` options spread. Correctly typed with `Omit<..., 'queryKey' | 'queryFn'>` — no bug, no fix needed.

## Cross-cutting groups

**Lightweight summary endpoint under-utilized** (ZoneCOverview + IssueHeader could share summary path better):
- [high-2] `ZoneCOverview` full payload fetch on every issue-selected render
- [nit] `queries.ts` already provides `usePlanningSummaryQuery` — ensure all callers use the right query level for their needs

## What's good
- Shared `issue-cost-resolver.ts` cleanly centralizes `max(aggregateCost, liveCost)` with proper null handling
- Both server endpoints (command-deck activity + issues costs) now return the same `resolvedTotalCost` contract
- All 3 requirements verified as implemented — requirements reviewer PASS
- Security review: clean, no new attack surface introduced
- Test coverage for unified-cost behavior and empty-state suppression

## Review stats
- Blockers: 0   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=1, security=0, performance=1, requirements=0
- Files touched: 13   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

