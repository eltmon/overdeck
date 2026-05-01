# PAN-936: Rally Feature Planning — End-to-End UX and Pipeline

## Status: In Progress

## Current Phase
Implementing InspectorPanel feature-specific actions (workspace-0jy)

## Completed Work
- [x] workspace-rie: Add getChildIssues() method to IssueTracker interface (commit: 24c0cf9d9)
- [x] workspace-q8c: Implement getChildIssues() for Rally tracker (commit: 24c0cf9d9)
- [x] workspace-lhy: Add action bar to FeatureCard with Plan/See Plan, vBRIEF, and Tasks chips (commit: 92c4ba0d4)
- [x] workspace-nqj: Plan button on features uses feature's own status, ignoring derivedStatus (commit: 92c4ba0d4)
- [x] workspace-6qo: FeatureCard title click opens InspectorPanel; chevron still toggles expand (commit: 92c4ba0d4)
- [x] workspace-33x: CompactChildCard click selects child story in InspectorPanel (commit: 92c4ba0d4)
- [x] workspace-0jy: InspectorPanel renders feature-appropriate actions (no Start Agent) (commit: eecb291e8)

## Remaining Work
- [x] workspace-dan: Planning prompt detects Rally Feature and includes child story context
- [x] workspace-qhv: Write FEATURE-CONTEXT.md to .planning/ for story workspaces
- [x] workspace-h72: Feature-level vBRIEF supports cross-story dependency edges
- [x] workspace-ai7: Tests for FeatureCard action bar rendering and chip interactions
- [x] workspace-0g1: Tests for FeatureCard and CompactChildCard click-to-select behavior
- [x] workspace-676: Tests for InspectorPanel feature-specific actions
- [x] workspace-b6h: Tests for getChildIssues() interface and Rally implementation
- [x] workspace-arj: Tests for feature-aware planning prompt and context injection

## Key Decisions
- Feature planning state is independent of child progress: Plan button uses issue.status, not derivedStatus
- Cross-story dependency edges are written to vBRIEF but NOT enforced by Cloister (deferred)
- Reuse existing planning pipeline — no new feature-specific planning mode
- Planning agents reference existing child stories only; no auto-creation in Rally
- Beads dependency graph is inverted (implementation beads depend on test beads); using --force to close

## Specialist Feedback
None
- **[2026-05-01T05:12Z] verification-gate → FAILED** — `.planning/feedback/005-verification-gate-failed.md`
