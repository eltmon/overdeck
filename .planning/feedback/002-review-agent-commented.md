---
specialist: review-agent
issueId: PAN-865
outcome: commented
timestamp: 2026-04-27T11:13:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 adds a Zone C overview tab with a billboard, tile grid, summaries, and trend strip, plus URL routing and keyboard navigation. The PR is substantial and well-structured — correctness and security found no blockers. However, the requirements reviewer identified that clicking an issue node does not open the overview (it auto-selects a session and renders the agent-selected view instead), making the core feature unreachable via the stated interaction. Additionally, Tab/Shift-Tab keyboard navigation is missing while arrow/Home/End keys are implemented. Two performance findings on the 5s activity poll and 10s session-tree refetch should be addressed together with the session auto-select root cause. All four reviewers completed; no reviewer failed.

## Blockers (MUST fix before merge)

### 1. Clicking an issue node does not open the overview — `index.tsx:371-387` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-1 ("Clicking an issue node swaps Zone C to IssueOverviewTabs") is explicitly stated in the issue. The `handleSelectFeature` path calls `pickBestSession` and immediately `selectSession(issueId, best?.sessionId ?? null)`, which causes `IssueWorkbench` to render agent-selected mode even when the user clicked an issue node. The new overview is not reliably reachable via the described interaction.

<fix instruction>
In `index.tsx` `handleSelectFeature`, do not auto-select a session when the user explicitly clicked an issue node. The distinction between a user clicking an issue vs. an agent row must be preserved so that `IssueWorkbench` can enter issue-selected mode (rendering `ZoneCOverview`) instead of agent-selected mode (rendering `ZoneB` + `ZoneCConversation`). Consider clearing any active session selection when the clicked row is a feature/issue node rather than an agent row, or pass a flag through `handleSelectFeature` to suppress `pickBestSession` / `selectSession` for issue-node clicks.
</fix>

### 2. Tab/Shift-Tab keyboard navigation is not implemented — `ZoneCOverview.tsx:139-166` — `~`
**Raised by**: requirements
**Why it blocks**: REQ-5 explicitly requires "Keyboard navigation (arrow keys, Tab/Shift-Tab)". Arrow, Home, and End are implemented (lines 139-166) and tested. Tab/Shift-Tab tab traversal is absent; the test only asserts that Tab/Shift-Tab do not trap focus, which is a weaker check. A partial requirement is not a complete feature.

<fix instruction>
Wire Tab/Shift-Tab handling into the existing keyboard handler at `ZoneCOverview.tsx:139-166` so that Tab advances focus to the next tab button and Shift-Tab moves to the previous. The existing test at `ZoneCOverview.test.tsx:314-323` should be updated to assert active tab changes on Tab/Shift-Tab rather than just non-trapping.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Overview poll hits transcript-heavy endpoint every 5s — `queries.ts:106`, `command-deck.ts` — `~`
**Raised by**: performance, correctness
**Why it blocks**: The 5s polling on `/api/command-deck/activity/:issueId` uses `fetchActivityData()` which hard-codes `includeTranscripts: true` — capturing pane output, reading `.planning/STATE.md`, and concatenating transcript text on every poll cycle. The overview UI only renders section metadata (stage, counts, timestamps). This is O(transcript-size) work on a hot path, done every 5 seconds.

<fix instruction>
Add a server-side flag (e.g., `?summary=1` or a dedicated endpoint) that skips transcript capture and returns only metadata. Update `useActivityQuery` to request the summary path. This is the same optimization already partially enabled in `session-trees` via `includeTranscripts: false` context — apply it to the activity endpoint too.
</fix>

### 2. Session auto-select blocks issue-selected mode (cross-cutting root cause) — `index.tsx:371-387` — `~`
**Raised by**: correctness, requirements
**Why it blocks**: This is the same root cause as Blocker 1. The `pickBestSession` + `selectSession` chain fires on every feature row click, making agent-selected mode the default even when the user clicked an issue node. It also contributes to the session-tree over-fetching (Finding 3 below) since the full snapshot refetch is driven by session selection state.

<fix instruction>
The fix for Blocker 1 (preventing auto-session-select on issue-node clicks) also resolves this. Do not apply this fix without Blocker 1 — they are the same code change.
</fix>

### 3. Session-tree refetch every 10s despite live delta subscriptions — `index.tsx:208` — `~`
**Raised by**: performance
**Why it blocks**: The client does a full `/api/session-trees` poll every 10 seconds while also maintaining per-project `SessionTreeDelta` WebSocket subscriptions that already push tree updates. The snapshot path rebuilds trees by iterating all projects and workspaces with `fetchProjectSessionTree()` / `fetchActivityDataWithContext()`. At scale with many projects, this is duplicate work on top of deltas that are already sufficient for steady-state.

<fix instruction>
Remove the `refetchInterval: 10000` from the session-tree query and rely on the WebSocket delta subscriptions for steady-state updates. Invalidate the bulk query key on `session_added` events as already done, instead of polling on a timer. Keep the initial snapshot fetch for cold-start.
</fix>

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:451-705` — `~` — Silent error swallowing on Spawn/Review/Recover/Sync/Stop buttons. Actions fire mutating requests with empty `.catch()` handlers and no loading state. The Spawn Work button is fire-and-forget inside a void IIFE. At minimum add a loading spinner and console.warn on failure. (correctness)
- `OverviewTab.tsx:257-262` — `~` — Unsafe `as` casts on pipeline status fields. If the server returns `unknown` from the fallback path, `isReviewPipelineStuck` silently misses it. Use a runtime type guard instead of union-type assertions. (correctness)
- `IssueWorkbench.tsx:70-74` — `~` — `handleSwitchTab` is a no-op. Zone A tab-switch buttons are visual-only with no effect. The comment flags this as a planned follow-up; surface it in the dashboard so it doesn't get forgotten. (correctness)
- `index.tsx:466` — `?` — Deep-wipe action is now more reachable from the project tree. Single browser confirmation is still required; no server-side confirmation step. Consider a multi-step confirmation flow in a future iteration. (security)

## Cross-cutting groups

**Session auto-select root cause** (same code path drives multiple findings — fix together):
- [blocker-1] Clicking an issue node does not open the overview
- [high-2] Session auto-select blocks issue-selected mode
- [high-3] Session-tree over-fetching is partly driven by auto-select state changes

## What's good
- The 10-tab strip, URL routing, and keyboard nav host are cleanly implemented with good separation of concerns.
- The billboard, tile grid, summaries, and sparkline render correctly; Playwright visual test confirms the surface.
- Security found no new vulnerabilities; the deep-wipe confirmation dialog is preserved.
- The `includeTranscripts: false` context sharing optimization in session-trees demonstrates good architectural intent that can be extended to the activity endpoint.

## Review stats
- Blockers: 2   High: 3   Medium: 0   Nits: 4
- By reviewer: correctness=5, security=1, performance=2, requirements=2
- Files touched: 12   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

