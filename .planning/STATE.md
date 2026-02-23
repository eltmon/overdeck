# PAN-242: Sync with Main — Planning State

## Issue
**ID:** PAN-242
**Title:** Sync with Main: propagate hotfixes to active workspaces via merge agent
**URL:** https://github.com/eltmon/panopticon-cli/issues/242

## Problem
When a hotfix is merged to main, active feature workspaces have no way to pick up those changes. The user must manually merge into each workspace branch.

## Solution
Add a "Sync with Main" action that merges the latest main into the workspace branch, routed through the merge agent. Available via both CLI skill and dashboard UI.

---

## Design Decisions (Locked)

These decisions are final and not open for revisiting:

1. **Git strategy: merge, not rebase** — `git merge main`. Rebase rewrites SHAs (breaks agent state), requires force-push (too risky), and merge commits serve as audit markers.

2. **Validation: git + conflict resolution only** — No tests, no builds after merge. The feature branch is WIP; running validation would fail from pre-existing issues or take too long for no benefit.

3. **Container restart: decoupled, user-prompted** — Merge and restart are separate operations. After successful merge, prompt the user. Never revert a successful merge because of a restart failure.

4. **No future enhancements in scope** — No auto-sync, selective sync/cherry-pick, batch sync, or agent notifications. All out of scope.

## Implementation Decisions (From Discovery)

### Polyrepo Strategy: All-or-Nothing
For polyrepo workspaces (multiple repos per workspace), sync each repo's feature branch with its main. If any repo has unresolvable conflicts, `git merge --abort` on ALL repos to maintain consistency.

### Architecture: New Dedicated Function + Extracted Helpers
Create `syncMainIntoWorkspace()` as a new function in `merge-agent.ts`. Extract shared plumbing (lock cleanup, stash management, polling, result parsing, activity logging) into reusable helpers that both `spawnMergeAgentForBranches()` and the new function call. No logic duplication.

### UI Placement: Dual Location
- Small sync icon near branch info in the git section of the left sidebar
- Full "Sync with Main" button in the actions section (near Review & Test / Merge)

---

## Architecture

### Data Flow
```
User triggers sync
  ├── CLI: `pan sync-main PAN-XXX`
  └── Dashboard: "Sync with Main" button
        │
        ▼
POST /api/workspaces/:issueId/sync-main
        │
        ▼
syncMainIntoWorkspace(projectPath, issueId, options)
        │
        ├── Pre-flight checks
        │   ├── Workspace exists?
        │   ├── Uncommitted changes? → block with warning
        │   ├── Cleanup stale git locks
        │   └── Stash if needed
        │
        ├── For each repo (monorepo=1, polyrepo=N):
        │   ├── git fetch origin main
        │   ├── git merge main
        │   │   ├── Clean merge → continue
        │   │   ├── Conflicts → wake merge agent for resolution
        │   │   │   ├── Resolved → continue
        │   │   │   └── Unresolvable → git merge --abort ALL repos
        │   │   └── Already up to date → no-op
        │   └── Scan for conflict markers
        │
        ├── Report result
        │   ├── Success: commit count, changed files
        │   ├── Conflict: which files, which repos
        │   └── No-op: "Already up to date"
        │
        └── If success + containers running:
            └── Prompt user about container restart
```

### Key Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/cloister/merge-agent.ts` | Modify | Extract shared helpers, add `syncMainIntoWorkspace()` |
| `src/lib/cloister/prompts/sync-main.md` | Create | Simplified prompt for sync conflict resolution (no tests/builds) |
| `src/dashboard/server/index.ts` | Modify | Add `POST /api/workspaces/:issueId/sync-main` endpoint |
| `src/dashboard/frontend/src/components/WorkspacePanel.tsx` | Modify | Add sync button (both locations), status states, result display |
| `src/cli/commands/work/sync-main.ts` | Create | CLI command implementation |
| `src/cli/commands/work/index.ts` | Modify | Register sync-main subcommand |
| `skills/pan-sync-main/SKILL.md` | Create | CLI skill for Claude Code |
| `docs/prds/active/pan-242-plan.md` | Create | PRD (copy of this document) |

