# PAN-273: Kanban Board Redesign — Implementation PRD

## Summary

Redesign the Overdeck kanban board from 6 visible columns (Backlog, Todo, Planning, In Progress, In Review, Done) to 4 visible columns (Todo, In Progress, In Review, Done). Remove "Planning" as a canonical state. Hide Backlog from the board (separate view). Introduce pre-workspace PRDs decoupled from feature branches.

See `docs/KANBAN-MODEL.md` for the design rationale and mental model.

## Goals

1. Reduce horizontal scrolling — 4 columns fit on screen without scrolling
2. Remove "Planning" as a kanban column — planning is an activity, not a state
3. Hide Backlog from the Current cycle board view
4. Decouple PRD creation from workspace/branch creation
5. Clean up custom Linear states ("In Planning", "In Review") added to the MIN team
6. Simplify tracker state mapping across GitHub, Linear, Rally, GitLab, Jira, Trello

---

## Phase 1: Remove "Planning" Canonical State

### Core State Types

**`src/core/state-mapping.ts`**
- Lines 9-16: Remove `'planning'` from `CanonicalState` union type
- Lines 29-37: Remove planning entry from `CANONICAL_STATES` array
- Lines 39-47: Remove `planning: 'started'` from `STATE_TYPE_MAP`
- Lines 91-203: Remove planning entries from `DEFAULT_STATE_MAPPINGS`:
  - Linear: remove `planning: 'In Planning'` and `autoCreateConfig.planning`
  - GitHub: remove `planning: { status: 'open', label: 'planning' }` and label color
  - GitHub projectBoard: remove `planning: 'In Planning'`
  - GitLab: remove `planning: { status: 'opened', label: 'planning' }`
  - Jira: remove `planning: 'In Planning'`
  - Trello: remove `planning: 'Planning'`
- Lines 242-271: Remove `if (lower.includes('planning')...)` heuristic from `trackerStateToCanonical()`

**`src/lib/shadow-state.ts`**
- Line 37: Remove `'planning'` from `CanonicalState` union

**`src/dashboard/frontend/src/types.ts`**
- Lines 85-92: Remove `'planning'` from `CanonicalState` union
- Lines 97-104: Remove `'planning'` from `STATUS_ORDER` array
- Lines 119-123: Remove "Planning states" section from `STATUS_LABELS` (`In Planning`, `Planning`, `Planned`, `Discovery`)
- Lines 152-160: Remove `planning: 'started'` from `STATE_TYPE_MAP`

### Frontend Kanban Board

**`src/dashboard/frontend/src/components/KanbanBoard.tsx`**
- Lines 434-441: Remove `planning: 'border-purple-600'` from `COLUMN_COLORS`
- Lines 443-450: Remove `planning: 'Planning'` from `COLUMN_TITLES`
- Line 1451: Remove `isPlanning = STATUS_LABELS[issue.status] === 'planning'` check
- Lines 1906+: Remove entire planning-state action buttons block

**`src/dashboard/frontend/src/components/PlanDialog.tsx`**
- Lines 77-98: Remove `startPlanningMutation` (calls `/api/issues/:id/start-planning`)
- Lines 116-119: Remove planning status polling
- Lines 123-154: Remove `stopPlanningMutation`
- Lines 154-180: Remove `abortPlanningMutation`
- Lines 236-262: Remove planning completion detection
- Lines 264-283: Remove planning handlers
- Lines 319+: Remove `'planning'` step rendering
- Lines 442-478: Remove "Resume Planning Session" UI block
- Overall: This component needs significant rework — planning initiation moves to a lightweight flow triggered from Todo, not a multi-step dialog

**`src/dashboard/frontend/src/components/HandoffsPage.tsx`**
- Line 101: Remove `planning_complete: 'Planning Complete'` from label map
- Line 109: Remove `planning_complete: 'text-green-400'` from color map

### Dashboard Server Endpoints

**`src/dashboard/server/index.ts`**

These endpoints are being **removed or heavily reworked**:

- Lines 8378-8975: `POST /api/issues/:id/start-planning` — entire handler
  - Line 8418: `newStateName = 'In Planning'`
  - Lines 8482-8517: Find/create "In Planning" state in Linear
  - Lines 8863-9063: Planning agent model selection and spawn
- Lines 9826-10020: `POST /api/issues/:id/complete-planning` — entire handler
- Lines 9416-9637: Interactive planning session and abort logic

These endpoints need **updates**:

- Lines 10457-10575: `POST /api/issues/:id/move-status`
  - Line 10462: Remove `'planning'` from `validStatuses` array
  - Line 10475: Remove `planning: 'in_progress'` mapping
- Line 1044-1045: Remove `canonicalStatus === 'planning' ? 'In Planning'` mapping
- Line 8374: Remove GitHub "planning" label addition
- Lines 9487, 10032: Remove "planning" label removal
- Line 10216: Remove "planning" and "planned" from label removal list

**`src/dashboard/server/services/issue-data-service.ts`**
- Lines 41-54: Remove GitHub label → planning state mapping
- Lines 481-482: Remove `canonicalStatus === 'planning'` and `'planned'` mappings

