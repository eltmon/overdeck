---
specialist: review-agent
issueId: PAN-854
outcome: commented
timestamp: 2026-04-27T23:33:04Z
---

# Verdict: APPROVED

## Summary

PAN-854 delivers 6 visual polish features for the Command Deck project tree: title sanitization stripping orchestration HTML comment markers, a muted `(untitled)` placeholder for empty titles, non-duplicated issue ID rendering, elastic session-name column with fixed status/duration columns, empty-project suppression in the All view, and Title Case filter pills. All 6 requirements verified implemented by the requirements reviewer. Security review found no issues. Correctness review found only 4 advisory nits. One performance warning was identified (unbounded concurrent project scans); it has been demoted to advisory per policy because the route fires once on dashboard load and is not a hot path.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/conversations.ts:340` — `?` — Unreachable `return { ok: false, error: 'Missing origin' }` after an early-return block that always returns. After the guard at line 314 (both origin and referer absent → early return), at least one of `origin` or `referer` is truthy, and both subsequent `if` blocks (lines 323, 332) always return. Remove the unreachable final return. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:6-7` — `?` — Duplicate imports from same module (`'./ProjectTree/FeatureItem'`). Merge into single import: `import { sessionMatchesFilter, type TreeSessionFilter } from './ProjectTree/FeatureItem'`. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:294,299` — `?` — Inconsistent `status` null-guarding: `isErrorSession`/`isQueuedSession` use direct `.toLowerCase()` access while `sessionMatchesFilter` uses defensive `(session.status || '').toLowerCase()`. The schema defines `status` as required so direct access is safe, but consistency is preferable. Not introduced by this PR. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx:171` — `?` — `expanded` state initialized with `useState(features.length > 0)` but `visibleFeatures` (filtered) is used for rendering. A project can render expanded showing "0" when the filter hides all features. Use `visibleFeatures.length > 0` for initialization. Not introduced by this PR. (correctness)

## Advisory: Performance Observation

- `src/dashboard/server/routes/projects.ts:384` — `~` — Unbounded `Promise.all` across project keys in `GET /api/session-trees` fans out all project scans concurrently with no concurrency cap. Each `fetchProjectSessionTree()` can recurse through workspaces, stat directories, and inspect agent state; 30–50 projects means 30–50 concurrent full tree scans. **Demoted to advisory**: this route fires once on dashboard load (not a hot path), inner per-feature work is already throttled with `withConcurrencyLimit(..., 15)`, and scaling pressure is bounded by the project's internal limits. Recommend wrapping the outer `projectKeys.map(...)` in a concurrency limiter in a future iteration. (performance)

## Cross-cutting groups

_none_

## What's good
- All 6 requirements from the issue acceptance criteria are implemented and verified.
- Security review found zero issues across all changed frontend components and server routes.
- `sanitizeDisplayTitle()` uses non-greedy regex and correctly returns `''` (not the issue ID) for untitled features, letting the frontend render the `(untitled)` placeholder.
- `visibleFeatures` memo correctly uses `sessionMatchesFilter` for alive/failed filtering with complete dependencies.
- CSS popover fix correctly restores pointer-events on `.featureResourcePopover` and removes the wildcard suppression rule.

## Review stats
- Blockers: 0   High: 0   Medium: 0   Nits: 4   Advisory: 1
- By reviewer: correctness=4, security=0, performance=1, requirements=0
- Files touched: 12   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

