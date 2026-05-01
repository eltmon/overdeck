# PAN-936: Rally Feature Planning — End-to-End UX and Pipeline

## Status: Planning Complete

## Problem

Rally Features are non-interactive in the dashboard. FeatureCard has no action bar
(no Plan/vBRIEF/Tasks), clicking it only toggles expand/collapse (no detail view),
CompactChildCard (child stories) aren't clickable, and the backend has no
feature-aware planning pipeline. Three sub-issues consolidated:

- **PAN-704**: FeatureCard missing action bar
- **PAN-397**: Hierarchical planning pipeline not wired end-to-end
- **PAN-403**: derivedStatus from children affects feature column placement

## Decisions

### Scope
All 3 phases: Dashboard UI + Backend Pipeline + Integration Tests.

### Planning Flow
Reuse existing planning pipeline for features. Plan button spawns a standard planning
agent — no new feature-specific planning mode. The planning prompt is enhanced to detect
features and include child story context.

### Detail UX
FeatureCard title click → select issue → opens existing InspectorPanel (right sidebar).
Chevron continues to toggle expand/collapse. Consistent with IssueCard behavior.

### Story Creation
Planning agents reference existing child stories only. No auto-creation of story issues
in Rally.

### Cloister Scope (Groundwork Only)
`getChildIssues()` + feature-aware planning prompt + FEATURE-CONTEXT.md injection.
Cross-story dependency edges are written to vBRIEF but NOT enforced by Cloister.
Full orchestration deferred.

### derivedStatus Fix (PAN-403)
Investigation found two issues:
1. **Column placement**: `groupByStatus()` uses `derivedStatus` to move features into
   "In Progress" column even when the feature's own Rally status is "Todo"
2. **Plan button gating**: The Plan chip checks `issue.status` (raw), not effective column

The fix for this issue: FeatureCard's Plan button uses the feature's own `status`,
ignoring `derivedStatus` from children. This aligns with "plan at Feature, execute at
Story" — a feature's planning state is independent of child progress.

**Out of scope**: Changing column placement logic for features (whether derivedStatus
should move features between columns is a separate UX decision — file as follow-up).

## Architecture Notes

### Existing UI Components (Reuse)
- `BeadsTasksPanel` — Tasks chip dialog (exists, wired for IssueCard)
- `VBriefDialog` / `VBriefViewer` — vBRIEF chip dialog (exists at `src/dashboard/frontend/src/components/vbrief/`)
- `PlanDialog` — Plan chip dialog (exists, spawns planning agent)
- `InspectorPanel` — Right sidebar detail view (exists, needs feature-specific action branch)

### Backend Components (New/Modified)
- `IssueTracker.getChildIssues()` — New method on tracker interface
- `RallyTracker.getChildIssues()` — Rally implementation querying PortfolioItem children
- `spawn-planning-session.ts` — Enhanced to detect features and inject child story context
- `work-agent-prompt.ts` — New `FEATURE_CONTEXT` injection for story workspaces
- `.planning/FEATURE-CONTEXT.md` — Feature's architectural decisions + cross-story context

### Key Files
- `KanbanBoard.tsx` — FeatureCard, CompactChildCard, action bar rendering
- `InspectorPanel.tsx` — Feature-specific action region
- `issue-data-service.ts` — derivedStatus computation
- `src/lib/tracker/interface.ts` — IssueTracker interface
- `src/lib/tracker/rally.ts` — Rally implementation
- `src/lib/planning/spawn-planning-session.ts` — Planning session spawning
- `src/lib/cloister/work-agent-prompt.ts` — Work agent context injection

## PRD Note
The issue references `docs/prds/planned/rally-feature-planning-ux.md` but this file
does not exist on disk. The issue body itself serves as the spec.

## Related Issues
- PAN-704: FeatureCard action bar (consolidated here)
- PAN-397: Hierarchical planning pipeline (consolidated here)
- PAN-403: derivedStatus gate (consolidated here)
