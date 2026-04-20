---
name: pan-reset
description: "Reset a Panopticon issue to Todo — wipes workspace, branches, agent state via dashboard API"
triggers:
  - pan reset
  - reset issue
  - reset workspace
  - restart issue
  - clean slate
allowed-tools:
  - Bash
---

# pan-reset

Reset a Panopticon issue to a clean Todo state. This is less destructive than `pan wipe` because it uses the dashboard's lifecycle system and doesn't require interactive confirmation.

## When to use

- Planning failed or produced bad output — need to restart from scratch
- Workspace is corrupted (wrong plan.vbrief.json, missing beads, bad state)
- Agent is stuck in a bad state and `pan kill` / `pan start` isn't enough
- You want the same effect as `pan wipe --force` but via the dashboard API

## How to use

```bash
curl -s -X POST "http://localhost:3011/api/issues/<ISSUE-ID>/reset" \
  -H "Content-Type: application/json" \
  -d '{"deleteWorkspace":true}'
```

Example for PAN-699:
```bash
curl -s -X POST "http://localhost:3011/api/issues/PAN-699/reset" \
  -H "Content-Type: application/json" \
  -d '{"deleteWorkspace":true}'
```

## What it does

1. Tears down workspace (kills agents, removes files)
2. Deletes git branches (`feature/<issue-id>` local + remote)
3. Resets issue status to **Todo** in the tracker
4. Clears review/specialist state
5. Emits `workspace.destroyed` event so dashboard updates

## After reset

The issue appears as **Todo** in the dashboard. Click **Plan** to start fresh planning on a clean workspace.

## Differences from other commands

| Command | Destroys workspace | Resets tracker | Needs confirm | Use when |
|---------|-------------------|----------------|---------------|----------|
| `pan-reset` (API) | Yes | Yes | No | Clean restart, bad workspace |
| `pan wipe <id>` | Yes | Yes | Yes (or `--force`) | Same, but CLI |
| `pan reopen <id>` | No | Yes (to In Progress) | Yes | Keeping workspace, reworking |
| `pan kill <id>` | No | No | No | Just stopping the agent |

## Notes

- The dashboard must be running (`pan up`) for the API to respond
- If the dashboard is on a non-default port, adjust `localhost:3011` accordingly
- `deleteWorkspace: true` is the default — set to `false` to keep the workspace directory