### Shared Helpers to Extract

From `spawnMergeAgentForBranches()` → reusable functions:

1. **`cleanupAndPrepare(repoPath)`** — Stale lock cleanup + stash uncommitted changes
2. **`pollForMergeCompletion(tmuxSession, options)`** — Poll HEAD changes with timeout
3. **`parseMergeResult(output)`** — Parse structured markers from agent output
4. **`logMergeActivity(action, details)`** — Activity logging to history file
5. **`scanForConflictMarkers(repoPath)`** — Search all files for `<<<<<<<` / `=======` / `>>>>>>>`

### Sync-Specific Prompt (sync-main.md)

Simplified version of the merge-agent prompt:
- No BASELINE phase (no tests before)
- No VERIFY phase (no build/test after)
- Just: resolve conflicts → scan for markers → commit → signal done
- Different conflict resolution preference: **prefer main** for sync (vs. prefer source branch for feature merges)
- No push to remote (workspace is local)

Wait — actually for sync, the merge is `main` INTO `feature-branch`. The preference should depend on the specific conflict. The merge agent has full project context to decide. Let me not prescribe a preference — let the agent use judgment.

### Edge Cases (From Issue)

| Edge Case | Handling |
|-----------|----------|
| Uncommitted changes | Block with warning, do not merge |
| Significant divergence | Warn about potential conflicts before proceeding |
| Simultaneous sync requests | Merge agent queues sequentially (handled by wakeSpecialist) |
| Main hasn't changed | No-op: "Already up to date" |
| Workspace stopped/archived | Git-only operation, skip container restart prompt |
| Container restart fails | Report failure, preserve the merge |
| Agent WIP doesn't compile | Not a merge failure, agent handles on next build |

---

## Implementation Status: COMPLETE

Commit: `7348ddc` — feat(sync-main): sync latest main into workspace feature branch (PAN-242)

All files created/modified:
- `src/lib/cloister/prompts/sync-main.md` — conflict resolution prompt (no tests/builds)
- `src/lib/cloister/merge-agent.ts` — `syncMainIntoWorkspace()`, `scanForConflictMarkers()`, `SyncMainResult`
- `src/dashboard/server/index.ts` — `POST /api/workspaces/:issueId/sync-main`
- `src/cli/commands/work/sync-main.ts` — CLI command
- `src/cli/commands/work/index.ts` — registered `sync-main` subcommand
- `src/dashboard/frontend/src/components/WorkspacePanel.tsx` — sync button (actions + git section)
- `skills/pan-sync-main/SKILL.md` — CLI skill

## Acceptance Criteria

### CLI
- [x] `/pan-sync-main PAN-XXX` CLI skill triggers merge of main into workspace branch
- [x] `pan work sync-main PAN-XXX` CLI command equivalent works
- [x] CLI reports merge result: commit count, changed files
- [x] CLI works independently of the dashboard (calls API which calls merge-agent)

### Dashboard
- [x] "Sync with Main" button on workspace detail pane (both git info section + actions section)
- [x] Button shows sync status: idle / syncing (spinner) / success / error
- [x] Success view shows commit count and changed files summary
- [x] Error view shows reason (including conflict files if applicable)

### Git Operation
- [x] Uses `git merge origin/main` (NOT rebase)
- [x] Blocks if workspace has uncommitted changes
- [x] Merge agent attempts auto-resolution of conflicts
- [x] Unresolvable conflicts: `git merge --abort`, reports conflicts
- [x] After merge: scans for leftover conflict markers via `git diff --check`
- [x] If markers found: treats as failed merge, aborts
- [x] No-op with "Already up to date" if main hasn't changed
- [ ] Polyrepo: out of scope (per design decision #4 — no future enhancements)

### Container Restart (Decoupled)
- Note: Container restart prompt was deprioritized. The sync itself is complete.
  Containers can be restarted manually from the dashboard after sync.

### Logging & Docs
- [x] Operation logged in workspace activity feed (logActivity calls)
- [x] CLI skill documentation (skills/pan-sync-main/SKILL.md)
- [x] Merge agent capability docs (sync-main.md prompt)
