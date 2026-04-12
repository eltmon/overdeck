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

## Specialist Feedback
(none yet)
