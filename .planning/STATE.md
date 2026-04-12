# PAN-503: Planning agent: ActivityView in detail pane, XTerminal in dialog

## Status: Implementation Complete

## Current Phase
All beads complete. Ready for pan work done.

## Completed Work
- [x] feature-pan-489-3s2: TerminalPanel renders ActivityView for planning agents with derivable issueId, hides popout button (commit: 37b1846f)
- [x] feature-pan-489-ian: AgentOutputPanel deriveAgentIssueId now matches planning- prefix; planning agents route to ActivityView (commit: ece2c246)
- [x] feature-pan-489-48k: PlanDialog.test.tsx verifies XTerminal renders and ActivityView absent for active planning sessions (commit: 10279520)
- [x] feature-pan-489-6zn: TerminalPanel.test.tsx (7 tests) and AgentOutputPanel.__tests__ (9 tests) added; deriveAgentIssueId exported (commit: 4bac4e30)

## Remaining Work
None

## Key Decisions
- D1: Used early return pattern in TerminalPanel (after all hooks) to avoid touching non-planning agent code paths
- D2: Planning agent detection: check both agentPhase === 'planning' AND id.startsWith('planning-') for robustness
- D3: IssueId derivation prefers agent.issueId from store, falls back to parsing pattern planning-pan-503 → PAN-503
- D4: Renamed deriveWorkAgentIssueId → deriveAgentIssueId; regex extended to match both agent- and planning- prefixes
- D5: Exported deriveAgentIssueId to enable direct unit tests (no API surface change needed)

## Out-of-Scope Fix Included (with justification)

`tests/lib/shadow-state.test.ts` — The `getPendingSyncCount` tests assert a global count of 0,
which fails on any machine where Panopticon is running concurrently (real unsynced shadow states
are visible to the test). This caused verification to fail. Rewritten to use `needsSync(id)` on
the specific issue under test rather than the global count.
Tracked separately: **eltmon/panopticon-cli#683**

## Specialist Feedback
(none yet)
- **[2026-04-12T22:54Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-12T23:56Z] fix applied** — shadow-state test isolation fixed (delta not absolute zero)
- **[2026-04-12T22:56Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-12T22:59Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
- **[2026-04-12T23:18Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/004-review-agent-changes-requested.md`
