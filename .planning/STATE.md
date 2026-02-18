# PAN-208: Stale planning state causes premature 'Planning Complete' on restart

## Status: Complete

## Problem

When re-opening the Plan dialog for a previously-planned issue (even after deep-wipe), the PlanDialog shows "Planning Complete" after a few seconds without the planning agent actually running. The root cause is a timing/logic issue where:

1. `STATE.md` from a previous planning session contains `## Status: Complete`
2. The status endpoint (`GET /api/planning/:id/status`) returns `planningCompleted: true` based on regex matching
3. PlanDialog's initial `checking` step auto-transitions to `complete` before `start-planning` is ever called
4. The stale STATE.md cleanup in `start-planning` never runs because the user never reaches the "Start Planning" button

Additionally, `.planning-complete` marker file is **checked but never created** — dead code.

## Decisions

1. **Use `.planning-complete` marker as the sole completion signal** — remove STATE.md regex matching from the status endpoint. The marker is created explicitly by `complete-planning` and deleted by `start-planning` and `deep-wipe`.
2. **Create the marker file** in `complete-planning` endpoint before git commit.
3. **Clear the marker** in `start-planning` alongside stale STATE.md cleanup.
4. **Deep-wipe cleans workspace .planning/** — explicitly delete `.planning-complete` from workspace when `deleteWorkspace=false`.
5. **PlanDialog trusts only the marker** — the `planningCompleted` field remains, but is now backed solely by the marker file, making it reliable.

## Architecture

### Files to Modify

| File | Change | Difficulty |
|------|--------|------------|
| `src/dashboard/server/index.ts` (status endpoint, ~8868-8887) | Remove STATE.md regex, rely only on `.planning-complete` marker | simple |
| `src/dashboard/server/index.ts` (start-planning, ~8463-8469) | Also delete `.planning-complete` marker alongside STATE.md | simple |
| `src/dashboard/server/index.ts` (complete-planning, ~9707) | Write `.planning-complete` marker before git add | simple |
| `src/dashboard/server/index.ts` (deep-wipe, ~10351-10358) | Also clean `.planning-complete` from workspace `.planning/` | simple |
| `src/dashboard/frontend/src/components/PlanDialog.tsx` (~237-240) | No change needed if backend is fixed, but add `hasCompletionMarker` to response type for clarity | trivial |

### Flow After Fix

**Planning completes:**
1. User clicks "Done" → `complete-planning` runs
2. Creates `.planning-complete` marker in `.planning/` directory
3. Commits `.planning/` (including marker) to git
4. Status endpoint returns `planningCompleted: true` (marker exists)

**Re-plan (without deep-wipe):**
1. User clicks "Plan" → dialog opens → `checking` step
2. Status endpoint finds `.planning-complete` → `planningCompleted: true` → dialog shows `complete`
3. This is CORRECT — planning genuinely completed, user can proceed to handoff

**Re-plan (after deep-wipe):**
1. Deep-wipe removes workspace (and marker with it)
2. User clicks "Plan" → dialog opens → `checking` step
3. Status endpoint: no workspace → no marker → `planningCompleted: false` → dialog shows `ready`
4. User clicks "Start Planning" → `start-planning` creates fresh workspace
5. This is CORRECT — fresh planning session starts

**Re-plan (after deep-wipe without deleteWorkspace):**
1. Deep-wipe cleans `.planning-complete` from workspace `.planning/` dir
2. Same flow as above — marker gone, dialog shows `ready`

## Edge Cases

- **Planning agent writes "Status: Complete" in STATE.md but crashes before dialog completion**: Previously this would cause false positive. Now: no marker = not complete. User must click "Done" through the dialog.
- **`.planning-complete` committed to git branch, branch not deleted**: Deep-wipe with `deleteWorkspace=true` deletes branch. Without it, the marker is explicitly deleted from the filesystem.
- **Remote planning sessions**: Marker is created locally by `complete-planning` endpoint after syncing remote state. Same lifecycle applies.

## Out of Scope

- Changing the PlanDialog step state machine beyond what's needed
- Modifying beads or task tracking behavior
- Changing the planning agent's behavior or prompts