### Cloister Triggers

**`src/lib/cloister/triggers.ts`**
- Line 26: Remove `'planning_complete'` from trigger type union
- Lines 146-220: Remove entire `checkPlanningComplete()` function
- Line 423: Remove call to `checkPlanningComplete()`

**`src/lib/cloister/config.ts`**
- Line 103: Remove `planning_complete` from config interface
- Line 242: Remove `planning_complete` from default config

### Work Types & Agent Routing

**`src/lib/work-types.ts`**
- Lines 31-34: Remove `'issue-agent:planning'` work type
- Line 78: Remove `'issue-agent:planning-subagent'` if present
- Line 120: Remove `'planning-agent'` work type

### Settings

**`src/lib/settings.ts`**
- Line 30: Remove `planning_agent: ModelId` from config
- Line 57: Remove default `planning_agent: 'claude-opus-4-6'`
- Lines 170-172: Remove validation for `planning_agent`

### CLI Commands

**`src/cli/commands/work/wipe.ts`**
- Lines 198-246: Remove `--remove-label "planning"` from GitHub cleanup

**`src/cli/commands/work/done.ts`**
- Lines 139-146: Update label logic (currently removes "in-progress", adds "in-review")

### Tests

**`tests/e2e/handoff-planning-complete.test.ts`** — Remove or update entirely
**`tests/integration/agent-spawning.test.ts`** — Remove planning agent spawn tests (lines 108, 195)
**`tests/lib/router-config.test.ts`** — Remove planning model config test (line 291)

---

## Phase 2: Hide Backlog from Current Cycle View

Per PAN-273 issue description:

- When cycle filter is "Current", exclude Backlog items from the kanban
- Add "All" mode as a list view grouped by labels (not kanban columns)
- Backlog accessible via separate "Backlog" filter button (already exists)

---

## Phase 3: Pre-Workspace PRD Directory

- Add `docs/prds/drafts/` directory convention
- Update planning agent to write to `drafts/` without requiring a workspace
- On workspace creation (move to In Progress), copy draft PRD into `.planning/`
- Update PRD enforcement (PAN-47) to check `drafts/` in addition to workspace existence
- Add `prdDir` config option to `WorkspaceConfig` in `src/lib/workspace-config.ts`
- Update all hardcoded `docs/prds/` paths (currently ~5 locations in server code)

---

## Phase 4: Clean Up Linear Custom States

- Remove "In Planning" custom state from MIN team in Linear
- Remove "In Review" custom state from MIN team in Linear (map to "In Progress" instead)
- Migrate any existing issues in those states to the correct default state

---

## Current Label Usage Audit

Labels are used extensively and inconsistently across the codebase. This audit captures every usage pattern.

### A. Labels as Pseudo-States (GitHub/GitLab)

GitHub and GitLab only have binary state (open/closed), so Overdeck uses labels to encode workflow states.

**State labels currently in use:**

| Label | Purpose | Set When | Removed When |
|-------|---------|----------|--------------|
| `planning` | Issue in planning phase | Start Planning clicked | Planning completes |
| `planned` | Planning done, not started | Planning completes | Work starts |
| `in-progress` | Agent actively working | Work agent starts | Work completes or merge |
| `in-review` | PR awaiting review | `pan work done` | Merge |
| `done` | Work complete | Merge | — |
| `wontfix` | Canceled | Cancel action | — |
| `review-ready` | Ready for merge | Agent completes | Merge or cancel |

**Code locations for state label manipulation:**
- `src/dashboard/server/index.ts` lines 7490-7506 (done), 7951/8009 (in-progress), 8374 (planning), 9487/10032 (remove planning), 10216 (remove multiple), 10361 (reopen)
- `src/cli/commands/work/done.ts` lines 139-146 (in-review)
- `src/cli/commands/work/wipe.ts` lines 198-246 (remove planning)
- `src/lib/cloister/merge-agent.ts` line 325 (remove in-progress, add done)

**State label reading (GitHub → canonical state):**
- `src/dashboard/server/index.ts` lines 910-952: `mapGitHubStateToCanonical()`
- `src/dashboard/server/services/issue-data-service.ts` lines 41-54: duplicate mapping

### B. Labels for Workflow Signaling (Linear)

**`Review Ready` label** — created automatically if missing:
- `src/cli/commands/work/done.ts` lines 63-88: Creates label with color `#22c55e` (green)
- Added to issue when work agent completes, signals stakeholders

### C. Labels for Complexity/Difficulty

