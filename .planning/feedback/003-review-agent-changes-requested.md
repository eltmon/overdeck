---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T15:05:53Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 delivers the Zone C tab strip skeleton and Overview tab (billboard + tile grid + summaries + trend strip) for the Command Deck, restructures agent status normalization in `agent-status.ts`/`session-presence.ts`, and breaks a circular dep between `projects.ts` and `command-deck.ts`. The PR is partially complete: 7 of 9 acceptance criteria are fully met, but 3 MUST items remain — a guaranteed runtime crash on `/api/session-trees`, missing Tab/Shift-Tab keyboard navigation, and absent URL reflection of the default Overview tab. Security is clean. Fix the three blockers before merge.

## Blockers (MUST fix before merge)

### 1. `new URL(request.url)` without base URL throws TypeError on every request — `src/dashboard/server/routes/projects.ts:349` — `!`
**Raised by**: correctness, performance (confirmed no blocker in changed code but underlying URL parsing issue confirmed)
**Why it blocks**: The diff changed `new URL(request.url, 'http://localhost')` to `new URL(request.url)`. In Effect's HTTP server `request.url` is a relative path (e.g. `/api/session-trees?projects=foo,bar`). The `URL` constructor requires a base URL for relative paths — this throws `TypeError [ERR_INVALID_URL]` on every `GET /api/session-trees` call, completely breaking the session tree data pipeline.

**Fix:**
```typescript
const url = new URL(request.url, 'http://localhost');
```

### 2. Tab / Shift-Tab keyboard navigation is not implemented; tests assert the opposite — `src/dashboard/frontend/src/components/CommandDeck/__tests__/ZoneCOverview.test.tsx:373` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-8 explicitly requires "Keyboard nav works (arrow keys, Tab / Shift-Tab)". Arrow-left/right, Home/End are implemented, but Tab and Shift-Tab are not — and the existing test at line 373 explicitly asserts that Tab/Shift-Tab do NOT change tabs. The test must be updated to match the intended behavior once Tab/Shift-Tab is wired.

**Fix**: Implement Tab/Shift-Tab handling in the tab strip's keyboard handler in `ZoneCOverview.tsx`, then update the test to assert the correct behavior instead of the current assertion that Tab does nothing.

### 3. URL does not reflect the default active tab as `?tab=overview` — `src/dashboard/frontend/src/components/CommandDeck/IssueWorkbench.tsx:89` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-9 requires "URL reflects active tab (`?tab=overview`)". `activeTab` initializes from the URL at line 89 but never writes `overview` when absent; URL updates only occur inside `handleSwitchTab`. Users land on the Overview tab with no `tab` parameter in the URL, making the state non-routable and non-shareable as specified.

**Fix**: After initializing `activeTab` from the URL, if no `tab` param is present, update the URL to include `?tab=overview` (e.g. via `setURLSearchParams` or `navigate`).

## High Priority (SHOULD fix; blocks merge on hot paths)

### 1. Stash count cache sweep is gated behind cache-miss — `src/dashboard/server/routes/command-deck.ts:678-683` — `~`
**Raised by**: correctness, performance (same root cause)
**Why it blocks**: `sweepExpired()` is only called inside the cache-miss branch. When the same workspace is queried repeatedly within the TTL (60s), expired entries from *other* keys are never evicted. Compare with `costCache` at line 527 which calls `sweepExpired` unconditionally. On a hot overview page polled every 30s, stale entries accumulate from inactive workspaces.

**Fix**: Move `sweepExpired` before the cache check, or call it unconditionally like `costCache` does.

### 2. Git stash list polling on hot path spawns a child process every 60s — `src/dashboard/server/routes/command-deck.ts:673` — `~`
**Raised by**: performance
**Why it blocks**: The planning summary endpoint (`/api/command-deck/planning/:issueId?summary=1`) runs `git stash list` from the request handler when the 60s TTL expires. This endpoint is polled from the browser every 30s (`usePlanningSummaryQuery` at `queries.ts:104`). One open overview tab = one `git` process spawn per minute. N concurrent viewers = N processes per minute on the Node server.

**Fix**: Derive stash count from a longer-lived workspace snapshot refreshed only after stash-mutating actions, or compute lazily when the stash-specific UI is opened rather than on every polling request.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:202` — `?` — `formatRuntime` returns `"0m"` for sub-minute durations. Show seconds instead: `${secs}s` for < 60s.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:427` — `?` — Agent tile calls `formatRuntime` unconditionally inside `{agent ? ...}`; the metrics row guards with `{agent?.startedAt && (...)}`. Inconsistent but cosmetic.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:102-106` — `?` — Dead `useEffect` guard: `visibleTabs` is always `ALL_TABS` (a constant), so `if (visibleTabs.some(...)) return` always fires early.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/queries.ts:120-126` — `?` — Activity query with 5s refetch and `?summary=1` is acceptable for now but worth revisiting in PAN-866 if the session tree grows.
- `src/dashboard/server/routes/projects.ts:296` — `?` — `sessions` typed as mutable `SessionNode[]` but the rest of the tree uses `readonly SessionNode[]`. Align for consistency.
- `ZoneB.tsx:54`, `SessionNode.tsx:58`, `SessionPanel.tsx:40`, `OverviewTab.tsx:202` — `?` — Four separate `formatDuration`/`formatRuntime` implementations. Extract to a shared utility to reduce divergence risk.

## Cross-cutting groups

**Stash-count instrumentation on the polling path** (fix together):
- [high-1] Stash cache sweep only runs on cache miss — memory growth from stale entries
- [high-2] `git stash list` spawns on every polling request — process churn on hot path

## What's good
- Security review is clean — no injection sinks, auth bypasses, or unsafe HTML introduced.
- Circular dependency between `projects.ts` and `command-deck.ts` successfully broken.
- Agent status normalization centralized in `agent-status.ts` and `session-presence.ts` — good architectural move.
- 7 of 9 acceptance criteria fully implemented; the Overview tab billboard, tile grid, summaries, and trend strip are all wired to existing endpoints.
- Playwright visual verification in place (`pan-865-command-deck-overview.spec.ts`).

## Review stats
- Blockers: 3   High: 2   Medium: 0   Nits: 6
- By reviewer: correctness=4 (1 blocker, 3 high/nits), security=0 (clean), performance=2 (1 high, 1 optimization), requirements=2 (2 blockers)
- Files touched: 28   Files with findings: 10

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — critical runtime crash + 3 warnings + 4 suggestions
- `security.md` — clean, no findings
- `performance.md` — 1 warning (git stash polling) + 1 optimization (query fan-out)
- `requirements.md` — 7 implemented, 1 partial (Tab/Shift-Tab), 1 missing (?tab=overview URL)

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

