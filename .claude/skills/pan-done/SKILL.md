---
name: pan-done
description: "pan done <id> — mark work complete and signal the review pipeline"
triggers:
  - pan done
  - mark done
  - work complete
  - signal done
  - complete issue
allowed-tools:
  - Bash
---

# pan done

Run the command now:

```bash
pan done <issue-id>
```

## What It Does

Signals that work on an issue is complete. This triggers the Cloister watchdog to run
quality gates (typecheck, lint, tests) and, if they pass, hand off to the review agent.
The agent's tmux session remains alive for follow-up.

## When to Use

- An agent has finished implementing a feature and all work is committed
- Manually signaling completion after direct edits to a workspace
- Re-signaling after fixing verification gate failures

## See Also

- `pan review pending` — see what's queued for review
- `pan approve <id>` — approve and merge after review passes
- `pan show <id>` — inspect the current state before signaling done