**`difficulty:` prefix** — used by Beads integration:
- `src/lib/cloister/complexity.ts` lines 292-303: `parseDifficultyLabel()` parses `difficulty:trivial`, `difficulty:simple`, etc.
- `src/cli/commands/work/plan.ts` line 531: Beads tasks created with `difficulty:${level}` label
- `src/dashboard/frontend/src/components/BeadsDialog.tsx` line 167: Renders difficulty badges
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` lines 40-46: `DIFFICULTY_COLORS` map

**Complexity detection from labels:**
- `src/lib/cloister/complexity.ts` lines 61-69: `COMPLEXITY_LABELS` maps label names to complexity levels (trivial, simple, medium, complex, expert)
- Lines 112-120: `detectComplexityFromLabels()` checks issue labels

**Complex issue detection:**
- `src/dashboard/server/index.ts` lines 1284-1286: checks for `['complex', 'large', 'epic', 'multi-phase', 'architecture']`
- `src/cli/commands/work/plan.ts` lines 168-170: same check

### D. Labels for Project Routing

- `src/lib/projects.ts` lines 208-220: `resolveProjectPath()` routes issues to projects based on label matching against configured rules

### E. Labels for Workspace Association

- `src/cli/commands/workspace.ts` line 90: Creates `workspace:<issue-id>` label pattern for Beads

### F. Labels in Tracker Interface

- `src/lib/tracker/interface.ts`: `labels: string[]` field on `Issue`, `IssueFilters`, `NewIssue`, `IssueUpdate` interfaces
- `src/lib/tracker/github.ts` line 46: Filter by labels in list queries
- `src/lib/tracker/linear.ts` lines 54-56: Filter by label names
- `src/lib/tracker/rally.ts` lines 488-496: Converts labels to Rally tags

### G. Fallback Label Strategies

- `src/core/state-mapping.ts` lines 52-58: `FallbackConfig` with `prefix` (e.g., `pan:`, `pan-`)
- Used when trackers can't create native states — falls back to labels like `pan:planning`, `pan:in-review`

---

## Phase 5: Label Cleanup

See `docs/KANBAN-MODEL.md` Labels section for the target taxonomy. Summary of code changes:

### Remove These Labels Entirely

| Label | Remove From |
|-------|-------------|
| `planning` | state-mapping.ts, index.ts (lines 8374, 9487, 10032, 10216), wipe.ts (lines 198-246), mapGitHubStateToCanonical() |
| `planned` | index.ts (line 10216), mapGitHubStateToCanonical() |
| `done` | index.ts (lines 7490-7506), merge-agent.ts (line 325) — closing the issue is sufficient |
| `review-ready` | index.ts (line 10216) — `readyForMerge` boolean in review-status.json handles this |
| `Review Ready` (Linear) | done.ts (lines 63-88) — remove auto-creation logic and label application |
| `pan:*` fallback prefix | state-mapping.ts (lines 52-58) — remove FallbackConfig, simplify to direct labels |

### Keep These Labels

| Label | Reason |
|-------|--------|
| `in-progress` | GitHub/GitLab pseudo-state for In Progress column |
| `in-review` | GitHub/GitLab pseudo-state for In Review column |
| `difficulty:*` | Beads task difficulty metadata — well-structured, keep as-is |
| `workspace:*` | Internal Beads workspace association — keep as-is |

### New: Auto-Cleanup on State Transitions

**Current bug**: Label cleanup only happens on reopen (line 10216) and deep-wipe (line 10853). Moving from In Progress → In Review does NOT remove the `in-progress` label.

**Fix**: Add a `cleanupWorkflowLabels(issueId, targetState)` function called on every state transition for GitHub/GitLab issues:

1. Remove all workflow labels (`in-progress`, `in-review`)
2. Add the label matching the target state (if applicable)
3. Call this from `move-status` endpoint, `pan work done`, merge-agent, and any other transition point

**Code locations to wire in auto-cleanup:**
- `src/dashboard/server/index.ts` line 10457: `move-status` endpoint
- `src/cli/commands/work/done.ts` lines 123-162: `updateGitHubToInReview()`
- `src/lib/cloister/merge-agent.ts` line 325: merge completion

### Consolidate Duplicate Mapping Logic

`mapGitHubStateToCanonical()` exists in two places with identical logic:
- `src/dashboard/server/index.ts` lines 910-952
- `src/dashboard/server/services/issue-data-service.ts` lines 41-54

Extract to a single function in `src/core/state-mapping.ts` and import from both locations.

### Unify `pan work done` Across Trackers

Currently GitHub and Linear have completely different code paths in `done.ts`:
- **GitHub** (lines 123-162): Raw REST API, label manipulation
- **Linear** (lines 27-103): SDK, state transition + label creation

After cleanup:
- **GitHub**: Remove `in-progress` label, add `in-review` label (via `cleanupWorkflowLabels`)
- **Linear**: Move to "In Review" state (if custom state exists) OR stay in "In Progress" (default). No label manipulation needed.
- **Rally**: Stays in "In-Progress" (no sub-state distinction). No label manipulation needed.

### Linear Custom State Cleanup (MIN Team)

Remove these custom states from the MIN Linear team:
- "In Planning" (type: started) — no longer used
- "In Review" (type: started) — optional; can keep if stakeholders look at Linear directly, otherwise remove and let Overdeck handle the distinction internally

Any issues currently in "In Planning" state should be moved to "Todo".
Any issues currently in "In Review" state should be moved to "In Progress" (or "Done" if already merged).
