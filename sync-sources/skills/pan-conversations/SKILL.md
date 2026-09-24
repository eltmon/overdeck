---
name: pan-conversations
description: "pan conversations scan/search/list/show/current/cost/enrich/embed/move/link-pr — discover, index, search, reassign, and link PRs to Claude Code session history"
triggers:
  - pan conversations
  - pan conv
  - conversations scan
  - conversations search
  - conversations move
  - conv link-pr
allowed-tools:
  - Bash
  - Read
---

# Pan Conversations

`pan conversations` (alias `pan conv`) discovers, indexes, and searches Claude Code
session history recorded in the `discovered_sessions` index, and reads/writes the
live `conversations` table (the same store the dashboard uses).

## Commands

```bash
pan conversations scan [dirs...] [--watched] [--system] [--dry-run] [--max-parallel <n>]
pan conversations search [query] [--workspace <path>] [--model <name>] [--since <time>] [--after <time>] [--before <time>] [--min-cost <n>] [--max-cost <n>] [--min-messages <n>] [--managed] [--unmanaged] [--enriched] [--not-enriched] [--tag <value>] [--tool <name>] [--file <path>] [--issue <id>] [--similar <id>] [--semantic <query>] [--format <fmt>] [--limit <n>] [--offset <n>]
pan conversations list [--workspace <path>] [--model <name>] [--since <time>] [--managed] [--enriched] [--format <fmt>] [--limit <n>] [--offset <n>]
pan conversations show <id> [--json]
pan conversations jsonl <conv-id> [--json]
pan conversations move <query> <projectKey>
pan conversations link-pr <query> <url|#42|owner/repo#42> [--source agent|manual]
pan conversations unlink-pr <query> <url|#42|owner/repo#42>
pan conversations prs <query> [--json]
pan conversations auto-archive-on-merge [on|off]
pan conversations current [--json]
pan conversations cost [--since <time>] [--workspace <path>] [--by <field>] [--json]
pan conversations embed [ids...] [--regenerate] [--status] [--provider <name>] [--model <name>] [--max-parallel <n>]
pan conversations enrich [ids...] [--tier <n>] [--deep] [--full] [--upgrade] [--with <model>] [--prompt <text>] [--limit <n>] [--workspace <path>] [--since <time>] [--ids <ids>] [--max-parallel <n>] [--yes]
```

`jsonl` aliases `transcript`; `current` aliases `whoami`.

## Notes

- **`scan`** indexes `~/.claude/projects/` (or configured watch directories with
  `--watched`) into `discovered_sessions`. Run it before `search`/`list`/`cost` return
  anything for sessions not yet seen. `--dry-run` previews without writing.
- **`search`** is the full-text + filterable query surface; `--semantic <query>`
  and `--similar <id>` need embeddings generated first via `embed`. `--format ids`
  is useful for piping session IDs into another command.
- **`list`** is `search` without the free-text query — structured filters only.
- **`show <id>`** resolves `<id>` as a **conversation** id first (the same
  `/conv/<N>` namespace the dashboard uses), falling back to the
  `discovered_sessions` scan-order index if no conversation matches.
- **`jsonl <conv-id>`** prints the on-disk transcript path for a conversation id,
  or reports `expired` (path derivable but file missing) / `unknown` (no
  `claude_session_id` recorded) — use `--json` to read the `status` field
  programmatically.
- **`move <query> <projectKey>`** (PAN-1577) reassigns a conversation's project
  via the `project_key` override, without touching its cwd, tmux session, or
  backing JSONL file. `<query>` resolves by exact conversation name first, then
  a fuzzy match against conversation titles — an ambiguous fuzzy match (more than
  one title contains the query) or no match at all exits non-zero listing the
  candidates. `<projectKey>` is the project's yaml key (from `projects.yaml`),
  not its display name. Requires the dashboard running (`pan up`) — the command
  PATCHes `/api/conversations/:name/move`.
- **`link-pr` / `unlink-pr` / `prs`** (PAN-3822) link a pull request to a
  conversation so its row and header show the PR badge. `<query>` resolves like
  `move`; `pan conv current` names your own conversation. Only a repository
  configured for the conversation's project is accepted (`#42` = that repo).
  Inside an agent the source is `agent`. Unlinking hides the PR from branch
  detection too. Works with the dashboard down (writes the link directly).
  `auto-archive-on-merge` (default off) archives an operator conversation once
  all its linked PRs are merged or closed; never agent conversations, never a
  live session.
- **`enrich`**/**`embed`** call out to an LLM/embedding provider and cost money;
  `enrich` prompts for confirmation unless `--yes` is passed. `--tier 3`
  (`--deep`) and `--full` are the expensive, most-thorough options.
- **`current`** is deterministic — it reads the current process's own recorded
  session identity, it does not scan or guess.
