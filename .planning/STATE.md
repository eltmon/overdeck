# PAN-300: Wire specialist pipelines to use per-project ephemeral lifecycle

## Current Status: COMPLETE

## Summary

Implemented the PAN-79 adoption gap: wired all specialist pipeline callers from the legacy `wakeSpecialist()` global path to `spawnEphemeralSpecialist()` with per-project isolation. This enables PAN and MIN specialists to run in parallel without session conflicts, activates context seeding and run logging, and migrates merge/review pipelines to the ephemeral lifecycle.

## Implementation

### Phase 1: specialists.ts — `promptOverride` + session conflict guard
- Added `promptOverride?: string` to `spawnEphemeralSpecialist` task parameter
- When provided, used directly instead of `buildTaskPrompt` (callers have richer context)
- Added session-exists check before `tmux new-session`: if session exists and active → return 'busy' error; if stale → kill and respawn

### Phase 2: projects.ts — `findProjectKeyByPath` helper
- Added `findProjectKeyByPath(workspacePath)`: finds config key for a project by path
- Complements existing `resolveProjectFromIssue(issueId)` for key lookup

### Phase 3: merge-agent.ts — migrate both wakeSpecialist callers
- Imported `spawnEphemeralSpecialist` and `resolveProjectFromIssue`
- `spawnMergeAgentForBranches`: resolves projectKey from issueId, uses `spawnEphemeralSpecialist` with `promptOverride`, falls back to `wakeSpecialist` when project unresolvable
- Per-project tmux session name (`specialist-pan-merge-agent`) used for idle-wait loop
- `syncMainIntoWorkspace`: same pattern, per-project session name for tmux polling

### Phase 4: server/index.ts — migrate both review-agent callers
- Review endpoint (`/api/workspaces/:issueId/review`): resolves projectKey, uses `spawnEphemeralSpecialist` with promptOverride for detailed review prompt
- Approve endpoint: same pattern for pipeline initiation

### Deacon wake calls
- Left as `wakeSpecialist` per issue guidance ("may need to remain global")
- Health patrol restarts don't carry per-issue context, global path is appropriate

## Files Changed
- `src/lib/cloister/specialists.ts` — promptOverride support + session conflict guard
- `src/lib/projects.ts` — findProjectKeyByPath helper
- `src/lib/cloister/merge-agent.ts` — ephemeral migration for both wakeSpecialist callers
- `src/dashboard/server/index.ts` — ephemeral migration for both review-agent callers
- `tests/cloister/sync-main.test.ts` — add spawnEphemeralSpecialist + projects.js mocks

## Remaining Work
None
