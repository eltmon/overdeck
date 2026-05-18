---
name: pan-unpause
description: "pan unpause <id> — clear an agent pause gate without spawning it"
triggers:
  - pan unpause
  - unpause agent
  - resume auto resume
  - clear pause gate
allowed-tools:
  - Bash
  - Read
---

# pan unpause

Run the command now:

```bash
pan unpause <issue-id>
```

## Usage

```bash
pan unpause PAN-123
```

## What It Does

`pan unpause <id>` clears the persistent pause fields from the agent state file. It does not spawn or resume the agent immediately.

After unpausing, the Deacon's next patrol can auto-resume eligible stopped work agents. If the operator wants the agent running right away, run `pan start <id>` after unpausing.

## When to Use

- Use `pan unpause` after the reason for a manual pause has been resolved.
- Use `pan start <id> --force` instead only when you intentionally want to clear the pause gate and spawn in one step.
- Do not use this to clear repeated crash state; use `pan untroubled <id>` for the troubled gate.

## See Also

- `pan pause <id>` — set the persistent pause gate
- `pan start <id>` — spawn after the gate is clear
- `pan untroubled <id>` — clear repeated-failure troubled state
