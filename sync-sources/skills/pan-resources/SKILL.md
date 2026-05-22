---
name: pan-resources
description: "Show RAM usage by agents, conversations, and system processes — model breakdown, workspace agents, orphan detection"
triggers:
  - pan resources
  - system resources
  - ram usage
  - memory usage
  - how much ram
  - agent memory
  - resource usage
allowed-tools:
  - Bash
  - Read
---

# System Resource Inventory

Run `pan resources` to get a full breakdown of RAM usage across all Panopticon-managed processes.

```bash
pan resources
```

This shows:
- **System RAM/swap** — total, used, available, with color-coded severity
- **Model breakdown** — count and total RAM per AI model (claude-opus, sonnet, kimi, mimo, etc.)
- **Workspace agents** — each running agent with issue ID, role (work/planning/review/test/merge), model, RAM, and start time
- **Conversations** — count, total RAM, oldest, and archival recommendation for old conversations
- **Orphaned processes** — Claude processes NOT tracked by Panopticon (the real bug signal)
- **Other heavy processes** — Chrome, Vite, Java, TTS, Playwright, etc. over 100 MB

## JSON output

For machine consumption:

```bash
pan resources --json
```

## Interpreting results

- **Orphaned processes** (red warning) mean a Claude process is running but not tracked by any conversation or workspace agent. This indicates a bug in lifecycle management.
- **Archival recommendation** shows how many conversations are older than today and how much RAM archiving them would free.
- The 3-4 agent ceiling on 64 GB RAM means you should keep workspace agents + conversations below ~15 GB total.
