# PAN-936: Rally Feature Planning — End-to-End UX and Pipeline

## Status: In Progress

## Current Phase
Implementing bead workspace-rie: Add getChildIssues() method to IssueTracker interface

## Completed Work
- [x] workspace-rie: Add getChildIssues() method to IssueTracker interface (commit: 24c0cf9d9)

## Remaining Work
- [ ] workspace-rie: Add getChildIssues() method to IssueTracker interface
- [ ] workspace-q8c: Implement getChildIssues() for Rally tracker
- [ ] workspace-lhy: Add action bar to FeatureCard with Plan/See Plan, vBRIEF, and Tasks chips
- [ ] workspace-nqj: Plan button on features uses feature's own status, ignoring derivedStatus
- [ ] workspace-6qo: FeatureCard title click opens InspectorPanel; chevron still toggles expand
- [ ] workspace-33x: CompactChildCard click selects child story in InspectorPanel
- [ ] workspace-0jy: InspectorPanel renders feature-appropriate actions (no Start Agent)
- [ ] workspace-dan: Planning prompt detects Rally Feature and includes child story context
- [ ] workspace-qhv: Write FEATURE-CONTEXT.md to .planning/ for story workspaces
- [ ] workspace-h72: Feature-level vBRIEF supports cross-story dependency edges
- [ ] workspace-ai7: Tests for FeatureCard action bar rendering and chip interactions
- [ ] workspace-0g1: Tests for FeatureCard and CompactChildCard click-to-select behavior
- [ ] workspace-676: Tests for InspectorPanel feature-specific actions
- [ ] workspace-b6h: Tests for getChildIssues() interface and Rally implementation
- [ ] workspace-arj: Tests for feature-aware planning prompt and context injection

## Key Decisions
- Feature planning state is independent of child progress: Plan button uses issue.status, not derivedStatus
- Cross-story dependency edges are written to vBRIEF but NOT enforced by Cloister (deferred)
- Reuse existing planning pipeline — no new feature-specific planning mode
- Planning agents reference existing child stories only; no auto-creation in Rally

## Specialist Feedback
None
