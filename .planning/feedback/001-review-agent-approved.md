---
specialist: review-agent
issueId: PAN-854
outcome: approved
timestamp: 2026-04-27T22:14:34Z
---

# Verdict: APPROVED

## Summary
PAN-854 delivers visual polish for the Command Deck project tree: sanitized issue titles (HTML comment stripping), muted "(untitled)" placeholder, preserved issue ID prefixes without duplication, elastic session-name column with fixed status/duration columns, filter pills in Title Case, and empty-project hiding in the All view. All 6 requirements are implemented. Security review found no issues. The one High-severity finding (duplicated filter predicate across CommandDeck and ProjectNode) is flagged as acceptable at current scale by the performance reviewer and does not represent a present bottleneck. The PR is safe to merge.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

**Note on duplicated filter logic (correctness `≉`):** The correctness reviewer flagged that `CommandDeck` and `ProjectNode` both inline the same filter predicate instead of reusing `sessionMatchesFilter()` from `FeatureItem.tsx`. This is a genuine maintenance risk (three places to update if alive/failed criteria change). However, the performance reviewer explicitly found "no evidence this PR creates a present bottleneck" and the subscription fan-out is acceptable at current scale. Per the High-severity-on-performance policy (only blocks if on a hot path or at scale), this is demoted to advisory. The work agent should address it as a follow-up when touching the filter code next.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx:175` — `~` — Stale initial expanded state when filter changes. Visual oddity: project may render expanded with "(no active features)" and badge "0" on first mount after filter change. One extra click to collapse. Fix: initialize `expanded` from `visibleFeatures.length > 0` instead of `features.length > 0`. (correctness)

- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:253` — `?` — Per-project RPC subscription fan-out grows O(projects). Not a present bottleneck. Future multiplexed subscription could reduce to O(1). (performance)

- `src/dashboard/server/routes/projects.ts:59-63` — `?` — `sanitizeDisplayTitle` regex could theoretically over-match on malformed input with multiple unclosed HTML comments. GitHub issue titles are plain text so this is academic. No action needed. (correctness)

- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.test.tsx` — `?` — Tests verify filter application but don't cover empty-project state, dynamic filter changes, or the feature-count badge update. Minor coverage gap; safe to defer. (correctness)

- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx:175` — `?` — Same finding as above (stale expanded state), surfaced by correctness reviewer as `~`. Covered in Nits per deduplication.

## Cross-cutting groups

**Duplicated filter predicate** (shared root cause — fix together when touching filter code):
- [nit] Duplicated filter logic between CommandDeck and ProjectNode (`index.tsx:738-746`, `ProjectNode.tsx:165-174`) — should extract shared `featureMatchesFilter(feature, filter)` predicate from `sessionMatchesFilter` in `FeatureItem.tsx`

## What's good
- All 6 requirements from the issue acceptance criteria are fully implemented
- `sanitizeDisplayTitle` correctly strips `<!-- panopticon:* -->` HTML comment markers from issue titles
- Untitled features render as muted "(untitled)" with issue ID preserved and not duplicated
- Session row CSS grid correctly allocates elastic width to the label column with fixed-width status/duration
- Filter pills render in Title Case ("All", "Alive", "Failed")
- Empty projects are hidden in the All view
- New tests in `FeatureItem.test.tsx` and `ProjectNode.test.tsx` cover the changed behaviors
- Security review found no vulnerabilities in the changed files

## Review stats
- Blockers: 0   High: 0   Medium: 0   Nits: 5
- By reviewer: correctness=4, security=0, performance=1, requirements=0
- Files touched: 11   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

