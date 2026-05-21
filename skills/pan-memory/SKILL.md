---
name: pan-memory
description: "pan memory <subcommand> — search and inspect Panopticon memory observations, status, reset markers, summaries, and health"
triggers:
  - pan memory
  - memory search
  - memory status
allowed-tools:
  - Bash
  - Read
---

# Pan Memory

Use `pan memory` to inspect the durable memory substrate for a project or issue.

## Commands

```bash
pan memory search <query> [--project <id>] [--workspace <id>] [--issue <id>] [--tag <tag>] [--sibling] [--include-archived] [--limit <n>] [--json]
pan memory status <issue> [--project <id>] [--json]
pan memory reset <scope> <scopeId> --reason <text> [--project <id>] [--from <iso>] [--json]
pan memory summary <issue> [--project <id>] [--date <yyyy-mm-dd>] [--json]
pan memory doctor [--project <id>] [--json]
pan memory config [--json]
```

## Notes

- `search --sibling --issue <id>` searches same-project sibling issues instead of the selected issue.
- `reset` creates a reset marker; it does not delete historical memory records.
- `doctor` exits non-zero when an active agent has no successful extraction in the last hour.
