# PAN-977 Recovery State — 2026-05-08

## Situation
Work agent for PAN-977 was recovered after a crash. Investigation shows the
workspace is in a **pre-implementation, pre-plan** state. There is nothing to
resume.

## Evidence
- Branch `feature/pan-977` has **one commit ahead of main**:
  `86bf297f6 chore: auto-commit before sync with main` — this commit only
  removed a stale `.pan/continue.json` (debris from a prior workspace occupant,
  per commit `da00c1082`). No implementation work has been done for PAN-977.
- `.pan/continue.json` does not exist.
- `.pan/spec.vbrief.json` does not exist.
- `vbrief/proposed/` contains no `*PAN-977*` file (only `2026-05-06-PAN-982-*`).
- `bd ready -l pan-977` → no ready work.
- `bd list -l pan-977` → no issues found.
- `.beads/issues.jsonl` has no rows scoped to PAN-977.
- GitHub issue body for PAN-977 contains the design narrative but no
  `docs/prds/...` PRD link, and no PRD file matches the issue ID.

## Why this is a system bug, not a recoverable state
The start-agent guard checks `.beads/issues.jsonl` *exists*, not that any beads
are *scoped to the issue*. The file existed (with rows for unrelated issues), so
the check passed and a work agent was spawned without a plan or tasks. The
agent had nothing to do.

## What this agent will NOT do
- Fabricate a plan and start coding (that's the planner's role, run by Opus).
- Run `pan plan` from inside a work agent (wrong lifecycle phase).
- Call `pan done` (the issue is unimplemented).
- Touch its own agent state directory or tmux session (user/dashboard owns
  lifecycle).

## Recommended next action (for the user)
Reset the workspace and re-enter via the planning phase:

```
pan reset pan-977
pan plan pan-977
```

`pan reset` is safe here: there is zero implementation to preserve. Then plan
should produce a vBRIEF in `vbrief/proposed/`, beads tasks scoped to `pan-977`,
and a `.pan/continue.json` — at which point a work agent can be spawned with
something to actually do.
