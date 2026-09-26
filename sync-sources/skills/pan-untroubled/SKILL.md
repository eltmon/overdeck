---
name: pan-untroubled
description: "pan untroubled <id> — clear an agent troubled gate without spawning it"
triggers:
  - pan untroubled
  - untroubled agent
  - clear troubled gate
  - agent is troubled
allowed-tools:
  - Bash
  - Read
---

# pan untroubled

Run the command now:

```bash
pan untroubled <issue-id>
```

## Usage

```bash
pan untroubled PAN-123
```

## What It Does

`pan untroubled <id>` clears the troubled flag and its accumulated failure-tracking fields (consecutive failures, first/last failure timestamps, last failure reason) from the agent state file. It does not resume or spawn the agent — a repeatedly crashing agent should restart only when the operator chooses to. After clearing, it prints `pan start <id>` for the operator to run next.

An agent becomes troubled after three consecutive resume/start failures within ten minutes. While troubled, `pan start`, `pan resume`, dashboard Start, and MERGE all refuse until the gate is cleared.

## When to Use

- Use `pan untroubled <id>` after investigating the crash cause, to clear the gate without starting the agent yet.
- Use `pan start <id> --force` instead only when you intentionally want to clear the troubled gate and spawn in one step.

## See Also

- `pan unpause <id>` — clear the separate pause gate (unrelated flag, same shape of command)
- `pan start <id>` — spawn after the gate is clear
