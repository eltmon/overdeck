---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T10:36:06Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 implements the Zone C Overview tab for the Command Deck issue-selected mode, including a 10-tab strip (Overview + 9 placeholders), URL routing, keyboard navigation, a billboard/tile-grid body, and a batched session-tree server route. All 9 requirements pass. Four high-priority findings must be addressed before merge: a user-visible broken-link bug in service rendering, and three architectural issues in the session-tree polling path that cause unnecessary I/O and subprocess churn on a hot 10-second endpoint.

## High Priority (SHOULD fix before merge)

### 1. Service links render `href="undefined"` when `svc.url` is missing — `~`
**Raised by**: correctness
**Location**: `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:519`
**Why it matters**: When a workspace service has no `url` bound (e.g., a container not yet port-mapped), the anchor renders `href="undefined"`, creating a clickable link to the literal string `"undefined"` as a relative URL. This is a user-visible regression on any such workspace.

Fix — filter out services without URLs before rendering anchors:
```tsx
{workspace.data.services.filter(svc => svc.url).map((svc) => (
  <a key={svc.name} href={svc.url!} target="_blank" rel="noopener noreferrer">
    {svc.name} ↗
  </a>
))}
```
Or render the service name as plain text when `url` is absent.

### 2. Session-tree polling re-fetches full activity including transcript capture — `~`
**Raised by**: performance
**Location**: `src/dashboard/server/routes/projects.ts:235`
**Why it matters**: The new `/api/session-trees` bulk endpoint calls `fetchActivityDataWithContext()` for each project, which captures up to 500 tmux pane lines per session via `capturePaneAsync()`, reads `output.log`, and resolves JSONL paths — all on a 10-second polling cadence. The session-tree UI only needs presence/status/session identity; transcript capture is redundant I/O and subprocess work multiplied across every active workspace.

Fix — split the route onto a metadata-only session-tree path that collects only the fields the tree renders (`sessionId`, `type`, `role`, `startedAt`, `endedAt`, `presence`, `status`, optional `roundMetadata`). Defer transcript/log capture to the detail views that render transcript content.

### 3. Session-tree route rescans specialist task files once per project in the same request — `~`
**Raised by**: performance
**Location**: `src/dashboard/server/routes/projects.ts:189–196` and `projects.ts:276–283`
**Why it matters**: `GET /api/session-trees` fans out with `Promise.all(projectKeys.map(fetchProjectSessionTree))`. Each `fetchProjectSessionTree()` independently reads `~/.panopticon/specialists/tasks` and iterates every `*.md` file. A single bulk request for N projects repeats the same full task-directory scan N times. With many projects and accumulated task files, every 10s sidebar poll multiplies identical disk I/O by the project count.

Fix — hoist task-file loading to the `/api/session-trees` route handler once per HTTP request (just like the already-hoisted tmux session-name set), then pass the shared `sharedTaskFileContents` map into each `fetchProjectSessionTree()` call.

### 4. `handleTabClick` pushes history state in both controlled and uncontrolled modes — `~`
**Raised by**: correctness
**Location**: `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:118`
**Why it matters**: `handleTabClick` unconditionally calls `window.history.pushState` even when `activeTab` is provided (controlled mode). If the parent rejects the `onTabChange` callback, the URL diverges from the displayed tab. PAN-866 adds controlled tab switching, which will surface this inconsistency.

Fix — gate URL push on uncontrolled mode:
```typescript
const handleTabClick = (next: OverviewTab) => {
  if (onTabChange) onTabChange(next);
  else setInternalTab(next);

  if (!activeTab) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', next);
    window.history.pushState(window.history.state, '', nextUrl);
  }
};
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:258` — `?` — Type assertion includes impossible `undefined` variant in `isReviewPipelineStuck` call. Remove `| undefined` from the non-optional `reviewStatus`/`testStatus` fields for accurate type narrowing. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:59` — `?` — `pickBestSession()` sorts the entire array just to return one element. A single-pass scan would be O(n) instead of O(n log n). Minor since session lists are small. (performance)

## Cross-cutting groups

**Session-tree polling inefficiency** (same `/api/session-trees` endpoint, same hot 10s poll):
- [high-2] Transcript capture on metadata-only polling route
- [high-3] Per-project repeated task-directory scans
Both stem from the new bulk tree endpoint reusing paths designed for transcript-detail views. Fix together by hoisting shared reads and splitting metadata vs. transcript capture.

## What's good
- All 9 requirements implemented and verified; requirements reviewer passes with zero missing items.
- Clean separation of concerns: issue-selected vs. agent-selected arbitration is correct and tested.
- Keyboard navigation (arrow keys, Home/End, Tab/Shift-Tab pass-through) is properly wired.
- Security reviewer found no injection, auth bypass, or XSS regressions.
- Server-side Effect 3.x API migration (`HttpRouter.request` → `HttpServerRequest`) is correctly applied.

## Review stats
- Blockers: 0   High: 4   Medium: 0   Nits: 2
- By reviewer: correctness=3 (1 high, 2 nits), security=0, performance=3 (2 high, 1 nit), requirements=0
- Files touched: 13   Files with findings: 4

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

