# PAN-572: Progressive Polyrepo Workspaces

## Status: Implementation Complete

## Current Phase
All implementation complete - feature branch pushed and ready for PR creation.

## Completed Work
- [x] Added `progressive`, `always_include`, `groups_file`, `pr_target` fields to `WorkspaceConfig`
- [x] Added `pr_target`, `readonly`, `link_type` fields to `RepoConfig`
- [x] Updated `WorkspaceConfig` in `projects.ts` to match (inline type definition)
- [x] Updated `createWorkspace()` in workspace-manager.ts to:
  - Filter repos based on `progressive` mode
  - Handle `link_type: symlink` for meta repos (create symlink instead of worktree)
- [x] Updated `removeWorkspace()` in workspace-manager.ts to:
  - Check if entry is symlink before removing worktree
  - Use `unlinkSync` for symlinks, `removeWorktree` for actual worktrees
- [x] Added `addReposToWorkspace()` function in workspace-manager.ts
- [x] Added `add-repo` subcommand to CLI workspace.ts
- [x] Updated `buildPolyrepoContext()` in work-agent-prompt.ts to:
  - Show only visible repos in progressive mode
  - Include add-repo instructions for progressive workspaces
  - Show PR target branch info
  - List available repos not yet in workspace
  - Mark readonly/symlink repos
- [x] Created `skills/workspace-add-repo/skill.md` skill file

## Remaining Work
- [ ] Create GitHub PR via `pan work done`

## Key Decisions
- [D1] Used inline type definition in `projects.ts` for `WorkspaceConfig` since it was already duplicating the type there rather than importing from workspace-config.ts
- [D2] Progressive mode is opt-in via `progressive: true` config flag - existing polyrepo projects continue to work unchanged
- [D3] Symlink repos are detected at removal time using `lstatSync().isSymbolicLink()` rather than storing link_type at creation time

## Files Modified
- `src/lib/workspace-config.ts` - Added new config fields
- `src/lib/projects.ts` - Updated inline WorkspaceConfig type
- `src/lib/workspace-manager.ts` - Progressive mode handling and symlink support
- `src/cli/commands/workspace.ts` - Added add-repo subcommand
- `src/lib/cloister/work-agent-prompt.ts` - Progressive workspace context
- `skills/workspace-add-repo/skill.md` (NEW)

## Specialist Feedback
None yet.
