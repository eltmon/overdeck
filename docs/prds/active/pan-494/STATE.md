# PAN-494: pan start fails if workspace doesn't exist

## Problem

`pan start <id>` errors out when no workspace exists, telling the user to manually run `pan workspace create` first. This is inconsistent with the dashboard's `POST /api/agents` endpoint, which auto-creates workspaces transparently. Users expect `pan start` to be a single command that handles everything.

## Root Cause

In `src/cli/commands/work/issue.ts:543-555`, when `findWorkspaceWithLocation()` returns no workspace, the command prints an error and calls `process.exit(1)` instead of creating the workspace.

The dashboard already solved this at `src/dashboard/server/routes/agents.ts:1135-1148` by calling `pan workspace create ${issueId} --local` when the workspace directory doesn't exist.

## Decision

**Always auto-create the workspace.** No opt-out flag — this matches dashboard behavior and is the expected UX. The old fail-fast behavior provided no value since the user always wants the workspace created.

## Approach

Replace the error block in `issue.ts:543-555` with auto-creation logic:

1. When `!workspace`, show a spinner message like "Creating workspace for {id}..."
2. Call workspace creation using `execAsync('pan workspace create ${id} --local', ...)` — same pattern as the dashboard
3. Set `workspace` to the expected path (`workspaces/feature-{normalizedId}/`) and continue
4. If creation fails, show the error and exit (matching dashboard's error handling)

## Scope

- **In scope:** Auto-create workspace in CLI `pan start` when missing
- **Out of scope:** Beads validation/auto-init (handled downstream), remote workspace auto-creation

## Files Modified

- `src/cli/commands/work/issue.ts` — replace error block with auto-creation (~15 lines changed)

## Difficulty

Simple — single file, obvious change, pattern already exists in dashboard code.
