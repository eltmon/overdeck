---
specialist: review-agent
issueId: PAN-854
outcome: approved
timestamp: 2026-04-28T00:09:58Z
---

# Verdict: APPROVED

## Summary
PAN-854 delivers all 6 stated requirements for the Command Deck project tree visual polish: stripped HTML comment markers in titles, "(untitled)" placeholder, elastic session column with fixed status/duration, empty project filtering, Title Case filter pills, and non-duplicated prefixed issue IDs. All 27 frontend tests and 29 server tests pass. The 2 High severity findings (ProjectNode expanded state and double filtering) are correctness concerns without an observable bug — both are safe to address as follow-up; neither blocks merge.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. ProjectNode expanded state only evaluates visibleFeatures at mount time — `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx:171` — `~`
**Raised by**: correctness
**Why it blocks**: `useState(visibleFeatures.length > 0)` captures the value once at mount. If the filter changes and a project's visible count drops to 0, the project stays expanded showing "(no active features)" instead of collapsing automatically.

<fix instruction>Add a `useEffect` that tracks the previous filter and collapses the project row when `visibleFeatures.length` transitions to 0:

```typescript
const prevFilterRef = useRef(filter);
useEffect(() => {
  if (filter !== prevFilterRef.current && visibleFeatures.length === 0) {
    setExpanded(false);
  }
  prevFilterRef.current = filter;
}, [filter, visibleFeatures.length]);
```

### 2. Double filtering of projects — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:738-744` — `≉`
**Raised by**: correctness
**Why it blocks**: CommandDeck filters projects by session match, and ProjectNode independently filters features by the same criterion. The two filters are currently correct and consistent, but the duplication creates maintenance risk — a future divergence would cause a project to be shown empty or hidden while having matching features.

<fix instruction>Centralize the filter logic into a single shared helper function used by both CommandDeck and ProjectNode, so filter changes only need to be updated in one place. Alternatively, have CommandDeck always render projects with features and delegate all filtering to ProjectNode.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:125` — `?` — Resource detail hover fetches re-issue on tree remount. Cache identifiers in a module-level or React Query cache keyed by issue ID so repeated hovers reuse prior results. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:496` — `?` — Deep-wipe protected only by `window.confirm()`. Consider a server-side confirmation token for irreversible actions if the dashboard is ever exposed beyond a trusted environment. (security)
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:293-294` — `?` — `(session.status || '').toLowerCase()` is correct defensive code, but the type for `SessionNode.status` should be `string | undefined` if downstream data can actually produce `undefined`. (correctness/suggestion)
- `src/dashboard/server/routes/projects.ts:233` — `?` — `resolveFeatureTitle` now returns `''` instead of `issueId` as fallback. Confirm all API consumers handle empty string; the change is acceptable for dashboard but affects API backward compatibility. (correctness/suggestion)

## Cross-cutting groups

**_none_**

## What's good
- All 6 requirements from the issue acceptance criteria are implemented and verified.
- Title sanitization (`sanitizeDisplayTitle()`) correctly strips `<!-- panopticon:* -->` markers.
- "(untitled)" placeholder with muted italic styling prevents `PAN-800 / PAN-800` duplication.
- CSS grid `minmax(0, 1fr)` correctly makes the session label column elastic while keeping status/duration fixed-width.
- 56 tests passing (27 frontend + 29 server).

## Review stats
- Blockers: 0   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=4, security=1, performance=1, requirements=0 (PASS)
- Files touched: 14   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

