---
name: pan-conversations
description: "pan conversations scan/search/list/show/current/cost/enrich/embed/move/link-pr/schedule/pull/reclaim — discover, index, search, reassign, link PRs to, schedule prompts in, and pull conversations between machines in Claude Code session history"
triggers:
  - pan conversations
  - pan conv
  - conversations scan
  - conversations search
  - conversations move
  - conv link-pr
  - conv schedule
  - conv pull
  - conv reclaim
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
pan conversations pending <conv> [--json]
pan conversations link-pr <query> <url|#42|owner/repo#42> [--source agent|manual]
pan conversations unlink-pr <query> <url|#42|owner/repo#42>
pan conversations prs <query> [--json]
pan conversations auto-settle-on-merge [on|off]
pan conversations auto-settle <query> [on|off|inherit]
pan conversations auto-settle-idle-days [days]
pan conversations schedule add <conv> (--cron <expr> | --hourly | --daily <HH:MM> | --weekdays <HH:MM> | --weekly "<day> HH:MM") (--prompt <text> | --prompt-file <path>) [--tz <zone>] [--paused] [--json]
pan conversations schedule list [conv] [--json]
pan conversations schedule pause <id>
pan conversations schedule resume <id>
pan conversations schedule rm <id>
pan conversations pull <conv> [--stop-turn] [--json]
pan conversations reclaim <conv> [--force]
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
- **`pending <conv>`** (PAN-4641) lists the messages queued with
  `pan tell --when-limit-resets` that have not been delivered yet, in queue
  order: `#<id>  <status>  <not before>  <text preview>`, plus the last error when
  one is set. `<conv>` takes the same forms as `pan tell` (`conv/2972`, a
  conversation name, a dashboard URL). `--json` prints the rows. Edit or cancel a
  queued message from the conversation timeline in the dashboard.
- **`link-pr` / `unlink-pr` / `prs`** (PAN-3822) link a pull request to a
  conversation so its row and header show the PR badge. `<query>` resolves like
  `move`; `pan conv current` names your own conversation. Only a repository
  configured for the conversation's project is accepted (`#42` = that repo).
  Inside an agent the source is `agent`. Branch detection links a PR on its
  own only for a conversation in a linked git worktree, or an agent
  conversation, never one in the primary checkout. Unlinking hides the PR from
  branch detection too. Works with the dashboard down (writes the link directly).
  `auto-settle-on-merge` (default on) settles a conversation once all its
  linked PRs are merged or closed — it never archives or stops anything and
  never touches agent conversations; `auto-settle <query>` sets one
  conversation's override (`inherit` follows the global setting).
- **`auto-settle-idle-days [days]`** (PAN-4655, default 3, `0` = off) — the
  primary dashboard settles an operator conversation (reason `idle`) after that
  many days with no transcript activity, operator message or resume; never
  agent conversations, snoozed ones, or ones waiting on you. Unsettling
  restarts the clock. Works with the dashboard down.
- **`schedule`** (PAN-4640) runs a prompt in a conversation on a recurring
  schedule. `<conv>` accepts `self` (also `.`, `current`, `me`) for the
  conversation you are running in, a conversation number, a name, or a unique
  title match. Presets (`--hourly`, `--daily`, `--weekdays`, `--weekly "mon 09:00"`)
  compile to a 5-field cron; `--prompt-file` reads a long prompt from disk. The
  time zone defaults to this machine's zone, and runs must be at least 15
  minutes apart. The dashboard fires it, so it survives harness and dashboard
  restarts: a stopped session is resumed first, missed runs collapse into one,
  and a failed run is recorded, not retried. Agent conversations and vault
  copies cannot be scheduled. Writes work with the dashboard down.
- **`pull`** (PAN-4650) makes this machine own a conversation that runs on a
  linked machine. Name it `@<machine>/<conv>` (label or environment id). It
  prints each step (`release`, `transfer`, `adopt`, `finish`) and then
  `Pulled: /conv/<id>`; the old machine keeps a read-only copy. A running turn
  is waited for (up to 30 minutes) unless `--stop-turn`. When the owner is
  offline it continues this machine's Session Vault saved copy instead, and
  fails `owner-offline-no-saved-copy` without one. Pushing back is a `pull`
  from the other machine. Needs the dashboard.
- **`reclaim`** (PAN-4650) takes back a conversation this machine released
  when the machine it went to does not run it. It refuses with
  `still-running-there` while that machine runs it (pull it back instead), and
  with `target-offline` when that machine cannot be asked, unless `--force`.
- **`enrich`**/**`embed`** call out to an LLM/embedding provider and cost money;
  `enrich` prompts for confirmation unless `--yes` is passed. `--tier 3`
  (`--deep`) and `--full` are the expensive, most-thorough options.
- **`current`** is deterministic — it reads the current process's own recorded
  session identity, it does not scan or guess.
