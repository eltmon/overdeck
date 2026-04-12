---
name: pan-plan-finalize
description: Finalize a planning session by materializing beads tasks from the vBRIEF plan and writing the completion marker so the dashboard can hand off to implementation.
triggers:
  - finalize planning
  - planning complete
  - hand off to implementation
  - pan plan-finalize
  - done planning
allowed-tools:
  - Bash
  - Read
---

# Finalize a Planning Session

## Overview

`pan plan-finalize` is the **only sanctioned way** for a planning agent to mark a session complete. It does two things, deterministically and idempotently:

1. Reads `.planning/plan.vbrief.json` and creates beads tasks (`bd create`) for every item, preserving acceptance criteria as sub-items and `blocks` edges as bead dependencies.
2. Writes `.planning/.planning-complete` — the marker the dashboard polls to decide whether to show the **Done** button.

The dashboard's **Done** button is gated on the marker existing. If you don't run this command, the user is stuck and cannot hand off to the implementation agent.

## When to Use

Run this **once**, at the very end of a planning session, after:

- Your `STATE.md` is written
- Your `.planning/plan.vbrief.json` is written and conforms to vBRIEF v0.5
- You've copied STATE.md to `docs/prds/active/<issue-id-lowercase>/STATE.md`
- You're done asking the user clarifying questions

Do NOT run this in the middle of planning. Do NOT run `bd create` manually before running this — `pan plan-finalize` is idempotent and will replace any existing beads for the issue.

## How to Run

From the workspace root (the directory containing `.planning/`):

```bash
pan plan-finalize
```

It walks up from the current directory looking for `.planning/plan.vbrief.json`, so running it from any subdirectory of the workspace also works. To be explicit:

```bash
pan plan-finalize --workspace /path/to/workspaces/feature-<issue-id>
```

For programmatic callers:

```bash
pan plan-finalize --json
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — beads created, marker written |
| 1 | No vBRIEF plan found (planning artifacts missing or wrong directory) |
| 2 | vBRIEF found but beads creation failed (check the printed errors — usually `bd` not in PATH or vBRIEF malformed) |

## After It Succeeds

1. Print a one-line summary to the user: how many beads were created.
2. Tell the user: "Planning finalized — click Done in the dashboard to hand off to the implementation agent."
3. **STOP.** Do not start implementation. Do not kill the tmux session yourself — the dashboard's Stop button handles tmux teardown if the user wants it. The session can stay alive for inspection.

## Failure Recovery

If `pan plan-finalize` exits non-zero, do NOT manually run `bd create` to work around it. Instead:

- **Exit 1**: Verify you're in the right workspace and that `.planning/plan.vbrief.json` actually exists.
- **Exit 2**: Read the error messages. Common causes: malformed vBRIEF JSON, missing required fields (`uid`, `sequence`, `created`), or `bd` CLI missing. Fix the underlying problem and re-run.

The command is idempotent — re-running after fixing the problem is safe.
