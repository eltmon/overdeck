---
name: pan-show
description: "pan show <id> — show agent state, work history, context, or health for an issue"
triggers:
  - pan show
  - show agent
  - agent status
  - shadow state
  - agent health
  - agent context
  - agent history
allowed-tools:
  - Bash
  - Read
---

# pan show

Run the command now:

```bash
pan show <issue-id>
```

## Usage

```
pan show PAN-123           # Summary: shadow state + CV + health
pan show PAN-123 --cv      # Agent work history (conversation view)
pan show PAN-123 --context # Context engineering state
pan show PAN-123 --health  # Health + heartbeat only
```

## What It Does

Displays the current state of the agent working on an issue. The bare form shows a combined
summary of shadow state, work history, and health. Flags narrow to a specific view.

## When to Use

- Checking what an agent is currently doing
- Reviewing work history before approving
- Diagnosing a stuck or unresponsive agent
- Inspecting context window state

## See Also

- `pan tell <id>` — send a message to the agent
- `pan kill <id>` — stop the agent
- `pan approve <id>` — approve and merge the agent's work
