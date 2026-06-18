# Workspace Migration Feature Plan

## Overview

Add a `pan workspace migrate <issue-id>` command to move workspaces between local and remote (exe.dev).

## Current Architecture

### Local Workspaces
- Location: `<project>/workspaces/feature-<issue-id>/`
- Structure: Git worktrees for each repo (polyrepo) or single worktree (monorepo)
- Docker: `.devcontainer/docker-compose.devcontainer.yml`
- Agent state: `~/.overdeck/agents/agent-<issue-id>/`

### Remote Workspaces
- Metadata: `~/.overdeck/workspaces/<issue-id>.yaml`
- VM: `pan-<project>-<issue-id>-ws.exe.xyz`
- Structure: Cloned repos in `/workspace/`
- Uses shared infra VM for postgres/redis

## Command Design

```bash
# Migrate local → remote
pan workspace migrate <issue-id> --to-remote

# Migrate remote → local
pan workspace migrate <issue-id> --to-local

# Options
--keep          # Keep source workspace after migration
--force         # Overwrite if destination exists
--no-docker     # Don't start Docker containers
```

## Implementation

### File: `src/cli/commands/workspace-migrate.ts`

New command that:
1. Detects current workspace location (local or remote)
2. Validates migration direction
3. Executes migration steps

### Migration: Local → Remote

1. **Create VM** on exe.dev
   - Use `ExeProvider.createVm()`
   - Name: `pan-<project>-<issue-id>-ws`

2. **Sync credentials**
   - `ExeProvider.syncAllCredentials()` (Claude, GitHub)
   - `ExeProvider.syncGitLabAuth()` if applicable

3. **Push git branches**
   - For each repo in workspace, push to origin
   - Note: Branches are already tracked, just ensure pushed

4. **Clone repos on VM**
   - SSH to VM
   - Clone each repo, checkout feature branch
   - Reuse logic from existing `createRemoteWorkspace()`

5. **Sync non-git state**
   - Copy `.planning/` directory via scp
   - Copy beads database if exists
   - Copy any workspace-specific configs

6. **Create workspace metadata**
   - Save to `~/.overdeck/workspaces/<issue-id>.yaml`

7. **Cleanup (optional)**
   - Stop local Docker containers
   - Remove local workspace directory

### Migration: Remote → Local

1. **Find remote workspace**
   - Load from `~/.overdeck/workspaces/<issue-id>.yaml`
   - Verify VM is accessible

2. **Pull git changes**
   - For each repo, ensure local has latest from feature branch
   - `git fetch origin && git checkout <branch>`

3. **Create local workspace**
   - Use existing `workspace-manager.createWorkspace()`
   - This creates worktrees, templates, etc.

4. **Sync state from remote**
   - scp `.planning/` from VM to local workspace
   - scp beads database if exists

5. **Start Docker containers**
   - Run `./dev all` or `docker-compose up -d`

6. **Migrate agent state**
   - Copy/update `~/.overdeck/agents/agent-<issue-id>/`

7. **Cleanup (optional)**
   - Delete VM: `ExeProvider.deleteVm()`
   - Remove workspace metadata YAML

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/workspace-migrate.ts` | Create | New migration command |
| `src/cli/commands/workspace.ts` | Modify | Add `migrate` subcommand |
| `src/lib/remote/exe-provider.ts` | Modify | Add helper methods if needed |
| `src/lib/workspace-manager.ts` | Modify | Export helpers for migration |

## Edge Cases

1. **Active agent running** - Require `--force` or fail
2. **Uncommitted changes** - Warn and require `--force`
3. **Docker containers running** - Stop before migration
4. **VM already exists** - Reuse or require `--force`
5. **Network issues** - Retry logic, clear error messages

## Testing

1. Create local workspace for test issue
2. Make some changes, create beads
3. Migrate to remote
4. Verify workspace works on remote
5. Migrate back to local
6. Verify all state preserved
