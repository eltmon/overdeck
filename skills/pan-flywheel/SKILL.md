---
name: pan-flywheel
description: "pan flywheel — start, pause, resume, inspect, emit, and report on the singleton Fix-All Flywheel orchestrator"
triggers:
  - pan flywheel
  - flywheel orchestrator
  - fix-all flywheel
  - start flywheel
  - pause flywheel
  - flywheel status
allowed-tools:
  - Bash
  - Read
---

# pan flywheel

Use this skill when operating the singleton Fix-All Flywheel orchestrator.

The Flywheel is not an issue-scoped work agent. It runs as `flywheel-orchestrator`, reads a brief, emits typed status snapshots to the dashboard, and writes a deterministic end-of-run report.

## Commands

```bash
pan flywheel start
pan flywheel start --brief docs/flywheel-brief.md
pan flywheel status
pan flywheel status --json
pan flywheel pause
pan flywheel resume
pan flywheel emit-status --file latest.json
pan flywheel report
```

## When to Use Each Subcommand

### Start

```bash
pan flywheel start
pan flywheel start --brief docs/flywheel-brief.md
```

Starts `flywheel-orchestrator` and opens a new run under `~/.panopticon/flywheel/runs/<runId>/`.

Use the default brief unless the user gives a specific markdown brief. The default is `docs/flywheel-brief.md`. The command validates that the brief path stays inside the project root.

### Status

```bash
pan flywheel status
pan flywheel status --json
```

Shows the active run's latest `FlywheelStatus` snapshot. Use `--json` when another tool or script needs the raw contract payload.

### Pause and Resume

```bash
pan flywheel pause
pan flywheel resume
```

`pause` flips the Flywheel gate and stops active orchestration without clearing the active run id. `resume` clears the gate and restarts the singleton if needed.

If the Flywheel is already paused or already running, these commands report the current gate state and exit successfully.

### Emit Status

```bash
pan flywheel emit-status --file latest.json
```

Validates a `FlywheelStatus` JSON payload and posts it to the local dashboard. The `--file` value is normally a path; pass a single dash as the value when reading the payload from stdin.

The role prompt should use this helper instead of hand-writing HTTP requests so schema validation stays centralized.

### Report

```bash
pan flywheel report
```

Writes the per-run report under the run directory (`${PANOPTICON_HOME}/flywheel/runs/<runId>/report.md`) and commits any orchestrator-authored changes to `docs/FLYWHEEL-STATE.md` (durable cumulative memory). Produces a `docs(flywheel): run N` commit when there are changes.

Run this at the end of a Flywheel revolution, not after every status tick.

## Guardrails

- Do not start a second Flywheel run while one is active.
- Do not spawn the Flywheel from a workspace devcontainer.
- Do not bypass `pan flywheel emit-status` with raw HTTP.
- Do not auto-merge or deep-wipe from the Flywheel; keep those as explicit human-controlled actions.

## See Also

- `roles/flywheel.md` — orchestrator role prompt
- `docs/flywheel-brief.md` — default brief
- `docs/FLYWHEEL.md` — operator documentation
- `docs/FLYWHEEL-STATE.md` — durable cumulative memory across all runs (created on first orchestrator write)
