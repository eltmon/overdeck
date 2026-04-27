---
specialist: review-agent
issueId: PAN-862
outcome: approved
timestamp: 2026-04-27T15:58:36Z
---

# Verdict: APPROVED

## Summary
PAN-862 extracts resource-discovery logic into a dedicated service module (`resource-discovery.ts`), adds a new `/api/issues/resource-allocated` endpoint that returns the union of all tracked and allocated issues, introduces a per-row resource icon strip in the Command Deck frontend, and adds a hover popover with concrete resource identifiers via `/api/issues/:id/resource-details`. All 8 requirements are implemented and verified. Four reviewers found zero blockers; findings are all medium/advisory severity.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `tests/unit/dashboard/server/services/resource-discovery.test.ts:28-42` — `?` Test data uses `ResourceDetailIdentifiers` fields inside `ResourceDetails` objects. TypeScript's structural subtyping allows this to compile even though production sanitization strips those fields. Use `ResourceDetailIdentifiers` fields only, or explicitly type test objects to match production shapes.

- `src/dashboard/server/services/resource-discovery.ts:449-455` — `?` Docker container name parsing uses `replace(/feature\//g, 'feature-')` which double-replaces if a path already contains `feature-`. Anchor the regex: `replace(/^feature\//, 'feature-')`.

- `src/dashboard/server/services/resource-discovery.ts:596` — `?` `refreshResourceAllocatedIssues()` nulls `resourceIssuesRefreshPromise` in `.finally()` even on rejection, meaning transient failures go unobserved. Add `console.warn` in the `.catch(() => {})` at line 609.

- `src/dashboard/server/routes/command-deck.ts:575` — `?` `sweepExpired` is called twice per cost cache miss (lines 561 and 575). Remove the redundant second call — the first already evict expired entries within milliseconds.

## Cross-cutting groups

_none_

## Security Notes (accepted risk — documented for audit trail)

**Internal infrastructure metadata in resource-details endpoint** (`issues.ts:3077`, `resource-discovery.ts:204`, `FeatureItem.tsx:133`): The new `GET /api/issues/:id/resource-details` endpoint returns concrete workspace paths, tmux session names, branch names, and Docker container names. Security correctly flags this as information disclosure of host topology. This is **accepted risk** — the endpoint exists solely to satisfy REQ-5 (hover popover lists concrete resources), which is an explicit requirement. The endpoint is gated behind dashboard authentication. No blocker.

## What's good
- All 8 requirements implemented and verified (requirements reviewer: PASS)
- No blockers, no high-severity findings across 4 independent reviewers
- 30s in-memory cache + refresh coalescing on hot path; batched session-tree fetch eliminates N+1
- Benchmark assertion (`< 1000ms`) wired into CI
- Playwright coverage added for the resource strip UI

## Review stats
- Blockers: 0   High: 0   Medium: 4   Nits: 4
- By reviewer: correctness=5, security=2, performance=0, requirements=0
- Files touched: 19   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

