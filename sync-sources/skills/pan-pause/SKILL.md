---
name: pan-pause
description: "pan pause <id> [--reason <reason>] — persistently pause an agent and stop it if running"
triggers:
  - pan pause
  - pause agent
  - stop auto resume
  - freeze agent
allowed-tools:
  - Bash
  - Read
---

# pan pause

Run the command now:

```bash
pan pause <issue-id>
```

## Usage

```bash
pan pause PAN-123
pan pause PAN-123 --reason "investigating bad loop"
```

## What It Does

`pan pause <id>` sets a persistent pause gate in the agent state file. If the agent is currently running, it also stops the agent so it cannot keep working while paused.

Pausing an issue (its work agent, `agent-<issue>`) holds the whole issue. Its running review convoy and test agent are stopped too, and the Deacon's stalled-review recovery leaves the issue alone. `pan unpause <id>` re-requests the review (a fresh convoy for the current head) or re-dispatches the test agent. Pausing a swarm slot agent pauses only that slot. `pan pause` exits 1 and names any agent it could not stop, including one whose terminal did not close and one whose liveness it could not determine.

Paused agents are skipped by auto-resume. A later `pan start <id>` refuses by default and tells the operator to run `pan unpause <id>` first; `pan start <id> --force` clears the pause gate and starts anyway.

## When to Use

- Use `pan pause` when the agent should stay stopped across Deacon patrols and dashboard restarts.
- Use `pan kill` instead when you only need to stop the current tmux session and still want normal auto-resume behavior.
- Include `--reason` when the next operator needs to know why the gate exists.

## See Also

- `pan unpause <id>` — clear the pause gate without spawning
- `pan start <id>` — start after unpausing, or use `--force` to clear and start
- `pan kill <id>` — stop a session without setting a persistent pause gate
