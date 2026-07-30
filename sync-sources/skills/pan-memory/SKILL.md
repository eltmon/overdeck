---
name: pan-memory
description: "pan memory <subcommand> — search and inspect Overdeck memory observations, status, reset markers, summaries, and health"
triggers:
  - pan memory
  - memory search
  - memory status
  - memory --target
allowed-tools:
  - Bash
  - Read
---

# Pan Memory

Use `pan memory` to inspect the durable memory substrate for a project or issue.

## Commands

```bash
pan memory search <query> [--project <id>] [--workspace <id|name>] [--issue <id>] [--tag <tag>] [--sibling] [--global] [--target [path]] [--include-archived] [--limit <n>] [--json]
pan memory status [issue] [--project <id>] [--workspace <id|name>] [--history <n>] [--json]
pan memory reset <scope> <scopeId> --reason <text> [--project <id>] [--from <iso>] [--json]
pan memory summary [issue] [--project <id>] [--workspace <id|name>] [--date <yyyy-mm-dd>] [--json]
pan memory doctor [--project <id>] [--json]
pan memory backfill [--workspace <id>] [--project <id>] [--dry-run] [--json]
pan memory pin <doc-path> [--project <id> | --workspace <id>] [--json]
pan memory unpin <doc-path> [--project <id> | --workspace <id>] [--json]
pan memory pins [--project <id> | --workspace <id>] [--json]
pan memory config [--json]
```

## Notes

- `search --sibling --issue <id>` searches same-project sibling issues instead of the selected issue.
- `search --global` merges results across every registered project instead of just the selected/default one.
- `search --workspace` accepts either a workspace id or a workspace name; a name matching more than one workspace across projects errors instead of guessing.
- `search --target [path]` (Subspace `target-search` parity) finds every non-archived workspace whose `path` targets a directory — bare `--target` defaults to the current working directory. Mutually exclusive with `--workspace`/`--issue`/`--global`. Fans out per matched workspace (which may span several projects) and merges by rank score, same as `--global`'s per-project merge. When no workspace targets the directory, prints a friendly "No workspaces target `<dir>`." note and exits 0.
- `status` and `summary` address a workspace three ways, in precedence order: `--workspace <id|name>`, an issue positional, then the workspace that owns the current directory. With none of the three resolvable the command exits non-zero and names all three modes. A workspace with no issue (main/scratch) is titled by its workspace name in `summary` output.
- `status --history <n>` prints the current status first, then up to N archived statuses newest-first with their archive timestamp, phase, and headline. N is capped at 50; the rollup writer prunes the on-disk archive to its three most recent entries, so N above 3 returns whatever is still retained. `--history` with `--json` emits `{current, history}` where each history entry is `{archivedAt, path, status}`.
- `reset` creates a reset marker; it does not delete historical memory records.
- `doctor` exits non-zero when an active agent has no successful extraction in the last hour.
- `backfill` reads historical Claude Code JSONL transcripts under `~/.claude/projects/` and extracts observations for sessions whose first-message cwd maps to a registered workspace; unmatched sessions are skipped. Read-only on the JSONL files — `--dry-run` reports matches without extracting or writing anything.
- `pin`/`unpin`/`pins` manage docs injected under the knowledge budget at prompt time. `--workspace` overrides `--project`; paths are stored project-relative regardless of scope.
