# Rally Feature Planning: End-to-End UX

**Consolidates**: PAN-704, PAN-397, PAN-403

## Problem

Rally Features (`PortfolioItem/Feature`) are second-class citizens in the dashboard. The hierarchical view exists but the planning UX is broken:

1. **FeatureCard has no action surface** — no Plan, See Plan, vBRIEF, or Tasks buttons. The only interaction is expand/collapse, which renders `CompactChildCard` items that are also non-interactive.
2. **No modal for features or child stories** — clicking a FeatureCard toggles collapse. There's no way to inspect a feature's details or open any child story's detail modal, unlike `IssueCard` which opens a full inspector.
3. **derivedStatus suppresses Plan button** — even if buttons existed, child story progress rolls up to `derivedStatus: "in_progress"`, which incorrectly hides the Plan action for unplanned features.
4. **Backend pipeline is partially wired** — `pan work plan` accepts feature IDs, planning routes exist, vBRIEF format supports feature-level plans with story decomposition. But the dashboard can't trigger any of it.

The design doc (`docs/HIERARCHICAL-PLANNING.md`) describes a clear two-phase model — plan at the Feature, execute at the Story — but the dashboard UX was never built to support it.

## Design Principles

- **Plan at the Feature, execute at the Story** — the core hierarchy from HIERARCHICAL-PLANNING.md
- **FeatureCard is a planning surface, not an execution surface** — no "Start Agent" on features; agents run per-story
- **Child stories remain compact but inspectable** — CompactChildCard stays compact, but must be clickable to open a detail modal
- **Feature state is its own state** — Plan button availability uses the feature's tracker state, not derived child progress

## Scope

### Phase 1: Interactive FeatureCard (Dashboard UI)

Make FeatureCard a first-class interactive element:

**1.1 — Action bar on FeatureCard**
- Add Plan / See Plan chip (green when `planLabelExists`)
- Add vBRIEF chip (opens VBriefViewer for the feature-level plan)
- Add Tasks chip (opens beads view)
- Place in the header row, visible whether expanded or collapsed
- Reuse the same `useQuery(['planning-state', feature.identifier])` and handler wiring from `IssueCard`
- No "Start Agent" button — features are planning units, not execution units

**1.2 — Click-to-modal on FeatureCard**
- Clicking the feature title/body (not the expand chevron) opens the issue detail modal / InspectorPanel
- Same modal that IssueCard opens, populated with the feature's data
- Expand/collapse remains on the chevron only

**1.3 — Click-to-modal on CompactChildCard**
- Clicking a child story opens its detail modal / InspectorPanel
- Child stories are regular issues — the modal shows full issue details, planning state, agent status
- CompactChildCard visual styling stays compact (no action bar on children)

**1.4 — Fix derivedStatus gate**
- Plan button visibility uses the feature's own tracker state (`rawTrackerState` or planning-complete marker), not `derivedStatus`
- A feature with in-progress children but no plan should still show Plan
- A feature with `.planning-complete` or `planned` label should show See Plan regardless of child state

### Phase 2: Feature Planning Pipeline (Backend)

Wire the end-to-end feature-level planning flow:

**2.1 — `getChildIssues()` tracker interface**
- Add `getChildIssues(parentId: string): Promise<Issue[]>` to the tracker interface
- Implement for Rally: fetch child User Stories of a PortfolioItem/Feature
- Linear/GitHub return empty (single-level trackers)

**2.2 — Feature-aware `pan work plan`**
- When `pan work plan F1234` targets a Rally Feature (detected via `resolveTrackerType()`):
  - Fetch Feature + all child User Stories via `getChildIssues()`
  - Pass full hierarchy to Opus planning agent
  - Opus produces feature-level `plan.vbrief.json` with story items, `planRef` URIs, cross-story `edges`
  - No beads at feature level

**2.3 — opus-plan skill v2.0**
- Feature-level mode: produces architectural decisions + story decomposition + cross-story dependency edges
- Story-level mode (existing): produces implementation items + acceptance criteria + beads
- Mode detected automatically from issue type

**2.4 — Story workspace context injection**
- When creating a per-story workspace under a planned feature:
  - Write `FEATURE-CONTEXT.md` into `.planning/` with the parent feature's plan, architectural decisions, and cross-story context
  - `readPlanningContext()` picks up FEATURE-CONTEXT.md and injects into the story agent's prompt
  - Story planning inherits feature constraints without re-discovering them

**2.5 — Cloister cross-story ordering**
- Parse feature-level vBRIEF `edges` array when spawning story workspaces
- `blocks` edges: don't spawn target story workspace until blocking story merges
- `informs` edges: spawn target, inject source output as context
- `invalidates` edges: skip target if source completes
- Maintain feature-level dependency map in Cloister state

### Phase 3: Integration Testing

**3.1 — Dashboard tests**
- FeatureCard renders Plan/vBRIEF/Tasks chips in backlog/todo/in_progress columns
- Clicking Plan on a Feature opens PlanDialog targeting the feature identifier
- See Plan (green) appears when feature-level vBRIEF exists
- Click-to-modal works on both FeatureCard title and CompactChildCard
- derivedStatus does not suppress Plan button for unplanned features

**3.2 — Pipeline integration tests**
- `pan work plan` on a Rally Feature produces feature-level vBRIEF with story items
- Story workspaces receive FEATURE-CONTEXT.md
- Cloister respects `blocks` edges between stories
- End-to-end: Feature plan → story decomposition → story workspace → agent execution

## Implementation Notes

### Key files
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` — FeatureCard (~line 620), CompactChildCard (~line 719), IssueCard action bar (~line 2708), planChip (~line 2615)
- `src/dashboard/server/routes/issues.ts` — planning-state lookup (~line 2335)
- `src/dashboard/server/services/issue-data-service.ts` — derivedStatus computation (~line 943)
- `src/lib/tracker/interface.ts` — tracker interface (add `getChildIssues`)
- `src/lib/tracker/rally.ts` — Rally client
- `src/lib/cloister/work-agent-prompt.ts` — `readPlanningContext()`, `injectFeatureContext()`
- `src/lib/planning/vbrief-planning.ts` — feature plan skeletons, beads converter

### What's already built
- Rally tracker integration (queries, state mapping, hierarchical view)
- Backend planning routes accept feature IDs
- `src/lib/vbrief/` library (types, builder, validator, io, beads conversion, DAG)
- `src/lib/planning/vbrief-planning.ts` — feature plan skeletons, context injection (stubs)
- `docs/HIERARCHICAL-PLANNING.md` — full design spec

### Dependencies
- Phase 2 depends on Phase 1 (need UI to trigger feature planning)
- Phase 2.4 depends on 2.1 (need `getChildIssues` to populate story context)
- Phase 2.5 depends on 2.2 (need feature-level vBRIEF with edges to order workspaces)
- Phase 3 runs after each phase

## Non-goals

- Changing Linear/GitHub issue planning (single-level, already works)
- Adding "Start Agent" to FeatureCard (agents run per-story)
- Redesigning CompactChildCard layout (stays compact, just becomes clickable)
- Auto-creating Rally User Stories from feature plans (stories already exist in Rally)
