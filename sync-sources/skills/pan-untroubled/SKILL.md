---
name: pan-untroubled
description: "pan untroubled <id> — clear an agent troubled gate and failure counters without spawning it"
triggers:
  - pan untroubled
  - clear troubled agent
  - reset failure counter
  - clear crash loop
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

`pan untroubled <id>` clears the troubled gate and accumulated failure tracking fields from the agent state file. It does not spawn or resume the agent immediately.

After the troubled gate is clear, the Deacon's next patrol can auto-resume the agent if it is otherwise eligible. If the operator wants the agent running right away, run `pan start <id>` after clearing the gate.

## When to Use

- Use `pan untroubled` only after investigating and fixing the cause of repeated crashes or resume failures.
- Use `pan unpause <id>` for a manual pause gate; it does not clear failure counters.
- Use `pan kill <id>` when you only need to stop a currently running session.

## See Also

- `pan status` — check whether an agent is paused, troubled, stopped, or running
- `pan start <id>` — spawn after the gate is clear
- `pan pause <id>` — intentionally suppress auto-resume
