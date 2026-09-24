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

`pan unpause <id>` clears the persistent pause fields from the agent state file, then resumes the agent's saved session when it has one. Without a saved session it prints `pan start <id>` for the operator to run.

When the pause was an issue pause that stopped the issue's reviewers, unpause first re-requests the review through the normal review door (the same one `pan review request` uses), which starts a fresh review convoy for the current head. When it stopped only the test agent, unpause re-dispatches the test role. If the re-request fails (dashboard down, dirty tree), unpause exits 1 and tells you to run `pan review request <id>`.

## When to Use

- Use `pan unpause` after the reason for a manual pause has been resolved.
- Use `pan start <id> --force` instead only when you intentionally want to clear the pause gate and spawn in one step.

## See Also

- `pan pause <id>` — set the persistent pause gate
- `pan start <id>` — spawn after the gate is clear
