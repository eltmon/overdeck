---
name: pan-admin-tldr
description: "pan admin tldr <cmd> — TLDR daemon management for token-efficient code analysis"
triggers:
  - pan admin tldr
  - tldr daemon
  - tldr status
  - tldr management
allowed-tools:
  - Bash
---

# pan admin tldr

Run the command now:

```bash
pan admin tldr <subcommand>
```

## Usage

```
pan admin tldr status              # Show TLDR daemon state
pan admin tldr start               # Start the daemon
pan admin tldr stop                # Stop the daemon
pan admin tldr restart             # Restart the daemon
```

## What It Does

Manages the TLDR daemon that provides token-efficient code analysis (500–1200 tokens/file
vs 10–25k for full reads). Used by agents to explore codebases without exhausting context.

## When to Use

- TLDR tools are unavailable in an agent session
- Daemon is not responding or has stalled
- Setting up a new workspace

## See Also

- `pan admin config <cmd>` — configuration management
- `pan doctor` — system health check
