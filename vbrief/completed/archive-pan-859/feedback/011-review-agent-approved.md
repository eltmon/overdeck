---
specialist: review-agent
issueId: PAN-859
outcome: approved
timestamp: 2026-04-27T23:29:05Z
---

# Verdict: APPROVED

## Summary

PAN-859 fixes first-click terminal pane opening in the Command Deck by wiring session selection state through `selectedSessionByIssue` rather than through a closure over `selectedFeature`. All 4 stated requirements pass coverage review, security finds no issues, and correctness finds 1 SHOULD-level log-correlation warning. One performance SHOULD on the activity polling endpoint is not on a hot path and is advisory.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Activity polling re-reads every specialist task file on each request — `src/dashboard/server/routes/command-deck.ts:340` — `~`
**Raised by**: performance

The `fetchActivityDataWithContext()` helper scans `~/.panopticon/specialists/tasks/`, reads every `*.md` task file, and filters them for the current issue — each time the endpoint is polled. Per-request cost scales with global task volume, not the selected issue.

**Fix**: Cache parsed task-file contents across requests with a TTL/invalidation strategy, or index task files by issue once and reuse that index for subsequent polls.

## Nits (advisory — safe to defer)

- `src/lib/cloister/review-agent.ts:1389-1392` — `~` — `Date.now()` called twice with `await` between them; session name and log stem may have divergent timestamps. Capture once: `const ts = Date.now()` and reuse it for both. (correctness)
- `src/dashboard/server/routes/command-deck.ts:500` — `?` — `as never` cast bypasses TypeScript's type checking on `SpecialistType`. Use `as SpecialistType` or add an explicit type annotation on the `specialistType` variable. (correctness)
- `src/dashboard/server/routes/command-deck.ts:518` — `≉` — When `specialistIsLive === false`, status falls back to `ss.status` which may be stale `'running'` for a dead session. Minor discrepancy with `specialistPresence` which correctly shows `'ended'`. Noted for awareness — pre-existing pattern, not a regression. (correctness)
- `src/dashboard/server/services/resource-discovery.ts:544-551` — `?` — New filter widens discovery scope by removing the `resourceSources.size > 0` gate. Any tracker-tracked issue with `trackerState: 'in_progress'` now appears without local resources. Confirm this behavioral widening is the intended UX. (correctness)
- `src/dashboard/server/services/resource-discovery.ts:269` — `?` — Full `gh pr list` scan remains moderately expensive on cache refresh misses with many repos. Repo-level incremental caching would help at scale. (performance, optimization)

## Cross-cutting groups

_none_ — findings are isolated to individual files with no shared execution path.

## What's good
- All 4 PAN-859 requirements fully implemented with test coverage and Playwright verification artifacts.
- Security review finds no injection, authz, path traversal, secret exposure, or XSS issues across all changed files.
- Incremental parsing and batched stat calls in conversations route reduce fanout cost.
- New `specialistIsLive` tmux guard improves over prior code which didn't check session liveness at all.
- Deep-wipe wiring correctly gated behind explicit user confirmation in the UI.

## Review stats
- Blockers: 0   High: 1   Medium: 0   Nits: 5
- By reviewer: correctness=4 findings (1 warning, 3 suggestions), requirements=PASS, performance=2 findings (1 warning, 1 optimization), security=0
- Files touched: 11   Files with findings: 3 (command-deck.ts, review-agent.ts, resource-discovery.ts)

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

