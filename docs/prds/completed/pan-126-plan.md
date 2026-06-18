# PAN-126: pan work issue should use remote workspaces when configured

## Status: Planning Complete

## Problem Statement

`pan work issue` bypasses the remote workspace system entirely. Even when `default_location = "remote"` is configured, agents always run locally because:

1. `findWorkspace()` only looks for local `workspaces/feature-{id}` directories
2. `spawnAgent()` creates local tmux sessions
3. No integration with remote workspace metadata (`~/.overdeck/workspaces/{id}.yaml`)

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auto-create remote workspace | Yes | Seamless UX - user doesn't need separate `pan workspace create` step |
| Agent execution location | On remote VM | True remote execution via SSH + tmux on the VM |
| Local workspace exists | Use local | Honor existing work, don't force migration |
| Remote failure handling | Error + prompt to continue locally | Show error, ask user if they want to fall back to local |
| Add --remote/--local flags | Yes | Consistent with `pan workspace`, allows per-issue override |
| Remote tmux approach | SSH + remote tmux | Run `exe ssh vm -t 'tmux new-session -d -s agent-xxx ...'` |
| Dashboard monitoring | Poll remote status | Dashboard checks tmux on remote VM periodically |

## Architecture

### Current Flow (broken)
```
pan work issue MIN-123
  → findWorkspace() → local only
  → spawnAgent() → local tmux
```

### New Flow
```
pan work issue MIN-123 [--remote|--local]
  │
  ├─ Check --remote/--local flags
  │    └─ If neither, check config.remote.default_location
  │
  ├─ If LOCAL mode:
  │    └─ Existing flow (unchanged)
  │
  └─ If REMOTE mode:
       ├─ Check loadWorkspaceMetadata() for existing remote workspace
       │    ├─ Found: use it
       │    └─ Not found: auto-create via createRemoteWorkspace()
       │
       ├─ Verify remote is available (isRemoteAvailable())
       │    └─ If unavailable: error + prompt to continue locally
       │
       └─ spawnRemoteAgent()
            └─ SSH to VM, create tmux session with claude
```

## Files to Modify

### 1. Extract shared functions (new file)
**File:** `src/lib/remote/workspace-metadata.ts`

Move from `workspace.ts`:
- `loadWorkspaceMetadata()`
- `saveWorkspaceMetadata()`
- `listWorkspaceMetadata()`
- `WORKSPACES_DIR` constant

### 2. Main command changes
**File:** `src/cli/commands/work/issue.ts`

Changes:
- Add `--remote` and `--local` options to `IssueOptions`
- Add `determineWorkspaceLocation()` function
- Modify `findWorkspace()` to also check remote metadata
- Add `ensureRemoteWorkspace()` to auto-create if needed
- Call `spawnRemoteAgent()` for remote workspaces
- Handle remote failure with user prompt

### 3. Remote agent spawning
**File:** `src/lib/agents.ts`

Add:
- `spawnRemoteAgent()` - SSH to VM, create remote tmux session
- `checkRemoteAgentStatus()` - Check if remote tmux session exists
- `messageRemoteAgent()` - Send keys to remote tmux
- `stopRemoteAgent()` - Kill remote tmux session

### 4. Dashboard monitoring
**File:** `src/dashboard/server/index.ts`

Add:
- Remote agent status endpoint modification
- Poll remote VM for tmux session status
- Include remote workspace URLs in status

### 5. Update workspace.ts exports
**File:** `src/cli/commands/workspace.ts`

- Export `createRemoteWorkspace()` (or move to shared module)
- Import from new `workspace-metadata.ts`

## Implementation Sequence

```
1. Extract workspace-metadata.ts ─┐
                                  │
2. Update workspace.ts imports ───┼─→ 3. Add flags to issue.ts
                                  │         │
                                  │         v
                                  │    4. Add remote spawn to agents.ts
                                  │         │
                                  │         v
                                  └───→ 5. Update dashboard monitoring
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Remote config but exe not installed | Error: "exe CLI not found, run `pan remote setup`" |
| Remote config but not authenticated | Error: "Not authenticated with exe.dev, run `exe login`" |
| Remote VM doesn't exist | Auto-create via `createRemoteWorkspace()` |
| Remote VM stopped/hibernated | Auto-start via `exe.startVm()` |
| Both local AND remote workspace exist | Use local (per decision above) |
| `--remote` flag but remote not configured | Error: "Remote workspaces not enabled. Run `pan config set remote.enabled true`" |

## Out of Scope

- Migrating existing local workspaces to remote
- Syncing workspace state between local and remote
- Remote workspace hibernation during agent spawn

## Testing Plan

1. Unit tests for `determineWorkspaceLocation()`
2. Integration tests for remote agent spawn (mock exe CLI)
3. Manual testing with actual exe.dev VM
4. Dashboard polling verification

## Remaining Work

Implementation needed - see beads tasks below.

## Beads Tasks

| ID | Title | Difficulty | Blocked By |
|----|-------|------------|------------|
| `overdeck-v605` | Extract workspace metadata functions to shared module | medium | - |
| `overdeck-zl4k` | Add --remote/--local flags to pan work issue | simple | - |
| `overdeck-uofo` | Implement determineWorkspaceLocation logic | medium | v605 |
| `overdeck-avzx` | Implement spawnRemoteAgent function | complex | - |
| `overdeck-k8a2` | Wire pan work issue to use remote workspaces | medium | uofo, avzx |
| `overdeck-7j0s` | Add remote agent monitoring to dashboard | medium | avzx |

**Parallelization:** Tasks v605, zl4k, and avzx can be done in parallel. After v605 completes, uofo can start. After both uofo and avzx complete, k8a2 can proceed. Dashboard task 7j0s can start after avzx.
