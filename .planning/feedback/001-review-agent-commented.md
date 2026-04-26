---
specialist: review-agent
issueId: PAN-821
outcome: commented
timestamp: 2026-04-25T23:45:02Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-821 adds a Mission Control / Command Deck session tree feature with backend RPC
(`fetchProjectSessionTree`), a new route module (`mission-control.ts`), and frontend
components for a project/issue/session hierarchy with presence indicators. The PR is
performance-positive overall (shared `ActivityContext`, singleton presence poller,
bounded concurrency). However, the requirements reviewer identifies 2 hard behavioral gaps
that directly contradict the issue's acceptance criteria, and 2 additional partial
implementations that need investigation. The security and correctness reviewers found no
blockers. The PR cannot merge until REQ-9 and REQ-8 are addressed.

## Blockers (MUST fix before merge)

### 1. Clicking issue row does not expand session children — `FeatureItem.tsx:119-124` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-9 explicitly requires "clicking an issue row expands its session
children AND auto-selects the most active/recent session." The current implementation only
auto-selects — `handleRowClick` calls `onSelectSession` but never calls
`setExpanded(true)`. Users who click a row see the right pane change but cannot see which
session was selected because the session list stays collapsed.

<fix instruction — In `FeatureItem.tsx`, add `setExpanded(true)` to `handleRowClick`
so row clicks both expand the session list and auto-select the best session. The fix is a
one-liner in the click handler.</fix>

### 2. Ended reviewer sessions collapse into a single review entry — `mission-control.ts:533-571` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-8 explicitly requires each reviewer sub-agent (correctness,
security, performance, requirements, synthesis) to appear as its own tree node — ended
or not. Currently, `mission-control.ts:533-571` collapses ended reviewer sessions
(those without live tmux) back into a single `specialist-review-${startedAt}` entry.
The tree example in the issue shows individual ended reviewer nodes with presence dots.
Without the reviewer role surviving the tmux session's death, identities are permanently
lost from the tree.

<fix instruction — Persist reviewer role information in review-status history or task
files (`AgentSessionState`/`ReviewStatusHistory`) so ended reviewers can still be rendered
as separate nodes even after their tmux sessions are gone. Modify the aggregation logic
in `mission-control.ts` to look up reviewer role from persisted state when `tmuxName`
is not available.</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `withConcurrencyLimit` copy-pasted in two files — `mission-control.ts:72-108`, `projects.ts:34-70` — `~`
**Raised by**: correctness, performance
**Why it blocks**: The function is identical in both files. A fix to one copy can be
missed in the other. Both correctness and performance reviewers flagged this as the most
actionable maintenance finding. Not a runtime blocker (behavior is correct), but SHOULD
be extracted to a shared utility.

<fix instruction — Extract `withConcurrencyLimit` to `src/lib/concurrency.ts` and
import it in both `mission-control.ts` and `projects.ts`. The function signature is
`withConcurrencyLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]>`.
Both current implementations are identical.</fix>

### 2. `gh issue list` runs every project-tree fetch on ~10s poll — `mission-control.ts:1203-1206` — `~`
**Raised by**: performance
**Why it blocks**: Closed issues change at human cadence (a few per day), but `gh issue list
--state closed --limit 200` fires every ~10s via `useQuery` refetch while the projects tab
is open (~8,640 invocations/24h). The hardcoded `eltmon/panopticon-cli` also ignores
`projects.yaml` repo configuration. On the hot path (projects tab open all day).

<fix instruction — Wrap `closedIssuesResult` in a TTL cache (60–300s). The existing
`projectPathCache` Map in the same file shows the pattern. Cache key should be the repo
identifier from `projects.yaml`.</fix>

### 3. Activity spinner signal not aligned with Cloister's stuck detection — `mission-control.ts:172-194` — `~`
**Raised by**: requirements
**Why it blocks**: REQ-4 requires the spinner to "pick up the same activity signal Cloister
uses for stuck detection." `derivePresence` currently reads `state.json` via
`getAgentRuntimeStateAsync`. If Cloister uses a different signal (e.g.,
`AgentRuntimeSnapshot.activity` or heartbeat JSON), the spinner could show different
activity than what Cloister considers "active."

<fix instruction — Verify Cloister's stuck detection source (likely
`AgentRuntimeSnapshot.activity` or a heartbeat JSON file). Align `derivePresence` in
`mission-control.ts` to consume the same signal so the two are consistent.</fix>

## Nits (advisory — safe to defer)

- `mission-control.ts:158-166` — `?` — `extractReviewerRole` uses case-insensitive
  `startsWith` but case-sensitive `slice`. Works correctly (same character length) but
  could confuse future readers. Add a clarifying comment.
- `SessionPanel.tsx:79-81` — `?` — Terminal availability excludes `idle` sessions even
  when they have a live tmux session. Consider whether paused/waiting agents should
  show terminal output.
- `MissionControl/index.tsx:191-222` — `?` — Subscription effect may tear down and
  re-create WebSocket subscriptions if `projects` reference changes frequently.
  Memoize `projects` or use a stable key to reduce subscription churn.
- `ws-rpc.ts:160-249` — `?` — Presence poller ticks unconditionally every 2s. `tmux ls`
  is cheap (~1ms), so 14,400/day is ~14s CPU — acceptable. Exponential backoff is
  speculative; skip unless profiling shows it on a flame graph.
- `mission-control.ts:1247` — `?` — Concurrency cap of 15 may be too generous for
  cold-cache feature dirs on smaller hosts. Suggest 8 as default with env knob.
  No action required for this PR.

## Cross-cutting groups

**`withConcurrencyLimit` duplication** (same root cause, fix together):
- [high-1] Duplicated `withConcurrencyLimit` in `mission-control.ts:72-108` and `projects.ts:34-70`

**Session tree presence and lifecycle** (related execution path):
- [blocker-2] Ended reviewer sessions collapse into single entry (`mission-control.ts:533-571`)
- [high-3] Activity spinner not aligned with Cloister signal (`mission-control.ts:172-194`)
- [nit-4] Presence poller unconditional ticking (`ws-rpc.ts:160-249`)

**Project tree polling efficiency** (related execution path):
- [high-2] `gh issue list` per-poll on hot path (`mission-control.ts:1203-1206`)
- [nit-5] `useQueries` fans out to all projects even collapsed (`MissionControl/index.tsx:165-171`)

## What's good
- Shared `ActivityContext` eliminates O(F) `tmux ls` and O(F) `readdir` per project tree fetch — significant subprocess QPS reduction
- Singleton presence poller with refcount-based start/stop replaces O(subscribers) with O(1) tmux QPS
- `withConcurrencyLimit(..., 15)` bounds parallel feature work — prevents 50-feature workspaces from spawning 50 simultaneous `bd` shell-outs
- `applySessionTreeDelta` O(F+S) via `findIndex` replaces nested scan with constant index lookups
- `pickBestSession` memoized in `FeatureItem` — avoids re-sort on every parent re-render
- Security review found zero issues; client URL-encodes project keys, server uses lookups not shell execution, no `dangerouslySetInnerHTML` introduced
- Test coverage updated correctly across `done.test.ts`, `checkOpenBeads.test.ts`, `runPreflightChecks.test.ts`, `sync-mirror.test.ts`, `schema-migrations.test.ts`, `review-agent.test.ts`, `conversations.test.ts`

## Review stats
- Blockers: 2   High: 3   Medium: 0   Nits: 5
- By reviewer: correctness=0, security=0, performance=2, requirements=2
- Files touched: ~40   Files with findings: ~12

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

