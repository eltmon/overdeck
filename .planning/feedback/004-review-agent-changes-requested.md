---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T15:21:12Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 delivers the Zone C-1 tab strip skeleton and Overview tab (billboard + tile grid) with all 9 stated requirements implemented and verified. The PR adds session-tree routes, reviewer-tree building, session-presence normalization, and cost TTL caching on the server side, plus the frontend tab strip, Overview body, and supporting components. Security review is clean. However, two correctness findings (one accessibility, one anti-pattern) and two performance findings must be addressed before merge.

## Blockers (MUST fix before merge)

### 1. Tab/Shift+Tab keyboard focus trap — `ZoneCOverview.tsx:135-145` — `~`
**Raised by**: correctness
**Why it blocks**: The `onKeyDown` handler intercepts `Tab` and `Shift+Tab` to switch tabs, trapping keyboard focus inside the tab strip and preventing navigation into the tabpanel content. Per WAI-ARIA Authoring Practices, Tab/Shift+Tab must move focus to/from focusable elements outside the tablist — ArrowLeft/ArrowRight/Home/End already provide full intra-tablist navigation. This is an accessibility violation that blocks keyboard-only users.

**Fix**: Remove the `|| (event.key === 'Tab' && ...)` conditions from both handlers. Leave only ArrowLeft/ArrowRight (plus the existing Home/End handlers) for tab switching:

```typescript
if (event.key === 'ArrowRight') {
  event.preventDefault();
  const next = visibleTabs[(currentIndex + 1) % visibleTabs.length]?.key;
  if (next) moveTabFocus(next);
}
if (event.key === 'ArrowLeft') {
  event.preventDefault();
  const next = visibleTabs[(currentIndex - 1 + visibleTabs.length) % visibleTabs.length]?.key;
  if (next) moveTabFocus(next);
}
```

Also remove or update the test at `ZoneCOverview.test.tsx:373-384` (`'supports Tab and Shift-Tab navigation inside the tab strip'`) — Tab should no longer switch tabs once the interception is removed.

### 2. `isNaN()` vs `Number.isNaN()` inconsistency — `command-deck.ts:283,442` — `≉`
**Raised by**: correctness
**Why it blocks**: The legacy `isNaN(ms)` is used in two places while the new PR correctly uses `Number.isNaN(ms)` in `projects.ts:120`. `isNaN()` coerces its argument to Number first, making it inconsistent with the rest of the PR's type-aware code and setting a bad precedent for copy-paste into contexts where input may not be a number.

**Fix**: Replace `isNaN(ms)` with `Number.isNaN(ms)` at `command-deck.ts:283` and `command-deck.ts:442`.

## High Priority (SHOULD fix)

### 1. Issue title map rebuilt once per project per request — `projects.ts:252,297,368` — `~`
**Raised by**: performance
**Why it blocks**: `buildIssueTitleMap()` is called inside `fetchProjectSessionTree()`, and `fetchProjectSessionTree()` is called once per project via `Promise.all` in the bulk endpoint. This makes request cost scale as **O(projects × totalIssues)** instead of **O(totalIssues)** — one `/api/session-trees` bulk request performs a full issue-list scan for every selected project.

**Fix**: Build the title map once in the bulk `/api/session-trees` handler and pass it through shared context to each `fetchProjectSessionTree()` invocation. The per-project route (`/api/projects/:key/session-tree`) can keep its own per-call builder for standalone requests.

### 2. PR metadata and diff queries repeat PR-resolution subprocess — `issues.ts:2522,2559,2584` — `~`
**Raised by**: performance
**Why it blocks**: `PrDiffTab` mounts `usePrQuery()` and `usePrDiffQuery()` together. Each independently calls `resolveIssuePullRequestRef()`, which shells out to `gh pr list`. Opening the PR/Diff tab therefore runs two identical `gh pr list` subprocesses before the actual `gh pr view` and `gh pr diff`.

**Fix**: Expose a single endpoint (or cache the resolved PR number for the duration of the tab session) so that the PR number is resolved once and shared between the metadata and diff queries.

## Nits (advisory — safe to defer)

- `ZoneCOverviewTabs/OverviewTab.tsx:453-463` — `?` — Spawn Work button silently swallows errors. Consider surfacing a brief error state or toast on failure. (correctness)
- `command-deck.ts:79` — `?` — `projectPathCache` Map grows without eviction. Consider adding TTL-based sweep like the other caches (`costCache`, `closedIssuesCache`, `stashCountCache`). (correctness)

## Cross-cutting groups

**Keyboard accessibility + test consistency** (fix together):
- [blocker-1] Tab/Shift+Tab interception blocks keyboard users — `ZoneCOverview.tsx:135-145`
- [blocker-1] Test at `ZoneCOverview.test.tsx:373-384` verifies the intercepted behavior — must be updated alongside the fix

**Session tree efficiency** (fix together):
- [high-1] Issue title map rebuilt per project per request — `projects.ts:252,297,368`
- [high-2] Duplicate PR resolution subprocess — `issues.ts:2522,2559,2584` + `PrDiffTab.tsx:97`

**Code consistency** (fix together):
- [blocker-2] `isNaN()` at `command-deck.ts:283,442` — replace with `Number.isNaN()`
- [nit-2] `projectPathCache` lacks TTL eviction like sibling caches — `command-deck.ts:79`

## What's good
- All 9 stated requirements for PAN-865 are implemented and verified pass by the requirements reviewer.
- Security review found zero issues — no injection, authz, or data-exposure problems in changed code.
- No blocking sync FS calls introduced in server code paths (verified by correctness reviewer).
- Session tree refactor removes per-feature `allIssues.find()` scan in favor of bulk `buildIssueTitleMap()`.
- Playwright visual verification with snapshot artifact included.

## Review stats
- Blockers: 2   High: 2   Medium: 0   Nits: 2
- By reviewer: correctness=4, security=0, performance=2, requirements=0
- Files touched: 27   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

