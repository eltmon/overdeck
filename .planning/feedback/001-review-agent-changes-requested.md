---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T11:50:21Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 adds a Zone C tab strip with a sticky 10-tab shell and an Overview tab surface (billboard, tile grid, summaries, trend strip) to the Command Deck. The PR is structurally sound and well-tested — 7 of 9 acceptance criteria are fully implemented. Two findings block merge: (1) the AGENT tile's **Spawn Work** button calls a non-existent endpoint (`POST /api/agents/start` does not exist in the changed routes), making the primary CTA in the Overview surface non-functional; (2) keyboard navigation covers arrow keys but Tab/Shift-Tab is explicitly mentioned in the issue and not implemented. The work agent must wire the button to a working endpoint and decide whether to implement Tab/Shift-Tab or align the spec wording.

## Blockers (MUST fix before merge)

### 1. Spawn Work button calls non-existent endpoint — `OverviewTab.tsx:452-457` — `!`
**Raised by**: requirements
**Why it blocks**: The AGENT tile's "Spawn Work" button fires `POST /api/agents/start`, but no such route exists in the changed server code (`agents.ts` only exposes `POST /api/agents`). The button is wired but non-functional — the core spawn-work behavior requested in the issue scope is not delivered.

Fix: Change the fetch URL to target an existing route. If the intent is to use `POST /api/agents` (the start-agent route), update the URL to `/api/agents` and ensure the request body matches the route's expected schema. If the route was renamed or moved, find the correct path.

### 2. Tab/Shift-Tab keyboard navigation not implemented — `ZoneCOverview.tsx:156-183` — `~`
**Raised by**: requirements
**Why it blocks**: The issue text explicitly lists Tab/Shift-Tab as part of the required keyboard navigation behavior. The implementation provides arrow keys, Home/End, and standard browser tab behavior (keys pass through without navigating the strip). The test explicitly asserts Tab/Shift-Tab leaves the active tab unchanged rather than roving the focus. This is a partial implementation of a stated requirement.

Fix: Either implement roving-tabindex behavior for the tab strip so Tab/Shift-Tab moves focus between tabs, or (if standard browser tab behavior was the intent) update the issue/spec wording to remove "Tab/Shift-Tab" from the requirement text and simplify the test.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Planning poll shells out to git on every refresh — `command-deck.ts:681` — `~`
**Raised by**: performance
**Why it blocks**: `fetchPlanningData()` runs `git stash list` synchronously every time `/api/command-deck/planning/:issueId` is called, and the frontend polls this endpoint every 30 seconds. This creates repeated child-process churn on an admin/dashboard path.

Fix: Cache `stashCount` server-side with a TTL (e.g. 60s) similar to the existing `costCache`, or move stash count to a workspace-status endpoint that refreshes on demand rather than on every poll.

## Nits (advisory — safe to defer)

- `ZoneCOverview.tsx:101-108` — `~` — URL sync effect relies on `window.location` reads inside useEffect with a guard. The guard makes it correct; flagging as SHOULD for awareness. Not a blocker. (correctness)
- `OverviewTab.tsx:257-262` — `~` — Type assertion widening: `ReviewStatusData` fields are `string` but are cast to specific unions without runtime validation. `isReviewPipelineStuck` handles unknown values safely (returns false). Safe but a code smell — consider updating `ReviewStatusData` to use union types. (correctness)
- `index.tsx:198` — `?` — Removed `refetchInterval` from session-trees query. WebSocket delta subscription handles updates; a modest `refetchInterval: 30000` would guard against reconnection gaps. (correctness)
- `OverviewTab.tsx:452-457` — `?` — Fire-and-forget POST swallows all errors silently. Consistent with existing codebase patterns (lines 620, 656, 688, 707, 751, 792), so not a blocker, but a toast on non-2xx would improve UX. (correctness)
- `OverviewTab.tsx:215` — `?` — Six independent polling queries refresh the same view (5s–30s intervals), creating bursty background traffic. Acceptable for an admin view; relaxation would reduce request volume with no user-visible downside. (performance)

## Cross-cutting groups

**Endpoint wiring for spawn-work:**
- [blocker-1] Spawn Work button → non-existent `/api/agents/start`
- The endpoint `POST /api/agents` exists in `agents.ts` and is the canonical start-agent route. The fix is to redirect the button to that route or confirm the correct URL.

**Keyboard navigation scope:**
- [blocker-2] Tab/Shift-Tab not implemented (partial arrow-key-only coverage)
- Either implement the full roving-tabindex or revise the spec to match the arrow-key-only implementation.

## What's good
- Tab strip shell, URL state sync, and keyboard arrow-key nav are well-implemented with good test coverage.
- Seven of nine acceptance criteria fully met — PR is structurally solid.
- Visual verification with Playwright provides regression coverage.
- Security review found no new vulnerabilities introduced by this PR.
- Type-safe query hooks centralized in `queries.ts` give a clean data layer.

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 5
- By reviewer: correctness=2 warnings + 3 suggestions, security=0 findings, performance=1 warning + 1 optimization, requirements=1 blocker + 1 partial
- Files touched: 14   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

