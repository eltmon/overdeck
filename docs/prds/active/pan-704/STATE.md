# PAN-704 — FeatureCard action buttons (Plan / See Plan / vBRIEF / Tasks)

## Problem

Rally `PortfolioItem/Feature` rows on the kanban render via `FeatureCard`
(`src/dashboard/frontend/src/components/KanbanBoard.tsx:565`) which has no
action bar — only expand/collapse, progress bar, and child stories. There is
no UI affordance to trigger feature-level planning, view the feature vBRIEF,
or view generated beads, even though `pan work plan <feature-id>` is
explicitly supported per `docs/HIERARCHICAL-PLANNING.md:217` and the backend
endpoints (`/api/issues/:id/planning-state`, `/generate-tasks`, etc.) work
with Feature identifiers unchanged.

`IssueCard` at `KanbanBoard.tsx:2708+` already renders the Plan/vBRIEF/Tasks
chips, but Features never reach that branch because the hierarchical render
path in `IssueColumn.renderIssueCard` (`KanbanBoard.tsx:1610`) routes Features
through `FeatureCard` and stories through `CompactChildCard`.

## Approach

1. **Extract** the three chip primitives — `PlanChip`, `VBriefChip`,
   `TasksChip` — out of `IssueCard` into reusable components in a new file
   `src/dashboard/frontend/src/components/kanban/PlanningChips.tsx`. Each chip
   accepts the `issue` plus the relevant click handler, owns its own
   `useQuery(['planning-state', issue.identifier])`, and returns the same
   JSX/styling as today. `IssueCard` is updated to consume the extracted
   components — no behavior change at that site.

2. **Wire** `onPlan`, `onViewVBrief`, `onViewBeads` props through
   `FeatureCard` and pass them from `IssueColumn` alongside the existing
   hierarchical render props.

3. **Render** a new action bar on `FeatureCard` at the bottom of the header
   row (inside the clickable header `<div>`, after the progress bar, before
   the expanded children) that hosts `<PlanChip>`, `<VBriefChip>`, and
   `<TasksChip>`. `stopPropagation` on chip clicks so they don't toggle the
   feature's expand/collapse. The bar is visible whether the feature is
   expanded or collapsed. No Start Agent button — work happens per-story.

4. **Leave** `CompactChildCard` untouched. Stories inherit the feature plan;
   they do not get their own action bar.

5. **Cover** with a Vitest + React Testing Library component test that mocks
   `useQuery` for `planning-state` and asserts:
   - `FeatureCard` renders all three chips.
   - Clicking Plan fires `onPlan(feature)`.
   - Clicking vBRIEF fires `onViewVBrief(feature)`.
   - Clicking Tasks fires `onViewBeads(feature)` (or `generate-tasks` fetch
     when `hasPlan && beadsCount === 0`).
   - `See Plan` (green) appears when `planLabelExists === true`.
   - Clicking a chip does NOT invoke `onToggle` (propagation contained).

## Out of scope

- `Start Agent` button on `FeatureCard` (work runs at story level).
- Any changes to `CompactChildCard`.
- Any backend / Linear / GitHub / Rally API changes.
- Kanban drag-drop behavior for Features.
- In-review / done feature states (Features rarely land in those columns via
  the hierarchy path; this issue targets backlog, todo, in_progress — the
  chips are state-agnostic and just render in the header, so all columns
  benefit).

## Acceptance criteria

- Rally Features in the kanban show Plan/vBRIEF/Tasks chips in backlog,
  todo, and in_progress columns in both expanded and collapsed states.
- Clicking Plan opens the existing `PlanDialog` targeting the Feature
  identifier via the same `onPlan(feature)` handler used by `IssueCard`.
- `See Plan` (green) appears once a feature-level vBRIEF exists
  (`hasPlan === true` from `/api/issues/:id/planning-state`).
- Clicking vBRIEF opens the existing `VBriefViewer` dialog via
  `onViewVBrief(feature)`.
- Clicking Tasks opens the beads viewer via `onViewBeads(feature)`, OR
  triggers `generate-tasks` when the plan exists but no beads do — matching
  `IssueCard` semantics.
- Chip clicks do not toggle expand/collapse on the parent feature card.
- `CompactChildCard` (child stories) renders identically to today.
- `IssueCard` rendering and behavior is unchanged after the chip extraction
  (regression baseline: existing snapshot/interaction tests still pass).
- No changes to Linear/GitHub/Rally issue state.

## Files touched (expected)

- **New:** `src/dashboard/frontend/src/components/kanban/PlanningChips.tsx`
- **New:** `src/dashboard/frontend/src/components/kanban/FeatureCard.test.tsx`
  (or colocated with `KanbanBoard.test.tsx` if that's the existing pattern)
- **Modified:** `src/dashboard/frontend/src/components/KanbanBoard.tsx`
  - `IssueCard`: replace inline `planChip`/`vbriefChip`/`tasksChip` JSX with
    the extracted components.
  - `FeatureCard`: add `onPlan`/`onViewBeads`/`onViewVBrief` props, render
    action bar with the three chips.
  - `IssueColumn`: pass the handler props through to `FeatureCard` in the
    hierarchical render path.

## Open details the work agent needs to know

- **`isPlanningActive` variant.** `IssueCard` replaces its Plan chip with a
  pulsing Eye "Watch Planning" button while a planning agent is running for
  the issue (`KanbanBoard.tsx:2711-2722`). `FeatureCard` must honor the same
  variant when a planning agent is running for the Feature. This means
  FeatureCard needs access to the `agents` list so it can derive
  `isPlanningActive = agents.some(a => a.issueId?.toLowerCase() === feature.identifier.toLowerCase() && a.agentPhase === 'planning' && a.status !== 'dead')`.
  Pass `agents` through from `IssueColumn` alongside the handler props.
  `PlanChip` should accept an optional `isPlanningActive` prop and render
  the Eye button when true.
- **FeatureCard export.** `FeatureCard` is currently a local function in
  `KanbanBoard.tsx` and is not exported. The RTL test bead must export it
  (named export) so the test file can import it directly.

## Risk / notes

- The three chips currently share local state with `IssueCard` via closures
  (`handlePlan`, `handleTasksClick`, `generateTasksMutation`,
  `planningStateQuery`). The extraction must preserve this — the new
  components need to host the query and mutation themselves, with the
  `onPlan` / `onViewBeads` / `onViewVBrief` handlers coming in as props.
- `IssueCard` keeps its own `planningStateQuery` today because it also drives
  `beadsCount` for the Start Agent gate. The extracted `TasksChip` must not
  remove access to that state — either `IssueCard` keeps its own query AND
  the chip has its own (React Query dedupes by key, so double-subscription
  is fine), or `IssueCard` reads the chip's data via a render-prop/context.
  Simpler path: both host the same useQuery — React Query dedupes network
  calls by key so there is no extra fetch cost.
- The `refetchInterval: 30000` polling stays intact; features now participate
  in the same polling loop, which is desirable (chip flips red→green after
  Generate Tasks).
- No Playwright verification required — RTL is sufficient for a
  frontend-only render/click change. If the user later wants UAT, it can be
  added as a follow-up.
