---
name: pan-knowledge
description: "pan knowledge <id> — spawn an Overdeck knowledge agent for OKF study, retro, and sync"
triggers:
  - pan knowledge
  - knowledge agent
  - okf knowledge maintenance
allowed-tools:
  - Bash
  - Read
---

# Pan Knowledge

Use `pan knowledge` to spawn a live knowledge agent for a tracked issue. The agent maintains the project's Open Knowledge Format bundle and opens knowledge PRs instead of entering the implementation pipeline.

## Commands

```bash
pan knowledge <id> [--focus <topic>] [--retro] [--model <model>] [--effort <level>]
```

## Notes

- `--focus` asks the agent to run `/okf study` for that topic before syncing.
- `--retro` asks the agent to run `/okf retro` before syncing.
- `--model` flows through Overdeck role routing and bypasses the standalone `/okf --model` bridge ladder.
- The knowledge agent must not run `pan done`, transition implementation gates, or merge PRs.
